from __future__ import annotations

import json
from pathlib import Path

from file_organizer.icon_workbench.models import IconWorkbenchConfig, ModelConfig


class IconWorkbenchConfigStore:
    def __init__(self, config_path: Path):
        self._config_path = config_path
        self._config_path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> IconWorkbenchConfig:
        if not self._config_path.exists():
            config = self._default_config()
            self.save(config)
            return config

        raw = json.loads(self._config_path.read_text(encoding="utf-8"))
        config = IconWorkbenchConfig.from_dict(raw)
        config.text_model = self._global_text_model()
        return config

    def save(self, config: IconWorkbenchConfig) -> IconWorkbenchConfig:
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        self._config_path.write_text(
            json.dumps(config.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return config

    def update(self, payload: dict) -> IconWorkbenchConfig:
        current = self.load()
        merged = current.to_dict()
        for key, value in payload.items():
            if key == "text_model":
                continue
            if key == "image_model" and isinstance(value, dict):
                merged[key] = {**merged.get(key, {}), **value}
            else:
                merged[key] = value
        next_config = IconWorkbenchConfig.from_dict(merged)
        next_config.text_model = self._global_text_model()
        return self.save(next_config)

    def _default_config(self) -> IconWorkbenchConfig:
        return IconWorkbenchConfig(
            text_model=self._global_text_model(),
            image_model=ModelConfig(),
            image_size="1024x1024",
            concurrency_limit=1,
        )

    def _global_text_model(self) -> ModelConfig:
        text_model = ModelConfig()
        try:
            from file_organizer.shared.config_manager import config_manager
        except Exception:
            config_manager = None

        if config_manager:
            text_model = ModelConfig(
                base_url=str(config_manager.get("OPENAI_BASE_URL", "") or "").strip(),
                api_key=str(config_manager.get("OPENAI_API_KEY", "") or "").strip(),
                model=str(config_manager.get("OPENAI_MODEL", "") or "").strip(),
            )
        return text_model
