import json
import os
import time
from pathlib import Path

JSON_EMPTY_OBJECT = "{}"


def atomic_write_json(path: Path, payload: dict) -> None:
    """tmp + os.replace 原子落盘：截断式 write_text 崩溃在半途会毁掉整个文件。

    journal 是回退与文件检索的唯一事实来源，绝不允许出现半截 JSON。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    # Windows 下 os.replace 可能因防病毒扫描等短暂占用报 PermissionError，做有限重试
    last_error: OSError | None = None
    for attempt in range(5):
        try:
            os.replace(temp_path, path)
            return
        except PermissionError as exc:
            last_error = exc
            time.sleep(0.05 * (attempt + 1))
    if last_error is not None:
        raise last_error


def ensure_history_dirs(latest_index_path: Path, executions_dir: Path) -> None:
    latest_index_path.parent.mkdir(parents=True, exist_ok=True)
    executions_dir.mkdir(parents=True, exist_ok=True)
    if not latest_index_path.exists():
        latest_index_path.write_text(JSON_EMPTY_OBJECT, encoding="utf-8")


def read_latest_index(latest_index_path: Path, executions_dir: Path) -> dict[str, str]:
    ensure_history_dirs(latest_index_path, executions_dir)
    return json.loads(latest_index_path.read_text(encoding="utf-8") or JSON_EMPTY_OBJECT)


def write_latest_index(index: dict[str, str], latest_index_path: Path, executions_dir: Path) -> None:
    ensure_history_dirs(latest_index_path, executions_dir)
    atomic_write_json(latest_index_path, index)


def build_journal_path(execution_id: str, executions_dir: Path) -> Path:
    executions_dir.mkdir(parents=True, exist_ok=True)
    return executions_dir / f"{execution_id}.json"
