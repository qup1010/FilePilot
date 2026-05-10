import json
from pathlib import Path


JSON_EMPTY_OBJECT = "{}"


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
    latest_index_path.write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def build_journal_path(execution_id: str, executions_dir: Path) -> Path:
    executions_dir.mkdir(parents=True, exist_ok=True)
    return executions_dir / f"{execution_id}.json"
