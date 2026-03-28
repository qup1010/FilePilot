import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from file_organizer.api.main import create_app


class FakeIconWorkbenchService:
    def __init__(self):
        temp_root = Path.cwd() / "output" / "test-temp"
        temp_root.mkdir(parents=True, exist_ok=True)
        self.temp_dir = temp_root / f"icon-api-{uuid4().hex}"
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        self.image_path = self.temp_dir / "preview.png"
        self.last_message_payload = None
        self.last_report_payload = None
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

    def get_version_image_path(self, session_id, folder_id, version_id):
        return self.image_path

    def get_config(self):
        return {
            "text_model": {"base_url": "https://text.example/v1", "api_key": "text", "model": "gpt-text"},
            "image_model": {"base_url": "https://image.example/v1", "api_key": "image", "model": "gpt-image"},
            "image_size": "512x512",
            "concurrency_limit": 1,
        }

    def update_config(self, payload):
        return payload

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
                    "image_path": str(self.image_path),
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

    def send_message(self, session_id, content, *, selected_folder_ids=None, active_folder_id=None):
        self.last_message_payload = {
            "session_id": session_id,
            "content": content,
            "selected_folder_ids": list(selected_folder_ids or []),
            "active_folder_id": active_folder_id,
        }
        return {
            "session_id": session_id,
            "target_paths": ["D:/Icons/Alpha"],
            "folders": [],
            "folder_count": 0,
            "ready_count": 0,
            "messages": [
                {"message_id": "m1", "role": "user", "content": content, "tool_results": [], "action_ids": [], "created_at": "2026-01-01T00:00:00+00:00"},
                {
                    "message_id": "m2",
                    "role": "assistant",
                    "content": "已记录消息。",
                    "tool_results": [],
                    "action_ids": [],
                    "created_at": "2026-01-01T00:00:01+00:00",
                },
            ],
            "pending_actions": [],
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:01+00:00",
            "chat_updated_at": "2026-01-01T00:00:01+00:00",
        }

    def confirm_pending_action(self, session_id, action_id):
        return {
            "session": self.get_session(session_id),
            "client_execution": {
                "command": "apply_ready_icons",
                "action_type": "apply_icons",
                "tasks": [
                    {
                        "folder_id": "folder-1",
                        "folder_name": "Alpha",
                        "folder_path": "D:/Icons/Alpha",
                        "image_path": str(self.image_path),
                    }
                ],
                "skipped_items": [],
            },
        }

    def dismiss_pending_action(self, session_id, action_id):
        return {
            **self.get_session(session_id),
            "messages": [
                {
                    "message_id": "dismiss-1",
                    "role": "system",
                    "content": f"已取消待执行操作：{action_id}",
                    "tool_results": [],
                    "action_ids": [],
                    "created_at": "2026-01-01T00:00:02+00:00",
                }
            ],
            "pending_actions": [],
            "chat_updated_at": "2026-01-01T00:00:02+00:00",
        }

    def report_client_action(self, session_id, payload):
        self.last_report_payload = payload
        return {
            **self.get_session(session_id),
            "messages": [
                {
                    "message_id": "report-1",
                    "role": "assistant",
                    "content": "应用图标已完成：成功 1，失败 0，跳过 1。",
                    "tool_results": [],
                    "action_ids": [],
                    "created_at": "2026-01-01T00:00:03+00:00",
                }
            ],
            "pending_actions": [],
            "chat_updated_at": "2026-01-01T00:00:03+00:00",
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

        response = self.client.get("/api/icon-workbench/config")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["image_size"], "512x512")

        response = self.client.post("/api/icon-workbench/config", json={"image_size": "1024x1024"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["image_size"], "1024x1024")

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
        self.assertEqual(payload["skipped_items"][0]["folder_id"], "folder-2")

    def test_message_route_forwards_selection_context(self):
        response = self.client.post(
            "/api/icon-workbench/sessions/icon-session/messages",
            json={
                "content": "分析当前选中项",
                "selected_folder_ids": ["folder-1", "folder-2"],
                "active_folder_id": "folder-2",
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["session"]["session_id"], "icon-session")
        self.assertEqual(self.fake_service.last_message_payload["selected_folder_ids"], ["folder-1", "folder-2"])
        self.assertEqual(self.fake_service.last_message_payload["active_folder_id"], "folder-2")

    def test_confirm_dismiss_and_report_routes(self):
        response = self.client.post("/api/icon-workbench/sessions/icon-session/actions/action-1/confirm")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["client_execution"]["command"], "apply_ready_icons")

        response = self.client.post("/api/icon-workbench/sessions/icon-session/actions/action-1/dismiss")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session"]["messages"][0]["role"], "system")

        response = self.client.post(
            "/api/icon-workbench/sessions/icon-session/client-actions/report",
            json={
                "action_type": "apply_icons",
                "results": [
                    {
                        "folder_id": "folder-1",
                        "folder_name": "Alpha",
                        "folder_path": "D:/Icons/Alpha",
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
        self.assertEqual(response.json()["session"]["messages"][0]["role"], "assistant")
        self.assertEqual(self.fake_service.last_report_payload["action_type"], "apply_icons")
        self.assertEqual(self.fake_service.last_report_payload["skipped_items"][0]["status"], "skipped")

    def test_image_route_streams_png(self):
        response = self.client.get(
            "/api/icon-workbench/sessions/icon-session/folders/folder-1/versions/version-1/image"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/png")


if __name__ == "__main__":
    unittest.main()
