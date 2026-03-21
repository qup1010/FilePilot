from __future__ import annotations

import threading
from pathlib import Path


class AsyncScanner:
    """Use a background thread to avoid blocking the desktop API."""

    def __init__(self) -> None:
        self._threads: dict[str, threading.Thread] = {}

    def start(self, session_id: str, target_dir: Path, run_scan, on_complete, on_error) -> None:
        existing = self._threads.get(session_id)
        if existing and existing.is_alive():
            return

        def worker() -> None:
            try:
                result = run_scan(target_dir)
                on_complete(session_id, result)
            except Exception as exc:  # pragma: no cover - defensive branch
                on_error(session_id, exc)
            finally:
                self._threads.pop(session_id, None)

        thread = threading.Thread(target=worker, name=f"scan-{session_id}", daemon=True)
        self._threads[session_id] = thread
        thread.start()

    def get_progress(self, session_id: str) -> dict:
        thread = self._threads.get(session_id)
        return {"running": bool(thread and thread.is_alive())}

    def cancel(self, session_id: str) -> None:  # pragma: no cover - cooperative cancel not yet implemented
        raise NotImplementedError("scan_cancel_not_supported")
