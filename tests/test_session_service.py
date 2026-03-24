import shutil
import time
import unittest
from pathlib import Path
from unittest import mock

from file_organizer.app.session_service import OrganizerSessionService
from file_organizer.app.session_store import SessionStore
from file_organizer.organize.models import PendingPlan, PlanMove


class ImmediateScanner:
    def start(self, session_id, target_dir, run_scan, on_complete, on_error):
        try:
            on_complete(session_id, run_scan(target_dir))
        except Exception as exc:
            on_error(session_id, exc)

    def get_progress(self, session_id):
        return {"running": False}


class OrganizerSessionServiceTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_session_service")
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

    def test_create_session_returns_created_mode(self):
        result = self.service.create_session(str(self.target_dir), resume_if_exists=False)

        self.assertEqual(result.mode, "created")
        self.assertEqual(result.session.stage, "draft")
        self.assertIsNone(result.restorable_session)

    def test_create_session_returns_resume_available_when_session_exists(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        self.store.save(created.session)

        resumed = self.service.create_session(str(self.target_dir), resume_if_exists=True)

        self.assertEqual(resumed.mode, "resume_available")
        self.assertIsNotNone(resumed.restorable_session)
        self.assertEqual(resumed.restorable_session.session_id, created.session.session_id)

    def test_create_session_allows_new_session_when_latest_session_completed(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "completed"
        self.store.save(session)

        follow_up = self.service.create_session(str(self.target_dir), resume_if_exists=False)

        self.assertEqual(follow_up.mode, "created")
        self.assertNotEqual(follow_up.session.session_id, session.session_id)

    def test_create_session_persists_strategy_and_exposes_snapshot_summary(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={
                "template_id": "project_workspace",
                "naming_style": "en",
                "caution_level": "balanced",
                "note": "项目文件尽量按交付物归档",
            },
        )

        session = created.session
        assert session is not None
        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(session.strategy_template_id, "project_workspace")
        self.assertEqual(session.naming_style, "en")
        self.assertEqual(session.caution_level, "balanced")
        self.assertEqual(session.strategy_note, "项目文件尽量按交付物归档")
        self.assertEqual(session.user_constraints, ["项目文件尽量按交付物归档"])
        self.assertEqual(snapshot["strategy"]["template_id"], "project_workspace")
        self.assertEqual(snapshot["strategy"]["template_label"], "项目资料")
        self.assertEqual(snapshot["strategy"]["naming_style_label"], "英文目录")
        self.assertEqual(snapshot["strategy"]["note"], "项目文件尽量按交付物归档")

    def test_create_session_requires_abandon_before_replacing_active_session(self):
        self.service.create_session(str(self.target_dir), resume_if_exists=False)

        with self.assertRaisesRegex(RuntimeError, "SESSION_LOCKED"):
            self.service.create_session(str(self.target_dir), resume_if_exists=False)

    def test_abandon_session_releases_lock_and_allows_new_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)

        self.service.abandon_session(created.session.session_id)
        replacement = self.service.create_session(str(self.target_dir), resume_if_exists=False)

        self.assertEqual(replacement.mode, "created")
        self.assertNotEqual(replacement.session.session_id, created.session.session_id)

    def test_resume_session_marks_stale_when_directory_entries_changed(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        created.session.stage = "planning"
        created.session.scan_lines = "a.txt | 文档 | A"
        self.store.save(created.session)

        (self.target_dir / "b.txt").write_text("new", encoding="utf-8")

        resumed = self.service.resume_session(created.session.session_id)

        self.assertEqual(resumed.stage, "stale")
        self.assertEqual(resumed.stale_reason, "directory_changed")

    def test_run_precheck_sets_ready_to_execute_for_valid_pending_plan(self):
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

        result = self.service.run_precheck(session.session_id)

        self.assertEqual(result.session_snapshot["stage"], "ready_to_execute")
        self.assertTrue(result.session_snapshot["precheck_summary"]["can_execute"])

    def test_return_to_planning_clears_precheck_summary_and_restores_precheck_ready_stage(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_to_execute"
        session.scan_lines = "a.txt | 文档 | A"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        session.precheck_summary = {"can_execute": True, "blocking_errors": [], "warnings": []}
        self.store.save(session)

        result = self.service.return_to_planning(session.session_id)

        self.assertEqual(result.session_snapshot["stage"], "ready_for_precheck")
        self.assertIsNone(result.session_snapshot["precheck_summary"])

    def test_execute_moves_files_and_marks_completed(self):
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

        result = self.service.execute(session.session_id, confirm=True)

        self.assertEqual(result.session_snapshot["stage"], "completed")
        self.assertTrue((self.target_dir / "Docs" / "a.txt").exists())
        self.assertEqual(result.session_snapshot["execution_report"]["status"], "success")

    def test_rollback_after_execute_marks_stale_and_restores_file(self):
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
        self.service.execute(session.session_id, confirm=True)

        result = self.service.rollback(session.session_id, confirm=True)

        self.assertEqual(result.session_snapshot["stage"], "stale")
        self.assertTrue((self.target_dir / "a.txt").exists())
        self.assertFalse((self.target_dir / "Docs" / "a.txt").exists())
        self.assertEqual(result.session_snapshot["rollback_report"]["status"], "success")

    def test_start_scan_moves_session_into_planning_when_runner_finishes(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        self.service.start_scan(session.session_id, scan_runner=lambda path: "a.txt | 文档 | A")
        scanned = self.store.load(session.session_id)

        self.assertIsNotNone(scanned)
        self.assertEqual(scanned.stage, "planning")
        self.assertEqual(scanned.scan_lines, "a.txt | 文档 | A")
        self.assertEqual(scanned.scanner_progress["status"], "completed")

    def test_start_scan_tracks_parallel_batch_progress_in_snapshot(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        def fake_run_analysis_cycle(_target_dir, event_handler=None):
            if event_handler is not None:
                event_handler("batch_split", {"total_entries": 31, "batch_count": 3, "worker_count": 3})
                event_handler("batch_progress", {"batch_index": 0, "total_batches": 3, "status": "completed", "completed_batches": 1})
                event_handler("batch_progress", {"batch_index": 1, "total_batches": 3, "status": "completed", "completed_batches": 2})
                event_handler("batch_progress", {"batch_index": 2, "total_batches": 3, "status": "completed", "completed_batches": 3})
            return "a.txt | 文档 | A"

        with mock.patch(
            "file_organizer.app.session_service.analysis_service.run_analysis_cycle",
            side_effect=fake_run_analysis_cycle,
        ):
            service.start_scan(session.session_id)

        scanned = self.store.load(session.session_id)
        assert scanned is not None
        self.assertEqual(scanned.scanner_progress["batch_count"], 3)
        self.assertEqual(scanned.scanner_progress["completed_batches"], 3)
        self.assertEqual(scanned.scanner_progress["message"], "已完成 3/3 批并行分析")
        self.assertEqual(scanned.stage, "planning")
        self.assertTrue(any(event["event_type"] == "scan.progress" for event in service.read_events(session.session_id)))

    def test_submit_user_intent_updates_pending_plan_and_assistant_message(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "a.txt | 文档 | A"
        self.store.save(session)

        pending = PendingPlan(
            directories=["Docs"],
            moves=[PlanMove(source="a.txt", target="Docs/a.txt")],
            unresolved_items=[],
            summary="moved",
        )

        with mock.patch(
            "file_organizer.app.session_service.organize_service.run_organizer_cycle",
            return_value=(
                "已更新计划",
                {
                    "pending_plan": pending,
                    "is_valid": False,
                    "diff_summary": ["moved"],
                    "display_plan": {"focus": "summary", "summary": "moved"},
                },
            ),
        ):
            result = self.service.submit_user_intent(session.session_id, "放到文档")

        self.assertEqual(result.assistant_message["content"], "已更新计划")
        self.assertEqual(result.session_snapshot["plan_snapshot"]["summary"], "moved")
        self.assertEqual(result.session_snapshot["messages"][-1]["content"], "已更新计划")
        self.assertTrue(all(message["role"] != "tool" for message in result.session_snapshot["messages"]))

    def test_submit_user_intent_preserves_assistant_tool_calls_in_session_messages(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "a.txt | 文档 | A"
        self.store.save(session)

        pending = PendingPlan(
            directories=["Docs"],
            moves=[PlanMove(source="a.txt", target="Docs/a.txt")],
            unresolved_items=[],
            summary="moved",
        )
        assistant_message = {
            "role": "assistant",
            "content": "已更新计划",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "submit_plan_diff",
                        "arguments": '{"summary":"moved"}',
                    },
                }
            ],
        }
        assistant_context_messages = [
            assistant_message,
            {
                "role": "tool",
                "tool_call_id": "call_1",
                "name": "submit_plan_diff",
                "content": '{"ok": true}',
            },
        ]

        with mock.patch(
            "file_organizer.app.session_service.organize_service.run_organizer_cycle",
            return_value=(
                "已更新计划",
                {
                    "pending_plan": pending,
                    "is_valid": False,
                    "diff_summary": ["moved"],
                    "display_plan": {"focus": "summary", "summary": "moved"},
                    "assistant_message": assistant_message,
                    "assistant_context_messages": assistant_context_messages,
                },
            ),
        ):
            result = self.service.submit_user_intent(session.session_id, "放到文档")

        stored = self.store.load(session.session_id)
        self.assertIsNotNone(stored)
        assert stored is not None
        self.assertEqual(result.assistant_message["content"], "已更新计划")
        self.assertEqual(result.assistant_message["tool_calls"][0]["function"]["name"], "submit_plan_diff")
        self.assertEqual(stored.messages[-2]["tool_calls"][0]["id"], "call_1")
        self.assertEqual(stored.messages[-1]["role"], "tool")
        self.assertEqual(stored.messages[-1]["tool_call_id"], "call_1")

    def test_resolve_unresolved_choices_updates_plan_and_marks_block_submitted(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "md | 学习资料 | 笔记\nzip | 项目资料 | 源码包"
        session.pending_plan = {
            "directories": ["Review"],
            "moves": [
                {"source": "md", "target": "Review/md"},
                {"source": "zip", "target": "Review/zip"},
            ],
            "unresolved_items": ["md", "zip"],
            "summary": "needs choices",
        }
        session.messages = [
            {
                "role": "assistant",
                "content": "",
                "blocks": [
                    {
                        "type": "unresolved_choices",
                        "request_id": "req_1",
                        "summary": "请确认 2 个文件",
                        "status": "pending",
                        "items": [
                            {"item_id": "md", "display_name": "md", "question": "放哪里？", "suggested_folders": ["学习资料", "文档资料"]},
                            {"item_id": "zip", "display_name": "zip", "question": "放哪里？", "suggested_folders": ["项目资料", "安装程序"]},
                        ],
                    }
                ],
            }
        ]
        session.assistant_message = dict(session.messages[0])
        self.store.save(session)

        result = self.service.resolve_unresolved_choices(
            session.session_id,
            "req_1",
            [
                {"item_id": "md", "selected_folder": "学习资料", "note": ""},
                {"item_id": "zip", "selected_folder": "Review", "note": ""},
            ],
        )

        snapshot = result.session_snapshot
        self.assertEqual(snapshot["plan_snapshot"]["unresolved_items"], [])
        targets = {item["item_id"]: item["target_relpath"] for item in snapshot["plan_snapshot"]["items"]}
        self.assertEqual(targets["md"], "学习资料/md")
        self.assertEqual(targets["zip"], "Review/zip")
        self.assertEqual(snapshot["messages"][0]["blocks"][0]["status"], "submitted")
        self.assertEqual(snapshot["messages"][1]["role"], "user")
        self.assertIn("md -> 学习资料", snapshot["messages"][1]["content"])

    def test_resolve_unresolved_choices_with_note_triggers_followup_cycle(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "md | 学习资料 | 笔记"
        session.pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md"}],
            "unresolved_items": ["md"],
            "summary": "needs choices",
        }
        session.messages = [
            {
                "role": "assistant",
                "content": "",
                "blocks": [
                    {
                        "type": "unresolved_choices",
                        "request_id": "req_2",
                        "summary": "请确认文件归类",
                        "status": "pending",
                        "items": [
                            {"item_id": "md", "display_name": "md", "question": "放哪里？", "suggested_folders": ["学习资料", "文档资料"]},
                        ],
                    }
                ],
            }
        ]
        session.assistant_message = dict(session.messages[0])
        self.store.save(session)

        updated_pending = PendingPlan(
            directories=["学习资料"],
            moves=[PlanMove(source="md", target="学习资料/md")],
            unresolved_items=[],
            summary="已确认",
        )

        with mock.patch(
            "file_organizer.app.session_service.organize_service.run_organizer_cycle",
            return_value=(
                "已根据你的说明更新计划",
                {
                    "pending_plan": updated_pending,
                    "is_valid": False,
                    "diff_summary": ["已确认 md"],
                    "assistant_message": {"role": "assistant", "content": "已根据你的说明更新计划"},
                },
            ),
        ) as cycle_mock:
            result = self.service.resolve_unresolved_choices(
                session.session_id,
                "req_2",
                [{"item_id": "md", "selected_folder": "", "note": "这是课程笔记，优先归到学习资料"}],
            )

        self.assertTrue(cycle_mock.called)
        self.assertEqual(result.session_snapshot["plan_snapshot"]["unresolved_items"], [])
        self.assertEqual(result.session_snapshot["messages"][-1]["content"], "已根据你的说明更新计划")

    def test_get_snapshot_assigns_stable_message_ids(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.messages = [{"role": "assistant", "content": "hello"}]
        self.store.save(session)

        first_snapshot = self.service.get_snapshot(session.session_id)
        second_snapshot = self.service.get_snapshot(session.session_id)

        self.assertIn("id", first_snapshot["messages"][0])
        self.assertEqual(first_snapshot["messages"][0]["id"], second_snapshot["messages"][0]["id"])

    def test_start_scan_emits_scan_ai_typing_events_without_polluting_plan_stream(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        pending = PendingPlan(
            directories=["Docs"],
            moves=[PlanMove(source="a.txt", target="Docs/a.txt")],
            unresolved_items=[],
            summary="planned",
        )

        def fake_scan_runner(_target_dir, event_handler=None):
            if event_handler is not None:
                event_handler("ai_chunk", {"content": "扫描阶段摘要"})
            return "a.txt | 文档 | A"

        with mock.patch(
            "file_organizer.app.session_service.analysis_service.run_analysis_cycle",
            side_effect=fake_scan_runner,
        ), mock.patch(
            "file_organizer.app.session_service.organize_service.build_initial_messages",
            return_value=[{"role": "system", "content": "scan"}],
        ), mock.patch(
            "file_organizer.app.session_service.organize_service.run_organizer_cycle",
            return_value=("已规划", {"pending_plan": pending, "is_valid": False, "diff_summary": ["planned"]}),
        ):
            service.start_scan(session.session_id)

        event_types = [event["event_type"] for event in service.read_events(session.session_id)]
        self.assertIn("scan.ai_typing", event_types)
        self.assertNotIn("plan.ai_typing", [event["event_type"] for event in service.read_events(session.session_id) if event.get("content") == "扫描阶段摘要"])

    def test_start_scan_builds_initial_messages_with_strategy_selection_dict(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        created = service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={
                "template_id": "project_workspace",
                "naming_style": "en",
                "caution_level": "balanced",
                "note": "按项目语义整理",
            },
        )
        session = created.session
        assert session is not None
        real_build_initial_messages = __import__(
            "file_organizer.organize.service", fromlist=["build_initial_messages"]
        ).build_initial_messages

        with mock.patch(
            "file_organizer.app.session_service.analysis_service.run_analysis_cycle",
            return_value="a.txt | 文档 | A",
        ), mock.patch(
            "file_organizer.app.session_service.organize_service.build_initial_messages",
            side_effect=real_build_initial_messages,
        ) as build_messages_mock, mock.patch(
            "file_organizer.app.session_service.organize_service.run_organizer_cycle",
            return_value=("已规划", {"pending_plan": PendingPlan(summary="planned"), "is_valid": False, "diff_summary": ["planned"]}),
        ):
            service.start_scan(session.session_id)

        _, kwargs = build_messages_mock.call_args
        self.assertIsInstance(kwargs["strategy"], dict)
        self.assertEqual(kwargs["strategy"]["template_id"], "project_workspace")
        self.assertEqual(kwargs["strategy"]["naming_style"], "en")

    def test_fail_async_scan_event_includes_interrupted_snapshot(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        def broken_analysis(_target_dir, event_handler=None):
            raise RuntimeError("scanner boom")

        with mock.patch(
            "file_organizer.app.session_service.analysis_service.run_analysis_cycle",
            side_effect=broken_analysis,
        ):
            service.start_scan(session.session_id)

        error_events = [event for event in service.read_events(session.session_id) if event["event_type"] == "session.error"]
        self.assertTrue(error_events)
        latest = error_events[-1]
        self.assertEqual(latest["stage"], "interrupted")
        self.assertEqual(latest["session_snapshot"]["stage"], "interrupted")
        self.assertEqual(latest["session_snapshot"]["scanner_progress"]["status"], "failed")
        self.assertEqual(latest["session_snapshot"]["last_error"], "scanner boom")

    def test_get_snapshot_recovers_orphaned_scanning_session_to_interrupted(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "scanning"
        self.store.save(session)

        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(snapshot["stage"], "interrupted")
        self.assertEqual(snapshot["integrity_flags"]["interrupted_during"], "scanning")
        self.assertEqual(snapshot["last_error"], "scanning_interrupted")

    def test_update_item_target_uses_target_dir_and_removes_unresolved_item(self):
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

        result = self.service.update_item_target(
            session.session_id,
            "md",
            "Study",
            False,
        )

        updated_item = next(
            item for item in result.session_snapshot["plan_snapshot"]["items"] if item["item_id"] == "md"
        )
        self.assertEqual(updated_item["target_relpath"], "Study/md")
        self.assertEqual(result.session_snapshot["plan_snapshot"]["unresolved_items"], [])
        self.assertEqual(result.session_snapshot["plan_snapshot"]["stats"]["unresolved_count"], 0)

    def test_update_item_target_move_to_review_removes_unresolved_item_immediately(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "md", "target": "Docs/md"}],
            "unresolved_items": ["md"],
            "summary": "needs confirmation",
        }
        self.store.save(session)

        result = self.service.update_item_target(
            session.session_id,
            "md",
            None,
            True,
        )

        updated_item = next(
            item for item in result.session_snapshot["plan_snapshot"]["items"] if item["item_id"] == "md"
        )
        self.assertEqual(updated_item["target_relpath"], "Review/md")
        self.assertEqual(updated_item["status"], "review")
        self.assertEqual(result.session_snapshot["plan_snapshot"]["unresolved_items"], [])

    def test_refresh_session_rebuilds_plan_and_marks_invalidated_items(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "stale"
        session.scan_lines = "a.txt | 文档 | A\nb.txt | 文档 | B"
        session.pending_plan = {
            "directories": ["Docs", "Review"],
            "moves": [
                {"source": "a.txt", "target": "Docs/a.txt"},
                {"source": "b.txt", "target": "Review/b.txt"},
            ],
            "unresolved_items": [],
            "summary": "old plan",
        }
        session.plan_snapshot = {
            "items": [
                {"item_id": "a.txt", "display_name": "a.txt", "source_relpath": "a.txt", "target_relpath": "Docs/a.txt", "status": "planned"},
                {"item_id": "b.txt", "display_name": "b.txt", "source_relpath": "b.txt", "target_relpath": "Review/b.txt", "status": "review"},
            ]
        }
        self.store.save(session)

        result = self.service.refresh_session(
            session.session_id,
            scan_runner=lambda path: "a.txt | 文档 | A\nc.txt | 图片 | C",
        )

        self.assertEqual(result.session_snapshot["stage"], "planning")
        self.assertEqual(result.session_snapshot["integrity_flags"]["is_stale"], False)
        self.assertEqual(
            [item["item_id"] for item in result.session_snapshot["plan_snapshot"]["invalidated_items"]],
            ["b.txt"],
        )
        reloaded = self.store.load(session.session_id)
        self.assertEqual(
            [move["source"] for move in reloaded.pending_plan["moves"]],
            ["a.txt"],
        )

    def test_refresh_session_keeps_existing_strategy_summary(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={
                "template_id": "study_materials",
                "naming_style": "zh",
                "caution_level": "conservative",
                "note": "模糊项都进待确认",
            },
        )
        session = created.session
        assert session is not None
        session.stage = "stale"
        session.scan_lines = "a.txt | 文档 | A"
        session.pending_plan = {
            "directories": ["课程资料"],
            "moves": [{"source": "a.txt", "target": "课程资料/a.txt"}],
            "unresolved_items": [],
            "summary": "old plan",
            "user_constraints": ["模糊项都进待确认"],
        }
        self.store.save(session)

        result = self.service.refresh_session(
            session.session_id,
            scan_runner=lambda path: "a.txt | 文档 | A",
        )

        self.assertEqual(result.session_snapshot["strategy"]["template_id"], "study_materials")
        self.assertEqual(result.session_snapshot["strategy"]["caution_level"], "conservative")
        self.assertEqual(result.session_snapshot["strategy"]["note"], "模糊项都进待确认")

    def test_get_snapshot_backfills_legacy_plan_groups_from_pending_moves(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_for_precheck"
        session.summary = "已分类 2 项"
        session.pending_plan = {
            "directories": ["学习资料", "项目资料"],
            "moves": [
                {"source": "a.txt", "target": "学习资料/a.txt"},
                {"source": "b.zip", "target": "项目资料/b.zip"},
            ],
            "unresolved_items": [],
            "summary": "已分类 2 项",
        }
        session.plan_snapshot = {
            "summary": "已分类 2 项",
            "stats": {"move_count": 2, "unresolved_count": 0, "directory_count": 2},
            "groups": [],
            "items": [
                {"item_id": "a.txt", "display_name": "a.txt", "source_relpath": "a.txt", "target_relpath": "学习资料/a.txt", "is_unresolved": False, "reason": ""},
                {"item_id": "b.zip", "display_name": "b.zip", "source_relpath": "b.zip", "target_relpath": "项目资料/b.zip", "is_unresolved": False, "reason": ""},
            ],
            "unresolved_items": [],
            "review_items": [],
            "invalidated_items": [],
            "diff_summary": [],
            "readiness": {"can_precheck": True},
        }
        self.store.save(session)

        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(
            [group["directory"] for group in snapshot["plan_snapshot"]["groups"]],
            ["学习资料", "项目资料"],
        )
        self.assertEqual(
            [item["status"] for item in snapshot["plan_snapshot"]["items"]],
            ["planned", "planned"],
        )

    def test_plan_snapshot_items_include_scan_purpose_and_summary(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.scan_lines = "md | 工具报告 | 含一次 Organizer 扫描报告\nnotes.txt | 学习笔记 | 课程随手记录"
        session.pending_plan = {
            "directories": ["历史归档", "学习资料"],
            "moves": [
                {"source": "md", "target": "历史归档/md"},
                {"source": "notes.txt", "target": "学习资料/notes.txt"},
            ],
            "unresolved_items": [],
            "summary": "已分类 2 项",
        }
        self.store.save(session)

        snapshot = self.service.get_snapshot(session.session_id)
        md_item = next(item for item in snapshot["plan_snapshot"]["items"] if item["item_id"] == "md")
        notes_item = next(item for item in snapshot["plan_snapshot"]["items"] if item["item_id"] == "notes.txt")

        self.assertEqual(md_item["suggested_purpose"], "工具报告")
        self.assertEqual(md_item["content_summary"], "含一次 Organizer 扫描报告")
        self.assertEqual(notes_item["suggested_purpose"], "学习笔记")
        self.assertEqual(notes_item["content_summary"], "课程随手记录")

    def test_refresh_session_rejects_locked_stage(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "executing"
        self.store.save(session)

        with self.assertRaisesRegex(RuntimeError, "SESSION_STAGE_CONFLICT"):
            self.service.refresh_session(session.session_id, scan_runner=lambda path: "")

    def test_finish_async_scan_ignores_non_scanning_sessions(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "stale"
        self.store.save(session)

        self.service._finish_async_scan(session.session_id, "a.txt | 文档 | A")
        reloaded = self.store.load(session.session_id)

        self.assertEqual(reloaded.stage, "stale")
        self.assertEqual(reloaded.scan_lines, "")

    def test_get_journal_summary_returns_latest_execution_details(self):
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
        self.service.execute(session.session_id, confirm=True)

        summary = self.service.get_journal_summary(session.session_id)

        self.assertEqual(summary["status"], "completed")
        self.assertEqual(summary["item_count"], 2)
        self.assertEqual(summary["execution_id"], summary["journal_id"])
        self.assertEqual(summary["restore_items"], [])

    def test_get_journal_summary_prefers_latest_rollback_restore_mapping(self):
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
        self.service.execute(session.session_id, confirm=True)
        self.service.rollback(session.session_id, confirm=True)

        summary = self.service.get_journal_summary(session.session_id)

        self.assertEqual(summary["status"], "rolled_back")
        self.assertEqual(len(summary["restore_items"]), 1)
        self.assertEqual(summary["restore_items"][0]["source"].replace("\\", "/").split("/")[-2:], ["Docs", "a.txt"])
        self.assertEqual(summary["restore_items"][0]["target"].replace("\\", "/").split("/")[-1], "a.txt")
        self.assertEqual(summary["restore_items"][0]["display_name"], "a.txt")

    def test_cleanup_empty_dirs_returns_cleaned_count(self):
        docs_dir = self.target_dir / "Docs"
        docs_dir.mkdir(parents=True, exist_ok=True)
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "completed"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [],
            "unresolved_items": [],
            "summary": "done",
        }
        session.execution_report = {
            "execution_id": "exec-1",
            "journal_id": "exec-1",
            "success_count": 0,
            "failure_count": 0,
            "status": "success",
            "has_cleanup_candidates": True,
            "cleanup_candidate_count": 1,
        }
        self.store.save(session)

        result = self.service.cleanup_empty_dirs(session.session_id)

        self.assertEqual(result["cleaned_count"], 1)
        self.assertFalse(docs_dir.exists())


if __name__ == "__main__":
    unittest.main()
