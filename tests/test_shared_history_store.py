import json
import shutil
import unittest
from pathlib import Path

from file_pilot.shared import history_store


class HistoryStoreTests(unittest.TestCase):
    def setUp(self):
        self.history_root = Path("test_temp_shared_history")
        self.executions_dir = self.history_root / "executions"
        self.latest_path = self.history_root / "latest_by_directory.json"
        if self.history_root.exists():
            shutil.rmtree(self.history_root)

    def tearDown(self):
        if self.history_root.exists():
            shutil.rmtree(self.history_root)

    def test_read_latest_index_returns_empty_dict_when_file_missing(self):
        latest_index = history_store.read_latest_index(self.latest_path, self.executions_dir)

        self.assertEqual(latest_index, {})
        self.assertTrue(self.executions_dir.exists())
        self.assertTrue(self.latest_path.exists())

    def test_write_latest_index_persists_json_payload(self):
        payload = {"D:/Downloads": "exec-1"}

        history_store.write_latest_index(payload, self.latest_path, self.executions_dir)

        saved = json.loads(self.latest_path.read_text(encoding="utf-8"))
        self.assertEqual(saved, payload)

    def test_build_journal_path_uses_execution_directory(self):
        journal_path = history_store.build_journal_path("exec-1", self.executions_dir)

        self.assertEqual(journal_path, self.executions_dir / "exec-1.json")


if __name__ == "__main__":
    unittest.main()
