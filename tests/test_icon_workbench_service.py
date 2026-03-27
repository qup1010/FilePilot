import shutil
import tempfile
import unittest
from pathlib import Path

from file_organizer.icon_workbench.models import IconAnalysisResult, IconPreviewVersion, IconWorkbenchConfig
from file_organizer.icon_workbench.service import IconWorkbenchService
from file_organizer.icon_workbench.store import IconWorkbenchStore


class StubTextClient:
    def analyze_folder(self, config, folder_name, tree_lines):
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


class StubChatAgent:
    def __init__(self):
        self.outputs = []
        self.calls = []

    def queue(self, response, actions=None):
        self.outputs.append({"response": response, "actions": list(actions or [])})

    def process_message(
        self,
        config,
        session,
        user_message,
        templates,
        *,
        selected_folder_ids=None,
        active_folder_id=None,
    ):
        self.calls.append(
            {
                "session_id": session.session_id,
                "user_message": user_message,
                "selected_folder_ids": list(selected_folder_ids or []),
                "active_folder_id": active_folder_id,
                "template_count": len(templates),
            }
        )
        if self.outputs:
            return self.outputs.pop(0)
        return {"response": "已记录。", "actions": []}


class IconWorkbenchServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix="icon-workbench-")
        self.parent_dir = Path(self.temp_dir) / "target"
        self.parent_dir.mkdir(parents=True, exist_ok=True)
        (self.parent_dir / "Alpha").mkdir()
        (self.parent_dir / "Beta").mkdir()
        (self.parent_dir / "Alpha" / "docs").mkdir()
        (self.parent_dir / "Alpha" / "docs" / "readme.md").write_text("hello", encoding="utf-8")
        (self.parent_dir / "Beta" / "src").mkdir()
        (self.parent_dir / "Beta" / "src" / "main.py").write_text("print('ok')", encoding="utf-8")

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
        self.chat_agent = StubChatAgent()
        self.service = IconWorkbenchService(
            store=self.store,
            text_client=StubTextClient(),
            image_client=StubImageClient(),
            chat_agent=self.chat_agent,
        )

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_create_session_scans_immediate_subfolders(self):
        session = self.service.create_session(str(self.parent_dir))

        self.assertEqual(session["folder_count"], 2)
        self.assertEqual([item["folder_name"] for item in session["folders"]], ["Alpha", "Beta"])
        self.assertEqual(session["messages"][0]["role"], "assistant")

    def test_analyze_generate_and_select_version_updates_session(self):
        session = self.service.create_session(str(self.parent_dir))
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

    def test_update_config_persists_values(self):
        updated = self.service.update_config(
            {
                "image_size": "1024x1024",
                "image_model": {"model": "flux-1"},
            }
        )

        self.assertEqual(updated["image_size"], "1024x1024")
        self.assertEqual(updated["image_model"]["model"], "flux-1")

    def test_template_crud_and_apply_template(self):
        session = self.service.create_session(str(self.parent_dir))
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

    def test_prepare_apply_ready_only_returns_ready_versions(self):
        session = self.service.create_session(str(self.parent_dir))
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
        self.assertEqual(prepared["skipped_items"][0]["folder_id"], folder_b)
        self.assertEqual(prepared["skipped_items"][0]["message"], "当前版本未就绪")

    def test_send_message_auto_executes_low_risk_action(self):
        session = self.service.create_session(str(self.parent_dir))
        folder_id = session["folders"][0]["folder_id"]
        self.chat_agent.queue(
            "我已经先分析当前选中的文件夹。",
            actions=[{"type": "analyze_folders", "folder_ids": [folder_id]}],
        )

        updated = self.service.send_message(
            session["session_id"],
            "先分析一下当前文件夹",
            selected_folder_ids=[folder_id],
            active_folder_id=folder_id,
        )

        folder = next(item for item in updated["folders"] if item["folder_id"] == folder_id)
        self.assertEqual(folder["analysis_status"], "ready")
        self.assertEqual(updated["messages"][-1]["role"], "assistant")
        self.assertEqual(updated["messages"][-1]["tool_results"][0]["tool_name"], "analyze_folders")
        self.assertEqual(self.chat_agent.calls[0]["selected_folder_ids"], [folder_id])
        self.assertEqual(self.chat_agent.calls[0]["active_folder_id"], folder_id)

    def test_send_message_generates_pending_action(self):
        session = self.service.create_session(str(self.parent_dir))
        folder_id = session["folders"][0]["folder_id"]
        self.chat_agent.queue(
            "我已经整理好预览生成任务，等你确认。",
            actions=[{"type": "generate_previews", "folder_ids": [folder_id]}],
        )

        updated = self.service.send_message(session["session_id"], "生成预览", selected_folder_ids=[folder_id])

        self.assertEqual(len(updated["pending_actions"]), 1)
        pending_action = updated["pending_actions"][0]
        self.assertEqual(pending_action["action_type"], "generate_previews")
        self.assertEqual(updated["messages"][-1]["action_ids"], [pending_action["action_id"]])
        self.assertEqual(updated["messages"][-1]["tool_results"][0]["tool_name"], "generate_previews")

    def test_confirm_generate_previews_executes_server_side_action(self):
        session = self.service.create_session(str(self.parent_dir))
        folder_id = session["folders"][0]["folder_id"]
        self.service.analyze_folders(session["session_id"], [folder_id])
        self.chat_agent.queue(
            "预览任务已准备好。",
            actions=[{"type": "generate_previews", "folder_ids": [folder_id]}],
        )
        pending = self.service.send_message(session["session_id"], "给这个文件夹生成预览")
        action_id = pending["pending_actions"][0]["action_id"]

        confirmed = self.service.confirm_pending_action(session["session_id"], action_id)

        confirmed_session = confirmed["session"]
        folder = next(item for item in confirmed_session["folders"] if item["folder_id"] == folder_id)
        self.assertEqual(len(folder["versions"]), 1)
        self.assertEqual(confirmed_session["pending_actions"], [])
        self.assertIn("已按确认生成", confirmed_session["messages"][-1]["content"])

    def test_confirm_apply_icons_returns_client_execution(self):
        session = self.service.create_session(str(self.parent_dir))
        folder_id = session["folders"][0]["folder_id"]
        self.service.analyze_folders(session["session_id"], [folder_id])
        self.service.generate_previews(session["session_id"], [folder_id])
        self.chat_agent.queue(
            "应用任务已准备好。",
            actions=[{"type": "apply_icons", "folder_ids": [folder_id]}],
        )
        pending = self.service.send_message(session["session_id"], "应用当前图标")
        action_id = pending["pending_actions"][0]["action_id"]

        confirmed = self.service.confirm_pending_action(session["session_id"], action_id)

        self.assertEqual(confirmed["client_execution"]["command"], "apply_ready_icons")
        self.assertEqual(len(confirmed["client_execution"]["tasks"]), 1)
        self.assertEqual(confirmed["client_execution"]["tasks"][0]["folder_id"], folder_id)
        self.assertIn("已确认应用图标", confirmed["session"]["messages"][-1]["content"])

    def test_dismiss_pending_action_removes_it_and_records_message(self):
        session = self.service.create_session(str(self.parent_dir))
        folder_id = session["folders"][0]["folder_id"]
        self.chat_agent.queue(
            "恢复任务已准备好。",
            actions=[{"type": "restore_icons", "folder_ids": [folder_id]}],
        )
        pending = self.service.send_message(session["session_id"], "恢复图标")
        action_id = pending["pending_actions"][0]["action_id"]

        dismissed = self.service.dismiss_pending_action(session["session_id"], action_id)

        self.assertEqual(dismissed["pending_actions"], [])
        self.assertEqual(dismissed["messages"][-1]["role"], "system")
        self.assertIn("已取消待执行操作", dismissed["messages"][-1]["content"])

    def test_report_client_action_appends_summary_message(self):
        session = self.service.create_session(str(self.parent_dir))

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

        self.assertIn("成功 1，失败 1，跳过 1", updated["messages"][-1]["content"])
        self.assertEqual(len(updated["messages"][-1]["tool_results"]), 3)
        self.assertEqual(updated["messages"][-1]["tool_results"][0]["payload"]["status"], "applied")


if __name__ == "__main__":
    unittest.main()
