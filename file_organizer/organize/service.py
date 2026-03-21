import json
import re
from collections import Counter, defaultdict

from file_organizer.organize.models import (
    FinalPlan,
    PendingPlan,
    PlanDiff,
    PlanDisplayRequest,
    PlanMove,
    derive_directories_from_moves,
)
from file_organizer.organize.prompts import build_prompt
from file_organizer.shared.config import ORGANIZER_MODEL_NAME, RESULT_FILE_PATH, create_openai_client
from file_organizer.shared.events import emit
from file_organizer.shared.path_utils import normalize_source_name, split_relative_parts


COMMANDS_BLOCK_RE = re.compile(r"<COMMANDS>(.*?)</COMMANDS>", flags=re.S | re.I)
MOVE_LINE_RE = re.compile(r'^\s*MOVE\s+"(.*?)"\s+"(.*?)"\s*$', flags=re.I)
MKDIR_LINE_RE = re.compile(r'^\s*MKDIR\s+"(.*?)"\s*$', flags=re.I)
PLAN_DIFF_TOOL_NAME = "submit_plan_diff"
PRESENT_PLAN_TOOL_NAME = "present_current_plan"
FINAL_PLAN_TOOL_NAME = "submit_final_plan"
MODEL_WAIT_MESSAGE = "正在等待模型回复..."


def get_scan_content() -> str:
    if not RESULT_FILE_PATH.exists():
        raise FileNotFoundError(f"未找到扫描结果：{RESULT_FILE_PATH}")
    return RESULT_FILE_PATH.read_text(encoding="utf-8").strip()


def build_initial_messages(scan_lines: str) -> list:
    return [
        {"role": "system", "content": build_prompt(scan_lines)},
        {"role": "user", "content": "请基于上述扫描结果和整理规则，为我生成初始的整理建议。请先调用 submit_plan_diff 提交你的初步设想，然后告诉我你的整体思路。"}
    ]


def _emit_text_response(content: str, event_handler=None) -> None:
    if not content:
        return
    emit(event_handler, "ai_streaming_start")
    emit(event_handler, "ai_chunk", {"content": content})
    emit(event_handler, "ai_streaming_end", {"full_content": content})


def chat_one_round(messages: list, event_handler=None, model: str = ORGANIZER_MODEL_NAME, tools=None, tool_choice="auto", return_message=False):
    client = create_openai_client()
    # DEBUG: 打印发送给模型的请求关键信息
    print(f"\n[DEBUG] 开始 AI 对话循环录制:")
    print(f"  - 目标模型: {model}")
    print(f"  - 历史消息条数: {len(messages)}")
    if messages:
        print(f"  - 最后一贴角色: {messages[-1]['role']}")
        print(f"  - 系统提示词预览 (前50字): {messages[0]['content'][:50]}...")
    else:
        print("  - [ERROR] messages 列表为空！")

    emit(event_handler, "model_wait_start", {"message": MODEL_WAIT_MESSAGE})
    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=tools or organizer_tools,
            tool_choice=tool_choice,
        )
    finally:
        emit(event_handler, "model_wait_end")
    message = response.choices[0].message
    content = getattr(message, "content", "") or ""
    _emit_text_response(content, event_handler=event_handler)
    if return_message:
        return message
    return content


def extract_commands(content: str) -> str | None:
    match = re.search(r"<COMMANDS>(.*?)</COMMANDS>", content or "", flags=re.S | re.I)
    return match.group(1).strip() if match else None


def extract_scan_items(scan_lines: str) -> list[str]:
    items = []
    for raw_line in scan_lines.splitlines():
        line = raw_line.strip()
        if not line or re.match(r"^分析目录路径[:：]", line):
            continue
        if "|" not in line:
            continue

        name = normalize_source_name(line.split("|", 1)[0].strip())
        if name:
            items.append(name)
    return items


def render_final_plan_commands(final_plan: FinalPlan | dict) -> str:
    plan = final_plan if isinstance(final_plan, FinalPlan) else FinalPlan.from_dict(final_plan)
    lines = ["<COMMANDS>"]
    for directory in plan.directories:
        lines.append(f'MKDIR "{directory}"')
    for move in plan.moves:
        lines.append(move.to_move_command())
    lines.append("</COMMANDS>")
    return "\n".join(lines)


def _final_plan_to_parsed(plan: FinalPlan) -> dict:
    commands = []
    mkdirs = []
    moves = []
    for directory in plan.directories:
        raw = f'MKDIR "{directory}"'
        mkdirs.append(directory)
        commands.append({"type": "MKDIR", "name": directory, "raw": raw})
    for move in plan.moves:
        raw = move.to_move_command()
        move_dict = {"source": move.source, "target": move.target, "raw": raw}
        moves.append(move_dict)
        commands.append({"type": "MOVE", **move_dict})
    return {
        "has_commands": bool(commands),
        "mkdirs": mkdirs,
        "moves": moves,
        "invalid_lines": [],
        "raw_lines": [command["raw"] for command in commands],
        "commands": commands,
        "parse_errors": [],
    }


def parse_commands_block(content: str) -> dict:
    blocks = COMMANDS_BLOCK_RE.findall(content or "")
    result = {
        "has_commands": bool(blocks),
        "mkdirs": [],
        "moves": [],
        "invalid_lines": [],
        "raw_lines": [],
        "commands": [],
        "parse_errors": [],
    }

    if not blocks:
        return result
    if len(blocks) != 1:
        result["parse_errors"].append("必须且只能有一个 <COMMANDS> 块")
        return result

    for raw_line in blocks[0].splitlines():
        line = raw_line.strip()
        if not line:
            continue

        result["raw_lines"].append(line)

        move_match = MOVE_LINE_RE.match(raw_line)
        if move_match:
            move = {
                "source": move_match.group(1),
                "target": move_match.group(2),
                "raw": line,
            }
            result["moves"].append(move)
            result["commands"].append({"type": "MOVE", **move})
            continue

        mkdir_match = MKDIR_LINE_RE.match(raw_line)
        if mkdir_match:
            mkdir_name = mkdir_match.group(1)
            result["mkdirs"].append(mkdir_name)
            result["commands"].append({"type": "MKDIR", "name": mkdir_name, "raw": line})
            continue

        result["invalid_lines"].append(line)

    return result


def validate_final_plan(scan_lines: str, final_plan: FinalPlan | dict) -> dict:
    plan = final_plan if isinstance(final_plan, FinalPlan) else FinalPlan.from_dict(final_plan)
    parsed = _final_plan_to_parsed(plan)
    result = {
        "is_valid": False,
        "missing": [],
        "extra": [],
        "duplicates": [],
        "order_errors": [],
        "invalid_lines": list(parsed["parse_errors"]),
        "path_errors": [],
        "rename_errors": [],
        "duplicate_mkdirs": [],
        "missing_mkdirs": [],
        "unused_mkdirs": [],
        "conflicting_targets": [],
        "unresolved_items": list(plan.unresolved_items),
    }

    scan_items = extract_scan_items(scan_lines)
    expected_set = set(scan_items)
    expected_lower_map = {item.lower(): item for item in scan_items}
    actual_sources = []
    required_mkdirs = set()
    normalized_targets = defaultdict(set)

    mkdir_counter = Counter(plan.directories)
    result["duplicate_mkdirs"] = sorted(name for name, count in mkdir_counter.items() if count > 1)

    for move in plan.moves:
        source_name = normalize_source_name(move.source)
        if not source_name:
            result["path_errors"].append(f"非法源路径: {move.to_move_command()}")
            continue

        lower_source = source_name.lower()
        if lower_source in expected_lower_map:
            source_name = expected_lower_map[lower_source]

        actual_sources.append(source_name)
        if source_name not in expected_set:
            continue

        target_parts = split_relative_parts(move.target)
        if not target_parts:
            result["path_errors"].append(f"非法目标路径: {move.to_move_command()}")
            continue

        if target_parts[-1].lower() == source_name.lower():
            target_parts[-1] = source_name

        normalized_target = "/".join(target_parts)
        if len(target_parts) > 1 and target_parts[0] == source_name:
            result["path_errors"].append(f"不能移动到自身子路径: {move.to_move_command()}")
            continue

        if target_parts[-1] != source_name:
            result["rename_errors"].append(f"{source_name} -> {normalized_target}")
            continue

        normalized_targets[normalized_target].add(source_name)
        if len(target_parts) > 1:
            for i in range(1, len(target_parts)):
                required_mkdirs.add("/".join(target_parts[:i]))

    actual_set = set(actual_sources)
    actual_counter = Counter(actual_sources)
    result["duplicates"] = sorted(name for name, count in actual_counter.items() if count > 1)
    result["missing"] = sorted(expected_set - actual_set)
    result["extra"] = sorted(actual_set - expected_set)

    for index, expected_name in enumerate(scan_items):
        if index >= len(actual_sources):
            break
        actual_name = actual_sources[index]
        if expected_name != actual_name:
            result["order_errors"].append(f"第 {index + 1} 项应为 {expected_name}，实际为 {actual_name}")

    mkdir_set = set(plan.directories)
    result["missing_mkdirs"] = sorted(required_mkdirs - mkdir_set)
    result["unused_mkdirs"] = sorted(mkdir_set - required_mkdirs)
    result["conflicting_targets"] = sorted(target for target, sources in normalized_targets.items() if len(sources) > 1)

    if plan.unresolved_items:
        result["invalid_lines"].append(f"仍有待确认条目: {plan.unresolved_items}")

    result["is_valid"] = not any(
        [
            result["missing"],
            result["extra"],
            result["duplicates"],
            result["order_errors"],
            result["invalid_lines"],
            result["path_errors"],
            result["rename_errors"],
            result["duplicate_mkdirs"],
            result["missing_mkdirs"],
            result["unused_mkdirs"],
            result["conflicting_targets"],
        ]
    )
    return result


def validate_command_flow(scan_lines: str, content: str) -> dict:
    parsed = parse_commands_block(content)
    if not parsed["has_commands"]:
        return {
            "is_valid": False,
            "missing": [],
            "extra": [],
            "duplicates": [],
            "order_errors": [],
            "invalid_lines": ["缺少 <COMMANDS> 块"],
            "path_errors": [],
            "rename_errors": [],
            "duplicate_mkdirs": [],
            "missing_mkdirs": [],
            "unused_mkdirs": [],
            "conflicting_targets": [],
            "unresolved_items": [],
        }

    plan = FinalPlan(
        directories=list(parsed["mkdirs"]),
        moves=[PlanMove(source=move["source"], target=move["target"], raw=move["raw"]) for move in parsed["moves"]],
        unresolved_items=[],
    )
    validation = validate_final_plan(scan_lines, plan)
    validation["invalid_lines"] = list(parsed["invalid_lines"]) + list(parsed["parse_errors"]) + list(validation["invalid_lines"])
    validation["is_valid"] = validation["is_valid"] and not parsed["invalid_lines"] and not parsed["parse_errors"]
    return validation


def _copy_pending_plan(plan: PendingPlan) -> PendingPlan:
    return PendingPlan(
        directories=list(plan.directories),
        moves=[PlanMove(source=move.source, target=move.target, raw=move.raw) for move in plan.moves],
        user_constraints=list(plan.user_constraints),
        unresolved_items=list(plan.unresolved_items),
        summary=plan.summary,
    ).with_derived_directories()


def _rename_target_root(target: str, from_name: str, to_name: str) -> str:
    target_parts = split_relative_parts(target)
    if not target_parts or len(target_parts) <= 1 or target_parts[0].lower() != from_name.lower():
        return target
    target_parts[0] = to_name
    return "/".join(target_parts)


def _build_plan_change_summary(previous: PendingPlan, updated: PendingPlan) -> list[str]:
    diff_summary: list[str] = []

    previous_dirs = set(previous.directories)
    updated_dirs = set(updated.directories)
    for directory in sorted(updated_dirs - previous_dirs):
        diff_summary.append(f"新增目录：{directory}")
    for directory in sorted(previous_dirs - updated_dirs):
        diff_summary.append(f"移除目录：{directory}")

    previous_moves = {move.source: move.target for move in previous.moves}
    updated_moves = {move.source: move.target for move in updated.moves}
    for source in sorted(updated_moves):
        old_target = previous_moves.get(source)
        new_target = updated_moves[source]
        if old_target != new_target:
            if old_target is None:
                diff_summary.append(f"新增移动：{source} -> {new_target}")
            else:
                diff_summary.append(f"调整移动：{source} -> {new_target}")
    for source in sorted(previous_moves.keys() - updated_moves.keys()):
        diff_summary.append(f"移除移动：{source}")

    previous_unresolved = set(previous.unresolved_items)
    updated_unresolved = set(updated.unresolved_items)
    for item in sorted(previous_unresolved - updated_unresolved):
        diff_summary.append(f"已解决待确认项：{item}")
    for item in sorted(updated_unresolved - previous_unresolved):
        diff_summary.append(f"新增待确认项：{item}")

    if updated.summary:
        diff_summary.insert(0, updated.summary)
    return diff_summary or ["计划未发生结构性变化"]


def apply_plan_diff(current_plan: PendingPlan | None, patch_diff: PlanDiff | dict, valid_sources: list[str] | None = None) -> tuple[PendingPlan, list[str], list[str]]:
    previous = (current_plan or PendingPlan()).with_derived_directories()
    diff = patch_diff if isinstance(patch_diff, PlanDiff) else PlanDiff.from_dict(patch_diff)

    errors = []
    valid_lower_map = {s.lower(): s for s in valid_sources} if valid_sources is not None else None

    previous_moves = [PlanMove(source=move.source, target=move.target, raw=move.raw) for move in previous.moves]
    move_order = [move.source for move in previous_moves]
    moves_by_source = {move.source: move for move in previous_moves}

    for rename in diff.directory_renames:
        for source, move in list(moves_by_source.items()):
            moves_by_source[source] = PlanMove(
                source=move.source,
                target=_rename_target_root(move.target, rename.from_name, rename.to_name),
                raw="",
            )

    for move in diff.move_updates:
        src = move.source
        if valid_lower_map is not None:
            if src.lower() not in valid_lower_map:
                errors.append(f"无法移动不存在的源文件或目录: {src}")
                continue
            src = valid_lower_map[src.lower()]
            
            target_parts = split_relative_parts(move.target)
            if target_parts and target_parts[-1].lower() == src.lower():
                target_parts[-1] = src
                move.target = "/".join(target_parts)

        if src not in move_order:
            move_order.append(src)
        moves_by_source[src] = PlanMove(source=src, target=move.target, raw=move.raw)

    if valid_sources is not None:
        for original_source in valid_sources:
            if original_source not in moves_by_source:
                moves_by_source[original_source] = PlanMove(source=original_source, target=original_source, raw="")
                move_order.append(original_source)

    updated_moves = [moves_by_source[source] for source in move_order if source in moves_by_source]

    unresolved_order = list(previous.unresolved_items)
    unresolved_set = set(previous.unresolved_items)
    
    # 支持模糊删除（只要待清理的 removal 字符串是现有选项的前缀或者包含在其内，就删除）
    for removal in diff.unresolved_removals:
        to_remove = set()
        for item in unresolved_set:
            if item.startswith(removal) or removal in item or item.split(" ")[0].startswith(removal.split(" ")[0]) or item.split("（")[0].startswith(removal.split("（")[0]):
                to_remove.add(item)
        unresolved_set.difference_update(to_remove)

    for item in diff.unresolved_adds:
        if item not in unresolved_set:
            unresolved_order.append(item)
            unresolved_set.add(item)
    updated_unresolved = [item for item in unresolved_order if item in unresolved_set]

    updated = PendingPlan(
        directories=derive_directories_from_moves(updated_moves),
        moves=updated_moves,
        user_constraints=list(previous.user_constraints),
        unresolved_items=updated_unresolved,
        summary=diff.summary or previous.summary,
    )
    return updated, _build_plan_change_summary(previous, updated), errors


def _pending_from_final(final_plan: FinalPlan) -> PendingPlan:
    return PendingPlan(
        directories=list(final_plan.directories),
        moves=[PlanMove(source=move.source, target=move.target, raw=move.raw) for move in final_plan.moves],
        user_constraints=[],
        unresolved_items=list(final_plan.unresolved_items),
        summary=final_plan.summary,
    ).with_derived_directories()


def build_command_retry_message(validation: dict, scan_lines: str | None = None, user_constraints: list[str] | None = None) -> str:
    details = [
        "刚才提交的整理计划未通过结构化校验，请重新提交完整计划。",
        "要求：每个条目必须且只能对应一条 MOVE；目录列表只包含真正会被使用的目录；目标路径必须是相对路径且保留原始名称。",
    ]

    if scan_lines:
        details.append("当前层权威条目：")
        details.extend(f"- {item}" for item in extract_scan_items(scan_lines))
    if user_constraints:
        details.append("已确认用户偏好：")
        details.extend(f"- {item}" for item in user_constraints)

    for key, label in [
        ("missing", "缺少 MOVE"),
        ("extra", "多余 MOVE"),
        ("duplicates", "重复处理"),
        ("order_errors", "顺序错误"),
        ("invalid_lines", "非法计划"),
        ("path_errors", "路径错误"),
        ("rename_errors", "禁止重命名"),
        ("duplicate_mkdirs", "重复目录"),
        ("missing_mkdirs", "缺少目录"),
        ("unused_mkdirs", "未使用目录"),
        ("conflicting_targets", "目标冲突"),
    ]:
        if validation[key]:
            details.append(f"{label}：{validation[key]}")

    details.append("请重新提交完整结构化计划，不要遗漏任何当前层条目。")
    return "\n".join(details)


def _build_repair_messages(scan_lines: str, user_constraints: list[str], validation: dict) -> list[dict]:
    repair_prompt = [
        "进入修复模式。请忽略之前失败的命令文本，只根据以下权威信息重新提交最终计划。",
        "当前层条目：",
        scan_lines,
    ]
    if user_constraints:
        repair_prompt.append("已确认用户偏好：")
        repair_prompt.extend(f"- {item}" for item in user_constraints)
    repair_prompt.append("最近一次失败原因：")
    repair_prompt.append(build_command_retry_message(validation))
    return [
        {"role": "system", "content": "你处于整理计划修复模式，只能提交一个完整且可执行的最终计划。"},
        {"role": "user", "content": "\n".join(repair_prompt)},
    ]


def _extract_plan_submissions(message) -> tuple[str, PlanDiff | None, FinalPlan | None, PlanDisplayRequest | None]:
    content = getattr(message, "content", "") or ""
    plan_diff = None
    final_plan = None
    display_request = None
    for tool_call in getattr(message, "tool_calls", None) or []:
        args = json.loads(tool_call.function.arguments)
        if tool_call.function.name == PLAN_DIFF_TOOL_NAME:
            plan_diff = PlanDiff.from_dict(args)
        elif tool_call.function.name == PRESENT_PLAN_TOOL_NAME:
            display_request = PlanDisplayRequest.from_dict(args)
        elif tool_call.function.name == FINAL_PLAN_TOOL_NAME:
            final_plan = FinalPlan.from_dict(args)
            
    if plan_diff is not None and final_plan is not None:
        final_plan = None
        content += "\n[系统提示: 你在同一轮回复中既提交了 plan_diff 增量更新，又提交了 final_plan 最终计划。系统已优先执行 plan_diff 更新状态。请在之后用户确认无误的一轮中，单独调用 final_plan。]"
        
    return content, plan_diff, final_plan, display_request


def run_organizer_cycle(
    messages: list,
    scan_lines: str,
    pending_plan: PendingPlan | None = None,
    user_constraints: list[str] | None = None,
    event_handler=None,
    model: str = ORGANIZER_MODEL_NAME,
    max_retries: int = 3,
) -> tuple[str, dict | None]:
    current_pending = pending_plan or PendingPlan()
    current_constraints = list(user_constraints or [])

    # === Context Truncation (修剪长对话记忆) ===
    # 限制 messages 的总长度，避免在几十轮对话后超出大模型 token 限制或导致遗忘 System Prompt
    MAX_HISTORY = 8
    if len(messages) > MAX_HISTORY + 1:
        system_prompt = messages[0]
        tail = messages[-MAX_HISTORY:]
        state_snapshot = "[系统内部快照：由于对话过长，早期的交互记录已被清除]\n当前已形成的待定计划如下，请基于此状态继续与用户讨论增量修改，不要遗失已有分类：\n"
        state_snapshot += f"当前摘要：{current_pending.summary}\n"
        if current_pending.moves:
            state_snapshot += "移动关系：\n" + "\n".join(f"- {m.source} -> {m.target}" for m in current_pending.moves[:30])
            if len(current_pending.moves) > 30:
                state_snapshot += f"\n... (还有 {len(current_pending.moves) - 30} 项已省略)"
        if current_pending.unresolved_items:
            state_snapshot += f"\n待确认项：{current_pending.unresolved_items}"
        if current_constraints:
            state_snapshot += f"\n用户强制约束：{current_constraints}"
            
        messages.clear()
        messages.extend([system_prompt, {"role": "system", "content": state_snapshot}] + tail)

    for attempt in range(1, max_retries + 1):
        message = chat_one_round(messages, event_handler=event_handler, model=model, return_message=True)
        content, plan_diff, final_plan, display_request = _extract_plan_submissions(message)
        display_plan = display_request.to_dict() if display_request else None

        if content:
            messages.append({"role": "assistant", "content": content})

        if plan_diff is not None:
            scan_items = extract_scan_items(scan_lines)
            updated_pending, diff_summary, diff_errors = apply_plan_diff(current_pending, plan_diff, valid_sources=scan_items)
            
            if diff_errors:
                if attempt < max_retries:
                    err_msg = "增量更新由于包含不存在的文件源而失败:\n" + "\n".join(f"- {e}" for e in diff_errors) + "\n请务必只处理真正的当前层条名称。"
                    messages.append({"role": "user", "content": err_msg})
                    continue
                else:
                    return content, None

            if display_plan is None:
                display_plan = PlanDisplayRequest(
                    focus="summary",
                    summary=updated_pending.summary or "请先看整理摘要",
                ).to_dict()
            return content, {
                "is_valid": False,
                "pending_plan": updated_pending,
                "diff_summary": diff_summary,
                "display_plan": display_plan,
                "final_plan": None,
                "repair_mode": False,
                "user_constraints": current_constraints,
            }

        if final_plan is None:
            return content, {
                "is_valid": False,
                "pending_plan": current_pending,
                "diff_summary": [],
                "display_plan": display_plan,
                "final_plan": None,
                "repair_mode": False,
                "user_constraints": current_constraints,
            }

        validation = validate_final_plan(scan_lines, final_plan)
        if validation["is_valid"]:
            emit(event_handler, "command_validation_pass", {"attempt": attempt, "details": validation})
            updated_pending = _pending_from_final(final_plan)
            diff_summary = _build_plan_change_summary((current_pending or PendingPlan()).with_derived_directories(), updated_pending)
            return content, {
                "is_valid": True,
                "pending_plan": updated_pending,
                "diff_summary": diff_summary,
                "display_plan": display_plan,
                "final_plan": final_plan,
                "repair_mode": False,
                "user_constraints": current_constraints,
                "validation": validation,
            }

        emit(event_handler, "command_validation_fail", {"attempt": attempt, "details": validation})
        if attempt < max_retries:
            messages.append({"role": "user", "content": build_command_retry_message(validation, scan_lines, current_constraints)})
            continue

        emit(event_handler, "command_retry_exhausted", {"attempt": attempt, "details": validation})
        emit(event_handler, "repair_mode_start", {"attempt": attempt, "details": validation})
        repair_message = chat_one_round(
            _build_repair_messages(scan_lines, current_constraints, validation),
            event_handler=event_handler,
            model=model,
            tools=[tool for tool in organizer_tools if tool["function"]["name"] == FINAL_PLAN_TOOL_NAME],
            return_message=True,
        )
        repair_content, _, repaired_plan, _ = _extract_plan_submissions(repair_message)
        repair_validation = validate_final_plan(scan_lines, repaired_plan or FinalPlan())
        if repaired_plan is not None and repair_validation["is_valid"]:
            emit(event_handler, "command_validation_pass", {"attempt": attempt + 1, "details": repair_validation})
            updated_pending = _pending_from_final(repaired_plan)
            diff_summary = _build_plan_change_summary((current_pending or PendingPlan()).with_derived_directories(), updated_pending)
            return repair_content, {
                "is_valid": True,
                "pending_plan": updated_pending,
                "diff_summary": diff_summary,
                "display_plan": None,
                "final_plan": repaired_plan,
                "repair_mode": True,
                "user_constraints": current_constraints,
                "validation": repair_validation,
            }

        return repair_content, {
            "is_valid": False,
            "pending_plan": current_pending,
            "diff_summary": [],
            "display_plan": None,
            "final_plan": None,
            "repair_mode": True,
            "user_constraints": current_constraints,
            "validation": repair_validation,
        }

    return "", None


organizer_tools = [
    {
        "type": "function",
        "function": {
            "name": PLAN_DIFF_TOOL_NAME,
            "description": "提交待定整理计划的增量变更。只要用户对某个 unresolved 项表达了确认或指定了位置，必须通过 unresolved_removals 将其移除，即使 target 路径未变。",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory_renames": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "from": {"type": "string"},
                                "to": {"type": "string"},
                            },
                            "required": ["from", "to"],
                        },
                    },
                    "move_updates": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source": {"type": "string"},
                                "target": {"type": "string"},
                            },
                            "required": ["source", "target"],
                        },
                    },
                    "unresolved_adds": {"type": "array", "items": {"type": "string"}},
                    "unresolved_removals": {"type": "array", "items": {"type": "string"}},
                    "summary": {"type": "string"},
                },
                "required": ["directory_renames", "move_updates", "unresolved_adds", "unresolved_removals", "summary"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": PRESENT_PLAN_TOOL_NAME,
            "description": "请求系统把当前待定整理计划展示给用户，优先使用摘要视图，避免在自然语言中重复整套列表。",
            "parameters": {
                "type": "object",
                "properties": {
                    "focus": {"type": "string", "enum": ["summary", "changes", "details", "unresolved"]},
                    "summary": {"type": "string"},
                },
                "required": ["focus", "summary"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": FINAL_PLAN_TOOL_NAME,
            "description": "提交最终可执行的结构化整理计划。",
            "parameters": {
                "type": "object",
                "properties": {
                    "directories": {"type": "array", "items": {"type": "string"}},
                    "moves": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source": {"type": "string"},
                                "target": {"type": "string"},
                            },
                            "required": ["source", "target"],
                        },
                    },
                    "unresolved_items": {"type": "array", "items": {"type": "string"}},
                    "summary": {"type": "string"},
                },
                "required": ["directories", "moves", "unresolved_items", "summary"],
            },
        },
    },
]

# 兼容旧模块内部辅助函数命名
_normalize_source_name = normalize_source_name
_split_relative_parts = split_relative_parts

