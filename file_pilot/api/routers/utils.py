"""系统工具与遗留配置路由。"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException

from file_pilot.api.payloads import (
    AddPresetPayload,
    ConfigSecretsPayload,
    LlmTestPayload,
    OpenDirPayload,
    PresetSwitchPayload,
    SettingsTestPayload,
)
from file_pilot.api.settings_support import execute_settings_test, legacy_secret_action
from file_pilot.shared.path_utils import get_windows_shell_folder

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/utils")


@router.post("/open-dir")
def open_dir(payload: OpenDirPayload):
    path = payload.path
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=400, detail="INVALID_PATH")

    import subprocess
    try:
        subprocess.run(["explorer", os.path.abspath(path)], check=True)
        return {"status": "ok"}
    except Exception:
        logger.exception("打开目录失败", extra={"path": path})
        raise HTTPException(status_code=500, detail="OPEN_DIR_FAILED")


@router.post("/select-dir")
def select_dir():
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)

    directory = filedialog.askdirectory(title="选择要整理的文件夹")
    root.destroy()

    if directory:
        return {"path": os.path.abspath(directory)}
    return {"path": None}


@router.get("/common-dirs")
def common_dirs():
    home = Path.home()
    dirs = []
    # (标签, 逻辑名, 默认子目录名)
    targets = [
        ("下载", "Downloads", "Downloads"),
        ("桌面", "Desktop", "Desktop"),
        ("文档", "Documents", "Documents"),
        ("图片", "Pictures", "Pictures"),
        ("视频", "Videos", "Videos"),
        ("音乐", "Music", "Music"),
    ]

    for label, logic_name, default_name in targets:
        # 1. 尝试通过 Windows Shell API (注册表) 获取真实路径
        path_str = get_windows_shell_folder(logic_name)
        p = Path(path_str) if path_str else home / default_name

        if p.exists():
            dirs.append({"label": label, "path": str(p)})
    return dirs


@router.get("/config")
def get_config():
    from file_pilot.shared.config_manager import config_manager
    return config_manager.get_config_payload(mask_secrets=True)


@router.post("/config")
def update_config(payload: dict):
    from file_pilot.shared.config_manager import config_manager
    config_manager.update_active_profile(payload)
    return {"status": "ok"}


@router.post("/config/secrets")
def get_config_secrets(payload: ConfigSecretsPayload):
    del payload
    raise HTTPException(status_code=410, detail="CONFIG_SECRET_READ_DISABLED")


@router.post("/config/presets/switch")
def switch_config(payload: PresetSwitchPayload):
    from file_pilot.shared.config_manager import config_manager
    config_manager.switch_preset(payload.preset_type, payload.id)
    return {"status": "ok"}


@router.post("/config/presets")
def add_profile(payload: AddPresetPayload):
    from file_pilot.shared.config_manager import config_manager
    new_id = config_manager.add_preset(
        payload.preset_type,
        payload.name,
        copy_from_active=payload.copy_profile,
        config_patch=payload.config,
    )
    return {"status": "ok", "id": new_id}


@router.delete("/config/presets/{preset_type}/{preset_id}")
def delete_profile(preset_type: str, preset_id: str):
    from file_pilot.shared.config_manager import config_manager
    config_manager.delete_preset(preset_type, preset_id)
    return {"status": "ok"}


@router.post("/test-llm")
def test_llm(payload: LlmTestPayload):
    raw = payload.model_dump()
    test_type = str(raw.get("test_type") or "text")
    if test_type == "vision":
        mapped = SettingsTestPayload(
            family="vision",
            preset={
                "IMAGE_ANALYSIS_NAME": raw.get("IMAGE_ANALYSIS_NAME"),
                "IMAGE_ANALYSIS_BASE_URL": raw.get("IMAGE_ANALYSIS_BASE_URL"),
                "IMAGE_ANALYSIS_MODEL": raw.get("IMAGE_ANALYSIS_MODEL"),
            },
            secret=legacy_secret_action(raw.get("IMAGE_ANALYSIS_API_KEY")),
        )
        return execute_settings_test(mapped)
    if test_type == "icon_image":
        mapped = SettingsTestPayload(
            family="icon_image",
            preset={
                "image_model": {
                    "base_url": raw.get("ICON_IMAGE_BASE_URL"),
                    "model": raw.get("ICON_IMAGE_MODEL"),
                }
            },
            secret=legacy_secret_action(raw.get("ICON_IMAGE_API_KEY")),
        )
        return execute_settings_test(mapped)
    mapped = SettingsTestPayload(
        family="text",
        preset={
            "name": raw.get("name"),
            "OPENAI_BASE_URL": raw.get("OPENAI_BASE_URL"),
            "OPENAI_MODEL": raw.get("OPENAI_MODEL"),
        },
        secret=legacy_secret_action(raw.get("OPENAI_API_KEY")),
    )
    return execute_settings_test(mapped)
