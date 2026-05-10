import json
import os
import shutil
import unittest
from pathlib import Path

from file_pilot.api.runtime import clear_backend_runtime, write_backend_runtime


class BackendRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_runtime")
        self.path = self.root / "runtime" / "backend.json"

    def tearDown(self):
        if self.root.exists():
            shutil.rmtree(self.root)

    def test_write_backend_runtime_persists_base_url_payload(self):
        write_backend_runtime(
            "http://127.0.0.1:8765",
            "127.0.0.1",
            8765,
            pid=1234,
            instance_id="desktop-instance",
            path=self.path,
        )

        payload = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(payload["base_url"], "http://127.0.0.1:8765")
        self.assertEqual(payload["host"], "127.0.0.1")
        self.assertEqual(payload["port"], 8765)
        self.assertEqual(payload["pid"], 1234)
        self.assertEqual(payload["instance_id"], "desktop-instance")
        self.assertIn("started_at", payload)

    def test_clear_backend_runtime_removes_file(self):
        write_backend_runtime(
            "http://127.0.0.1:8765",
            "127.0.0.1",
            8765,
            pid=os.getpid(),
            path=self.path,
        )

        clear_backend_runtime(self.path)

        self.assertFalse(self.path.exists())

    def test_clear_backend_runtime_keeps_file_owned_by_other_process(self):
        write_backend_runtime(
            "http://127.0.0.1:8765",
            "127.0.0.1",
            8765,
            pid=999999,
            instance_id="other-instance",
            path=self.path,
        )

        clear_backend_runtime(self.path, pid=1234, instance_id="desktop-instance")

        self.assertTrue(self.path.exists())


if __name__ == "__main__":
    unittest.main()
