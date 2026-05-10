import unittest
from pathlib import Path

from file_pilot.execution import service as execution_service
from file_pilot.organize.models import FinalPlan, PlanMove


class StructuredExecutionPlanTests(unittest.TestCase):
    def test_build_execution_plan_accepts_structured_final_plan(self):
        base_dir = Path("D:/demo")
        final_plan = FinalPlan(
            directories=["Finance"],
            moves=[PlanMove(source="合同.pdf", target="Finance/合同.pdf")],
            unresolved_items=[],
            summary="已整理财务文件",
        )

        plan = execution_service.build_execution_plan(final_plan, base_dir)

        self.assertEqual(plan.base_dir, base_dir.resolve())
        self.assertEqual(plan.mkdir_actions[0].raw, 'MKDIR "Finance"')
        self.assertEqual(plan.move_actions[0].raw, 'MOVE "合同.pdf" "Finance/合同.pdf"')
        self.assertEqual(plan.move_actions[0].target, base_dir.resolve() / "Finance" / "合同.pdf")


if __name__ == "__main__":
    unittest.main()
