from __future__ import annotations

import copy
import json
import os
import uuid
from pathlib import Path
from typing import Any

from file_pilot.shared.constants import PROJECT_ROOT
from file_pilot.shared.logging_utils import DEBUG_LOG_PATH, RUNTIME_LOG_PATH

DEFAULT_PRESET_ID = "default"
EMPTY_PRESET_ID = ""
SETTINGS_VERSION = 2

TEXT_FAMILY = "text"
VISION_FAMILY = "vision"
ICON_IMAGE_FAMILY = "icon_image"
BG_REMOVAL_FAMILY = "bg_removal"
SETTINGS_FAMILIES = {TEXT_FAMILY, VISION_FAMILY, ICON_IMAGE_FAMILY, BG_REMOVAL_FAMILY}
VISION_SOURCE_SHARED_TEXT = "shared_text"
VISION_SOURCE_SEPARATE = "separate"
VISION_SOURCE_MODES = {VISION_SOURCE_SHARED_TEXT, VISION_SOURCE_SEPARATE}

TEXT_SECRET_KEY = "OPENAI_API_KEY"
VISION_SECRET_KEY = "IMAGE_ANALYSIS_API_KEY"

GLOBAL_ALLOWED_KEYS = {
    "IMAGE_ANALYSIS_ENABLED",
    "IMAGE_ANALYSIS_SOURCE_MODE",
    "DEBUG_MODE",
    "LAUNCH_DEFAULT_ORGANIZE_METHOD",
    "LAUNCH_DEFAULT_TARGET_PROFILE_ID",
    "LAUNCH_DEFAULT_TEMPLATE_ID",
    "LAUNCH_DEFAULT_LANGUAGE",
    "LAUNCH_DEFAULT_DENSITY",
    "LAUNCH_DEFAULT_PREFIX_STYLE",
    "LAUNCH_DEFAULT_CAUTION_LEVEL",
    "LAUNCH_DEFAULT_NOTE",
    "LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT",
    "LAUNCH_DEFAULT_REVIEW_ROOT",
    "LAUNCH_REVIEW_FOLLOWS_NEW_ROOT",
    "LAUNCH_SKIP_STRATEGY_PROMPT",
}

DEFAULT_GLOBAL_CONFIG = {
    "IMAGE_ANALYSIS_ENABLED": False,
    "IMAGE_ANALYSIS_SOURCE_MODE": VISION_SOURCE_SHARED_TEXT,
    "DEBUG_MODE": False,
    "LAUNCH_DEFAULT_ORGANIZE_METHOD": "categorize_into_new_structure",
    "LAUNCH_DEFAULT_TARGET_PROFILE_ID": "",
    "LAUNCH_DEFAULT_TEMPLATE_ID": "general_downloads",
    "LAUNCH_DEFAULT_LANGUAGE": "zh",
    "LAUNCH_DEFAULT_DENSITY": "normal",
    "LAUNCH_DEFAULT_PREFIX_STYLE": "none",
    "LAUNCH_DEFAULT_CAUTION_LEVEL": "balanced",
    "LAUNCH_DEFAULT_NOTE": "",
    "LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT": "",
    "LAUNCH_DEFAULT_REVIEW_ROOT": "",
    "LAUNCH_REVIEW_FOLLOWS_NEW_ROOT": True,
    "LAUNCH_SKIP_STRATEGY_PROMPT": False,
}

DEFAULT_TEXT_PRESET = {
    "name": "默认文本模型",
    "OPENAI_BASE_URL": "",
    "OPENAI_MODEL": "",
    TEXT_SECRET_KEY: "",
}

DEFAULT_VISION_PRESET = {
    "name": "默认图片模型",
    "IMAGE_ANALYSIS_NAME": "默认图片模型",
    "IMAGE_ANALYSIS_BASE_URL": "",
    "IMAGE_ANALYSIS_MODEL": "",
    VISION_SECRET_KEY: "",
}

# Example / template values that must never count as a real configuration.
_EXAMPLE_PLACEHOLDER_MARKERS = (
    "your_text_api_key",
    "your_vision_api_key",
    "your-text-endpoint",
    "your-vision-endpoint",
    "your_api_key",
    "your-api-key",
)

DEFAULT_ICON_IMAGE_PRESET = {
    "name": "默认图标生图",
    "image_model": {
        "base_url": "",
        "model": "",
        "api_key": "",
    },
    "image_size": "1024x1024",
    "analysis_concurrency_limit": 2,
    "image_concurrency_limit": 1,
    "save_mode": "centralized",
}

DEFAULT_BG_REMOVAL_CUSTOM = {
    "name": "自定义抠图",
    "model_id": "",
    "api_type": "gradio_space",
    "payload_template": "",
    "hf_api_token": "",
}

DEFAULT_BG_REMOVAL_PRESET_ID = "bria-rmbg-2.0"
BG_REMOVAL_BUILTIN_PRESETS = [
    {
        "id": "bria-rmbg-2.0",
        "name": "BRIA RMBG 2.0",
        "model_id": "briaai/BRIA-RMBG-2.0",
        "api_type": "gradio_space",
        "payload_template": '{"data":[{"path":"{{uploaded_path}}","meta":{"_type":"gradio.FileData"}}],"fn_index":0}',
    },
    {
        "id": "bria-rmbg-1.4",
        "name": "BRIA RMBG 1.4",
        "model_id": "briaai/BRIA-RMBG-1.4",
        "api_type": "gradio_space",
        "payload_template": '{"data":[{"path":"{{uploaded_path}}","meta":{"_type":"gradio.FileData"}}],"fn_index":0}',
    },
    {
        "id": "not-lain/background-removal",
        "name": "not-lain/background-removal",
        "model_id": "not-lain/background-removal",
        "api_type": "gradio_space",
        "payload_template": '{"data":[{"path":"{{uploaded_path}}","meta":{"_type":"gradio.FileData"}}],"fn_index":0}',
    },
    {
        "id": "kenjiedec/rembg",
        "name": "KenjieDec/RemBG",
        "model_id": "KenjieDec/RemBG",
        "api_type": "gradio_space",
        "payload_template": '{"data":[{"path":"{{uploaded_path}}","meta":{"_type":"gradio.FileData"}}],"fn_index":0}',
    },
]

DEFAULT_BG_REMOVAL_CONFIG = {
    "mode": "preset",
    "preset_id": DEFAULT_BG_REMOVAL_PRESET_ID,
    "custom": copy.deepcopy(DEFAULT_BG_REMOVAL_CUSTOM),
}


def _secret_state(value: str) -> str:
    return "stored" if str(value or "").strip() else "empty"


def _is_masked_secret(value: Any) -> bool:
    return isinstance(value, str) and (value == "********" or "..." in value)


def _public_secret_placeholder(_: Any) -> str:
    return ""


def _is_example_placeholder(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    lowered = text.lower()
    if any(marker in lowered for marker in _EXAMPLE_PLACEHOLDER_MARKERS):
        return True
    if lowered.startswith("your_") and lowered.endswith("_here"):
        return True
    return False


def _normalize_config_value(value: Any) -> str:
    text = str(value or "").strip()
    if not text or _is_example_placeholder(text):
        return ""
    return text


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
        self._text_presets: dict[str, dict[str, Any]] = {}
        self._vision_presets: dict[str, dict[str, Any]] = {}
        self._icon_image_presets: dict[str, dict[str, Any]] = {}
        self._bg_removal = copy.deepcopy(DEFAULT_BG_REMOVAL_CONFIG)
        self._active_text_preset_id = EMPTY_PRESET_ID
        self._active_vision_preset_id = EMPTY_PRESET_ID
        self._active_icon_image_preset_id = EMPTY_PRESET_ID
        self._load()
        self._apply_to_env()

    def _sanitize_global(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        config = copy.deepcopy(DEFAULT_GLOBAL_CONFIG)
        for key, value in dict(payload or {}).items():
            if key not in GLOBAL_ALLOWED_KEYS:
                continue
            if isinstance(DEFAULT_GLOBAL_CONFIG[key], bool):
                config[key] = bool(value)
            elif key == "IMAGE_ANALYSIS_SOURCE_MODE":
                config[key] = self._sanitize_vision_mode(value)
            else:
                config[key] = value
        return config

    def _sanitize_vision_mode(self, value: Any) -> str:
        mode = str(value or VISION_SOURCE_SHARED_TEXT).strip().lower()
        if mode not in VISION_SOURCE_MODES:
            return VISION_SOURCE_SHARED_TEXT
        return mode

    def _get_vision_source_mode(self) -> str:
        return self._sanitize_vision_mode(self._global_config.get("IMAGE_ANALYSIS_SOURCE_MODE"))

    def _sanitize_text_preset(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        data = dict(payload or {})
        raw_url = str(data.get("OPENAI_BASE_URL") or "").strip()
        raw_secret = str(data.get(TEXT_SECRET_KEY, "") or "").strip()
        base_url = _normalize_config_value(raw_url)
        secret = _normalize_config_value(raw_secret)
        model = _normalize_config_value(data.get("OPENAI_MODEL"))
        # Drop orphan model ids left behind by example templates once URL/key are placeholders.
        if not base_url and not secret and (
            _is_example_placeholder(raw_url) or _is_example_placeholder(raw_secret)
        ):
            model = ""
        return {
            "name": str(data.get("name") or DEFAULT_TEXT_PRESET["name"]).strip() or DEFAULT_TEXT_PRESET["name"],
            "OPENAI_BASE_URL": base_url,
            "OPENAI_MODEL": model,
            TEXT_SECRET_KEY: secret,
        }

    def _sanitize_vision_preset(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        data = dict(payload or {})
        name = str(data.get("IMAGE_ANALYSIS_NAME") or data.get("name") or DEFAULT_VISION_PRESET["name"]).strip()
        raw_url = str(data.get("IMAGE_ANALYSIS_BASE_URL") or "").strip()
        raw_secret = str(data.get(VISION_SECRET_KEY, "") or "").strip()
        base_url = _normalize_config_value(raw_url)
        secret = _normalize_config_value(raw_secret)
        model = _normalize_config_value(data.get("IMAGE_ANALYSIS_MODEL"))
        if not base_url and not secret and (
            _is_example_placeholder(raw_url) or _is_example_placeholder(raw_secret)
        ):
            model = ""
        return {
            "name": name or DEFAULT_VISION_PRESET["name"],
            "IMAGE_ANALYSIS_NAME": name or DEFAULT_VISION_PRESET["IMAGE_ANALYSIS_NAME"],
            "IMAGE_ANALYSIS_BASE_URL": base_url,
            "IMAGE_ANALYSIS_MODEL": model,
            VISION_SECRET_KEY: secret,
        }

    def _sanitize_icon_image_preset(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        data = dict(payload or {})
        image_model = dict(data.get("image_model") or {})
        legacy_limit = data.get("concurrency_limit")
        try:
            analysis_concurrency_limit = int(
                data.get("analysis_concurrency_limit", legacy_limit) or DEFAULT_ICON_IMAGE_PRESET["analysis_concurrency_limit"]
            )
        except (TypeError, ValueError):
            analysis_concurrency_limit = DEFAULT_ICON_IMAGE_PRESET["analysis_concurrency_limit"]
        try:
            image_concurrency_limit = int(
                data.get("image_concurrency_limit", legacy_limit) or DEFAULT_ICON_IMAGE_PRESET["image_concurrency_limit"]
            )
        except (TypeError, ValueError):
            image_concurrency_limit = DEFAULT_ICON_IMAGE_PRESET["image_concurrency_limit"]
        return {
            "name": str(data.get("name") or DEFAULT_ICON_IMAGE_PRESET["name"]).strip() or DEFAULT_ICON_IMAGE_PRESET["name"],
            "image_model": {
                "base_url": _normalize_config_value(image_model.get("base_url", "")),
                "model": _normalize_config_value(image_model.get("model", "")),
                "api_key": _normalize_config_value(image_model.get("api_key", "")),
            },
            "image_size": str(data.get("image_size") or DEFAULT_ICON_IMAGE_PRESET["image_size"]).strip() or DEFAULT_ICON_IMAGE_PRESET["image_size"],
            "analysis_concurrency_limit": max(1, min(analysis_concurrency_limit, 6)),
            "image_concurrency_limit": max(1, min(image_concurrency_limit, 6)),
            "save_mode": "in_folder" if str(data.get("save_mode", "")).strip().lower() == "in_folder" else "centralized",
        }

    def _sanitize_bg_removal_custom(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        data = dict(payload or {})
        return {
            "name": str(data.get("name") or DEFAULT_BG_REMOVAL_CUSTOM["name"]).strip() or DEFAULT_BG_REMOVAL_CUSTOM["name"],
            "model_id": str(data.get("model_id") or "").strip(),
            "api_type": str(data.get("api_type") or DEFAULT_BG_REMOVAL_CUSTOM["api_type"]).strip() or DEFAULT_BG_REMOVAL_CUSTOM["api_type"],
            "payload_template": str(data.get("payload_template") or "").strip(),
            "hf_api_token": str(data.get("hf_api_token", "") or ""),
        }

    def _sanitize_bg_removal_config(self, payload: dict[str, Any] | None) -> dict[str, Any]:
        data = dict(payload or {})
        preset_ids = {str(item["id"]) for item in BG_REMOVAL_BUILTIN_PRESETS}
        preset_id = str(data.get("preset_id") or DEFAULT_BG_REMOVAL_PRESET_ID).strip() or DEFAULT_BG_REMOVAL_PRESET_ID
        if preset_id not in preset_ids:
            preset_id = DEFAULT_BG_REMOVAL_PRESET_ID
        mode = str(data.get("mode") or "preset").strip().lower()
        if mode not in {"preset", "custom"}:
            mode = "preset"
        return {
            "mode": mode,
            "preset_id": preset_id,
            "custom": self._sanitize_bg_removal_custom(data.get("custom")),
        }

    def _normalize_active_preset_id(self, presets: dict[str, dict[str, Any]], active_preset_id: str) -> str:
        if active_preset_id and active_preset_id in presets:
            return active_preset_id
        if presets:
            return next(iter(presets))
        return EMPTY_PRESET_ID

    def _is_empty_text_preset(self, preset: dict[str, Any] | None) -> bool:
        sanitized = self._sanitize_text_preset(preset)
        return not (
            sanitized.get("OPENAI_BASE_URL")
            or sanitized.get("OPENAI_MODEL")
            or sanitized.get(TEXT_SECRET_KEY)
        )

    def _is_empty_vision_preset(self, preset: dict[str, Any] | None) -> bool:
        sanitized = self._sanitize_vision_preset(preset)
        return not (
            sanitized.get("IMAGE_ANALYSIS_BASE_URL")
            or sanitized.get("IMAGE_ANALYSIS_MODEL")
            or sanitized.get(VISION_SECRET_KEY)
        )

    def _is_empty_icon_image_preset(self, preset: dict[str, Any] | None) -> bool:
        sanitized = self._sanitize_icon_image_preset(preset)
        image_model = dict(sanitized.get("image_model") or {})
        has_credentials = bool(
            image_model.get("base_url")
            or image_model.get("model")
            or image_model.get("api_key")
        )
        if has_credentials:
            return False
        # Keep presets that only customize workbench options (size/concurrency/save mode).
        default = self._sanitize_icon_image_preset(DEFAULT_ICON_IMAGE_PRESET)
        return (
            sanitized.get("image_size") == default.get("image_size")
            and sanitized.get("analysis_concurrency_limit") == default.get("analysis_concurrency_limit")
            and sanitized.get("image_concurrency_limit") == default.get("image_concurrency_limit")
            and sanitized.get("save_mode") == default.get("save_mode")
        )

    def _prune_placeholder_default_presets(self) -> bool:
        changed = False
        for preset_id, preset in list(self._text_presets.items()):
            if self._is_empty_text_preset(preset):
                self._text_presets.pop(preset_id, None)
                changed = True
        for preset_id, preset in list(self._vision_presets.items()):
            if self._is_empty_vision_preset(preset):
                self._vision_presets.pop(preset_id, None)
                changed = True
        for preset_id, preset in list(self._icon_image_presets.items()):
            if self._is_empty_icon_image_preset(preset):
                self._icon_image_presets.pop(preset_id, None)
                changed = True
        return changed

    def _ensure_defaults(self) -> bool:
        changed = self._prune_placeholder_default_presets()
        next_active_text = self._normalize_active_preset_id(self._text_presets, self._active_text_preset_id)
        next_active_vision = self._normalize_active_preset_id(self._vision_presets, self._active_vision_preset_id)
        next_active_icon = self._normalize_active_preset_id(self._icon_image_presets, self._active_icon_image_preset_id)
        if next_active_text != self._active_text_preset_id:
            self._active_text_preset_id = next_active_text
            changed = True
        if next_active_vision != self._active_vision_preset_id:
            self._active_vision_preset_id = next_active_vision
            changed = True
        if next_active_icon != self._active_icon_image_preset_id:
            self._active_icon_image_preset_id = next_active_icon
            changed = True
        next_bg = self._sanitize_bg_removal_config(self._bg_removal)
        if next_bg != self._bg_removal:
            self._bg_removal = next_bg
            changed = True
        return changed

    def _apply_env_overrides(self, target: dict[str, Any]) -> dict[str, Any]:
        next_payload = copy.deepcopy(target)
        for key, default in list(target.items()):
            raw = os.getenv(key)
            if raw is None:
                continue
            if isinstance(default, bool):
                next_payload[key] = raw.strip().lower() in {"1", "true", "yes", "on"}
            else:
                next_payload[key] = raw
        return next_payload

    def _sync_from_env(self) -> None:
        global_flat = self._apply_env_overrides(DEFAULT_GLOBAL_CONFIG)
        text_flat = self._apply_env_overrides(DEFAULT_TEXT_PRESET)
        vision_flat = self._apply_env_overrides(DEFAULT_VISION_PRESET)
        self._global_config = self._sanitize_global(global_flat)
        if any(
            str(os.getenv(key) or "").strip()
            for key in ("IMAGE_ANALYSIS_NAME", "IMAGE_ANALYSIS_BASE_URL", "IMAGE_ANALYSIS_MODEL", VISION_SECRET_KEY)
        ):
            self._global_config["IMAGE_ANALYSIS_SOURCE_MODE"] = VISION_SOURCE_SEPARATE
        self._text_presets = {DEFAULT_PRESET_ID: self._sanitize_text_preset(text_flat)}
        self._vision_presets = {DEFAULT_PRESET_ID: self._sanitize_vision_preset(vision_flat)}
        self._active_text_preset_id = DEFAULT_PRESET_ID
        self._active_vision_preset_id = DEFAULT_PRESET_ID

    def _load_legacy_icon_payload(self) -> tuple[dict[str, dict[str, Any]], str] | None:
        if not self._legacy_icon_config_path.exists():
            return None
        raw = json.loads(self._legacy_icon_config_path.read_text(encoding="utf-8"))
        presets: dict[str, dict[str, Any]] = {}
        active_id = EMPTY_PRESET_ID
        if "presets" in raw:
            active_id = str(raw.get("active_preset_id") or EMPTY_PRESET_ID)
            for preset_id, preset in dict(raw.get("presets", {}) or {}).items():
                presets[str(preset_id)] = self._sanitize_icon_image_preset(preset)
        else:
            presets[DEFAULT_PRESET_ID] = self._sanitize_icon_image_preset(raw)
        if active_id not in presets:
            active_id = self._normalize_active_preset_id(presets, active_id)
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
        self._bg_removal = self._sanitize_bg_removal_config(data.get("bg_removal"))
        self._active_text_preset_id = str(data.get("active_text_preset_id") or EMPTY_PRESET_ID)
        self._active_vision_preset_id = str(data.get("active_vision_preset_id") or EMPTY_PRESET_ID)
        self._active_icon_image_preset_id = str(data.get("active_icon_image_preset_id") or EMPTY_PRESET_ID)

    def _migrate_default_icon_analysis_limit(self) -> bool:
        default_preset = self._icon_image_presets.get(DEFAULT_PRESET_ID)
        if not default_preset:
            return False
        if int(default_preset.get("analysis_concurrency_limit", 0) or 0) != 1:
            return False
        default_preset["analysis_concurrency_limit"] = DEFAULT_ICON_IMAGE_PRESET["analysis_concurrency_limit"]
        return True

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
            self._active_text_preset_id = str(data.get("active_text_preset_id") or EMPTY_PRESET_ID)
            self._active_vision_preset_id = str(data.get("active_vision_preset_id") or EMPTY_PRESET_ID)
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
                if "IMAGE_ANALYSIS_SOURCE_MODE" not in dict(data.get("global_config") or {}):
                    needs_save = True
                if "bg_removal" not in data:
                    needs_save = True
                raw_icon_presets = dict(data.get("icon_image_presets", {}) or {})
                if any(
                    "analysis_concurrency_limit" not in dict(preset or {})
                    or "image_concurrency_limit" not in dict(preset or {})
                    for preset in raw_icon_presets.values()
                ):
                    needs_save = True
                if self._migrate_default_icon_analysis_limit():
                    needs_save = True
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

        if self._ensure_defaults():
            needs_save = True
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
            "bg_removal": copy.deepcopy(self._bg_removal),
            "active_text_preset_id": self._active_text_preset_id,
            "active_vision_preset_id": self._active_vision_preset_id,
            "active_icon_image_preset_id": self._active_icon_image_preset_id,
        }
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        self._config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _get_active_text_preset(self) -> dict[str, Any]:
        return copy.deepcopy(self._text_presets.get(self._active_text_preset_id) or DEFAULT_TEXT_PRESET)

    def _get_active_vision_preset(self) -> dict[str, Any]:
        return copy.deepcopy(self._vision_presets.get(self._active_vision_preset_id) or DEFAULT_VISION_PRESET)

    def _get_active_icon_image_preset(self) -> dict[str, Any]:
        return copy.deepcopy(self._icon_image_presets.get(self._active_icon_image_preset_id) or DEFAULT_ICON_IMAGE_PRESET)

    def _text_preset_to_public(self, preset_id: str, preset: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": preset_id,
            "name": str(preset.get("name") or DEFAULT_TEXT_PRESET["name"]),
            "OPENAI_BASE_URL": str(preset.get("OPENAI_BASE_URL") or "").strip(),
            "OPENAI_MODEL": str(preset.get("OPENAI_MODEL") or "").strip(),
            "OPENAI_API_KEY": _public_secret_placeholder(preset.get(TEXT_SECRET_KEY, "")),
            "secret_state": _secret_state(str(preset.get(TEXT_SECRET_KEY, "") or "")),
        }

    def _vision_preset_to_public(self, preset_id: str, preset: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": preset_id,
            "name": str(preset.get("name") or DEFAULT_VISION_PRESET["name"]),
            "IMAGE_ANALYSIS_NAME": str(preset.get("IMAGE_ANALYSIS_NAME") or preset.get("name") or ""),
            "IMAGE_ANALYSIS_BASE_URL": str(preset.get("IMAGE_ANALYSIS_BASE_URL") or "").strip(),
            "IMAGE_ANALYSIS_MODEL": str(preset.get("IMAGE_ANALYSIS_MODEL") or "").strip(),
            "IMAGE_ANALYSIS_API_KEY": _public_secret_placeholder(preset.get(VISION_SECRET_KEY, "")),
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
                "api_key": _public_secret_placeholder(image_model.get("api_key", "")),
                "secret_state": _secret_state(str(image_model.get("api_key", "") or "")),
            },
            "image_size": str(preset.get("image_size") or DEFAULT_ICON_IMAGE_PRESET["image_size"]),
            "analysis_concurrency_limit": int(
                preset.get("analysis_concurrency_limit", DEFAULT_ICON_IMAGE_PRESET["analysis_concurrency_limit"])
                or DEFAULT_ICON_IMAGE_PRESET["analysis_concurrency_limit"]
            ),
            "image_concurrency_limit": int(preset.get("image_concurrency_limit", DEFAULT_ICON_IMAGE_PRESET["image_concurrency_limit"]) or 1),
            "save_mode": "in_folder" if str(preset.get("save_mode", "")).strip().lower() == "in_folder" else "centralized",
        }

    def _public_text_source(self) -> dict[str, Any]:
        active = self._get_active_text_preset()
        return {
            "name": str(active.get("name") or DEFAULT_TEXT_PRESET["name"]),
            "base_url": str(active.get("OPENAI_BASE_URL") or "").strip(),
            "model": str(active.get("OPENAI_MODEL") or "").strip(),
            "api_key": _public_secret_placeholder(active.get(TEXT_SECRET_KEY, "")),
            "secret_state": _secret_state(str(active.get(TEXT_SECRET_KEY, "") or "")),
            "configured": self.is_text_configured(),
        }

    def _get_bg_removal_builtin_preset(self, preset_id: str) -> dict[str, Any]:
        for preset in BG_REMOVAL_BUILTIN_PRESETS:
            if str(preset["id"]) == str(preset_id):
                return copy.deepcopy(preset)
        return copy.deepcopy(BG_REMOVAL_BUILTIN_PRESETS[0])

    def _bg_removal_custom_to_public(self) -> dict[str, Any]:
        custom = self._sanitize_bg_removal_custom(self._bg_removal.get("custom"))
        return {
            "name": custom["name"],
            "model_id": custom["model_id"],
            "api_type": custom["api_type"],
            "payload_template": custom["payload_template"],
            "hf_api_token": _public_secret_placeholder(custom.get("hf_api_token", "")),
            "secret_state": _secret_state(custom.get("hf_api_token", "")),
        }

    def _bg_removal_active_to_public(self) -> dict[str, Any]:
        if self._bg_removal.get("mode") == "custom":
            return self._bg_removal_custom_to_public()
        preset = self._get_bg_removal_builtin_preset(str(self._bg_removal.get("preset_id") or DEFAULT_BG_REMOVAL_PRESET_ID))
        hf_token = str(self._bg_removal.get("custom", {}).get("hf_api_token", "") or "")
        return {
            "name": preset["name"],
            "model_id": preset["model_id"],
            "api_type": preset["api_type"],
            "payload_template": preset["payload_template"],
            "hf_api_token": _public_secret_placeholder(hf_token),
            "secret_state": _secret_state(hf_token),
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
                    "mode": self._get_vision_source_mode(),
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
                BG_REMOVAL_FAMILY: {
                    "family": BG_REMOVAL_FAMILY,
                    "configured": self.is_bg_removal_configured(),
                    "mode": self._bg_removal["mode"],
                    "preset_id": self._bg_removal["preset_id"] if self._bg_removal["mode"] == "preset" else None,
                    "active_preset": self._bg_removal_active_to_public(),
                    "builtin_presets": [copy.deepcopy(preset) for preset in BG_REMOVAL_BUILTIN_PRESETS],
                    "custom": self._bg_removal_custom_to_public(),
                },
            },
            "status": {
                "text_configured": self.is_text_configured(),
                "vision_configured": self.is_vision_configured(),
                "icon_image_configured": self.is_icon_image_configured(),
                "bg_removal_configured": self.is_bg_removal_configured(),
            },
            "runtime": {
                "log_paths": {
                    "runtime_log": str(RUNTIME_LOG_PATH),
                    "debug_log": str(DEBUG_LOG_PATH),
                }
            },
        }

    def get_flat_active_config(self, mask_secrets: bool = False) -> dict[str, Any]:
        text = self._get_active_text_preset()
        vision = self._get_active_vision_preset()
        vision_mode = self._get_vision_source_mode()
        effective_vision = vision if vision_mode == VISION_SOURCE_SEPARATE else {
            "IMAGE_ANALYSIS_NAME": text.get("name", DEFAULT_TEXT_PRESET["name"]),
            "IMAGE_ANALYSIS_BASE_URL": text.get("OPENAI_BASE_URL", ""),
            "IMAGE_ANALYSIS_MODEL": text.get("OPENAI_MODEL", ""),
            VISION_SECRET_KEY: text.get(TEXT_SECRET_KEY, ""),
        }
        payload = {
            **copy.deepcopy(DEFAULT_GLOBAL_CONFIG),
            **copy.deepcopy(DEFAULT_TEXT_PRESET),
            **copy.deepcopy(DEFAULT_VISION_PRESET),
            **self._global_config,
            **text,
            **effective_vision,
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
        if self._active_text_preset_id not in self._text_presets:
            return False
        preset = self._sanitize_text_preset(self._get_active_text_preset())
        return bool(preset.get("OPENAI_BASE_URL") and preset.get("OPENAI_MODEL") and preset.get(TEXT_SECRET_KEY))

    def is_vision_configured(self) -> bool:
        if self._get_vision_source_mode() == VISION_SOURCE_SHARED_TEXT:
            return self.is_text_configured()
        if self._active_vision_preset_id not in self._vision_presets:
            return False
        preset = self._sanitize_vision_preset(self._get_active_vision_preset())
        return bool(
            preset.get("IMAGE_ANALYSIS_BASE_URL")
            and preset.get("IMAGE_ANALYSIS_MODEL")
            and preset.get(VISION_SECRET_KEY)
        )

    def is_icon_image_configured(self) -> bool:
        if self._active_icon_image_preset_id not in self._icon_image_presets:
            return False
        preset = self._sanitize_icon_image_preset(self._get_active_icon_image_preset())
        image_model = dict(preset.get("image_model") or {})
        api_key = _normalize_config_value(image_model.get("api_key"))
        return bool(
            _normalize_config_value(image_model.get("base_url"))
            and _normalize_config_value(image_model.get("model"))
            and api_key
        )

    def is_bg_removal_configured(self) -> bool:
        if self._bg_removal.get("mode") == "preset":
            return True
        custom = self._sanitize_bg_removal_custom(self._bg_removal.get("custom"))
        return bool(custom.get("model_id") and custom.get("api_type") and custom.get("payload_template"))

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
            mode = self._get_vision_source_mode()
            if mode == VISION_SOURCE_SHARED_TEXT:
                text_runtime = self.get_runtime_family_config(TEXT_FAMILY)
                return {
                    "name": text_runtime["name"],
                    "enabled": bool(self._global_config.get("IMAGE_ANALYSIS_ENABLED", False)),
                    "mode": mode,
                    "base_url": text_runtime["base_url"],
                    "model": text_runtime["model"],
                    "api_key": text_runtime["api_key"],
                }
            preset = self._get_active_vision_preset()
            return {
                "name": preset["name"],
                "enabled": bool(self._global_config.get("IMAGE_ANALYSIS_ENABLED", False)),
                "mode": mode,
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
                "analysis_concurrency_limit": preset["analysis_concurrency_limit"],
                "image_concurrency_limit": preset["image_concurrency_limit"],
                "save_mode": preset["save_mode"],
                "text_model": self.get_runtime_family_config(TEXT_FAMILY),
            }
        if family == BG_REMOVAL_FAMILY:
            if self._bg_removal.get("mode") == "custom":
                custom = self._sanitize_bg_removal_custom(self._bg_removal.get("custom"))
                return {
                    "name": custom["name"],
                    "model_id": custom["model_id"],
                    "api_type": custom["api_type"],
                    "payload_template": custom["payload_template"],
                    "api_token": custom["hf_api_token"],
                }
            preset = self._get_bg_removal_builtin_preset(str(self._bg_removal.get("preset_id") or DEFAULT_BG_REMOVAL_PRESET_ID))
            return {
                "name": preset["name"],
                "model_id": preset["model_id"],
                "api_type": preset["api_type"],
                "payload_template": preset["payload_template"],
                "api_token": str(self._bg_removal.get("custom", {}).get("hf_api_token", "") or ""),
            }
        raise ValueError("不支持的设置族")

    def _apply_secret_action(self, current_value: str, payload: dict[str, Any] | None) -> str:
        action = str((payload or {}).get("action", "keep") or "keep").strip().lower()
        if action == "keep":
            return current_value
        if action == "clear":
            return ""
        if action == "replace":
            return _normalize_config_value((payload or {}).get("value", ""))
        raise ValueError("不支持的密钥操作")

    def update_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        next_global = copy.deepcopy(self._global_config)
        next_text = copy.deepcopy(self._text_presets)
        next_vision = copy.deepcopy(self._vision_presets)
        next_icon = copy.deepcopy(self._icon_image_presets)
        next_bg_removal = copy.deepcopy(self._bg_removal)
        next_active_text_preset_id = self._active_text_preset_id
        next_active_vision_preset_id = self._active_vision_preset_id
        next_active_icon_image_preset_id = self._active_icon_image_preset_id

        if "global_config" in payload:
            next_global = self._sanitize_global({**next_global, **dict(payload.get("global_config") or {})})

        families = dict(payload.get("families") or {})
        if TEXT_FAMILY in families:
            family_payload = dict(families.get(TEXT_FAMILY) or {})
            if next_active_text_preset_id not in next_text and ("preset" in family_payload or "secret" in family_payload):
                next_active_text_preset_id = DEFAULT_PRESET_ID if DEFAULT_PRESET_ID not in next_text else str(uuid.uuid4())[:8]
                next_text[next_active_text_preset_id] = copy.deepcopy(DEFAULT_TEXT_PRESET)
            if next_active_text_preset_id in next_text:
                current = copy.deepcopy(next_text[next_active_text_preset_id])
                if "preset" in family_payload:
                    preset_patch = dict(family_payload.get("preset") or {})
                    current = self._sanitize_text_preset({**current, **preset_patch, TEXT_SECRET_KEY: current.get(TEXT_SECRET_KEY, "")})
                current[TEXT_SECRET_KEY] = self._apply_secret_action(current.get(TEXT_SECRET_KEY, ""), family_payload.get("secret"))
                next_text[next_active_text_preset_id] = current

        if VISION_FAMILY in families:
            family_payload = dict(families.get(VISION_FAMILY) or {})
            if next_active_vision_preset_id not in next_vision and ("preset" in family_payload or "secret" in family_payload):
                next_active_vision_preset_id = DEFAULT_PRESET_ID if DEFAULT_PRESET_ID not in next_vision else str(uuid.uuid4())[:8]
                next_vision[next_active_vision_preset_id] = copy.deepcopy(DEFAULT_VISION_PRESET)
            if next_active_vision_preset_id in next_vision:
                current = copy.deepcopy(next_vision[next_active_vision_preset_id])
                if "preset" in family_payload:
                    preset_patch = dict(family_payload.get("preset") or {})
                    current = self._sanitize_vision_preset({**current, **preset_patch, VISION_SECRET_KEY: current.get(VISION_SECRET_KEY, "")})
                current[VISION_SECRET_KEY] = self._apply_secret_action(current.get(VISION_SECRET_KEY, ""), family_payload.get("secret"))
                next_vision[next_active_vision_preset_id] = current
            elif "secret" in family_payload:
                self._apply_secret_action("", family_payload.get("secret"))
            if "enabled" in family_payload:
                next_global["IMAGE_ANALYSIS_ENABLED"] = bool(family_payload.get("enabled"))
            if "mode" in family_payload:
                next_global["IMAGE_ANALYSIS_SOURCE_MODE"] = self._sanitize_vision_mode(family_payload.get("mode"))

        if ICON_IMAGE_FAMILY in families:
            family_payload = dict(families.get(ICON_IMAGE_FAMILY) or {})
            if next_active_icon_image_preset_id not in next_icon and ("preset" in family_payload or "secret" in family_payload):
                next_active_icon_image_preset_id = DEFAULT_PRESET_ID if DEFAULT_PRESET_ID not in next_icon else str(uuid.uuid4())[:8]
                next_icon[next_active_icon_image_preset_id] = copy.deepcopy(DEFAULT_ICON_IMAGE_PRESET)
            if next_active_icon_image_preset_id in next_icon:
                current = copy.deepcopy(next_icon[next_active_icon_image_preset_id])
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
                next_icon[next_active_icon_image_preset_id] = self._sanitize_icon_image_preset(current)
            elif "secret" in family_payload:
                self._apply_secret_action("", family_payload.get("secret"))

        if BG_REMOVAL_FAMILY in families:
            family_payload = dict(families.get(BG_REMOVAL_FAMILY) or {})
            current = self._sanitize_bg_removal_config(next_bg_removal)
            if "mode" in family_payload:
                requested_mode = str(family_payload.get("mode") or "preset").strip().lower()
                current["mode"] = "custom" if requested_mode == "custom" else "preset"
            if "preset" in family_payload:
                preset_payload = dict(family_payload.get("preset") or {})
                current["preset_id"] = str(preset_payload.get("preset_id") or current.get("preset_id") or DEFAULT_BG_REMOVAL_PRESET_ID)
            if "custom" in family_payload:
                custom_payload = dict(family_payload.get("custom") or {})
                current["custom"] = self._sanitize_bg_removal_custom({
                    **dict(current.get("custom") or {}),
                    **custom_payload,
                    "hf_api_token": dict(current.get("custom") or {}).get("hf_api_token", ""),
                })
            custom = dict(current.get("custom") or {})
            custom["hf_api_token"] = self._apply_secret_action(str(custom.get("hf_api_token", "") or ""), family_payload.get("secret"))
            current["custom"] = self._sanitize_bg_removal_custom(custom)
            next_bg_removal = self._sanitize_bg_removal_config(current)

        self._global_config = next_global
        self._text_presets = next_text
        self._vision_presets = next_vision
        self._icon_image_presets = next_icon
        self._bg_removal = next_bg_removal
        self._active_text_preset_id = next_active_text_preset_id
        self._active_vision_preset_id = next_active_vision_preset_id
        self._active_icon_image_preset_id = next_active_icon_image_preset_id
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
        explicit_name = str(name or "").strip()
        if family == TEXT_FAMILY:
            base = self._get_active_text_preset() if copy_from_active else copy.deepcopy(DEFAULT_TEXT_PRESET)
            base["name"] = explicit_name or DEFAULT_TEXT_PRESET["name"]
            if preset_patch:
                base.update({key: value for key, value in dict(preset_patch).items() if key != TEXT_SECRET_KEY})
            base = self._sanitize_text_preset(base)
            base["name"] = explicit_name or base["name"]
            base[TEXT_SECRET_KEY] = self._apply_secret_action(base.get(TEXT_SECRET_KEY, ""), secret_payload)
            self._text_presets[preset_id] = base
            self._active_text_preset_id = preset_id
        elif family == VISION_FAMILY:
            base = self._get_active_vision_preset() if copy_from_active else copy.deepcopy(DEFAULT_VISION_PRESET)
            base["name"] = explicit_name or DEFAULT_VISION_PRESET["name"]
            base["IMAGE_ANALYSIS_NAME"] = base["name"]
            if preset_patch:
                for key, value in dict(preset_patch).items():
                    if key != VISION_SECRET_KEY:
                        base[key] = value
            base = self._sanitize_vision_preset(base)
            base["name"] = explicit_name or base["name"]
            base["IMAGE_ANALYSIS_NAME"] = explicit_name or base["IMAGE_ANALYSIS_NAME"]
            base[VISION_SECRET_KEY] = self._apply_secret_action(base.get(VISION_SECRET_KEY, ""), secret_payload)
            self._vision_presets[preset_id] = base
            self._active_vision_preset_id = preset_id
        elif family == ICON_IMAGE_FAMILY:
            base = self._get_active_icon_image_preset() if copy_from_active else copy.deepcopy(DEFAULT_ICON_IMAGE_PRESET)
            base["name"] = explicit_name or DEFAULT_ICON_IMAGE_PRESET["name"]
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
            base["name"] = explicit_name or base["name"]
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
        if family == TEXT_FAMILY:
            if preset_id not in self._text_presets:
                raise ValueError("文本预设不存在")
            self._text_presets.pop(preset_id, None)
            if self._active_text_preset_id == preset_id:
                self._active_text_preset_id = self._normalize_active_preset_id(self._text_presets, EMPTY_PRESET_ID)
        elif family == VISION_FAMILY:
            if preset_id not in self._vision_presets:
                raise ValueError("图片预设不存在")
            self._vision_presets.pop(preset_id, None)
            if self._active_vision_preset_id == preset_id:
                self._active_vision_preset_id = self._normalize_active_preset_id(self._vision_presets, EMPTY_PRESET_ID)
        elif family == ICON_IMAGE_FAMILY:
            if preset_id not in self._icon_image_presets:
                raise ValueError("图标生图预设不存在")
            self._icon_image_presets.pop(preset_id, None)
            if self._active_icon_image_preset_id == preset_id:
                self._active_icon_image_preset_id = self._normalize_active_preset_id(self._icon_image_presets, EMPTY_PRESET_ID)
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
                        "mode": VISION_SOURCE_SEPARATE if (vision_patch or vision_secret != {"action": "keep"}) else self._get_vision_source_mode(),
                        "preset": vision_patch,
                        "secret": vision_secret,
                    },
                },
            }
        )
