from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

from file_pilot.analysis.vision_runtime import (
    build_registered_vision_image_url,
    build_data_url_from_path,
    build_vision_request_debug_payload,
    build_vision_request_kwargs,
    coerce_response_message,
    extract_message_text,
    register_vision_image_file,
    should_retry_with_http_image_url,
)
from file_pilot.shared.config import create_image_analysis_client, get_image_analysis_settings
from file_pilot.shared.logging_utils import append_debug_event

SYSTEM_PROMPT = (
    "你是文件扫描阶段的图片观察专家。你的职责是提取图片中可观察的关键信息，帮助理解图片用途。"
    "请使用固定字段、简洁中文输出。"
)
USER_PROMPT = (
    "请分析这张图片，并按以下字段输出：\n"
    "图片类型：例如截图，照片，扫描件，图表，插画，设计稿，漫画，表情包等等，如果无法判断就写“无法判断”\n"
    "主体内容：一句话描述图中主体\n"
    "可读文字：列出图中清晰可读的关键文字；如果没有或看不清，写“未识别到清晰文字”\n"
    "关键线索：列出对判断文件用途有帮助的可见线索\n"
    "用途画像：一句话说明这张图片在文件整理中可能代表的用途或材料属性\n"
    "限制：列出无法确认但容易被误猜的信息；没有则写“无”"
)


@dataclass
class ImageDescriptionResult:
    status: str
    summary: str = ""
    error_code: str = ""
    error_message: str = ""


def format_image_description_result(result: ImageDescriptionResult) -> str:
    lines = ["--- 图片识别结果开始 ---", f"status: {result.status}"]
    if result.status == "ok":
        lines.append(f"summary: {result.summary}")
    else:
        lines.append(f"error_code: {result.error_code or 'vision_request_failed'}")
        lines.append(f"error_message: {result.error_message or '图片识别失败'}")
    lines.append("--- 图片识别结果结束 ---")
    return "\n".join(lines)


def describe_image(path: str | Path) -> ImageDescriptionResult:
    image_path = Path(path)
    settings = get_image_analysis_settings()
    if not settings.get("enabled"):
        append_debug_event(
            kind="analysis.vision.skipped_disabled",
            stage="scanning",
            target_dir=str(image_path.parent),
            payload={
                "image_path": str(image_path),
                "reason": "vision_disabled",
            },
        )
        return ImageDescriptionResult(
            status="disabled",
            error_code="vision_disabled",
            error_message="未启用图片分析配置。",
        )

    data_url, mime_type, image_bytes = build_data_url_from_path(image_path)
    debug_payload = build_vision_request_debug_payload(
        model=str(settings.get("model") or ""),
        base_url=str(settings.get("base_url") or ""),
        prompt_mode="runtime",
        mime_type=mime_type,
        image_bytes=image_bytes,
        data_url_length=len(data_url),
    )
    started_at = time.perf_counter()
    append_debug_event(
        kind="analysis.vision.request_started",
        stage="scanning",
        target_dir=str(image_path.parent),
        payload={
            "image_path": str(image_path),
            **debug_payload,
        },
    )
    try:
        client = create_image_analysis_client()
        try:
            response = client.chat.completions.create(
                **build_vision_request_kwargs(
                    model=str(settings["model"]),
                    system_prompt=SYSTEM_PROMPT,
                    user_prompt=USER_PROMPT,
                    image_url=data_url,
                )
            )
        except Exception as exc:
            if not should_retry_with_http_image_url(exc, base_url=str(settings.get("base_url") or "")):
                raise
            http_url = build_registered_vision_image_url(register_vision_image_file(image_path, mime_type))
            retry_debug_payload = build_vision_request_debug_payload(
                model=str(settings.get("model") or ""),
                base_url=str(settings.get("base_url") or ""),
                prompt_mode="runtime",
                mime_type=mime_type,
                image_bytes=image_bytes,
                data_url_length=0,
                image_source_type="http_url",
            )
            append_debug_event(
                kind="analysis.vision.retry_http_image_url",
                level="WARNING",
                stage="scanning",
                target_dir=str(image_path.parent),
                payload={
                    "image_path": str(image_path),
                    **retry_debug_payload,
                    "reason": "data_url_rejected",
                    "error": exc,
                },
            )
            response = client.chat.completions.create(
                **build_vision_request_kwargs(
                    model=str(settings["model"]),
                    system_prompt=SYSTEM_PROMPT,
                    user_prompt=USER_PROMPT,
                    image_url=http_url,
                )
            )
            debug_payload = retry_debug_payload
        message = coerce_response_message(response)
        summary = extract_message_text(getattr(message, "content", ""))
        duration_ms = round((time.perf_counter() - started_at) * 1000)
        if not summary:
            append_debug_event(
                kind="analysis.vision.request_failed",
                level="WARNING",
                stage="scanning",
                target_dir=str(image_path.parent),
                payload={
                    "image_path": str(image_path),
                    **debug_payload,
                    "duration_ms": duration_ms,
                    "reason": "empty_response",
                },
            )
            return ImageDescriptionResult(
                status="failed",
                error_code="vision_empty_response",
                error_message="图片分析响应为空。",
            )
        append_debug_event(
            kind="analysis.vision.request_completed",
            stage="scanning",
            target_dir=str(image_path.parent),
            payload={
                "image_path": str(image_path),
                **debug_payload,
                "duration_ms": duration_ms,
                "summary_preview": summary[:80],
            },
        )
        return ImageDescriptionResult(status="ok", summary=summary)
    except Exception as exc:
        duration_ms = round((time.perf_counter() - started_at) * 1000)
        append_debug_event(
            kind="analysis.vision.request_failed",
            level="ERROR",
            stage="scanning",
            target_dir=str(image_path.parent),
            payload={
                "image_path": str(image_path),
                **debug_payload,
                "duration_ms": duration_ms,
                "error": exc,
            },
        )
        message = str(exc).strip() or "图片分析请求失败。"
        error_code = "vision_request_failed"
        if "IMAGE_ANALYSIS_BASE_URL" in message:
            error_code = "vision_missing_base_url"
        elif "IMAGE_ANALYSIS_API_KEY" in message:
            error_code = "vision_missing_api_key"
        elif "IMAGE_ANALYSIS_MODEL" in message:
            error_code = "vision_missing_model"
        return ImageDescriptionResult(
            status="failed",
            error_code=error_code,
            error_message=message,
        )
