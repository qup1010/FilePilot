import json
import math
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from types import SimpleNamespace

from file_organizer.analysis.file_reader import list_local_files, read_local_file
from file_organizer.analysis.models import AnalysisItem
from file_organizer.analysis.prompts import build_system_prompt
from file_organizer.shared.config import ANALYSIS_MODEL_NAME, RESULT_FILE_PATH, create_openai_client
from file_organizer.shared.events import emit
from file_organizer.shared.path_utils import normalize_entry_name, resolve_tool_path

MAX_ANALYSIS_RETRIES = 3
BATCH_ANALYSIS_RETRIES = 2
BATCH_THRESHOLD = 30
BATCH_TARGET_SIZE = 15
MAX_WORKERS = 3
WORKDIR_PATH = Path.cwd().resolve()
SUBMIT_ANALYSIS_TOOL_NAME = "submit_analysis_result"


def get_client():
    return create_openai_client()


def _coerce_analysis_items(items: list[AnalysisItem] | list[dict] | None) -> list[AnalysisItem]:
    return [item if isinstance(item, AnalysisItem) else AnalysisItem.from_dict(item) for item in (items or [])]


def _normalize_analysis_items(items: list[AnalysisItem] | list[dict] | None, directory: Path) -> tuple[list[AnalysisItem], list[str]]:
    normalized_items: list[AnalysisItem] = []
    invalid_lines: list[str] = []
    for item in _coerce_analysis_items(items):
        raw_name = item.entry_name.strip()
        if not raw_name:
            invalid_lines.append(item.entry_name)
            continue
        normalized_name = normalize_entry_name(raw_name, directory)
        if not normalized_name:
            invalid_lines.append(item.entry_name)
            continue
        item_data = dict(item.__dict__)
        item_data["entry_name"] = normalized_name
        normalized_items.append(AnalysisItem.from_dict(item_data))
    return normalized_items, invalid_lines


def render_analysis_items(items: list[AnalysisItem] | list[dict]) -> str:
    return "\n".join(item.to_scan_line() for item in _coerce_analysis_items(items))


def append_output_result(content: str | list[AnalysisItem] | list[dict]):
    """将结构化分析结果或兼容文本追加到标准结果文件中。"""
    if isinstance(content, list):
        extracted = render_analysis_items(content)
    else:
        extracted = extract_output_content(content)
        if not extracted and isinstance(content, str):
            extracted = content.strip()
    if not extracted:
        return None

    record = f"{extracted}\n"
    if RESULT_FILE_PATH.exists() and RESULT_FILE_PATH.stat().st_size > 0:
        record = "\n" + record

    with RESULT_FILE_PATH.open("a", encoding="utf-8") as file:
        file.write(record)

    return RESULT_FILE_PATH


def extract_output_content(content: str) -> str | None:
    """从旧版 AI 响应中提取 <output> 及其内容。"""
    blocks = re.findall(r"<output>(.*?)</output>", content or "", flags=re.S | re.I)
    extracted = "\n\n".join(block.strip() for block in blocks if block.strip())
    return extracted or None


def _list_current_entries(directory: Path) -> list[str]:
    """获取目录当前层的条目名列表。"""
    return sorted(entry.name for entry in directory.iterdir() if not entry.name.startswith("."))


def validate_analysis_items(
    items: list[AnalysisItem] | list[dict],
    directory: Path,
    expected_entries: list[str] | None = None,
) -> dict:
    parsed_items, invalid_lines = _normalize_analysis_items(items, directory)
    parsed_names = [item.entry_name for item in parsed_items]
    expected = set(expected_entries if expected_entries is not None else _list_current_entries(directory))
    actual = set(parsed_names)
    counter = Counter(parsed_names)

    duplicates = [name for name, count in counter.items() if count > 1]
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)

    is_valid = not (missing or extra or duplicates or invalid_lines)
    return {
        "is_valid": is_valid,
        "missing": missing,
        "extra": extra,
        "duplicates": duplicates,
        "invalid_lines": invalid_lines,
    }


def _parse_rendered_analysis_items(content: str, directory: Path) -> tuple[list[AnalysisItem], list[str]]:
    parsed_items: list[AnalysisItem] = []
    invalid_lines: list[str] = []
    output = extract_output_content(content) or (content or "").strip()
    if not output:
        return parsed_items, invalid_lines

    for line in output.splitlines():
        line = line.strip()
        if not line or re.match(r"^分析目录路径[:：]", line):
            continue
        if "|" not in line:
            invalid_lines.append(line)
            continue

        parts = [part.strip() for part in line.split("|", 2)]
        if len(parts) < 3:
            invalid_lines.append(line)
            continue

        name = normalize_entry_name(parts[0], directory)
        if not name:
            invalid_lines.append(line)
            continue
        parsed_items.append(
            AnalysisItem(
                entry_name=name,
                suggested_purpose=parts[1] or "待判断",
                summary=parts[2],
            )
        )
    return parsed_items, invalid_lines


def validate_analysis(content: str, directory: Path, expected_entries: list[str] | None = None) -> dict:
    """兼容旧版文本分析结果校验。"""
    output = extract_output_content(content) or (content or "").strip()
    if not output:
        return {"is_valid": False, "reason": "missing_output", "missing": [], "extra": [], "duplicates": [], "invalid_lines": []}

    parsed_items, invalid_lines = _parse_rendered_analysis_items(output, directory)
    result = validate_analysis_items(parsed_items, directory, expected_entries=expected_entries)
    if invalid_lines:
        result["invalid_lines"] = list(result.get("invalid_lines", [])) + invalid_lines
        result["is_valid"] = False
    return result


def _resolve_list_directory(target_dir: Path, raw_directory: str | None) -> Path | None:
    candidate = Path(resolve_tool_path(target_dir, raw_directory, default=".")).resolve()
    try:
        relative = candidate.relative_to(target_dir.resolve())
    except ValueError:
        return None
    if len(relative.parts) > 1:
        return None
    return candidate


def _resolve_readable_file(target_dir: Path, raw_filename: str | None) -> Path | None:
    candidate = Path(resolve_tool_path(target_dir, raw_filename)).resolve()
    try:
        candidate.relative_to(target_dir.resolve())
    except ValueError:
        return None
    if candidate.is_dir():
        return None
    return candidate


def _dispatch_tool_call(target_dir: Path, name: str, args: dict):
    if name == "read_local_file":
        filename = _resolve_readable_file(target_dir, args.get("filename"))
        if filename is None:
            return "错误：仅读取目标目录内的文件，不允许访问目录外路径。"
        return read_local_file(str(filename), allowed_base_dir=str(target_dir.resolve()))
    if name == "list_local_files":
        directory = _resolve_list_directory(target_dir, args.get("directory"))
        if directory is None:
            return "错误：动态扫描最多只能深入目标目录下一层。"
        requested_depth = max(0, int(args.get("max_depth", 0)))
        max_depth = 0 if directory == target_dir.resolve() else min(requested_depth, 1)
        return list_local_files(str(directory), max_depth=max_depth)
    return "Unknown tool"


def _extract_submitted_analysis(tool_calls) -> list[AnalysisItem] | None:
    for tool_call in tool_calls or []:
        if tool_call.function.name != SUBMIT_ANALYSIS_TOOL_NAME:
            continue
        args = json.loads(tool_call.function.arguments)
        return _coerce_analysis_items(args.get("items", []))
    return None


def _normalize_tool_calls(tool_calls) -> list[SimpleNamespace]:
    normalized = []
    for tool_call in tool_calls or []:
        if isinstance(tool_call, dict):
            function = tool_call.get("function") or {}
            normalized.append(
                SimpleNamespace(
                    id=tool_call.get("id"),
                    type=tool_call.get("type", "function"),
                    function=SimpleNamespace(
                        name=function.get("name", ""),
                        arguments=function.get("arguments", "") or "",
                    ),
                )
            )
            continue

        function = getattr(tool_call, "function", None)
        if function is None:
            continue
        normalized.append(
            SimpleNamespace(
                id=getattr(tool_call, "id", None),
                type=getattr(tool_call, "type", "function"),
                function=SimpleNamespace(
                    name=getattr(function, "name", ""),
                    arguments=getattr(function, "arguments", "") or "",
                ),
            )
        )
    return normalized


def _coerce_response_message(response):
    if hasattr(response, "choices"):
        choices = getattr(response, "choices", None) or []
        if not choices:
            raise ValueError("模型响应缺少 choices")
        message = getattr(choices[0], "message", None)
        if message is None:
            raise ValueError("模型响应缺少 message")
        return SimpleNamespace(
            content=getattr(message, "content", "") or "",
            tool_calls=_normalize_tool_calls(getattr(message, "tool_calls", None)),
        )

    if isinstance(response, str):
        text = response.strip()
        if text and text[0] in "[{":
            try:
                return _coerce_response_message(json.loads(text))
            except json.JSONDecodeError:
                pass
        return SimpleNamespace(content=text, tool_calls=[])

    if isinstance(response, dict):
        choices = response.get("choices") or []
        if not choices:
            raise ValueError("模型响应缺少 choices")
        message = choices[0].get("message") or {}
        return SimpleNamespace(
            content=message.get("content", "") or "",
            tool_calls=_normalize_tool_calls(message.get("tool_calls")),
        )

    if hasattr(response, "model_dump"):
        try:
            return _coerce_response_message(response.model_dump())
        except Exception:
            pass

    raise TypeError(f"不支持的模型响应类型: {type(response).__name__}")


def _serialize_assistant_message(message) -> dict:
    tool_calls_payload = []
    for tool_call in getattr(message, "tool_calls", None) or []:
        function = getattr(tool_call, "function", None)
        if function is None:
            continue
        tool_calls_payload.append(
            {
                "id": getattr(tool_call, "id", None),
                "type": getattr(tool_call, "type", "function"),
                "function": {
                    "name": getattr(function, "name", ""),
                    "arguments": getattr(function, "arguments", "") or "",
                },
            }
        )

    payload = {
        "role": "assistant",
        "content": getattr(message, "content", "") or "",
    }
    if tool_calls_payload:
        payload["tool_calls"] = tool_calls_payload
    return payload


def _emit_text_response(content: str, event_handler=None) -> None:
    if not content:
        return
    emit(event_handler, "ai_streaming_start")
    emit(event_handler, "ai_chunk", {"content": content})
    emit(event_handler, "ai_streaming_end", {"full_content": content})


def _split_batches(entries: list[str]) -> list[list[str]]:
    if not entries:
        return []
    batch_count = min(MAX_WORKERS, max(1, math.ceil(len(entries) / BATCH_TARGET_SIZE)))
    base_size, remainder = divmod(len(entries), batch_count)
    batches: list[list[str]] = []
    cursor = 0
    for index in range(batch_count):
        size = base_size + (1 if index < remainder else 0)
        if size <= 0:
            continue
        batches.append(entries[cursor:cursor + size])
        cursor += size
    return batches


def _slice_files_info_for_batch(files_info: str, batch_entries: list[str], target_dir: Path) -> str:
    lines = [line for line in (files_info or "").splitlines() if line.strip()]
    if not lines:
        return files_info

    batch_set = set(batch_entries)
    normalized_root = str(target_dir).replace("\\", "/").rstrip("/")
    filtered_lines: list[str] = []
    header_added = False

    for line in lines:
        parts = [part.strip() for part in line.split("|", 2)]
        if len(parts) < 3:
            if not header_added:
                filtered_lines.append(line)
                header_added = True
            continue

        path_text = parts[0]
        normalized_path = path_text.replace("\\", "/").rstrip("/")

        if path_text == "路径":
            filtered_lines.append(line)
            header_added = True
            continue

        if normalized_path == normalized_root:
            filtered_lines.append(re.sub(r"包含\s+\d+\s+个条目", f"包含 {len(batch_entries)} 个条目", line, count=1))
            continue

        prefix = f"{normalized_root}/"
        if not normalized_path.startswith(prefix):
            continue
        relative_path = normalized_path[len(prefix):]
        top_level_name = relative_path.split("/", 1)[0]
        if top_level_name in batch_set:
            filtered_lines.append(line)

    if len(filtered_lines) >= 2:
        return "\n".join(filtered_lines)

    fallback_lines = ["路径 | 类型 | 说明", f"{target_dir} | dir | 包含 {len(batch_entries)} 个条目"]
    for entry in batch_entries:
        entry_path = (target_dir / entry).resolve()
        entry_kind = "dir" if entry_path.is_dir() else "file"
        suffix = "目录条目" if entry_kind == "dir" else (entry_path.suffix.lower() or "无扩展名")
        fallback_lines.append(f"{entry_path.as_posix()} | {entry_kind} | {suffix}")
    return "\n".join(fallback_lines)


def _build_retry_message(check: dict, retry_scope: str) -> str:
    return (
        "刚才的结果未通过校验。\n"
        f"缺失：{check['missing']}\n"
        f"多余：{check['extra']}\n"
        f"重复：{check['duplicates']}\n"
        f"请重新完整提交{retry_scope}分析结果。"
    )


def _run_analysis_worker(
    *,
    target_dir: Path,
    files_info: str,
    user_message: str,
    expected_entries: list[str],
    model: str,
    event_handler=None,
    max_retries: int = MAX_ANALYSIS_RETRIES,
    retry_scope: str = "当前层条目",
    wait_message: str = "正在分析目录内容",
) -> list[AnalysisItem] | None:
    client = get_client()
    messages = [{"role": "system", "content": build_system_prompt(files_info, target_dir=target_dir)}]
    messages.append({"role": "user", "content": user_message})

    for attempt in range(1, max_retries + 1):
        emit(event_handler, "cycle_start", {"attempt": attempt, "max_attempts": max_retries})
        curr_messages = list(messages)
        legacy_text = ""
        normalized_items: list[AnalysisItem] = []

        while True:
            emit(event_handler, "model_wait_start", {"message": wait_message})
            try:
                response = client.chat.completions.create(model=model, messages=curr_messages, tools=tools, tool_choice="auto")
            finally:
                emit(event_handler, "model_wait_end")
            msg = _coerce_response_message(response)
            submitted_items = _extract_submitted_analysis(getattr(msg, "tool_calls", None))
            if submitted_items is not None:
                normalized_items, invalid_lines = _normalize_analysis_items(submitted_items, target_dir)
                check = validate_analysis_items(normalized_items, target_dir, expected_entries=expected_entries)
                if invalid_lines:
                    check["invalid_lines"] = list(check.get("invalid_lines", [])) + invalid_lines
                    check["is_valid"] = False
                rendered = render_analysis_items(normalized_items)
                break

            if not msg.tool_calls:
                legacy_text = getattr(msg, "content", "") or ""
                _emit_text_response(legacy_text, event_handler=event_handler)
                parsed_items, invalid_lines = _parse_rendered_analysis_items(legacy_text, target_dir)
                normalized_items = parsed_items
                rendered = render_analysis_items(parsed_items) if parsed_items else (extract_output_content(legacy_text) or legacy_text.strip())
                check = validate_analysis(rendered, target_dir, expected_entries=expected_entries)
                if invalid_lines:
                    check["invalid_lines"] = list(check.get("invalid_lines", [])) + invalid_lines
                    check["is_valid"] = False
                break

            curr_messages.append(_serialize_assistant_message(msg))
            for tool_call in msg.tool_calls:
                name = tool_call.function.name
                if name == SUBMIT_ANALYSIS_TOOL_NAME:
                    continue
                args = json.loads(tool_call.function.arguments)
                emit(event_handler, "tool_start", {"name": name, "args": args})
                result = _dispatch_tool_call(target_dir, name, args)
                curr_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": name,
                    "content": result,
                })

        if check["is_valid"]:
            emit(event_handler, "validation_pass", {"attempt": attempt})
            return normalized_items

        emit(event_handler, "validation_fail", {"attempt": attempt, "details": check})
        if attempt < max_retries:
            if rendered:
                messages.append({"role": "assistant", "content": rendered})
            messages.append({"role": "user", "content": _build_retry_message(check, retry_scope)})
            continue

        emit(event_handler, "retry_exhausted", {"attempt": attempt})
        return None
    return None


def _run_single_analysis(target_dir: Path, files_info: str, model: str, event_handler=None) -> str | None:
    entries = _list_current_entries(target_dir)
    items = _run_analysis_worker(
        target_dir=target_dir,
        files_info=files_info,
        user_message="请分析当前目录下的所有条目及其用途。",
        expected_entries=entries,
        model=model,
        event_handler=event_handler,
        max_retries=MAX_ANALYSIS_RETRIES,
        retry_scope="当前层条目",
        wait_message="正在分析目录内容",
    )
    if items is None:
        return None
    return render_analysis_items(items)


def _analyze_batch(
    target_dir: Path,
    batch_entries: list[str],
    batch_index: int,
    total_batches: int,
    files_info: str,
    model: str,
    event_handler=None,
) -> list[AnalysisItem]:
    batch_files_info = _slice_files_info_for_batch(files_info, batch_entries, target_dir)
    items = _run_analysis_worker(
        target_dir=target_dir,
        files_info=batch_files_info,
        user_message="请分析以上条目及其用途。",
        expected_entries=batch_entries,
        model=model,
        event_handler=event_handler,
        max_retries=BATCH_ANALYSIS_RETRIES,
        retry_scope="以上条目",
        wait_message=f"正在分析批次 {batch_index + 1}/{total_batches}",
    )
    if items is None:
        raise RuntimeError(f"batch_{batch_index}_analysis_failed")
    return items


def _placeholder_analysis_item(entry_name: str) -> AnalysisItem:
    return AnalysisItem(
        entry_name=entry_name,
        suggested_purpose="待判断",
        summary="分析未覆盖，需手动确认",
    )


def _merge_batch_results(batch_results: list[list[AnalysisItem]], target_dir: Path) -> list[AnalysisItem]:
    merged_by_name: dict[str, AnalysisItem] = {}
    valid_entries = set(_list_current_entries(target_dir))
    for batch_items in batch_results:
        normalized_items, _ = _normalize_analysis_items(batch_items, target_dir)
        for item in normalized_items:
            if item.entry_name not in valid_entries:
                continue
            merged_by_name.setdefault(item.entry_name, item)

    ordered_items: list[AnalysisItem] = []
    for entry_name in _list_current_entries(target_dir):
        ordered_items.append(merged_by_name.get(entry_name) or _placeholder_analysis_item(entry_name))
    return ordered_items


def run_analysis_cycle(target_dir: Path, event_handler=None, model: str = ANALYSIS_MODEL_NAME):
    global WORKDIR_PATH
    """一个完整的分析循环：扫描 -> 工具调用/结构化提交 -> 校验 -> 重试。"""
    target_dir = Path(target_dir).resolve()
    WORKDIR_PATH = target_dir
    entries = _list_current_entries(target_dir)
    files_info = list_local_files(str(target_dir), max_depth=0)

    if len(entries) <= BATCH_THRESHOLD:
        return _run_single_analysis(target_dir, files_info, model, event_handler=event_handler)

    detailed_files_info = list_local_files(str(target_dir), max_depth=1, char_limit=0)
    batches = _split_batches(entries)
    worker_count = min(MAX_WORKERS, len(batches))
    emit(event_handler, "batch_split", {
        "total_entries": len(entries),
        "batch_count": len(batches),
        "worker_count": worker_count,
    })

    finished_batches = 0
    batch_results: list[list[AnalysisItem]] = []
    failed_entries: list[str] = []

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(
                _analyze_batch,
                target_dir,
                batch_entries,
                batch_index,
                len(batches),
                detailed_files_info,
                model,
                event_handler,
            ): (batch_index, batch_entries)
            for batch_index, batch_entries in enumerate(batches)
        }

        for future in as_completed(futures):
            batch_index, batch_entries = futures[future]
            try:
                batch_results.append(future.result())
                status = "completed"
            except Exception:
                failed_entries.extend(batch_entries)
                status = "failed"

            finished_batches += 1
            emit(event_handler, "batch_progress", {
                "batch_index": batch_index,
                "total_batches": len(batches),
                "batch_size": len(batch_entries),
                "status": status,
                "completed_batches": finished_batches,
            })

    if failed_entries:
        retry_batch_index = len(batches)
        try:
            batch_results.append(
                _analyze_batch(
                    target_dir,
                    failed_entries,
                    retry_batch_index,
                    retry_batch_index + 1,
                    detailed_files_info,
                    model,
                    event_handler,
                )
            )
        except Exception:
            pass

    merged_items = _merge_batch_results(batch_results, target_dir)
    check = validate_analysis_items(merged_items, target_dir)
    if not check["is_valid"]:
        merged_map = {item.entry_name: item for item in merged_items}
        for entry_name in check.get("missing", []):
            merged_map[entry_name] = _placeholder_analysis_item(entry_name)
        merged_items = [merged_map.get(entry_name) or _placeholder_analysis_item(entry_name) for entry_name in entries]
        check = validate_analysis_items(merged_items, target_dir)
        if not check["is_valid"]:
            emit(event_handler, "validation_fail", {"attempt": 1, "details": check})
            return None

    emit(event_handler, "validation_pass", {"attempt": 1})
    return render_analysis_items(merged_items)


tools = [
    {
        "type": "function",
        "function": {
            "name": "read_local_file",
            "description": "读取文件摘要，支持普通文本、PDF、Word、Excel、图片简短摘要和 zip 索引预览；文本会尝试常见中文 Windows 编码。",
            "parameters": {
                "type": "object",
                "properties": {"filename": {"type": "string"}},
                "required": ["filename"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_local_files",
            "description": "列出目标目录当前层摘要；当需要补证据时，可以对当前目录下的某个子目录额外深入一层。",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {"type": "string"},
                    "max_depth": {"type": "integer"},
                },
                "required": ["directory"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": SUBMIT_ANALYSIS_TOOL_NAME,
            "description": "提交当前层条目的结构化分析结果。items 必须与当前目录当前层真实条目一一对应。",
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "entry_name": {"type": "string"},
                                "suggested_purpose": {"type": "string"},
                                "summary": {"type": "string"},
                            },
                            "required": [
                                "entry_name",
                                "suggested_purpose",
                                "summary",
                            ],
                        },
                    }
                },
                "required": ["items"],
            },
        },
    },
]
