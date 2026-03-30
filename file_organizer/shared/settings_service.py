from __future__ import annotations

import copy
import json
import os
import uuid
from pathlib import Path
from typing import Any

from file_organizer.shared.constants import (
    DEFAULT_ANALYSIS_MODEL,
    DEFAULT_BASE_URL,
    PROJECT_ROOT,
)

DEFAULT_PRESET_ID = "default"
SETTINGS_VERSION = 2

TEXT_FAMILY = "text"
VISION_FAMILY = "vision"
ICON_IMAGE_FAMILY = "icon_image"
SETTINGS_FAMILIES = {TEXT_FAMILY, VISION_FAMILY, ICON_IMAGE_FAMILY}

TEXT_SECRET_KEY = "OPENAI_API_KEY"
VISION_SECRET_KEY = "IMAGE_ANALYSIS_API_KEY"

GLOBAL_ALLOWED_KEYS = {
    "IMAGE_ANALYSIS_ENABLED",
    "DEBUG_MODE",
    "LAUNCH_DEFAULT_TEMPLATE_ID",
    "LAUNCH_DEFAULT_NAMING_STYLE",
    "LAUNCH_DEFAULT_CAUTION_LEVEL",
    "LAUNCH_DEFAULT_NOTE",
    "LAUNCH_SKIP_STRATEGY_PROMPT",
}

DEFAULT_GLOBAL_CONFIG = {
    "IMAGE_ANALYSIS_ENABLED": False,
    "DEBUG_MODE": False,
    "LAUNCH_DEFAULT_TEMPLATE_ID": "general_downloads",
    "LAUNCH_DEFAULT_NAMING_STYLE": "zh",
    "LAUNCH_DEFAULT_CAUTION_LEVEL": "balanced",
    "LAUNCH_DEFAULT_NOTE": "",
    "LAUNCH_SKIP_STRATEGY_PROMPT": False,
}

DEFAULT_TEXT_PRESET = {
    "name": "默认文本模型",
    "OPENAI_BASE_URL": DEFAULT_BASE_URL,
    "OPENAI_MODEL": DEFAULT_ANALYSIS_MODEL,
    TEXT_SECRET_KEY: "",
}

DEFAULT_VISION_PRESET = {
    "name": "默认图片模型",
    "IMAGE_ANALYSIS_NAME": "默认图片模型",
    "IMAGE_ANALYSIS_BASE_URL": "",
    "IMAGE_ANALYSIS_MODEL": "",
    VISION_SECRET_KEY: "",
}

DEFAULT_ICON_IMAGE_PRESET = {
    "name": "默认图标生图",
    "image_model": {
        "base_url": "",
        "model": "",
        "api_key": "",
    },
    "image_size": "1024x1024",
    "concurrency_limit": 1,
    "save_mode": "centralized",
}


def _secret_state(value: str) -> str:
    return "stored" if str(value or "").strip() else "empty"


def _is_masked_secret(value: Any) -> bool:
    return isinstance(value, str) and (value == "********" or "..." in value)


class SettingsService:
    def __init__(
        self,
        config_path: Path | None = None,
        legacy_icon_config_path: Path | None = None,
    ):
        self._config_path = Path(config_path or (PROJECT_ROOT / "config.json"))
        self._legacy_icon_config_path = Path(
            legacy_icon_config_path
            or (self._config_path.parent / "output" / "icon_workbench" / "config.json")
        )
        self._global_config = copy.deepcopy(DEFAULT_GLOBAL_CONFIG)
        self._text_presets = {DEFAULT_PRESET_ID: copy.deepcopy(DEFAULT_TEXT_PRESET)}
        self._vision_presets = {DEFAULT_PRESET_ID: copy.deepcopy(DEFAULT_VISION_PRESET)}
        self._icon_image_presets = {DEFAULT_PRESET_ID: copy.deepcopy(DEFAULT_ICON_IMAGE_PRESET)}
        self._active_text_preset_id = DEFAULT_PRESET_ID
        self._active_vision_preset_id = DEFAULT_PRESET_ID
        self._active_icon_image_preset_id = DEFAULT_PRESET_ID
        self._load()
        self._apply_to_env()

    def _sanitize_global(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        config = copy.deepcopy(DEFAULT_GLOBAL_CONFIG)
        for key, value in dict(payload or {}).items():
            if key not in GLOBAL_ALLOWED_KEYS:
                continue
            if isinstance(DEFAULT_GLOBAL_CONFIG[key], bool):
                config[key] = bool(value)
            else:
                config[key] = value
        return config

    def _sanitize_text_preset(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        data = dict(payload or {})
        return {
            "name": str(data.get("name") or DEFAULT_TEXT_PRESET["name"]),
            "OPENAI_BASE_URL": str(data.get("OPENAI_BASE_URL") or DEFAULT_TEXT_PRESET["OPENAI_BASE_URL"]).strip(),
            "OPENAI_MODEL": str(data.get("OPENAI_MODEL") or DEFAULT_TEXT_PRESET["OPENAI_MODEL"]).strip(),
            TEXT_SECRET_KEY: str(data.get(TEXT_SECRET_KEY, "") or ""),
        }

    def _sanitize_vision_preset(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        data = dict(payload or {})
        name = str(data.get("IMAGE_ANALYSIS_NAME") or data.get("name") or DEFAULT_VISION_PRESET["name"]).strip()
        return {
            "name": name or DEFAULT_VISION_PRESET["name"],
            "IMAGE_ANALYSIS_NAME": name or DEFAULT_VISION_PRESET["IMAGE_ANALYSIS_NAME"],
            "IMAGE_ANALYSIS_BASE_URL": str(data.get("IMAGE_ANALYSIS_BASE_URL") or "").strip(),
            "IMAGE_ANALYSIS_MODEL": str(data.get("IMAGE_ANALYSIS_MODEL") or "").strip(),
            VISION_SECRET_KEY: str(data.get(VISION_SECRET_KEY, "") or ""),
        }

    def _sanitize_icon_image_preset(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        data = dict(payload or {})
        image_model = dict(data.get("image_model") or {})
        try:
            concurrency_limit = int(data.get("concurrency_limit", DEFAULT_ICON_IMAGE_PRESET["concurrency_limit"]) or 1)
        except (TypeError, ValueError):
            concurrency_limit = 1
        return {
            "name": str(data.get("name") or DEFAULT_ICON_IMAGE_PRESET["name"]).strip() or DEFAULT_ICON_IMAGE_PRESET["name"],
            "image_model": {
                "base_url": str(image_model.get("base_url", "") or "").strip(),
                "model": str(image_model.get("model", "") or "").strip(),
                "api_key": str(image_model.get("api_key", "") or ""),
            },
            "image_size": str(data.get("image_size") or DEFAULT_ICON_IMAGE_PRESET["image_size"]).strip() or DEFAULT_ICON_IMAGE_PRESET["image_size"],
            "concurrency_limit": max(1, min(concurrency_limit, 6)),
            "save_mode": "in_folder" if str(data.get("save_mode", "")).strip().lower() == "in_folder" else "centralized",
        }

    def _ensure_defaults(self) -> None:
        if DEFAULT_PRESET_ID not in self._text_presets:
            self._text_presets[DEFAULT_PRESET_ID] = copy.deepcopy(DEFAULT_TEXT_PRESET)
        if DEFAULT_PRESET_ID not in self._vision_presets:
            self._vision_presets[DEFAULT_PRESET_ID] = copy.deepcopy(DEFAULT_VISION_PRESET)
        if DEFAULT_PRESET_ID not in self._icon_image_presets:
            self._icon_image_presets[DEFAULT_PRESET_ID] = copy.deepcopy(DEFAULT_ICON_IMAGE_PRESET)
        if self._active_text_preset_id not in self._text_presets:
            self._active_text_preset_id = DEFAULT_PRESET_ID
        if self._active_vision_preset_id not in self._vision_presets:
            self._active_vision_preset_id = DEFAULT_PRESET_ID
        if self._active_icon_image_preset_id not in self._icon_image_presets:
            self._active_icon_image_preset_id = DEFAULT_PRESET_ID

    def _sync_from_env(self) -> None:
        flat = {
            **DEFAULT_GLOBAL_CONFIG,
            **DEFAULT_TEXT_PRESET,
            **DEFAULT_VISION_PRESET,
        }
        for key, default in list(flat.items()):
            raw = os.getenv(key)
            if raw is None:
                continue
            if isinstance(default, bool):
                flat[key] = raw.strip().lower() in {"1", "true", "yes", "on"}
            else:
                flat[key] = raw
        self._global_config = self._sanitize_global(flat)
        self._text_presets = {DEFAULT_PRESET_ID: self._sanitize_text_preset(flat)}
        self._vision_presets = {DEFAULT_PRESET_ID: self._sanitize_vision_preset(flat)}

    def _load_legacy_icon_payload(self) -> tuple[dict[str, dict[str, Any]], str] | None:
        if not self._legacy_icon_config_path.exists():
            return None
        raw = json.loads(self._legacy_icon_config_path.read_text(encoding="utf-8"))
        presets: dict[str, dict[str, Any]] = {}
        active_id = DEFAULT_PRESET_ID
        if "presets" in raw:
            active_id = str(raw.get("active_preset_id") or DEFAULT_PRESET_ID)
            for preset_id, preset in dict(raw.get("presets", {}) or {}).items():
                presets[str(preset_id)] = self._sanitize_icon_image_preset(preset)
        else:
            presets[DEFAULT_PRESET_ID] = self._sanitize_icon_image_preset(raw)
        if DEFAULT_PRESET_ID not in presets:
            presets[DEFAULT_PRESET_ID] = copy.deepcopy(DEFAULT_ICON_IMAGE_PRESET)
        if active_id not in presets:
            active_id = DEFAULT_PRESET_ID
        return presets, active_id

    def _load_new_schema(self, data: dict[str, Any]) -> None:
        self._global_config = self._sanitize_global(data.get("global_config"))
        self._text_presets = {
            str(preset_id): self._sanitize_text_preset(preset)
            for preset_id, preset in dict(data.get("text_presets", {}) or {}).items()
        }
        self._vision_presets = {
            str(preset_id): self._sanitize_vision_preset(preset)
            for preset_id, preset in dict(data.get("vision_presets", {}) or {}).items()
        }
        self._icon_image_presets = {
            str(preset_id): self._sanitize_icon_image_preset(preset)
            for preset_id, preset in dict(data.get("icon_image_presets", {}) or {}).items()
        }
        self._active_text_preset_id = str(data.get("active_text_preset_id") or DEFAULT_PRESET_ID)
        self._active_vision_preset_id = str(data.get("active_vision_preset_id") or DEFAULT_PRESET_ID)
        self._active_icon_image_preset_id = str(data.get("active_icon_image_preset_id") or DEFAULT_PRESET_ID)

    def _load_old_root_schema(self, data: dict[str, Any]) -> None:
        if "global_config" in data or "text_presets" in data or "vision_presets" in data:
            self._global_config = self._sanitize_global(data.get("global_config"))
            self._text_presets = {
                str(preset_id): self._sanitize_text_preset(preset)
                for preset_id, preset in dict(data.get("text_presets", {}) or {}).items()
            }
            self._vision_presets = {
                str(preset_id): self._sanitize_vision_preset(preset)
                for preset_id, preset in dict(data.get("vision_presets", {}) or {}).items()
            }
            self._active_text_preset_id = str(data.get("active_text_preset_id") or DEFAULT_PRESET_ID)
            self._active_vision_preset_id = str(data.get("active_vision_preset_id") or DEFAULT_PRESET_ID)
            return

        if "config" in data:
            flat = dict(data.get("config") or {})
        else:
            active_profile_id = str(data.get("active_profile_id") or DEFAULT_PRESET_ID)
            profiles = dict(data.get("profiles", {}) or {})
            flat = dict(profiles.get(active_profile_id) or profiles.get(DEFAULT_PRESET_ID) or {})
        self._global_config = self._sanitize_global(flat)
        self._text_presets = {DEFAULT_PRESET_ID: self._sanitize_text_preset(flat)}
        self._vision_presets = {DEFAULT_PRESET_ID: self._sanitize_vision_preset(flat)}
        self._active_text_preset_id = DEFAULT_PRESET_ID
        self._active_vision_preset_id = DEFAULT_PRESET_ID

    def _load(self) -> None:
        needs_save = False
        if self._config_path.exists():
            data = json.loads(self._config_path.read_text(encoding="utf-8"))
            if int(data.get("settings_version", 0) or 0) >= SETTINGS_VERSION:
                self._load_new_schema(data)
            else:
                self._load_old_root_schema(data)
                needs_save = True
        else:
            self._sync_from_env()
            needs_save = True

        if not self._icon_image_presets or (
            DEFAULT_PRESET_ID in self._icon_image_presets
            and self._icon_image_presets == {DEFAULT_PRESET_ID: copy.deepcopy(DEFAULT_ICON_IMAGE_PRESET)}
        ):
            legacy_icon = self._load_legacy_icon_payload()
            if legacy_icon is not None:
                self._icon_image_presets, self._active_icon_image_preset_id = legacy_icon
                needs_save = True

        self._ensure_defaults()
        if needs_save:
            self.save()

    def _apply_to_env(self) -> None:
        active = self.get_flat_active_config(mask_secrets=False)
        for key, value in active.items():
            if key == "name":
                continue
            if key == "OPENAI_MODEL":
                os.environ["OPENAI_ANALYSIS_MODEL"] = str(value)
                os.environ["OPENAI_ORGANIZER_MODEL"] = str(value)
            os.environ[key] = str(value)

    def save(self) -> None:
        payload = {
            "settings_version": SETTINGS_VERSION,
            "global_config": copy.deepcopy(self._global_config),
            "text_presets": copy.deepcopy(self._text_presets),
            "vision_presets": copy.deepcopy(self._vision_presets),
            "icon_image_presets": copy.deepcopy(self._icon_image_presets),
            "active_text_preset_id": self._active_text_preset_id,
            "active_vision_preset_id": self._active_vision_preset_id,
            "active_icon_image_preset_id": self._active_icon_image_preset_id,
        }
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        self._config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _get_active_text_preset(self) -> dict[str, Any]:
        return copy.deepcopy(self._text_presets[self._active_text_preset_id])

    def _get_active_vision_preset(self) -> dict[str, Any]:
        return copy.deepcopy(self._vision_presets[self._active_vision_preset_id])

    def _get_active_icon_image_preset(self) -> dict[str, Any]:
        return copy.deepcopy(self._icon_image_presets[self._active_icon_image_preset_id])

    def _text_preset_to_public(self, preset_id: str, preset: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": preset_id,
            "name": str(preset.get("name") or DEFAULT_TEXT_PRESET["name"]),
            "OPENAI_BASE_URL": str(preset.get("OPENAI_BASE_URL") or "").strip(),
            "OPENAI_MODEL": str(preset.get("OPENAI_MODEL") or "").strip(),
            "secret_state": _secret_state(str(preset.get(TEXT_SECRET_KEY, "") or "")),
        }

    def _vision_preset_to_public(self, preset_id: str, preset: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": preset_id,
            "name": str(preset.get("name") or DEFAULT_VISION_PRESET["name"]),
            "IMAGE_ANALYSIS_NAME": str(preset.get("IMAGE_ANALYSIS_NAME") or preset.get("name") or ""),
            "IMAGE_ANALYSIS_BASE_URL": str(preset.get("IMAGE_ANALYSIS_BASE_URL") or "").strip(),
            "IMAGE_ANALYSIS_MODEL": str(preset.get("IMAGE_ANALYSIS_MODEL") or "").strip(),
            "secret_state": _secret_state(str(preset.get(VISION_SECRET_KEY, "") or "")),
        }

    def _icon_image_preset_to_public(self, preset_id: str, preset: dict[str, Any]) -> dict[str, Any]:
        image_model = dict(preset.get("image_model") or {})
        return {
            "id": preset_id,
            "name": str(preset.get("name") or DEFAULT_ICON_IMAGE_PRESET["name"]),
            "image_model": {
                "base_url": str(image_model.get("base_url", "") or "").strip(),
                "model": str(image_model.get("model", "") or "").strip(),
                "secret_state": _secret_state(str(image_model.get("api_key", "") or "")),
            },
            "image_size": str(preset.get("image_size") or DEFAULT_ICON_IMAGE_PRESET["image_size"]),
            "concurrency_limit": int(preset.get("concurrency_limit", DEFAULT_ICON_IMAGE_PRESET["concurrency_limit"]) or 1),
            "save_mode": "in_folder" if str(preset.get("save_mode", "")).strip().lower() == "in_folder" else "centralized",
        }

    def _public_text_source(self) -> dict[str, Any]:
        active = self._get_active_text_preset()
        return {
            "name": str(active.get("name") or DEFAULT_TEXT_PRESET["name"]),
            "base_url": str(active.get("OPENAI_BASE_URL") or "").strip(),
            "model": str(active.get("OPENAI_MODEL") or "").strip(),
            "secret_state": _secret_state(str(active.get(TEXT_SECRET_KEY, "") or "")),
            "configured": self.is_text_configured(),
        }

    def get_settings_snapshot(self) -> dict[str, Any]:
        active_text = self._get_active_text_preset()
        active_vision = self._get_active_vision_preset()
        active_icon_image = self._get_active_icon_image_preset()
        return {
            "global_config": copy.deepcopy(self._global_config),
            "families": {
                TEXT_FAMILY: {
                    "family": TEXT_FAMILY,
                    "configured": self.is_text_configured(),
                    "active_preset_id": self._active_text_preset_id,
                    "active_preset": self._text_preset_to_public(self._active_text_preset_id, active_text),
                    "presets": [
                        self._text_preset_to_public(preset_id, preset)
                        for preset_id, preset in self._text_presets.items()
                    ],
                },
                VISION_FAMILY: {
                    "family": VISION_FAMILY,
                    "enabled": bool(self._global_config.get("IMAGE_ANALYSIS_ENABLED", False)),
                    "configured": self.is_vision_configured(),
                    "active_preset_id": self._active_vision_preset_id,
                    "active_preset": self._vision_preset_to_public(self._active_vision_preset_id, active_vision),
                    "presets": [
                        self._vision_preset_to_public(preset_id, preset)
                        for preset_id, preset in self._vision_presets.items()
                    ],
                },
                ICON_IMAGE_FAMILY: {
                    "family": ICON_IMAGE_FAMILY,
                    "configured": self.is_icon_image_configured(),
                    "active_preset_id": self._active_icon_image_preset_id,
                    "active_preset": {
                        **self._icon_image_preset_to_public(self._active_icon_image_preset_id, active_icon_image),
                        "text_model": self._public_text_source(),
                    },
                    "presets": [
                        self._icon_image_preset_to_public(preset_id, preset)
                        for preset_id, preset in self._icon_image_presets.items()
                    ],
                },
            },
            "status": {
                "text_configured": self.is_text_configured(),
                "vision_configured": self.is_vision_configured(),
                "icon_image_configured": self.is_icon_image_configured(),
            },
        }

    def get_flat_active_config(self, mask_secrets: bool = False) -> dict[str, Any]:
        text = self._get_active_text_preset()
        vision = self._get_active_vision_preset()
        payload = {
            **copy.deepcopy(DEFAULT_GLOBAL_CONFIG),
            **copy.deepcopy(DEFAULT_TEXT_PRESET),
            **copy.deepcopy(DEFAULT_VISION_PRESET),
            **self._global_config,
            **text,
            **vision,
            "name": text.get("name", DEFAULT_TEXT_PRESET["name"]),
        }
        if mask_secrets:
            if payload.get(TEXT_SECRET_KEY):
                payload[TEXT_SECRET_KEY] = "********"
            if payload.get(VISION_SECRET_KEY):
                payload[VISION_SECRET_KEY] = "********"
        return payload

    def get(self, key: str, default: Any = None) -> Any:
        if key in self._global_config:
            return self._global_config.get(key, default)
        flat = self.get_flat_active_config(mask_secrets=False)
        return flat.get(key, default)

    def is_text_configured(self) -> bool:
        preset = self._get_active_text_preset()
        return bool(preset.get("OPENAI_BASE_URL") and preset.get("OPENAI_MODEL") and preset.get(TEXT_SECRET_KEY))

    def is_vision_configured(self) -> bool:
        preset = self._get_active_vision_preset()
        return bool(preset.get("IMAGE_ANALYSIS_BASE_URL") and preset.get("IMAGE_ANALYSIS_MODEL") and preset.get(VISION_SECRET_KEY))

    def is_icon_image_configured(self) -> bool:
        preset = self._get_active_icon_image_preset()
        image_model = dict(preset.get("image_model") or {})
        return bool(image_model.get("base_url") and image_model.get("model") and image_model.get("api_key"))

    def get_runtime_family_config(self, family: str) -> dict[str, Any]:
        if family == TEXT_FAMILY:
            preset = self._get_active_text_preset()
            return {
                "name": preset["name"],
                "base_url": preset["OPENAI_BASE_URL"],
                "model": preset["OPENAI_MODEL"],
                "api_key": preset[TEXT_SECRET_KEY],
            }
        if family == VISION_FAMILY:
            preset = self._get_active_vision_preset()
            return {
                "name": preset["name"],
                "enabled": bool(self._global_config.get("IMAGE_ANALYSIS_ENABLED", False)),
                "base_url": preset["IMAGE_ANALYSIS_BASE_URL"],
                "model": preset["IMAGE_ANALYSIS_MODEL"],
                "api_key": preset[VISION_SECRET_KEY],
            }
        if family == ICON_IMAGE_FAMILY:
            preset = self._get_active_icon_image_preset()
            image_model = dict(preset.get("image_model") or {})
            return {
                "name": preset["name"],
                "image_model": {
                    "base_url": str(image_model.get("base_url", "") or "").strip(),
                    "model": str(image_model.get("model", "") or "").strip(),
                    "api_key": str(image_model.get("api_key", "") or ""),
                },
                "image_size": preset["image_size"],
                "concurrency_limit": preset["concurrency_limit"],
                "save_mode": preset["save_mode"],
                "text_model": self.get_runtime_family_config(TEXT_FAMILY),
            }
        raise ValueError("不支持的设置族")

    def _apply_secret_action(self, current_value: str, payload: dict[str, Any] | None) -> str:
        action = str((payload or {}).get("action", "keep") or "keep").strip().lower()
        if action == "keep":
            return current_value
        if action == "clear":
            return ""
        if action == "replace":
            return str((payload or {}).get("value", "") or "")
        raise ValueError("不支持的密钥操作")

    def update_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        next_global = copy.deepcopy(self._global_config)
        next_text = copy.deepcopy(self._text_presets)
        next_vision = copy.deepcopy(self._vision_presets)
        next_icon = copy.deepcopy(self._icon_image_presets)

        if "global_config" in payload:
            next_global = self._sanitize_global({**next_global, **dict(payload.get("global_config") or {})})

        families = dict(payload.get("families") or {})
        if TEXT_FAMILY in families:
            family_payload = dict(families.get(TEXT_FAMILY) or {})
            current = copy.deepcopy(next_text[self._active_text_preset_id])
            if "preset" in family_payload:
                preset_patch = dict(family_payload.get("preset") or {})
                current = self._sanitize_text_preset({**current, **preset_patch, TEXT_SECRET_KEY: current.get(TEXT_SECRET_KEY, "")})
            current[TEXT_SECRET_KEY] = self._apply_secret_action(current.get(TEXT_SECRET_KEY, ""), family_payload.get("secret"))
            next_text[self._active_text_preset_id] = current

        if VISION_FAMILY in families:
            family_payload = dict(families.get(VISION_FAMILY) or {})
            current = copy.deepcopy(next_vision[self._active_vision_preset_id])
            if "preset" in family_payload:
                preset_patch = dict(family_payload.get("preset") or {})
                current = self._sanitize_vision_preset({**current, **preset_patch, VISION_SECRET_KEY: current.get(VISION_SECRET_KEY, "")})
            current[VISION_SECRET_KEY] = self._apply_secret_action(current.get(VISION_SECRET_KEY, ""), family_payload.get("secret"))
            next_vision[self._active_vision_preset_id] = current
            if "enabled" in family_payload:
                next_global["IMAGE_ANALYSIS_ENABLED"] = bool(family_payload.get("enabled"))

        if ICON_IMAGE_FAMILY in families:
            family_payload = dict(families.get(ICON_IMAGE_FAMILY) or {})
            current = copy.deepcopy(next_icon[self._active_icon_image_preset_id])
            if "preset" in family_payload:
                preset_patch = dict(family_payload.get("preset") or {})
                merged_image_model = {
                    **dict(current.get("image_model") or {}),
                    **dict(preset_patch.get("image_model") or {}),
                }
                current = self._sanitize_icon_image_preset({
                    **current,
                    **preset_patch,
                    "image_model": {
                        **merged_image_model,
                        "api_key": dict(current.get("image_model") or {}).get("api_key", ""),
                    },
                })
            image_model = dict(current.get("image_model") or {})
            image_model["api_key"] = self._apply_secret_action(str(image_model.get("api_key", "") or ""), family_payload.get("secret"))
            current["image_model"] = image_model
            next_icon[self._active_icon_image_preset_id] = self._sanitize_icon_image_preset(current)

        self._global_config = next_global
        self._text_presets = next_text
        self._vision_presets = next_vision
        self._icon_image_presets = next_icon
        self._ensure_defaults()
        self._apply_to_env()
        self.save()
        return self.get_settings_snapshot()

    def add_preset(
        self,
        family: str,
        name: str,
        *,
        copy_from_active: bool = True,
        preset_patch: dict[str, Any] | None = None,
        secret_payload: dict[str, Any] | None = None,
    ) -> str:
        preset_id = str(uuid.uuid4())[:8]
        if family == TEXT_FAMILY:
            base = self._get_active_text_preset() if copy_from_active else copy.deepcopy(DEFAULT_TEXT_PRESET)
            base["name"] = str(name or "").strip() or DEFAULT_TEXT_PRESET["name"]
            if preset_patch:
                base.update({key: value for key, value in dict(preset_patch).items() if key != TEXT_SECRET_KEY})
            base = self._sanitize_text_preset(base)
            base[TEXT_SECRET_KEY] = self._apply_secret_action(base.get(TEXT_SECRET_KEY, ""), secret_payload)
            self._text_presets[preset_id] = base
            self._active_text_preset_id = preset_id
        elif family == VISION_FAMILY:
            base = self._get_active_vision_preset() if copy_from_active else copy.deepcopy(DEFAULT_VISION_PRESET)
            base["name"] = str(name or "").strip() or DEFAULT_VISION_PRESET["name"]
            base["IMAGE_ANALYSIS_NAME"] = base["name"]
            if preset_patch:
                for key, value in dict(preset_patch).items():
                    if key != VISION_SECRET_KEY:
                        base[key] = value
            base = self._sanitize_vision_preset(base)
            base[VISION_SECRET_KEY] = self._apply_secret_action(base.get(VISION_SECRET_KEY, ""), secret_payload)
            self._vision_presets[preset_id] = base
            self._active_vision_preset_id = preset_id
        elif family == ICON_IMAGE_FAMILY:
            base = self._get_active_icon_image_preset() if copy_from_active else copy.deepcopy(DEFAULT_ICON_IMAGE_PRESET)
            base["name"] = str(name or "").strip() or DEFAULT_ICON_IMAGE_PRESET["name"]
            if preset_patch:
                merged_image_model = {
                    **dict(base.get("image_model") or {}),
                    **dict(dict(preset_patch).get("image_model") or {}),
                }
                base = {
                    **base,
                    **dict(preset_patch),
                    "image_model": merged_image_model,
                }
            base = self._sanitize_icon_image_preset(base)
            image_model = dict(base.get("image_model") or {})
            image_model["api_key"] = self._apply_secret_action(str(image_model.get("api_key", "") or ""), secret_payload)
            base["image_model"] = image_model
            self._icon_image_presets[preset_id] = self._sanitize_icon_image_preset(base)
            self._active_icon_image_preset_id = preset_id
        else:
            raise ValueError("不支持的预设类型")
        self._apply_to_env()
        self.save()
        return preset_id

    def activate_preset(self, family: str, preset_id: str) -> None:
        if family == TEXT_FAMILY:
            if preset_id not in self._text_presets:
                raise ValueError("文本预设不存在")
            self._active_text_preset_id = preset_id
        elif family == VISION_FAMILY:
            if preset_id not in self._vision_presets:
                raise ValueError("图片预设不存在")
            self._active_vision_preset_id = preset_id
        elif family == ICON_IMAGE_FAMILY:
            if preset_id not in self._icon_image_presets:
                raise ValueError("图标生图预设不存在")
            self._active_icon_image_preset_id = preset_id
        else:
            raise ValueError("不支持的预设类型")
        self._apply_to_env()
        self.save()

    def delete_preset(self, family: str, preset_id: str) -> None:
        if preset_id == DEFAULT_PRESET_ID:
            raise ValueError("默认预设不可删除")
        if family == TEXT_FAMILY:
            if preset_id not in self._text_presets:
                raise ValueError("文本预设不存在")
            self._text_presets.pop(preset_id, None)
            if self._active_text_preset_id == preset_id:
                self._active_text_preset_id = DEFAULT_PRESET_ID
        elif family == VISION_FAMILY:
            if preset_id not in self._vision_presets:
                raise ValueError("图片预设不存在")
            self._vision_presets.pop(preset_id, None)
            if self._active_vision_preset_id == preset_id:
                self._active_vision_preset_id = DEFAULT_PRESET_ID
        elif family == ICON_IMAGE_FAMILY:
            if preset_id not in self._icon_image_presets:
                raise ValueError("图标生图预设不存在")
            self._icon_image_presets.pop(preset_id, None)
            if self._active_icon_image_preset_id == preset_id:
                self._active_icon_image_preset_id = DEFAULT_PRESET_ID
        else:
            raise ValueError("不支持的预设类型")
        self._apply_to_env()
        self.save()

    def get_legacy_config_payload(self, mask_secrets: bool = True) -> dict[str, Any]:
        config = self.get_flat_active_config(mask_secrets=mask_secrets)
        if mask_secrets:
            config["OPENAI_API_KEY_STATE"] = _secret_state(self._get_active_text_preset().get(TEXT_SECRET_KEY, ""))
            config["IMAGE_ANALYSIS_API_KEY_STATE"] = _secret_state(self._get_active_vision_preset().get(VISION_SECRET_KEY, ""))
        return {
            "config": config,
            "text_presets": [
                {
                    "id": preset_id,
                    "name": preset.get("name", DEFAULT_TEXT_PRESET["name"]),
                    "secret_state": _secret_state(preset.get(TEXT_SECRET_KEY, "")),
                }
                for preset_id, preset in self._text_presets.items()
            ],
            "vision_presets": [
                {
                    "id": preset_id,
                    "name": preset.get("name", DEFAULT_VISION_PRESET["name"]),
                    "secret_state": _secret_state(preset.get(VISION_SECRET_KEY, "")),
                }
                for preset_id, preset in self._vision_presets.items()
            ],
            "active_text_preset_id": self._active_text_preset_id,
            "active_vision_preset_id": self._active_vision_preset_id,
            "status": {
                "text_configured": self.is_text_configured(),
                "vision_configured": self.is_vision_configured(),
                "icon_image_configured": self.is_icon_image_configured(),
            },
        }

    def get_legacy_icon_config_payload(self) -> dict[str, Any]:
        snapshot = self.get_settings_snapshot()
        icon_family = snapshot["families"][ICON_IMAGE_FAMILY]
        return {
            "config": icon_family["active_preset"],
            "presets": icon_family["presets"],
            "active_preset_id": icon_family["active_preset_id"],
            "status": snapshot["status"],
        }

    def update_from_legacy_flat_patch(self, patch: dict[str, Any]) -> None:
        global_patch: dict[str, Any] = {}
        text_patch: dict[str, Any] = {}
        vision_patch: dict[str, Any] = {}
        text_secret: dict[str, Any] = {"action": "keep"}
        vision_secret: dict[str, Any] = {"action": "keep"}
        for key, value in dict(patch or {}).items():
            if key in GLOBAL_ALLOWED_KEYS:
                global_patch[key] = value
            elif key in {"name", "OPENAI_BASE_URL", "OPENAI_MODEL"}:
                text_patch[key] = value
            elif key == "IMAGE_ANALYSIS_NAME":
                vision_patch["IMAGE_ANALYSIS_NAME"] = value
                vision_patch["name"] = value
            elif key in {"IMAGE_ANALYSIS_BASE_URL", "IMAGE_ANALYSIS_MODEL"}:
                vision_patch[key] = value
            elif key == TEXT_SECRET_KEY:
                if value == "":
                    text_secret = {"action": "clear"}
                elif value and not _is_masked_secret(value):
                    text_secret = {"action": "replace", "value": str(value)}
            elif key == VISION_SECRET_KEY:
                if value == "":
                    vision_secret = {"action": "clear"}
                elif value and not _is_masked_secret(value):
                    vision_secret = {"action": "replace", "value": str(value)}
        self.update_settings(
            {
                "global_config": global_patch,
                "families": {
                    TEXT_FAMILY: {"preset": text_patch, "secret": text_secret},
                    VISION_FAMILY: {
                        "enabled": bool(global_patch.get("IMAGE_ANALYSIS_ENABLED", self._global_config.get("IMAGE_ANALYSIS_ENABLED", False))),
                        "preset": vision_patch,
                        "secret": vision_secret,
                    },
                },
            }
        )
