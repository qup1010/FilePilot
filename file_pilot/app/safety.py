from __future__ import annotations

import os
from pathlib import Path


SENSITIVE_ENTRY_NAMES = {
    ".env",
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "node_modules",
    "venv",
}

PROJECT_MARKER_NAMES = {
    "Cargo.lock",
    "package-lock.json",
    "pnpm-lock.yaml",
    "pyproject.toml",
    "yarn.lock",
}


def _canonical_path(path: str | Path) -> Path:
    return Path(path).expanduser().resolve(strict=False)


def _is_same_or_child(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _windows_sensitive_roots() -> list[Path]:
    roots: list[Path] = []
    for key in ("SystemRoot", "windir", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"):
        value = os.environ.get(key, "").strip()
        if value:
            roots.append(_canonical_path(value))
    user_profile = os.environ.get("USERPROFILE", "").strip()
    if user_profile:
        roots.append(_canonical_path(Path(user_profile) / "AppData"))
    return roots


def unsafe_source_path_reason(path: str | Path, *, source_type: str = "directory") -> str | None:
    candidate = _canonical_path(path)
    if not str(candidate).strip():
        return "SOURCE_PATH_EMPTY"

    if candidate.parent == candidate:
        return "SOURCE_PATH_DRIVE_ROOT"

    if source_type == "directory":
        try:
            if candidate.samefile(Path.cwd()):
                return "SOURCE_PATH_PROJECT_ROOT"
        except OSError:
            if candidate == _canonical_path(Path.cwd()):
                return "SOURCE_PATH_PROJECT_ROOT"

    for root in _windows_sensitive_roots():
        if _is_same_or_child(candidate, root):
            return "SOURCE_PATH_SYSTEM_PROTECTED"

    return None


def risky_move_reason(source: str | Path, target: str | Path = "") -> str | None:
    source_text = str(source or "").replace("\\", "/")
    target_text = str(target or "").replace("\\", "/")
    source_parts = [part for part in source_text.split("/") if part]
    is_absolute_source = Path(source_text).is_absolute() or bool(Path(source_text).drive)
    lower_parts = {part.lower() for part in source_parts}
    lower_name = source_parts[-1].lower() if source_parts else ""

    if lower_parts.intersection(SENSITIVE_ENTRY_NAMES) or lower_name in {item.lower() for item in PROJECT_MARKER_NAMES}:
        return "包含工程或隐藏配置条目"
    if source_text.split("/")[0].startswith(".") or lower_name.startswith("."):
        return "包含隐藏条目"
    if not is_absolute_source and len(source_parts) >= 5:
        return "来源路径层级较深"

    source_drive = Path(source_text).drive.lower()
    target_drive = Path(target_text).drive.lower()
    if source_drive and target_drive and source_drive != target_drive:
        return "可能跨磁盘移动"
    return None
