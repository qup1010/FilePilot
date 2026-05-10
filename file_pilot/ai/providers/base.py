from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from file_pilot.ai.models import ChatRequest, ChatResponse, ModelRuntimeConfig, ProviderCapabilities


class ProviderAdapter(ABC):
    def __init__(self, runtime: ModelRuntimeConfig | dict[str, Any], *, client: Any = None):
        self.runtime = runtime if isinstance(runtime, ModelRuntimeConfig) else ModelRuntimeConfig.from_mapping(runtime)
        self._client = client

    @property
    @abstractmethod
    def capabilities(self) -> ProviderCapabilities:
        raise NotImplementedError

    @property
    @abstractmethod
    def client(self) -> Any:
        raise NotImplementedError

    @abstractmethod
    def create_completion(self, **kwargs: Any) -> Any:
        raise NotImplementedError

    @abstractmethod
    def chat(self, request: ChatRequest) -> ChatResponse:
        raise NotImplementedError

