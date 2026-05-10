from __future__ import annotations

import base64
import io
import mimetypes
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.parse import urljoin, urlparse

from file_pilot.shared.model_response import (
    coerce_response_message as coerce_model_response_message,
    extract_message_text as extract_model_message_text,
)

VISION_TEST_EXPECTED_TEXT = "VISION TEST 42"
_FALLBACK_VISION_TEST_IMAGE_MIME_TYPE = "image/png"
_FALLBACK_VISION_TEST_IMAGE_BYTES = base64.b64decode(
    "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"
)
def _generate_vision_test_image_bytes() -> tuple[bytes, str]:
    try:
        from PIL import Image, ImageDraw, ImageFont

        image = Image.new("RGB", (720, 260), "white")
        draw = ImageDraw.Draw(image)
        font_path = next(
            (
                item
                for item in (
                    r"C:\Windows\Fonts\arialbd.ttf",
                    r"C:\Windows\Fonts\segoeuib.ttf",
                    r"C:\Windows\Fonts\arial.ttf",
                )
                if Path(item).exists()
            ),
            None,
        )
        font = ImageFont.truetype(font_path, 72) if font_path else ImageFont.load_default()
        text = VISION_TEST_EXPECTED_TEXT
        left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
        x = (image.width - (right - left)) // 2
        y = (image.height - (bottom - top)) // 2 - 6
        draw.rectangle((28, 28, image.width - 28, image.height - 28), outline=(20, 20, 20), width=6)
        draw.text((x, y), text, font=font, fill=(0, 0, 0))
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=92)
        return buffer.getvalue(), "image/jpeg"
    except Exception:
        return _FALLBACK_VISION_TEST_IMAGE_BYTES, _FALLBACK_VISION_TEST_IMAGE_MIME_TYPE


VISION_TEST_IMAGE_BYTES, VISION_TEST_IMAGE_MIME_TYPE = _generate_vision_test_image_bytes()
VISION_TEST_IMAGE_DATA_URL = f"data:{VISION_TEST_IMAGE_MIME_TYPE};base64," + base64.b64encode(VISION_TEST_IMAGE_BYTES).decode("ascii")
VISION_IMAGE_ROUTE_PREFIX = "/_filepilot/vision-images/"
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


@dataclass
class RegisteredVisionImage:
    token: str
    mime_type: str
    expires_at: float
    path: Path | None = None
    data: bytes | None = None


_VISION_IMAGE_REGISTRY: dict[str, RegisteredVisionImage] = {}


def _cleanup_expired_registered_images() -> None:
    now = time.time()
    expired = [token for token, item in _VISION_IMAGE_REGISTRY.items() if item.expires_at <= now]
    for token in expired:
        _VISION_IMAGE_REGISTRY.pop(token, None)


def register_vision_image_bytes(image_bytes: bytes, mime_type: str, *, ttl_seconds: int = 300) -> str:
    _cleanup_expired_registered_images()
    token = secrets.token_urlsafe(24)
    _VISION_IMAGE_REGISTRY[token] = RegisteredVisionImage(
        token=token,
        mime_type=mime_type,
        data=image_bytes,
        expires_at=time.time() + ttl_seconds,
    )
    return token


def register_vision_image_file(path: str | Path, mime_type: str, *, ttl_seconds: int = 300) -> str:
    _cleanup_expired_registered_images()
    token = secrets.token_urlsafe(24)
    _VISION_IMAGE_REGISTRY[token] = RegisteredVisionImage(
        token=token,
        mime_type=mime_type,
        path=Path(path),
        expires_at=time.time() + ttl_seconds,
    )
    return token


def resolve_registered_vision_image(token: str) -> RegisteredVisionImage | None:
    _cleanup_expired_registered_images()
    item = _VISION_IMAGE_REGISTRY.get(token)
    if item is None or item.expires_at <= time.time():
        _VISION_IMAGE_REGISTRY.pop(token, None)
        return None
    if item.path is not None and not item.path.exists():
        _VISION_IMAGE_REGISTRY.pop(token, None)
        return None
    return item


def get_backend_vision_base_url(default: str = "http://127.0.0.1:8765") -> str:
    from file_pilot.shared.config import BACKEND_RUNTIME_PATH

    try:
        payload = json.loads(BACKEND_RUNTIME_PATH.read_text(encoding="utf-8"))
        base_url = str(payload.get("base_url") or "").strip()
        if base_url:
            return base_url.rstrip("/")
    except Exception:
        pass
    return default.rstrip("/")


def build_registered_vision_image_url(token: str, *, base_url: str | None = None) -> str:
    root = (base_url or get_backend_vision_base_url()).rstrip("/") + "/"
    return urljoin(root, VISION_IMAGE_ROUTE_PREFIX.lstrip("/") + token)


def is_local_base_url(base_url: str | None) -> bool:
    parsed = urlparse(str(base_url or "").strip())
    return (parsed.hostname or "").lower() in _LOCAL_HOSTS


def should_retry_with_http_image_url(exc: Exception, *, base_url: str | None) -> bool:
    if os.getenv("FILEPILOT_VISION_HTTP_FALLBACK", "").strip().lower() not in {"1", "true", "yes", "on"}:
        return False
    if not is_local_base_url(base_url):
        return False
    message = str(exc or "").lower()
    retry_markers = (
        "invalid image",
        "image data",
        "valid image",
        "data url",
        "base64",
        "multimodal",
        "image_url",
    )
    return any(marker in message for marker in retry_markers)


def guess_image_mime_type(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "image/png"


def build_data_url(image_bytes: bytes, mime_type: str) -> str:
    return f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"


def build_data_url_from_path(path: str | Path) -> tuple[str, str, int]:
    image_path = Path(path)
    image_bytes = image_path.read_bytes()
    mime_type = guess_image_mime_type(image_path)
    return build_data_url(image_bytes, mime_type), mime_type, len(image_bytes)


def build_vision_messages(*, system_prompt: str, user_prompt: str, image_url: str) -> list[dict[str, Any]]:
    return [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": user_prompt},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        },
    ]


def build_vision_request_kwargs(
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    image_url: str,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": build_vision_messages(system_prompt=system_prompt, user_prompt=user_prompt, image_url=image_url),
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    return payload


def build_vision_request_debug_payload(
    *,
    model: str | None,
    base_url: str | None,
    prompt_mode: str,
    mime_type: str,
    image_bytes: int,
    data_url_length: int,
    image_source_type: str = "data_url",
) -> dict[str, Any]:
    return {
        "model": model,
        "base_url": base_url,
        "prompt_mode": prompt_mode,
        "image_source_type": image_source_type,
        "mime_type": mime_type,
        "image_bytes": image_bytes,
        "data_url_length": data_url_length,
    }


def extract_message_text(message_content: Any) -> str:
    return extract_model_message_text(message_content).replace("\n", " ").strip()


def coerce_response_message(response: Any) -> SimpleNamespace:
    message = coerce_model_response_message(response, text_extractor=extract_message_text)
    return SimpleNamespace(content=getattr(message, "content", ""))
