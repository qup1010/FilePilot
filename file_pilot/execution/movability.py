"""可移动性门：执行前的本地事实检查，模型无法也不应判断这些。

覆盖三类硬信号：下载未完成、被其他进程占用、云占位文件。
输出跳过原因文本（None 表示可移动），由预检与执行时刻防线共同消费；
未通过者留在原地并在总结中呈现原因。
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# 各浏览器/下载器的「下载中」后缀
DOWNLOADING_SUFFIXES = {
    ".part",
    ".crdownload",
    ".download",
    ".partial",
    ".!qb",
    ".opdownload",
}

# OneDrive 等按需文件的占位符属性：文件本体不在本地，移动会触发整体拉取
_FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x00400000
_FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x00040000


def _is_downloading(path: Path) -> bool:
    return path.suffix.lower() in DOWNLOADING_SUFFIXES


def _is_cloud_placeholder(path: Path) -> bool:
    try:
        attributes = getattr(path.stat(), "st_file_attributes", 0)
    except OSError:
        return False
    return bool(attributes & (_FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | _FILE_ATTRIBUTE_RECALL_ON_OPEN))


def _is_locked_by_other_process(path: Path) -> bool:
    """Windows 下把文件原地改名到自身：被占用（无删除共享权限）会失败。

    这正是「能否移动」的直接探测——移动本质上就是改名。
    POSIX 上恒成功，符合其语义（打开中的文件可以被移动）。
    """
    if not path.is_file():
        return False
    try:
        os.rename(str(path), str(path))
    except PermissionError:
        return True
    except OSError:
        logger.warning("movability.rename_probe_failed path=%s", path, exc_info=True)
        return False
    return False


def movability_skip_reason(path: Path) -> str | None:
    """返回不可移动的原因文本；None 表示可移动。"""
    if _is_downloading(path):
        return "文件正在下载中，留在原地"
    if _is_cloud_placeholder(path):
        return "云端占位文件（本体不在本地），留在原地"
    if _is_locked_by_other_process(path):
        return "文件正被其他程序占用，留在原地"
    return None
