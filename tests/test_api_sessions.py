import json
import os
import shutil
import time
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from file_organizer.api.main import create_app
from file_organizer.app.session_service import OrganizerSessionService
from file_organizer.app.session_store import SessionStore
from file_organizer.execution.models import ExecutionJournal
from file_organizer.execution.service import save_execution_journal


class SessionApiTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_api")
        if self.root.exists():
            shutil.rmtree(self.root)
        self.target_dir = self.root / "Inbox"
        self.target_dir.mkdir(parents=True, exist_ok=True)
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)
        self.client = TestClient(create_app(self.service))

    def tearDown(self):
        if self.root.exists():
            last_error = None
            for _ in range(5):
                try:
                    shutil.rmtree(self.root)
                    return
                except PermissionError as exc:
                    last_error = exc
                    time.sleep(0.1)
            if last_error is not None:
                raise last_error

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

    def test_post_sessions_returns_422_when_target_dir_is_missing(self):
        response = self.client.post("/api/sessions", json={})

        self.assertEqual(response.status_code, 422)
        self.assertTrue(any(item["loc"][-1] == "target_dir" for item in response.json()["detail"]))

    def test_post_sessions_returns_created_mode_and_snapshot(self):
        response = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["mode"], "created")
        self.assertEqual(payload["session_snapshot"]["stage"], "draft")

    def test_post_sessions_accepts_strategy_payload_and_returns_strategy_snapshot(self):
        response = self.client.post(
            "/api/sessions",
            json={
                "target_dir": str(self.target_dir),
                "resume_if_exists": False,
                "strategy": {
                    "template_id": "office_admin",
                    "naming_style": "en",
                    "caution_level": "balanced",
                    "note": "票据优先归财务目录",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["session_snapshot"]["strategy"]["template_id"], "office_admin")
        self.assertEqual(payload["session_snapshot"]["strategy"]["template_label"], "办公事务")
        self.assertEqual(payload["session_snapshot"]["strategy"]["note"], "票据优先归财务目录")

    def test_post_sessions_returns_resume_available_when_previous_session_exists(self):
        created = self.client.post(
            "/api/sessions",
            json={
                "target_dir": str(self.target_dir),
                "resume_if_exists": False,
                "strategy": {
                    "template_id": "project_workspace",
                    "naming_style": "en",
                    "caution_level": "balanced",
                    "note": "旧策略",
                },
            },
        ).json()

        response = self.client.post(
            "/api/sessions",
            json={
                "target_dir": str(self.target_dir),
                "resume_if_exists": True,
                "strategy": {
                    "template_id": "study_materials",
                    "naming_style": "zh",
                    "caution_level": "conservative",
                    "note": "新策略不应覆盖旧会话",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["mode"], "resume_available")
        self.assertEqual(payload["restorable_session"]["session_id"], created["session_id"])
        self.assertEqual(payload["restorable_session"]["strategy"]["template_id"], "project_workspace")
        self.assertEqual(payload["restorable_session"]["strategy"]["note"], "旧策略")

    def test_post_sessions_allows_new_creation_when_previous_session_completed(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "completed"
        self.store.save(session)

        response = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["mode"], "created")
        self.assertNotEqual(payload["session_id"], created["session_id"])

    def test_get_session_returns_snapshot(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        response = self.client.get(f"/api/sessions/{created['session_id']}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["session_id"], created["session_id"])
        self.assertEqual(payload["session_snapshot"]["session_id"], created["session_id"])
        self.assertEqual(payload["session_snapshot"]["stage"], "draft")

    def test_delete_history_endpoint_removes_session_entry(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        response = self.client.delete(f"/api/history/{created['session_id']}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["entry_type"], "session")
        self.assertIsNone(self.store.load(created["session_id"]))

    def test_delete_history_endpoint_removes_execution_entry(self):
        journal = ExecutionJournal(
            execution_id="exec-delete-1",
            target_dir=str(self.target_dir.resolve()),
            created_at="2025-01-01T00:00:00+00:00",
            status="completed",
            items=[],
        )
        save_execution_journal(journal)

        response = self.client.delete("/api/history/exec-delete-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["entry_type"], "execution")

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
        payload = response.json()
        self.assertEqual(payload["session_id"], session.session_id)
        self.assertEqual(payload["session_snapshot"]["session_id"], session.session_id)
        self.assertEqual(payload["session_snapshot"]["stage"], "stale")

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

    def test_update_item_returns_422_when_item_id_is_missing(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        response = self.client.post(
            f"/api/sessions/{created['session_id']}/update-item",
            json={"target_dir": "Review", "move_to_review": False},
        )

        self.assertEqual(response.status_code, 422)
        self.assertTrue(any(item["loc"][-1] == "item_id" for item in response.json()["detail"]))

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
        self.assertEqual(response.json()["session_snapshot"]["stage"], "interrupted")
        self.assertEqual(response.json()["session_snapshot"]["integrity_flags"]["interrupted_during"], "scanning")

    def test_update_item_uses_target_dir_and_returns_updated_snapshot(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md"}],
            "unresolved_items": ["md"],
            "summary": "needs review",
        }
        self.store.save(session)

        response = self.client.post(
            f"/api/sessions/{session.session_id}/update-item",
            json={"item_id": "md", "target_dir": "Study", "move_to_review": False},
        )

        self.assertEqual(response.status_code, 200)
        snapshot = response.json()["session_snapshot"]
        updated_item = next(item for item in snapshot["plan_snapshot"]["items"] if item["item_id"] == "md")
        self.assertEqual(updated_item["target_relpath"], "Study/md")
        self.assertEqual(snapshot["plan_snapshot"]["unresolved_items"], [])

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

    def test_return_to_planning_endpoint_restores_ready_for_precheck_stage(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "ready_to_execute"
        session.scan_lines = "a.txt | 文档 | A"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        session.precheck_summary = {
            "can_execute": True,
            "blocking_errors": [],
            "warnings": [],
            "mkdir_preview": ["Docs"],
            "move_preview": [{"source": "a.txt", "target": "Docs/a.txt"}],
        }
        self.store.save(session)

        response = self.client.post(f"/api/sessions/{session.session_id}/return-to-planning")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session_snapshot"]["stage"], "ready_for_precheck")
        self.assertIsNone(response.json()["session_snapshot"]["precheck_summary"])

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

    def test_history_endpoint_includes_interrupted_session_after_restart_like_state(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "scanning"
        session.last_error = None
        self.store.save(session)

        response = self.client.get("/api/history")

        self.assertEqual(response.status_code, 200)
        matched = next(item for item in response.json() if item["execution_id"] == created["session_id"])
        self.assertEqual(matched["status"], "interrupted")
        self.assertTrue(matched["is_session"])

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

        with self.client.stream(
            "GET",
            f"/api/sessions/{created['session_id']}/events",
            headers={"x-file-organizer-once": "1"},
        ) as response:
            chunks = []
            for chunk in response.iter_text():
                if chunk:
                    chunks.append(chunk)
                if "data: " in "".join(chunks):
                    break
            body = "".join(chunks)

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: session.snapshot", body)
        payload_line = next(line for line in body.splitlines() if line.startswith("data: "))
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

    def test_messages_endpoint_returns_422_when_content_is_missing(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        response = self.client.post(
            f"/api/sessions/{created['session_id']}/messages",
            json={},
        )

        self.assertEqual(response.status_code, 422)
        self.assertTrue(any(item["loc"][-1] == "content" for item in response.json()["detail"]))

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

    def test_unresolved_resolutions_endpoint_returns_updated_snapshot(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        with mock.patch.object(self.service, "resolve_unresolved_choices") as resolve_unresolved_choices:
            resolve_unresolved_choices.return_value = mock.Mock(
                assistant_message={"role": "assistant", "content": ""},
                session_snapshot={"stage": "planning", "messages": []},
            )

            response = self.client.post(
                f"/api/sessions/{created['session_id']}/unresolved-resolutions",
                json={
                    "request_id": "req_1",
                    "resolutions": [{"item_id": "md", "selected_folder": "Review", "note": ""}],
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session_snapshot"]["stage"], "planning")

    def test_unresolved_resolutions_endpoint_returns_409_for_conflict(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        with mock.patch.object(self.service, "resolve_unresolved_choices", side_effect=RuntimeError("UNRESOLVED_ITEM_CONFLICT")):
            response = self.client.post(
                f"/api/sessions/{created['session_id']}/unresolved-resolutions",
                json={"request_id": "req_1", "resolutions": []},
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error_code"], "UNRESOLVED_ITEM_CONFLICT")


if __name__ == "__main__":
    unittest.main()
