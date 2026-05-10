import shutil
import time
import unittest
from pathlib import Path

from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore


class SessionLifecycleServiceTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_session_lifecycle_service")
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

    def test_abandon_session_via_lifecycle_releases_lock(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)

        self.service.lifecycle.abandon_session(created.session.session_id)
        replacement = self.service.create_session(str(self.target_dir), resume_if_exists=False)

        self.assertEqual(replacement.mode, "created")
        self.assertNotEqual(replacement.session.session_id, created.session.session_id)

    def test_abandon_session_rejects_active_scanning_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "scanning"
        self.store.save(session)
        self.service._mark_scan_active(session.session_id)

        try:
            with self.assertRaisesRegex(RuntimeError, "SESSION_LOCKED"):
                self.service.lifecycle.abandon_session(session.session_id)
        finally:
            self.service._mark_scan_inactive(session.session_id)

        persisted = self.store.load(session.session_id)
        self.assertEqual(persisted.stage, "scanning")

    def test_resume_session_via_lifecycle_marks_stale_when_directory_changes(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "a.txt | 文档 | A"
        self.store.save(session)
        (self.target_dir / "b.txt").write_text("new", encoding="utf-8")

        resumed = self.service.lifecycle.resume_session(session.session_id)

        self.assertEqual(resumed.stage, "stale")
        self.assertEqual(resumed.stale_reason, "directory_changed")

    def test_resume_session_keeps_active_scanning_session_running(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "scanning"
        session.scanner_progress = {"status": "running", "total_count": 1, "processed_count": 0}
        self.store.save(session)
        self.service._mark_scan_active(session.session_id)
        (self.target_dir / "new.txt").write_text("new", encoding="utf-8")

        try:
            resumed = self.service.lifecycle.resume_session(session.session_id)
        finally:
            self.service._mark_scan_inactive(session.session_id)

        self.assertEqual(resumed.stage, "scanning")
        self.assertNotIn("interrupted_during", resumed.integrity_flags)
        self.assertEqual(resumed.scanner_progress["status"], "running")

    def test_resume_session_keeps_active_executing_session_running(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "executing"
        self.store.save(session)
        self.service._mark_locked_stage_active(session.session_id, "executing")

        try:
            resumed = self.service.lifecycle.resume_session(session.session_id)
        finally:
            self.service._mark_locked_stage_inactive(session.session_id, "executing")

        self.assertEqual(resumed.stage, "executing")
        self.assertNotIn("interrupted_during", resumed.integrity_flags)
