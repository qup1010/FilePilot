from __future__ import annotations

import base64
import json
import mimetypes
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from file_organizer.shared.config import create_image_analysis_client, get_image_analysis_settings

SYSTEM_PROMPT = "你是一个图片分析专家。请只返回一句简短自然语言摘要，用于概括图片的大概内容，不要输出标签、列表或多段解释。"
USER_PROMPT = "请简要描述这张图片的主要内容。"


def _guess_mime_type(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "image/png"


def _build_data_url(path: Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{_guess_mime_type(path)};base64,{encoded}"


def _extract_message_text(message_content) -> str:
    if isinstance(message_content, str):
        return message_content.strip()
    if isinstance(message_content, list):
        parts = []
        for item in message_content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append((item.get("text") or "").strip())
        return " ".join(part for part in parts if part).strip()
    return ""


def _coerce_response_message(response: Any):
    if hasattr(response, "choices"):
        choices = getattr(response, "choices", None) or []
        if not choices:
            raise ValueError("图片分析响应缺少 choices")
        message = getattr(choices[0], "message", None)
        if message is None:
            raise ValueError("图片分析响应缺少 message")
        return SimpleNamespace(content=_extract_message_text(getattr(message, "content", "")))

    if isinstance(response, str):
        text = response.strip()
        if text and text[0] in "[{":
            try:
                return _coerce_response_message(json.loads(text))
            except json.JSONDecodeError:
                pass
        return SimpleNamespace(content=text)

    if isinstance(response, dict):
        choices = response.get("choices") or []
        if not choices:
            raise ValueError("图片分析响应缺少 choices")
        message = choices[0].get("message") or {}
        return SimpleNamespace(content=_extract_message_text(message.get("content", "")))

    if hasattr(response, "model_dump"):
        try:
            return _coerce_response_message(response.model_dump())
        except Exception:
            pass

    raise TypeError(f"不支持的图片分析响应类型: {type(response).__name__}")


def describe_image(path: str | Path) -> str:
    image_path = Path(path)
    settings = get_image_analysis_settings()
    if not settings.get("enabled"):
        return "图片分析失败: 未启用图片分析配置。"

    try:
        client = create_image_analysis_client()
        response = client.chat.completions.create(
            model=settings["model"],
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": USER_PROMPT},
                        {"type": "image_url", "image_url": {"url": _build_data_url(image_path)}},
                    ],
                },
            ],
        )
        message = _coerce_response_message(response)
        summary = _extract_message_text(getattr(message, "content", ""))
        if not summary:
            return "图片分析失败: 图片分析响应为空。"
        return summary
    except Exception as exc:
        return f"图片分析失败: {exc}"
