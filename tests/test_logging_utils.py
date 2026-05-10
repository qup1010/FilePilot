import json
import logging
import shutil
import unittest
from pathlib import Path

from file_pilot.shared.logging_utils import append_debug_event, setup_backend_logging


class LoggingUtilsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_logging_utils")
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        logging.shutdown()
        for logger_name in ("", "uvicorn", "uvicorn.error", "uvicorn.access", "file_pilot"):
            logger = logging.getLogger(logger_name)
            for handler in list(logger.handlers):
                logger.removeHandler(handler)
                try:
                    handler.close()
                except Exception:
                    pass
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)

    def test_setup_backend_logging_creates_runtime_log(self):
        log_dir = self.root / "logs" / "backend"
        runtime_log = setup_backend_logging(log_dir=log_dir)

        logging.getLogger("file_pilot.tests").info("runtime log smoke test")

        self.assertEqual(runtime_log, log_dir / "runtime.log")
        self.assertTrue(runtime_log.exists())
        content = runtime_log.read_text(encoding="utf-8")
        self.assertIn("runtime log smoke test", content)

    def test_append_debug_event_skips_file_when_disabled(self):
        debug_path = self.root / "logs" / "backend" / "debug.jsonl"

        result = append_debug_event(
            kind="test.disabled",
            payload={"ok": False},
            enabled=False,
            path=debug_path,
        )

        self.assertIsNone(result)
        self.assertFalse(debug_path.exists())

    def test_append_debug_event_writes_jsonl_and_masks_sensitive_fields(self):
        debug_path = self.root / "logs" / "backend" / "debug.jsonl"

        append_debug_event(
            kind="test.enabled",
            session_id="session-1",
            target_dir="/tmp/demo",
            stage="planning",
            enabled=True,
            path=debug_path,
            payload={
                "api_key": "sk-test-secret-123456",
                "headers": {"Authorization": "Bearer super-secret-token"},
                "nested": {"service_token": "top-secret"},
                "message": "Authorization: Bearer super-secret-token and sk-test-secret-123456",
            },
        )

        self.assertTrue(debug_path.exists())
        raw = debug_path.read_text(encoding="utf-8")
        entry = json.loads(raw.strip())

        self.assertEqual(entry["kind"], "test.enabled")
        self.assertEqual(entry["session_id"], "session-1")
        self.assertEqual(entry["payload"]["api_key"], "[REDACTED]")
        self.assertEqual(entry["payload"]["headers"]["Authorization"], "[REDACTED]")
        self.assertEqual(entry["payload"]["nested"]["service_token"], "[REDACTED]")
        self.assertIn("Bearer [REDACTED]", entry["payload"]["message"])
        self.assertIn("sk-[REDACTED]", entry["payload"]["message"])
        self.assertNotIn("super-secret-token", raw)
        self.assertNotIn("sk-test-secret-123456", raw)


if __name__ == "__main__":
    unittest.main()
