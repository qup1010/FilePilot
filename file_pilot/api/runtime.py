from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from file_pilot.shared.config import BACKEND_RUNTIME_PATH


def write_backend_runtime(
    base_url: str,
    host: str,
    port: int,
    *,
    pid: int | None = None,
    instance_id: str | None = None,
    path: Path = BACKEND_RUNTIME_PATH,
) -> Path:
    payload = {
        "base_url": base_url,
        "host": host,
        "port": port,
        "pid": pid or os.getpid(),
        "started_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "instance_id": instance_id or os.getenv("FILE_PILOT_INSTANCE_ID"),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp_path, path)
    return path


def clear_backend_runtime(path: Path = BACKEND_RUNTIME_PATH, *, pid: int | None = None, instance_id: str | None = None) -> None:
    if path.exists():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            path.unlink()
            return
        current_pid = pid or os.getpid()
        current_instance_id = instance_id or os.getenv("FILE_PILOT_INSTANCE_ID")
        owner_pid = payload.get("pid")
        owner_instance_id = payload.get("instance_id")
        if owner_pid is not None and owner_pid != current_pid:
            return
        if current_instance_id and owner_instance_id and owner_instance_id != current_instance_id:
            return
        path.unlink()
