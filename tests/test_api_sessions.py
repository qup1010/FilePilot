import json
import os
import shutil
import time
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from file_pilot.api.main import create_app
from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore
from file_pilot.execution.models import ExecutionJournal
from file_pilot.execution.service import delete_execution_journal, save_execution_journal


class HoldingScanner:
    def __init__(self):
        self.started: list[dict] = []

    def start(self, session_id, target_dir, run_scan, on_complete, on_error):
        self.started.append(
            {
                "session_id": session_id,
                "target_dir": target_dir,
                "run_scan": run_scan,
                "on_complete": on_complete,
                "on_error": on_error,
            }
        )

    def get_progress(self, session_id):
        return {"running": any(item["session_id"] == session_id for item in self.started)}

    def is_running(self, session_id):
        return any(item["session_id"] == session_id for item in self.started)


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

    @staticmethod
    def _plan_item_target_directory(snapshot: dict, source_relpath: str) -> str:
        plan = snapshot["plan_snapshot"]
        item = next(entry for entry in plan["items"] if entry["source_relpath"] == source_relpath)
        slot_id = str(item.get("target_slot_id") or "")
        if slot_id == "Review" or item.get("status") == "review":
            return "Review"
        if not slot_id:
            return ""
        slot = next((entry for entry in plan.get("target_slots", []) if entry.get("slot_id") == slot_id), None)
        return str(slot.get("relpath") or "") if slot else ""

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
        with mock.patch.dict(os.environ, {"FILE_PILOT_INSTANCE_ID": "desktop-instance"}):
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
                    "organize_mode": "incremental",
                    "destination_index_depth": 3,
                    "language": "en",
                    "density": "normal",
                    "prefix_style": "none",
                    "caution_level": "balanced",
                    "note": "票据优先归财务目录",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["session_snapshot"]["strategy"]["template_id"], "office_admin")
        self.assertEqual(payload["session_snapshot"]["strategy"]["template_label"], "办公事务")
        self.assertEqual(payload["session_snapshot"]["strategy"]["task_type"], "organize_into_existing")
        self.assertEqual(payload["session_snapshot"]["strategy"]["task_type_label"], "归入已有目录")
        self.assertEqual(payload["session_snapshot"]["strategy"]["organize_mode"], "incremental")
        self.assertEqual(payload["session_snapshot"]["strategy"]["destination_index_depth"], 3)
        self.assertEqual(payload["session_snapshot"]["strategy"]["note"], "票据优先归财务目录")

    def test_post_sessions_accepts_task_type_without_organize_mode(self):
        response = self.client.post(
            "/api/sessions",
            json={
                "target_dir": str(self.target_dir),
                "resume_if_exists": False,
                "strategy": {
                    "template_id": "office_admin",
                    "task_type": "organize_into_existing",
                    "destination_index_depth": 3,
                    "language": "en",
                    "density": "normal",
                    "prefix_style": "none",
                    "caution_level": "balanced",
                    "note": "票据优先归财务目录",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["session_snapshot"]["strategy"]["task_type"], "organize_into_existing")
        self.assertEqual(payload["session_snapshot"]["strategy"]["organize_mode"], "incremental")

    def test_post_sessions_rejects_conflicting_task_type_and_organize_mode(self):
        response = self.client.post(
            "/api/sessions",
            json={
                "target_dir": str(self.target_dir),
                "resume_if_exists": False,
                "strategy": {
                    "template_id": "office_admin",
                    "task_type": "organize_into_existing",
                    "organize_mode": "initial",
                    "destination_index_depth": 3,
                    "language": "en",
                    "density": "normal",
                    "prefix_style": "none",
                    "caution_level": "balanced",
                    "note": "票据优先归财务目录",
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error_code"], "TASK_TYPE_CONFLICT")

    def test_post_sessions_returns_resume_available_when_previous_session_exists(self):
        request_payload = {
            "sources": [{"source_type": "directory", "path": str(self.target_dir), "directory_mode": "contents"}],
            "resume_if_exists": False,
            "organize_method": "categorize_into_new_structure",
            "output_dir": str(self.target_dir),
            "strategy": {
                "template_id": "project_workspace",
                "organize_method": "categorize_into_new_structure",
                "language": "en",
                "density": "normal",
                "prefix_style": "none",
                "caution_level": "balanced",
                "note": "旧策略",
            },
        }
        created = self.client.post(
            "/api/sessions",
            json=request_payload,
        ).json()

        response = self.client.post(
            "/api/sessions",
            json={
                **request_payload,
                "resume_if_exists": True,
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["mode"], "resume_available")
        self.assertEqual(payload["restorable_session"]["session_id"], created["session_id"])
        self.assertEqual(payload["restorable_session"]["strategy"]["template_id"], "project_workspace")
        self.assertEqual(payload["restorable_session"]["strategy"]["note"], "旧策略")

    def test_post_sessions_creates_new_session_when_previous_scope_differs(self):
        base_payload = {
            "sources": [{"source_type": "directory", "path": str(self.target_dir), "directory_mode": "contents"}],
            "resume_if_exists": False,
            "organize_method": "categorize_into_new_structure",
            "output_dir": str(self.target_dir),
            "strategy": {
                "template_id": "project_workspace",
                "organize_method": "categorize_into_new_structure",
                "language": "en",
                "density": "normal",
                "prefix_style": "none",
                "caution_level": "balanced",
                "note": "旧策略",
            },
        }
        created = self.client.post("/api/sessions", json=base_payload).json()

        response = self.client.post(
            "/api/sessions",
            json={
                **base_payload,
                "resume_if_exists": True,
                "strategy": {
                    **base_payload["strategy"],
                    "template_id": "study_materials",
                    "language": "zh",
                    "caution_level": "conservative",
                    "note": "新策略",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["mode"], "created")
        self.assertNotEqual(payload["session_id"], created["session_id"])
        self.assertEqual(self.store.load(created["session_id"]).stage, "abandoned")

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

    def test_delete_history_endpoint_returns_409_for_active_locked_session(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "executing"
        self.store.save(session)
        self.service._mark_locked_stage_active(session.session_id, "executing")

        try:
            response = self.client.delete(f"/api/history/{session.session_id}")
        finally:
            self.service._mark_locked_stage_inactive(session.session_id, "executing")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "SESSION_LOCKED")
        self.assertIsNotNone(self.store.load(session.session_id))

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

    def test_delete_history_endpoint_returns_409_for_active_rolling_back_execution_journal(self):
        journal = ExecutionJournal(
            execution_id="exec-active-rollback-api",
            target_dir=str(self.target_dir.resolve()),
            created_at="2025-01-01T00:00:00+00:00",
            status="completed",
            items=[],
        )
        save_execution_journal(journal)
        self.service._mark_locked_stage_active(journal.execution_id, "rolling_back")

        try:
            response = self.client.delete(f"/api/history/{journal.execution_id}")
        finally:
            self.service._mark_locked_stage_inactive(journal.execution_id, "rolling_back")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "SESSION_LOCKED")
        delete_execution_journal(journal.execution_id)

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

    def test_refresh_endpoint_returns_scan_empty_result_with_snapshot(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        with mock.patch.object(self.service, "refresh_session", side_effect=RuntimeError("scan_empty_result")):
            response = self.client.post(f"/api/sessions/{created['session_id']}/refresh")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error_code"], "SCAN_EMPTY_RESULT")

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
        self.assertEqual(response.json()["session_snapshot"]["stage"], "scanning")
        self.assertNotIn("interrupted_during", response.json()["session_snapshot"]["integrity_flags"])

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
        updated_item = next(item for item in snapshot["plan_snapshot"]["items"] if item["source_relpath"] == "md")
        self.assertNotIn("target_relpath", updated_item)
        self.assertEqual(self._plan_item_target_directory(snapshot, "md"), "Study")
        self.assertEqual(snapshot["plan_snapshot"]["unresolved_items"], [])

    def test_update_item_accepts_target_slot_and_returns_structured_snapshot(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "md | file | 学习资料 | 笔记"
        session.incremental_selection = {
            "required": True,
            "status": "ready",
            "destination_index_depth": 2,
            "root_directory_options": ["Docs", "Inbox"],
            "target_directories": ["Docs"],
            "target_directory_tree": [{"relpath": "Docs", "name": "Docs", "children": []}],
            "pending_items_count": 1,
            "source_scan_completed": True,
        }
        session.pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md"}],
            "unresolved_items": ["md"],
            "summary": "needs review",
        }
        self.store.save(session)

        response = self.client.post(
            f"/api/sessions/{session.session_id}/update-item",
            json={"item_id": "md", "target_slot": "D001", "move_to_review": False},
        )

        self.assertEqual(response.status_code, 200)
        snapshot = response.json()["session_snapshot"]
        updated_item = next(item for item in snapshot["plan_snapshot"]["items"] if item["source_relpath"] == "md")
        self.assertNotIn("target_relpath", updated_item)
        self.assertEqual(updated_item["target_slot_id"], "D001")
        self.assertEqual(self._plan_item_target_directory(snapshot, "md"), "Docs")

    def test_restore_ai_suggestion_endpoint_restores_original_mapping(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "md | file | 学习资料 | 笔记"
        session.incremental_selection = {
            "required": True,
            "status": "ready",
            "destination_index_depth": 2,
            "root_directory_options": ["Docs", "Inbox"],
            "target_directories": ["Docs"],
            "target_directory_tree": [{"relpath": "Docs", "name": "Docs", "children": []}],
            "pending_items_count": 1,
            "source_scan_completed": True,
        }
        session.pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md"}],
            "unresolved_items": ["md"],
            "summary": "needs review",
        }
        self.store.save(session)

        update_response = self.client.post(
            f"/api/sessions/{session.session_id}/update-item",
            json={"item_id": "md", "target_slot": "D001", "move_to_review": False},
        )
        self.assertEqual(update_response.status_code, 200)
        updated_item = next(
            item for item in update_response.json()["session_snapshot"]["plan_snapshot"]["items"] if item["source_relpath"] == "md"
        )
        self.assertTrue(updated_item["can_restore_ai_suggestion"])
        self.assertEqual(updated_item["original_target_slot_id"], "Review")
        self.assertEqual(updated_item["original_status"], "unresolved")

        restore_response = self.client.post(
            f"/api/sessions/{session.session_id}/restore-ai-suggestion",
            json={"item_id": "md"},
        )

        self.assertEqual(restore_response.status_code, 200)
        snapshot = restore_response.json()["session_snapshot"]
        restored_item = next(item for item in snapshot["plan_snapshot"]["items"] if item["source_relpath"] == "md")
        self.assertEqual(restored_item["target_slot_id"], "Review")
        self.assertEqual(restored_item["mapping_status"], "unresolved")
        self.assertFalse(restored_item["user_overridden"])
        self.assertFalse(restored_item["can_restore_ai_suggestion"])

    def test_restore_ai_suggestion_endpoint_returns_409_without_original_mapping(self):
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
            f"/api/sessions/{session.session_id}/restore-ai-suggestion",
            json={"item_id": "md"},
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error_code"], "AI_SUGGESTION_NOT_FOUND")

    def test_update_item_rejects_target_dir_that_escapes_new_root(self):
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
            json={"item_id": "md", "target_dir": "../Outside", "move_to_review": False},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error_code"], "TARGET_DIR_OUTSIDE_ROOT")

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

    def test_apply_target_conflict_suggestions_endpoint_updates_plan_and_reruns_precheck(self):
        (self.target_dir / "alpha").mkdir()
        (self.target_dir / "beta").mkdir()
        (self.target_dir / "alpha" / "report.pdf").write_text("alpha", encoding="utf-8")
        (self.target_dir / "beta" / "report.pdf").write_text("beta", encoding="utf-8")
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "planning"
        session.planner_items = [
            {
                "planner_id": "F001",
                "source_relpath": "alpha/report.pdf",
                "display_name": "report.pdf",
                "entry_type": "file",
            },
            {
                "planner_id": "F002",
                "source_relpath": "beta/report.pdf",
                "display_name": "report.pdf",
                "entry_type": "file",
            },
        ]
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [
                {"source": "alpha/report.pdf", "target": "Docs/report.pdf"},
                {"source": "beta/report.pdf", "target": "Docs/report.pdf"},
            ],
            "unresolved_items": [],
            "summary": "move reports",
        }
        self.store.save(session)

        precheck = self.client.post(f"/api/sessions/{session.session_id}/precheck")
        response = self.client.post(f"/api/sessions/{session.session_id}/apply-target-conflict-suggestions")

        self.assertEqual(precheck.status_code, 200)
        # 重名只跳过后来者：预检直接放行到 ready_to_execute，改名建议仍可应用
        self.assertEqual(precheck.json()["session_snapshot"]["stage"], "ready_to_execute")
        self.assertTrue(precheck.json()["session_snapshot"]["precheck_summary"]["can_execute"])
        self.assertEqual(response.status_code, 200)
        snapshot = response.json()["session_snapshot"]
        self.assertEqual(snapshot["stage"], "ready_to_execute")
        self.assertTrue(snapshot["precheck_summary"]["can_execute"])
        targets = [move["target"] for move in snapshot["precheck_summary"]["move_preview"]]
        self.assertEqual(targets, ["Docs/report.pdf", "Docs/report (2).pdf"])

    def test_apply_target_conflict_suggestions_endpoint_returns_409_without_suggestions(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "planning"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "md", "target": "Docs/md"}],
            "unresolved_items": [],
            "summary": "move docs",
        }
        self.store.save(session)

        response = self.client.post(f"/api/sessions/{session.session_id}/apply-target-conflict-suggestions")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error_code"], "TARGET_CONFLICT_SUGGESTIONS_NOT_FOUND")

    def test_precheck_endpoint_returns_409_for_stale_session(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "stale"
        session.integrity_flags["is_stale"] = True
        self.store.save(session)

        response = self.client.post(f"/api/sessions/{session.session_id}/precheck")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error_code"], "SESSION_STAGE_CONFLICT")
        self.assertEqual(response.json()["session_snapshot"]["stage"], "stale")

    def test_rollback_endpoint_returns_404_when_session_missing(self):
        response = self.client.post("/api/sessions/missing-session-id/rollback", json={"confirm": True})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "SESSION_NOT_FOUND")

    def test_rollback_endpoint_returns_409_when_session_is_locked(self):
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
        execute = self.client.post(f"/api/sessions/{session.session_id}/execute", json={"confirm": True})
        self.assertEqual(execute.status_code, 200)
        lock_result = self.store.acquire_directory_lock(self.target_dir, "other-session")
        self.assertTrue(lock_result.acquired)

        response = self.client.post(f"/api/sessions/{session.session_id}/rollback", json={"confirm": True})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error_code"], "SESSION_LOCKED")

    def test_rollback_endpoint_returns_precheck_when_confirmation_is_false(self):
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

        execute = self.client.post(f"/api/sessions/{session.session_id}/execute", json={"confirm": True})
        self.assertEqual(execute.status_code, 200)

        rollback = self.client.post(f"/api/sessions/{session.session_id}/rollback", json={"confirm": False})

        self.assertEqual(rollback.status_code, 200)
        payload = rollback.json()
        self.assertIn("rollback_precheck", payload)
        self.assertTrue(payload["rollback_precheck"]["can_execute"])
        self.assertEqual(len(payload["rollback_precheck"]["actions"]), 2)

    def test_rollback_endpoint_accepts_execution_id_from_history(self):
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

        execute = self.client.post(f"/api/sessions/{session.session_id}/execute", json={"confirm": True})
        execution_id = execute.json()["session_snapshot"]["execution_report"]["execution_id"]

        rollback = self.client.post(f"/api/sessions/{execution_id}/rollback", json={"confirm": True})

        self.assertEqual(rollback.status_code, 200)
        self.assertEqual(rollback.json()["session_snapshot"]["stage"], "stale")
        self.assertEqual(
            rollback.json()["session_snapshot"]["rollback_report"]["restored_from_execution_id"],
            execution_id,
        )
        self.assertTrue((self.target_dir / "a.txt").exists())
        self.assertFalse((self.target_dir / "Docs" / "a.txt").exists())

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

    def test_return_to_planning_endpoint_returns_409_for_empty_completed_session(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "completed"
        session.integrity_flags["empty_scan_result"] = True
        self.store.save(session)

        response = self.client.post(f"/api/sessions/{session.session_id}/return-to-planning")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error_code"], "SESSION_STAGE_CONFLICT")
        self.assertEqual(response.json()["session_snapshot"]["stage"], "completed")

    def test_scan_endpoint_can_restart_empty_completed_session(self):
        scanner = HoldingScanner()
        service = OrganizerSessionService(self.store, scanner=scanner)
        client = TestClient(create_app(service))
        created = client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "completed"
        session.integrity_flags["empty_scan_result"] = True
        session.summary = "当前目录为空，无需整理"
        self.store.save(session)

        response = client.post(f"/api/sessions/{session.session_id}/scan")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session_snapshot"]["stage"], "scanning")
        self.assertEqual(response.json()["session_snapshot"]["scanner_progress"]["status"], "running")
        self.assertEqual(scanner.started[0]["session_id"], session.session_id)

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
        session.updated_at = "2000-01-01T00:00:00+00:00"
        self.store.save(session)

        with mock.patch.object(self.service.lifecycle, "_scanning_session_recently_active", return_value=False):
            response = self.client.get("/api/history")

        self.assertEqual(response.status_code, 200)
        matched = next(item for item in response.json() if item["execution_id"] == created["session_id"])
        self.assertEqual(matched["status"], "interrupted")
        self.assertTrue(matched["is_session"])

    def test_history_search_endpoint_delegates_to_service(self):
        with mock.patch.object(self.service, "search_file_history") as search_mock:
            search_mock.return_value = {"query": "invoice", "total": 1, "matches": [{"display_name": "invoice.pdf"}]}
            response = self.client.get("/api/history/search", params={"q": "invoice", "limit": 10})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 1)
        search_mock.assert_called_once_with("invoice", limit=10)

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
            headers={"x-file-pilot-once": "1"},
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

    def test_scan_endpoint_starts_multi_source_scan_asynchronously(self):
        source_a = self.root / "source_a.txt"
        source_b = self.root / "nested" / "source_b.txt"
        source_b.parent.mkdir(parents=True, exist_ok=True)
        source_a.write_text("A", encoding="utf-8")
        source_b.write_text("B", encoding="utf-8")
        scanner = HoldingScanner()
        service = OrganizerSessionService(self.store, scanner=scanner)
        client = TestClient(create_app(service))
        created = service.create_session(
            [
                {"source_type": "file", "path": str(source_a)},
                {"source_type": "file", "path": str(source_b)},
            ],
            resume_if_exists=False,
            organize_method="categorize_into_new_structure",
            output_dir=str(self.target_dir),
        )
        self.store.save(created.session)

        response = client.post(f"/api/sessions/{created.session.session_id}/scan")

        self.assertEqual(response.status_code, 200)
        snapshot = response.json()["session_snapshot"]
        self.assertEqual(snapshot["stage"], "scanning")
        self.assertEqual(snapshot["scanner_progress"]["status"], "running")
        self.assertEqual(snapshot["scanner_progress"]["total_count"], 2)
        self.assertEqual(snapshot["scanner_progress"]["processed_count"], 0)
        self.assertEqual(len(scanner.started), 1)

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

    def test_messages_endpoint_returns_409_for_empty_completed_session(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()
        session = self.store.load(created["session_id"])
        assert session is not None
        session.stage = "completed"
        session.integrity_flags["empty_scan_result"] = True
        self.store.save(session)

        response = self.client.post(
            f"/api/sessions/{session.session_id}/messages",
            json={"content": "继续整理"},
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error_code"], "SESSION_STAGE_CONFLICT")
        self.assertEqual(response.json()["session_snapshot"]["stage"], "completed")

    def test_confirm_targets_endpoint_returns_updated_snapshot(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        with mock.patch.object(self.service, "confirm_target_directories") as confirm_target_directories:
            confirm_target_directories.return_value = mock.Mock(
                assistant_message={"role": "assistant", "content": "已生成方案"},
                session_snapshot={"stage": "planning"},
            )

            response = self.client.post(
                f"/api/sessions/{created['session_id']}/confirm-targets",
                json={"selected_target_dirs": ["Docs"]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["assistant_message"]["content"], "已生成方案")

    def test_incremental_selection_endpoint_returns_updated_snapshot(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        with mock.patch.object(self.service, "confirm_target_directories") as confirm_target_directories:
            confirm_target_directories.return_value = mock.Mock(
                assistant_message={"role": "assistant", "content": "已生成方案"},
                session_snapshot={"stage": "planning"},
            )

            response = self.client.post(
                f"/api/sessions/{created['session_id']}/incremental-selection",
                json={"selected_target_dirs": ["Docs"]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["assistant_message"]["content"], "已生成方案")

    def test_confirm_targets_endpoint_returns_409_for_empty_selection(self):
        created = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        with mock.patch.object(self.service, "confirm_target_directories", side_effect=RuntimeError("INCREMENTAL_TARGETS_EMPTY")):
            response = self.client.post(
                f"/api/sessions/{created['session_id']}/confirm-targets",
                json={"selected_target_dirs": []},
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error_code"], "INCREMENTAL_TARGETS_EMPTY")

    def test_unresolved_resolutions_endpoint_is_removed(self):
        response = self.client.post(
            "/api/sessions/session-legacy/unresolved-resolutions",
            json={"request_id": "req_1", "resolutions": []},
        )

        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
