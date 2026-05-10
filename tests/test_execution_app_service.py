import shutil
import time
import unittest
from pathlib import Path
from unittest import mock

from file_pilot.app.models import TaskState
from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore
from file_pilot.execution.models import ExecutionJournal
from file_pilot.execution.service import delete_execution_journal
from file_pilot.rollback.models import RollbackReport


class ExecutionAppServiceTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_execution_app_service")
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)
        self.target_dir = self.root / "Inbox"
        self.target_dir.mkdir(parents=True, exist_ok=True)
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)

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

    def test_run_precheck_via_execution_app_sets_ready_to_execute(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)

        result = self.service.execution_app.run_precheck(session.session_id)

        self.assertEqual(result.session_snapshot["stage"], "ready_to_execute")
        self.assertTrue(result.session_snapshot["precheck_summary"]["can_execute"])

    def test_run_precheck_uses_user_facing_review_labels(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "a.txt", "target": "Review/a.txt"}],
            "unresolved_items": [],
            "summary": "move to review",
        }
        self.store.save(session)

        result = self.service.execution_app.run_precheck(session.session_id)

        precheck = result.session_snapshot["precheck_summary"]
        self.assertTrue(any("待确认区" in item["message"] for item in precheck["issues"]))
        self.assertFalse(any("进入 Review" in item["message"] for item in precheck["issues"]))

    def test_run_precheck_warns_for_high_impact_project_files(self):
        (self.target_dir / "package-lock.json").write_text("{}", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.planner_items = [
            {
                "planner_id": "F001",
                "source_relpath": "package-lock.json",
                "display_name": "package-lock.json",
                "suggested_purpose": "工程锁文件",
                "summary": "Node.js 依赖锁文件",
                "entry_type": "file",
                "ext": "json",
                "parent_hint": "",
            }
        ]
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "package-lock.json", "target": "Docs/package-lock.json"}],
            "unresolved_items": [],
            "summary": "move lockfile",
        }
        self.store.save(session)

        result = self.service.execution_app.run_precheck(session.session_id)

        precheck = result.session_snapshot["precheck_summary"]
        self.assertTrue(precheck["can_execute"])
        self.assertTrue(any("高影响移动" in item for item in precheck["warnings"]))
        warning_issues = [item for item in precheck["issues"] if item["issue_type"] == "precheck_warning"]
        self.assertTrue(any("F001" in item["related_item_ids"] for item in warning_issues))

    def test_run_precheck_rejects_empty_completed_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "completed"
        session.integrity_flags["empty_scan_result"] = True
        self.store.save(session)

        with self.assertRaisesRegex(RuntimeError, "SESSION_STAGE_CONFLICT"):
            self.service.execution_app.run_precheck(session.session_id)

    def test_run_precheck_restores_initial_mode_target_slots_from_task_state(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_for_precheck"
        session.organize_mode = "initial"
        session.pending_plan = {
            "directories": ["学习资料"],
            "moves": [{"source": "a.txt", "target": "学习资料/a.txt"}],
            "unresolved_items": [],
            "summary": "move to study",
        }
        session.task_state = TaskState.from_dict({
            "sources": [
                {
                    "ref_id": "F001",
                    "display_name": "a.txt",
                    "entry_type": "file",
                    "origin": str(self.target_dir.resolve()),
                    "relpath": "a.txt",
                    "suggested_purpose": "学习资料",
                    "content_summary": "",
                    "confidence": None,
                    "ext": ".txt",
                }
            ],
            "targets": [
                {
                    "slot_id": "D003",
                    "display_name": "学习资料",
                    "real_path": str((self.target_dir / "学习资料").resolve()),
                    "children": [],
                    "depth": 0,
                    "is_new": True,
                }
            ],
            "mappings": [
                {
                    "source_ref_id": "F001",
                    "target_slot_id": "D003",
                    "status": "assigned",
                    "reason": "学习资料",
                    "confidence": None,
                    "user_overridden": False,
                }
            ],
            "strategy": {},
            "phase": "planning",
        })
        self.store.save(session)

        result = self.service.execution_app.run_precheck(session.session_id)

        self.assertEqual(result.session_snapshot["stage"], "ready_to_execute")
        self.assertTrue(result.session_snapshot["precheck_summary"]["can_execute"])
        self.assertEqual(
            result.session_snapshot["precheck_summary"]["move_preview"][0]["target"],
            "学习资料/a.txt",
        )

    def test_run_precheck_falls_back_to_task_target_when_registry_lookup_fails(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_for_precheck"
        session.organize_mode = "initial"
        session.pending_plan = {
            "directories": ["学习资料"],
            "moves": [{"source": "a.txt", "target": "学习资料/a.txt"}],
            "unresolved_items": [],
            "summary": "move to study",
        }
        session.task_state = TaskState.from_dict({
            "sources": [
                {
                    "ref_id": "F001",
                    "display_name": "a.txt",
                    "entry_type": "file",
                    "origin": str(self.target_dir.resolve()),
                    "relpath": "a.txt",
                    "suggested_purpose": "学习资料",
                    "content_summary": "",
                    "confidence": None,
                    "ext": ".txt",
                }
            ],
            "targets": [],
            "targets": [
                {
                    "slot_id": "D003",
                    "display_name": "学习资料",
                    "real_path": str((self.target_dir / "学习资料").resolve()),
                    "children": [],
                    "depth": 0,
                    "is_new": True,
                }
            ],
            "mappings": [
                {
                    "source_ref_id": "F001",
                    "target_slot_id": "D003",
                    "status": "assigned",
                    "reason": "学习资料",
                    "confidence": None,
                    "user_overridden": False,
                }
            ],
            "strategy": {},
            "phase": "planning",
        })
        self.store.save(session)

        with mock.patch(
            "file_pilot.app.id_registry.IdRegistry.resolve_target",
            side_effect=KeyError("D003"),
        ):
            result = self.service.execution_app.run_precheck(session.session_id)

        self.assertEqual(result.session_snapshot["stage"], "ready_to_execute")
        self.assertTrue(result.session_snapshot["precheck_summary"]["can_execute"])
        self.assertEqual(
            result.session_snapshot["precheck_summary"]["move_preview"][0]["target"],
            "学习资料/a.txt",
        )

    def test_execute_and_rollback_via_execution_app_updates_session_stages(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_to_execute"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)

        executed = self.service.execution_app.execute(session.session_id, confirm=True)
        rolled_back = self.service.execution_app.rollback(session.session_id, confirm=True)

        self.assertEqual(executed.session_snapshot["stage"], "completed")
        self.assertEqual(rolled_back.session_snapshot["stage"], "stale")
        self.assertTrue((self.target_dir / "a.txt").exists())

    def test_execute_marks_session_interrupted_when_execution_raises(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_to_execute"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)

        with mock.patch(
            "file_pilot.app.execution_app_service.execution_service.execute_plan",
            side_effect=RuntimeError("move failed"),
        ):
            with self.assertRaisesRegex(RuntimeError, "move failed"):
                self.service.execution_app.execute(session.session_id, confirm=True)

        reloaded = self.store.load(session.session_id)
        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        self.assertEqual(reloaded.stage, "interrupted")
        self.assertEqual(reloaded.last_error, "move failed")

    def test_rollback_releases_lock_and_marks_interrupted_when_rollback_raises(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_to_execute"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)
        self.service.execution_app.execute(session.session_id, confirm=True)

        with mock.patch(
            "file_pilot.app.execution_app_service.rollback_service.execute_rollback_plan",
            side_effect=RuntimeError("rollback failed"),
        ):
            with self.assertRaisesRegex(RuntimeError, "rollback failed"):
                self.service.execution_app.rollback(session.session_id, confirm=True)

        reloaded = self.store.load(session.session_id)
        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        self.assertEqual(reloaded.stage, "interrupted")
        self.assertEqual(reloaded.last_error, "rollback failed")
        lock_result = self.store.acquire_directory_lock(self.target_dir, "new-owner")
        self.assertTrue(lock_result.acquired)

    def test_rollback_releases_lock_when_latest_journal_is_missing(self):
        missing_journal_dir = self.root / "MissingJournal"
        missing_journal_dir.mkdir(parents=True, exist_ok=True)
        created = self.service.create_session(str(missing_journal_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "completed"
        self.store.save(session)
        self.store.release_directory_lock(missing_journal_dir, session.session_id)

        with self.assertRaisesRegex(FileNotFoundError, "latest_execution"):
            self.service.execution_app.rollback(session.session_id, confirm=True)

        reloaded = self.store.load(session.session_id)
        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        self.assertEqual(reloaded.stage, "interrupted")
        self.assertEqual(reloaded.last_error, "latest_execution")
        lock_result = self.store.acquire_directory_lock(missing_journal_dir, "new-owner")
        self.assertTrue(lock_result.acquired)

    def test_rollback_execution_journal_marks_journal_active_during_execution(self):
        journal = ExecutionJournal(
            execution_id="exec-journal-active",
            target_dir=str(self.target_dir.resolve()),
            created_at="2025-01-01T00:00:00+00:00",
            status="completed",
            items=[],
        )

        def fake_execute_rollback_plan(_plan):
            self.assertTrue(self.service._is_locked_stage_active(journal.execution_id, "rolling_back"))
            return RollbackReport(success_count=0, failure_count=0, results=[])

        with mock.patch(
            "file_pilot.app.execution_app_service.rollback_service.execute_rollback_plan",
            side_effect=fake_execute_rollback_plan,
        ):
            self.service.execution_app.rollback_execution_journal(journal)

        self.assertFalse(self.service._is_locked_stage_active(journal.execution_id, "rolling_back"))
        delete_execution_journal(journal.execution_id)
