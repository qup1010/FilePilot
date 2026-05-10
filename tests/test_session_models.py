import unittest

from file_pilot.app.models import OrganizerSession


class SessionModelTests(unittest.TestCase):
    def test_to_dict_backfills_nested_state_shapes(self):
        session = OrganizerSession(
            session_id="s1",
            target_dir="D:/workspace/Inbox",
            planner_items=[
                {
                    "planner_id": "F001",
                    "source_relpath": "md",
                    "display_name": "md",
                    "entry_type": "file",
                    "suggested_purpose": "学习资料",
                    "summary": "笔记",
                    "confidence": 0.9,
                    "ext": "md",
                }
            ],
            scanner_progress={"status": "completed"},
            planner_progress={"status": "idle"},
            messages=[{"role": "assistant", "content": "hello"}],
        )

        payload = session.to_dict()

        self.assertIn("task_state", payload)
        self.assertIn("conversation_state", payload)
        self.assertIn("execution_state", payload)
        self.assertEqual(payload["task_state"]["sources"][0]["ref_id"], "F001")
        self.assertEqual(payload["conversation_state"]["messages"][0]["content"], "hello")


if __name__ == "__main__":
    unittest.main()
