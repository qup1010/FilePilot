from __future__ import annotations

import json
import logging
import os
import shutil
import uuid
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import file_pilot.shared.config as config
from file_pilot.execution.movability import movability_skip_reason
from file_pilot.execution.models import (
    ExecutionAction,
    ExecutionItemResult,
    ExecutionJournal,
    ExecutionJournalItem,
    ExecutionPlan,
    ExecutionReport,
    MappedExecutionPlan,
    PrecheckItemSkip,
    PrecheckResult,
)
from file_pilot.organize.models import FinalPlan, PlanMove
from file_pilot.shared.history_store import atomic_write_json, build_journal_path, read_latest_index, write_latest_index
from file_pilot.shared.path_utils import relative_display

_CROSS_VOLUME_WARNING_TEMPLATE = "检测到可能跨磁盘分区移动: {source} -> {target}（可能耗时较久）"
_NESTED_SOURCE_WARNING_TEMPLATE = "来源 {child} 位于同批移动的 {parent} 内部，两者将被分别移动"

logger = logging.getLogger(__name__)


def move_execution_order_key(source_path: Path | None, item_id: str) -> tuple[int, str]:
    """移动动作的执行排序键：来源路径深的优先。

    若祖先目录先于其内部条目被移走，内部条目的来源路径就会失效，该条目必然失败。
    预检的 ``source.exists()`` 在任何移动发生前求值，拦不住这种情况，因此顺序必须
    在构建计划时就定好。深度降序同时让回退（按日志逆序回放）天然正确：祖先先被
    还原，其内部条目才能放回去。

    同深度时按 ``item_id`` 稳定排序，保证同一份方案的执行顺序可复现。
    """
    depth = len(source_path.parts) if source_path is not None else 0
    return (-depth, item_id)


def sort_move_actions(actions: list[ExecutionAction]) -> list[ExecutionAction]:
    return sorted(actions, key=lambda action: move_execution_order_key(action.source, action.item_id))


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _history_paths() -> tuple[Path, Path]:
    return config.LATEST_BY_DIRECTORY_PATH, config.EXECUTION_LOG_DIR


def _journal_path(execution_id: str) -> Path:
    _, executions_dir = _history_paths()
    return build_journal_path(execution_id, executions_dir)


def save_execution_journal(journal: ExecutionJournal) -> Path:
    path = _journal_path(journal.execution_id)
    atomic_write_json(path, journal.to_dict())
    return path


def update_latest_execution_pointer(target_dir: Path, execution_id: str) -> None:
    latest_index_path, executions_dir = _history_paths()
    latest_index = read_latest_index(latest_index_path, executions_dir)
    latest_index[str(target_dir.resolve())] = execution_id
    write_latest_index(latest_index, latest_index_path, executions_dir)


# 本进程正在执行中的 journal：status=="running" 且不在此集合 = 进程曾崩溃
_ACTIVE_EXECUTION_IDS: set[str] = set()


def _reconcile_interrupted_journal(journal: ExecutionJournal) -> None:
    """崩溃对账：用文件系统事实落定 pending 意图，让 journal 重新可信。

    write-ahead 保证崩溃时留下 pending 意图；这里把它落定——目标已出现且
    来源已消失视为移动已完成，否则视为未执行留在原地。对账后 journal
    进入 partial_failure（执行未走完，如实呈现），回退与检索恢复可用。
    """
    for index, item in enumerate(journal.items):
        if item.status != "pending":
            continue
        if item.action_type == "MOVE":
            target = Path(item.target_after) if item.target_after else None
            source = Path(item.source_before) if item.source_before else None
            moved = bool(target is not None and target.exists() and (source is None or not source.exists()))
            journal.items[index] = replace(
                item,
                status="success" if moved else "skipped",
                message="进程中断后对账确认：移动已完成" if moved else "进程中断，移动未执行，文件留在原地",
            )
        else:
            journal.items[index] = replace(item, status="skipped", message="进程中断，未确认执行结果")
    journal.status = "partial_failure"
    save_execution_journal(journal)
    _maybe_restore_latest_pointer(journal)
    logger.warning(
        "execution.journal_reconciled execution_id=%s target_dir=%s",
        journal.execution_id,
        journal.target_dir,
    )


def _maybe_restore_latest_pointer(journal: ExecutionJournal) -> None:
    """崩溃的执行没来得及更新最近执行指针；仅当没有更新的执行时补上。"""
    latest_index_path, executions_dir = _history_paths()
    latest_index = read_latest_index(latest_index_path, executions_dir)
    key = str(Path(journal.target_dir).resolve())
    current_id = latest_index.get(key)
    if current_id and current_id != journal.execution_id:
        current_path = build_journal_path(current_id, executions_dir)
        if current_path.exists():
            try:
                current_created = str(json.loads(current_path.read_text(encoding="utf-8")).get("created_at") or "")
            except (json.JSONDecodeError, OSError):
                current_created = ""
            if current_created >= journal.created_at:
                return
    latest_index[key] = journal.execution_id
    write_latest_index(latest_index, latest_index_path, executions_dir)


def load_execution_journal(execution_id: str) -> ExecutionJournal | None:
    path = _journal_path(execution_id)
    if not path.exists():
        return None
    journal = ExecutionJournal.from_dict(json.loads(path.read_text(encoding="utf-8")))
    if journal.status == "running" and journal.execution_id not in _ACTIVE_EXECUTION_IDS:
        _reconcile_interrupted_journal(journal)
    return journal


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

    for directory in final_plan.directories:
        raw = f'MKDIR "{directory}"'
        mkdir_actions.append(ExecutionAction(type="MKDIR", target=base_dir / directory, raw=raw))

    for move in final_plan.moves:
        raw = move.to_move_command()
        move_actions.append(
            ExecutionAction(
                type="MOVE",
                source=base_dir / move.source,
                target=base_dir / move.target,
                raw=raw,
            )
        )

    move_actions = sort_move_actions(move_actions)
    return ExecutionPlan(
        base_dir=base_dir,
        mkdir_actions=mkdir_actions,
        move_actions=move_actions,
        all_actions=[*mkdir_actions, *move_actions],
    )


def build_execution_plan_from_mapped(mapped_plan: MappedExecutionPlan) -> ExecutionPlan:
    base_dir = Path(mapped_plan.base_dir).resolve()
    mkdir_actions = [
        ExecutionAction(
            type=action.type,
            target=Path(action.target_path).resolve(strict=False),
            raw=action.raw,
            item_id=action.item_id,
            source_ref_id=action.source_ref_id,
            target_slot_id=action.target_slot_id,
            display_name=action.display_name,
        )
        for action in mapped_plan.mkdir_actions
    ]
    move_actions = [
        ExecutionAction(
            type=action.type,
            source=Path(action.source_path).resolve(strict=False) if action.source_path is not None else None,
            target=Path(action.target_path).resolve(strict=False),
            raw=action.raw,
            item_id=action.item_id,
            source_ref_id=action.source_ref_id,
            target_slot_id=action.target_slot_id,
            display_name=action.display_name,
            decision_basis=action.decision_basis,
        )
        for action in mapped_plan.move_actions
    ]
    move_actions = sort_move_actions(move_actions)
    return ExecutionPlan(
        base_dir=base_dir,
        mkdir_actions=mkdir_actions,
        move_actions=move_actions,
        all_actions=[*mkdir_actions, *move_actions],
    )


def _item_skip(action: ExecutionAction, base_dir: Path, *, reason: str, message: str) -> PrecheckItemSkip:
    return PrecheckItemSkip(
        reason=reason,
        message=message,
        item_id=str(action.item_id or "").strip() or None,
        display_name=str(action.display_name or "").strip() or None,
        source=relative_display(action.source, base_dir) if action.source else None,
        target=relative_display(action.target, base_dir),
    )


def validate_execution_preconditions(plan: ExecutionPlan) -> PrecheckResult:
    """预检：单项问题标记为跳过而非阻断整批。

    「跳过留原地」是既定决策——同名冲突等单项问题不该让其余几十项陪葬。
    ``can_execute`` 表示「存在至少一个可执行的移动」；没有任何移动的
    纯建目录计划沿用旧语义。
    """
    blocking_errors: list[str] = []
    warnings: list[str] = []
    item_skips: list[PrecheckItemSkip] = []
    planned_dirs = {action.target.resolve(strict=False) for action in plan.mkdir_actions}
    seen_cross_volume_pairs: set[tuple[str, str]] = set()
    move_targets_by_key: dict[str, list[ExecutionAction]] = {}

    for action in plan.move_actions:
        target_key = _path_key(action.target)
        move_targets_by_key.setdefault(target_key, []).append(action)

    # 同一目标被多项指向：按执行顺序保留第一个，其余跳过
    duplicate_skipped_ids: set[int] = set()
    for actions in move_targets_by_key.values():
        if len(actions) <= 1:
            continue
        target = actions[0].target
        for action in actions[1:]:
            duplicate_skipped_ids.add(id(action))
            item_skips.append(
                _item_skip(
                    action,
                    plan.base_dir,
                    reason="duplicate_target",
                    message=f"计划内多个项目指向同一目标: {relative_display(target, plan.base_dir)}",
                )
            )

    warnings.extend(_nested_source_warnings(plan))

    executable_move_count = 0
    for action in plan.move_actions:
        assert action.source is not None
        source = action.source
        target = action.target

        if id(action) in duplicate_skipped_ids:
            continue

        if not source.exists():
            item_skips.append(
                _item_skip(
                    action,
                    plan.base_dir,
                    reason="source_missing",
                    message=f"源项目不存在: {relative_display(source, plan.base_dir)}",
                )
            )
            continue

        source_abs = source.resolve()
        target_abs = target.resolve(strict=False)

        if source_abs == target_abs:
            # No-op move, skip validation
            executable_move_count += 1
            continue

        if target.exists():
            item_skips.append(
                _item_skip(
                    action,
                    plan.base_dir,
                    reason="target_exists",
                    message=f"目标已存在: {relative_display(target, plan.base_dir)}",
                )
            )
            continue

        if source_abs in target_abs.parents:
            item_skips.append(
                _item_skip(
                    action,
                    plan.base_dir,
                    reason="self_subpath",
                    message=f"不能移动到自身子路径: {relative_display(target, plan.base_dir)}",
                )
            )
            continue

        parent_dir = target.parent.resolve(strict=False)
        if not parent_dir.exists() and parent_dir not in planned_dirs:
            item_skips.append(
                _item_skip(
                    action,
                    plan.base_dir,
                    reason="parent_missing",
                    message=f"目标父目录不存在: {relative_display(target.parent, plan.base_dir)}",
                )
            )
            continue

        movability_reason = movability_skip_reason(source)
        if movability_reason is not None:
            item_skips.append(
                _item_skip(
                    action,
                    plan.base_dir,
                    reason="not_movable",
                    message=f"{movability_reason}: {relative_display(source, plan.base_dir)}",
                )
            )
            continue

        executable_move_count += 1
        if _is_cross_volume_move(source_abs, _existing_ancestor(parent_dir)):
            pair = (str(source_abs), str(target_abs))
            if pair not in seen_cross_volume_pairs:
                seen_cross_volume_pairs.add(pair)
                warnings.append(
                    _CROSS_VOLUME_WARNING_TEMPLATE.format(
                        source=relative_display(source, plan.base_dir),
                        target=relative_display(target, plan.base_dir),
                    )
                )

    if plan.move_actions:
        can_execute = executable_move_count > 0
    else:
        can_execute = not blocking_errors

    return PrecheckResult(
        can_execute=can_execute,
        blocking_errors=blocking_errors,
        warnings=warnings,
        item_skips=item_skips,
    )


def _path_key(path: Path) -> str:
    return os.path.normcase(str(path.resolve(strict=False))).rstrip("\\/")


def _nested_source_warnings(plan: ExecutionPlan) -> list[str]:
    """标记「祖先目录与其内部条目在同一批被移动」的情况。

    执行顺序已按深度降序排好，这种方案能正确落地（内部条目先走，祖先随后带着剩余
    内容移动），但结果和用户的直觉未必一致，所以在预览里提示而不是阻断。
    """
    source_by_key: dict[str, Path] = {}
    for action in plan.move_actions:
        if action.source is not None:
            source_by_key[_path_key(action.source)] = action.source

    warnings: list[str] = []
    for action in plan.move_actions:
        if action.source is None:
            continue
        for ancestor in action.source.resolve(strict=False).parents:
            parent = source_by_key.get(_path_key(ancestor))
            if parent is None:
                continue
            warnings.append(
                _NESTED_SOURCE_WARNING_TEMPLATE.format(
                    child=relative_display(action.source, plan.base_dir),
                    parent=relative_display(parent, plan.base_dir),
                )
            )
            break
    return warnings


def _existing_ancestor(path: Path) -> Path:
    probe = path.resolve(strict=False)
    while True:
        if probe.exists() or probe.parent == probe:
            return probe
        probe = probe.parent


def _volume_key(path: Path) -> str:
    normalized = str(path).replace("\\", "/").strip()
    if len(normalized) >= 2 and normalized[1] == ":":
        return normalized[:2].lower()
    return ""


def _device_id(path: Path) -> int | None:
    try:
        return int(os.stat(path).st_dev)
    except OSError:
        return None


def _is_cross_volume_move(source: Path, target_parent_anchor: Path) -> bool:
    source_key = _volume_key(source)
    target_key = _volume_key(target_parent_anchor)
    if source_key and target_key and source_key != target_key:
        return True

    source_dev = _device_id(source)
    target_dev = _device_id(target_parent_anchor)
    if source_dev is None or target_dev is None:
        return False
    return source_dev != target_dev


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
            display_label = str(action.display_name or action.item_id or "").strip()
            label_prefix = f"[{display_label}] " if display_label else ""
            lines.append(
                f'{index}. {label_prefix}"{relative_display(action.source, plan.base_dir)}" -> '
                f'"{relative_display(action.target, plan.base_dir)}"'
            )
    else:
        lines.append("- 无")

    lines.append("")
    lines.append("统计：")
    lines.append(f"- 新建目录：{len(plan.mkdir_actions)} 个")
    lines.append(f"- 移动项目：{len(plan.move_actions)} 个")
    lines.append(f"- 阻断问题：{len(precheck.blocking_errors)} 个")
    if precheck.item_skips:
        lines.append(f"- 将跳过：{len(precheck.item_skips)} 个")

    if precheck.blocking_errors:
        lines.append("")
        lines.append("阻断问题：")
        lines.extend(f"- {item}" for item in precheck.blocking_errors)

    if precheck.item_skips:
        lines.append("")
        lines.append("将跳过（留在原地）：")
        lines.extend(f"- {skip.message}" for skip in precheck.item_skips)

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
            except OSError:
                logger.warning("execution.empty_dir_probe_failed path=%s", d, exc_info=True)
    return empty_dirs


def cleanup_empty_dirs(dirs: list[Path]) -> list[Path]:
    cleaned = []
    for d in dirs:
        try:
            if d.exists() and d.is_dir() and not any(d.iterdir()):
                d.rmdir()
                cleaned.append(d)
        except OSError:
            # 目录在探测后被重新写入、被占用或权限不足都会走到这里。
            # 清理空目录是尽力而为的收尾动作，不应中断流程，但必须留下痕迹。
            logger.warning("execution.empty_dir_cleanup_failed path=%s", d, exc_info=True)
    return cleaned

def _build_running_journal(plan: ExecutionPlan, rule_snapshot: dict | None = None) -> ExecutionJournal:
    return ExecutionJournal(
        execution_id=uuid.uuid4().hex,
        target_dir=str(plan.base_dir.resolve()),
        created_at=_utc_now_iso(),
        status="running",
        items=[],
        rollback_attempts=[],
        rule_snapshot=rule_snapshot,
    )


def _file_identity(source: Path | None) -> tuple[int | None, float | None]:
    """采集移动前的文件身份（size + mtime），目录与不可访问的来源返回空。"""
    if source is None:
        return (None, None)
    try:
        stat = source.stat()
    except OSError:
        return (None, None)
    if not source.is_file():
        return (None, None)
    return (int(stat.st_size), float(stat.st_mtime))


def _begin_journal_item(
    journal: ExecutionJournal,
    action: ExecutionAction,
    *,
    action_type: str,
) -> int:
    """write-ahead：动作执行前先把意图以 pending 状态落盘，返回条目索引。

    崩溃发生在执行与结果落盘之间时，journal 里留有 pending 意图而不是空白，
    对账与恢复据此判断「这个文件可能已被移动」。
    """
    size_bytes, mtime = _file_identity(action.source) if action_type == "MOVE" else (None, None)
    journal.items.append(
        ExecutionJournalItem(
            action_type=action_type,
            status="pending",
            message="",
            raw=action.raw,
            source_before=str(action.source.resolve()) if action.source else None,
            target_after=str(action.target.resolve(strict=False)) if action_type == "MOVE" else None,
            item_id=str(action.item_id or "").strip() or None,
            source_ref_id=str(action.source_ref_id or "").strip() or None,
            target_slot_id=str(action.target_slot_id or "").strip() or None,
            display_name=str(action.display_name or "").strip() or None,
            size_bytes=size_bytes,
            mtime=mtime,
            decision_basis=str(action.decision_basis or "").strip() or None,
        )
    )
    save_execution_journal(journal)
    return len(journal.items) - 1


def _finish_journal_item(
    journal: ExecutionJournal,
    index: int,
    *,
    status: str,
    message: str,
    created_path: Path | None = None,
) -> None:
    item = journal.items[index]
    journal.items[index] = replace(
        item,
        status=status,
        message=message,
        created_path=str(created_path.resolve()) if created_path else item.created_path,
    )
    save_execution_journal(journal)


def _runtime_move_skip_reason(action: ExecutionAction) -> str | None:
    """执行时刻的最后防线：预检与执行之间世界可能已变化。

    Windows 下跨盘 ``shutil.move`` 走 copy2 会静默覆盖同名目标，
    这里的检查是「从不覆盖文件」保证的实际来源，预检只是提前提示。
    """
    assert action.source is not None
    if not action.source.exists():
        return "来源已不存在，跳过"
    source_abs = action.source.resolve()
    target_abs = action.target.resolve(strict=False)
    if action.target.exists() and source_abs != target_abs:
        return "目标已有同名文件，跳过并留在原地"
    # 与预检口径一致：预检对用户说「将跳过」的项，执行时不能变成「失败」
    if source_abs in target_abs.parents:
        return "不能移动到自身子路径，跳过"
    if source_abs != target_abs and not action.target.parent.exists():
        return "目标父目录不存在，跳过"
    movability_reason = movability_skip_reason(action.source)
    if movability_reason is not None:
        return movability_reason
    return None


def _append_skipped_item(journal: ExecutionJournal, action: ExecutionAction, message: str) -> None:
    size_bytes, mtime = _file_identity(action.source)
    journal.items.append(
        ExecutionJournalItem(
            action_type="MOVE",
            status="skipped",
            message=message,
            raw=action.raw,
            source_before=str(action.source.resolve()) if action.source and action.source.exists() else None,
            target_after=str(action.target.resolve(strict=False)),
            item_id=str(action.item_id or "").strip() or None,
            source_ref_id=str(action.source_ref_id or "").strip() or None,
            target_slot_id=str(action.target_slot_id or "").strip() or None,
            display_name=str(action.display_name or "").strip() or None,
            size_bytes=size_bytes,
            mtime=mtime,
            decision_basis=str(action.decision_basis or "").strip() or None,
        )
    )
    save_execution_journal(journal)


def execute_plan(plan: ExecutionPlan, *, rule_snapshot: dict | None = None) -> ExecutionReport:
    journal = _build_running_journal(plan, rule_snapshot)
    _ACTIVE_EXECUTION_IDS.add(journal.execution_id)
    try:
        return _execute_plan_with_journal(plan, journal)
    finally:
        _ACTIVE_EXECUTION_IDS.discard(journal.execution_id)


def _execute_plan_with_journal(plan: ExecutionPlan, journal: ExecutionJournal) -> ExecutionReport:
    results: list[ExecutionItemResult] = []
    success_count = 0
    failure_count = 0
    skipped_count = 0
    save_execution_journal(journal)

    for action in plan.mkdir_actions:
        index = _begin_journal_item(journal, action, action_type="MKDIR")
        try:
            created_now = not action.target.exists()
            action.target.mkdir(parents=True, exist_ok=True)
            message = "目录已创建" if created_now else "目录已存在"
            results.append(ExecutionItemResult(action=action, status="success", message=message))
            success_count += 1
            _finish_journal_item(
                journal,
                index,
                status="success",
                message=message,
                created_path=action.target if created_now else None,
            )
        except Exception as exc:  # pragma: no cover - defensive branch
            message = str(exc)
            logger.warning(
                "execution.mkdir_failed execution_id=%s target=%s error=%s",
                journal.execution_id,
                action.target,
                message,
            )
            results.append(ExecutionItemResult(action=action, status="failed", message=message))
            failure_count += 1
            _finish_journal_item(journal, index, status="failed", message=message)

    for action in plan.move_actions:
        assert action.source is not None
        skip_message = _runtime_move_skip_reason(action)
        if skip_message is not None:
            results.append(ExecutionItemResult(action=action, status="skipped", message=skip_message))
            skipped_count += 1
            _append_skipped_item(journal, action, skip_message)
            continue
        index = _begin_journal_item(journal, action, action_type="MOVE")
        try:
            shutil.move(str(action.source), str(action.target))
            results.append(ExecutionItemResult(action=action, status="success", message="移动成功"))
            success_count += 1
            _finish_journal_item(journal, index, status="success", message="移动成功")
        except Exception as exc:
            message = str(exc)
            logger.warning(
                "execution.move_failed execution_id=%s source=%s target=%s error=%s",
                journal.execution_id,
                action.source,
                action.target,
                message,
            )
            results.append(ExecutionItemResult(action=action, status="failed", message=message))
            failure_count += 1
            _finish_journal_item(journal, index, status="failed", message=message)

    journal.status = "completed" if failure_count == 0 else "partial_failure"
    if failure_count:
        logger.error(
            "execution.partial_failure execution_id=%s target_dir=%s success=%s failed=%s",
            journal.execution_id,
            journal.target_dir,
            success_count,
            failure_count,
        )
    save_execution_journal(journal)
    update_latest_execution_pointer(plan.base_dir, journal.execution_id)

    return ExecutionReport(
        success_count=success_count,
        failure_count=failure_count,
        results=results,
        skipped_count=skipped_count,
    )


def render_execution_report(report: ExecutionReport) -> str:
    lines = ["执行结果：", ""]
    lines.append(f"- 成功：{report.success_count}")
    lines.append(f"- 失败：{report.failure_count}")
    if report.skipped_count:
        lines.append(f"- 跳过：{report.skipped_count}")
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
