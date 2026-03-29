import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any

from file_organizer.shared.constants import (
    DEFAULT_ANALYSIS_MODEL,
    DEFAULT_BASE_URL,
    PROJECT_ROOT,
)

CONFIG_PATH = PROJECT_ROOT / "config.json"

DEFAULT_PRESET_ID = "default"
TEXT_PRESET_TYPE = "text"
VISION_PRESET_TYPE = "vision"
PRESET_TYPES = {TEXT_PRESET_TYPE, VISION_PRESET_TYPE}

TEXT_SECRET_KEYS = {"OPENAI_API_KEY"}
VISION_SECRET_KEYS = {"IMAGE_ANALYSIS_API_KEY"}
SECRET_KEYS = TEXT_SECRET_KEYS | VISION_SECRET_KEYS
TEXT_PRESET_KEYS = {"name", "OPENAI_BASE_URL", "OPENAI_MODEL"}
VISION_PRESET_KEYS = {"name", "IMAGE_ANALYSIS_NAME", "IMAGE_ANALYSIS_BASE_URL", "IMAGE_ANALYSIS_MODEL"}
GLOBAL_ALLOWED_KEYS = {
    "IMAGE_ANALYSIS_ENABLED",
    "DEBUG_MODE",
    "LAUNCH_DEFAULT_TEMPLATE_ID",
    "LAUNCH_DEFAULT_NAMING_STYLE",
    "LAUNCH_DEFAULT_CAUTION_LEVEL",
    "LAUNCH_DEFAULT_NOTE",
    "LAUNCH_SKIP_STRATEGY_PROMPT",
}
LEGACY_MODEL_KEYS = {"OPENAI_ANALYSIS_MODEL", "OPENAI_ORGANIZER_MODEL"}

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
    "OPENAI_API_KEY": "",
}
DEFAULT_VISION_PRESET = {
    "name": "默认图片模型",
    "IMAGE_ANALYSIS_NAME": "默认图片模型",
    "IMAGE_ANALYSIS_BASE_URL": "",
    "IMAGE_ANALYSIS_MODEL": "",
    "IMAGE_ANALYSIS_API_KEY": "",
}
DEFAULT_FLAT_CONFIG = {
    **DEFAULT_GLOBAL_CONFIG,
    **DEFAULT_TEXT_PRESET,
    **DEFAULT_VISION_PRESET,
}

logger = logging.getLogger(__name__)


class ConfigManager:
    """管理全局偏好，以及文本/图片模型两套独立预设。"""

    def __init__(self):
        self._global_config = DEFAULT_GLOBAL_CONFIG.copy()
        self._text_presets = {DEFAULT_PRESET_ID: self._sanitize_text_preset(DEFAULT_TEXT_PRESET)}
        self._vision_presets = {DEFAULT_PRESET_ID: self._sanitize_vision_preset(DEFAULT_VISION_PRESET)}
        self._text_secret_overrides = {DEFAULT_PRESET_ID: self._extract_text_secrets(DEFAULT_TEXT_PRESET)}
        self._vision_secret_overrides = {DEFAULT_PRESET_ID: self._extract_vision_secrets(DEFAULT_VISION_PRESET)}
        self._active_text_preset_id = DEFAULT_PRESET_ID
        self._active_vision_preset_id = DEFAULT_PRESET_ID
        self._load_from_file()
        self._apply_to_env()

    def _sanitize_global_config(self, config: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in config.items() if key in GLOBAL_ALLOWED_KEYS}

    def _sanitize_text_preset(self, preset: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in preset.items() if key in TEXT_PRESET_KEYS}

    def _sanitize_vision_preset(self, preset: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in preset.items() if key in VISION_PRESET_KEYS}

    def _extract_text_secrets(self, preset: dict[str, Any]) -> dict[str, str]:
        return {key: str(preset.get(key, "") or "") for key in TEXT_SECRET_KEYS}

    def _extract_vision_secrets(self, preset: dict[str, Any]) -> dict[str, str]:
        return {key: str(preset.get(key, "") or "") for key in VISION_SECRET_KEYS}

    def _read_secret_env(self) -> dict[str, str]:
        return {key: str(os.getenv(key, "") or "") for key in SECRET_KEYS}

    def _is_masked_secret(self, value: Any) -> bool:
        return isinstance(value, str) and (value == "********" or "..." in value)

    def _merge_flat_config(self, config: dict[str, Any]) -> dict[str, Any]:
        merged = DEFAULT_FLAT_CONFIG.copy()
        merged.update(config)
        if "OPENAI_MODEL" not in merged:
            legacy_model = merged.get("OPENAI_ANALYSIS_MODEL") or merged.get("OPENAI_ORGANIZER_MODEL")
            merged["OPENAI_MODEL"] = legacy_model or DEFAULT_ANALYSIS_MODEL
        return merged

    def _flat_to_global_config(self, config: dict[str, Any]) -> dict[str, Any]:
        return {key: config.get(key, DEFAULT_GLOBAL_CONFIG[key]) for key in GLOBAL_ALLOWED_KEYS}

    def _flat_to_text_preset(self, config: dict[str, Any]) -> dict[str, Any]:
        return {
            "name": str(config.get("name") or DEFAULT_TEXT_PRESET["name"]),
            "OPENAI_BASE_URL": config.get("OPENAI_BASE_URL", DEFAULT_TEXT_PRESET["OPENAI_BASE_URL"]),
            "OPENAI_MODEL": config.get("OPENAI_MODEL", DEFAULT_TEXT_PRESET["OPENAI_MODEL"]),
            "OPENAI_API_KEY": config.get("OPENAI_API_KEY", ""),
        }

    def _flat_to_vision_preset(self, config: dict[str, Any]) -> dict[str, Any]:
        return {
            "name": str(config.get("IMAGE_ANALYSIS_NAME") or DEFAULT_VISION_PRESET["name"]),
            "IMAGE_ANALYSIS_NAME": str(config.get("IMAGE_ANALYSIS_NAME") or DEFAULT_VISION_PRESET["IMAGE_ANALYSIS_NAME"]),
            "IMAGE_ANALYSIS_BASE_URL": config.get("IMAGE_ANALYSIS_BASE_URL", DEFAULT_VISION_PRESET["IMAGE_ANALYSIS_BASE_URL"]),
            "IMAGE_ANALYSIS_MODEL": config.get("IMAGE_ANALYSIS_MODEL", DEFAULT_VISION_PRESET["IMAGE_ANALYSIS_MODEL"]),
            "IMAGE_ANALYSIS_API_KEY": config.get("IMAGE_ANALYSIS_API_KEY", ""),
        }

    def _default_text_presets(self) -> dict[str, dict[str, Any]]:
        return {DEFAULT_PRESET_ID: self._sanitize_text_preset(DEFAULT_TEXT_PRESET)}

    def _default_vision_presets(self) -> dict[str, dict[str, Any]]:
        return {DEFAULT_PRESET_ID: self._sanitize_vision_preset(DEFAULT_VISION_PRESET)}

    def _hydrate_secret_from_env(self, preset_type: str) -> None:
        env_secrets = self._read_secret_env()
        if preset_type == TEXT_PRESET_TYPE:
            active_id = self._active_text_preset_id
            active_secrets = self._text_secret_overrides.setdefault(active_id, {})
            for key in TEXT_SECRET_KEYS:
                value = env_secrets.get(key, "")
                if value and key not in active_secrets:
                    active_secrets[key] = value
            return

        active_id = self._active_vision_preset_id
        active_secrets = self._vision_secret_overrides.setdefault(active_id, {})
        for key in VISION_SECRET_KEYS:
            value = env_secrets.get(key, "")
            if value and key not in active_secrets:
                active_secrets[key] = value

    def _load_from_dual_preset_config(self, data: dict[str, Any]) -> None:
        self._global_config = self._sanitize_global_config(data.get("global_config", {}))
        raw_text_presets = data.get("text_presets", {})
        raw_vision_presets = data.get("vision_presets", {})
        self._text_presets = {}
        self._vision_presets = {}
        self._text_secret_overrides = {}
        self._vision_secret_overrides = {}

        for preset_id, raw_preset in raw_text_presets.items():
            preset = raw_preset.copy()
            secrets = self._extract_text_secrets(preset)
            self._text_presets[preset_id] = self._sanitize_text_preset(preset)
            self._text_secret_overrides[preset_id] = {key: value for key, value in secrets.items() if value}

        for preset_id, raw_preset in raw_vision_presets.items():
            preset = raw_preset.copy()
            secrets = self._extract_vision_secrets(preset)
            self._vision_presets[preset_id] = self._sanitize_vision_preset(preset)
            self._vision_secret_overrides[preset_id] = {key: value for key, value in secrets.items() if value}

        if DEFAULT_PRESET_ID not in self._text_presets:
            self._text_presets.update(self._default_text_presets())
        if DEFAULT_PRESET_ID not in self._vision_presets:
            self._vision_presets.update(self._default_vision_presets())
        if DEFAULT_PRESET_ID not in self._text_secret_overrides:
            self._text_secret_overrides[DEFAULT_PRESET_ID] = {}
        if DEFAULT_PRESET_ID not in self._vision_secret_overrides:
            self._vision_secret_overrides[DEFAULT_PRESET_ID] = {}

        self._active_text_preset_id = data.get("active_text_preset_id", DEFAULT_PRESET_ID)
        self._active_vision_preset_id = data.get("active_vision_preset_id", DEFAULT_PRESET_ID)
        if self._active_text_preset_id not in self._text_presets:
            self._active_text_preset_id = DEFAULT_PRESET_ID
        if self._active_vision_preset_id not in self._vision_presets:
            self._active_vision_preset_id = DEFAULT_PRESET_ID

    def _load_from_legacy_single_config(self, raw_config: dict[str, Any]) -> None:
        flat = self._merge_flat_config(raw_config.copy())
        self._global_config = self._sanitize_global_config(self._flat_to_global_config(flat))
        text_preset = self._flat_to_text_preset(flat)
        vision_preset = self._flat_to_vision_preset(flat)
        self._text_presets = {DEFAULT_PRESET_ID: self._sanitize_text_preset(text_preset)}
        self._vision_presets = {DEFAULT_PRESET_ID: self._sanitize_vision_preset(vision_preset)}
        self._text_secret_overrides = {
            DEFAULT_PRESET_ID: {key: value for key, value in self._extract_text_secrets(text_preset).items() if value}
        }
        self._vision_secret_overrides = {
            DEFAULT_PRESET_ID: {key: value for key, value in self._extract_vision_secrets(vision_preset).items() if value}
        }
        self._active_text_preset_id = DEFAULT_PRESET_ID
        self._active_vision_preset_id = DEFAULT_PRESET_ID

    def _load_from_file(self) -> None:
        if not CONFIG_PATH.exists():
            self._sync_from_legacy_env()
            return

        needs_resave = False

        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)

            if "global_config" in data or "text_presets" in data or "vision_presets" in data:
                self._load_from_dual_preset_config(data)
            elif "config" in data:
                self._load_from_legacy_single_config(data.get("config", {}))
                needs_resave = True
            else:
                raw_profiles = data.get("profiles", {})
                active_profile_id = data.get("active_profile_id", DEFAULT_PRESET_ID)
                raw_profile = raw_profiles.get(active_profile_id) or raw_profiles.get(DEFAULT_PRESET_ID, {})
                self._load_from_legacy_single_config(raw_profile)
                needs_resave = True
        except Exception:
            logger.exception("config.load_failed path=%s", CONFIG_PATH)
            return

        self._hydrate_secret_from_env(TEXT_PRESET_TYPE)
        self._hydrate_secret_from_env(VISION_PRESET_TYPE)

        if needs_resave:
            self.save()

    def _sync_from_legacy_env(self) -> None:
        flat = DEFAULT_FLAT_CONFIG.copy()
        for key in flat:
            env_val = os.getenv(key)
            if env_val is None:
                continue
            if isinstance(flat[key], bool):
                flat[key] = env_val.lower() in ("true", "1", "yes")
            else:
                flat[key] = env_val

        self._load_from_legacy_single_config(flat)
        self.save()

    def _get_text_preset(self, preset_id: str) -> dict[str, Any]:
        preset = DEFAULT_TEXT_PRESET.copy()
        preset.update(self._text_presets.get(preset_id, self._text_presets[DEFAULT_PRESET_ID]))
        preset["OPENAI_API_KEY"] = self._text_secret_overrides.get(preset_id, {}).get("OPENAI_API_KEY", "")
        return preset

    def _get_vision_preset(self, preset_id: str) -> dict[str, Any]:
        preset = DEFAULT_VISION_PRESET.copy()
        preset.update(self._vision_presets.get(preset_id, self._vision_presets[DEFAULT_PRESET_ID]))
        preset["IMAGE_ANALYSIS_API_KEY"] = self._vision_secret_overrides.get(preset_id, {}).get("IMAGE_ANALYSIS_API_KEY", "")
        return preset

    def _mask_secret(self, value: str) -> str:
        if not value:
            return ""
        if len(value) > 8:
            return f"{value[:4]}...{value[-4:]}"
        return "********"

    def _apply_to_env(self) -> None:
        config = self.get_active_config(mask_secrets=False)
        for key, value in config.items():
            if key == "name":
                continue
            if key == "OPENAI_MODEL":
                os.environ["OPENAI_ANALYSIS_MODEL"] = str(value)
                os.environ["OPENAI_ORGANIZER_MODEL"] = str(value)
            os.environ[key] = str(value)

    def get_active_config(self, mask_secrets: bool = True) -> dict[str, Any]:
        config = DEFAULT_FLAT_CONFIG.copy()
        config.update(self._global_config)
        text_preset = self._get_text_preset(self._active_text_preset_id)
        vision_preset = self._get_vision_preset(self._active_vision_preset_id)
        config.update(text_preset)
        config.update(vision_preset)
        config["name"] = text_preset.get("name", DEFAULT_TEXT_PRESET["name"])
        if mask_secrets:
            for key in SECRET_KEYS:
                config[key] = self._mask_secret(str(config.get(key, "") or ""))
        return config

    def get_active_id(self) -> str:
        return DEFAULT_PRESET_ID

    def list_profiles(self) -> list[dict[str, Any]]:
        return [{"id": DEFAULT_PRESET_ID, "name": "兼容模式"}]

    def get_config_payload(self, mask_secrets: bool = True) -> dict[str, Any]:
        text_presets = []
        for preset_id in self._text_presets:
            preset = self._get_text_preset(preset_id)
            item = {
                "id": preset_id,
                "name": preset.get("name") or DEFAULT_TEXT_PRESET["name"],
            }
            if mask_secrets:
                item["OPENAI_API_KEY"] = self._mask_secret(preset.get("OPENAI_API_KEY", ""))
            text_presets.append(item)

        vision_presets = []
        for preset_id in self._vision_presets:
            preset = self._get_vision_preset(preset_id)
            item = {
                "id": preset_id,
                "name": preset.get("name") or DEFAULT_VISION_PRESET["name"],
            }
            if mask_secrets:
                item["IMAGE_ANALYSIS_API_KEY"] = self._mask_secret(preset.get("IMAGE_ANALYSIS_API_KEY", ""))
            vision_presets.append(item)

        return {
            "config": self.get_active_config(mask_secrets=mask_secrets),
            "text_presets": text_presets,
            "vision_presets": vision_presets,
            "active_text_preset_id": self._active_text_preset_id,
            "active_vision_preset_id": self._active_vision_preset_id,
        }

    def get_secret_values(self, keys: list[str]) -> dict[str, str]:
        secret_values: dict[str, str] = {}
        for key in keys:
            if key not in SECRET_KEYS:
                raise ValueError(f"不支持读取密钥字段：{key}")
            secret_values[key] = str(self.get(key, "") or "")
        return secret_values

    def update_active_profile(self, patch: dict[str, Any]) -> None:
        global_patch: dict[str, Any] = {}
        text_patch = self._get_text_preset(self._active_text_preset_id)
        vision_patch = self._get_vision_preset(self._active_vision_preset_id)

        for key, value in patch.items():
            if key in GLOBAL_ALLOWED_KEYS:
                global_patch[key] = value
                continue
            if key == "IMAGE_ANALYSIS_NAME":
                vision_patch["IMAGE_ANALYSIS_NAME"] = value
                vision_patch["name"] = value
                continue
            if key in TEXT_PRESET_KEYS:
                text_patch[key] = value
                continue
            if key in VISION_PRESET_KEYS:
                vision_patch[key] = value
                continue
            if key == "OPENAI_API_KEY":
                if value == "":
                    self._text_secret_overrides.setdefault(self._active_text_preset_id, {})["OPENAI_API_KEY"] = ""
                elif value and not self._is_masked_secret(value):
                    self._text_secret_overrides.setdefault(self._active_text_preset_id, {})["OPENAI_API_KEY"] = str(value)
                continue
            if key == "IMAGE_ANALYSIS_API_KEY":
                if value == "":
                    self._vision_secret_overrides.setdefault(self._active_vision_preset_id, {})["IMAGE_ANALYSIS_API_KEY"] = ""
                elif value and not self._is_masked_secret(value):
                    self._vision_secret_overrides.setdefault(self._active_vision_preset_id, {})["IMAGE_ANALYSIS_API_KEY"] = str(value)

        self._global_config.update(self._sanitize_global_config(global_patch))
        self._text_presets[self._active_text_preset_id] = self._sanitize_text_preset(text_patch)
        self._vision_presets[self._active_vision_preset_id] = self._sanitize_vision_preset(vision_patch)
        self._apply_to_env()
        self.save()

    def list_presets(self, preset_type: str) -> list[dict[str, Any]]:
        if preset_type not in PRESET_TYPES:
            raise ValueError("不支持的预设类型")
        if preset_type == TEXT_PRESET_TYPE:
            return [{"id": preset_id, "name": preset["name"]} for preset_id, preset in self._text_presets.items()]
        return [{"id": preset_id, "name": preset["name"]} for preset_id, preset in self._vision_presets.items()]

    def switch_preset(self, preset_type: str, preset_id: str) -> None:
        if preset_type == TEXT_PRESET_TYPE:
            if preset_id not in self._text_presets:
                raise ValueError("文本预设不存在")
            self._active_text_preset_id = preset_id
        elif preset_type == VISION_PRESET_TYPE:
            if preset_id not in self._vision_presets:
                raise ValueError("图片预设不存在")
            self._active_vision_preset_id = preset_id
        else:
            raise ValueError("不支持的预设类型")
        self._apply_to_env()
        self.save()

    def add_preset(self, preset_type: str, name: str, copy_from_active: bool = True) -> str:
        preset_id = str(uuid.uuid4())[:8]
        if preset_type == TEXT_PRESET_TYPE:
            preset = self._get_text_preset(self._active_text_preset_id) if copy_from_active else DEFAULT_TEXT_PRESET.copy()
            preset["name"] = name
            self._text_presets[preset_id] = self._sanitize_text_preset(preset)
            self._text_secret_overrides[preset_id] = {
                key: value for key, value in self._extract_text_secrets(preset).items() if value
            }
            self._active_text_preset_id = preset_id
        elif preset_type == VISION_PRESET_TYPE:
            preset = self._get_vision_preset(self._active_vision_preset_id) if copy_from_active else DEFAULT_VISION_PRESET.copy()
            preset["name"] = name
            preset["IMAGE_ANALYSIS_NAME"] = name
            self._vision_presets[preset_id] = self._sanitize_vision_preset(preset)
            self._vision_secret_overrides[preset_id] = {
                key: value for key, value in self._extract_vision_secrets(preset).items() if value
            }
            self._active_vision_preset_id = preset_id
        else:
            raise ValueError("不支持的预设类型")
        self._apply_to_env()
        self.save()
        return preset_id

    def delete_preset(self, preset_type: str, preset_id: str) -> None:
        if preset_id == DEFAULT_PRESET_ID:
            raise ValueError("默认预设不可删除")
        if preset_type == TEXT_PRESET_TYPE:
            if preset_id not in self._text_presets:
                raise ValueError("文本预设不存在")
            self._text_presets.pop(preset_id)
            self._text_secret_overrides.pop(preset_id, None)
            if self._active_text_preset_id == preset_id:
                self._active_text_preset_id = DEFAULT_PRESET_ID
        elif preset_type == VISION_PRESET_TYPE:
            if preset_id not in self._vision_presets:
                raise ValueError("图片预设不存在")
            self._vision_presets.pop(preset_id)
            self._vision_secret_overrides.pop(preset_id, None)
            if self._active_vision_preset_id == preset_id:
                self._active_vision_preset_id = DEFAULT_PRESET_ID
        else:
            raise ValueError("不支持的预设类型")
        self._apply_to_env()
        self.save()

    def switch_profile(self, profile_id: str) -> None:
        if profile_id != DEFAULT_PRESET_ID:
            raise ValueError("仅支持默认配置")

    def add_profile(self, name: str, copy_from_active: bool = True) -> str:
        raise ValueError("请改用独立的文本或图片预设")

    def delete_profile(self, profile_id: str) -> None:
        raise ValueError("请改用独立的文本或图片预设")

    def save(self) -> None:
        text_presets: dict[str, dict[str, Any]] = {}
        for preset_id, preset in self._text_presets.items():
            text_presets[preset_id] = {
                **self._sanitize_text_preset(preset),
                **self._text_secret_overrides.get(preset_id, {}),
            }

        vision_presets: dict[str, dict[str, Any]] = {}
        for preset_id, preset in self._vision_presets.items():
            vision_presets[preset_id] = {
                **self._sanitize_vision_preset(preset),
                **self._vision_secret_overrides.get(preset_id, {}),
            }

        data = {
            "global_config": self._sanitize_global_config(self._global_config),
            "text_presets": text_presets,
            "vision_presets": vision_presets,
            "active_text_preset_id": self._active_text_preset_id,
            "active_vision_preset_id": self._active_vision_preset_id,
        }
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def get(self, key: str, default: Any = None) -> Any:
        return self.get_active_config(mask_secrets=False).get(key, default)


config_manager = ConfigManager()
