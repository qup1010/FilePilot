from __future__ import annotations

from pathlib import Path
from typing import Any

from file_pilot.shared.settings_service import (
    DEFAULT_PRESET_ID,
    SETTINGS_FAMILIES,
    TEXT_FAMILY,
    VISION_FAMILY,
    SettingsService,
)
from file_pilot.shared.constants import PROJECT_ROOT

CONFIG_PATH = PROJECT_ROOT / "config.json"


def _is_masked_secret(value: Any) -> bool:
    return isinstance(value, str) and (value == "********" or "..." in value)


class ConfigManager:
    """旧配置管理入口的兼容包装层。"""

    def __init__(self):
        self._service = SettingsService(
            config_path=CONFIG_PATH,
            legacy_icon_config_path=CONFIG_PATH.parent / "output" / "icon_workbench" / "config.json",
        )

    @property
    def service(self) -> SettingsService:
        return self._service

    def get(self, key: str, default: Any = None) -> Any:
        return self._service.get(key, default)

    def save(self) -> None:
        self._service.save()

    def get_active_config(self, mask_secrets: bool = True) -> dict[str, Any]:
        return self._service.get_flat_active_config(mask_secrets=mask_secrets)

    def get_config_payload(self, mask_secrets: bool = True) -> dict[str, Any]:
        return self._service.get_legacy_config_payload(mask_secrets=mask_secrets)

    def get_secret_values(self, keys: list[str]) -> dict[str, str]:
        raise ValueError("已禁用明文密钥读取接口")

    def update_active_profile(self, patch: dict[str, Any]) -> None:
        self._service.update_from_legacy_flat_patch(patch)

    def switch_preset(self, preset_type: str, preset_id: str) -> None:
        self._service.activate_preset(preset_type, preset_id)

    def add_preset(
        self,
        preset_type: str,
        name: str,
        copy_from_active: bool = True,
        config_patch: dict[str, Any] | None = None,
    ) -> str:
        if preset_type not in {TEXT_FAMILY, VISION_FAMILY}:
            raise ValueError("请改用统一设置服务管理该预设类型")
        secret_payload = None
        if config_patch and preset_type == TEXT_FAMILY and "OPENAI_API_KEY" in config_patch:
            secret = config_patch.get("OPENAI_API_KEY")
            if secret == "":
                secret_payload = {"action": "clear"}
            elif secret and not _is_masked_secret(secret):
                secret_payload = {"action": "replace", "value": str(secret)}
        if config_patch and preset_type == VISION_FAMILY and "IMAGE_ANALYSIS_API_KEY" in config_patch:
            secret = config_patch.get("IMAGE_ANALYSIS_API_KEY")
            if secret == "":
                secret_payload = {"action": "clear"}
            elif secret and not _is_masked_secret(secret):
                secret_payload = {"action": "replace", "value": str(secret)}
        return self._service.add_preset(
            preset_type,
            name,
            copy_from_active=copy_from_active,
            preset_patch=config_patch,
            secret_payload=secret_payload,
        )

    def delete_preset(self, preset_type: str, preset_id: str) -> None:
        self._service.delete_preset(preset_type, preset_id)

    def get_active_id(self) -> str:
        return DEFAULT_PRESET_ID

    def list_profiles(self) -> list[dict[str, Any]]:
        return [{"id": DEFAULT_PRESET_ID, "name": "兼容模式"}]

    def list_presets(self, preset_type: str) -> list[dict[str, Any]]:
        if preset_type not in SETTINGS_FAMILIES:
            raise ValueError("不支持的预设类型")
        snapshot = self._service.get_settings_snapshot()
        family = snapshot["families"][preset_type]
        return [{"id": item["id"], "name": item["name"]} for item in family["presets"]]

    def switch_profile(self, profile_id: str) -> None:
        if profile_id != DEFAULT_PRESET_ID:
            raise ValueError("仅支持默认配置")

    def add_profile(self, name: str, copy_from_active: bool = True) -> str:
        raise ValueError("请改用独立的文本或图片预设")

    def delete_profile(self, profile_id: str) -> None:
        raise ValueError("请改用独立的文本或图片预设")


config_manager = ConfigManager()
