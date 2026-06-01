import unittest
from pathlib import Path

from file_pilot.app.target_slot_registry import TargetSlotRegistry
from file_pilot.domain.models import TargetSlot


class TargetSlotRegistryTests(unittest.TestCase):
    def setUp(self):
        self.base_dir = Path("D:/workspace/Inbox")
        self.targets = [
            TargetSlot(
                slot_id="D001",
                display_name="Docs",
                real_path="D:/workspace/Inbox/Docs",
                depth=0,
                is_new=False,
            ),
            TargetSlot(
                slot_id="D009",
                display_name="Archive",
                real_path="D:/workspace/Inbox/Archive",
                depth=0,
                is_new=False,
            ),
        ]
        self.registry = TargetSlotRegistry(self.base_dir, self.targets)

    def test_ensure_slot_reuses_existing_real_path(self):
        slot_id = self.registry.ensure_slot("Docs")

        self.assertEqual(slot_id, "D001")
        self.assertEqual([target.slot_id for target in self.targets], ["D001", "D009"])

    def test_ensure_slot_appends_without_reordering_existing_slots(self):
        slot_id = self.registry.ensure_slot("Projects/Active")

        self.assertEqual(slot_id, "D010")
        self.assertEqual([target.slot_id for target in self.targets], ["D001", "D009", "D010"])
        self.assertEqual(self.targets[-1].display_name, "Active")
        self.assertEqual(self.targets[-1].depth, 1)
        self.assertTrue(self.targets[-1].is_new)

    def test_ensure_slot_handles_review_and_empty_targets(self):
        self.assertEqual(self.registry.ensure_slot(""), "")
        self.assertEqual(self.registry.ensure_slot("Review"), "Review")
        self.assertEqual([target.slot_id for target in self.targets], ["D001", "D009"])

    def test_directory_for_slot_returns_relative_or_absolute_directory(self):
        external = TargetSlot(
            slot_id="D031",
            display_name="External",
            real_path="D:/workspace/Archive/External",
            depth=1,
            is_new=False,
        )
        self.targets.append(external)

        self.assertEqual(self.registry.directory_for_slot("D001"), "Docs")
        self.assertEqual(self.registry.directory_for_slot("Review"), "Review")
        self.assertEqual(self.registry.directory_for_slot("D031"), "D:/workspace/Archive/External")
        self.assertEqual(self.registry.directory_for_slot("missing"), "")


if __name__ == "__main__":
    unittest.main()
