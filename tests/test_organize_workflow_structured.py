import unittest
from pathlib import Path
from unittest import mock

from file_organizer.organize.models import FinalPlan, PendingPlan, PlanMove
from file_organizer.workflows import organize_pipeline


class StructuredOrganizeWorkflowTests(unittest.TestCase):
    def test_run_organize_chat_shows_summary_view_for_pending_diff(self):
        organizer_module = mock.Mock()
        execution_module = mock.Mock()
        cli = mock.Mock()

        organizer_module.build_initial_messages.return_value = []
        organizer_module.run_organizer_cycle.side_effect = [
            (
                "先给你看摘要。",
                {
                    "is_valid": False,
                    "pending_plan": PendingPlan(
                        directories=["Finance", "Review"],
                        moves=[
                            PlanMove(source="合同.pdf", target="Finance/合同.pdf"),
                            PlanMove(source="截图1.png", target="Review/截图1.png"),
                        ],
                        unresolved_items=["截图1.png"],
                        summary="已形成初版方案",
                    ),
                    "diff_summary": ["新增目录：Finance"],
                    "display_plan": {"focus": "summary", "summary": "已形成初版方案"},
                    "final_plan": None,
                    "repair_mode": False,
                    "user_constraints": [],
                },
            ),
            KeyboardInterrupt,
        ]
        cli.prompt_feedback.return_value = "继续调整"

        organize_pipeline.run_organize_chat(
            "scan lines",
            Path("D:/demo"),
            organizer_module=organizer_module,
            execution_module=execution_module,
            cli=cli,
        )

        execution_module.build_execution_plan.assert_not_called()
        cli.show_plan_diff.assert_not_called()
        cli.show_pending_plan.assert_called_once()
        self.assertEqual(cli.show_pending_plan.call_args.kwargs["focus"], "summary")

    def test_run_organize_chat_handles_view_details_locally_without_second_model_round(self):
        organizer_module = mock.Mock()
        execution_module = mock.Mock()
        cli = mock.Mock()
        pending_plan = PendingPlan(
            directories=["Finance", "Review"],
            moves=[
                PlanMove(source="合同.pdf", target="Finance/合同.pdf"),
                PlanMove(source="截图1.png", target="Review/截图1.png"),
            ],
            unresolved_items=["截图1.png"],
            summary="已形成初版方案",
        )

        organizer_module.build_initial_messages.return_value = []
        organizer_module.run_organizer_cycle.return_value = (
            "先给你看摘要。",
            {
                "is_valid": False,
                "pending_plan": pending_plan,
                "diff_summary": ["新增目录：Finance"],
                "display_plan": {"focus": "summary", "summary": "已形成初版方案"},
                "final_plan": None,
                "repair_mode": False,
                "user_constraints": [],
            },
        )
        cli.prompt_feedback.side_effect = ["看明细", "quit"]

        organize_pipeline.run_organize_chat(
            "scan lines",
            Path("D:/demo"),
            organizer_module=organizer_module,
            execution_module=execution_module,
            cli=cli,
        )

        organizer_module.run_organizer_cycle.assert_called_once()
        self.assertEqual(cli.show_pending_plan.call_count, 2)
        self.assertEqual(cli.show_pending_plan.call_args_list[0].kwargs["focus"], "summary")
        self.assertEqual(cli.show_pending_plan.call_args_list[1].kwargs["focus"], "details")

    def test_run_organize_chat_auto_resolves_review_unresolved_items_before_execution(self):
        organizer_module = mock.Mock()
        execution_module = mock.Mock()
        cli = mock.Mock()
        pending_plan = PendingPlan(
            directories=["Finance", "Review"],
            moves=[
                PlanMove(source="合同.pdf", target="Finance/合同.pdf"),
                PlanMove(source="截图1.png", target="Review/截图1.png"),
            ],
            unresolved_items=["截图1.png"],
            summary="还剩一个可默认归入 Review 的待确认项",
        )
        built_plan = mock.Mock(base_dir=Path("D:/demo"), mkdir_actions=[], move_actions=[])
        precheck = mock.Mock(can_execute=True, blocking_errors=[], warnings=[])

        organizer_module.build_initial_messages.return_value = []
        organizer_module.run_organizer_cycle.return_value = (
            "先给你看摘要。",
            {
                "is_valid": False,
                "pending_plan": pending_plan,
                "diff_summary": [],
                "display_plan": {"focus": "summary", "summary": pending_plan.summary},
                "final_plan": None,
                "repair_mode": False,
                "user_constraints": [],
            },
        )
        organizer_module.validate_final_plan.return_value = {"is_valid": True}
        execution_module.build_execution_plan.return_value = built_plan
        execution_module.validate_execution_preconditions.return_value = precheck
        cli.prompt_feedback.side_effect = ["执行", "quit"]
        cli.prompt_confirmation.return_value = "quit"

        organize_pipeline.run_organize_chat(
            "合同.pdf | 财务/合同 | 付款协议\n截图1.png | 截图记录 | 报错界面",
            Path("D:/demo"),
            organizer_module=organizer_module,
            execution_module=execution_module,
            cli=cli,
        )

        execution_module.build_execution_plan.assert_called_once()
        final_plan_arg = execution_module.build_execution_plan.call_args.args[0]
        self.assertIsInstance(final_plan_arg, FinalPlan)
        self.assertEqual(final_plan_arg.unresolved_items, [])
        cli.prompt_confirmation.assert_called_once()

    def test_run_organize_chat_blocks_execution_for_non_review_unresolved_items(self):
        organizer_module = mock.Mock()
        execution_module = mock.Mock()
        cli = mock.Mock()
        pending_plan = PendingPlan(
            directories=["Finance", "Screenshots"],
            moves=[
                PlanMove(source="合同.pdf", target="Finance/合同.pdf"),
                PlanMove(source="截图1.png", target="Screenshots/截图1.png"),
            ],
            unresolved_items=["截图1.png"],
            summary="截图用途还需要确认",
        )

        organizer_module.build_initial_messages.return_value = []
        organizer_module.run_organizer_cycle.return_value = (
            "先给你看摘要。",
            {
                "is_valid": False,
                "pending_plan": pending_plan,
                "diff_summary": [],
                "display_plan": {"focus": "summary", "summary": pending_plan.summary},
                "final_plan": None,
                "repair_mode": False,
                "user_constraints": [],
            },
        )
        cli.prompt_feedback.side_effect = ["执行", "quit"]

        organize_pipeline.run_organize_chat(
            "scan lines",
            Path("D:/demo"),
            organizer_module=organizer_module,
            execution_module=execution_module,
            cli=cli,
        )

        execution_module.build_execution_plan.assert_not_called()
        cli.warning.assert_called()

    def test_run_organize_chat_builds_execution_plan_from_structured_final_plan(self):
        organizer_module = mock.Mock()
        execution_module = mock.Mock()
        cli = mock.Mock()
        final_plan = FinalPlan(
            directories=["Finance"],
            moves=[PlanMove(source="合同.pdf", target="Finance/合同.pdf")],
            unresolved_items=[],
            summary="已完成财务整理",
        )
        precheck = mock.Mock(can_execute=True, blocking_errors=[], warnings=[])
        report = mock.Mock()
        built_plan = mock.Mock(base_dir=Path("D:/demo"), mkdir_actions=[], move_actions=[])

        organizer_module.build_initial_messages.return_value = []
        organizer_module.run_organizer_cycle.return_value = (
            "建议已经确认。",
            {
                "is_valid": True,
                "pending_plan": PendingPlan(),
                "diff_summary": ["新增目录：Finance"],
                "display_plan": None,
                "final_plan": final_plan,
                "repair_mode": False,
                "user_constraints": [],
            },
        )
        execution_module.build_execution_plan.return_value = built_plan
        execution_module.validate_execution_preconditions.return_value = precheck
        execution_module.execute_plan.return_value = report
        cli.prompt_confirmation.return_value = "YES"

        organize_pipeline.run_organize_chat(
            "scan lines",
            Path("D:/demo"),
            organizer_module=organizer_module,
            execution_module=execution_module,
            cli=cli,
        )

        execution_module.build_execution_plan.assert_called_once_with(final_plan, Path("D:/demo"))
        cli.show_plan_diff.assert_called_once()
        cli.show_execution_preview.assert_called_once_with(built_plan, precheck)
        cli.show_execution_report.assert_called_once_with(report, built_plan.base_dir)


if __name__ == "__main__":
    unittest.main()

