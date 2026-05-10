import shutil
import time
import unittest
from pathlib import Path
from unittest import mock

from file_pilot.app.models import TaskState
from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore


class PlanningConversationServiceTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_planning_conversation_service")
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

    def test_get_snapshot_via_planning_conversation_assigns_message_ids(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
        session.messages = [{"role": "assistant", "content": "hello"}]
        self.store.save(session)

        snapshot = self.service.planning_conversation.get_snapshot(session.session_id)

        self.assertTrue(snapshot["messages"][0]["id"])

    def test_submit_user_intent_via_planning_conversation_updates_messages(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "a.txt | 文档 | A"
        self.store.save(session)

        with mock.patch.object(self.service.orchestrator, "run_planner_cycle_for_session", return_value=None):
            result = self.service.planning_conversation.submit_user_intent(session.session_id, "请整理")

        self.assertEqual(result.session_snapshot["stage"], "planning")
        self.assertTrue(any(message["role"] == "user" for message in result.session_snapshot["messages"]))

    def test_submit_user_intent_rejects_interrupted_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "interrupted"
        self.store.save(session)

        with self.assertRaisesRegex(RuntimeError, "SESSION_STAGE_CONFLICT"):
            self.service.planning_conversation.submit_user_intent(session.session_id, "请整理")

    def test_update_item_target_via_planning_conversation_accepts_target_slot(self):
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
            "unresolved_items": [],
            "summary": "pending",
        }
        session.last_ai_pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md", "raw": ""}],
            "user_constraints": [],
            "unresolved_items": [],
            "summary": "",
        }
        self.store.save(session)

        result = self.service.planning_conversation.update_item_target(
            session.session_id,
            item_id="md",
            target_dir=None,
            target_slot="D001",
            move_to_review=False,
        )

        self.assertEqual(result.session_snapshot["plan_snapshot"]["items"][0]["target_slot_id"], "D001")
        reloaded = self.store.load(session.session_id)
        assert reloaded is not None
        self.assertIsInstance(reloaded.task_state, TaskState)
        self.assertEqual(reloaded.task_state.mappings[0].target_slot_id, "D001")

    def test_update_item_target_rejects_completed_empty_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "completed"
        session.integrity_flags["empty_scan_result"] = True
        self.store.save(session)

        with self.assertRaisesRegex(RuntimeError, "SESSION_STAGE_CONFLICT"):
            self.service.planning_conversation.update_item_target(
                session.session_id,
                item_id="missing",
                target_dir="Docs",
                target_slot=None,
                move_to_review=False,
            )
