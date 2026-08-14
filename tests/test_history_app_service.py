import json
import shutil
import time
import unittest
import unittest.mock
from pathlib import Path

from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore
from file_pilot.execution.models import ExecutionJournal
from file_pilot.execution.service import delete_execution_journal, load_execution_journal, save_execution_journal


class HistoryAppServiceTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_history_app_service")
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

    def test_list_history_via_history_app_recovers_orphaned_locked_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "executing"
        self.store.save(session)

        history = self.service.history_app.list_history()
        reloaded = self.store.load(session.session_id)

        self.assertTrue(any(entry["execution_id"] == session.session_id for entry in history))
        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        self.assertEqual(reloaded.stage, "interrupted")

    def test_list_history_does_not_interrupt_active_executing_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "executing"
        self.store.save(session)
        self.service._mark_locked_stage_active(session.session_id, "executing")

        try:
            history = self.service.history_app.list_history()
            reloaded = self.store.load(session.session_id)
        finally:
            self.service._mark_locked_stage_inactive(session.session_id, "executing")

        self.assertTrue(any(entry["execution_id"] == session.session_id for entry in history))
        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        self.assertEqual(reloaded.stage, "executing")

    def test_list_history_does_not_interrupt_active_rolling_back_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "rolling_back"
        self.store.save(session)
        self.service._mark_locked_stage_active(session.session_id, "rolling_back")

        try:
            history = self.service.history_app.list_history()
            reloaded = self.store.load(session.session_id)
        finally:
            self.service._mark_locked_stage_inactive(session.session_id, "rolling_back")

        self.assertTrue(any(entry["execution_id"] == session.session_id for entry in history))
        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        self.assertEqual(reloaded.stage, "rolling_back")

    def test_delete_history_entry_rejects_active_locked_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "executing"
        self.store.save(session)
        self.service._mark_locked_stage_active(session.session_id, "executing")

        try:
            with self.assertRaisesRegex(RuntimeError, "SESSION_LOCKED"):
                self.service.history_app.delete_history_entry(session.session_id)
            reloaded = self.store.load(session.session_id)
        finally:
            self.service._mark_locked_stage_inactive(session.session_id, "executing")

        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        self.assertEqual(reloaded.stage, "executing")

    def test_delete_history_entry_rejects_active_rolling_back_execution_journal(self):
        journal = ExecutionJournal(
            execution_id="exec-active-rollback",
            target_dir=str(self.target_dir.resolve()),
            created_at="2025-01-01T00:00:00+00:00",
            status="completed",
            items=[],
        )
        save_execution_journal(journal)
        self.service._mark_locked_stage_active(journal.execution_id, "rolling_back")

        try:
            with self.assertRaisesRegex(RuntimeError, "SESSION_LOCKED"):
                self.service.history_app.delete_history_entry(journal.execution_id)
        finally:
            self.service._mark_locked_stage_inactive(journal.execution_id, "rolling_back")

        self.assertIsNotNone(load_execution_journal(journal.execution_id))
        delete_execution_journal(journal.execution_id)

    def test_list_history_does_not_interrupt_recent_scanning_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "scanning"
        self.store.save(session)

        history = self.service.history_app.list_history()
        reloaded = self.store.load(session.session_id)

        self.assertTrue(any(entry["execution_id"] == session.session_id for entry in history))
        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        self.assertEqual(reloaded.stage, "scanning")

    def test_list_history_recovers_old_scanning_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "scanning"
        self.store.save(session)
        session.updated_at = "2000-01-01T00:00:00+00:00"
        (self.store.sessions_dir / f"{session.session_id}.json").write_text(
            json.dumps(session.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        history = self.service.history_app.list_history()
        reloaded = self.store.load(session.session_id)

        self.assertTrue(any(entry["execution_id"] == session.session_id for entry in history))
        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        self.assertEqual(reloaded.stage, "interrupted")

    def test_get_journal_summary_via_history_app_returns_execution_details(self):
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

        summary = self.service.history_app.get_journal_summary(session.session_id)

        self.assertEqual(summary["status"], "completed")
        self.assertEqual(summary["item_count"], 2)
        mkdir_item = next(item for item in summary["items"] if item["action_type"] == "MKDIR")
        self.assertTrue(str(mkdir_item["target"]).replace("\\", "/").endswith("/Docs"))
        move_item = next(item for item in summary["items"] if item["action_type"] == "MOVE")
        self.assertEqual(move_item["display_name"], "a.txt")
        self.assertEqual(move_item["item_id"], "F001")
        self.assertEqual(move_item["source_ref_id"], "F001")
        self.assertEqual(move_item["target_kind"], "directory")
        self.assertFalse(move_item["is_review"])

    def test_get_journal_summary_marks_review_items_with_explicit_metadata(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_to_execute"
        session.pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "a.txt", "target": "Review/a.txt"}],
            "unresolved_items": [],
            "summary": "move to review",
        }
        self.store.save(session)
        self.service.execute(session.session_id, confirm=True)

        summary = self.service.history_app.get_journal_summary(session.session_id)

        move_item = next(item for item in summary["items"] if item["action_type"] == "MOVE")
        self.assertEqual(move_item["target_slot_id"], "Review")
        self.assertEqual(move_item["target_kind"], "review")
        self.assertTrue(move_item["is_review"])

    def test_get_journal_summary_by_execution_id_does_not_raise_unbound_local_error(self):
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
        reloaded = self.store.load(session.session_id)
        assert reloaded is not None
        exec_id = reloaded.last_journal_id
        assert exec_id is not None

        # 直接使用 execution_id（非 session_id）查询，验证不会引发 UnboundLocalError
        summary = self.service.history_app.get_journal_summary(exec_id)
        self.assertEqual(summary["execution_id"], exec_id)
        self.assertEqual(summary["status"], "completed")


class FileHistorySearchTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_history_search")
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)
        self.executions_dir = self.root / "executions"
        self.executions_dir.mkdir(parents=True, exist_ok=True)
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)
        from file_pilot.shared import config as shared_config
        self._config_patch = unittest.mock.patch.object(shared_config, "EXECUTION_LOG_DIR", self.executions_dir)
        self._config_patch.start()

    def tearDown(self):
        self._config_patch.stop()
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)

    def _write_journal(self, execution_id: str, created_at: str, items: list[dict], rollback_attempts=None):
        payload = {
            "execution_id": execution_id,
            "target_dir": str((self.root / "Inbox").resolve()),
            "created_at": created_at,
            "status": "completed",
            "items": items,
            "rollback_attempts": rollback_attempts or [],
        }
        (self.executions_dir / f"{execution_id}.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )

    def _move_item(self, name: str, source: str, target: str, status: str = "success") -> dict:
        return {
            "action_type": "MOVE",
            "status": status,
            "message": "",
            "raw": "",
            "source_before": source,
            "target_after": target,
            "display_name": name,
            "item_id": None,
        }

    def test_search_finds_moved_file_by_name_fragment(self):
        inbox = (self.root / "Inbox").resolve()
        self._write_journal(
            "exec1",
            "2026-07-01T00:00:00+00:00",
            [
                self._move_item("Invoice_2024.pdf", str(inbox / "Invoice_2024.pdf"), str(inbox / "Docs" / "Invoice_2024.pdf")),
                self._move_item("photo.jpg", str(inbox / "photo.jpg"), str(inbox / "Pics" / "photo.jpg")),
            ],
        )

        result = self.service.history_app.search_file_history("invoice")

        self.assertEqual(len(result["matches"]), 1)
        match = result["matches"][0]
        self.assertEqual(match["display_name"], "Invoice_2024.pdf")
        self.assertEqual(Path(match["current_path"]), inbox / "Docs" / "Invoice_2024.pdf")
        self.assertEqual(match["execution_id"], "exec1")
        self.assertEqual(match["moved_at"], "2026-07-01T00:00:00+00:00")
        self.assertEqual(match["status"], "success")

    def test_search_skipped_item_stays_at_source(self):
        inbox = (self.root / "Inbox").resolve()
        self._write_journal(
            "exec2",
            "2026-07-02T00:00:00+00:00",
            [
                self._move_item("report.docx", str(inbox / "report.docx"), str(inbox / "Docs" / "report.docx"), status="skipped"),
            ],
        )

        result = self.service.history_app.search_file_history("report")

        match = result["matches"][0]
        self.assertEqual(match["status"], "skipped")
        self.assertEqual(Path(match["current_path"]), inbox / "report.docx")

    def test_search_reflects_successful_rollback(self):
        inbox = (self.root / "Inbox").resolve()
        moved_target = inbox / "Docs" / "notes.md"
        self._write_journal(
            "exec3",
            "2026-07-03T00:00:00+00:00",
            [self._move_item("notes.md", str(inbox / "notes.md"), str(moved_target))],
            rollback_attempts=[
                {
                    "success_count": 1,
                    "failure_count": 0,
                    "results": [
                        {
                            "action_type": "MOVE",
                            "source": moved_target.as_posix(),
                            "target": (inbox / "notes.md").as_posix(),
                            "status": "success",
                        }
                    ],
                }
            ],
        )

        result = self.service.history_app.search_file_history("notes")

        match = result["matches"][0]
        self.assertEqual(Path(match["current_path"]), inbox / "notes.md")
        self.assertEqual(match["status"], "rolled_back")

    def test_search_sorts_newest_first_and_limits(self):
        inbox = (self.root / "Inbox").resolve()
        for index in range(3):
            self._write_journal(
                f"exec-sort-{index}",
                f"2026-07-0{index + 1}T00:00:00+00:00",
                [self._move_item(f"data_{index}.csv", str(inbox / f"data_{index}.csv"), str(inbox / "Data" / f"data_{index}.csv"))],
            )

        result = self.service.history_app.search_file_history("data", limit=2)

        self.assertEqual(result["total"], 3)
        self.assertEqual(len(result["matches"]), 2)
        self.assertEqual(result["matches"][0]["execution_id"], "exec-sort-2")

    def test_search_empty_query_returns_nothing(self):
        result = self.service.history_app.search_file_history("   ")
        self.assertEqual(result["matches"], [])
