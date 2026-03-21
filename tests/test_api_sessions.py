import json
import os
import shutil
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from file_organizer.api.main import create_app
from file_organizer.app.session_service import OrganizerSessionService
from file_organizer.app.session_store import SessionStore


class SessionApiTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_api")
        self.target_dir = self.root / "Inbox"
        self.target_dir.mkdir(parents=True, exist_ok=True)
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)
        self.client = TestClient(create_app(self.service))

    def tearDown(self):
        if self.root.exists():
            shutil.rmtree(self.root)

    def test_health_endpoint_returns_ok(self):
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_cors_preflight_allows_frontend_origin_for_session_creation(self):
        response = self.client.options(
            "/api/sessions",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://127.0.0.1:3000")
        self.assertIn("POST", response.headers["access-control-allow-methods"])

    def test_health_endpoint_returns_instance_id_when_present(self):
        with mock.patch.dict(os.environ, {"FILE_ORGANIZER_INSTANCE_ID": "desktop-instance"}):
            client = TestClient(create_app(self.service))
            response = client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["instance_id"], "desktop-instance")

    def test_post_sessions_returns_created_mode_and_snapshot(self):
        response = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["mode"], "created")
        self.assertEqual(payload["session_snapshot"]["stage"], "draft")

    def test_post_sessions_returns_resume_available_when_previous_session_exists(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        response = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": True},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["mode"], "resume_available")
        self.assertEqual(payload["restorable_session"]["session_id"], created["session_id"])

    def test_get_session_returns_snapshot(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        response = self.client.get(f"/api/sessions/{created['session_id']}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session_id"], created["session_id"])

    def test_resume_endpoint_returns_stale_snapshot_when_directory_changed(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "a.txt | 文档 | A"
        self.store.save(session)
        (self.target_dir / "b.txt").write_text("new", encoding="utf-8")

        response = self.client.post(f"/api/sessions/{session.session_id}/resume")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["stage"], "stale")

    def test_refresh_endpoint_returns_updated_snapshot(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        with mock.patch.object(self.service, "refresh_session") as refresh_session:
            refresh_session.return_value = mock.Mock(session_snapshot={"stage": "planning"})
            response = self.client.post(f"/api/sessions/{created['session_id']}/refresh")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session_snapshot"]["stage"], "planning")

    def test_update_item_returns_409_when_session_is_scanning(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "scanning"
        self.store.save(session)

        response = self.client.post(
            f"/api/sessions/{session.session_id}/update-item",
            json={"item_id": "a.txt", "target_dir": "Review", "move_to_review": False},
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error_code"], "SESSION_STAGE_CONFLICT")
        self.assertEqual(response.json()["session_snapshot"]["stage"], "scanning")

    def test_precheck_execute_and_rollback_endpoints_use_session_snapshot(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "planning"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)

        precheck = self.client.post(f"/api/sessions/{session.session_id}/precheck")
        execute = self.client.post(f"/api/sessions/{session.session_id}/execute", json={"confirm": True})
        rollback = self.client.post(f"/api/sessions/{session.session_id}/rollback", json={"confirm": True})

        self.assertEqual(precheck.status_code, 200)
        self.assertEqual(precheck.json()["session_snapshot"]["stage"], "ready_to_execute")
        self.assertEqual(execute.status_code, 200)
        self.assertEqual(execute.json()["session_snapshot"]["stage"], "completed")
        self.assertEqual(rollback.status_code, 200)
        self.assertEqual(rollback.json()["session_snapshot"]["stage"], "stale")

    def test_journal_endpoint_returns_summary(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "ready_to_execute"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)
        self.service.execute(session.session_id, confirm=True)

        response = self.client.get(f"/api/sessions/{session.session_id}/journal")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")
        self.assertEqual(response.json()["item_count"], 2)

    def test_cleanup_endpoint_returns_session_snapshot_and_count(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        with mock.patch.object(self.service, "cleanup_empty_dirs") as cleanup_empty_dirs:
            cleanup_empty_dirs.return_value = {
                "session_id": created["session_id"],
                "cleaned_count": 1,
                "session_snapshot": {"stage": "completed"},
            }
            response = self.client.post(f"/api/sessions/{created['session_id']}/cleanup-empty-dirs")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["cleaned_count"], 1)
        self.assertEqual(response.json()["session_snapshot"]["stage"], "completed")

    def test_events_endpoint_uses_sse_content_type_and_json_payload(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        response = self.client.get(f"/api/sessions/{created['session_id']}/events")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: session.snapshot", response.text)
        payload_line = next(line for line in response.text.splitlines() if line.startswith("data: "))
        payload = json.loads(payload_line[len("data: "):])
        self.assertEqual(payload["session_snapshot"]["session_id"], created["session_id"])

    def test_scan_endpoint_returns_updated_snapshot(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        with mock.patch.object(self.service, "start_scan") as start_scan:
            session = self.store.load(created["session_id"])
            assert session is not None
            session.stage = "planning"
            self.store.save(session)
            start_scan.return_value = session

            response = self.client.post(f"/api/sessions/{created['session_id']}/scan")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session_id"], created["session_id"])

    def test_messages_endpoint_returns_assistant_message(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        with mock.patch.object(self.service, "submit_user_intent") as submit_user_intent:
            submit_user_intent.return_value = mock.Mock(
                assistant_message={"role": "assistant", "content": "已调整"},
                session_snapshot={"stage": "planning"},
            )

            response = self.client.post(
                f"/api/sessions/{created['session_id']}/messages",
                json={"content": "放到文档"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["assistant_message"]["content"], "已调整")


if __name__ == "__main__":
    unittest.main()
