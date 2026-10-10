from __future__ import annotations

DEFAULT_CONTENT_LOCALE = "zh-CN"
SUPPORTED_CONTENT_LOCALES = frozenset({"zh-CN", "en"})


def normalize_content_locale(value: object) -> str:
    """Normalize supported AI content languages while keeping legacy tasks Chinese."""
    normalized = str(value or "").strip().replace("_", "-").lower()
    if normalized.startswith("en"):
        return "en"
    if normalized.startswith("zh"):
        return "zh-CN"
    return DEFAULT_CONTENT_LOCALE
