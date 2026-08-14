"""设置/模型连接测试相关的辅助逻辑。

供 settings 路由与 utils 路由（遗留 /api/utils/test-llm）共用。
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from file_pilot.analysis.vision_runtime import (
    VISION_TEST_EXPECTED_TEXT,
    VISION_TEST_IMAGE_BYTES,
    VISION_TEST_IMAGE_DATA_URL,
    VISION_TEST_IMAGE_MIME_TYPE,
    build_registered_vision_image_url,
    build_vision_request_debug_payload,
    build_vision_request_kwargs,
    coerce_response_message,
    extract_message_text,
    register_vision_image_bytes,
    should_retry_with_http_image_url,
)
from file_pilot.api.payloads import SettingsModelsPayload, SettingsSecretPayload, SettingsTestPayload
from file_pilot.shared.config import SPOOF_HEADERS
from file_pilot.shared.logging_utils import append_debug_event

logger = logging.getLogger(__name__)


def is_masked_secret(value: Any) -> bool:
    return isinstance(value, str) and value and (value == "********" or "..." in value)


def describe_base_url_hint(base_url: str, *, image_generation: bool = False) -> str | None:
    normalized = str(base_url or "").strip().rstrip("/")
    if not normalized:
        return None
    if normalized.endswith("/v1"):
        return None
    if re.search(r"/chat/completions/?$", normalized):
        return None
    if image_generation and re.search(r"/images/generations/?$", normalized):
        return None
    return "接口地址通常需要带上 /v1 后缀；若服务商文档要求完整端点，也可以直接填写它给出的 /chat/completions 或 /images/generations 地址。"


def normalize_image_generation_probe_url(base_url: str) -> str:
    normalized = str(base_url or "").strip()
    if not normalized:
        return ""
    if normalized.endswith("/images/generations"):
        return normalized
    if normalized.endswith("/v1"):
        return f"{normalized}/images/generations"
    if "/v1/" in normalized or normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized.rstrip('/')}/v1/images/generations"


def _iter_exception_chain(exc: Exception):
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = current.__cause__ or current.__context__


def _collect_exception_text(exc: Exception) -> str:
    parts: list[str] = []
    for item in _iter_exception_chain(exc):
        text = str(item or "").strip()
        if text:
            parts.append(text)
    return " | ".join(parts).lower()


def classify_test_error(exc: Exception) -> tuple[str, str]:
    status_code = getattr(exc, "status_code", None)
    if status_code is None:
        response = getattr(exc, "response", None)
        status_code = getattr(response, "status_code", None)
    message = _collect_exception_text(exc)
    if status_code is None:
        if "接口请求失败: 401" in str(exc):
            status_code = 401
        elif "接口请求失败: 403" in str(exc):
            status_code = 403
        elif "接口请求失败: 404" in str(exc):
            status_code = 404
        elif "接口请求失败: 429" in str(exc):
            status_code = 429
    if status_code == 401:
        return "401", "认证失败，请检查 API 密钥是否正确。"
    if status_code == 403:
        return "403", "请求被拒绝，请检查账号权限或服务商访问策略。"
    if status_code == 404:
        return "404", "接口或模型不存在，请检查 Base URL、端点和模型 ID。"
    if status_code in {400, 422}:
        if "image" in message or "vision" in message:
            return "capability_mismatch", "当前接口或模型不支持所需的多模态或图像能力。"
        return "unknown", "请求被服务端拒绝，请检查模型 ID、请求格式和服务商兼容性。"
    if status_code == 429:
        return "429", "请求已被限流，请稍后再试。"
    if "10013" in message or "access permissions" in message or "访问权限不允许" in message or "套接字" in message:
        return "network_blocked", "本机网络层阻止了这次连接请求，请检查系统防火墙、安全软件、代理或 TUN/分流规则。"
    if "timeout" in message or "超时" in str(exc):
        if "modelscope" in message or "modelscope" in str(exc).lower():
            return "timeout", "图像生成任务等待超时，服务可能正在排队或当前模型响应较慢，请稍后重试。"
        return "timeout", "连接超时，请检查网络或服务响应速度。"
    if "connection" in message or "dns" in message or "name or service" in message:
        return "network", "无法连接到模型服务，请检查 Base URL 和网络。"
    if "data url" in message or "base64" in message or "invalid image" in message or "image data" in message:
        return "vision_image_format_rejected", "接口已响应，但当前服务商不接受这次测试使用的图片传入格式。"
    if "image_url" in message or "vision" in message or "multimodal" in message or "content type" in message:
        return "capability_mismatch", "当前接口或模型不支持图片理解能力。"
    if "model" in message and ("not found" in message or "does not exist" in message or "invalid" in message):
        return "model_not_found", "模型 ID 不存在或当前账号不可用。"
    return "unknown", "连接测试失败，请检查配置与网络状态。"


def coerce_secret_payload(payload: SettingsSecretPayload | dict[str, Any] | None) -> dict[str, Any]:
    if payload is None:
        return {"action": "keep"}
    if isinstance(payload, SettingsSecretPayload):
        return payload.model_dump()
    return dict(payload)


def legacy_secret_action(value: Any) -> SettingsSecretPayload:
    if value == "":
        return SettingsSecretPayload(action="clear", value="")
    if value and not is_masked_secret(value):
        return SettingsSecretPayload(action="replace", value=str(value))
    return SettingsSecretPayload(action="keep")


def build_text_test_runtime(payload: SettingsTestPayload, settings_service) -> dict[str, Any]:
    runtime = settings_service.get_runtime_family_config("text")
    preset = dict(payload.preset or {})
    runtime["base_url"] = str(preset.get("OPENAI_BASE_URL", runtime["base_url"]) or "").strip()
    runtime["model"] = str(preset.get("OPENAI_MODEL", runtime["model"]) or "").strip()
    runtime["name"] = str(preset.get("name", runtime["name"]) or "").strip()
    secret_payload = coerce_secret_payload(payload.secret)
    runtime["api_key"] = settings_service._apply_secret_action(runtime["api_key"], secret_payload)
    return runtime


def build_vision_test_runtime(payload: SettingsTestPayload, settings_service) -> dict[str, Any]:
    mode = settings_service._sanitize_vision_mode(payload.mode or settings_service.get_runtime_family_config("vision").get("mode"))
    runtime = settings_service.get_runtime_family_config("vision")
    preset = dict(payload.preset or {})
    runtime["mode"] = mode
    if mode == "shared_text":
        runtime["base_url"] = str(preset.get("OPENAI_BASE_URL", runtime["base_url"]) or "").strip()
        runtime["model"] = str(preset.get("OPENAI_MODEL", runtime["model"]) or "").strip()
        runtime["name"] = str(preset.get("name", runtime["name"]) or "").strip()
    else:
        runtime["base_url"] = str(preset.get("IMAGE_ANALYSIS_BASE_URL", runtime["base_url"]) or "").strip()
        runtime["model"] = str(preset.get("IMAGE_ANALYSIS_MODEL", runtime["model"]) or "").strip()
        runtime["name"] = str(
            preset.get("IMAGE_ANALYSIS_NAME", preset.get("name", runtime["name"])) or ""
        ).strip()
    secret_payload = coerce_secret_payload(payload.secret)
    runtime["api_key"] = settings_service._apply_secret_action(runtime["api_key"], secret_payload)
    return runtime


def build_icon_image_test_runtime(payload: SettingsTestPayload, settings_service) -> dict[str, Any]:
    runtime = settings_service.get_runtime_family_config("icon_image")
    preset = dict(payload.preset or {})
    image_model = {
        **dict(runtime.get("image_model") or {}),
        **dict(preset.get("image_model") or {}),
    }
    secret_payload = coerce_secret_payload(payload.secret)
    image_model["api_key"] = settings_service._apply_secret_action(
        str(image_model.get("api_key", "") or ""),
        secret_payload,
    )
    runtime["name"] = str(preset.get("name", runtime.get("name", "")) or "").strip()
    runtime["image_model"] = image_model
    runtime["image_size"] = str(preset.get("image_size", runtime.get("image_size", "1024x1024")) or "1024x1024").strip()
    legacy_limit = int(preset.get("concurrency_limit", runtime.get("image_concurrency_limit", 1)) or 1)
    runtime["analysis_concurrency_limit"] = int(
        preset.get("analysis_concurrency_limit", runtime.get("analysis_concurrency_limit", legacy_limit)) or 1
    )
    runtime["image_concurrency_limit"] = int(
        preset.get("image_concurrency_limit", runtime.get("image_concurrency_limit", legacy_limit)) or 1
    )
    runtime["save_mode"] = str(preset.get("save_mode", runtime.get("save_mode", "centralized")) or "centralized")
    return runtime


def build_settings_models_runtime(payload: SettingsModelsPayload, settings_service) -> dict[str, str]:
    test_payload = SettingsTestPayload(
        family=payload.family,
        preset=payload.preset,
        secret=payload.secret,
        mode=payload.mode,
    )
    family = str(payload.family or "").strip()
    if family == "text":
        runtime = build_text_test_runtime(test_payload, settings_service)
        return {
            "family": family,
            "base_url": str(runtime.get("base_url") or "").strip(),
            "api_key": str(runtime.get("api_key") or "").strip(),
        }
    if family == "vision":
        runtime = build_vision_test_runtime(test_payload, settings_service)
        return {
            "family": family,
            "base_url": str(runtime.get("base_url") or "").strip(),
            "api_key": str(runtime.get("api_key") or "").strip(),
        }
    if family == "icon_image":
        runtime = build_icon_image_test_runtime(test_payload, settings_service)
        image_model = dict(runtime.get("image_model") or {})
        return {
            "family": family,
            "base_url": str(image_model.get("base_url") or "").strip(),
            "api_key": str(image_model.get("api_key") or "").strip(),
        }
    return {"family": family, "base_url": "", "api_key": ""}


def normalize_models_base_url(base_url: str) -> str:
    value = str(base_url or "").strip().rstrip("/")
    for suffix in ("/chat/completions", "/images/generations", "/responses", "/models"):
        if value.lower().endswith(suffix):
            return value[: -len(suffix)] or value
    return value


def extract_model_items(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    if data is None and isinstance(response, dict):
        data = response.get("data")
    models: list[dict[str, Any]] = []
    for item in data or []:
        model_id = getattr(item, "id", None)
        created = getattr(item, "created", None)
        owned_by = getattr(item, "owned_by", None)
        if isinstance(item, dict):
            model_id = item.get("id", model_id)
            created = item.get("created", created)
            owned_by = item.get("owned_by", owned_by)
        model_id = str(model_id or "").strip()
        if not model_id:
            continue
        models.append(
            {
                "id": model_id,
                "created": created,
                "owned_by": str(owned_by or "").strip() or None,
            }
        )
    return sorted(models, key=lambda item: item["id"].lower())


def _strip_json_code_fence(value: str) -> str:
    text = str(value or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _extract_vision_test_seen_text(response: Any) -> str:
    message = coerce_response_message(response)
    text = _strip_json_code_fence(extract_message_text(getattr(message, "content", "")))
    if not text:
        return ""
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(parsed, dict):
        return str(parsed.get("seen_text") or "").strip()
    return ""


def _normalize_vision_test_text(value: str) -> str:
    return re.sub(r"[^0-9A-Z]+", "", str(value or "").upper())


def probe_image_generation_endpoint(base_url: str, model: str, api_key: str) -> None:
    import json as json_module
    from urllib import error as urllib_error
    from urllib import request as urllib_request

    url = normalize_image_generation_probe_url(base_url)
    payload = {
        "model": model,
    }
    request = urllib_request.Request(
        url=url,
        data=json_module.dumps(payload).encode("utf-8"),
        headers={
            **SPOOF_HEADERS,
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib_request.urlopen(request, timeout=20):
            return
    except urllib_error.HTTPError as exc:
        if exc.code == 400:
            return
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"接口请求失败: {exc.code} {body}") from exc


def execute_settings_test(payload: SettingsTestPayload, request: Request | None = None):
    from openai import OpenAI

    from file_pilot.shared.config_manager import config_manager

    settings_service = config_manager.service
    family = str(payload.family or "").strip()
    try:
        if family == "text":
            runtime = build_text_test_runtime(payload, settings_service)
            if not runtime["base_url"] or not runtime["model"] or not runtime["api_key"]:
                hint = describe_base_url_hint(runtime["base_url"])
                return JSONResponse(
                    status_code=400,
                    content={
                        "status": "error",
                        "family": family,
                        "code": "incomplete_config",
                        "message": "文本模型配置不完整，请补全接口地址、模型 ID 和 API 密钥。" + (f" {hint}" if hint else ""),
                    },
                )
            client = OpenAI(api_key=runtime["api_key"], base_url=runtime["base_url"], default_headers=SPOOF_HEADERS)
            client.chat.completions.create(
                model=runtime["model"],
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1,
            )
            return {"status": "ok", "family": family, "code": "ok", "message": "文本模型连接测试已通过。"}

        if family == "vision":
            runtime = build_vision_test_runtime(payload, settings_service)
            if not runtime["base_url"] or not runtime["model"] or not runtime["api_key"]:
                hint = describe_base_url_hint(runtime["base_url"])
                return JSONResponse(
                    status_code=400,
                    content={
                        "status": "error",
                        "family": family,
                        "code": "incomplete_config",
                        "message": "图片理解模型配置不完整，请补全接口地址、模型 ID 和 API 密钥。" + (f" {hint}" if hint else ""),
                    },
                )
            debug_payload = build_vision_request_debug_payload(
                model=str(runtime["model"]),
                base_url=str(runtime["base_url"]),
                prompt_mode="test",
                mime_type=VISION_TEST_IMAGE_MIME_TYPE,
                image_bytes=len(VISION_TEST_IMAGE_BYTES),
                data_url_length=len(VISION_TEST_IMAGE_DATA_URL),
            )
            append_debug_event(
                kind="settings.vision_test.started",
                stage="settings",
                payload=debug_payload,
            )
            started_at = time.perf_counter()
            client = OpenAI(api_key=runtime["api_key"], base_url=runtime["base_url"], default_headers=SPOOF_HEADERS)
            system_prompt = (
                "你正在进行图片理解能力验证。"
                "请严格返回 JSON，不要输出任何额外说明。"
                '格式固定为 {"seen_text":"..."}。'
            )
            user_prompt = "请读取图片中最显眼的文本，并按 JSON 返回。"
            try:
                response = client.chat.completions.create(
                    **build_vision_request_kwargs(
                        model=str(runtime["model"]),
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        image_url=VISION_TEST_IMAGE_DATA_URL,
                    )
                )
            except Exception as exc:
                if not should_retry_with_http_image_url(exc, base_url=str(runtime["base_url"])):
                    raise
                http_url = build_registered_vision_image_url(
                    register_vision_image_bytes(VISION_TEST_IMAGE_BYTES, VISION_TEST_IMAGE_MIME_TYPE),
                    base_url=str(request.base_url) if request is not None else None,
                )
                retry_debug_payload = build_vision_request_debug_payload(
                    model=str(runtime["model"]),
                    base_url=str(runtime["base_url"]),
                    prompt_mode="test",
                    mime_type=VISION_TEST_IMAGE_MIME_TYPE,
                    image_bytes=len(VISION_TEST_IMAGE_BYTES),
                    data_url_length=0,
                    image_source_type="http_url",
                )
                append_debug_event(
                    kind="settings.vision_test.retry_http_image_url",
                    level="WARNING",
                    stage="settings",
                    payload={**retry_debug_payload, "reason": "data_url_rejected", "error": exc},
                )
                response = client.chat.completions.create(
                    **build_vision_request_kwargs(
                        model=str(runtime["model"]),
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        image_url=http_url,
                    )
                )
                debug_payload = retry_debug_payload
            actual_text = _extract_vision_test_seen_text(response)
            duration_ms = round((time.perf_counter() - started_at) * 1000)
            if _normalize_vision_test_text(actual_text) == _normalize_vision_test_text(VISION_TEST_EXPECTED_TEXT):
                append_debug_event(
                    kind="settings.vision_test.completed",
                    stage="settings",
                    payload={
                        **debug_payload,
                        "duration_ms": duration_ms,
                        "verification_expected": VISION_TEST_EXPECTED_TEXT,
                        "verification_actual": actual_text,
                    },
                )
                return {
                    "status": "ok",
                    "family": family,
                    "code": "ok",
                    "message": f'已验证模型能够识别测试图中的 "{VISION_TEST_EXPECTED_TEXT}"。',
                    "details": {
                        "verification_type": "vision_text",
                        "expected": VISION_TEST_EXPECTED_TEXT,
                        "actual": actual_text,
                    },
                }
            append_debug_event(
                kind="settings.vision_test.failed",
                level="WARNING",
                stage="settings",
                payload={
                    **debug_payload,
                    "duration_ms": duration_ms,
                    "verification_expected": VISION_TEST_EXPECTED_TEXT,
                    "verification_actual": actual_text,
                    "reason": "vision_not_verified",
                },
            )
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "family": family,
                    "code": "vision_not_verified",
                    "message": "接口可达，但未验证到真实看图能力。",
                    "details": {
                        "verification_type": "vision_text",
                        "expected": VISION_TEST_EXPECTED_TEXT,
                        "actual": actual_text,
                    },
                },
            )

        if family == "icon_image":
            runtime = build_icon_image_test_runtime(payload, settings_service)
            image_model = dict(runtime.get("image_model") or {})
            if not image_model.get("base_url") or not image_model.get("model") or not image_model.get("api_key"):
                hint = describe_base_url_hint(str(image_model.get("base_url") or ""), image_generation=True)
                return JSONResponse(
                    status_code=400,
                    content={
                        "status": "error",
                        "family": family,
                        "code": "incomplete_config",
                        "message": "图像生成模型配置不完整，请补全接口地址、模型 ID 和 API 密钥。" + (f" {hint}" if hint else ""),
                    },
                )
            probe_image_generation_endpoint(
                str(image_model.get("base_url") or ""),
                str(image_model.get("model") or ""),
                str(image_model.get("api_key") or ""),
            )
            return {
                "status": "ok",
                "family": family,
                "code": "ok",
                "message": "图像端点连通性测试已通过。",
            }

        return JSONResponse(status_code=400, content={"status": "error", "family": family, "code": "invalid_family", "message": "不支持的测试类型。"})
    except Exception as exc:
        logger.exception("设置连接测试失败", extra={"family": family})
        if family == "vision":
            append_debug_event(
                kind="settings.vision_test.failed",
                level="ERROR",
                stage="settings",
                payload={"error": exc},
            )
        code, message = classify_test_error(exc)
        return JSONResponse(
            status_code=400,
            content={"status": "error", "family": family, "code": code, "message": message},
        )
