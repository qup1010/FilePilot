from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

OPENAI_COMPATIBLE_PROVIDER = "openai_compatible"
OPENAI_CHAT_COMPLETIONS_FORMAT = "openai_chat_completions"
NATIVE_TOOL_MODE = "native"


@dataclass(frozen=True)
class ProviderCapabilities:
    chat: bool = True
    streaming: bool = True
    tools: bool = True
    vision: bool = True
    json_output: bool = True
    image_generation: bool = False

    def as_dict(self) -> dict[str, bool]:
        return {
            "chat": self.chat,
            "streaming": self.streaming,
            "tools": self.tools,
            "vision": self.vision,
            "json_output": self.json_output,
            "image_generation": self.image_generation,
        }


DEFAULT_CAPABILITIES = ProviderCapabilities()


@dataclass(frozen=True)
class ModelRuntimeConfig:
    name: str = ""
    base_url: str = ""
    model: str = ""
    api_key: str = ""
    provider: str = OPENAI_COMPATIBLE_PROVIDER
    api_format: str = OPENAI_CHAT_COMPLETIONS_FORMAT
    tool_mode: str = NATIVE_TOOL_MODE
    enabled: bool | None = None
    timeout: float | None = None
    capabilities: ProviderCapabilities = DEFAULT_CAPABILITIES

    @classmethod
    def from_mapping(cls, payload: dict[str, Any] | None) -> "ModelRuntimeConfig":
        data = dict(payload or {})
        capabilities = data.get("capabilities")
        if isinstance(capabilities, ProviderCapabilities):
            normalized_capabilities = capabilities
        elif isinstance(capabilities, dict):
            normalized_capabilities = ProviderCapabilities(
                chat=bool(capabilities.get("chat", True)),
                streaming=bool(capabilities.get("streaming", True)),
                tools=bool(capabilities.get("tools", True)),
                vision=bool(capabilities.get("vision", True)),
                json_output=bool(capabilities.get("json_output", True)),
                image_generation=bool(capabilities.get("image_generation", False)),
            )
        else:
            normalized_capabilities = DEFAULT_CAPABILITIES
        return cls(
            name=str(data.get("name") or ""),
            base_url=str(data.get("base_url") or ""),
            model=str(data.get("model") or ""),
            api_key=str(data.get("api_key") or ""),
            provider=str(data.get("provider") or OPENAI_COMPATIBLE_PROVIDER),
            api_format=str(data.get("api_format") or OPENAI_CHAT_COMPLETIONS_FORMAT),
            tool_mode=str(data.get("tool_mode") or NATIVE_TOOL_MODE),
            enabled=data.get("enabled") if data.get("enabled") is None else bool(data.get("enabled")),
            timeout=float(data["timeout"]) if data.get("timeout") is not None else None,
            capabilities=normalized_capabilities,
        )

    def as_public_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "api_format": self.api_format,
            "tool_mode": self.tool_mode,
            "capabilities": self.capabilities.as_dict(),
        }


@dataclass(frozen=True)
class ChatRequest:
    model: str
    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]] | None = None
    tool_choice: str | dict[str, Any] | None = None
    stream: bool = False
    max_tokens: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_openai_kwargs(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": self.messages,
            **self.extra,
        }
        if self.tools is not None:
            payload["tools"] = self.tools
        if self.tool_choice is not None:
            payload["tool_choice"] = self.tool_choice
        if self.stream:
            payload["stream"] = True
        if self.max_tokens is not None:
            payload["max_tokens"] = self.max_tokens
        return payload


@dataclass(frozen=True)
class ChatResponse:
    role: str = "assistant"
    content: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    raw_response: Any = None
    response_mode: str = "non_stream"
    finish_reason: str | None = None
