from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

from file_pilot.ai.models import ChatRequest, ChatResponse, DEFAULT_CAPABILITIES, ProviderCapabilities
from file_pilot.ai.providers.base import ProviderAdapter

SPOOF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}


def _extract_message_text(message_content: Any) -> str:
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


def _serialize_tool_call(tool_call: Any) -> dict[str, Any]:
    if isinstance(tool_call, dict):
        function = dict(tool_call.get("function") or {})
        return {
            "id": tool_call.get("id"),
            "type": tool_call.get("type", "function"),
            "function": {
                "name": function.get("name", ""),
                "arguments": function.get("arguments", "") or "",
            },
        }
    function = getattr(tool_call, "function", None)
    return {
        "id": getattr(tool_call, "id", None),
        "type": getattr(tool_call, "type", "function"),
        "function": {
            "name": getattr(function, "name", "") if function is not None else "",
            "arguments": (getattr(function, "arguments", "") if function is not None else "") or "",
        },
    }


def normalize_tool_calls(tool_calls: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for tool_call in tool_calls or []:
        if hasattr(tool_call, "function") or isinstance(tool_call, dict):
            normalized.append(_serialize_tool_call(tool_call))
    return normalized


class OpenAICompatibleAdapter(ProviderAdapter):
    @property
    def capabilities(self) -> ProviderCapabilities:
        return self.runtime.capabilities or DEFAULT_CAPABILITIES

    @property
    def client(self) -> Any:
        if self._client is None:
            import openai

            kwargs = {
                "api_key": self.runtime.api_key,
                "base_url": self.runtime.base_url,
                "default_headers": SPOOF_HEADERS,
            }
            if self.runtime.timeout is not None:
                kwargs["timeout"] = self.runtime.timeout
            self._client = openai.OpenAI(**kwargs)
        return self._client

    def create_completion(self, **kwargs: Any) -> Any:
        return self.client.chat.completions.create(**kwargs)

    def chat(self, request: ChatRequest) -> ChatResponse:
        response = self.create_completion(**request.to_openai_kwargs())
        if request.stream:
            return ChatResponse(raw_response=response, response_mode="stream")
        return self.normalize_response(response, response_mode="non_stream")

    def normalize_response(self, response: Any, *, response_mode: str = "non_stream") -> ChatResponse:
        if hasattr(response, "choices"):
            choices = getattr(response, "choices", None) or []
            if not choices:
                raise ValueError("模型响应缺少 choices")
            choice = choices[0]
            message = getattr(choice, "message", None)
            if message is None:
                raise ValueError("模型响应缺少 message")
            raw_response = None
            if hasattr(response, "model_dump"):
                try:
                    raw_response = response.model_dump()
                except Exception:
                    raw_response = None
            return ChatResponse(
                role=getattr(message, "role", "assistant") or "assistant",
                content=_extract_message_text(getattr(message, "content", "")),
                tool_calls=normalize_tool_calls(getattr(message, "tool_calls", None)),
                raw_response=raw_response,
                response_mode=response_mode,
                finish_reason=getattr(choice, "finish_reason", None),
            )

        if isinstance(response, str):
            text = response.strip()
            if text and text[0] in "[{":
                try:
                    return self.normalize_response(json.loads(text), response_mode=response_mode)
                except json.JSONDecodeError:
                    pass
            return ChatResponse(content=text, raw_response=text, response_mode=response_mode)

        if isinstance(response, dict):
            choices = response.get("choices") or []
            if not choices:
                raise ValueError("模型响应缺少 choices")
            choice = choices[0]
            message = choice.get("message") or {}
            return ChatResponse(
                role=message.get("role") or "assistant",
                content=_extract_message_text(message.get("content", "")),
                tool_calls=normalize_tool_calls(message.get("tool_calls")),
                raw_response=response,
                response_mode=response_mode,
                finish_reason=choice.get("finish_reason"),
            )

        if hasattr(response, "model_dump"):
            try:
                return self.normalize_response(response.model_dump(), response_mode=response_mode)
            except Exception:
                pass

        raise TypeError(f"不支持的模型响应类型: {type(response).__name__}")

    def normalize_message_namespace(self, response: Any) -> SimpleNamespace:
        normalized = self.normalize_response(response)
        tool_calls = [
            SimpleNamespace(
                id=item.get("id"),
                type=item.get("type", "function"),
                function=SimpleNamespace(**dict(item.get("function") or {})),
            )
            for item in normalized.tool_calls
        ]
        return SimpleNamespace(content=normalized.content, tool_calls=tool_calls)

