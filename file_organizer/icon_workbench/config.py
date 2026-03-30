from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from file_organizer.icon_workbench.models import IconWorkbenchConfig, ModelConfig

DEFAULT_PRESET_ID = "default"
DEFAULT_PRESET_NAME = "默认图标生图"


class IconWorkbenchConfigStore:
    def __init__(self, config_path: Path):
        self._config_path = config_path
        self._config_path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> IconWorkbenchConfig:
        payload = self._load_payload()
        config = IconWorkbenchConfig.from_dict(payload["config"])
        config.text_model = self._global_text_model()
        return config

    def save(self, config: IconWorkbenchConfig) -> IconWorkbenchConfig:
        payload = self._load_storage()
        active_id = payload["active_preset_id"]
        payload["presets"][active_id] = self._normalize_preset_payload(
            {
                **payload["presets"].get(active_id, {}),
                **config.to_dict(),
            }
        )
        self._write_storage(payload)
        saved = IconWorkbenchConfig.from_dict(payload["presets"][active_id])
        saved.text_model = self._global_text_model()
        return saved

    def update(self, payload: dict) -> IconWorkbenchConfig:
        current = self.load()
        merged = current.to_dict()
        next_name: str | None = None
        for key, value in payload.items():
            if key == "text_model":
                continue
            if key == "name":
                next_name = str(value or "").strip() or DEFAULT_PRESET_NAME
                continue
            if key == "image_model" and isinstance(value, dict):
                merged[key] = {**merged.get(key, {}), **value}
            else:
                merged[key] = value
        next_config = IconWorkbenchConfig.from_dict(merged)
        next_config.text_model = self._global_text_model()
        saved = self.save(next_config)
        if next_name:
            storage = self._load_storage()
            active_id = storage["active_preset_id"]
            storage["presets"][active_id]["name"] = next_name
            self._write_storage(storage)
        return saved

    def get_payload(self) -> dict[str, Any]:
        payload = self._load_payload()
        return {
            "config": payload["config"],
            "presets": payload["presets"],
            "active_preset_id": payload["active_preset_id"],
        }

    def switch_preset(self, preset_id: str) -> dict[str, Any]:
        payload = self._load_storage()
        if preset_id not in payload["presets"]:
            raise ValueError("图标生图预设不存在")
        payload["active_preset_id"] = preset_id
        self._write_storage(payload)
        return self.get_payload()

    def add_preset(
        self,
        name: str,
        *,
        copy_from_active: bool = True,
        config_patch: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = self._load_storage()
        preset_id = str(uuid.uuid4())[:8]
        active_id = payload["active_preset_id"]
        base = (
            payload["presets"].get(active_id, self._default_preset_payload()).copy()
            if copy_from_active
            else self._default_preset_payload()
        )
        merged = {
            **base,
            **(config_patch or {}),
            "name": str(name or "").strip() or DEFAULT_PRESET_NAME,
        }
        payload["presets"][preset_id] = self._normalize_preset_payload(merged)
        payload["active_preset_id"] = preset_id
        self._write_storage(payload)
        return self.get_payload()

    def delete_preset(self, preset_id: str) -> dict[str, Any]:
        if preset_id == DEFAULT_PRESET_ID:
            raise ValueError("默认图标生图预设不能删除")
        payload = self._load_storage()
        if preset_id not in payload["presets"]:
            raise ValueError("图标生图预设不存在")
        payload["presets"].pop(preset_id, None)
        if payload["active_preset_id"] == preset_id:
            payload["active_preset_id"] = DEFAULT_PRESET_ID
        self._write_storage(payload)
        return self.get_payload()

    def _default_config(self) -> IconWorkbenchConfig:
        return IconWorkbenchConfig(
            text_model=self._global_text_model(),
            image_model=ModelConfig(),
            image_size="1024x1024",
            concurrency_limit=1,
            save_mode="centralized",
        )

    def _default_preset_payload(self) -> dict[str, Any]:
        return {
            "name": DEFAULT_PRESET_NAME,
            **self._default_config().to_dict(),
        }

    def _normalize_preset_payload(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        data = dict(payload or {})
        config = IconWorkbenchConfig.from_dict(data)
        return {
            "name": str(data.get("name", "") or "").strip() or DEFAULT_PRESET_NAME,
            **config.to_dict(),
        }

    def _load_storage(self) -> dict[str, Any]:
        if not self._config_path.exists():
            storage = {
                "active_preset_id": DEFAULT_PRESET_ID,
                "presets": {
                    DEFAULT_PRESET_ID: self._default_preset_payload(),
                },
            }
            self._write_storage(storage)
            return storage

        raw = json.loads(self._config_path.read_text(encoding="utf-8"))
        if "presets" in raw:
            presets = {
                str(preset_id): self._normalize_preset_payload(preset)
                for preset_id, preset in dict(raw.get("presets", {}) or {}).items()
            }
            if DEFAULT_PRESET_ID not in presets:
                presets[DEFAULT_PRESET_ID] = self._default_preset_payload()
            active_preset_id = str(raw.get("active_preset_id", DEFAULT_PRESET_ID) or DEFAULT_PRESET_ID)
            if active_preset_id not in presets:
                active_preset_id = DEFAULT_PRESET_ID
            storage = {
                "active_preset_id": active_preset_id,
                "presets": presets,
            }
            if storage != raw:
                self._write_storage(storage)
            return storage

        legacy_config = self._normalize_preset_payload(raw)
        storage = {
            "active_preset_id": DEFAULT_PRESET_ID,
            "presets": {
                DEFAULT_PRESET_ID: {
                    **legacy_config,
                    "name": str(raw.get("name", "") or "").strip() or DEFAULT_PRESET_NAME,
                }
            },
        }
        self._write_storage(storage)
        return storage

    def _load_payload(self) -> dict[str, Any]:
        storage = self._load_storage()
        active_id = storage["active_preset_id"]
        active_config = storage["presets"][active_id].copy()
        active_config.pop("name", None)
        return {
            "config": {
                "name": storage["presets"][active_id].get("name", DEFAULT_PRESET_NAME),
                **IconWorkbenchConfig.from_dict(active_config).to_dict(),
                "text_model": self._global_text_model().to_dict(),
            },
            "presets": [
                {"id": preset_id, "name": preset.get("name", DEFAULT_PRESET_NAME)}
                for preset_id, preset in storage["presets"].items()
            ],
            "active_preset_id": active_id,
        }

    def _write_storage(self, payload: dict[str, Any]) -> None:
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        self._config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

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
