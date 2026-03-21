import os
import re
from pathlib import Path


def normalize_path(value: str) -> str:
    return (value or "").strip().replace("\\", "/")


def is_absolute_path(value: str) -> bool:
    normalized = normalize_path(value)
    return bool(re.match(r"^[A-Za-z]:/", normalized)) or normalized.startswith("/")


def split_relative_parts(value: str) -> list[str] | None:
    normalized = normalize_path(value)
    while normalized.startswith("./"):
        normalized = normalized[2:]

    if not normalized or is_absolute_path(normalized):
        return None

    parts = normalized.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return None
    return parts


def normalize_source_name(raw_source: str) -> str | None:
    parts = split_relative_parts(raw_source)
    if not parts or len(parts) != 1:
        return None
    return parts[0]


def normalize_entry_name(raw_path: str, base_dir: Path) -> str | None:
    normalized = normalize_path(raw_path)
    while normalized.startswith("./"):
        normalized = normalized[2:]

    parts = Path(normalized).parts
    if not parts:
        return None

    candidate = Path(normalized)
    if candidate.is_absolute():
        try:
            return candidate.resolve().relative_to(base_dir.resolve()).parts[0]
        except ValueError:
            return None

    return parts[0]


def resolve_tool_path(base_dir: Path, raw_path: str | None, default: str = ".") -> str:
    candidate = (raw_path or default).strip() or default
    path = Path(candidate)
    if path.is_absolute():
        return str(path)
    return str((base_dir / path).resolve())


def relative_display(path: Path, base_dir: Path) -> str:
    try:
        return path.resolve(strict=False).relative_to(base_dir.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def canonical_target_dir(value: str | Path) -> str:
    resolved = Path(value).expanduser().resolve(strict=False)
    normalized = os.path.normcase(str(resolved))
    return normalized.rstrip("\\/").replace("\\", "/")
