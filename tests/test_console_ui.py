import unittest
from io import StringIO
from pathlib import Path
from unittest import mock

from rich.console import Console

from file_organizer.cli.console import CLI
from file_organizer.execution.models import (
    ExecutionAction,
    ExecutionItemResult,
    ExecutionPlan,
    ExecutionReport,
    PrecheckResult,
)
from file_organizer.organize.models import PendingPlan, PlanMove
from file_organizer.rollback.models import (
    RollbackAction,
    RollbackItemResult,
    RollbackReport,
)


class ConsoleUiTests(unittest.TestCase):
    def build_cli(self):
        buffer = StringIO()
        console = Console(file=buffer, force_terminal=False, color_system=None, width=120)
        return CLI(console=console), buffer

    def test_waiting_indicator_starts_and_stops_status(self):
        status_handle = mock.Mock()
        console = mock.Mock()
        console.status.return_value = status_handle
        cli = CLI(console=console)

        cli.start_waiting("正在等待模型响应...")
        cli.stop_waiting()

        console.status.assert_called_once_with("[bold cyan]正在等待模型响应...[/]", spinner="dots", spinner_style="cyan")
        status_handle.start.assert_called_once_with()
        status_handle.stop.assert_called_once_with()

    def test_show_pending_plan_renders_summary_groups_and_unresolved_questions(self):
        cli, buffer = self.build_cli()
        plan = PendingPlan(
            directories=["Finance", "Review"],
            moves=[
                PlanMove(source="合同.pdf", target="Finance/合同.pdf"),
                PlanMove(source="截图1.png", target="Review/截图1.png"),
            ],
            unresolved_items=["截图1.png"],
            summary="已形成初版方案",
        )

        cli.show_pending_plan(plan, focus="summary", summary="请先确认目录结构")

        output = buffer.getvalue()
        self.assertIn("当前整理方案", output)
        self.assertIn("计划概览", output)
        self.assertIn("目标目录分组", output)
        self.assertIn("待确认问题", output)
        self.assertIn("Review", output)
        self.assertIn("若无异议", output)
        self.assertNotIn("目录列表", output)

    def test_show_execution_preview_renders_summary_and_rows(self):
        cli, buffer = self.build_cli()
        base_dir = Path("D:/demo")
        plan = ExecutionPlan(
            base_dir=base_dir,
            mkdir_actions=[ExecutionAction(type="MKDIR", target=base_dir / "Projects")],
            move_actions=[
                ExecutionAction(
                    type="MOVE",
                    source=base_dir / "合同.pdf",
                    target=base_dir / "Projects" / "合同.pdf",
                )
            ],
            all_actions=[],
        )
        precheck = PrecheckResult(can_execute=True)

        cli.show_execution_preview(plan, precheck)

        output = buffer.getvalue()
        self.assertIn("整理预检", output)
        self.assertIn("新建目录", output)
        self.assertIn("合同.pdf", output)

    def test_show_execution_preview_groups_by_target_directory_and_collapses_overflow(self):
        cli, buffer = self.build_cli()
        base_dir = Path("D:/demo")
        plan = ExecutionPlan(
            base_dir=base_dir,
            mkdir_actions=[],
            move_actions=[
                ExecutionAction(type="MOVE", source=base_dir / "a.txt", target=base_dir / "Projects" / "a.txt"),
                ExecutionAction(type="MOVE", source=base_dir / "b.txt", target=base_dir / "Projects" / "b.txt"),
                ExecutionAction(type="MOVE", source=base_dir / "c.txt", target=base_dir / "Projects" / "c.txt"),
                ExecutionAction(type="MOVE", source=base_dir / "d.txt", target=base_dir / "Projects" / "d.txt"),
                ExecutionAction(type="MOVE", source=base_dir / "invoice.pdf", target=base_dir / "Finance" / "invoice.pdf"),
            ],
            all_actions=[],
        )
        precheck = PrecheckResult(can_execute=True)

        cli.show_execution_preview(plan, precheck)

        output = buffer.getvalue()
        self.assertIn("Projects", output)
        self.assertIn("Finance", output)
        self.assertIn("其余 1 条已省略", output)

    def test_show_execution_report_renders_completion_banner(self):
        cli, buffer = self.build_cli()
        base_dir = Path("D:/demo")
        report = ExecutionReport(
            success_count=2,
            failure_count=0,
            results=[
                ExecutionItemResult(
                    action=ExecutionAction(type="MKDIR", target=base_dir / "Projects"),
                    status="success",
                    message="目录已创建",
                )
            ],
        )

        cli.show_execution_report(report, base_dir)

        output = buffer.getvalue()
        self.assertIn("执行已完成", output)
        self.assertIn("成功", output)

    def test_show_rollback_report_renders_summary_and_status(self):
        cli, buffer = self.build_cli()
        report = RollbackReport(
            success_count=1,
            failure_count=0,
            results=[
                RollbackItemResult(
                    action=RollbackAction(
                        type="MOVE",
                        source=Path("D:/demo/Docs/合同.pdf"),
                        target=Path("D:/demo/合同.pdf"),
                    ),
                    status="success",
                    message="回退移动成功",
                )
            ],
        )

        cli.show_rollback_report(report, Path("D:/demo"))

        output = buffer.getvalue()
        self.assertIn("回退结果", output)
        self.assertIn("success", output)
        self.assertIn("合同.pdf", output)


if __name__ == "__main__":
    unittest.main()
