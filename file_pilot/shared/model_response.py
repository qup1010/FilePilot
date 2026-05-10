from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, Callable


def extract_message_text(message_content: Any) -> str:
    if isinstance(message_content, str):
        return message_content.strip()
    if isinstance(message_content, list):
        parts: list[str] = []
        for item in message_content:
            if isinstance(item, dict) and item.get("type") == "text":
                text = str(item.get("text", "") or "").strip()
                if text:
                    parts.append(text)
        return "\n".join(parts).strip()
    return ""


def _load_model_dump(response: Any) -> Any:
    if hasattr(response, "model_dump"):
        try:
            return response.model_dump()
        except Exception:
            return None
    return None


def _normalize_response_message(
    response: Any,
    *,
    text_extractor: Callable[[Any], str] | None = None,
    tool_call_normalizer: Callable[[Any], Any] | None = None,
    include_finish_reason: bool = False,
) -> tuple[SimpleNamespace, Any]:
    extract_text = text_extractor or (lambda value: value or "")

    if hasattr(response, "choices"):
        choices = getattr(response, "choices", None) or []
        if not choices:
            raise ValueError("模型响应缺少 choices")
        choice = choices[0]
        message = getattr(choice, "message", None)
        if message is None:
            raise ValueError("模型响应缺少 message")
        payload = {
            "content": extract_text(getattr(message, "content", "")),
            "reasoning_content": extract_text(getattr(message, "reasoning_content", "")),
            "tool_calls": tool_call_normalizer(getattr(message, "tool_calls", None)) if tool_call_normalizer else None,
        }
        if include_finish_reason:
            payload["finish_reason"] = getattr(choice, "finish_reason", None)
        return SimpleNamespace(**payload), _load_model_dump(response)

    if isinstance(response, str):
        text = response.strip()
        if text and text[0] in "[{":
            try:
                return _normalize_response_message(
                    json.loads(text),
                    text_extractor=text_extractor,
                    tool_call_normalizer=tool_call_normalizer,
                    include_finish_reason=include_finish_reason,
                )
            except json.JSONDecodeError:
                pass
        payload = {"content": text, "reasoning_content": "", "tool_calls": []}
        if include_finish_reason:
            payload["finish_reason"] = None
        return SimpleNamespace(**payload), text

    if isinstance(response, dict):
        choices = response.get("choices") or []
        if not choices:
            raise ValueError("模型响应缺少 choices")
        choice = choices[0]
        message = choice.get("message") or {}
        payload = {
            "content": extract_text(message.get("content", "")),
            "reasoning_content": extract_text(message.get("reasoning_content", "")),
            "tool_calls": tool_call_normalizer(message.get("tool_calls")) if tool_call_normalizer else None,
        }
        if include_finish_reason:
            payload["finish_reason"] = choice.get("finish_reason")
        return SimpleNamespace(**payload), response

    dumped = _load_model_dump(response)
    if dumped is not None:
        return _normalize_response_message(
            dumped,
            text_extractor=text_extractor,
            tool_call_normalizer=tool_call_normalizer,
            include_finish_reason=include_finish_reason,
        )

    raise TypeError(f"不支持的模型响应类型: {type(response).__name__}")


def normalize_non_stream_response(
    response: Any,
    *,
    text_extractor: Callable[[Any], str] | None = None,
    tool_call_normalizer: Callable[[Any], Any] | None = None,
    include_finish_reason: bool = True,
) -> tuple[SimpleNamespace, Any]:
    return _normalize_response_message(
        response,
        text_extractor=text_extractor,
        tool_call_normalizer=tool_call_normalizer,
        include_finish_reason=include_finish_reason,
    )


def coerce_response_message(
    response: Any,
    *,
    text_extractor: Callable[[Any], str] | None = None,
    tool_call_normalizer: Callable[[Any], Any] | None = None,
) -> SimpleNamespace:
    message, _ = _normalize_response_message(
        response,
        text_extractor=text_extractor,
        tool_call_normalizer=tool_call_normalizer,
        include_finish_reason=False,
    )
    return message


def collect_stream_response(stream: Any) -> dict:
    role = "assistant"
    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    tool_calls: list[dict] = []
    finish_reason = None

    for chunk in stream:
        choices = getattr(chunk, "choices", None) or (chunk.get("choices") if isinstance(chunk, dict) else None) or []
        if not choices:
            continue

        choice = choices[0]
        delta = getattr(choice, "delta", None) if not isinstance(choice, dict) else (choice.get("delta") or {})
        finish_reason = getattr(choice, "finish_reason", finish_reason) if not isinstance(choice, dict) else choice.get("finish_reason", finish_reason)
        if delta is None:
            continue

        delta_role = getattr(delta, "role", None) if not isinstance(delta, dict) else delta.get("role")
        delta_content = getattr(delta, "content", None) if not isinstance(delta, dict) else delta.get("content")
        delta_reasoning_content = getattr(delta, "reasoning_content", None) if not isinstance(delta, dict) else delta.get("reasoning_content")
        delta_tool_calls = getattr(delta, "tool_calls", None) if not isinstance(delta, dict) else delta.get("tool_calls")

        if delta_role:
            role = delta_role
        if delta_content:
            content_parts.append(delta_content)
        if delta_reasoning_content:
            reasoning_parts.append(delta_reasoning_content)
        if delta_tool_calls:
            for raw_tool_call in delta_tool_calls:
                idx = getattr(raw_tool_call, "index", None) if not isinstance(raw_tool_call, dict) else raw_tool_call.get("index")
                if idx is None:
                    continue
                while len(tool_calls) <= idx:
                    tool_calls.append({"id": None, "type": "function", "function": {"name": "", "arguments": ""}})
                current = tool_calls[idx]
                if not isinstance(raw_tool_call, dict):
                    current["id"] = getattr(raw_tool_call, "id", current["id"])
                    current["type"] = getattr(raw_tool_call, "type", current["type"])
                    function = getattr(raw_tool_call, "function", None)
                    name = getattr(function, "name", None) if function is not None else None
                    arguments = getattr(function, "arguments", None) if function is not None else None
                else:
                    current["id"] = raw_tool_call.get("id", current["id"])
                    current["type"] = raw_tool_call.get("type", current["type"])
                    function = raw_tool_call.get("function") or {}
                    name = function.get("name")
                    arguments = function.get("arguments")
                if name:
                    current["function"]["name"] += name
                if arguments:
                    current["function"]["arguments"] += arguments

    return {
        "choices": [
            {
                "message": {
                    "role": role,
                    "content": "".join(content_parts) or None,
                    "reasoning_content": "".join(reasoning_parts) or None,
                    "tool_calls": tool_calls or None,
                },
                "finish_reason": finish_reason,
            }
        ]
    }
