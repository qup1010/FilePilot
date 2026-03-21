import json
import os
import uuid
from pathlib import Path
from typing import Any

from file_organizer.shared.constants import (
    PROJECT_ROOT,
    DEFAULT_BASE_URL,
    DEFAULT_ANALYSIS_MODEL,
    DEFAULT_ORGANIZER_MODEL
)

CONFIG_PATH = PROJECT_ROOT / "config.json"

DEFAULT_PROFILE_ID = "default"

# 默认配置模板
DEFAULT_PROFILE_DATA = {
    "name": "默认配置",
    "OPENAI_API_KEY": "",
    "OPENAI_BASE_URL": DEFAULT_BASE_URL,
    "OPENAI_MODEL": DEFAULT_ANALYSIS_MODEL, # 统一模型字段
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
        self._profiles = {DEFAULT_PROFILE_ID: DEFAULT_PROFILE_DATA.copy()}
        self._load_from_file()
        self._apply_to_env()

    def _load_from_file(self) -> None:
        if not CONFIG_PATH.exists():
            # 尝试从老版本的环境变量同步一次
            self._sync_from_legacy_env()
            return

        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                self._active_profile_id = data.get("active_profile_id", DEFAULT_PROFILE_ID)
                self._profiles = data.get("profiles", {DEFAULT_PROFILE_ID: DEFAULT_PROFILE_DATA.copy()})
                
                # 兼容旧版本：如果没有模型合并字段，补充一下
                for pid in self._profiles:
                    profile = self._profiles[pid]
                    if "OPENAI_MODEL" not in profile:
                        profile["OPENAI_MODEL"] = profile.get("OPENAI_ANALYSIS_MODEL", DEFAULT_ANALYSIS_MODEL)
                    
        except Exception as e:
            print(f"[ConfigManager] 无法读取 config.json: {e}")

    def _sync_from_legacy_env(self) -> None:
        """从 .env 初始化默认 Profile。"""
        new_data = DEFAULT_PROFILE_DATA.copy()
        for key in new_data:
            if key == "name": continue
            env_val = os.getenv(key)
            if env_val is not None:
                if isinstance(new_data[key], bool):
                    new_data[key] = env_val.lower() in ("true", "1", "yes")
                else:
                    new_data[key] = env_val
        
        self._profiles[DEFAULT_PROFILE_ID] = new_data
        self.save()

    def _apply_to_env(self) -> None:
        """将当前激活方案应用到环境变量。"""
        profile = self.get_active_config(mask_secrets=False)
        for key, value in profile.items():
            if key == "name": continue
            # 特殊处理：将统一模型应用到具体的分析/重构变量，兼容旧代码
            if key == "OPENAI_MODEL":
                os.environ["OPENAI_ANALYSIS_MODEL"] = str(value)
                os.environ["OPENAI_ORGANIZER_MODEL"] = str(value)
            else:
                os.environ[key] = str(value)

    def get_active_config(self, mask_secrets: bool = True) -> dict[str, Any]:
        profile = self._profiles.get(self._active_profile_id, self._profiles[DEFAULT_PROFILE_ID]).copy()
        if mask_secrets:
            for key in ["OPENAI_API_KEY", "IMAGE_ANALYSIS_API_KEY"]:
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
        profile = self._profiles[self._active_profile_id]
        
        # 过滤脱敏 Key
        for key in ["OPENAI_API_KEY", "IMAGE_ANALYSIS_API_KEY"]:
            if key in patch and (not patch[key] or patch[key].startswith("sk-") and "..." in patch[key]):
                patch.pop(key)
                
        profile.update(patch)
        self._apply_to_env()
        self.save()

    def add_profile(self, name: str, copy_from_active: bool = True) -> str:
        new_id = str(uuid.uuid4())[:8]
        if copy_from_active:
            new_data = self.get_active_config(mask_secrets=False)
        else:
            new_data = DEFAULT_PROFILE_DATA.copy()
        
        new_data["name"] = name
        self._profiles[new_id] = new_data
        self.save()
        return new_id

    def delete_profile(self, profile_id: str) -> None:
        if profile_id != DEFAULT_PROFILE_ID and profile_id in self._profiles:
            if self._active_profile_id == profile_id:
                self._active_profile_id = DEFAULT_PROFILE_ID
            self._profiles.pop(profile_id)
            self._apply_to_env()
            self.save()

    def save(self) -> None:
        data = {
            "active_profile_id": self._active_profile_id,
            "profiles": self._profiles
        }
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def get(self, key: str, default: Any = None) -> Any:
        profile = self.get_active_config(mask_secrets=False)
        return profile.get(key, default)

# 单例
config_manager = ConfigManager()
