from __future__ import annotations

from pathlib import Path
import zipfile

DEFAULT_ARCHIVE_ENTRY_LIMIT = 20


def read_archive_index(filepath: str | Path, max_entries: int = DEFAULT_ARCHIVE_ENTRY_LIMIT) -> str:
    path = Path(filepath)
    if path.suffix.lower() != ".zip":
        return f"暂不支持的压缩包格式: {path.suffix or '无扩展名'}"

    try:
        with zipfile.ZipFile(path) as archive:
            names = sorted(name for name in archive.namelist() if name and not name.endswith("/"))
    except Exception as exc:
        return f"读取压缩包失败: {exc}"

    preview_entries = names[:max_entries]
    lines = [
        f"压缩包: {path.name}",
        f"文件数: {len(names)}",
        "索引预览:",
    ]
    lines.extend(preview_entries)

    hidden_count = len(names) - len(preview_entries)
    if hidden_count > 0:
        lines.append(f"其余 {hidden_count} 条已省略")

    return "\n".join(lines)
