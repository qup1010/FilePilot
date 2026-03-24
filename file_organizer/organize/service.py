import json
import re
from collections import Counter, defaultdict

from file_organizer.organize.models import (
    FinalPlan,
    PendingPlan,
    PlanDiff,
    PlanDisplayRequest,
    PlanMove,
    UnresolvedChoiceRequest,
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
UNRESOLVED_CHOICES_TOOL_NAME = "request_unresolved_choices"
REPAIR_FINAL_PLAN_TOOL_NAME = "repair_commit_final_plan"
MODEL_WAIT_MESSAGE = "正在等待模型回复..."


def get_scan_content() -> str:
    if not RESULT_FILE_PATH.exists():
        raise FileNotFoundError(f"未找到扫描结果：{RESULT_FILE_PATH}")
    return RESULT_FILE_PATH.read_text(encoding="utf-8").strip()


def _build_initial_request_text(user_constraints: list[str] | None = None) -> str:
    lines = [
        "请基于上述扫描结果和整理规则，为我生成初始的整理建议。请先用一句话说明你的整理思路，再调用 submit_plan_diff 提交你的初步设想。"
    ]
    if user_constraints:
        lines.append("本次已确认的补充偏好：")
        lines.extend(f"- {item}" for item in user_constraints)
    return "\n".join(lines)


def build_initial_messages(scan_lines: str, strategy: dict | None = None, user_constraints: list[str] | None = None) -> list:
    return [
        {"role": "system", "content": build_prompt(scan_lines, strategy)},
        {"role": "user", "content": _build_initial_request_text(user_constraints)},
    ]


def _serialize_tool_call(tool_call) -> dict:
    if isinstance(tool_call, dict):
        function = tool_call.get("function", {}) or {}
        return {
            "id": tool_call.get("id"),
            "type": tool_call.get("type", "function"),
            "function": {
                "name": function.get("name", "") or "",
                "arguments": function.get("arguments", "") or "",
            },
        }

    function = getattr(tool_call, "function", None)
    return {
        "id": getattr(tool_call, "id", None),
        "type": getattr(tool_call, "type", "function"),
        "function": {
            "name": getattr(function, "name", "") or "",
            "arguments": getattr(function, "arguments", "") or "",
        },
    }


def _serialize_tool_calls(tool_calls) -> list[dict]:
    return [_serialize_tool_call(tool_call) for tool_call in (tool_calls or [])]


def _serialize_tool_call_delta(tool_call_delta) -> dict:
    function = getattr(tool_call_delta, "function", None)
    return {
        "index": getattr(tool_call_delta, "index", None),
        "id": getattr(tool_call_delta, "id", None),
        "type": getattr(tool_call_delta, "type", "function"),
        "function": {
            "name": getattr(function, "name", None),
            "arguments": getattr(function, "arguments", None),
        },
    }


def _build_assistant_message(content: str, tool_calls=None, blocks: list[dict] | None = None) -> dict:
    message = {"role": "assistant", "content": content or ""}
    serialized_tool_calls = _serialize_tool_calls(tool_calls)
    if serialized_tool_calls:
        message["tool_calls"] = serialized_tool_calls
    if blocks:
        message["blocks"] = list(blocks)
    return message


def _unresolved_request_to_block(request: UnresolvedChoiceRequest | None) -> dict | None:
    if request is None:
        return None
    return {
        "type": "unresolved_choices",
        "request_id": request.request_id,
        "summary": request.summary,
        "status": "pending",
        "items": [item.to_dict() for item in request.items],
    }


def _build_tool_result_message(tool_call_id: str | None, name: str, content: dict) -> dict:
    return {
        "role": "tool",
        "tool_call_id": tool_call_id,
        "name": name,
        "content": json.dumps(content, ensure_ascii=False),
    }


def _build_tool_result_messages(
    message,
    *,
    plan_diff=None,
    diff_errors: list[str] | None = None,
    unresolved_request: UnresolvedChoiceRequest | None = None,
    validation: dict | None = None,
) -> list[dict]:
    tool_messages = []
    for tool_call in getattr(message, "tool_calls", None) or []:
        name = getattr(tool_call.function, "name", "")
        if name == PLAN_DIFF_TOOL_NAME:
            payload = {
                "ok": not bool(diff_errors),
                "summary": getattr(plan_diff, "summary", ""),
                "errors": diff_errors or [],
            }
        elif name == UNRESOLVED_CHOICES_TOOL_NAME:
            payload = {
                "ok": unresolved_request is not None,
                "request_id": getattr(unresolved_request, "request_id", ""),
            }
        elif name == REPAIR_FINAL_PLAN_TOOL_NAME:
            payload = {
                "ok": bool(validation and validation.get("is_valid")),
                "validation": validation,
            }
        else:
            payload = {"ok": True}

        tool_messages.append(
            _build_tool_result_message(getattr(tool_call, "id", None), name, payload)
        )
    return tool_messages


def _render_blocks_for_llm(blocks: list[dict] | None) -> str:
    if not blocks:
        return ""

    lines: list[str] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        if block.get("type") != "unresolved_choices":
            continue

        request_id = str(block.get("request_id") or "").strip()
        summary = str(block.get("summary") or "").strip()
        status = str(block.get("status") or "pending").strip()
        header = f"[待确认请求 {request_id} | 状态: {status}]".strip()
        if summary:
            header = f"{header} {summary}"
        lines.append(header)

        for item in block.get("items") or []:
            if not isinstance(item, dict):
                continue
            display_name = str(item.get("display_name") or item.get("item_id") or "").strip()
            question = str(item.get("question") or "").strip()
            folders = [str(folder).strip() for folder in (item.get("suggested_folders") or []) if str(folder).strip()]
            item_line = f"- {display_name}"
            if question:
                item_line = f"{item_line}: {question}"
            lines.append(item_line)
            if folders:
                lines.append(f"  候选目录: {' / '.join(folders)}")

        submitted = block.get("submitted_resolutions") or []
        if submitted:
            lines.append("  用户已提交选择：")
            for resolution in submitted:
                if not isinstance(resolution, dict):
                    continue
                label = str(resolution.get("display_name") or resolution.get("item_id") or "").strip()
                selected_folder = str(resolution.get("selected_folder") or "").strip()
                note = str(resolution.get("note") or "").strip()
                if selected_folder:
                    lines.append(f"  - {label} -> {selected_folder}")
                if note:
                    lines.append(f"  - {label} 备注: {note}")

    return "\n".join(lines).strip()


def _sanitize_messages_for_llm(messages: list[dict]) -> list[dict]:
    sanitized: list[dict] = []
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "").strip()
        if not role:
            continue

        content = str(message.get("content") or "")
        block_context = _render_blocks_for_llm(message.get("blocks"))
        if block_context:
            content = f"{content}\n\n{block_context}".strip() if content.strip() else block_context

        if role in {"system", "user"}:
            sanitized.append({"role": role, "content": content})
            continue

        if role == "assistant":
            assistant_message = {"role": "assistant", "content": content}
            serialized_tool_calls = _serialize_tool_calls(message.get("tool_calls"))
            if serialized_tool_calls:
                assistant_message["tool_calls"] = serialized_tool_calls
            sanitized.append(assistant_message)
            continue

        if role == "tool":
            tool_message = {
                "role": "tool",
                "content": content,
                "tool_call_id": message.get("tool_call_id"),
            }
            sanitized.append(tool_message)
            continue

        sanitized.append({"role": role, "content": content})
    return sanitized


def _debug_enabled() -> bool:
    import os

    from file_organizer.shared.config import config_manager

    return config_manager.get("DEBUG_MODE", False) or os.getenv("DEBUG_MODE") == "True"


def _stream_enabled() -> bool:
    import os

    raw = os.getenv("ORGANIZER_CHAT_STREAM")
    if raw is None:
        return True
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _load_debug_history(debug_log) -> list:
    if not debug_log.exists():
        return []
    try:
        with open(debug_log, "r", encoding="utf-8") as file:
            history = json.load(file)
        return history if isinstance(history, list) else []
    except Exception:
        return []


def _write_debug_history(debug_log, history: list) -> None:
    with open(debug_log, "w", encoding="utf-8") as file:
        json.dump(history, file, indent=2, ensure_ascii=False)


def _update_debug_log_response(
    *,
    raw_content: str,
    display_content: str,
    tool_calls: list[dict],
    chunks: list[dict] | None = None,
    synthetic_content_used: bool,
    response_mode: str | None = None,
    raw_response=None,
) -> None:
    from file_organizer.shared.config import RUNTIME_DIR

    if not _debug_enabled():
        return

    debug_log = RUNTIME_DIR / "debug_prompt.json"
    history = _load_debug_history(debug_log)
    if not history:
        return

    try:
        existing_response = history[-1].get("response")
        existing_chunks = []
        if isinstance(existing_response, dict):
            existing_chunks = existing_response.get("chunks", []) or []
        history[-1]["response"] = {
            "raw_content": raw_content,
            "display_content": display_content,
            "tool_calls": tool_calls,
            "chunks": existing_chunks if chunks is None else chunks,
            "synthetic_content_used": synthetic_content_used,
            "response_mode": response_mode,
            "raw_response": raw_response,
        }
        _write_debug_history(debug_log, history)
        print(f"[DEBUG] Round {len(history)} response recorded.")
    except Exception:
        pass


def chat_one_round(messages: list, event_handler=None, model: str = ORGANIZER_MODEL_NAME, tools=None, tool_choice="auto", return_message=False):
    from file_organizer.shared.config import RUNTIME_DIR, config_manager
    from datetime import datetime
    
    # 动态获取状态
    is_debug = config_manager.get("DEBUG_MODE", False) or _debug_enabled()
    stream_enabled = _stream_enabled()
    debug_log = RUNTIME_DIR / "debug_prompt.json"
    
    request_messages = _sanitize_messages_for_llm(messages)

    if is_debug:
        history = []
        # 如果是起始消息（系统提示+第一条提问），则清空之前的日志
        is_first_round = len(request_messages) <= 2
        
        if not is_first_round and debug_log.exists():
            history = _load_debug_history(debug_log)
        
        current_round = len(history) + 1
        new_entry = {
            "round": current_round,
            "timestamp": datetime.now().strftime("%H:%M:%S"),
            "request": request_messages,
            "request_meta": {
                "stream": stream_enabled,
                "tool_choice": tool_choice,
                "tool_count": len(tools or organizer_tools),
            },
            "response": "processing..."
        }
        history.append(new_entry)
        
        try:
            _write_debug_history(debug_log, history)
        except Exception as e:
            print(f"[DEBUG] Failed to write debug log: {e}")

    client = create_openai_client()
    
    emit(event_handler, "model_wait_start", {"message": MODEL_WAIT_MESSAGE})
    
    # 启用流式传输以获得更好的 UI 体验
    full_content = ""
    full_tool_calls_raw = []
    chunk_records = []
    response_mode = "stream" if stream_enabled else "non_stream"
    raw_response = None
    
    try:
        stream = client.chat.completions.create(
            model=model,
            messages=request_messages,
            tools=tools or organizer_tools,
            tool_choice=tool_choice,
            stream=stream_enabled
        )

    finally:
        emit(event_handler, "model_wait_end")

    emit(event_handler, "ai_streaming_start")
    if hasattr(stream, "choices"):
        choice = stream.choices[0]
        message = choice.message
        if hasattr(stream, "model_dump"):
            try:
                raw_response = stream.model_dump()
            except Exception:
                raw_response = None
        full_content = getattr(message, "content", "") or ""
        if full_content:
            emit(event_handler, "ai_chunk", {"content": full_content})
        for tool_call in getattr(message, "tool_calls", None) or []:
            full_tool_calls_raw.append(_serialize_tool_call(tool_call))
        chunk_records.append({
            "delta_content": full_content or None,
            "delta_tool_calls": full_tool_calls_raw or None,
            "finish_reason": getattr(choice, "finish_reason", None),
        })
    else:
        # 收集流式输出
        for chunk in stream:
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = choice.delta
            chunk_records.append({
                "delta_content": getattr(delta, "content", None),
                "delta_tool_calls": [
                    _serialize_tool_call_delta(tc_delta)
                    for tc_delta in (getattr(delta, "tool_calls", None) or [])
                ] or None,
                "finish_reason": getattr(choice, "finish_reason", None),
            })
            
            # 文本部分
            if getattr(delta, "content", None):
                full_content += delta.content
                emit(event_handler, "ai_chunk", {"content": delta.content})
            
            # 工具调用部分
            if getattr(delta, "tool_calls", None):
                for tc_delta in delta.tool_calls:
                    idx = tc_delta.index
                    while len(full_tool_calls_raw) <= idx:
                        full_tool_calls_raw.append({"id": None, "type": "function", "function": {"name": "", "arguments": ""}})
                    
                    if tc_delta.id:
                        full_tool_calls_raw[idx]["id"] = tc_delta.id
                    if tc_delta.function.name:
                        full_tool_calls_raw[idx]["function"]["name"] += tc_delta.function.name
                    if tc_delta.function.arguments:
                        full_tool_calls_raw[idx]["function"]["arguments"] += tc_delta.function.arguments

    emit(event_handler, "ai_streaming_end", {"full_content": full_content})

    _update_debug_log_response(
        raw_content=full_content,
        display_content=full_content,
        tool_calls=full_tool_calls_raw,
        chunks=chunk_records,
        synthetic_content_used=False,
        response_mode=response_mode,
        raw_response=raw_response,
    )

    # 构造兼容的 Message 对象供后续解析
    from types import SimpleNamespace
    tool_calls = []
    for tc in full_tool_calls_raw:
        if tc["function"]["name"]:
            tool_calls.append(SimpleNamespace(
                id=tc["id"],
                type="function",
                function=SimpleNamespace(name=tc["function"]["name"], arguments=tc["function"]["arguments"])
            ))
            
    message = SimpleNamespace(content=full_content, tool_calls=tool_calls if tool_calls else None)
    if return_message:
        return message
    return full_content


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

        # [漏洞 3 修复]：最终提交不允许存在 Review 路径
        if normalized_target.lower().startswith("review/") or normalized_target.lower() == "review":
            result["path_errors"].append(f"最终计划中不允许存在 Review 目录：{source_name} -> {normalized_target}")
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
        
        # [漏洞 1 修复]：如果 AI 手动分配了具体目录（非 Review/），则自动视为已确认
        target_path = move.target.lower().replace("\\", "/")
        if not target_path.startswith("review/") and target_path != "review":
            # 将其加入临时移除集合
            diff.unresolved_removals.append(src)

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


def _build_repair_messages(
    scan_lines: str,
    user_constraints: list[str],
    validation: dict,
    strategy_instructions: str | None = None,
) -> list[dict]:
    repair_prompt = [
        "进入修复模式。请忽略之前失败的命令文本，只根据以下权威信息重新提交最终计划。",
        "当前层条目：",
        scan_lines,
    ]
    if strategy_instructions:
        repair_prompt.append("当前固定整理策略：")
        repair_prompt.append(strategy_instructions)
    if user_constraints:
        repair_prompt.append("已确认用户偏好：")
        repair_prompt.extend(f"- {item}" for item in user_constraints)
    repair_prompt.append("最近一次失败原因：")
    repair_prompt.append(build_command_retry_message(validation))
    return [
        {"role": "system", "content": "你处于整理计划修复模式，只能提交一个完整且可执行的最终计划。"},
        {"role": "user", "content": "\n".join(repair_prompt)},
    ]


def _extract_plan_submissions(
    message,
) -> tuple[str, PlanDiff | None, FinalPlan | None, UnresolvedChoiceRequest | None]:
    content = getattr(message, "content", "") or ""
    plan_diff = None
    final_plan = None
    unresolved_request = None
    for tool_call in getattr(message, "tool_calls", None) or []:
        args = json.loads(tool_call.function.arguments)
        if tool_call.function.name == PLAN_DIFF_TOOL_NAME:
            plan_diff = PlanDiff.from_dict(args)

        elif tool_call.function.name == UNRESOLVED_CHOICES_TOOL_NAME:
            unresolved_request = UnresolvedChoiceRequest.from_dict(args)
        elif tool_call.function.name == REPAIR_FINAL_PLAN_TOOL_NAME:
            final_plan = FinalPlan.from_dict(args)
            
    if plan_diff is not None and final_plan is not None:
        final_plan = None
        content += "\n[系统提示: 你在同一轮回复中既提交了 plan_diff 增量更新，又提交了 final_plan 最终计划。系统已优先执行 plan_diff 更新状态。]"
        
    return content, plan_diff, final_plan, unresolved_request


def run_organizer_cycle(
    messages: list,
    scan_lines: str,
    pending_plan: PendingPlan | None = None,
    user_constraints: list[str] | None = None,
    strategy_instructions: str | None = None,
    event_handler=None,
    model: str = ORGANIZER_MODEL_NAME,
    max_retries: int = 3,
) -> tuple[str, dict | None]:
    current_pending = pending_plan or PendingPlan()
    current_constraints = list(user_constraints or [])

    llm_messages = list(messages)
    
    # NOTE: 采用循环机制实现后台自动修正。若 AI 提交的指令（如 FINAL_PLAN）校验失败，
    # 系统会根据失败细节构造反馈消息并触发下一次尝试，直到达到最大重试次数。
    for attempt in range(1, max_retries + 1):
        # 核心：发起 AI 对话获取建议
        message = chat_one_round(llm_messages, event_handler=event_handler, model=model, return_message=True)
        raw_content = getattr(message, "content", "") or ""
        content, plan_diff, final_plan, unresolved_request = _extract_plan_submissions(message)
        message_blocks = []
        unresolved_block = _unresolved_request_to_block(unresolved_request)
        if unresolved_block:
            message_blocks.append(unresolved_block)
        assistant_context_message = _build_assistant_message(
            raw_content,
            getattr(message, "tool_calls", None),
            blocks=message_blocks,
        )
        synthetic_content_used = False
        
        # HACK: 补救逻辑。如果模型没说话（可能由于 Tool Use 机制仅输出了工具调用）
        # 但 plan_diff 中带有 summary，则借用该 summary 作为对话文本进行流式输出。
        if not content and plan_diff and plan_diff.summary:
            synthetic_content_used = True
            content = f"我已经根据你的要求更新了计划：{plan_diff.summary}"
            emit(event_handler, "ai_chunk", {"content": content})

        assistant_display_message = _build_assistant_message(
            content,
            getattr(message, "tool_calls", None),
            blocks=message_blocks,
        )
        _update_debug_log_response(
            raw_content=raw_content,
            display_content=content,
            tool_calls=_serialize_tool_calls(getattr(message, "tool_calls", None)),
            chunks=None,
            synthetic_content_used=synthetic_content_used,
        )
            

        if plan_diff is not None:
            scan_items = extract_scan_items(scan_lines)
            updated_pending, diff_summary, diff_errors = apply_plan_diff(current_pending, plan_diff, valid_sources=scan_items)
            tool_result_messages = _build_tool_result_messages(
                message,
                plan_diff=plan_diff,
                diff_errors=diff_errors,
                unresolved_request=unresolved_request,
            )
            assistant_context_messages = [assistant_context_message, *tool_result_messages]
            
            if diff_errors:
                if attempt < max_retries:
                    err_msg = "增量更新由于包含不存在的文件源而失败:\n" + "\n".join(f"- {e}" for e in diff_errors) + "\n请务必只处理真正的当前层条名称。"
                    llm_messages.extend(assistant_context_messages)
                    llm_messages.append({"role": "user", "content": err_msg})
                    continue
                else:
                    return content, None

            return content, {
                "is_valid": False,
                "pending_plan": updated_pending,
                "diff_summary": diff_summary,
                "display_plan": PlanDisplayRequest(
                    focus="summary",
                    summary=updated_pending.summary or "请先看整理摘要",
                ).to_dict(),
                "unresolved_request": unresolved_request.to_dict() if unresolved_request else None,
                "final_plan": None,
                "repair_mode": False,
                "user_constraints": current_constraints,
                "assistant_message": assistant_display_message,
                "assistant_context_message": assistant_context_message,
                "assistant_context_messages": assistant_context_messages,
            }

        # 场景 B: AI 仅回复文字说明，未发起任何方案层面的增量修改或最终提交
        if final_plan is None:
            tool_result_messages = _build_tool_result_messages(
                message,
                unresolved_request=unresolved_request,
            )
            return content, {
                "is_valid": False,
                "pending_plan": current_pending,
                "diff_summary": [],
                "display_plan": None,
                "unresolved_request": unresolved_request.to_dict() if unresolved_request else None,
                "final_plan": None,
                "repair_mode": False,
                "user_constraints": current_constraints,
                "assistant_message": assistant_display_message,
                "assistant_context_message": assistant_context_message,
                "assistant_context_messages": [assistant_context_message, *tool_result_messages],
            }

        # 场景 C: AI 尝试提交最终可执行方案
        # NOTE: 严苛校验是防止 AI 幻觉引发文件丢失/错误操作的最后防线。
        validation = validate_final_plan(scan_lines, final_plan)
        tool_result_messages = _build_tool_result_messages(
            message,
            unresolved_request=unresolved_request,
            validation=validation,
        )
        assistant_context_messages = [assistant_context_message, *tool_result_messages]
        if validation["is_valid"]:
            emit(event_handler, "command_validation_pass", {"attempt": attempt, "details": validation})
            updated_pending = _pending_from_final(final_plan)
            diff_summary = _build_plan_change_summary((current_pending or PendingPlan()).with_derived_directories(), updated_pending)
            return content, {
                "is_valid": True,
                "pending_plan": updated_pending,
                "diff_summary": diff_summary,
                "display_plan": None,
                "unresolved_request": unresolved_request.to_dict() if unresolved_request else None,
                "final_plan": final_plan,
                "repair_mode": False,
                "user_constraints": current_constraints,
                "validation": validation,
                "assistant_message": assistant_display_message,
                "assistant_context_message": assistant_context_message,
                "assistant_context_messages": assistant_context_messages,
            }

        # 如果最终方案校验失败（例如 AI 忽略了部分文件或生成了错误的 mkdir 路径），则反馈具体原因并递归重试。
        emit(event_handler, "command_validation_fail", {"attempt": attempt, "details": validation})
        if attempt < max_retries:
            llm_messages.extend(assistant_context_messages)
            llm_messages.append({"role": "user", "content": build_command_retry_message(validation, scan_lines, current_constraints)})
            continue

        # 极限情况：标准重试次数耗尽，仍无法给出合法方案。此时开启“修复模式”。
        # NOTE: 修复模式旨在通过“权威隔离”消除长对话中的上下文噪声。我们丢弃多轮对话历史，
        # 并给 AI 一个极其简短、严厉且唯一的指令，强制其根据当前的 scan_lines 重新生成 FinalPlan。
        emit(event_handler, "command_retry_exhausted", {"attempt": attempt, "details": validation})
        emit(event_handler, "repair_mode_start", {"attempt": attempt, "details": validation})
        repair_message = chat_one_round(
            _build_repair_messages(scan_lines, current_constraints, validation, strategy_instructions),
            event_handler=event_handler,
            model=model,
            tools=[repair_final_plan_tool],
            return_message=True,
        )
        repair_content, _, repaired_plan, _ = _extract_plan_submissions(repair_message)
        repair_validation = validate_final_plan(scan_lines, repaired_plan or FinalPlan())
        if repaired_plan is not None and repair_validation["is_valid"]:
            emit(event_handler, "command_validation_pass", {"attempt": attempt + 1, "details": repair_validation})
            updated_pending = _pending_from_final(repaired_plan)
            diff_summary = _build_plan_change_summary((current_pending or PendingPlan()).with_derived_directories(), updated_pending)
            repair_raw_content = getattr(repair_message, "content", "") or ""
            repair_display_message = _build_assistant_message(repair_content, getattr(repair_message, "tool_calls", None))
            repair_context_message = _build_assistant_message(repair_raw_content, getattr(repair_message, "tool_calls", None))
            repair_tool_messages = _build_tool_result_messages(
                repair_message,
                validation=repair_validation,
            )
            return repair_content, {
                "is_valid": True,
                "pending_plan": updated_pending,
                "diff_summary": diff_summary,
                "display_plan": None,
                "final_plan": repaired_plan,
                "repair_mode": True,
                "user_constraints": current_constraints,
                "validation": repair_validation,
                "assistant_message": repair_display_message,
                "assistant_context_message": repair_context_message,
                "assistant_context_messages": [repair_context_message, *repair_tool_messages],
            }

        repair_raw_content = getattr(repair_message, "content", "") or ""
        repair_display_message = _build_assistant_message(repair_content, getattr(repair_message, "tool_calls", None))
        repair_context_message = _build_assistant_message(repair_raw_content, getattr(repair_message, "tool_calls", None))
        repair_tool_messages = _build_tool_result_messages(
            repair_message,
            validation=repair_validation,
        )
        return repair_content, {
            "is_valid": False,
            "pending_plan": current_pending,
            "diff_summary": [],
            "display_plan": None,
            "final_plan": None,
            "repair_mode": True,
            "user_constraints": current_constraints,
            "validation": repair_validation,
            "assistant_message": repair_display_message,
            "assistant_context_message": repair_context_message,
            "assistant_context_messages": [repair_context_message, *repair_tool_messages],
        }

    return "", None


repair_final_plan_tool = {
    "type": "function",
    "function": {
        "name": REPAIR_FINAL_PLAN_TOOL_NAME,
        "description": "仅在修复模式下提交完整最终方案，用于根据校验错误重建一份可执行的 FinalPlan。",
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
            "required": ["directories", "moves", "unresolved_items"],
        },
    },
}


organizer_tools = [
    {
        "type": "function",
        "function": {
            "name": PLAN_DIFF_TOOL_NAME,
            "description": "提交待定整理计划的变更。只要用户对某个 unresolved 项表达了确认或指定了位置，必须通过 unresolved_removals 将其移除，即使 target 路径未变。",
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
            "name": UNRESOLVED_CHOICES_TOOL_NAME,
            "description": "如果有用户明确决策的待确认项（unresolved items）调用此工具以获取用户对每个 unresolved items 的选择。每个 item 必须提供 2 个候选目录名，且不要把 Review 放进 suggested_folders。",
            "parameters": {
                "type": "object",
                "properties": {
                    "request_id": {"type": "string"},
                    "summary": {"type": "string"},
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "item_id": {"type": "string"},
                                "display_name": {"type": "string"},
                                "question": {"type": "string"},
                                "suggested_folders": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "minItems": 2,
                                    "maxItems": 2,
                                },
                            },
                            "required": ["item_id", "display_name", "question", "suggested_folders"],
                        },
                    },
                },
                "required": ["request_id", "summary", "items"],
            },
        },
    },
]

# 兼容旧模块内部辅助函数命名
_normalize_source_name = normalize_source_name
_split_relative_parts = split_relative_parts

