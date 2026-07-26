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

_PROJECT_MARKER_NAMES_LOWER = frozenset(item.lower() for item in PROJECT_MARKER_NAMES)

# risky_move_reason 的判定结果，与 unsafe_source_path_reason 一样用错误码表达，
# 展示文案由调用方（或前端）负责映射。
RISKY_MOVE_PROJECT_ENTRY = "RISKY_MOVE_PROJECT_ENTRY"
RISKY_MOVE_HIDDEN_ENTRY = "RISKY_MOVE_HIDDEN_ENTRY"
RISKY_MOVE_CROSS_VOLUME = "RISKY_MOVE_CROSS_VOLUME"

RISKY_MOVE_REASON_COPY = {
    RISKY_MOVE_PROJECT_ENTRY: "包含工程或隐藏配置条目",
    RISKY_MOVE_HIDDEN_ENTRY: "包含隐藏条目",
    RISKY_MOVE_CROSS_VOLUME: "可能跨磁盘移动",
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
    """返回移动来源的风险错误码（RISKY_MOVE_*），无风险时返回 None。"""
    source_path = Path(str(source or ""))
    target_path = Path(str(target or ""))
    # 去掉盘符/根 anchor（如 "d:\\"、"/"），只检查真实路径分量
    lower_parts = [part.lower() for part in source_path.parts if part != source_path.anchor]
    lower_name = lower_parts[-1] if lower_parts else ""

    # 任一路径分量命中工程敏感目录，或条目本身是工程标记文件
    if set(lower_parts).intersection(SENSITIVE_ENTRY_NAMES) or lower_name in _PROJECT_MARKER_NAMES_LOWER:
        return RISKY_MOVE_PROJECT_ENTRY
    # 隐藏条目：任一路径分量以 . 开头（盘符 "d:" 等 anchor 不参与）
    if any(part.startswith(".") for part in lower_parts):
        return RISKY_MOVE_HIDDEN_ENTRY

    source_drive = source_path.drive.lower()
    target_drive = target_path.drive.lower()
    if source_drive and target_drive and source_drive != target_drive:
        return RISKY_MOVE_CROSS_VOLUME
    return None
