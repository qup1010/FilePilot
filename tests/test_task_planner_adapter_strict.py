import unittest

from file_pilot.app.task_planner_adapter import TaskPlannerAdapter
from file_pilot.domain.models import OrganizeTask, SourceRef, TargetSlot
from file_pilot.organize.models import PendingPlan, PlanMove


def _task(base: str) -> OrganizeTask:
    return OrganizeTask(
        task_id="t1",
        sources=[
            SourceRef(ref_id="F001", display_name="x.pdf", entry_type="file", origin=base, relpath="x.pdf"),
        ],
        targets=[TargetSlot(slot_id="D001", display_name="Docs", real_path=f"{base}/Docs")],
    )


class StrictTargetAdapterTests(unittest.TestCase):
    def test_strict_adapter_downgrades_out_of_pool_target_to_unresolved(self):
        base = "D:/test_strict_base"
        adapter = TaskPlannerAdapter(base, strict_targets=True)

        updated = adapter.apply_pending_plan(
            _task(base),
            PendingPlan(moves=[PlanMove(source="x.pdf", target="Other/x.pdf")], unresolved_items=[]),
        )

        mapping = updated.mappings[0]
        self.assertEqual(mapping.status, "unresolved")
        self.assertEqual(mapping.target_slot_id, "Review")
        # 目录池没有被扩：仍然只有用户配置的 Docs
        self.assertEqual([slot.slot_id for slot in updated.targets], ["D001"])

    def test_strict_adapter_accepts_pool_target(self):
        base = "D:/test_strict_base"
        adapter = TaskPlannerAdapter(base, strict_targets=True)

        updated = adapter.apply_pending_plan(
            _task(base),
            PendingPlan(moves=[PlanMove(source="x.pdf", target="Docs/x.pdf")], unresolved_items=[]),
        )

        mapping = updated.mappings[0]
        self.assertEqual(mapping.status, "assigned")
        self.assertEqual(mapping.target_slot_id, "D001")

    def test_non_strict_adapter_still_extends_pool(self):
        base = "D:/test_strict_base"
        adapter = TaskPlannerAdapter(base, strict_targets=False)

        updated = adapter.apply_pending_plan(
            _task(base),
            PendingPlan(moves=[PlanMove(source="x.pdf", target="Other/x.pdf")], unresolved_items=[]),
        )

        mapping = updated.mappings[0]
        self.assertEqual(mapping.status, "assigned")
        self.assertEqual(len(updated.targets), 2)
