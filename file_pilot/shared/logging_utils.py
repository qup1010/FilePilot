from __future__ import annotations

import json
import logging
import re
import sys
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
from threading import Lock
from typing import Any

from file_pilot.shared.constants import PROJECT_ROOT

BACKEND_LOG_DIR = (PROJECT_ROOT / "logs" / "backend").resolve()
RUNTIME_LOG_PATH = BACKEND_LOG_DIR / "runtime.log"
DEBUG_LOG_PATH = BACKEND_LOG_DIR / "debug.jsonl"

_LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
_MANAGED_LOGGERS = ("uvicorn", "uvicorn.error", "file_pilot")
_SENSITIVE_KEYWORDS = ("authorization", "api_key", "apikey", "token", "secret", "password")
_DEBUG_WRITE_LOCK = Lock()

_BEARER_TOKEN_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+\b")
_OPENAI_KEY_RE = re.compile(r"\bsk-[A-Za-z0-9][A-Za-z0-9._-]{8,}\b")


def _to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def is_debug_logging_enabled() -> bool:
    from file_pilot.shared.config_manager import config_manager

    return _to_bool(config_manager.get("DEBUG_MODE", False))


def _is_sensitive_key(key: Any) -> bool:
    if not isinstance(key, str):
        return False
    lowered = key.strip().lower().replace("-", "_")
    return any(keyword in lowered for keyword in _SENSITIVE_KEYWORDS)


def _sanitize_string(value: str) -> str:
    value = _BEARER_TOKEN_RE.sub("Bearer [REDACTED]", value)
    value = _OPENAI_KEY_RE.sub("sk-[REDACTED]", value)
    return value


def sanitize_for_logging(value: Any) -> Any:
    if is_dataclass(value) and not isinstance(value, type):
        return sanitize_for_logging(asdict(value))
    if hasattr(value, "model_dump") and callable(value.model_dump):
        return sanitize_for_logging(value.model_dump())
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            if _is_sensitive_key(key):
                sanitized[str(key)] = "[REDACTED]"
            else:
                sanitized[str(key)] = sanitize_for_logging(item)
        return sanitized
    if isinstance(value, list):
        return [sanitize_for_logging(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_for_logging(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, BaseException):
        return {
            "type": type(value).__name__,
            "message": _sanitize_string(str(value)),
        }
    if isinstance(value, str):
        return _sanitize_string(value)
    return value


def _close_handlers(logger: logging.Logger) -> None:
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
        try:
            handler.close()
        except Exception:
            pass


def close_backend_logging() -> None:
    _close_handlers(logging.getLogger())
    for name in _MANAGED_LOGGERS:
        managed_logger = logging.getLogger(name)
        _close_handlers(managed_logger)
        managed_logger.propagate = True
    _close_handlers(logging.getLogger("uvicorn.access"))
    logging.captureWarnings(False)


def setup_backend_logging(
    *,
    log_dir: Path = BACKEND_LOG_DIR,
    backup_count: int = 7,
    level: int = logging.INFO,
) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    runtime_log_path = log_dir / "runtime.log"

    formatter = logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT)
    file_handler = TimedRotatingFileHandler(
        runtime_log_path,
        when="midnight",
        backupCount=backup_count,
        encoding="utf-8",
    )
    file_handler.setLevel(level)
    file_handler.setFormatter(formatter)

    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    _close_handlers(root_logger)
    root_logger.setLevel(level)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)

    for name in _MANAGED_LOGGERS:
        managed_logger = logging.getLogger(name)
        _close_handlers(managed_logger)
        managed_logger.setLevel(level)
        managed_logger.propagate = True

    access_logger = logging.getLogger("uvicorn.access")
    _close_handlers(access_logger)
    access_logger.setLevel(logging.WARNING)
    access_logger.propagate = False
    access_logger.disabled = True

    logging.captureWarnings(True)
    return runtime_log_path


def append_debug_event(
    *,
    kind: str,
    level: str = "INFO",
    session_id: str | None = None,
    target_dir: str | None = None,
    stage: str | None = None,
    payload: Any = None,
    enabled: bool | None = None,
    path: Path | None = None,
) -> Path | None:
    debug_enabled = is_debug_logging_enabled() if enabled is None else enabled
    if not debug_enabled:
        return None

    debug_path = path or DEBUG_LOG_PATH
    debug_path.parent.mkdir(parents=True, exist_ok=True)
    entry = sanitize_for_logging(
        {
            "timestamp": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "level": level.upper(),
            "kind": kind,
            "session_id": session_id,
            "target_dir": target_dir,
            "stage": stage,
            "payload": payload,
        }
    )

    with _DEBUG_WRITE_LOCK:
        with debug_path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return debug_path
