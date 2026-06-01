import shutil
import time
import unittest
from pathlib import Path
from unittest import mock

from file_pilot.app.session_constants import (
    SESSION_STAGE_CONFLICT,
    STAGE_ABANDONED,
    STAGE_COMPLETED,
    STAGE_DRAFT,
    STAGE_EXECUTING,
    STAGE_INTERRUPTED,
    STAGE_PLANNING,
    STAGE_READY_FOR_PRECHECK,
    STAGE_READY_TO_EXECUTE,
    STAGE_ROLLING_BACK,
    STAGE_SELECTING_INCREMENTAL_SCOPE,
    STAGE_STALE,
)
from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore


class SessionStageTransitionTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_session_stage_transitions")
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

    def _create_ready_to_execute_session(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = STAGE_PLANNING
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)

        result = self.service.run_precheck(session.session_id)

        self.assertEqual(result.session_snapshot["stage"], STAGE_READY_TO_EXECUTE)
        return session.session_id

    def test_main_session_stage_path_from_draft_to_stale(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        self.assertEqual(session.stage, STAGE_DRAFT)

        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        scanned = self.service.start_scan(session.session_id, scan_runner=lambda path: "a.txt | 文档 | A")
        self.assertEqual(scanned.stage, STAGE_PLANNING)

        scanned.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(scanned)

        prechecked = self.service.run_precheck(session.session_id)
        self.assertEqual(prechecked.session_snapshot["stage"], STAGE_READY_TO_EXECUTE)

        executed = self.service.execute(session.session_id, confirm=True)
        self.assertEqual(executed.session_snapshot["stage"], STAGE_COMPLETED)

        rolled_back = self.service.rollback(session.session_id, confirm=True)
        self.assertEqual(rolled_back.session_snapshot["stage"], STAGE_STALE)

    def test_ready_to_execute_can_return_to_ready_for_precheck(self):
        session_id = self._create_ready_to_execute_session()

        result = self.service.return_to_planning(session_id)

        self.assertEqual(result.session_snapshot["stage"], STAGE_READY_FOR_PRECHECK)
        self.assertIsNone(result.session_snapshot["precheck_summary"])

    def test_abandon_moves_draft_session_to_abandoned(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        self.service.abandon_session(session.session_id)
        persisted = self.store.load(session.session_id)

        self.assertIsNotNone(persisted)
        assert persisted is not None
        self.assertEqual(persisted.stage, STAGE_ABANDONED)

    def test_resume_marks_orphaned_executing_session_interrupted(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = STAGE_EXECUTING
        self.store.save(session)

        resumed = self.service.resume_session(session.session_id)

        self.assertEqual(resumed.stage, STAGE_INTERRUPTED)
        self.assertEqual(resumed.integrity_flags["interrupted_during"], STAGE_EXECUTING)

    def test_resume_marks_orphaned_rolling_back_session_interrupted(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = STAGE_ROLLING_BACK
        self.store.save(session)

        resumed = self.service.resume_session(session.session_id)

        self.assertEqual(resumed.stage, STAGE_INTERRUPTED)
        self.assertEqual(resumed.integrity_flags["interrupted_during"], STAGE_ROLLING_BACK)

    def test_refresh_rejects_active_locked_stage(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = STAGE_EXECUTING
        self.store.save(session)

        with self.assertRaisesRegex(RuntimeError, SESSION_STAGE_CONFLICT):
            self.service.refresh_session(session.session_id, scan_runner=lambda path: "")

    def test_refresh_moves_stale_session_back_to_planning(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = STAGE_STALE
        session.stale_reason = "directory_changed"
        session.integrity_flags["is_stale"] = True
        session.scan_lines = "a.txt | file | doc | old"
        self.store.save(session)

        with mock.patch.object(self.service.orchestrator, "run_planner_cycle_for_session", return_value=None):
            result = self.service.refresh_session(
                session.session_id,
                scan_runner=lambda path: "a.txt | file | doc | refreshed",
            )

        self.assertEqual(result.session_snapshot["stage"], STAGE_PLANNING)
        self.assertIsNone(result.session_snapshot["stale_reason"])
        self.assertFalse(result.session_snapshot["integrity_flags"]["is_stale"])

    def test_incremental_scan_enters_selection_and_confirm_returns_planning(self):
        (self.target_dir / "Projects").mkdir()
        (self.target_dir / "todo.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            organize_method="assign_into_existing_categories",
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
        session.selected_target_directories = []
        session.incremental_selection = {}
        self.store.save(session)

        self.service.start_scan(
            session.session_id,
            scan_runner=lambda path: "Projects | dir | project directory | existing\ntodo.txt | file | pending file | inbox item",
        )
        discovered = self.store.load(session.session_id)
        assert discovered is not None

        self.assertEqual(discovered.stage, STAGE_SELECTING_INCREMENTAL_SCOPE)
        selected_target = discovered.incremental_selection["root_directory_options"][0]

        with mock.patch.object(self.service.orchestrator, "run_planner_cycle_for_session", return_value=None):
            result = self.service.confirm_target_directories(
                session.session_id,
                selected_target_dirs=[selected_target],
                scan_runner=lambda path: "Projects | dir | project directory | existing\ntodo.txt | file | pending file | inbox item",
            )

        self.assertEqual(result.session_snapshot["stage"], STAGE_PLANNING)


if __name__ == "__main__":
    unittest.main()
