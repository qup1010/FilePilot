import json
import logging
import math
import re
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from types import SimpleNamespace

from file_pilot.analysis.file_reader import list_local_files, read_local_file, read_local_files_batch
from file_pilot.analysis.models import AnalysisItem
from file_pilot.analysis.prompts import build_system_prompt
from file_pilot.shared.config import (
    RESULT_FILE_PATH,
    create_openai_client,
    get_analysis_model_name,
    get_scan_batch_target_size,
    get_scan_failed_retry_abort_ratio,
    get_scan_worker_count,
)
from file_pilot.shared.events import emit
from file_pilot.shared.logging_utils import append_debug_event
from file_pilot.shared.model_response import coerce_response_message, collect_stream_response
from file_pilot.shared.path_utils import normalize_entry_name, resolve_tool_path

MAX_ANALYSIS_RETRIES = 3
BATCH_ANALYSIS_RETRIES = 2
BATCH_THRESHOLD = 30
BATCH_TARGET_SIZE = 100
MAX_SCAN_WORKERS = 5
MAX_TOOL_ROUNDS = 3
WORKDIR_PATH = Path.cwd().resolve()
SUBMIT_ANALYSIS_TOOL_NAME = "submit_analysis_result"
BATCH_READ_TOOL_NAME = "read_local_files_batch"
API_RETRY_ATTEMPTS = 2
API_RETRY_DELAY_SECONDS = 2
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
SCAN_CANCELLED_ERROR = "scan_cancelled"

logger = logging.getLogger(__name__)


def _raise_if_scan_cancelled(cancel_event: threading.Event | None) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise RuntimeError(SCAN_CANCELLED_ERROR)


def _is_retryable_error(exc: Exception) -> bool:
    """判断 API 异常是否值得重试（网络波动、服务端临时故障等）。"""
    retryable_types = (ConnectionError, TimeoutError, OSError)
    if isinstance(exc, retryable_types):
        return True
    # openai / httpx 常见可重试异常
    exc_name = type(exc).__name__
    if exc_name in {"APIConnectionError", "APITimeoutError", "InternalServerError", "RateLimitError"}:
        return True
    # HTTP 5xx / 429 判断
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if isinstance(status, int) and (status >= 500 or status == 429):
        return True
    return False


def _extract_retry_after_seconds(exc: Exception) -> int | None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if headers:
        try:
            retry_after = headers.get("retry-after") or headers.get("Retry-After")
            if retry_after is not None:
                return max(0, int(float(retry_after)))
        except (TypeError, ValueError):
            pass

    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        retry_after = body.get("retry_after")
        try:
            return max(0, int(float(retry_after))) if retry_after is not None else None
        except (TypeError, ValueError):
            return None
    return None


def _summarize_api_error(exc: Exception) -> str:
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if isinstance(status, int):
        if status == 504:
            return "模型服务网关超时"
        if status == 429:
            return "模型服务请求过于频繁"
        if status >= 500:
            return f"模型服务暂时不可用（HTTP {status}）"
        return f"模型服务请求失败（HTTP {status}）"
    if type(exc).__name__ == "APITimeoutError":
        return "模型服务响应超时"
    if type(exc).__name__ == "APIConnectionError":
        return "模型服务连接失败"
    return "模型服务请求失败"


def _write_analysis_debug_event(
    target_dir: Path,
    kind: str,
    *,
    level: str = "INFO",
    session_id: str | None = None,
    payload: dict | list | str | None = None,
) -> None:
    append_debug_event(
        kind=kind,
        level=level,
        session_id=session_id,
        target_dir=str(target_dir),
        stage="scanning",
        payload=payload,
    )


def get_client():
    return create_openai_client()


def _coerce_analysis_items(items: list[AnalysisItem] | list[dict] | None) -> list[AnalysisItem]:
    return [item if isinstance(item, AnalysisItem) else AnalysisItem.from_dict(item) for item in (items or [])]


def _infer_entry_type(entry_name: str, directory: Path) -> str:
    candidate = (directory / entry_name).resolve()
    if candidate.exists():
        return "dir" if candidate.is_dir() else "file"
    return ""


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
        item_data["entry_type"] = str(item_data.get("entry_type") or "").strip().lower() or _infer_entry_type(normalized_name, directory)
        normalized_items.append(AnalysisItem.from_dict(item_data))
    return normalized_items, invalid_lines


def render_analysis_items(items: list[AnalysisItem] | list[dict]) -> str:
    return "\n".join(item.to_scan_line() for item in _coerce_analysis_items(items))


def _dedupe_display_names(entry_names: list[str]) -> dict[str, str]:
    counts = Counter(entry_names)
    seen: dict[str, int] = {}
    labels: dict[str, str] = {}
    for entry_name in entry_names:
        seen[entry_name] = seen.get(entry_name, 0) + 1
        if counts[entry_name] <= 1:
            labels[entry_name] = entry_name
        else:
            labels[entry_name] = f"{entry_name} ({seen[entry_name]})"
    return labels


def _build_entry_context(
    target_dir: Path,
    entry_names: list[str],
    *,
    entry_ids: list[str] | None = None,
) -> dict[str, dict[str, str]]:
    normalized_entries = [
        entry
        for entry in (
            normalize_entry_name(str(entry_name or "").strip(), target_dir)
            for entry_name in entry_names
        )
        if entry
    ]
    display_names = _dedupe_display_names(normalized_entries)
    context: dict[str, dict[str, str]] = {}
    for index, entry_name in enumerate(normalized_entries, start=1):
        raw_entry_id = ""
        if entry_ids is not None and index - 1 < len(entry_ids):
            raw_entry_id = str(entry_ids[index - 1] or "").strip()
        entry_id = raw_entry_id or f"F{index:03d}"
        absolute_path = (target_dir / entry_name).resolve()
        context[entry_id] = {
            "entry_id": entry_id,
            "entry_name": entry_name,
            "display_name": display_names.get(entry_name, entry_name),
            "entry_type": _infer_entry_type(entry_name, target_dir) or "file",
            "absolute_path": str(absolute_path),
            "source_relpath": entry_name,
            "origin_path": str(target_dir.resolve()),
            "origin_relpath": entry_name,
            "allowed_base_dir": str(target_dir.resolve()),
        }
    return context


def build_entry_context_from_records(records: list[dict]) -> dict[str, dict[str, str]]:
    context: dict[str, dict[str, str]] = {}
    seen_ids: set[str] = set()
    display_names = _dedupe_display_names([str(item.get("display_name") or item.get("entry_name") or "") for item in records])
    for index, record in enumerate(records, start=1):
        raw_entry_id = str(record.get("entry_id") or "").strip()
        entry_id = raw_entry_id or f"F{index:03d}"
        while entry_id in seen_ids:
            entry_id = f"{raw_entry_id or 'F'}_{index:03d}"
        seen_ids.add(entry_id)

        entry_name = str(record.get("entry_name") or record.get("source_relpath") or record.get("display_name") or entry_id).replace("\\", "/").strip()
        display_name = str(record.get("display_name") or Path(entry_name).name or entry_name)
        absolute_path = Path(str(record.get("absolute_path") or "")).resolve()
        allowed_base_dir = Path(str(record.get("allowed_base_dir") or absolute_path.parent)).resolve()
        context[entry_id] = {
            "entry_id": entry_id,
            "entry_name": entry_name,
            "display_name": display_names.get(display_name, display_name),
            "entry_type": str(record.get("entry_type") or ("dir" if absolute_path.is_dir() else "file")).strip().lower() or "file",
            "absolute_path": str(absolute_path),
            "source_relpath": str(record.get("source_relpath") or entry_name).replace("\\", "/").strip(),
            "origin_path": str(record.get("origin_path") or allowed_base_dir),
            "origin_relpath": str(record.get("origin_relpath") or Path(entry_name).name or entry_name).replace("\\", "/").strip(),
            "allowed_base_dir": str(allowed_base_dir),
        }
    return context


def _render_entry_catalog(entry_context: dict[str, dict[str, str]]) -> str:
    lines = ["entry_id | display_name | entry_type"]
    for item in entry_context.values():
        lines.append(
            f"{item['entry_id']} | {item['display_name']} | {item['entry_type']}"
        )
    return "\n".join(lines)


def _is_image_entry_name(entry_name: str) -> bool:
    return Path(str(entry_name or "")).suffix.lower() in IMAGE_EXTENSIONS


def _collect_image_entry_context(entry_context: dict[str, dict[str, str]] | None) -> list[dict[str, str]]:
    if not entry_context:
        return []
    return [
        item
        for item in entry_context.values()
        if str(item.get("entry_type") or "").lower() == "file" and _is_image_entry_name(item.get("entry_name") or "")
    ]


def _vision_prompt_enabled() -> bool:
    from file_pilot.shared.config import get_image_analysis_settings

    settings = get_image_analysis_settings()
    return bool(settings.get("enabled"))


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


def _fuzzy_match_entry(name: str, candidates: set[str]) -> str | None:
    """尝试对特殊文件名做宽松匹配：Unicode 规范化、忽略不可见字符差异。"""
    import unicodedata

    normalized = unicodedata.normalize("NFC", name.strip())
    for candidate in candidates:
        if unicodedata.normalize("NFC", candidate.strip()) == normalized:
            return candidate
    # 退化到去除零宽字符后比较
    stripped = re.sub(r"[\u200b-\u200f\u2028-\u202f\ufeff]", "", normalized)
    for candidate in candidates:
        candidate_stripped = re.sub(r"[\u200b-\u200f\u2028-\u202f\ufeff]", "", unicodedata.normalize("NFC", candidate.strip()))
        if candidate_stripped == stripped:
            return candidate
    return None


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
    raw_missing = expected - actual
    raw_extra = actual - expected

    # 对 missing/extra 做模糊匹配修正
    corrected_items: list[tuple[AnalysisItem, str]] = []  # (item, corrected_name)
    still_missing = set(raw_missing)
    still_extra = set(raw_extra)
    if raw_missing and raw_extra:
        for extra_name in list(raw_extra):
            matched = _fuzzy_match_entry(extra_name, still_missing)
            if matched:
                still_missing.discard(matched)
                still_extra.discard(extra_name)
                # 修正 item 的 entry_name
                for item in parsed_items:
                    if item.entry_name == extra_name:
                        corrected_items.append((item, matched))
                        break
    # 应用修正
    for item, corrected_name in corrected_items:
        item.entry_name = corrected_name

    missing = sorted(still_missing)
    extra = sorted(still_extra)

    is_valid = not (missing or extra or duplicates or invalid_lines)
    return {
        "is_valid": is_valid,
        "missing": missing,
        "extra": extra,
        "duplicates": duplicates,
        "invalid_lines": invalid_lines,
    }


def _normalize_analysis_items_for_context(
    items: list[AnalysisItem] | list[dict] | None,
    entry_context: dict[str, dict[str, str]],
) -> tuple[list[AnalysisItem], list[str]]:
    normalized_items: list[AnalysisItem] = []
    invalid_lines: list[str] = []
    entry_name_to_id = {
        str(item.get("entry_name") or ""): entry_id
        for entry_id, item in entry_context.items()
        if str(item.get("entry_name") or "")
    }
    for item in _coerce_analysis_items(items):
        entry_id = str(item.entry_id or "").strip()
        if not entry_id and item.entry_name:
            entry_id = entry_name_to_id.get(str(item.entry_name).replace("\\", "/").strip(), "")
        context_item = entry_context.get(entry_id)
        if context_item is None:
            invalid_lines.append(entry_id or item.entry_name)
            continue
        item_data = dict(item.__dict__)
        item_data["entry_id"] = entry_id
        item_data["entry_name"] = context_item["entry_name"]
        item_data["display_name"] = context_item["display_name"]
        item_data["entry_type"] = str(item_data.get("entry_type") or context_item.get("entry_type") or "file").strip().lower()
        normalized_items.append(AnalysisItem.from_dict(item_data))
    return normalized_items, invalid_lines


def validate_analysis_items_for_context(
    items: list[AnalysisItem] | list[dict],
    entry_context: dict[str, dict[str, str]],
    expected_entry_ids: list[str] | None = None,
) -> dict:
    parsed_items, invalid_lines = _normalize_analysis_items_for_context(items, entry_context)
    expected = set(expected_entry_ids if expected_entry_ids is not None else entry_context.keys())
    parsed_ids = [item.entry_id for item in parsed_items]
    actual = set(parsed_ids)
    counter = Counter(parsed_ids)
    duplicates = [entry_id for entry_id, count in counter.items() if count > 1]
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    return {
        "is_valid": not (missing or extra or duplicates or invalid_lines),
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

        parts = [part.strip() for part in line.split("|", 3)]
        if len(parts) < 3:
            invalid_lines.append(line)
            continue

        name = normalize_entry_name(parts[0], directory)
        if not name:
            invalid_lines.append(line)
            continue
        if len(parts) >= 4:
            entry_type = parts[1].lower()
            suggested_purpose = parts[2] or "待判断"
            summary = parts[3]
        else:
            entry_type = _infer_entry_type(name, directory)
            suggested_purpose = parts[1] or "待判断"
            summary = parts[2]
        parsed_items.append(
            AnalysisItem(
                entry_name=name,
                entry_type=entry_type,
                suggested_purpose=suggested_purpose,
                summary=summary,
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


def _describe_directory_for_model(entry_id: str, display_name: str, directory: Path) -> str:
    lines = [f"--- 条目 [{entry_id} | {display_name}] 结构开始 ---"]
    children = sorted(
        [child for child in directory.iterdir() if not child.name.startswith(".")],
        key=lambda item: item.name.lower(),
    )
    lines.append(f"{display_name} | dir | 包含 {len(children)} 个条目")
    for child in children:
        if child.is_dir():
            lines.append(f"{child.name} | dir | 子目录")
        else:
            suffix = child.suffix.lower() or "无扩展名"
            lines.append(f"{child.name} | file | {suffix}")
    lines.append(f"--- 条目 [{entry_id} | {display_name}] 结构结束 ---")
    return "\n".join(lines)


def _sanitize_file_preview(preview: str, *, entry_id: str, display_name: str) -> str:
    content = str(preview or "")
    content = re.sub(r"^--- 文件 \[.*?\] 内容开始 ---\n?", "", content, count=1, flags=re.S)
    content = re.sub(r"\n?--- 内容结束 ---\s*$", "", content, count=1, flags=re.S)
    return f"--- 条目 [{entry_id} | {display_name}] 内容开始 ---\n{content.strip()}\n--- 内容结束 ---"


def _is_path_within_base(path: Path, base_dir: Path) -> bool:
    try:
        path.resolve().relative_to(base_dir.resolve())
        return True
    except ValueError:
        return False


def _dispatch_tool_call(target_dir: Path, name: str, args: dict, entry_context: dict[str, dict[str, str]] | None = None):
    if name == "read_local_file":
        filename = _resolve_readable_file(target_dir, args.get("filename"))
        if filename is None:
            return "错误：仅读取目标目录内的文件，不允许访问目录外路径。"
        return read_local_file(str(filename), allowed_base_dir=str(target_dir.resolve()))
    if name == BATCH_READ_TOOL_NAME:
        raw_entry_ids = [str(item).strip() for item in (args.get("entry_ids") or []) if str(item).strip()]
        if entry_context and raw_entry_ids:
            results: list[str] = []
            for entry_id in raw_entry_ids:
                context_item = entry_context.get(entry_id)
                if context_item is None:
                    results.append(f"--- 条目 [{entry_id}] ---\n错误：未找到对应条目。\n--- 结束 ---")
                    continue
                absolute_path = Path(context_item["absolute_path"])
                allowed_base_dir = Path(context_item.get("allowed_base_dir") or target_dir).resolve()
                if not _is_path_within_base(absolute_path, allowed_base_dir):
                    results.append(f"--- 条目 [{entry_id}] ---\n错误：条目路径超出授权范围。\n--- 结束 ---")
                    continue
                if absolute_path.is_dir():
                    results.append(
                        _describe_directory_for_model(entry_id, context_item["display_name"], absolute_path)
                    )
                else:
                    preview = read_local_file(
                        str(absolute_path),
                        allowed_base_dir=str(allowed_base_dir),
                    )
                    results.append(
                        _sanitize_file_preview(
                            preview,
                            entry_id=entry_id,
                            display_name=context_item["display_name"],
                        )
                    )
            return "\n\n".join(results)

        raw_filenames = args.get("filenames") or []
        if not raw_filenames:
            return "错误：未提供条目标识列表。"
        resolved: list[str] = []
        for raw in raw_filenames:
            resolved_path = _resolve_readable_file(target_dir, raw)
            if resolved_path is None:
                resolved.append(f"--- 文件 [{raw}] ---\n错误：仅读取目标目录内的文件，不允许访问目录外路径。\n--- 结束 ---")
            else:
                resolved.append(str(resolved_path))
        valid_paths = [p for p in resolved if not p.startswith("--- 文件")]
        error_messages = [p for p in resolved if p.startswith("--- 文件")]
        result = read_local_files_batch(valid_paths, allowed_base_dir=str(target_dir.resolve())) if valid_paths else ""
        if error_messages:
            result = "\n\n".join(error_messages) + ("\n\n" + result if result else "")
        return result
    if name == "list_local_files":
        directory = _resolve_list_directory(target_dir, args.get("directory"))
        if directory is None:
            return "错误：动态扫描最多只能深入目标目录下一层。"
        requested_depth = max(0, int(args.get("max_depth", 0)))
        max_depth = 0 if directory == target_dir.resolve() else min(requested_depth, 1)
        return list_local_files(str(directory), max_depth=max_depth)
    return "Unknown tool"


def _extract_submitted_analysis(tool_calls, entry_context: dict[str, dict[str, str]] | None = None) -> list[AnalysisItem] | None:
    for tool_call in tool_calls or []:
        if tool_call.function.name != SUBMIT_ANALYSIS_TOOL_NAME:
            continue
        try:
            args = json.loads(tool_call.function.arguments)
        except (json.JSONDecodeError, TypeError):
            logger.warning("submit_analysis_result 工具调用参数 JSON 解析失败，跳过")
            continue
        normalized_items: list[AnalysisItem] = []
        for raw_item in args.get("items", []):
            if not isinstance(raw_item, dict):
                continue
            item_data = dict(raw_item)
            entry_id = str(item_data.get("entry_id") or "").strip()
            context_item = (entry_context or {}).get(entry_id)
            if context_item is not None:
                item_data.setdefault("entry_name", context_item["entry_name"])
                item_data.setdefault("display_name", context_item["display_name"])
                item_data.setdefault("entry_type", context_item["entry_type"])
            normalized_items.append(AnalysisItem.from_dict(item_data))
        return normalized_items
    return None


def _synthesize_tool_call_id(index: int) -> str:
    return f"compat_call_{index}"


def _normalize_tool_calls(tool_calls) -> list[SimpleNamespace]:
    normalized = []
    for tool_call in tool_calls or []:
        fallback_id = _synthesize_tool_call_id(len(normalized))
        if isinstance(tool_call, dict):
            function = tool_call.get("function") or {}
            normalized.append(
                SimpleNamespace(
                    id=tool_call.get("id") or fallback_id,
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
                id=getattr(tool_call, "id", None) or fallback_id,
                type=getattr(tool_call, "type", "function"),
                function=SimpleNamespace(
                    name=getattr(function, "name", ""),
                    arguments=getattr(function, "arguments", "") or "",
                ),
            )
        )
    return normalized


def _coerce_response_message(response):
    return coerce_response_message(response, tool_call_normalizer=_normalize_tool_calls)


def _is_empty_assistant_message(message) -> bool:
    return not (getattr(message, "content", "") or "").strip() and not list(getattr(message, "tool_calls", None) or [])


def _collect_stream_response(stream) -> dict:
    return collect_stream_response(stream)


def _serialize_assistant_message(message) -> dict:
    tool_calls_payload = []
    for index, tool_call in enumerate(getattr(message, "tool_calls", None) or []):
        function = getattr(tool_call, "function", None)
        if function is None:
            continue
        tool_calls_payload.append(
            {
                "id": getattr(tool_call, "id", None) or _synthesize_tool_call_id(index),
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
    reasoning_content = getattr(message, "reasoning_content", "") or ""
    if reasoning_content:
        payload["reasoning_content"] = reasoning_content
    if tool_calls_payload:
        payload["tool_calls"] = tool_calls_payload
    return payload


def _emit_text_response(content: str, event_handler=None) -> None:
    if not content:
        return
    emit(event_handler, "ai_streaming_start")
    emit(event_handler, "ai_chunk", {"content": content})
    emit(event_handler, "ai_streaming_end", {"full_content": content})


def _compute_batch_count(entry_count: int) -> int:
    if entry_count <= 0:
        return 0
    return max(1, math.ceil(entry_count / get_scan_batch_target_size()))


def _scan_worker_count(batch_count: int) -> int:
    return max(1, min(get_scan_worker_count(), max(1, batch_count)))


def _should_abort_failed_retry(*, total_entries: int, failed_count: int) -> bool:
    if total_entries <= 0 or failed_count <= 0:
        return False
    threshold = get_scan_failed_retry_abort_ratio()
    return (failed_count / total_entries) >= threshold


def _split_batches(entries: list[str]) -> list[list[str]]:
    if not entries:
        return []
    batch_count = _compute_batch_count(len(entries))
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
    message = (
        "刚才的结果未通过校验。\n"
        f"缺失：{check['missing']}\n"
        f"多余：{check['extra']}\n"
        f"重复：{check['duplicates']}\n"
        f"请重新完整提交{retry_scope}分析结果。"
    )
    if check.get("image_probe_failures"):
        message += "\n图片识别未成功，禁止编造具体画面内容；这些图片只能写待判断或仅按文件名做低置信度判断。"
    return message


def _extract_image_probe_statuses(result: str) -> dict[str, dict[str, str]]:
    statuses: dict[str, dict[str, str]] = {}
    pattern = re.compile(
        r"--- 条目 \[(?P<entry_id>[^\]|]+)\s*\|.*?\] 内容开始 ---\n(?P<body>.*?)\n--- 内容结束 ---",
        flags=re.S,
    )
    for match in pattern.finditer(str(result or "")):
        body = match.group("body")
        if "--- 图片识别结果开始 ---" not in body:
            continue
        status_match = re.search(r"status:\s*(?P<status>[^\n]+)", body)
        summary_match = re.search(r"summary:\s*(?P<summary>[^\n]+)", body)
        error_code_match = re.search(r"error_code:\s*(?P<error_code>[^\n]+)", body)
        error_message_match = re.search(r"error_message:\s*(?P<error_message>[^\n]+)", body)
        statuses[match.group("entry_id").strip()] = {
            "status": (status_match.group("status").strip() if status_match else "").lower(),
            "summary": summary_match.group("summary").strip() if summary_match else "",
            "error_code": error_code_match.group("error_code").strip() if error_code_match else "",
            "error_message": error_message_match.group("error_message").strip() if error_message_match else "",
        }
    return statuses


def _validate_failed_image_probe_items(
    items: list[AnalysisItem],
    image_probe_statuses: dict[str, dict[str, str]],
) -> list[str]:
    if not image_probe_statuses:
        return []
    generic_tokens = ("待判断", "待确认", "未识别", "未成功识别", "仅凭文件名", "内容待确认", "图片文件")
    failures: list[str] = []
    for item in items:
        status = (image_probe_statuses.get(item.entry_id) or {}).get("status", "")
        if status in {"", "ok"}:
            continue
        combined = f"{item.suggested_purpose} {item.summary}"
        if not any(token in combined for token in generic_tokens):
            failures.append(item.entry_id or item.entry_name)
    return failures


def _run_analysis_worker(
    *,
    target_dir: Path,
    files_info: str,
    user_message: str,
    expected_entries: list[str],
    model: str,
    session_id: str | None = None,
    event_handler=None,
    max_retries: int = MAX_ANALYSIS_RETRIES,
    retry_scope: str = "当前层条目",
    wait_message: str = "正在分析目录内容",
    entry_context: dict[str, dict[str, str]] | None = None,
    cancel_event: threading.Event | None = None,
) -> list[AnalysisItem] | None:
    client = get_client()
    vision_enabled = _vision_prompt_enabled()
    image_entries = _collect_image_entry_context(entry_context)
    image_entry_ids = [item["entry_id"] for item in image_entries]
    image_entry_names = [item["entry_name"] for item in image_entries]
    vision_probe_requested = False
    if image_entries and not vision_enabled:
        _write_analysis_debug_event(
            target_dir,
            "analysis.vision.skipped_disabled",
            session_id=session_id,
            payload={
                "model": model,
                "image_entry_count": len(image_entries),
                "image_entries": image_entry_names,
            },
        )
    messages = [{"role": "system", "content": build_system_prompt(files_info, target_dir=target_dir, vision_enabled=vision_enabled)}]
    messages.append({"role": "user", "content": user_message})

    for attempt in range(1, max_retries + 1):
        _raise_if_scan_cancelled(cancel_event)
        emit(event_handler, "cycle_start", {"attempt": attempt, "max_attempts": max_retries})
        curr_messages = list(messages)
        legacy_text = ""
        normalized_items: list[AnalysisItem] = []
        image_probe_statuses: dict[str, dict[str, str]] = {}
        check = {"is_valid": False, "missing": expected_entries, "extra": [], "duplicates": [], "invalid_lines": ["未能在规定工具轮次内提交结果"]}
        rendered = ""

        tool_round = 0
        while tool_round < MAX_TOOL_ROUNDS:
            _raise_if_scan_cancelled(cancel_event)
            tool_round += 1
            request_kwargs = {
                "model": model,
                "messages": curr_messages,
                "tools": tools,
                "tool_choice": "auto",
            }
            emit(event_handler, "model_wait_start", {"message": wait_message})
            try:
                # API 调用含可重试异常退避
                last_api_error: Exception | None = None
                for api_attempt in range(API_RETRY_ATTEMPTS):
                    _raise_if_scan_cancelled(cancel_event)
                    try:
                        response = client.chat.completions.create(**request_kwargs)
                        last_api_error = None
                        break
                    except Exception as api_exc:
                        last_api_error = api_exc
                        if api_attempt < API_RETRY_ATTEMPTS - 1 and _is_retryable_error(api_exc):
                            retry_after_seconds = _extract_retry_after_seconds(api_exc)
                            emit(event_handler, "api_retry", {
                                "attempt": api_attempt + 1,
                                "max_attempts": API_RETRY_ATTEMPTS,
                                "retry_delay_seconds": API_RETRY_DELAY_SECONDS,
                                "retry_after_seconds": retry_after_seconds,
                                "summary": _summarize_api_error(api_exc),
                            })
                            logger.warning(
                                "analysis API 调用失败 (attempt %d/%d)，%ds 后重试: %s",
                                api_attempt + 1, API_RETRY_ATTEMPTS, API_RETRY_DELAY_SECONDS, api_exc,
                            )
                            time.sleep(API_RETRY_DELAY_SECONDS)
                            continue
                        raise
                if last_api_error is not None:
                    raise last_api_error

                msg = _coerce_response_message(response)
                response_payload = response.choices[0].message.to_dict() if hasattr(response, "choices") and hasattr(response.choices[0].message, "to_dict") else str(response)
                mode = "non_stream"
                if _is_empty_assistant_message(msg):
                    _write_analysis_debug_event(
                        target_dir,
                        "analysis.empty_message_fallback",
                        level="WARNING",
                        session_id=session_id,
                        payload={
                            "attempt": attempt,
                            "model": model,
                        },
                    )
                    stream_response = client.chat.completions.create(**{**request_kwargs, "stream": True})
                    response = _collect_stream_response(stream_response)
                    msg = _coerce_response_message(response)
                    response_payload = response
                    mode = "stream_fallback"
                _write_analysis_debug_event(
                    target_dir,
                    "analysis.response",
                    session_id=session_id,
                    payload={
                        "attempt": attempt,
                        "model": model,
                        "mode": mode,
                        "response": response_payload,
                    },
                )
            finally:
                emit(event_handler, "model_wait_end")
            submitted_items = _extract_submitted_analysis(getattr(msg, "tool_calls", None), entry_context=entry_context)
            if submitted_items is not None:
                if entry_context:
                    normalized_items, invalid_lines = _normalize_analysis_items_for_context(submitted_items, entry_context)
                    check = validate_analysis_items_for_context(normalized_items, entry_context, expected_entry_ids=expected_entries)
                else:
                    normalized_items, invalid_lines = _normalize_analysis_items(submitted_items, target_dir)
                    check = validate_analysis_items(normalized_items, target_dir, expected_entries=expected_entries)
                image_probe_failures = _validate_failed_image_probe_items(normalized_items, image_probe_statuses)
                if image_probe_failures:
                    check["image_probe_failures"] = image_probe_failures
                    check["invalid_lines"] = list(check.get("invalid_lines", [])) + [
                        f"{entry_id}: 图片识别未成功，禁止编造具体画面内容。"
                        for entry_id in image_probe_failures
                    ]
                    check["is_valid"] = False
                if invalid_lines:
                    check["invalid_lines"] = list(check.get("invalid_lines", [])) + invalid_lines
                    check["is_valid"] = False
                rendered = render_analysis_items(normalized_items)
                break

            if not msg.tool_calls:
                legacy_text = getattr(msg, "content", "") or ""
                _emit_text_response(legacy_text, event_handler=event_handler)
                parsed_items, invalid_lines = _parse_rendered_analysis_items(legacy_text, target_dir)
                if entry_context and parsed_items:
                    normalized_items, context_invalid_lines = _normalize_analysis_items_for_context(parsed_items, entry_context)
                    invalid_lines.extend(context_invalid_lines)
                    check = validate_analysis_items_for_context(normalized_items, entry_context, expected_entry_ids=expected_entries)
                else:
                    normalized_items = parsed_items
                    check = validate_analysis(
                        render_analysis_items(parsed_items) if parsed_items else (extract_output_content(legacy_text) or legacy_text.strip()),
                        target_dir,
                        expected_entries=expected_entries,
                    )
                rendered = render_analysis_items(normalized_items) if normalized_items else (extract_output_content(legacy_text) or legacy_text.strip())
                if invalid_lines:
                    check["invalid_lines"] = list(check.get("invalid_lines", [])) + invalid_lines
                    check["is_valid"] = False
                break

            curr_messages.append(_serialize_assistant_message(msg))
            for tool_call in msg.tool_calls:
                _raise_if_scan_cancelled(cancel_event)
                name = tool_call.function.name
                if name == SUBMIT_ANALYSIS_TOOL_NAME:
                    continue
                try:
                    args = json.loads(tool_call.function.arguments)
                except (json.JSONDecodeError, TypeError):
                    logger.warning("工具调用 %s 参数 JSON 解析失败，跳过", name)
                    curr_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": name,
                        "content": "错误：工具调用参数格式异常，请重新提交。",
                    })
                    continue
                emit(event_handler, "tool_start", {"name": name, "args": args})
                if name == BATCH_READ_TOOL_NAME and image_entry_ids:
                    requested_entry_ids = [str(item).strip() for item in (args.get("entry_ids") or []) if str(item).strip()]
                    if any(entry_id in image_entry_ids for entry_id in requested_entry_ids):
                        vision_probe_requested = True
                tool_started_at = time.perf_counter()
                _write_analysis_debug_event(
                    target_dir,
                    "analysis.tool_call.started",
                    session_id=session_id,
                    payload={
                        "attempt": attempt,
                        "tool_round": tool_round,
                        "name": name,
                        "args": args,
                    },
                )
                try:
                    result = _dispatch_tool_call(target_dir, name, args, entry_context=entry_context)
                except Exception as exc:
                    _write_analysis_debug_event(
                        target_dir,
                        "analysis.tool_call.failed",
                        level="ERROR",
                        session_id=session_id,
                        payload={
                            "attempt": attempt,
                            "tool_round": tool_round,
                            "name": name,
                            "args": args,
                            "duration_ms": round((time.perf_counter() - tool_started_at) * 1000),
                            "error": exc,
                        },
                    )
                    raise
                _write_analysis_debug_event(
                    target_dir,
                    "analysis.tool_call.completed",
                    session_id=session_id,
                    payload={
                        "attempt": attempt,
                        "tool_round": tool_round,
                        "name": name,
                        "args": args,
                        "duration_ms": round((time.perf_counter() - tool_started_at) * 1000),
                        "result_preview": str(result)[:300],
                    },
                )
                current_image_probe_statuses: dict[str, dict[str, str]] = {}
                if name == BATCH_READ_TOOL_NAME:
                    current_image_probe_statuses = _extract_image_probe_statuses(str(result))
                    image_probe_statuses.update(current_image_probe_statuses)
                curr_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": name,
                    "content": result,
                })
                failed_image_entries = [
                    entry_id
                    for entry_id, status_payload in current_image_probe_statuses.items()
                    if status_payload.get("status") not in {"", "ok"}
                ]
                if failed_image_entries:
                    failure_lines = []
                    for entry_id in failed_image_entries:
                        status_payload = image_probe_statuses.get(entry_id) or {}
                        failure_lines.append(
                            f"- {entry_id}: {status_payload.get('error_code') or 'vision_request_failed'}"
                        )
                    curr_messages.append({
                        "role": "user",
                        "content": (
                            "以下图片未成功完成内容识别：\n"
                            + "\n".join(failure_lines)
                            + "\n这些图片不得编造具体画面内容；只能写待判断，或仅按文件名做低置信度判断。"
                        ),
                    })

        if check["is_valid"]:
            emit(event_handler, "validation_pass", {
                "attempt": attempt,
                "items": [item.to_dict() for item in normalized_items]
            })
            _write_analysis_debug_event(
                target_dir,
                "analysis.validation_pass",
                session_id=session_id,
                payload={
                    "attempt": attempt,
                    "model": model,
                    "item_count": len(normalized_items),
                },
            )
            if image_entries and vision_enabled and not vision_probe_requested:
                _write_analysis_debug_event(
                    target_dir,
                    "analysis.vision.skipped_not_requested",
                    session_id=session_id,
                    payload={
                        "model": model,
                        "image_entry_count": len(image_entries),
                        "image_entries": image_entry_names,
                    },
                )
            return normalized_items

        emit(event_handler, "validation_fail", {"attempt": attempt, "details": check})
        _write_analysis_debug_event(
            target_dir,
            "analysis.validation_fail",
            level="WARNING",
            session_id=session_id,
            payload={
                "attempt": attempt,
                "model": model,
                "details": check,
            },
        )
        if attempt < max_retries:
            if rendered:
                messages.append({"role": "assistant", "content": rendered})
            messages.append({"role": "user", "content": _build_retry_message(check, retry_scope)})
            continue

        emit(event_handler, "retry_exhausted", {"attempt": attempt})
        _write_analysis_debug_event(
            target_dir,
            "analysis.retry_exhausted",
            level="ERROR",
            session_id=session_id,
            payload={
                "attempt": attempt,
                "model": model,
                "expected_entries": list(expected_entries or []),
            },
        )
        return None
    return None


def _run_single_analysis(
    target_dir: Path,
    files_info: str,
    model: str,
    event_handler=None,
    session_id: str | None = None,
    cancel_event: threading.Event | None = None,
) -> str | None:
    _raise_if_scan_cancelled(cancel_event)
    entries = _list_current_entries(target_dir)
    entry_context = _build_entry_context(target_dir, entries)
    items = _run_analysis_worker(
        target_dir=target_dir,
        files_info=files_info,
        user_message="请分析当前目录下的所有条目及其用途。",
        expected_entries=list(entry_context.keys()),
        model=model,
        session_id=session_id,
        event_handler=event_handler,
        max_retries=MAX_ANALYSIS_RETRIES,
        retry_scope="当前层条目",
        wait_message="正在分析目录内容",
        entry_context=entry_context,
        cancel_event=cancel_event,
    )
    if items is None:
        return None
    return render_analysis_items(items)


def _run_selected_entries_analysis(
    target_dir: Path,
    entry_names: list[str],
    files_info: str,
    model: str,
    event_handler=None,
    session_id: str | None = None,
    cancel_event: threading.Event | None = None,
) -> str | None:
    _raise_if_scan_cancelled(cancel_event)
    entry_context = _build_entry_context(target_dir, entry_names)
    items = _run_analysis_worker(
        target_dir=target_dir,
        files_info=files_info,
        user_message="请分析以上选中的条目及其用途。",
        expected_entries=list(entry_context.keys()),
        model=model,
        session_id=session_id,
        event_handler=event_handler,
        max_retries=MAX_ANALYSIS_RETRIES,
        retry_scope="以上选中条目",
        wait_message="正在分析所选条目",
        entry_context=entry_context,
        cancel_event=cancel_event,
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
    session_id: str | None = None,
    event_handler=None,
    entry_context: dict[str, dict[str, str]] | None = None,
    cancel_event: threading.Event | None = None,
) -> list[AnalysisItem]:
    _raise_if_scan_cancelled(cancel_event)
    batch_context = (
        {entry_id: entry_context[entry_id] for entry_id in batch_entries if entry_context and entry_id in entry_context}
        if entry_context
        else _build_entry_context(target_dir, batch_entries)
    )
    batch_files_info = _render_entry_catalog(batch_context)
    items = _run_analysis_worker(
        target_dir=target_dir,
        files_info=batch_files_info,
        user_message="请分析以上条目及其用途。",
        expected_entries=list(batch_context.keys()),
        model=model,
        session_id=session_id,
        event_handler=event_handler,
        max_retries=BATCH_ANALYSIS_RETRIES,
        retry_scope="以上条目",
        wait_message=f"正在分析批次 {batch_index + 1}/{total_batches}",
        entry_context=batch_context,
        cancel_event=cancel_event,
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


def _merge_selected_batch_results(
    batch_results: list[list[AnalysisItem]],
    target_dir: Path,
    selected_entries: list[str],
) -> list[AnalysisItem]:
    merged_by_name: dict[str, AnalysisItem] = {}
    selected_set = set(selected_entries)
    for batch_items in batch_results:
        normalized_items, _ = _normalize_analysis_items(batch_items, target_dir)
        for item in normalized_items:
            if item.entry_name not in selected_set:
                continue
            merged_by_name.setdefault(item.entry_name, item)

    return [merged_by_name.get(entry_name) or _placeholder_analysis_item(entry_name) for entry_name in selected_entries]


def _merge_context_batch_results(
    batch_results: list[list[AnalysisItem]],
    entry_context: dict[str, dict[str, str]],
    ordered_entry_ids: list[str],
) -> list[AnalysisItem]:
    merged_by_id: dict[str, AnalysisItem] = {}
    for batch_items in batch_results:
        normalized_items, _ = _normalize_analysis_items_for_context(batch_items, entry_context)
        for item in normalized_items:
            if item.entry_id in entry_context:
                merged_by_id.setdefault(item.entry_id, item)

    ordered_items: list[AnalysisItem] = []
    for entry_id in ordered_entry_ids:
        context_item = entry_context[entry_id]
        ordered_items.append(
            merged_by_id.get(entry_id)
            or AnalysisItem(
                entry_id=entry_id,
                entry_name=context_item["entry_name"],
                display_name=context_item["display_name"],
                entry_type=context_item["entry_type"],
                suggested_purpose="待判断",
                summary="分析未覆盖，需手动确认",
            )
        )
    return ordered_items


def run_analysis_cycle_for_entry_context(
    target_dir: Path,
    entry_context: dict[str, dict[str, str]],
    event_handler=None,
    model: str | None = None,
    session_id: str | None = None,
    cancel_event: threading.Event | None = None,
):
    target_dir = Path(target_dir).resolve()
    model = model or get_analysis_model_name()
    ordered_entry_ids = list(entry_context.keys())
    if not ordered_entry_ids:
        return ""
    _raise_if_scan_cancelled(cancel_event)

    files_info = _render_entry_catalog(entry_context)
    _write_analysis_debug_event(
        target_dir,
        "analysis.started",
        session_id=session_id,
        payload={
            "model": model,
            "entry_count": len(ordered_entry_ids),
            "mode": "entry_context" if len(ordered_entry_ids) <= BATCH_THRESHOLD else "entry_context_batch",
        },
    )

    if len(ordered_entry_ids) <= BATCH_THRESHOLD:
        items = _run_analysis_worker(
            target_dir=target_dir,
            files_info=files_info,
            user_message="请分析以上条目及其用途。",
            expected_entries=ordered_entry_ids,
            model=model,
            session_id=session_id,
            event_handler=event_handler,
            max_retries=MAX_ANALYSIS_RETRIES,
            retry_scope="以上条目",
            wait_message="正在分析所选条目",
            entry_context=entry_context,
            cancel_event=cancel_event,
        )
        result = render_analysis_items(items) if items is not None else None
        _write_analysis_debug_event(
            target_dir,
            "analysis.completed" if result else "analysis.empty_result",
            session_id=session_id,
            level="INFO" if result else "ERROR",
            payload={
                "model": model,
                "entry_count": len(ordered_entry_ids),
                "result_count": len(items or []),
                "mode": "entry_context",
            },
        )
        return result or ""

    batches = _split_batches(ordered_entry_ids)
    worker_count = _scan_worker_count(len(batches))
    emit(event_handler, "batch_split", {
        "total_entries": len(ordered_entry_ids),
        "batch_count": len(batches),
        "worker_count": worker_count,
    })
    finished_batches = 0
    successful_batches = 0
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
                files_info,
                model,
                session_id,
                event_handler,
                entry_context,
                cancel_event,
            ): (batch_index, batch_entries)
            for batch_index, batch_entries in enumerate(batches)
        }
        for future in as_completed(futures):
            _raise_if_scan_cancelled(cancel_event)
            batch_index, batch_entries = futures[future]
            try:
                status = "completed"
                batch_result_items = future.result()
                batch_results.append(batch_result_items)
                successful_batches += 1
            except Exception:
                batch_result_items = []
                status = "failed"
                failed_entries.extend(batch_entries)
            finished_batches += 1
            emit(event_handler, "batch_progress", {
                "batch_index": batch_index,
                "total_batches": len(batches),
                "batch_size": len(batch_entries),
                "status": status,
                "completed_batches": successful_batches,
                "finished_batches": finished_batches,
                "items": [item.to_dict() for item in batch_result_items] if status == "completed" else [],
            })

    if failed_entries:
        _raise_if_scan_cancelled(cancel_event)
        if _should_abort_failed_retry(total_entries=len(ordered_entry_ids), failed_count=len(failed_entries)):
            failure_ratio = round(len(failed_entries) / max(len(ordered_entry_ids), 1), 3)
            emit(event_handler, "batch_progress", {
                "total_batches": len(batches),
                "batch_size": len(failed_entries),
                "status": "failed_too_many",
                "completed_batches": successful_batches,
                "finished_batches": finished_batches,
                "failed_ratio": failure_ratio,
                "items": [],
            })
            raise RuntimeError(
                f"扫描失败批次过多（失败 {len(failed_entries)}/{len(ordered_entry_ids)}，比例 {failure_ratio}），已停止自动重试。"
            )
        emit(event_handler, "batch_progress", {
            "total_batches": len(batches),
            "batch_size": len(failed_entries),
            "status": "retrying",
            "completed_batches": successful_batches,
            "finished_batches": finished_batches,
            "items": [],
        })
        try:
            retry_batch_index = len(batches)
            retry_items = _analyze_batch(
                target_dir,
                failed_entries,
                retry_batch_index,
                retry_batch_index + 1,
                files_info,
                model,
                session_id,
                event_handler,
                entry_context,
                cancel_event,
            )
            batch_results.append(retry_items)
            successful_batches += 1
            emit(event_handler, "batch_progress", {
                "batch_index": retry_batch_index,
                "total_batches": len(batches),
                "batch_size": len(failed_entries),
                "status": "completed",
                "completed_batches": successful_batches,
                "finished_batches": finished_batches + 1,
                "items": [item.to_dict() for item in retry_items],
            })
        except Exception:
            pass

    merged_items = _merge_context_batch_results(batch_results, entry_context, ordered_entry_ids)
    emit(event_handler, "validation_pass", {"attempt": 1, "items": [item.to_dict() for item in merged_items]})
    return render_analysis_items(merged_items)


def run_analysis_cycle(
    target_dir: Path,
    event_handler=None,
    model: str | None = None,
    session_id: str | None = None,
    cancel_event: threading.Event | None = None,
):
    global WORKDIR_PATH
    """一个完整的分析循环：扫描 -> 工具调用/结构化提交 -> 校验 -> 重试。"""
    target_dir = Path(target_dir).resolve()
    WORKDIR_PATH = target_dir
    model = model or get_analysis_model_name()
    entries = _list_current_entries(target_dir)
    _raise_if_scan_cancelled(cancel_event)
    files_info = _render_entry_catalog(_build_entry_context(target_dir, entries))
    _write_analysis_debug_event(
        target_dir,
        "analysis.started",
        session_id=session_id,
        payload={
            "model": model,
            "entry_count": len(entries),
            "mode": "single" if len(entries) <= BATCH_THRESHOLD else "batch",
        },
    )

    if len(entries) <= BATCH_THRESHOLD:
        result = _run_single_analysis(
            target_dir,
            files_info,
            model,
            event_handler=event_handler,
            session_id=session_id,
            cancel_event=cancel_event,
        )
        _write_analysis_debug_event(
            target_dir,
            "analysis.completed" if result else "analysis.empty_result",
            session_id=session_id,
            level="INFO" if result else "ERROR",
            payload={
                "model": model,
                "entry_count": len(entries),
                "result_count": len((result or "").splitlines()),
                "mode": "single",
            },
        )
        return result

    batches = _split_batches(entries)
    worker_count = _scan_worker_count(len(batches))
    emit(event_handler, "batch_split", {
        "total_entries": len(entries),
        "batch_count": len(batches),
        "worker_count": worker_count,
    })

    finished_batches = 0
    successful_batches = 0
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
                files_info,
                model,
                session_id,
                event_handler,
                None,
                cancel_event,
            ): (batch_index, batch_entries)
            for batch_index, batch_entries in enumerate(batches)
        }

        for future in as_completed(futures):
            _raise_if_scan_cancelled(cancel_event)
            batch_index, batch_entries = futures[future]
            try:
                status = "completed"
                batch_result_items = future.result()
                batch_results.append(batch_result_items)
                successful_batches += 1
            except Exception:
                batch_result_items = []
                status = "failed"
                failed_entries.extend(batch_entries)

            finished_batches += 1
            emit(event_handler, "batch_progress", {
                "batch_index": batch_index,
                "total_batches": len(batches),
                "batch_size": len(batch_entries),
                "status": status,
                "completed_batches": successful_batches,
                "finished_batches": finished_batches,
                "items": [item.to_dict() for item in batch_result_items] if status == "completed" else []
            })

    if failed_entries:
        _raise_if_scan_cancelled(cancel_event)
        if _should_abort_failed_retry(total_entries=len(entries), failed_count=len(failed_entries)):
            failure_ratio = round(len(failed_entries) / max(len(entries), 1), 3)
            emit(event_handler, "batch_progress", {
                "total_batches": len(batches),
                "batch_size": len(failed_entries),
                "status": "failed_too_many",
                "completed_batches": successful_batches,
                "finished_batches": finished_batches,
                "failed_ratio": failure_ratio,
                "items": [],
            })
            raise RuntimeError(
                f"扫描失败批次过多（失败 {len(failed_entries)}/{len(entries)}，比例 {failure_ratio}），已停止自动重试。"
            )
        emit(event_handler, "batch_progress", {
            "total_batches": len(batches),
            "batch_size": len(failed_entries),
            "status": "retrying",
            "completed_batches": successful_batches,
            "finished_batches": finished_batches,
            "items": [],
        })
        retry_batch_index = len(batches)
        try:
            retry_items = _analyze_batch(
                target_dir,
                failed_entries,
                retry_batch_index,
                retry_batch_index + 1,
                files_info,
                model,
                session_id,
                event_handler,
                None,
                cancel_event,
            )
            batch_results.append(retry_items)
            successful_batches += 1
            emit(event_handler, "batch_progress", {
                "batch_index": retry_batch_index,
                "total_batches": len(batches),
                "batch_size": len(failed_entries),
                "status": "completed",
                "completed_batches": successful_batches,
                "finished_batches": finished_batches + 1,
                "items": [item.to_dict() for item in retry_items],
            })
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
            _write_analysis_debug_event(
                target_dir,
                "analysis.validation_fail",
                session_id=session_id,
                level="WARNING",
                payload={
                    "attempt": 1,
                    "model": model,
                    "details": check,
                    "mode": "batch_merge",
                },
            )
            return None

    emit(event_handler, "validation_pass", {"attempt": 1})
    rendered_result = render_analysis_items(merged_items)
    _write_analysis_debug_event(
        target_dir,
        "analysis.completed",
        session_id=session_id,
        payload={
            "model": model,
            "entry_count": len(entries),
            "result_count": len(merged_items),
            "mode": "batch",
        },
    )
    return rendered_result


def run_analysis_cycle_for_entries(
    target_dir: Path,
    entry_names: list[str],
    event_handler=None,
    model: str | None = None,
    session_id: str | None = None,
    cancel_event: threading.Event | None = None,
):
    target_dir = Path(target_dir).resolve()
    model = model or get_analysis_model_name()
    available_entries = set(_list_current_entries(target_dir))
    selected_entries = [
        entry
        for entry in (
            normalize_entry_name(str(entry_name or "").strip(), target_dir)
            for entry_name in entry_names or []
        )
        if entry and entry in available_entries
    ]
    selected_entries = list(dict.fromkeys(selected_entries))
    if not selected_entries:
        return ""
    _raise_if_scan_cancelled(cancel_event)

    files_info = _render_entry_catalog(_build_entry_context(target_dir, selected_entries))
    _write_analysis_debug_event(
        target_dir,
        "analysis.started",
        session_id=session_id,
        payload={
            "model": model,
            "entry_count": len(selected_entries),
            "mode": "selection" if len(selected_entries) <= BATCH_THRESHOLD else "selection_batch",
            "selected_entries": selected_entries,
        },
    )

    if len(selected_entries) <= BATCH_THRESHOLD:
        result = _run_selected_entries_analysis(
            target_dir,
            selected_entries,
            files_info,
            model,
            event_handler=event_handler,
            session_id=session_id,
            cancel_event=cancel_event,
        )
        _write_analysis_debug_event(
            target_dir,
            "analysis.completed" if result else "analysis.empty_result",
            session_id=session_id,
            level="INFO" if result else "ERROR",
            payload={
                "model": model,
                "entry_count": len(selected_entries),
                "result_count": len((result or "").splitlines()),
                "mode": "selection",
            },
        )
        return result

    batches = _split_batches(selected_entries)
    worker_count = _scan_worker_count(len(batches))
    emit(event_handler, "batch_split", {
        "total_entries": len(selected_entries),
        "batch_count": len(batches),
        "worker_count": worker_count,
    })
    batch_results: list[list[AnalysisItem]] = []
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(
                _analyze_batch,
                target_dir,
                batch_entries,
                batch_index,
                len(batches),
                files_info,
                model,
                session_id,
                event_handler,
                None,
                cancel_event,
            ): (batch_index, batch_entries)
            for batch_index, batch_entries in enumerate(batches)
        }
        finished_batches = 0
        successful_batches = 0
        for future in as_completed(futures):
            _raise_if_scan_cancelled(cancel_event)
            batch_index, batch_entries = futures[future]
            try:
                status = "completed"
                batch_result_items = future.result()
                batch_results.append(batch_result_items)
                successful_batches += 1
            except Exception:
                status = "failed"
                batch_result_items = []
            finished_batches += 1
            emit(event_handler, "batch_progress", {
                "batch_index": batch_index,
                "total_batches": len(batches),
                "batch_size": len(batch_entries),
                "status": status,
                "completed_batches": successful_batches,
                "finished_batches": finished_batches,
                "items": [item.to_dict() for item in batch_result_items] if status == "completed" else [],
            })

    merged_items = _merge_selected_batch_results(batch_results, target_dir, selected_entries)
    return render_analysis_items(merged_items)


tools = [
    {
        "type": "function",
        "function": {
            "name": BATCH_READ_TOOL_NAME,
            "description": (
                "批量探查多个条目。"
                "传入 entry_id 则返回对应条目的内容摘要（支持文本、PDF、Word、Excel、图片描述、zip 索引）；"
                "如果条目是文件夹，则返回其目录结构（最多两层）。"
                "当条目名称难以稳妥推断用途时才使用，尤其是截图、相机照片、纯编号图片这类仅凭文件名无法判断内容的图片。"
                "应一次性传入所有需要探查的条目。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要探查的条目标识列表，必须来自当前分析范围中的 entry_id",
                    }
                },
                "required": ["entry_ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": SUBMIT_ANALYSIS_TOOL_NAME,
            "description": (
                "提交当前分析范围条目的结构化分析结果。"
                "items 必须与当前分析范围中的条目一一对应，并使用 entry_id 作为唯一标识。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "entry_id": {
                                    "type": "string",
                                    "description": "条目标识，必须来自当前分析范围中的 entry_id",
                                },
                                "entry_type": {
                                    "type": "string",
                                    "enum": ["file", "dir"],
                                    "description": "条目类型",
                                },
                                "suggested_purpose": {
                                    "type": "string",
                                    "description": "建议用途分类",
                                },
                                "summary": {
                                    "type": "string",
                                    "description": "不超过四十字的内容摘要",
                                },
                            },
                            "required": [
                                "entry_id",
                                "entry_type",
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
