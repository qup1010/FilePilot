"""设置中心路由。"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from file_pilot.api.payloads import (
    SettingsModelsPayload,
    SettingsPresetCreatePayload,
    SettingsTestPayload,
    SettingsUpdatePayload,
)
from file_pilot.api.settings_support import (
    build_settings_models_runtime,
    classify_test_error,
    coerce_secret_payload,
    describe_base_url_hint,
    execute_settings_test,
    extract_model_items,
    logger,
    normalize_models_base_url,
)
from file_pilot.shared.config import SPOOF_HEADERS

router = APIRouter(prefix="/api/settings")


def _settings_value_error_response(exc: ValueError, *, status_code: int = 400) -> JSONResponse | None:
    message = str(exc)
    error_codes = {
        "UI_LANGUAGE_INVALID": "UI_LANGUAGE_INVALID",
        "不支持的设置族": "SETTINGS_FAMILY_INVALID",
        "不支持的密钥操作": "SETTINGS_SECRET_ACTION_INVALID",
        "不支持的预设类型": "SETTINGS_PRESET_TYPE_INVALID",
        "文本预设不存在": "SETTINGS_PRESET_NOT_FOUND",
        "图片预设不存在": "SETTINGS_PRESET_NOT_FOUND",
        "图标生图预设不存在": "SETTINGS_PRESET_NOT_FOUND",
    }
    error_code = error_codes.get(message)
    if not error_code:
        return None
    if error_code == "UI_LANGUAGE_INVALID":
        status_code = 422
    return JSONResponse(status_code=status_code, content={"error_code": error_code})


@router.get("")
def get_settings():
    from file_pilot.shared.config_manager import config_manager
    return config_manager.service.get_settings_snapshot()


@router.get("/runtime/{family}")
def get_settings_runtime_family(family: str):
    from file_pilot.shared.config_manager import config_manager
    try:
        return config_manager.service.get_runtime_family_config(family)
    except ValueError as exc:
        response = _settings_value_error_response(exc)
        if response is not None:
            return response
        raise


@router.patch("")
def update_settings(payload: SettingsUpdatePayload):
    from file_pilot.shared.config_manager import config_manager
    try:
        return config_manager.service.update_settings(payload.model_dump(exclude_none=True))
    except ValueError as exc:
        response = _settings_value_error_response(exc)
        if response is not None:
            return response
        raise


@router.post("/presets/{family}")
def add_settings_preset(family: str, payload: SettingsPresetCreatePayload):
    from file_pilot.shared.config_manager import config_manager
    try:
        new_id = config_manager.service.add_preset(
            family,
            payload.name,
            copy_from_active=payload.copy_from_active,
            preset_patch=payload.preset,
            secret_payload=coerce_secret_payload(payload.secret),
        )
    except ValueError as exc:
        response = _settings_value_error_response(exc)
        if response is not None:
            return response
        raise
    return {"status": "ok", "id": new_id}


@router.post("/presets/{family}/{preset_id}/activate")
def activate_settings_preset(family: str, preset_id: str):
    from file_pilot.shared.config_manager import config_manager
    try:
        config_manager.service.activate_preset(family, preset_id)
    except ValueError as exc:
        response = _settings_value_error_response(exc)
        if response is not None:
            return response
        raise
    return {"status": "ok"}


@router.delete("/presets/{family}/{preset_id}")
def delete_settings_preset(family: str, preset_id: str):
    from file_pilot.shared.config_manager import config_manager
    try:
        config_manager.service.delete_preset(family, preset_id)
    except ValueError as exc:
        response = _settings_value_error_response(exc)
        if response is not None:
            return response
        raise
    return {"status": "ok"}


@router.post("/test")
def test_settings(payload: SettingsTestPayload, request: Request):
    return execute_settings_test(payload, request=request)


@router.post("/models")
def list_settings_models(payload: SettingsModelsPayload):
    from openai import OpenAI

    from file_pilot.shared.config_manager import config_manager

    family = str(payload.family or "").strip()
    try:
        runtime = build_settings_models_runtime(payload, config_manager.service)
        if family not in {"text", "vision", "icon_image"}:
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "family": family,
                    "code": "invalid_family",
                    "message": "不支持从该设置分类获取模型列表。",
                    "models": [],
                },
            )
        if not runtime["base_url"] or not runtime["api_key"]:
            hint = describe_base_url_hint(runtime["base_url"])
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "family": family,
                    "code": "incomplete_config",
                    "message": "请先补全接口地址和 API 密钥，再从端点获取模型列表。" + (f" {hint}" if hint else ""),
                    "models": [],
                },
            )

        client = OpenAI(
            api_key=runtime["api_key"],
            base_url=normalize_models_base_url(runtime["base_url"]),
            default_headers=SPOOF_HEADERS,
        )
        return {
            "status": "ok",
            "family": family,
            "models": extract_model_items(client.models.list()),
        }
    except Exception as exc:
        logger.exception("设置模型列表获取失败", extra={"family": family})
        code, message = classify_test_error(exc)
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "family": family,
                "code": code,
                "message": message,
                "models": [],
            },
        )
