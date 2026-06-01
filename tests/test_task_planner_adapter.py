import unittest

from file_pilot.app.task_planner_adapter import TaskPlannerAdapter
from file_pilot.domain.models import MappingEntry, OrganizeTask, SourceRef, TargetSlot
from file_pilot.organize.models import PendingPlan, PlanMove


class TaskPlannerAdapterTests(unittest.TestCase):
    def setUp(self):
        self.adapter = TaskPlannerAdapter("D:/workspace/Inbox")
        self.base_task = OrganizeTask(
            task_id="task-1",
            sources=[
                SourceRef(
                    ref_id="F001",
                    display_name="md",
                    entry_type="file",
                    origin="D:/workspace/Inbox",
                    relpath="md",
                    suggested_purpose="学习资料",
                )
            ],
            targets=[
                TargetSlot(
                    slot_id="D001",
                    display_name="Docs",
                    real_path="D:/workspace/Inbox/Docs",
                    depth=0,
                    is_new=False,
                )
            ],
            mappings=[
                MappingEntry(
                    source_ref_id="F001",
                    target_slot_id="D001",
                    status="assigned",
                    user_overridden=False,
                )
            ],
            strategy={},
            user_constraints=[],
            phase="planning",
        )

    def test_roundtrip_pending_plan_preserves_target_slot(self):
        pending = self.adapter.to_pending_plan(self.base_task)
        rebuilt = self.adapter.apply_pending_plan(self.base_task, pending)

        self.assertEqual(pending.moves[0].target, "Docs/md")
        self.assertEqual(rebuilt.mappings[0].target_slot_id, "D001")
        self.assertEqual(rebuilt.mappings[0].status, "assigned")

    def test_assign_mapping_creates_new_slot_and_review_mapping(self):
        updated = self.adapter.assign_mapping(self.base_task, source_relpath="md", target_dir="Docs/Notes")
        self.assertEqual(updated.mappings[0].status, "assigned")
        self.assertEqual(updated.mappings[0].target_slot_id, "D002")
        self.assertEqual(updated.targets[-1].real_path.replace("\\", "/"), "D:/workspace/Inbox/Docs/Notes")

        review_task = self.adapter.assign_mapping(updated, source_relpath="md", target_dir="Review")
        review_pending = self.adapter.to_pending_plan(review_task)

        self.assertEqual(review_task.mappings[0].target_slot_id, "Review")
        self.assertEqual(review_task.mappings[0].status, "review")
        self.assertEqual(review_pending.moves[0].target, "Review/md")

    def test_assign_mapping_preserves_first_ai_suggestion_until_restore(self):
        first_override = self.adapter.assign_mapping(self.base_task, source_relpath="md", target_dir="Docs/Notes")
        mapping = first_override.mappings[0]

        self.assertTrue(mapping.user_overridden)
        self.assertEqual(mapping.target_slot_id, "D002")
        self.assertEqual(mapping.original_target_slot_id, "D001")
        self.assertEqual(mapping.original_status, "assigned")
        self.assertTrue(mapping.overridden_at)

        second_override = self.adapter.assign_mapping(first_override, source_relpath="md", target_dir="Review")
        mapping = second_override.mappings[0]

        self.assertEqual(mapping.target_slot_id, "Review")
        self.assertEqual(mapping.status, "review")
        self.assertEqual(mapping.original_target_slot_id, "D001")
        self.assertEqual(mapping.original_status, "assigned")

        restored = self.adapter.restore_ai_mapping(second_override, source_relpath="md")
        mapping = restored.mappings[0]

        self.assertFalse(mapping.user_overridden)
        self.assertEqual(mapping.target_slot_id, "D001")
        self.assertEqual(mapping.status, "assigned")
        self.assertIsNone(mapping.original_target_slot_id)
        self.assertIsNone(mapping.original_status)
        self.assertIsNone(mapping.overridden_at)

    def test_restore_ai_mapping_rejects_mapping_without_original(self):
        with self.assertRaisesRegex(RuntimeError, "AI_SUGGESTION_NOT_FOUND"):
            self.adapter.restore_ai_mapping(self.base_task, source_relpath="md")

    def test_apply_pending_plan_defaults_unresolved_items_to_review(self):
        pending = PendingPlan(
            directories=[],
            moves=[PlanMove(source="md", target="md", raw="")],
            user_constraints=[],
            unresolved_items=["md"],
            summary="",
        )

        rebuilt = self.adapter.apply_pending_plan(self.base_task, pending)
        roundtrip = self.adapter.to_pending_plan(rebuilt)

        self.assertEqual(rebuilt.mappings[0].target_slot_id, "Review")
        self.assertEqual(rebuilt.mappings[0].status, "unresolved")
        self.assertEqual(roundtrip.moves[0].target, "Review/md")
        self.assertEqual(roundtrip.unresolved_items, ["md"])

    def test_apply_pending_plan_preserves_unresolved_items_without_moves(self):
        pending = PendingPlan(
            directories=[],
            moves=[],
            user_constraints=[],
            unresolved_items=["md"],
            summary="",
        )

        rebuilt = self.adapter.apply_pending_plan(self.base_task, pending)
        roundtrip = self.adapter.to_pending_plan(rebuilt)

        self.assertEqual(rebuilt.mappings[0].target_slot_id, "Review")
        self.assertEqual(rebuilt.mappings[0].status, "unresolved")
        self.assertEqual(roundtrip.moves[0].target, "Review/md")
        self.assertEqual(roundtrip.unresolved_items, ["md"])

    def test_roundtrip_pending_plan_preserves_absolute_target_slots_outside_base_dir(self):
        cross_root_task = OrganizeTask(
            task_id="task-abs",
            sources=[
                SourceRef(
                    ref_id="F001",
                    display_name="md",
                    entry_type="file",
                    origin="D:/workspace/Inbox",
                    relpath="md",
                    suggested_purpose="学习资料",
                )
            ],
            targets=[
                TargetSlot(
                    slot_id="D031",
                    display_name="项目文档",
                    real_path="D:/workspace/Projects/项目文档",
                    depth=1,
                    is_new=False,
                )
            ],
            mappings=[
                MappingEntry(
                    source_ref_id="F001",
                    target_slot_id="D031",
                    status="assigned",
                    user_overridden=False,
                )
            ],
            strategy={},
            user_constraints=[],
            phase="planning",
        )

        pending = self.adapter.to_pending_plan(cross_root_task)
        rebuilt = self.adapter.apply_pending_plan(cross_root_task, pending)

        self.assertEqual(pending.moves[0].target, "D:/workspace/Projects/项目文档/md")
        self.assertEqual(rebuilt.mappings[0].target_slot_id, "D031")
        self.assertEqual(rebuilt.mappings[0].status, "assigned")


if __name__ == "__main__":
    unittest.main()
