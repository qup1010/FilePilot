import shutil
import threading
import time
import unittest
import json
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from file_pilot.icon_workbench.models import (
    IconAnalysisResult,
    IconPreviewVersion,
    IconWorkbenchConfig,
    ModelConfig,
)
from file_pilot.icon_workbench.service import IconWorkbenchService
from file_pilot.icon_workbench.store import IconWorkbenchStore


class StubTextClient:
    def analyze_folder(self, config, folder_path, folder_name, tree_lines):
        return IconAnalysisResult(
            category="项目目录",
            visual_subject=f"{folder_name} badge",
            summary="根据目录结构生成的图标方向。",
            suggested_prompt=f"Prompt for {folder_name}",
        )


class StubImageClient:
    def generate_png(self, config, prompt, size):
        return (
            b"\x89PNG\r\n\x1a\n"
            b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
            b"\x00\x00\x00\x0dIDATx\x9cc\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d"
            b"\x00\x00\x00\x00IEND\xaeB`\x82"
        )


class RecordingConcurrentTextClient:
    def __init__(self):
        self.lock = threading.Lock()
        self.active = 0
        self.max_active = 0
        self.calls = []

    def analyze_folder(self, config, folder_path, folder_name, tree_lines):
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            time.sleep(0.05)
            with self.lock:
                self.calls.append(folder_name)
            return IconAnalysisResult(
                category="项目目录",
                visual_subject=f"{folder_name} badge",
                summary="并发分析测试。",
                suggested_prompt=f"Prompt for {folder_name}",
            )
        finally:
            with self.lock:
                self.active -= 1


class RecordingConcurrentImageClient:
    def __init__(self):
        self.lock = threading.Lock()
        self.active = 0
        self.max_active = 0
        self.prompts = []

    def generate_png(self, config, prompt, size):
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            time.sleep(0.05)
            with self.lock:
                self.prompts.append(prompt)
            return (
                b"\x89PNG\r\n\x1a\n"
                b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
                b"\x00\x00\x00\x0dIDATx\x9cc\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d"
                b"\x00\x00\x00\x00IEND\xaeB`\x82"
            )
        finally:
            with self.lock:
                self.active -= 1


class IconWorkbenchServiceTests(unittest.TestCase):
    def setUp(self):
        self.test_root = Path.cwd() / "output" / "test-temp"
        self.test_root.mkdir(parents=True, exist_ok=True)
        self.temp_dir = str(self.test_root / f"icon-workbench-{uuid4().hex}")
        Path(self.temp_dir).mkdir(parents=True, exist_ok=True)
        self.alpha_dir = Path(self.temp_dir) / "Alpha"
        self.beta_dir = Path(self.temp_dir) / "Beta"
        self.gamma_dir = Path(self.temp_dir) / "Gamma"
        self.alpha_dir.mkdir(parents=True, exist_ok=True)
        self.beta_dir.mkdir(parents=True, exist_ok=True)
        self.gamma_dir.mkdir(parents=True, exist_ok=True)
        (self.alpha_dir / "docs").mkdir()
        (self.alpha_dir / "docs" / "readme.md").write_text("hello", encoding="utf-8")
        (self.beta_dir / "src").mkdir()
        (self.beta_dir / "src" / "main.py").write_text("print('ok')", encoding="utf-8")

        self.text_model_patch = patch(
            "file_pilot.icon_workbench.config.IconWorkbenchConfigStore._global_text_model",
            return_value=ModelConfig(
                base_url="https://text.example/v1",
                api_key="text-key",
                model="gpt-text",
            ),
        )
        self.text_model_patch.start()

        self.store = IconWorkbenchStore(Path(self.temp_dir) / "output")
        self.store.config_store.save(
            IconWorkbenchConfig.from_dict(
                {
                    "text_model": {
                        "base_url": "https://text.example/v1",
                        "api_key": "text-key",
                        "model": "gpt-text",
                    },
                    "image_model": {
                        "base_url": "https://image.example/v1",
                        "api_key": "image-key",
                        "model": "gpt-image",
                    },
                    "image_size": "512x512",
                    "concurrency_limit": 1,
                }
            )
        )
        self.service = IconWorkbenchService(
            store=self.store,
            text_client=StubTextClient(),
            image_client=StubImageClient(),
        )

    def tearDown(self):
        self.text_model_patch.stop()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_create_session_uses_explicit_target_paths(self):
        session = self.service.create_session([str(self.alpha_dir), str(self.beta_dir)])

        self.assertEqual(session["folder_count"], 2)
        self.assertEqual([item["folder_name"] for item in session["folders"]], ["Alpha", "Beta"])
        self.assertEqual(session["target_paths"], [str(self.alpha_dir), str(self.beta_dir)])
        self.assertNotIn("messages", session)
        self.assertNotIn("pending_actions", session)

    def test_update_and_remove_session_targets(self):
        session = self.service.create_session([str(self.alpha_dir)])
        updated = self.service.update_session_targets(session["session_id"], [str(self.beta_dir), str(self.alpha_dir)], "append")

        self.assertEqual(updated["target_paths"], [str(self.alpha_dir), str(self.beta_dir)])
        self.assertEqual([item["folder_name"] for item in updated["folders"]], ["Alpha", "Beta"])

        removed = self.service.remove_session_target(session["session_id"], updated["folders"][0]["folder_id"])
        self.assertEqual(removed["target_paths"], [str(self.beta_dir)])
        self.assertEqual([item["folder_name"] for item in removed["folders"]], ["Beta"])

    def test_list_sessions_returns_recent_history_summaries(self):
        older = self.service.create_session([str(self.alpha_dir)])
        newer = self.service.create_session([str(self.alpha_dir), str(self.beta_dir), str(self.gamma_dir)])
        self.service.analyze_folders(newer["session_id"], [newer["folders"][0]["folder_id"]])
        generated = self.service.generate_previews(newer["session_id"], [newer["folders"][0]["folder_id"]])
        folder_id = generated["folders"][0]["folder_id"]
        version_id = generated["folders"][0]["versions"][0]["version_id"]

        raw_older = self.store.load_session(older["session_id"])
        raw_older.updated_at = "2026-01-01T00:00:00+00:00"
        self.store.save_session(raw_older)
        raw_newer = self.store.load_session(newer["session_id"])
        raw_newer.updated_at = "2026-01-02T00:00:00+00:00"
        raw_newer.folders[1].last_error = "mock error"
        self.store.save_session(raw_newer)

        self.service.report_client_action(
            newer["session_id"],
            {
                "action_type": "apply_icons",
                "results": [
                    {
                        "folder_id": folder_id,
                        "folder_name": "Alpha",
                        "folder_path": str(self.alpha_dir),
                        "version_id": version_id,
                        "status": "applied",
                        "message": "已应用",
                    }
                ],
                "skipped_items": [],
            },
        )
        raw_newer = self.store.load_session(newer["session_id"])
        raw_newer.updated_at = "2026-01-02T00:00:00+00:00"
        self.store.save_session(raw_newer)

        history = self.service.list_sessions()["sessions"]

        self.assertEqual([item["session_id"] for item in history], [newer["session_id"], older["session_id"]])
        self.assertEqual(history[0]["target_count"], 3)
        self.assertEqual(history[0]["folder_count"], 3)
        self.assertEqual(history[0]["ready_count"], 1)
        self.assertEqual(history[0]["applied_count"], 1)
        self.assertEqual(history[0]["error_count"], 1)
        self.assertEqual(history[0]["target_paths"], [str(self.alpha_dir), str(self.beta_dir)])
        self.assertIn("应用图标已完成", history[0]["last_action_message"])

    def test_list_sessions_skips_broken_session_files(self):
        session = self.service.create_session([str(self.alpha_dir)])
        (self.store.sessions_dir / "broken.json").write_text("{bad json", encoding="utf-8")

        history = self.service.list_sessions()["sessions"]

        self.assertEqual([item["session_id"] for item in history], [session["session_id"]])

    def test_delete_session_removes_record_and_preview_assets(self):
        session = self.service.create_session([str(self.alpha_dir)])
        folder_id = session["folders"][0]["folder_id"]
        preview_dir = self.store.preview_directory(session["session_id"], folder_id)
        preview_file = preview_dir / "v1.png"
        preview_file.write_bytes(b"png")

        result = self.service.delete_session(session["session_id"])

        self.assertEqual(result, {"status": "deleted", "session_id": session["session_id"]})
        self.assertFalse(self.store.session_path(session["session_id"]).exists())
        self.assertFalse((self.store.previews_dir / session["session_id"]).exists())

    def test_delete_missing_session_raises_not_found(self):
        with self.assertRaises(FileNotFoundError):
            self.service.delete_session("missing-session")

    def test_concurrent_update_session_targets_keeps_all_paths(self):
        session = self.service.create_session([str(self.alpha_dir)])
        original_load_session = self.store.load_session

        def delayed_load_session(session_id):
            loaded = original_load_session(session_id)
            time.sleep(0.05)
            return loaded

        errors: list[Exception] = []
        start_event = threading.Event()

        def worker(path: Path):
            start_event.wait()
            try:
                self.service.update_session_targets(session["session_id"], [str(path)], "append")
            except Exception as exc:  # pragma: no cover
                errors.append(exc)

        threads = [
            threading.Thread(target=worker, args=(self.beta_dir,)),
            threading.Thread(target=worker, args=(self.gamma_dir,)),
        ]

        with patch.object(self.store, "load_session", side_effect=delayed_load_session):
            for thread in threads:
                thread.start()
            start_event.set()
            for thread in threads:
                thread.join()

        self.assertEqual(errors, [])
        updated = self.service.get_session(session["session_id"])
        self.assertEqual(
            sorted(updated["target_paths"]),
            sorted([str(self.alpha_dir), str(self.beta_dir), str(self.gamma_dir)]),
        )

    def test_analyze_generate_and_select_version_updates_session(self):
        session = self.service.create_session([str(self.alpha_dir), str(self.beta_dir)])
        folder_id = session["folders"][0]["folder_id"]

        analyzed = self.service.analyze_folders(session["session_id"], [folder_id])
        folder = analyzed["folders"][0]
        self.assertEqual(folder["analysis_status"], "ready")
        self.assertEqual(folder["current_prompt"], "Prompt for Alpha")

        updated = self.service.update_folder_prompt(session["session_id"], folder_id, "Manual prompt")
        self.assertEqual(updated["folders"][0]["current_prompt"], "Manual prompt")

        generated = self.service.generate_previews(session["session_id"], [folder_id])
        folder = generated["folders"][0]
        self.assertEqual(len(folder["versions"]), 1)
        self.assertEqual(folder["versions"][0]["status"], "ready")
        self.assertTrue(Path(folder["versions"][0]["image_path"]).exists())
        self.assertTrue(folder["versions"][0]["image_url"].endswith("/image"))

        selected = self.service.select_version(
            session["session_id"],
            folder_id,
            folder["versions"][0]["version_id"],
        )
        self.assertEqual(selected["folders"][0]["current_version_id"], folder["versions"][0]["version_id"])

    def test_delete_version_persists_and_falls_back_to_previous_ready_version(self):
        session = self.service.create_session([str(self.alpha_dir)])
        folder_id = session["folders"][0]["folder_id"]
        self.service.analyze_folders(session["session_id"], [folder_id])
        first = self.service.generate_previews(session["session_id"], [folder_id])
        first_version = first["folders"][0]["versions"][0]
        second = self.service.generate_previews(session["session_id"], [folder_id])
        second_folder = second["folders"][0]
        second_version = second_folder["versions"][1]

        deleted = self.service.delete_version(session["session_id"], folder_id, second_version["version_id"])

        folder = deleted["folders"][0]
        self.assertEqual(len(folder["versions"]), 1)
        self.assertEqual(folder["versions"][0]["version_id"], first_version["version_id"])
        self.assertEqual(folder["current_version_id"], first_version["version_id"])
        self.assertFalse(Path(second_version["image_path"]).exists())

    def test_update_config_persists_values(self):
        updated = self.service.update_config(
            {
                "name": "ModelScope 生图",
                "image_size": "1024x1024",
                "image_model": {"model": "flux-1"},
            }
        )

        self.assertEqual(updated["image_size"], "1024x1024")
        self.assertEqual(updated["image_model"]["model"], "flux-1")

        payload = self.service.get_config()
        self.assertEqual(payload["config"]["name"], "ModelScope 生图")
        self.assertEqual(payload["active_preset_id"], "default")

    def test_config_presets_support_add_switch_delete(self):
        created = self.service.add_config_preset(
            "阿里云生图",
            {
                "image_model": {
                    "base_url": "https://image.example/v1",
                    "api_key": "next-image-key",
                    "model": "wanx",
                },
                "image_size": "1024x1024",
            },
        )
        new_id = created["active_preset_id"]
        self.assertNotEqual(new_id, "default")
        self.assertTrue(any(item["id"] == new_id for item in created["presets"]))
        self.assertEqual(created["config"]["image_model"]["model"], "wanx")

        switched = self.service.switch_config_preset("default")
        self.assertEqual(switched["active_preset_id"], "default")

        deleted = self.service.delete_config_preset(new_id)
        self.assertEqual(deleted["active_preset_id"], "default")
        self.assertFalse(any(item["id"] == new_id for item in deleted["presets"]))

    def test_template_crud_and_apply_template(self):
        session = self.service.create_session([str(self.alpha_dir), str(self.beta_dir)])
        folder_id = session["folders"][0]["folder_id"]
        self.service.analyze_folders(session["session_id"], [folder_id])

        initial_templates = self.service.list_templates()
        self.assertTrue(any(item["is_builtin"] for item in initial_templates))

        created = self.service.create_template(
            {
                "name": "工作目录模板",
                "description": "用于项目类目录",
                "prompt_template": "Folder {{folder_name}} as {{subject}} in {{category}} style",
            }
        )
        self.assertEqual(created["name"], "工作目录模板")
        self.assertFalse(created["is_builtin"])

        updated = self.service.update_template(
            created["template_id"],
            {
                "name": "工作目录模板-更新",
                "description": "更新描述",
                "prompt_template": "Custom {{subject}} icon for {{folder_name}}",
            },
        )
        self.assertEqual(updated["name"], "工作目录模板-更新")
        self.assertEqual(updated["description"], "更新描述")

        applied = self.service.apply_template(session["session_id"], updated["template_id"], [folder_id])
        folder = next(item for item in applied["folders"] if item["folder_id"] == folder_id)
        self.assertIn("Custom", folder["current_prompt"])
        self.assertTrue(folder["prompt_customized"])
        self.assertEqual(applied["template_id"], updated["template_id"])
        self.assertEqual(applied["template_name"], "工作目录模板-更新")

        deleted = self.service.delete_template(updated["template_id"])
        self.assertEqual(deleted["status"], "ok")
        self.assertEqual(deleted["template_id"], updated["template_id"])
        remaining = self.service.list_templates()
        self.assertFalse(any(item["template_id"] == updated["template_id"] for item in remaining))

    def test_template_store_reads_legacy_payload_and_rewrites_with_schema_version(self):
        legacy_payload = {
            "user_templates": [
                {
                    "template_id": "legacy_template",
                    "name": "旧模板",
                    "description": "旧格式",
                    "prompt_template": "Legacy {{subject}}",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                }
            ]
        }
        self.store.templates_path.parent.mkdir(parents=True, exist_ok=True)
        self.store.templates_path.write_text(json.dumps(legacy_payload, ensure_ascii=False, indent=2), encoding="utf-8")

        loaded = self.service.list_templates()
        self.assertTrue(any(item["template_id"] == "legacy_template" for item in loaded))

        updated = self.service.update_template("legacy_template", {"description": "已迁移"})
        self.assertEqual(updated["description"], "已迁移")

        persisted = json.loads(self.store.templates_path.read_text(encoding="utf-8"))
        self.assertEqual(persisted["schema_version"], 1)
        self.assertEqual(persisted["user_templates"][0]["template_id"], "legacy_template")

    def test_prepare_apply_ready_only_returns_ready_versions(self):
        session = self.service.create_session([str(self.alpha_dir), str(self.beta_dir)])
        folder_a = session["folders"][0]["folder_id"]
        folder_b = session["folders"][1]["folder_id"]

        self.service.analyze_folders(session["session_id"], [folder_a, folder_b])
        self.service.generate_previews(session["session_id"], [folder_a])

        raw_session = self.store.load_session(session["session_id"])
        target_folder = next(item for item in raw_session.folders if item.folder_id == folder_b)
        failed_version = IconPreviewVersion(
            version_id="failed-version",
            version_number=1,
            prompt="bad prompt",
            image_path=str(Path(self.temp_dir) / "missing.png"),
            status="error",
            error_message="mock error",
        )
        target_folder.versions.append(failed_version)
        target_folder.current_version_id = failed_version.version_id
        self.store.save_session(raw_session)

        prepared = self.service.prepare_apply_ready(session["session_id"], [folder_a, folder_b])
        self.assertEqual(prepared["total"], 2)
        self.assertEqual(prepared["ready_count"], 1)
        self.assertEqual(prepared["skipped_count"], 1)
        self.assertEqual(prepared["tasks"][0]["folder_id"], folder_a)
        self.assertTrue(prepared["tasks"][0]["version_id"])
        self.assertEqual(prepared["skipped_items"][0]["folder_id"], folder_b)
        self.assertEqual(prepared["skipped_items"][0]["message"], "当前版本未就绪")

    def test_report_client_action_updates_last_summary(self):
        session = self.service.create_session([str(self.alpha_dir), str(self.beta_dir)])

        updated = self.service.report_client_action(
            session["session_id"],
            {
                "action_type": "apply_icons",
                "results": [
                    {
                        "folder_id": "folder-1",
                        "folder_name": "Alpha",
                        "folder_path": "D:/Icons/Alpha",
                        "status": "applied",
                        "message": "已应用",
                    },
                    {
                        "folder_id": "folder-2",
                        "folder_name": "Beta",
                        "folder_path": "D:/Icons/Beta",
                        "status": "failed",
                        "message": "权限不足",
                    },
                ],
                "skipped_items": [
                    {
                        "folder_id": "folder-3",
                        "folder_name": "Gamma",
                        "status": "skipped",
                        "message": "没有可恢复的备份",
                    }
                ],
            },
        )

        self.assertEqual(updated["last_client_action"]["action_type"], "apply_icons")
        self.assertEqual(updated["last_client_action"]["summary"]["success_count"], 1)
        self.assertEqual(updated["last_client_action"]["summary"]["failed_count"], 1)
        self.assertEqual(updated["last_client_action"]["summary"]["skipped_count"], 1)
        self.assertEqual(updated["last_client_action"]["results"][0]["status"], "applied")
        self.assertEqual(updated["last_client_action"]["results"][2]["status"], "skipped")

    def test_report_client_action_persists_applied_version_and_restore_clears_it(self):
        session = self.service.create_session([str(self.alpha_dir)])
        folder_id = session["folders"][0]["folder_id"]
        self.service.analyze_folders(session["session_id"], [folder_id])
        generated = self.service.generate_previews(session["session_id"], [folder_id])
        version_id = generated["folders"][0]["versions"][0]["version_id"]

        applied = self.service.report_client_action(
            session["session_id"],
            {
                "action_type": "apply_icons",
                "results": [
                    {
                        "folder_id": folder_id,
                        "folder_name": "Alpha",
                        "folder_path": str(self.alpha_dir),
                        "version_id": version_id,
                        "status": "applied",
                        "message": "已应用",
                    }
                ],
                "skipped_items": [],
            },
        )

        folder = applied["folders"][0]
        self.assertEqual(folder["applied_version_id"], version_id)
        self.assertIsNotNone(folder["applied_at"])

        restored = self.service.report_client_action(
            session["session_id"],
            {
                "action_type": "restore_icons",
                "results": [
                    {
                        "folder_id": folder_id,
                        "folder_name": "Alpha",
                        "folder_path": str(self.alpha_dir),
                        "status": "restored",
                        "message": "已恢复",
                    }
                ],
                "skipped_items": [],
            },
        )

        folder = restored["folders"][0]
        self.assertIsNone(folder["applied_version_id"])
        self.assertIsNone(folder["applied_at"])

    def test_report_client_action_does_not_persist_applied_without_version_id(self):
        session = self.service.create_session([str(self.alpha_dir)])
        folder_id = session["folders"][0]["folder_id"]

        updated = self.service.report_client_action(
            session["session_id"],
            {
                "action_type": "apply_icons",
                "results": [
                    {
                        "folder_id": folder_id,
                        "folder_name": "Alpha",
                        "folder_path": str(self.alpha_dir),
                        "status": "applied",
                        "message": "已应用",
                    }
                ],
                "skipped_items": [],
            },
        )

        folder = updated["folders"][0]
        self.assertIsNone(folder["applied_version_id"])
        self.assertIsNone(folder["applied_at"])

    def test_analyze_folders_uses_configured_analysis_concurrency_limit(self):
        concurrent_text_client = RecordingConcurrentTextClient()
        service = IconWorkbenchService(
            store=self.store,
            text_client=concurrent_text_client,
            image_client=StubImageClient(),
        )
        self.store.config_store.save(
            IconWorkbenchConfig.from_dict(
                {
                    "text_model": {
                        "base_url": "https://text.example/v1",
                        "api_key": "text-key",
                        "model": "gpt-text",
                    },
                    "image_model": {
                        "base_url": "https://image.example/v1",
                        "api_key": "image-key",
                        "model": "gpt-image",
                    },
                    "image_size": "512x512",
                    "analysis_concurrency_limit": 2,
                    "image_concurrency_limit": 1,
                }
            )
        )
        session = service.create_session([str(self.alpha_dir), str(self.beta_dir), str(self.gamma_dir)])

        updated = service.analyze_folders(session["session_id"])

        self.assertEqual(sorted(concurrent_text_client.calls), ["Alpha", "Beta", "Gamma"])
        self.assertGreaterEqual(concurrent_text_client.max_active, 2)
        self.assertTrue(all(folder["analysis_status"] == "ready" for folder in updated["folders"]))

    def test_generate_previews_uses_configured_image_concurrency_limit(self):
        concurrent_image_client = RecordingConcurrentImageClient()
        service = IconWorkbenchService(
            store=self.store,
            text_client=StubTextClient(),
            image_client=concurrent_image_client,
        )
        self.store.config_store.save(
            IconWorkbenchConfig.from_dict(
                {
                    "text_model": {
                        "base_url": "https://text.example/v1",
                        "api_key": "text-key",
                        "model": "gpt-text",
                    },
                    "image_model": {
                        "base_url": "https://image.example/v1",
                        "api_key": "image-key",
                        "model": "gpt-image",
                    },
                    "image_size": "512x512",
                    "analysis_concurrency_limit": 1,
                    "image_concurrency_limit": 2,
                }
            )
        )
        session = service.create_session([str(self.alpha_dir), str(self.beta_dir), str(self.gamma_dir)])
        service.analyze_folders(session["session_id"])

        updated = service.generate_previews(session["session_id"])

        self.assertEqual(len(concurrent_image_client.prompts), 3)
        self.assertGreaterEqual(concurrent_image_client.max_active, 2)
        self.assertTrue(all(len(folder["versions"]) == 1 for folder in updated["folders"]))

    def test_add_processed_version_keeps_all_versions_under_concurrent_requests(self):
        session = self.service.create_session([str(self.alpha_dir)])
        folder_id = session["folders"][0]["folder_id"]
        self.service.analyze_folders(session["session_id"], [folder_id])
        generated = self.service.generate_previews(session["session_id"], [folder_id])
        original_version_id = generated["folders"][0]["versions"][0]["version_id"]
        png_bytes = StubImageClient().generate_png(None, "", "")

        original_load_session = self.store.load_session

        def delayed_load_session(session_id):
            loaded = original_load_session(session_id)
            time.sleep(0.05)
            return loaded

        errors: list[Exception] = []
        start_event = threading.Event()

        def worker(index: int):
            start_event.wait()
            try:
                self.service.add_processed_version(
                    session["session_id"],
                    folder_id,
                    original_version_id,
                    png_bytes,
                    suffix=f"nobg{index}",
                )
            except Exception as exc:  # pragma: no cover - assertion below will surface it
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(index,)) for index in range(2)]
        with patch.object(self.store, "load_session", side_effect=delayed_load_session):
            for thread in threads:
                thread.start()
            start_event.set()
            for thread in threads:
                thread.join()

        self.assertEqual(errors, [])
        updated = self.service.get_session(session["session_id"])
        folder = updated["folders"][0]
        self.assertEqual(len(folder["versions"]), 3)
        self.assertEqual(sorted(version["version_number"] for version in folder["versions"]), [1, 2, 3])
        self.assertEqual(len({version["version_id"] for version in folder["versions"]}), 3)


if __name__ == "__main__":
    unittest.main()
