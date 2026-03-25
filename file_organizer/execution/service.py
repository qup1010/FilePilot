from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

import file_organizer.shared.config as config
from file_organizer.execution.models import (
    ExecutionAction,
    ExecutionItemResult,
    ExecutionJournal,
    ExecutionJournalItem,
    ExecutionPlan,
    ExecutionReport,
    PrecheckResult,
)
from file_organizer.organize.models import FinalPlan, PlanMove
from file_organizer.shared.history_store import build_journal_path, read_latest_index, write_latest_index
from file_organizer.shared.path_utils import relative_display


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _history_paths() -> tuple[Path, Path]:
    return config.LATEST_BY_DIRECTORY_PATH, config.EXECUTION_LOG_DIR


def _journal_path(execution_id: str) -> Path:
    _, executions_dir = _history_paths()
    return build_journal_path(execution_id, executions_dir)


def save_execution_journal(journal: ExecutionJournal) -> Path:
    path = _journal_path(journal.execution_id)
    path.write_text(
        json.dumps(journal.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path


def update_latest_execution_pointer(target_dir: Path, execution_id: str) -> None:
    latest_index_path, executions_dir = _history_paths()
    latest_index = read_latest_index(latest_index_path, executions_dir)
    latest_index[str(target_dir.resolve())] = execution_id
    write_latest_index(latest_index, latest_index_path, executions_dir)


def load_execution_journal(execution_id: str) -> ExecutionJournal | None:
    path = _journal_path(execution_id)
    if not path.exists():
        return None
    return ExecutionJournal.from_dict(json.loads(path.read_text(encoding="utf-8")))


def delete_execution_journal(execution_id: str) -> bool:
    path = _journal_path(execution_id)
    if not path.exists():
        return False

    journal = ExecutionJournal.from_dict(json.loads(path.read_text(encoding="utf-8")))
    path.unlink()

    latest_index_path, executions_dir = _history_paths()
    latest_index = read_latest_index(latest_index_path, executions_dir)
    if latest_index.get(str(Path(journal.target_dir).resolve())) == execution_id:
        latest_index.pop(str(Path(journal.target_dir).resolve()), None)
        write_latest_index(latest_index, latest_index_path, executions_dir)

    return True


def _coerce_final_plan(parsed_commands) -> FinalPlan:
    if isinstance(parsed_commands, FinalPlan):
        return parsed_commands
    if isinstance(parsed_commands, dict) and "commands" in parsed_commands:
        directories = list(parsed_commands.get("mkdirs", []))
        moves = [
            PlanMove(source=move["source"], target=move["target"], raw=move.get("raw", ""))
            for move in parsed_commands.get("moves", [])
        ]
        return FinalPlan(directories=directories, moves=moves, unresolved_items=[])
    if isinstance(parsed_commands, dict):
        return FinalPlan.from_dict(parsed_commands)
    raise TypeError(f"不支持的执行计划输入类型: {type(parsed_commands).__name__}")


def build_execution_plan(parsed_commands, base_dir: Path) -> ExecutionPlan:
    base_dir = Path(base_dir).resolve()
    final_plan = _coerce_final_plan(parsed_commands)
    mkdir_actions: list[ExecutionAction] = []
    move_actions: list[ExecutionAction] = []
    all_actions: list[ExecutionAction] = []

    for directory in final_plan.directories:
        raw = f'MKDIR "{directory}"'
        action = ExecutionAction(type="MKDIR", target=base_dir / directory, raw=raw)
        mkdir_actions.append(action)
        all_actions.append(action)

    for move in final_plan.moves:
        raw = move.to_move_command()
        action = ExecutionAction(
            type="MOVE",
            source=base_dir / move.source,
            target=base_dir / move.target,
            raw=raw,
        )
        move_actions.append(action)
        all_actions.append(action)

    return ExecutionPlan(
        base_dir=base_dir,
        mkdir_actions=mkdir_actions,
        move_actions=move_actions,
        all_actions=all_actions,
    )


def validate_execution_preconditions(plan: ExecutionPlan) -> PrecheckResult:
    blocking_errors: list[str] = []
    warnings: list[str] = []
    planned_dirs = {action.target.resolve(strict=False) for action in plan.mkdir_actions}

    for action in plan.move_actions:
        assert action.source is not None
        source = action.source
        target = action.target

        if not source.exists():
            blocking_errors.append(f"源项目不存在: {relative_display(source, plan.base_dir)}")
            continue

        if target.exists():
            blocking_errors.append(f"目标已存在: {relative_display(target, plan.base_dir)}")
            continue

        source_abs = source.resolve()
        target_abs = target.resolve(strict=False)
        if source_abs == target_abs or source_abs in target_abs.parents:
            blocking_errors.append(f"不能移动到自身子路径: {relative_display(target, plan.base_dir)}")

        parent_dir = target.parent.resolve(strict=False)
        if not parent_dir.exists() and parent_dir not in planned_dirs:
            blocking_errors.append(f"目标父目录不存在: {relative_display(target.parent, plan.base_dir)}")

    return PrecheckResult(
        can_execute=not blocking_errors,
        blocking_errors=blocking_errors,
        warnings=warnings,
    )


def render_execution_preview(plan: ExecutionPlan, precheck: PrecheckResult) -> str:
    lines = ["即将执行以下整理方案：", ""]

    lines.append("创建目录：")
    if plan.mkdir_actions:
        lines.extend(f"- {relative_display(action.target, plan.base_dir)}" for action in plan.mkdir_actions)
    else:
        lines.append("- 无")

    lines.append("")
    lines.append("移动项目：")
    if plan.move_actions:
        for index, action in enumerate(plan.move_actions, start=1):
            assert action.source is not None
            lines.append(
                f'{index}. "{relative_display(action.source, plan.base_dir)}" -> '
                f'"{relative_display(action.target, plan.base_dir)}"'
            )
    else:
        lines.append("- 无")

    lines.append("")
    lines.append("统计：")
    lines.append(f"- 新建目录：{len(plan.mkdir_actions)} 个")
    lines.append(f"- 移动项目：{len(plan.move_actions)} 个")
    lines.append(f"- 阻断问题：{len(precheck.blocking_errors)} 个")

    if precheck.blocking_errors:
        lines.append("")
        lines.append("阻断问题：")
        lines.extend(f"- {item}" for item in precheck.blocking_errors)

    if precheck.warnings:
        lines.append("")
        lines.append("提示：")
        lines.extend(f"- {item}" for item in precheck.warnings)

    return "\n".join(lines)


def get_empty_source_dirs(plan: ExecutionPlan) -> list[Path]:
    source_dirs = set()
    for action in plan.move_actions:
        assert action.source is not None
        parent = action.source.parent
        # 收集从源文件所在父目录一直向上追溯到 base_dir 的所有目录
        while parent != plan.base_dir and plan.base_dir in parent.parents:
            source_dirs.add(parent)
            parent = parent.parent
            
    empty_dirs = []
    # 从最深层目录开始检查，以便准确判断
    for d in sorted(source_dirs, key=lambda p: len(p.parts), reverse=True):
        if d.exists() and d.is_dir():
            try:
                if not any(d.iterdir()):
                    empty_dirs.append(d)
            except PermissionError:
                pass
    return empty_dirs


def cleanup_empty_dirs(dirs: list[Path]) -> list[Path]:
    cleaned = []
    for d in dirs:
        try:
            if d.exists() and d.is_dir() and not any(d.iterdir()):
                d.rmdir()
                cleaned.append(d)
        except Exception:
            pass
    return cleaned

def _build_running_journal(plan: ExecutionPlan) -> ExecutionJournal:
    return ExecutionJournal(
        execution_id=uuid.uuid4().hex,
        target_dir=str(plan.base_dir.resolve()),
        created_at=_utc_now_iso(),
        status="running",
        items=[],
        rollback_attempts=[],
    )


def _append_journal_item(
    journal: ExecutionJournal,
    *,
    action_type: str,
    status: str,
    message: str,
    raw: str,
    source_before: Path | None = None,
    target_after: Path | None = None,
    created_path: Path | None = None,
) -> None:
    journal.items.append(
        ExecutionJournalItem(
            action_type=action_type,
            status=status,
            message=message,
            raw=raw,
            source_before=str(source_before.resolve()) if source_before else None,
            target_after=str(target_after.resolve(strict=False)) if target_after else None,
            created_path=str(created_path.resolve()) if created_path else None,
        )
    )
    save_execution_journal(journal)


def execute_plan(plan: ExecutionPlan) -> ExecutionReport:
    results: list[ExecutionItemResult] = []
    success_count = 0
    failure_count = 0
    journal = _build_running_journal(plan)
    save_execution_journal(journal)

    for action in plan.mkdir_actions:
        try:
            created_now = not action.target.exists()
            action.target.mkdir(parents=True, exist_ok=True)
            message = "目录已创建" if created_now else "目录已存在"
            results.append(ExecutionItemResult(action=action, status="success", message=message))
            success_count += 1
            _append_journal_item(
                journal,
                action_type="MKDIR",
                status="success",
                message=message,
                raw=action.raw,
                created_path=action.target if created_now else None,
            )
        except Exception as exc:  # pragma: no cover - defensive branch
            message = str(exc)
            results.append(ExecutionItemResult(action=action, status="failed", message=message))
            failure_count += 1
            _append_journal_item(
                journal,
                action_type="MKDIR",
                status="failed",
                message=message,
                raw=action.raw,
            )

    for action in plan.move_actions:
        try:
            assert action.source is not None
            shutil.move(str(action.source), str(action.target))
            results.append(ExecutionItemResult(action=action, status="success", message="移动成功"))
            success_count += 1
            _append_journal_item(
                journal,
                action_type="MOVE",
                status="success",
                message="移动成功",
                raw=action.raw,
                source_before=action.source,
                target_after=action.target,
            )
        except Exception as exc:
            message = str(exc)
            results.append(ExecutionItemResult(action=action, status="failed", message=message))
            failure_count += 1
            _append_journal_item(
                journal,
                action_type="MOVE",
                status="failed",
                message=message,
                raw=action.raw,
                source_before=action.source,
                target_after=action.target,
            )

    journal.status = "completed" if failure_count == 0 else "partial_failure"
    save_execution_journal(journal)
    update_latest_execution_pointer(plan.base_dir, journal.execution_id)

    return ExecutionReport(
        success_count=success_count,
        failure_count=failure_count,
        results=results,
    )


def render_execution_report(report: ExecutionReport) -> str:
    lines = ["执行结果：", ""]
    lines.append(f"- 成功：{report.success_count}")
    lines.append(f"- 失败：{report.failure_count}")
    lines.append("")

    if report.results:
        for item in report.results:
            action = item.action
            if action.type == "MKDIR":
                target = action.target.as_posix()
                lines.append(f"[{item.status}] MKDIR {target} - {item.message}")
            else:
                assert action.source is not None
                lines.append(
                    f"[{item.status}] MOVE {action.source.as_posix()} -> {action.target.as_posix()} - {item.message}"
                )

    return "\n".join(lines)
