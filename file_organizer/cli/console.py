from __future__ import annotations

from collections import defaultdict
from pathlib import Path, PurePosixPath

from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt
from rich.rule import Rule
from rich.table import Table
from rich.text import Text

from file_organizer.execution.models import ExecutionPlan, ExecutionReport, PrecheckResult
from file_organizer.organize.models import PendingPlan
from file_organizer.rollback.models import RollbackPlan, RollbackPrecheckResult, RollbackReport
from file_organizer.shared.path_utils import relative_display


class CLI:
    GROUP_PREVIEW_LIMIT = 3
    GROUP_PANEL_LIMIT = 8

    def __init__(self, console: Console | None = None):
        self.console = console or Console(highlight=False, soft_wrap=True)
        self._stream_section: str | None = None
        self._status = None

    def panel(self, title: str, content: str = "", style: str = "cyan") -> None:
        body = Text(content) if content else Text("")
        self.console.print(Panel(body, title=title, border_style=style, box=box.ROUNDED, expand=False))

    def stage(self, title: str, style: str = "cyan") -> None:
        self.console.print()
        self.console.print(Rule(Text(title, style=f"bold {style}"), style=style))

    def info(self, message: str, title: str = "信息") -> None:
        self.panel(title, message, style="blue")

    def success(self, message: str, title: str = "完成") -> None:
        self.panel(title, message, style="green")

    def warning(self, message: str, title: str = "注意") -> None:
        self.panel(title, message, style="yellow")

    def error(self, message: str, title: str = "错误") -> None:
        self.panel(title, message, style="red")

    def show_list(self, title: str, items: list[str], style: str = "yellow") -> None:
        if not items:
            return
        table = Table.grid(padding=(0, 1))
        table.add_column()
        for item in items:
            table.add_row(f"- {item}")
        self.console.print(Panel(table, title=title, border_style=style, box=box.ROUNDED, expand=False))

    def show_summary(self, title: str, rows: list[tuple[str, str]], style: str = "cyan") -> None:
        table = Table.grid(padding=(0, 2))
        table.add_column(style="bold")
        table.add_column()
        for label, value in rows:
            table.add_row(label, value)
        self.console.print(Panel(table, title=title, border_style=style, box=box.ROUNDED, expand=False))

    def show_app_header(self, project_root: Path, analysis_model: str, organizer_model: str) -> None:
        self.panel(
            "文件整理工作台",
            f"项目根目录: {project_root}\n当前模型 (分析 / 调整): {analysis_model} / {organizer_model}",
            style="blue",
        )

    def show_saved_result(self, result_path: Path) -> None:
        self.success(f"扫描结果已写入 {result_path}", title="扫描已完成")

    def _display_group_name(self, path: Path, base_dir: Path) -> str:
        display = relative_display(path, base_dir)
        return "根目录" if display in {"", "."} else display

    def show_plan_diff(self, items: list[str], title: str = "计划变化") -> None:
        if not items:
            return
        self.show_list(title, items, style="blue")

    def _pending_group_name(self, target: str) -> str:
        parent = PurePosixPath(target).parent.as_posix()
        return "根目录" if parent in {"", "."} else parent

    def _pending_groups(self, plan: PendingPlan) -> list[tuple[str, list[tuple[str, str]]]]:
        grouped: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for move in plan.moves:
            grouped[self._pending_group_name(move.target)].append((move.source, move.target))
        return sorted(grouped.items(), key=lambda item: (-len(item[1]), item[0].lower()))

    def _show_pending_group_summary(self, plan: PendingPlan) -> None:
        ordered_groups = self._pending_groups(plan)
        if not ordered_groups:
            return
        summary_rows = [(group_name, f"{len(items)} 项") for group_name, items in ordered_groups[: self.GROUP_PANEL_LIMIT]]
        remaining_groups = len(ordered_groups) - len(summary_rows)
        if remaining_groups > 0:
            summary_rows.append(("其他目录", f"{remaining_groups} 组已省略"))
        self.show_summary("目标目录分组", summary_rows, style="cyan")

    def _show_pending_move_details(self, plan: PendingPlan) -> None:
        for group_name, items in self._pending_groups(plan)[: self.GROUP_PANEL_LIMIT]:
            table = Table(box=box.SIMPLE_HEAVY, expand=False)
            table.add_column("序号", style="bold cyan", justify="right")
            table.add_column("源项目", style="white")
            table.add_column("目标路径", style="green")
            for index, (source_text, target_text) in enumerate(items[: self.GROUP_PREVIEW_LIMIT], start=1):
                table.add_row(str(index), source_text, target_text)

            hidden_count = len(items) - min(len(items), self.GROUP_PREVIEW_LIMIT)
            if hidden_count > 0:
                table.add_row("…", "", f"其余 {hidden_count} 条已省略")

            self.console.print(
                Panel(
                    table,
                    title=f"{group_name} ({len(items)} 项)",
                    border_style="cyan",
                    box=box.ROUNDED,
                    expand=False,
                )
            )

    def _format_unresolved_question(self, plan: PendingPlan, item: str) -> str:
        target_by_source = {move.source: move.target for move in plan.moves}
        target = target_by_source.get(item, f"Review/{item}")
        if target.startswith("Review/"):
            return f"{item}：当前默认归入 Review。若无异议，可继续下一步。"
        return f"{item}：当前暂归入 {self._pending_group_name(target)}。如需更精确的分类，请直接说明。"

    def show_pending_plan(self, plan: PendingPlan, *, focus: str = "summary", summary: str = "") -> None:
        self.panel("当前整理方案", summary or plan.summary or "请先查看整理摘要。", style="blue")
        self.show_summary(
            "计划概览",
            [("目录数", str(len(plan.directories))), ("移动数", str(len(plan.moves))), ("待确认", str(len(plan.unresolved_items)))],
            style="blue",
        )

        if plan.moves and focus in {"summary", "full", "changes", "details"}:
            self._show_pending_group_summary(plan)

        if plan.directories and focus in {"full", "details", "changes"}:
            self.show_list("目录列表", plan.directories, style="blue")

        if plan.moves and focus in {"full", "details", "changes"}:
            self._show_pending_move_details(plan)

        if plan.unresolved_items and focus in {"full", "summary", "unresolved"}:
            self.show_list(
                "待确认问题",
                [self._format_unresolved_question(plan, item) for item in plan.unresolved_items],
                style="yellow",
            )

    def show_grouped_execution_preview(self, plan: ExecutionPlan) -> None:
        if not plan.move_actions:
            return

        grouped: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for action in plan.move_actions:
            assert action.source is not None
            group_name = self._display_group_name(action.target.parent, plan.base_dir)
            grouped[group_name].append(
                (
                    relative_display(action.source, plan.base_dir),
                    relative_display(action.target, plan.base_dir),
                )
            )

        group_items = sorted(grouped.items(), key=lambda item: (-len(item[1]), item[0].lower()))
        summary_rows = [(name, f"{len(items)} 项") for name, items in group_items[: self.GROUP_PANEL_LIMIT]]
        remaining_groups = len(group_items) - len(summary_rows)
        if remaining_groups > 0:
            summary_rows.append(("其他目录", f"{remaining_groups} 组已省略"))
        self.show_summary("目标目录分组", summary_rows, style="cyan")

        for group_name, items in group_items[: self.GROUP_PANEL_LIMIT]:
            table = Table(box=box.SIMPLE_HEAVY, expand=False)
            table.add_column("序号", style="bold cyan", justify="right")
            table.add_column("源路径", style="white")
            table.add_column("目标路径", style="green")
            for index, (source_text, target_text) in enumerate(items[: self.GROUP_PREVIEW_LIMIT], start=1):
                table.add_row(str(index), source_text, target_text)

            hidden_count = len(items) - min(len(items), self.GROUP_PREVIEW_LIMIT)
            if hidden_count > 0:
                table.add_row("…", "", f"其余 {hidden_count} 条已省略")

            self.console.print(
                Panel(
                    table,
                    title=f"{group_name} ({len(items)} 项)",
                    border_style="cyan",
                    box=box.ROUNDED,
                    expand=False,
                )
            )

    def show_execution_preview(self, plan: ExecutionPlan, precheck: PrecheckResult) -> None:
        self.stage("整理预检", style="blue")
        self.show_summary(
            "执行摘要",
            [
                ("新建目录", str(len(plan.mkdir_actions))),
                ("移动项目", str(len(plan.move_actions))),
                ("阻断问题", str(len(precheck.blocking_errors))),
            ],
            style="blue",
        )

        self.show_grouped_execution_preview(plan)

        if plan.mkdir_actions:
            self.show_list(
                "待创建目录",
                [relative_display(action.target, plan.base_dir) for action in plan.mkdir_actions],
                style="blue",
            )

        if precheck.blocking_errors:
            self.show_list("阻断问题", precheck.blocking_errors, style="red")
        if precheck.warnings:
            self.show_list("提醒", precheck.warnings, style="yellow")

    def show_completion_banner(self, title: str, message: str, *, style: str) -> None:
        self.panel(title, message, style=style)

    def show_execution_report(self, report: ExecutionReport, base_dir: Path) -> None:
        style = "green" if report.failure_count == 0 else "yellow"
        self.stage("执行结果", style=style)
        summary_message = f"成功 {report.success_count} 项"
        if report.failure_count:
            summary_message += f"，失败 {report.failure_count} 项"
        self.show_completion_banner("执行已完成", summary_message, style=style)
        self.show_summary(
            "执行摘要",
            [("成功", str(report.success_count)), ("失败", str(report.failure_count))],
            style=style,
        )

        if report.results:
            table = Table(box=box.SIMPLE_HEAVY, expand=False)
            table.add_column("状态", style="bold")
            table.add_column("动作", style="cyan")
            table.add_column("路径", style="white")
            table.add_column("说明", style="white")
            for item in report.results:
                action = item.action
                if action.type == "MKDIR":
                    path_text = relative_display(action.target, base_dir)
                else:
                    assert action.source is not None
                    path_text = (
                        f"{relative_display(action.source, base_dir)} -> "
                        f"{relative_display(action.target, base_dir)}"
                    )
                table.add_row(item.status, action.type, path_text, item.message)
            self.console.print(Panel(table, title="执行明细", border_style=style, box=box.ROUNDED, expand=False))

    def show_rollback_preview(self, plan: RollbackPlan, precheck: RollbackPrecheckResult) -> None:
        self.stage("回退预检", style="yellow")
        self.show_summary(
            "回退摘要",
            [
                ("执行 ID", plan.execution_id),
                ("目标目录", plan.target_dir.as_posix()),
                ("回退动作", str(len(plan.actions))),
                ("阻断问题", str(len(precheck.blocking_errors))),
            ],
            style="yellow",
        )

        if plan.actions:
            table = Table(box=box.SIMPLE_HEAVY, expand=False)
            table.add_column("序号", style="bold yellow", justify="right")
            table.add_column("动作", style="cyan")
            table.add_column("路径", style="white")
            for index, action in enumerate(plan.actions, start=1):
                if action.type == "MOVE":
                    path_text = f"{action.source.as_posix()} -> {action.target.as_posix()}"
                else:
                    path_text = action.source.as_posix()
                table.add_row(str(index), action.type, path_text)
            self.console.print(Panel(table, title="回退动作", border_style="yellow", box=box.ROUNDED, expand=False))

        if precheck.blocking_errors:
            self.show_list("阻断问题", precheck.blocking_errors, style="red")
        if precheck.warnings:
            self.show_list("提醒", precheck.warnings, style="yellow")

    def show_rollback_report(self, report: RollbackReport, base_dir: Path) -> None:
        style = "green" if report.failure_count == 0 else "yellow"
        self.stage("回退结果", style=style)
        summary_message = f"成功回退 {report.success_count} 项"
        if report.failure_count:
            summary_message += f"，失败 {report.failure_count} 项"
        self.show_completion_banner("回退已完成", summary_message, style=style)
        self.show_summary(
            "回退摘要",
            [("成功", str(report.success_count)), ("失败", str(report.failure_count))],
            style=style,
        )

        if report.results:
            table = Table(box=box.SIMPLE_HEAVY, expand=False)
            table.add_column("状态", style="bold")
            table.add_column("动作", style="cyan")
            table.add_column("路径", style="white")
            table.add_column("说明", style="white")
            for item in report.results:
                action = item.action
                if action.type == "MOVE":
                    path_text = (
                        f"{relative_display(action.source, base_dir)} -> "
                        f"{relative_display(action.target, base_dir)}"
                    )
                else:
                    path_text = relative_display(action.source, base_dir)
                table.add_row(item.status, action.type, path_text, item.message)
            self.console.print(Panel(table, title="回退明细", border_style=style, box=box.ROUNDED, expand=False))

    def prompt(self, message: str, *, input_func=input) -> str:
        if input_func is input:
            return Prompt.ask(f"[bold cyan]{message}[/]", console=self.console)
        return input_func(message)

    def prompt_path(self, message: str, *, input_func=input) -> str:
        self.info("示例: D:/Users/YourName/Documents 或 D:/Workspace/Inbox", title="输入目录")
        return self.prompt(message, input_func=input_func)

    def prompt_confirmation(self, message: str, *, input_func=input) -> str:
        self.warning(f"仅在确认无误后输入 YES。\n{message}", title="确认执行")
        return self.prompt(message, input_func=input_func)

    def prompt_feedback(self, message: str, *, input_func=input) -> str:
        self.info(f"可直接输入调整意见；输入 quit 或 exit 可退出。\n{message}", title="继续调整")
        return self.prompt(message, input_func=input_func)

    def start_waiting(self, message: str = "正在等待模型响应...") -> None:
        self.stop_waiting()
        self._status = self.console.status(f"[bold cyan]{message}[/]", spinner="dots", spinner_style="cyan")
        self._status.start()

    def stop_waiting(self) -> None:
        if self._status is None:
            return
        self._status.stop()
        self._status = None

    def begin_stream(self) -> None:
        self._stream_section = None

    def stream_section(self, section: str, label: str, content: str, *, label_style: str, text_style: str) -> None:
        if self._stream_section != section:
            if self._stream_section is not None:
                self.console.print()
            self.console.print(Text(f"{label}: ", style=label_style), end="")
            self._stream_section = section
        self.console.print(Text(content, style=text_style), end="")

    def stream_status(self, label: str, content: str, style: str = "dim") -> None:
        if self._stream_section is not None:
            self.console.print()
            self._stream_section = None
        self.console.print(Text(f"{label}: {content}", style=style))

    def newline(self) -> None:
        self.console.print()
        self._stream_section = None


default_cli = CLI()
