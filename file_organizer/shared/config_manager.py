import json
import os
import uuid
from pathlib import Path
from typing import Any

from file_organizer.shared.constants import (
    PROJECT_ROOT,
    DEFAULT_BASE_URL,
    DEFAULT_ANALYSIS_MODEL,
)

CONFIG_PATH = PROJECT_ROOT / "config.json"

DEFAULT_PROFILE_ID = "default"
SECRET_KEYS = {"OPENAI_API_KEY", "IMAGE_ANALYSIS_API_KEY"}
PROFILE_ALLOWED_KEYS = {
    "name",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "IMAGE_ANALYSIS_ENABLED",
    "IMAGE_ANALYSIS_BASE_URL",
    "IMAGE_ANALYSIS_MODEL",
    "DEBUG_MODE",
}
LEGACY_MODEL_KEYS = {"OPENAI_ANALYSIS_MODEL", "OPENAI_ORGANIZER_MODEL"}

# 默认配置模板
DEFAULT_PROFILE_DATA = {
    "name": "默认配置",
    "OPENAI_API_KEY": "",
    "OPENAI_BASE_URL": DEFAULT_BASE_URL,
    "OPENAI_MODEL": DEFAULT_ANALYSIS_MODEL,
    "IMAGE_ANALYSIS_ENABLED": False,
    "IMAGE_ANALYSIS_BASE_URL": "",
    "IMAGE_ANALYSIS_API_KEY": "",
    "IMAGE_ANALYSIS_MODEL": "",
    "DEBUG_MODE": False,
}


class ConfigManager:
    """管理系统配置，支持多套方案 (Profiles) 切换与持久化。"""

    def __init__(self):
        self._active_profile_id = DEFAULT_PROFILE_ID
        self._profiles = {DEFAULT_PROFILE_ID: self._sanitize_profile(DEFAULT_PROFILE_DATA)}
        self._secret_overrides = {DEFAULT_PROFILE_ID: self._extract_secrets(DEFAULT_PROFILE_DATA)}
        self._load_from_file()
        self._apply_to_env()

    def _sanitize_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in profile.items() if key in PROFILE_ALLOWED_KEYS}

    def _extract_secrets(self, profile: dict[str, Any]) -> dict[str, str]:
        return {key: str(profile.get(key, "") or "") for key in SECRET_KEYS}

    def _read_secret_env(self) -> dict[str, str]:
        return {key: str(os.getenv(key, "") or "") for key in SECRET_KEYS}

    def _migrate_legacy_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        migrated = profile.copy()
        if "OPENAI_MODEL" not in migrated:
            legacy_model = migrated.get("OPENAI_ANALYSIS_MODEL") or migrated.get("OPENAI_ORGANIZER_MODEL")
            migrated["OPENAI_MODEL"] = legacy_model or DEFAULT_ANALYSIS_MODEL
        return migrated

    def _is_masked_secret(self, value: Any) -> bool:
        return isinstance(value, str) and (value == "********" or "..." in value)

    def _get_persisted_profile(self, profile_id: str) -> dict[str, Any]:
        profile = DEFAULT_PROFILE_DATA.copy()
        profile.update(self._profiles.get(profile_id, self._profiles[DEFAULT_PROFILE_ID]))
        for key in SECRET_KEYS:
            profile[key] = ""
        return profile

    def _get_runtime_secret(self, profile_id: str, key: str) -> str:
        profile_secrets = self._secret_overrides.get(profile_id, {})
        if key in profile_secrets:
            return profile_secrets.get(key, "")
        return ""

    def _hydrate_active_profile_secrets_from_env(self) -> None:
        env_secrets = self._read_secret_env()
        active_secrets = self._secret_overrides.setdefault(self._active_profile_id, {})
        for key, value in env_secrets.items():
            if value and key not in active_secrets:
                active_secrets[key] = value

    def _load_from_file(self) -> None:
        if not CONFIG_PATH.exists():
            self._sync_from_legacy_env()
            return

        needs_resave = False

        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                self._active_profile_id = data.get("active_profile_id", DEFAULT_PROFILE_ID)
                raw_profiles = data.get("profiles", {DEFAULT_PROFILE_ID: self._sanitize_profile(DEFAULT_PROFILE_DATA)})

                self._profiles = {}
                self._secret_overrides = {}

                for pid, raw_profile in raw_profiles.items():
                    profile = self._migrate_legacy_profile(raw_profile.copy())
                    secrets = self._extract_secrets(profile)
                    if any(secrets.values()):
                        needs_resave = True
                    if any(key in raw_profile for key in LEGACY_MODEL_KEYS) or "OPENAI_MODEL" not in raw_profile:
                        needs_resave = True
                    sanitized = self._sanitize_profile(profile)
                    self._profiles[pid] = sanitized
                    self._secret_overrides[pid] = {
                        key: value
                        for key, value in secrets.items()
                        if value
                    }

                if DEFAULT_PROFILE_ID not in self._profiles:
                    self._profiles[DEFAULT_PROFILE_ID] = self._sanitize_profile(DEFAULT_PROFILE_DATA)
                if DEFAULT_PROFILE_ID not in self._secret_overrides:
                    self._secret_overrides[DEFAULT_PROFILE_ID] = {}
                if self._active_profile_id not in self._profiles:
                    self._active_profile_id = DEFAULT_PROFILE_ID

        except Exception as e:
            print(f"[ConfigManager] 无法读取 config.json: {e}")
            return

        self._hydrate_active_profile_secrets_from_env()

        if needs_resave:
            self.save()

    def _sync_from_legacy_env(self) -> None:
        """从 .env 初始化默认 Profile。"""
        new_data = DEFAULT_PROFILE_DATA.copy()
        runtime_secrets: dict[str, str] = {}

        for key in new_data:
            if key == "name":
                continue
            env_val = os.getenv(key)
            if env_val is None:
                continue
            if key in SECRET_KEYS:
                runtime_secrets[key] = env_val
                continue
            if isinstance(new_data[key], bool):
                new_data[key] = env_val.lower() in ("true", "1", "yes")
            else:
                new_data[key] = env_val

        self._profiles[DEFAULT_PROFILE_ID] = self._sanitize_profile(new_data)
        self._secret_overrides[DEFAULT_PROFILE_ID] = {
            key: value
            for key, value in runtime_secrets.items()
            if value
        }
        self.save()

    def _apply_to_env(self) -> None:
        """将当前激活方案应用到环境变量。"""
        profile = self.get_active_config(mask_secrets=False)
        for key in PROFILE_ALLOWED_KEYS | SECRET_KEYS:
            if key == "name":
                continue
            value = profile.get(key, "")
            if key == "OPENAI_MODEL":
                os.environ["OPENAI_ANALYSIS_MODEL"] = str(value)
                os.environ["OPENAI_ORGANIZER_MODEL"] = str(value)
            os.environ[key] = str(value)

    def get_active_config(self, mask_secrets: bool = True) -> dict[str, Any]:
        profile = self._get_persisted_profile(self._active_profile_id)
        for key in SECRET_KEYS:
            profile[key] = self._get_runtime_secret(self._active_profile_id, key)
        if mask_secrets:
            for key in SECRET_KEYS:
                val = profile.get(key, "")
                if val and len(val) > 8:
                    profile[key] = f"{val[:4]}...{val[-4:]}"
                elif val:
                    profile[key] = "********"
        return profile

    def get_active_id(self) -> str:
        return self._active_profile_id

    def list_profiles(self) -> list[dict[str, Any]]:
        return [{"id": pid, "name": pdata["name"]} for pid, pdata in self._profiles.items()]

    def switch_profile(self, profile_id: str) -> None:
        if profile_id in self._profiles:
            self._active_profile_id = profile_id
            self._apply_to_env()
            self.save()

    def update_active_profile(self, patch: dict[str, Any]) -> None:
        profile = self._profiles[self._active_profile_id].copy()
        next_secrets = self._secret_overrides.get(self._active_profile_id, {}).copy()
        profile_patch: dict[str, Any] = {}

        for key, value in patch.items():
            if key in SECRET_KEYS:
                if value == "":
                    next_secrets[key] = ""
                elif value and not self._is_masked_secret(value):
                    next_secrets[key] = str(value)
                continue
            if key in PROFILE_ALLOWED_KEYS:
                profile_patch[key] = value

        profile.update(profile_patch)
        self._profiles[self._active_profile_id] = self._sanitize_profile(profile)
        self._secret_overrides[self._active_profile_id] = next_secrets
        self._apply_to_env()
        self.save()

    def add_profile(self, name: str, copy_from_active: bool = True) -> str:
        new_id = str(uuid.uuid4())[:8]
        if copy_from_active:
            new_data = self.get_active_config(mask_secrets=False)
        else:
            new_data = DEFAULT_PROFILE_DATA.copy()

        new_data["name"] = name
        self._profiles[new_id] = self._sanitize_profile(new_data)
        self._secret_overrides[new_id] = {
            key: value
            for key, value in self._extract_secrets(new_data).items()
            if value
        }
        self.save()
        return new_id

    def delete_profile(self, profile_id: str) -> None:
        if profile_id != DEFAULT_PROFILE_ID and profile_id in self._profiles:
            if self._active_profile_id == profile_id:
                self._active_profile_id = DEFAULT_PROFILE_ID
            self._profiles.pop(profile_id)
            self._secret_overrides.pop(profile_id, None)
            self._apply_to_env()
            self.save()

    def save(self) -> None:
        data = {
            "active_profile_id": self._active_profile_id,
            "profiles": {pid: self._sanitize_profile(profile) for pid, profile in self._profiles.items()}
        }
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def get(self, key: str, default: Any = None) -> Any:
        profile = self.get_active_config(mask_secrets=False)
        return profile.get(key, default)


# 单例
config_manager = ConfigManager()
