import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from file_pilot.api.main import create_app


class FakeIconWorkbenchService:
    def __init__(self):
        temp_root = Path.cwd() / "output" / "test-temp"
        temp_root.mkdir(parents=True, exist_ok=True)
        self.temp_dir = temp_root / f"icon-api-{uuid4().hex}"
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        self.image_path = self.temp_dir / "preview.png"
        self.last_message_payload = None
        self.last_report_payload = None
        self.deleted_sessions = []
        self.raise_delete_not_found = False
        self.templates = [
            {
                "template_id": "minimal_line",
                "name": "极简线稿",
                "description": "builtin",
                "prompt_template": "A {{subject}} icon",
                "is_builtin": True,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        ]
        self.icon_presets = [{"id": "default", "name": "默认图标生图"}]
        self.active_icon_preset_id = "default"
        self.image_path.write_bytes(
            b"\x89PNG\r\n\x1a\n"
            b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
            b"\x00\x00\x00\x0dIDATx\x9cc\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d"
            b"\x00\x00\x00\x00IEND\xaeB`\x82"
        )

    def close(self):
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def create_session(self, target_paths):
        return {"session_id": "icon-session", "target_paths": target_paths, "folders": [], "folder_count": 0, "ready_count": 0}

    def get_session(self, session_id):
        return {"session_id": session_id, "target_paths": ["D:/Icons/Alpha"], "folders": [], "folder_count": 0, "ready_count": 0}

    def list_sessions(self, limit=20):
        return {
            "sessions": [
                {
                    "session_id": "icon-session",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-02T08:30:00+00:00",
                    "target_count": 2,
                    "folder_count": 2,
                    "ready_count": 1,
                    "applied_count": 1,
                    "error_count": 0,
                    "target_paths": ["D:/Icons/Alpha", "D:/Icons/Beta"],
                    "last_action_type": "apply_icons",
                    "last_action_message": "应用图标已完成：成功 1，失败 0，跳过 0。",
                    "last_action_at": "2026-01-02T08:31:00+00:00",
                }
            ][:limit]
        }

    def delete_session(self, session_id):
        if self.raise_delete_not_found:
            raise FileNotFoundError(session_id)
        self.deleted_sessions.append(session_id)
        return {"status": "deleted", "session_id": session_id}

    def scan_session(self, session_id):
        return self.get_session(session_id)

    def update_session_targets(self, session_id, target_paths, mode):
        return {
            "session_id": session_id,
            "target_paths": target_paths,
            "folders": [],
            "folder_count": len(target_paths),
            "ready_count": 0,
            "mode": mode,
        }

    def remove_session_target(self, session_id, folder_id):
        return {
            "session_id": session_id,
            "target_paths": [],
            "folders": [],
            "folder_count": 0,
            "ready_count": 0,
            "removed_folder_id": folder_id,
        }

    def analyze_folders(self, session_id, folder_ids):
        return {"session_id": session_id, "folder_ids": folder_ids, "stage": "analyzed"}

    def generate_previews(self, session_id, folder_ids):
        return {"session_id": session_id, "folder_ids": folder_ids, "stage": "generated"}

    def update_folder_prompt(self, session_id, folder_id, prompt):
        return {"session_id": session_id, "folder_id": folder_id, "prompt": prompt}

    def select_version(self, session_id, folder_id, version_id):
        return {"session_id": session_id, "folder_id": folder_id, "version_id": version_id}

    def delete_version(self, session_id, folder_id, version_id):
        return {"session_id": session_id, "folder_id": folder_id, "deleted_version_id": version_id}

    def get_version_image_path(self, session_id, folder_id, version_id):
        return self.image_path

    def get_config(self):
        return {
            "config": {
                "name": "默认图标生图",
                "text_model": {"base_url": "https://text.example/v1", "api_key": "text", "model": "gpt-text"},
                "image_model": {"base_url": "https://image.example/v1", "api_key": "image", "model": "gpt-image"},
                "image_size": "512x512",
                "analysis_concurrency_limit": 1,
                "image_concurrency_limit": 1,
            },
            "presets": list(self.icon_presets),
            "active_preset_id": self.active_icon_preset_id,
        }

    def update_config(self, payload):
        return payload

    def switch_config_preset(self, preset_id):
        self.active_icon_preset_id = preset_id
        return self.get_config()

    def add_config_preset(self, name, config_patch=None):
        preset_id = "icon-preset-2"
        self.icon_presets.append({"id": preset_id, "name": name})
        self.active_icon_preset_id = preset_id
        return self.get_config()

    def delete_config_preset(self, preset_id):
        self.icon_presets = [item for item in self.icon_presets if item["id"] != preset_id]
        self.active_icon_preset_id = "default"
        return self.get_config()

    def list_templates(self):
        return list(self.templates)

    def create_template(self, payload):
        template = {
            "template_id": "user-template-1",
            "name": payload["name"],
            "description": payload.get("description", ""),
            "prompt_template": payload["prompt_template"],
            "is_builtin": False,
            "created_at": "2026-01-02T00:00:00+00:00",
            "updated_at": "2026-01-02T00:00:00+00:00",
        }
        self.templates.append(template)
        return template

    def update_template(self, template_id, payload):
        for item in self.templates:
            if item["template_id"] == template_id:
                item.update(payload)
                return item
        raise FileNotFoundError(template_id)

    def delete_template(self, template_id):
        before = len(self.templates)
        self.templates = [item for item in self.templates if item["template_id"] != template_id]
        if len(self.templates) == before:
            raise FileNotFoundError(template_id)
        return {"status": "ok", "template_id": template_id}

    def apply_template(self, session_id, template_id, folder_ids):
        return {"session_id": session_id, "template_id": template_id, "folder_ids": folder_ids, "stage": "template-applied"}

    def prepare_apply_ready(self, session_id, folder_ids):
        return {
            "session_id": session_id,
            "total": len(folder_ids),
            "ready_count": 1 if folder_ids else 0,
            "skipped_count": max(0, len(folder_ids) - 1),
            "tasks": [
                {
                    "folder_id": folder_ids[0],
                    "folder_name": "Alpha",
                    "folder_path": "D:/Icons/Alpha",
                    "version_id": "version-1",
                    "image_path": str(self.image_path),
                    "save_mode": "centralized",
                }
            ] if folder_ids else [],
            "skipped_items": [
                {
                    "folder_id": folder_id,
                    "folder_name": f"Folder-{index}",
                    "status": "skipped",
                    "message": "当前版本未就绪",
                }
                for index, folder_id in enumerate(folder_ids[1:], start=1)
            ],
        }

    def report_client_action(self, session_id, payload):
        self.last_report_payload = payload
        return {
            **self.get_session(session_id),
            "last_client_action": {
                "action_type": payload.get("action_type"),
                "summary": {
                    "success_count": 1,
                    "failed_count": 0,
                    "skipped_count": 1,
                    "message": "应用图标已完成：成功 1，失败 0，跳过 1。",
                },
                "results": list(payload.get("results", [])) + list(payload.get("skipped_items", [])),
                "updated_at": "2026-01-01T00:00:03+00:00",
            },
        }


class ApiIconWorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.fake_service = FakeIconWorkbenchService()
        self.app.state.icon_workbench_service = self.fake_service
        self.client = TestClient(self.app)

    def tearDown(self):
        self.fake_service.close()

    def test_create_session_route(self):
        response = self.client.post("/api/icon-workbench/sessions", json={"target_paths": ["D:/Icons/Alpha", "D:/Icons/Beta"]})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session_id"], "icon-session")
        self.assertEqual(response.json()["target_paths"], ["D:/Icons/Alpha", "D:/Icons/Beta"])

    def test_history_list_and_delete_session_routes(self):
        response = self.client.get("/api/icon-workbench/sessions")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["sessions"][0]["session_id"], "icon-session")
        self.assertEqual(payload["sessions"][0]["updated_at"], "2026-01-02T08:30:00+00:00")
        self.assertEqual(payload["sessions"][0]["target_paths"], ["D:/Icons/Alpha", "D:/Icons/Beta"])

        response = self.client.delete("/api/icon-workbench/sessions/icon-session")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "deleted", "session_id": "icon-session"})
        self.assertEqual(self.fake_service.deleted_sessions, ["icon-session"])

    def test_history_delete_missing_session_returns_not_found(self):
        self.fake_service.raise_delete_not_found = True

        response = self.client.delete("/api/icon-workbench/sessions/missing-session")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "ICON_SESSION_NOT_FOUND")

    def test_target_update_routes(self):
        response = self.client.post(
            "/api/icon-workbench/sessions/icon-session/targets",
            json={"target_paths": ["D:/Icons/Gamma"], "mode": "append"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mode"], "append")
        self.assertEqual(response.json()["target_paths"], ["D:/Icons/Gamma"])

        response = self.client.delete("/api/icon-workbench/sessions/icon-session/targets/folder-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["removed_folder_id"], "folder-1")

    def test_batch_routes_forward_folder_ids(self):
        response = self.client.post(
            "/api/icon-workbench/sessions/icon-session/analyze",
            json={"folder_ids": ["folder-1", "folder-2"]},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["folder_ids"], ["folder-1", "folder-2"])

        response = self.client.post(
            "/api/icon-workbench/sessions/icon-session/generate",
            json={"folder_ids": ["folder-1"]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["stage"], "generated")

    def test_prompt_select_and_config_routes(self):
        response = self.client.post(
            "/api/icon-workbench/sessions/icon-session/folders/folder-1/prompt",
            json={"prompt": "Custom prompt"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["prompt"], "Custom prompt")

        response = self.client.post(
            "/api/icon-workbench/sessions/icon-session/folders/folder-1/select-version",
            json={"version_id": "version-1"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["version_id"], "version-1")

        response = self.client.delete(
            "/api/icon-workbench/sessions/icon-session/folders/folder-1/versions/version-1"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted_version_id"], "version-1")

        response = self.client.get("/api/icon-workbench/config")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["config"]["image_size"], "512x512")

        response = self.client.post("/api/icon-workbench/config", json={"image_size": "1024x1024"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["image_size"], "1024x1024")

        response = self.client.post("/api/icon-workbench/config/presets", json={"name": "ModelScope"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["active_preset_id"], "icon-preset-2")

        response = self.client.post("/api/icon-workbench/config/presets/switch", json={"id": "default"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["active_preset_id"], "default")

        response = self.client.delete("/api/icon-workbench/config/presets/icon-preset-2")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["active_preset_id"], "default")

    def test_template_crud_routes(self):
        response = self.client.get("/api/icon-workbench/templates")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["templates"]), 1)

        response = self.client.post(
            "/api/icon-workbench/templates",
            json={
                "name": "项目模板",
                "description": "desc",
                "prompt_template": "Template {{subject}}",
            },
        )
        self.assertEqual(response.status_code, 200)
        created = response.json()["template"]
        self.assertEqual(created["name"], "项目模板")
        self.assertEqual(created["template_id"], "user-template-1")

        response = self.client.patch(
            "/api/icon-workbench/templates/user-template-1",
            json={
                "name": "项目模板-更新",
                "description": "updated",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["template"]["name"], "项目模板-更新")

        response = self.client.delete("/api/icon-workbench/templates/user-template-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_apply_template_and_apply_ready_routes(self):
        response = self.client.post(
            "/api/icon-workbench/sessions/icon-session/apply-template",
            json={
                "template_id": "minimal_line",
                "folder_ids": ["folder-1", "folder-2"],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["stage"], "template-applied")
        self.assertEqual(response.json()["folder_ids"], ["folder-1", "folder-2"])

        response = self.client.post(
            "/api/icon-workbench/sessions/icon-session/apply-ready",
            json={"folder_ids": ["folder-1", "folder-2"]},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 2)
        self.assertEqual(payload["ready_count"], 1)
        self.assertEqual(payload["tasks"][0]["folder_id"], "folder-1")
        self.assertEqual(payload["tasks"][0]["version_id"], "version-1")
        self.assertEqual(payload["skipped_items"][0]["folder_id"], "folder-2")

    def test_removed_chat_routes_return_not_found(self):
        response = self.client.post(
            "/api/icon-workbench/sessions/icon-session/messages",
            json={"content": "分析当前选中项"},
        )
        self.assertEqual(response.status_code, 404)

        response = self.client.post("/api/icon-workbench/sessions/icon-session/actions/action-1/confirm")
        self.assertEqual(response.status_code, 404)

        response = self.client.post("/api/icon-workbench/sessions/icon-session/actions/action-1/dismiss")
        self.assertEqual(response.status_code, 404)

    def test_report_route_keeps_client_summary(self):
        response = self.client.post(
            "/api/icon-workbench/sessions/icon-session/client-actions/report",
            json={
                "action_type": "apply_icons",
                "results": [
                    {
                        "folder_id": "folder-1",
                        "folder_name": "Alpha",
                        "folder_path": "D:/Icons/Alpha",
                        "version_id": "version-1",
                        "status": "applied",
                        "message": "已应用",
                    }
                ],
                "skipped_items": [
                    {
                        "folder_id": "folder-2",
                        "folder_name": "Beta",
                        "folder_path": "D:/Icons/Beta",
                        "status": "skipped",
                        "message": "当前版本未就绪",
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session"]["last_client_action"]["summary"]["success_count"], 1)
        self.assertEqual(self.fake_service.last_report_payload["action_type"], "apply_icons")
        self.assertEqual(self.fake_service.last_report_payload["results"][0]["version_id"], "version-1")
        self.assertEqual(self.fake_service.last_report_payload["skipped_items"][0]["status"], "skipped")

    def test_image_route_streams_png(self):
        response = self.client.get(
            "/api/icon-workbench/sessions/icon-session/folders/folder-1/versions/version-1/image"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/png")

    def test_events_route_returns_initial_snapshot(self):
        response = self.client.get(
            "/api/icon-workbench/sessions/icon-session/events",
            headers={"x-file-pilot-once": "1"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("event: icon.session.snapshot", response.text)


if __name__ == "__main__":
    unittest.main()
