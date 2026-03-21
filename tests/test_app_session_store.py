import json
import shutil
import unittest
from pathlib import Path

from file_organizer.app.models import OrganizerSession
from file_organizer.app.session_store import SessionStore
from file_organizer.shared.path_utils import canonical_target_dir


class CanonicalTargetDirTests(unittest.TestCase):
    def test_canonical_target_dir_normalizes_case_and_separators(self):
        left = canonical_target_dir("D:/Demo/Inbox/")
        right = canonical_target_dir(r"d:\demo\inbox")

        self.assertEqual(left, right)


class SessionStoreTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_sessions")
        self.target_dir = self.root / "Inbox"
        self.target_dir.mkdir(parents=True, exist_ok=True)
        self.store = SessionStore(self.root / "sessions")

    def tearDown(self):
        if self.root.exists():
            shutil.rmtree(self.root)

    def test_create_save_and_load_round_trip(self):
        session = self.store.create(self.target_dir)
        session.summary = "working"

        self.store.save(session)
        loaded = self.store.load(session.session_id)

        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.session_id, session.session_id)
        self.assertEqual(loaded.summary, "working")

    def test_find_latest_by_directory_returns_saved_session(self):
        session = self.store.create(self.target_dir)
        self.store.save(session)

        latest = self.store.find_latest_by_directory(self.target_dir)

        self.assertIsNotNone(latest)
        self.assertEqual(latest.session_id, session.session_id)

    def test_acquire_and_release_directory_lock(self):
        first = self.store.acquire_directory_lock(self.target_dir, "sess-1")
        second = self.store.acquire_directory_lock(self.target_dir, "sess-2")

        self.assertTrue(first.acquired)
        self.assertFalse(second.acquired)
        self.assertEqual(second.lock_owner_session_id, "sess-1")

        self.store.release_directory_lock(self.target_dir, "sess-1")
        third = self.store.acquire_directory_lock(self.target_dir, "sess-2")
        self.assertTrue(third.acquired)

    def test_terminal_owner_lock_can_be_reclaimed(self):
        terminal = OrganizerSession(session_id="sess-1", target_dir=canonical_target_dir(self.target_dir), stage="completed")
        self.store.save(terminal)
        self.store.acquire_directory_lock(self.target_dir, terminal.session_id)

        reclaimed = self.store.acquire_directory_lock(self.target_dir, "sess-2")

        self.assertTrue(reclaimed.acquired)
        self.assertEqual(reclaimed.reason, "reclaimed_stale_lock")

    def test_write_latest_index_is_atomic_json(self):
        session = self.store.create(self.target_dir)
        self.store.save(session)

        index_path = self.store.latest_index_path
        payload = json.loads(index_path.read_text(encoding="utf-8"))

        self.assertEqual(payload[canonical_target_dir(str(self.target_dir))], session.session_id)


if __name__ == "__main__":
    unittest.main()
