from __future__ import annotations

from typing import Any

from file_pilot.ai.models import (
    OPENAI_CHAT_COMPLETIONS_FORMAT,
    OPENAI_COMPATIBLE_PROVIDER,
    ModelRuntimeConfig,
)
from file_pilot.ai.providers.openai_compatible import OpenAICompatibleAdapter
from file_pilot.shared.settings_service import ICON_IMAGE_FAMILY, TEXT_FAMILY, VISION_FAMILY


def get_adapter_for_runtime(runtime: dict[str, Any] | ModelRuntimeConfig, *, client: Any = None) -> OpenAICompatibleAdapter:
    config = runtime if isinstance(runtime, ModelRuntimeConfig) else ModelRuntimeConfig.from_mapping(runtime)
    if config.provider != OPENAI_COMPATIBLE_PROVIDER or config.api_format != OPENAI_CHAT_COMPLETIONS_FORMAT:
        raise ValueError(f"暂不支持的模型接口格式: {config.provider}/{config.api_format}")
    return OpenAICompatibleAdapter(config, client=client)


def get_text_adapter(*, client: Any = None) -> OpenAICompatibleAdapter:
    from file_pilot.shared.config_manager import config_manager

    return get_adapter_for_runtime(config_manager.service.get_runtime_family_config(TEXT_FAMILY), client=client)


def get_vision_adapter(*, client: Any = None) -> OpenAICompatibleAdapter:
    from file_pilot.shared.config_manager import config_manager

    return get_adapter_for_runtime(config_manager.service.get_runtime_family_config(VISION_FAMILY), client=client)


def get_icon_image_adapter(*, client: Any = None) -> OpenAICompatibleAdapter:
    from file_pilot.shared.config_manager import config_manager

    runtime = config_manager.service.get_runtime_family_config(ICON_IMAGE_FAMILY)
    return get_adapter_for_runtime(dict(runtime.get("image_model") or {}), client=client)

