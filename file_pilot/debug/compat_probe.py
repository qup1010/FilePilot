from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from openai import OpenAI


TOOL_NAME = "submit_probe_result"
DEFAULT_TIMEOUT_SECONDS = 60.0


@dataclass(frozen=True)
class ProbeCase:
    name: str
    description: str
    stream: bool
    use_tools: bool


def build_probe_cases() -> list[ProbeCase]:
    return [
        ProbeCase(
            name="non_stream_tools",
            description="非流式 + tools，最接近扫描阶段",
            stream=False,
            use_tools=True,
        ),
        ProbeCase(
            name="stream_tools",
            description="流式 + tools，对比兼容层是否只在非流式失真",
            stream=True,
            use_tools=True,
        ),
        ProbeCase(
            name="non_stream_plain",
            description="非流式 + 无 tools，确认基础 completions 是否正常",
            stream=False,
            use_tools=False,
        ),
    ]


def probe_messages() -> list[dict[str, Any]]:
    return [
        {
            "role": "system",
            "content": (
                "你是一个 API 兼容性探测助手。"
                "如果提供了工具，你必须调用工具提交结果，而不是只输出自然语言。"
            ),
        },
        {
            "role": "user",
            "content": (
                "请判断这是一条工具调用兼容性测试。"
                "如果你看到了工具，请调用 submit_probe_result，并提交 "
                '{"items":[{"entry_name":"probe.txt","suggested_purpose":"兼容性测试","summary":"用于验证 tool calling"}]}。'
                "如果你没有看到工具，再直接回复一句 plain-ok。"
            ),
        },
    ]


def probe_tools() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": TOOL_NAME,
                "description": "提交兼容性探测结果。",
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
                                "required": ["entry_name", "suggested_purpose", "summary"],
                            },
                        }
                    },
                    "required": ["items"],
                },
            },
        }
    ]


def _normalize_tool_calls(tool_calls: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for tool_call in tool_calls or []:
        if isinstance(tool_call, dict):
            function = tool_call.get("function") or {}
            normalized.append(
                {
                    "id": tool_call.get("id"),
                    "type": tool_call.get("type", "function"),
                    "function": {
                        "name": function.get("name", ""),
                        "arguments": function.get("arguments", "") or "",
                    },
                }
            )
            continue

        function = getattr(tool_call, "function", None)
        normalized.append(
            {
                "id": getattr(tool_call, "id", None),
                "type": getattr(tool_call, "type", "function"),
                "function": {
                    "name": getattr(function, "name", "") if function is not None else "",
                    "arguments": getattr(function, "arguments", "") if function is not None else "",
                },
            }
        )
    return normalized


def summarize_response_message(response: Any) -> dict[str, Any]:
    choices = getattr(response, "choices", None)
    if choices is None and isinstance(response, dict):
        choices = response.get("choices")
    if not choices:
        raise ValueError("模型响应缺少 choices")

    choice = choices[0]
    message = getattr(choice, "message", None)
    finish_reason = getattr(choice, "finish_reason", None)
    if isinstance(choice, dict):
        message = choice.get("message") or {}
        finish_reason = choice.get("finish_reason")

    role = getattr(message, "role", None) or (message.get("role") if isinstance(message, dict) else None) or "assistant"
    content = getattr(message, "content", None) if not isinstance(message, dict) else message.get("content")
    tool_calls = getattr(message, "tool_calls", None) if not isinstance(message, dict) else message.get("tool_calls")
    normalized_tool_calls = _normalize_tool_calls(tool_calls)
    content_text = content or ""

    return {
        "role": role,
        "content": content_text,
        "content_length": len(content_text),
        "tool_call_count": len(normalized_tool_calls),
        "tool_calls": normalized_tool_calls,
        "finish_reason": finish_reason,
        "empty_assistant_message": role == "assistant" and not content_text and not normalized_tool_calls,
    }


def collect_stream_response(stream: Iterable[Any]) -> dict[str, Any]:
    role = "assistant"
    content_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    finish_reason = None
    chunk_count = 0

    for chunk in stream:
        chunk_count += 1
        choices = getattr(chunk, "choices", None)
        if choices is None and isinstance(chunk, dict):
            choices = chunk.get("choices")
        if not choices:
            continue

        choice = choices[0]
        delta = getattr(choice, "delta", None)
        finish_reason = getattr(choice, "finish_reason", finish_reason)
        if isinstance(choice, dict):
            delta = choice.get("delta") or {}
            finish_reason = choice.get("finish_reason", finish_reason)

        if delta is None:
            continue

        delta_role = getattr(delta, "role", None) if not isinstance(delta, dict) else delta.get("role")
        delta_content = getattr(delta, "content", None) if not isinstance(delta, dict) else delta.get("content")
        delta_tool_calls = getattr(delta, "tool_calls", None) if not isinstance(delta, dict) else delta.get("tool_calls")

        if delta_role:
            role = delta_role
        if delta_content:
            content_parts.append(delta_content)
        if delta_tool_calls:
            for raw_tool_call in delta_tool_calls:
                idx = getattr(raw_tool_call, "index", None) if not isinstance(raw_tool_call, dict) else raw_tool_call.get("index")
                if idx is None:
                    continue
                while len(tool_calls) <= idx:
                    tool_calls.append({"id": None, "type": "function", "function": {"name": "", "arguments": ""}})
                current = tool_calls[idx]
                current["id"] = getattr(raw_tool_call, "id", None) if not isinstance(raw_tool_call, dict) else raw_tool_call.get("id", current["id"])
                current["type"] = getattr(raw_tool_call, "type", None) if not isinstance(raw_tool_call, dict) else raw_tool_call.get("type", current["type"]) or current["type"]
                function = getattr(raw_tool_call, "function", None) if not isinstance(raw_tool_call, dict) else (raw_tool_call.get("function") or {})
                name = getattr(function, "name", None) if not isinstance(function, dict) else function.get("name")
                arguments = getattr(function, "arguments", None) if not isinstance(function, dict) else function.get("arguments")
                if name:
                    current["function"]["name"] += name
                if arguments:
                    current["function"]["arguments"] += arguments

    content_text = "".join(content_parts)
    return {
        "role": role,
        "content": content_text,
        "content_length": len(content_text),
        "tool_call_count": len(tool_calls),
        "tool_calls": tool_calls,
        "finish_reason": finish_reason,
        "chunk_count": chunk_count,
        "empty_assistant_message": role == "assistant" and not content_text and not tool_calls,
    }


def serialize_raw_response(response: Any) -> Any:
    if hasattr(response, "model_dump"):
        return response.model_dump()
    if isinstance(response, dict):
        return response
    return str(response)


def run_probe_case(client: OpenAI, model: str, case: ProbeCase) -> dict[str, Any]:
    request_kwargs: dict[str, Any] = {
        "model": model,
        "messages": probe_messages(),
        "stream": case.stream,
    }
    if case.use_tools:
        request_kwargs["tools"] = probe_tools()
        request_kwargs["tool_choice"] = "auto"

    response = client.chat.completions.create(**request_kwargs)
    if case.stream:
        summary = collect_stream_response(response)
        raw = {"stream_collected": True, "summary_only": summary}
    else:
        summary = summarize_response_message(response)
        raw = serialize_raw_response(response)

    return {
        "case": case.name,
        "description": case.description,
        "request": {
            "stream": case.stream,
            "use_tools": case.use_tools,
            "tool_choice": "auto" if case.use_tools else None,
        },
        "summary": summary,
        "raw_response": raw,
    }


def build_report(results: list[dict[str, Any]]) -> dict[str, Any]:
    findings: list[str] = []
    for result in results:
        summary = result["summary"]
        if result["request"]["use_tools"] and summary["empty_assistant_message"]:
            findings.append(f"{result['case']}: tools 请求返回空 assistant message")
        elif result["request"]["use_tools"] and summary["tool_call_count"] == 0:
            findings.append(f"{result['case']}: tools 请求未返回 tool_calls")
        else:
            findings.append(
                f"{result['case']}: content_length={summary['content_length']}, tool_call_count={summary['tool_call_count']}, finish_reason={summary['finish_reason']}"
            )
    return {"generated_at": datetime.now().isoformat(timespec="seconds"), "results": results, "findings": findings}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="探测兼容端点在 chat completions tool-calling 下的响应结构。")
    parser.add_argument("--base-url", required=True, help="兼容端点地址，例如 https://ice.v.ua/v1")
    parser.add_argument("--api-key", required=True, help="接口密钥")
    parser.add_argument("--model", required=True, help="模型名，例如 gpt-5.4")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS, help="请求超时秒数")
    parser.add_argument("--output", help="可选，写入 JSON 结果文件")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    client = OpenAI(api_key=args.api_key, base_url=args.base_url, timeout=args.timeout)
    results = [run_probe_case(client, args.model, case) for case in build_probe_cases()]
    report = build_report(results)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    print(text)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
