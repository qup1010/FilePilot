import threading
import time
import unittest
from pathlib import Path

from file_pilot.app.async_scanner import AsyncScanner


class AsyncScannerTests(unittest.TestCase):
    def test_start_keeps_backward_compat_without_cancel_argument(self):
        scanner = AsyncScanner()
        done = threading.Event()
        result_holder: dict[str, object] = {}

        def run_scan(_target_dir: Path):
            return "ok"

        def on_complete(_session_id: str, result: str):
            result_holder["result"] = result
            done.set()

        def on_error(_session_id: str, exc: Exception):
            result_holder["error"] = exc
            done.set()

        scanner.start("session-compat", Path("."), run_scan, on_complete, on_error)
        self.assertTrue(done.wait(1.0))
        self.assertEqual(result_holder.get("result"), "ok")
        self.assertNotIn("error", result_holder)

    def test_cancel_sets_event_for_running_scan(self):
        scanner = AsyncScanner()
        done = threading.Event()
        result_holder: dict[str, object] = {}

        def run_scan(_target_dir: Path, cancel_event: threading.Event | None = None):
            while cancel_event is not None and not cancel_event.is_set():
                time.sleep(0.01)
            raise RuntimeError("scan_cancelled")

        def on_complete(_session_id: str, result: str):
            result_holder["result"] = result
            done.set()

        def on_error(_session_id: str, exc: Exception):
            result_holder["error"] = exc
            done.set()

        scanner.start("session-cancel", Path("."), run_scan, on_complete, on_error)
        time.sleep(0.05)
        scanner.cancel("session-cancel")
        self.assertTrue(done.wait(2.0))
        self.assertIn("error", result_holder)
        self.assertEqual(str(result_holder["error"]), "scan_cancelled")


if __name__ == "__main__":
    unittest.main()
