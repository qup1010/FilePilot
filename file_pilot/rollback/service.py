from __future__ import annotations

import json
import shutil
from pathlib import Path

import file_pilot.shared.config as config
from file_pilot.execution.models import ExecutionJournal
from file_pilot.execution.service import load_execution_journal
from file_pilot.rollback.models import (
    RollbackAction,
    RollbackItemResult,
    RollbackItemSkip,
    RollbackPlan,
    RollbackPrecheckResult,
    RollbackReport,
)
from file_pilot.shared.history_store import atomic_write_json, build_journal_path, read_latest_index, write_latest_index


def _history_paths() -> tuple[Path, Path]:
    return config.LATEST_BY_DIRECTORY_PATH, config.EXECUTION_LOG_DIR


def save_execution_journal(journal: ExecutionJournal) -> None:
    _, executions_dir = _history_paths()
    atomic_write_json(build_journal_path(journal.execution_id, executions_dir), journal.to_dict())


def load_latest_execution_for_directory(target_dir: Path | str) -> ExecutionJournal | None:
    normalized_dir = str(Path(target_dir).resolve())
    latest_index_path, executions_dir = _history_paths()
    latest_index = read_latest_index(latest_index_path, executions_dir)
    execution_id = latest_index.get(normalized_dir)
    if not execution_id:
        return None
    return load_execution_journal(execution_id)


def build_rollback_plan(journal: ExecutionJournal) -> RollbackPlan:
    actions: list[RollbackAction] = []

    for item in reversed(journal.items):
        if item.status != "success":
            continue

        if item.action_type == "MOVE" and item.source_before and item.target_after:
            source_before_path = Path(item.source_before).resolve()
            target_after_path = Path(item.target_after).resolve()
            if source_before_path == target_after_path:
                continue

            actions.append(
                RollbackAction(
                    type="MOVE",
                    source=target_after_path,
                    target=source_before_path,
                    raw=item.raw,
                    item_id=str(item.item_id or ""),
                    source_ref_id=str(item.source_ref_id or ""),
                    target_slot_id=str(item.target_slot_id or ""),
                    display_name=str(item.display_name or ""),
                )
            )
        elif item.action_type == "MKDIR" and item.created_path:
            created_path = Path(item.created_path).resolve()
            actions.append(
                RollbackAction(
                    type="RMDIR",
                    source=created_path,
                    target=created_path,
                    raw=item.raw,
                    item_id=str(item.item_id or ""),
                    source_ref_id=str(item.source_ref_id or ""),
                    target_slot_id=str(item.target_slot_id or ""),
                    display_name=str(item.display_name or ""),
                )
            )

    return RollbackPlan(
        execution_id=journal.execution_id,
        target_dir=Path(journal.target_dir).resolve(),
        actions=actions,
    )


def _rollback_skip(action: RollbackAction, *, reason: str, message: str) -> RollbackItemSkip:
    return RollbackItemSkip(
        reason=reason,
        message=message,
        action_type=action.type,
        source=action.source.as_posix(),
        target=action.target.as_posix(),
        item_id=str(action.item_id or "").strip() or None,
        display_name=str(action.display_name or "").strip() or None,
    )


def validate_rollback_preconditions(plan: RollbackPlan) -> RollbackPrecheckResult:
    """预检：单项问题标记为跳过而非阻断整批回退。

    「一个文件被占用就整批撤不了」在一键场景下是最挫败的结果形态；
    改为逐项 skippable + reason，报告如实呈现「已回退 N / 无法回退 M 及原因」。
    被跳过的 MOVE 不参与模拟状态推演，其残留会连带让所在目录的 RMDIR 也标记跳过。
    """
    item_skips: list[RollbackItemSkip] = []
    simulated_removed: set[Path] = set()
    simulated_created: set[Path] = set()

    def path_exists(path: Path) -> bool:
        if path in simulated_removed:
            return False
        if path in simulated_created:
            return True
        return path.exists()

    def directory_has_contents(path: Path) -> bool:
        for child in path.iterdir():
            if path_exists(child):
                return True
        return any(created.parent == path for created in simulated_created)

    executable_count = 0
    for action in plan.actions:
        if not path_exists(action.source):
            item_skips.append(
                _rollback_skip(action, reason="source_missing", message=f"回退源不存在: {action.source.as_posix()}")
            )
            continue

        if action.type == "MOVE":
            if path_exists(action.target):
                item_skips.append(
                    _rollback_skip(action, reason="target_exists", message=f"回退目标已存在: {action.target.as_posix()}")
                )
                continue
            simulated_removed.add(action.source)
            simulated_created.add(action.target)
            executable_count += 1
        elif action.type == "RMDIR":
            if not action.source.is_dir():
                item_skips.append(
                    _rollback_skip(action, reason="invalid_dir", message=f"待删除目录无效: {action.source.as_posix()}")
                )
            elif directory_has_contents(action.source):
                item_skips.append(
                    _rollback_skip(action, reason="dir_not_empty", message=f"回退目录非空: {action.source.as_posix()}")
                )
            else:
                simulated_removed.add(action.source)
                executable_count += 1

    return RollbackPrecheckResult(
        can_execute=executable_count > 0 or not plan.actions,
        blocking_errors=[],
        warnings=[],
        item_skips=item_skips,
    )


def render_rollback_preview(plan: RollbackPlan, precheck: RollbackPrecheckResult) -> str:
    lines = ["即将回退最近一次执行：", ""]
    lines.append(f"- 执行 ID：{plan.execution_id}")
    lines.append(f"- 目录：{plan.target_dir.as_posix()}")
    lines.append(f"- 回退动作：{len(plan.actions)} 个")
    lines.append("")
    lines.append("动作列表：")

    if plan.actions:
        for index, action in enumerate(plan.actions, start=1):
            display_label = str(action.display_name or action.item_id or "").strip()
            label_prefix = f"[{display_label}] " if display_label else ""
            if action.type == "MOVE":
                lines.append(f'{index}. {label_prefix}MOVE "{action.source.as_posix()}" -> "{action.target.as_posix()}"')
            else:
                lines.append(f'{index}. {label_prefix}RMDIR "{action.source.as_posix()}"')
    else:
        lines.append("- 无可回退动作")

    if precheck.blocking_errors:
        lines.append("")
        lines.append("阻断问题：")
        lines.extend(f"- {item}" for item in precheck.blocking_errors)

    if precheck.item_skips:
        lines.append("")
        lines.append("无法回退（将跳过）：")
        lines.extend(f"- {skip.message}" for skip in precheck.item_skips)

    return "\n".join(lines)


def _runtime_rollback_skip_reason(action: RollbackAction) -> str | None:
    """执行时刻的最后防线，与预检独立求值：期间世界可能已变化。

    「原位置已有同名文件」时绝不覆盖——这是「从不删除/覆盖文件」保证在
    回退方向上的实际来源。
    """
    if not action.source.exists():
        return "回退源已不存在，跳过"
    if action.type == "MOVE":
        if action.target.exists():
            return "原位置已有同名文件，跳过并保持现状"
        return None
    if not action.source.is_dir():
        return "待删除目录无效，跳过"
    if any(action.source.iterdir()):
        return "目录非空，跳过删除"
    return None


def execute_rollback_plan(plan: RollbackPlan) -> RollbackReport:
    results: list[RollbackItemResult] = []
    success_count = 0
    failure_count = 0
    skipped_count = 0

    for action in plan.actions:
        # 已在原位/已删除 = 该项此前已经回退过：视为完成而非跳过，
        # 否则部分回退后的重试永远无法收敛到 rolled_back
        if action.type == "MOVE" and not action.source.exists() and action.target.exists():
            results.append(RollbackItemResult(action=action, status="success", message="已在原位，无需回退"))
            success_count += 1
            continue
        if action.type == "RMDIR" and not action.source.exists():
            results.append(RollbackItemResult(action=action, status="success", message="目录已不存在，无需删除"))
            success_count += 1
            continue
        skip_message = _runtime_rollback_skip_reason(action)
        if skip_message is not None:
            results.append(RollbackItemResult(action=action, status="skipped", message=skip_message))
            skipped_count += 1
            continue
        try:
            if action.type == "MOVE":
                shutil.move(str(action.source), str(action.target))
                message = "回退移动成功"
            else:
                action.source.rmdir()
                message = "空目录已删除"
            results.append(RollbackItemResult(action=action, status="success", message=message))
            success_count += 1
        except Exception as exc:
            results.append(RollbackItemResult(action=action, status="failed", message=str(exc)))
            failure_count += 1

    return RollbackReport(
        success_count=success_count,
        failure_count=failure_count,
        results=results,
        skipped_count=skipped_count,
    )


def render_rollback_report(report: RollbackReport) -> str:
    lines = ["回退结果：", ""]
    lines.append(f"- 成功：{report.success_count}")
    lines.append(f"- 失败：{report.failure_count}")
    lines.append("")

    for item in report.results:
        action = item.action
        if action.type == "MOVE":
            lines.append(
                f"[{item.status}] MOVE {action.source.as_posix()} -> {action.target.as_posix()} - {item.message}"
            )
        else:
            lines.append(f"[{item.status}] RMDIR {action.source.as_posix()} - {item.message}")

    return "\n".join(lines)


def finalize_rollback_state(journal: ExecutionJournal, report: RollbackReport) -> None:
    journal = load_execution_journal(journal.execution_id) or journal
    journal.rollback_attempts.append(
        {
            "success_count": report.success_count,
            "failure_count": report.failure_count,
            "skipped_count": report.skipped_count,
            "results": [
                {
                    "action_type": item.action.type,
                    "source": item.action.source.as_posix(),
                    "target": item.action.target.as_posix(),
                    "status": item.status,
                    "message": item.message,
                    "item_id": item.action.item_id or None,
                    "source_ref_id": item.action.source_ref_id or None,
                    "target_slot_id": item.action.target_slot_id or None,
                    "display_name": item.action.display_name or None,
                }
                for item in report.results
            ],
        }
    )

    latest_index_path, executions_dir = _history_paths()
    latest_index = read_latest_index(latest_index_path, executions_dir)
    if report.failure_count == 0 and report.skipped_count == 0:
        journal.status = "rolled_back"
        latest_index.pop(journal.target_dir, None)
        _write_latest_index(latest_index)
    else:
        # 有跳过/失败 = 未完全回退：保留最近执行指针，用户可以处理占用后再试
        journal.status = "rollback_partial_failure"

    save_execution_journal(journal)



def _read_latest_index() -> dict[str, str]:
    latest_index_path, executions_dir = _history_paths()
    return read_latest_index(latest_index_path, executions_dir)


def _write_latest_index(index: dict[str, str]) -> None:
    latest_index_path, executions_dir = _history_paths()
    write_latest_index(index, latest_index_path, executions_dir)


def _journal_path(execution_id: str) -> Path:
    _, executions_dir = _history_paths()
    return build_journal_path(execution_id, executions_dir)

