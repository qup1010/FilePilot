import json
import re
from collections import Counter
from pathlib import Path

from file_organizer.analysis.file_reader import list_local_files, read_local_file
from file_organizer.analysis.models import AnalysisItem
from file_organizer.analysis.prompts import build_system_prompt
from file_organizer.shared.config import ANALYSIS_MODEL_NAME, RESULT_FILE_PATH, create_openai_client
from file_organizer.shared.events import emit
from file_organizer.shared.path_utils import normalize_entry_name, resolve_tool_path

MAX_ANALYSIS_RETRIES = 3
WORKDIR_PATH = Path.cwd().resolve()
SUBMIT_ANALYSIS_TOOL_NAME = "submit_analysis_result"


def get_client():
    return create_openai_client()


def _coerce_analysis_items(items: list[AnalysisItem] | list[dict] | None) -> list[AnalysisItem]:
    return [item if isinstance(item, AnalysisItem) else AnalysisItem.from_dict(item) for item in (items or [])]


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


def validate_analysis_items(items: list[AnalysisItem] | list[dict], directory: Path) -> dict:
    parsed_items = _coerce_analysis_items(items)
    parsed_names = [item.entry_name.strip() for item in parsed_items if item.entry_name.strip()]
    invalid_lines = [item.entry_name for item in parsed_items if not item.entry_name.strip()]

    expected = set(_list_current_entries(directory))
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


def validate_analysis(content: str, directory: Path) -> dict:
    """兼容旧版文本分析结果校验。"""
    output = extract_output_content(content) or (content or "").strip()
    if not output:
        return {"is_valid": False, "reason": "missing_output", "missing": [], "extra": [], "duplicate": [], "invalid_lines": []}

    parsed_items = []
    invalid_lines = []
    for line in output.splitlines():
        line = line.strip()
        if not line or re.match(r"^分析目录路径[:：]", line):
            continue
        if "|" not in line:
            invalid_lines.append(line)
            continue

        name = normalize_entry_name(line.split("|", 1)[0].strip(), directory)
        if not name:
            invalid_lines.append(line)
            continue
        parsed_items.append(
            AnalysisItem(
                entry_name=name,
                entry_type="dir" if (directory / name).is_dir() else "file",
                suggested_purpose="待判断",
                summary=line.split("|", 2)[-1].strip(),
                evidence_sources=[],
                confidence=0.0,
            )
        )

    result = validate_analysis_items(parsed_items, directory)
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


def _dispatch_tool_call(target_dir: Path, name: str, args: dict):
    if name == "read_local_file":
        filename = resolve_tool_path(target_dir, args.get("filename"))
        return read_local_file(filename)
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


def _emit_text_response(content: str, event_handler=None) -> None:
    if not content:
        return
    emit(event_handler, "ai_streaming_start")
    emit(event_handler, "ai_chunk", {"content": content})
    emit(event_handler, "ai_streaming_end", {"full_content": content})


def run_analysis_cycle(target_dir: Path, event_handler=None, model: str = ANALYSIS_MODEL_NAME):
    global WORKDIR_PATH
    """一个完整的分析循环：扫描 -> 工具调用/结构化提交 -> 校验 -> 重试。"""
    target_dir = Path(target_dir).resolve()
    WORKDIR_PATH = target_dir
    client = get_client()

    files_info = list_local_files(str(target_dir), max_depth=0)
    messages = [{"role": "system", "content": build_system_prompt(files_info, target_dir=target_dir)}]
    messages.append({"role": "user", "content": "请分析当前目录下的所有条目及其用途。"})

    for attempt in range(1, MAX_ANALYSIS_RETRIES + 1):
        emit(event_handler, "cycle_start", {"attempt": attempt, "max_attempts": MAX_ANALYSIS_RETRIES})

        curr_messages = list(messages)
        legacy_text = ""
        submitted_items: list[AnalysisItem] | None = None

        while True:
            emit(event_handler, "model_wait_start", {"message": "正在分析目录内容"})
            try:
                response = client.chat.completions.create(model=model, messages=curr_messages, tools=tools, tool_choice="auto")
            finally:
                emit(event_handler, "model_wait_end")
            msg = response.choices[0].message
            submitted_items = _extract_submitted_analysis(getattr(msg, "tool_calls", None))
            if submitted_items is not None:
                break

            if not msg.tool_calls:
                legacy_text = getattr(msg, "content", "") or ""
                _emit_text_response(legacy_text, event_handler=event_handler)
                break

            curr_messages.append(msg)
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

        if submitted_items is not None:
            rendered = render_analysis_items(submitted_items)
            check = validate_analysis_items(submitted_items, target_dir)
        else:
            rendered = extract_output_content(legacy_text) or legacy_text.strip()
            check = validate_analysis(rendered, target_dir)

        if check["is_valid"]:
            emit(event_handler, "validation_pass", {"attempt": attempt})
            return rendered

        emit(event_handler, "validation_fail", {"attempt": attempt, "details": check})
        if attempt < MAX_ANALYSIS_RETRIES:
            retry_msg = f"刚才的结果未通过校验。\n缺失：{check['missing']}\n多余：{check['extra']}\n重复：{check['duplicates']}\n请重新完整提交当前层条目分析结果。"
            if rendered:
                messages.append({"role": "assistant", "content": rendered})
            messages.append({"role": "user", "content": retry_msg})
        else:
            emit(event_handler, "retry_exhausted", {"attempt": attempt})
            return None


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
                                "entry_type": {"type": "string", "enum": ["file", "dir"]},
                                "suggested_purpose": {"type": "string"},
                                "summary": {"type": "string"},
                                "evidence_sources": {"type": "array", "items": {"type": "string"}},
                                "confidence": {"type": "number"},
                            },
                            "required": [
                                "entry_name",
                                "entry_type",
                                "suggested_purpose",
                                "summary",
                                "evidence_sources",
                                "confidence",
                            ],
                        },
                    }
                },
                "required": ["items"],
            },
        },
    },
]
