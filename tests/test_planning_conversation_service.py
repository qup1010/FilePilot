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

    def test_restore_ai_mapping_via_planning_conversation_restores_original_mapping(self):
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
            "summary": "pending",
        }
        session.last_ai_pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md", "raw": ""}],
            "user_constraints": [],
            "unresolved_items": ["md"],
            "summary": "",
        }
        self.store.save(session)

        updated = self.service.planning_conversation.update_item_target(
            session.session_id,
            item_id="md",
            target_dir=None,
            target_slot="D001",
            move_to_review=False,
        )
        updated_item = updated.session_snapshot["plan_snapshot"]["items"][0]
        self.assertEqual(updated_item["target_slot_id"], "D001")
        self.assertTrue(updated_item["can_restore_ai_suggestion"])
        self.assertEqual(updated_item["original_target_slot_id"], "Review")
        self.assertEqual(updated_item["original_status"], "unresolved")

        restored = self.service.planning_conversation.restore_ai_mapping(session.session_id, "md")

        restored_item = restored.session_snapshot["plan_snapshot"]["items"][0]
        self.assertEqual(restored_item["target_slot_id"], "Review")
        self.assertEqual(restored_item["mapping_status"], "unresolved")
        self.assertFalse(restored_item["user_overridden"])
        self.assertFalse(restored_item["can_restore_ai_suggestion"])
        reloaded = self.store.load(session.session_id)
        assert reloaded is not None
        self.assertIsInstance(reloaded.task_state, TaskState)
        mapping = reloaded.task_state.mappings[0]
        self.assertEqual(mapping.target_slot_id, "Review")
        self.assertEqual(mapping.status, "unresolved")
        self.assertFalse(mapping.user_overridden)
        self.assertIsNone(mapping.original_target_slot_id)
        self.assertIsNone(mapping.original_status)

    def test_apply_target_conflict_suggestions_updates_plan_and_reruns_precheck(self):
        (self.target_dir / "alpha").mkdir()
        (self.target_dir / "beta").mkdir()
        (self.target_dir / "alpha" / "report.pdf").write_text("alpha", encoding="utf-8")
        (self.target_dir / "beta" / "report.pdf").write_text("beta", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
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
        first_precheck = self.service.execution_app.run_precheck(session.session_id)
        # 重名只跳过后来者，不再阻断整批；建议依然可以从 ready_to_execute 应用
        self.assertEqual(first_precheck.session_snapshot["stage"], "ready_to_execute")
        self.assertTrue(first_precheck.session_snapshot["precheck_summary"]["can_execute"])

        result = self.service.planning_conversation.apply_target_conflict_suggestions(session.session_id)

        snapshot = result.session_snapshot
        self.assertEqual(snapshot["stage"], "ready_to_execute")
        self.assertTrue(snapshot["precheck_summary"]["can_execute"])
        targets = [move["target"] for move in snapshot["precheck_summary"]["move_preview"]]
        self.assertEqual(targets, ["Docs/report.pdf", "Docs/report (2).pdf"])
        reloaded = self.store.load(session.session_id)
        assert reloaded is not None
        self.assertEqual(
            [move["target"] for move in reloaded.pending_plan["moves"]],
            ["Docs/report.pdf", "Docs/report (2).pdf"],
        )

    def test_apply_target_conflict_suggestions_handles_existing_target(self):
        (self.target_dir / "Docs").mkdir()
        (self.target_dir / "Docs" / "report.pdf").write_text("exists", encoding="utf-8")
        (self.target_dir / "alpha").mkdir()
        (self.target_dir / "alpha" / "report.pdf").write_text("alpha", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.planner_items = [
            {
                "planner_id": "F001",
                "source_relpath": "alpha/report.pdf",
                "display_name": "report.pdf",
                "entry_type": "file",
            }
        ]
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "alpha/report.pdf", "target": "Docs/report.pdf"}],
            "unresolved_items": [],
            "summary": "move report",
        }
        self.store.save(session)
        failed_precheck = self.service.execution_app.run_precheck(session.session_id)
        self.assertEqual(failed_precheck.session_snapshot["stage"], "planning")
        suggestions = failed_precheck.session_snapshot["precheck_summary"]["target_conflict_suggestions"]
        self.assertEqual(suggestions[0]["type"], "target_exists")

        result = self.service.planning_conversation.apply_target_conflict_suggestions(session.session_id)

        snapshot = result.session_snapshot
        self.assertEqual(snapshot["stage"], "ready_to_execute")
        self.assertTrue(snapshot["precheck_summary"]["can_execute"])
        self.assertEqual(snapshot["precheck_summary"]["move_preview"][0]["target"], "Docs/report (2).pdf")
        reloaded = self.store.load(session.session_id)
        assert reloaded is not None
        self.assertEqual(reloaded.pending_plan["moves"][0]["target"], "Docs/report (2).pdf")

    def test_apply_target_conflict_suggestions_requires_existing_suggestions(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "md", "target": "Docs/md"}],
            "unresolved_items": [],
            "summary": "move docs",
        }
        self.store.save(session)

        with self.assertRaisesRegex(RuntimeError, "TARGET_CONFLICT_SUGGESTIONS_NOT_FOUND"):
            self.service.planning_conversation.apply_target_conflict_suggestions(session.session_id)

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
