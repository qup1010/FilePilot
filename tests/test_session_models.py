import unittest

from file_pilot.app.id_registry import IdRegistry, IdRegistryState
from file_pilot.app.models import OrganizerSession
from file_pilot.domain.models import SourceRef, TargetSlot


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

    def test_id_registry_state_roundtrips_with_session_payload(self):
        session = OrganizerSession(
            session_id="s1",
            target_dir="D:/workspace/Inbox",
            id_registry_state=IdRegistryState(
                source_ids_by_relpath={"a.txt": "F007"},
                target_ids_by_real_path={"D:/workspace/Inbox/Docs": "D009"},
                next_source_number=8,
                next_target_number=10,
            ),
        )

        restored = OrganizerSession.from_dict(session.to_dict())

        self.assertIsNotNone(restored.id_registry_state)
        assert restored.id_registry_state is not None
        self.assertEqual(restored.id_registry_state.source_ids_by_relpath["a.txt"], "F007")
        self.assertEqual(restored.id_registry_state.target_ids_by_real_path["D:/workspace/Inbox/Docs"], "D009")
        self.assertEqual(restored.id_registry_state.next_source_number, 8)
        self.assertEqual(restored.id_registry_state.next_target_number, 10)

    def test_id_registry_preserves_existing_ids_and_appends_new_ids(self):
        registry = IdRegistry.from_state(
            IdRegistryState(
                source_ids_by_relpath={"old.txt": "F003"},
                target_ids_by_real_path={"D:/workspace/Inbox/Docs": "D004"},
                next_source_number=4,
                next_target_number=5,
            )
        )

        old_source = registry.register_source(
            SourceRef(
                ref_id="F001",
                display_name="old.txt",
                entry_type="file",
                origin="D:/workspace/Inbox",
                relpath="old.txt",
            )
        )
        new_source = registry.register_source(
            SourceRef(
                ref_id="F001",
                display_name="new.txt",
                entry_type="file",
                origin="D:/workspace/Inbox",
                relpath="new.txt",
            )
        )
        old_target = registry.register_target(
            TargetSlot(
                slot_id="D001",
                display_name="Docs",
                real_path="D:/workspace/Inbox/Docs",
            )
        )
        new_target = registry.ensure_target(
            display_name="Images",
            real_path="D:/workspace/Inbox/Images",
        )

        self.assertEqual(old_source.ref_id, "F003")
        self.assertEqual(new_source.ref_id, "F004")
        self.assertEqual(old_target.slot_id, "D004")
        self.assertEqual(new_target.slot_id, "D005")

        state = registry.to_state()
        self.assertEqual(state.source_ids_by_relpath["old.txt"], "F003")
        self.assertEqual(state.source_ids_by_relpath["new.txt"], "F004")
        self.assertEqual(state.target_ids_by_real_path["D:/workspace/Inbox/Docs"], "D004")
        self.assertEqual(state.target_ids_by_real_path["D:/workspace/Inbox/Images"], "D005")


if __name__ == "__main__":
    unittest.main()
