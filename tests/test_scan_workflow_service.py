import shutil
import time
import unittest
from pathlib import Path
from unittest import mock

from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore
from file_pilot.organize.models import PendingPlan


class ScanWorkflowServiceTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_scan_workflow_service")
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

    def test_start_scan_via_workflow_moves_session_into_planning(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        self.service.scan_workflow.start_scan(session.session_id, scan_runner=lambda path: "a.txt | 文档 | A")
        scanned = self.store.load(session.session_id)

        self.assertIsNotNone(scanned)
        assert scanned is not None
        self.assertEqual(scanned.stage, "planning")
        self.assertEqual(scanned.scan_lines, "a.txt | 文档 | A")

    def test_confirm_target_directories_via_workflow_builds_planner_items(self):
        (self.target_dir / "Projects").mkdir()
        (self.target_dir / "todo.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
        session.stage = "selecting_incremental_scope"
        session.scan_lines = "Projects | 目录 | 项目目录\ntodo.txt | 文档 | 待处理文件"
        session.incremental_selection = {
            **self.service._incremental_selection_defaults(session),
            "status": "pending",
            "root_directory_options": ["Projects"],
        }
        self.store.save(session)

        with mock.patch.object(self.service.orchestrator, "run_planner_cycle_for_session", return_value=None):
            result = self.service.scan_workflow.confirm_target_directories(
                session.session_id,
                selected_target_dirs=["Projects"],
                scan_runner=lambda path: "Projects | 目录 | 项目目录\ntodo.txt | 文档 | 待处理文件",
            )

        self.assertEqual(result.session_snapshot["stage"], "planning")
        self.assertEqual(result.session_snapshot["incremental_selection"]["target_directories"], ["Projects"])
        self.assertEqual(result.session_snapshot["incremental_selection"]["pending_items_count"], 1)

    def test_refresh_session_via_workflow_marks_invalidated_items(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "stale"
        (self.target_dir / "b.txt").write_text("hello", encoding="utf-8")
        session.scan_lines = "a.txt | 文档 | A"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        session.plan_snapshot = {
            "items": [
                {
                    "item_id": "F001",
                    "display_name": "a.txt",
                    "source_relpath": "a.txt",
                    "entry_type": "file",
                    "target_slot_id": "D001",
                    "mapping_status": "mapped",
                    "status": "planned",
                }
            ],
            "target_slots": [{"slot_id": "D001", "display_name": "Docs", "relpath": "Docs", "depth": 1, "is_new": False}],
            "mappings": [],
            "groups": [],
            "invalidated_items": [],
            "change_highlights": [],
            "stats": {"move_count": 1},
        }
        self.store.save(session)

        def fake_run_planner_cycle_for_session(active_session, **kwargs):
            rebuilt_pending = PendingPlan(
                directories=[],
                moves=[],
                unresolved_items=[],
                summary="refreshed",
            )
            active_session.pending_plan = self.service._pending_plan_payload(rebuilt_pending)
            active_session.plan_snapshot = self.service._plan_snapshot_payload(
                self.service._plan_snapshot(
                    rebuilt_pending,
                    {"diff_summary": ["refresh"]},
                    scan_lines=active_session.scan_lines,
                    planner_items=active_session.planner_items,
                    session=active_session,
                )
            )

        with mock.patch.object(
            self.service.orchestrator,
            "run_planner_cycle_for_session",
            side_effect=fake_run_planner_cycle_for_session,
        ):
            result = self.service.scan_workflow.refresh_session(
                session.session_id,
                scan_runner=lambda path, session_id=None: "b.txt | 文档 | B",
            )

        self.assertEqual(result.session_snapshot["stage"], "planning")
        self.assertEqual(len(result.session_snapshot["plan_snapshot"]["invalidated_items"]), 1)
