from __future__ import annotations

import threading
from pathlib import Path


class AsyncScanner:
    """Use a background thread to avoid blocking the desktop API."""

    def __init__(self) -> None:
        self._threads: dict[str, threading.Thread] = {}
        self._cancel_events: dict[str, threading.Event] = {}
        self._lock = threading.RLock()

    @staticmethod
    def _run_with_optional_cancel_event(run_scan, target_dir: Path, cancel_event: threading.Event):
        try:
            return run_scan(target_dir, cancel_event=cancel_event)
        except TypeError as exc:
            if "unexpected keyword argument 'cancel_event'" not in str(exc):
                raise
            return run_scan(target_dir)

    def start(self, session_id: str, target_dir: Path, run_scan, on_complete, on_error) -> None:
        with self._lock:
            existing = self._threads.get(session_id)
        if existing and existing.is_alive():
            return
        cancel_event = threading.Event()
        with self._lock:
            self._cancel_events[session_id] = cancel_event

        def worker() -> None:
            try:
                result = self._run_with_optional_cancel_event(run_scan, target_dir, cancel_event)
                on_complete(session_id, result)
            except Exception as exc:  # pragma: no cover - defensive branch
                on_error(session_id, exc)
            finally:
                with self._lock:
                    self._threads.pop(session_id, None)
                    self._cancel_events.pop(session_id, None)

        thread = threading.Thread(target=worker, name=f"scan-{session_id}", daemon=True)
        with self._lock:
            self._threads[session_id] = thread
        thread.start()

    def get_progress(self, session_id: str) -> dict:
        with self._lock:
            thread = self._threads.get(session_id)
        return {"running": bool(thread and thread.is_alive())}

    def is_running(self, session_id: str) -> bool:
        with self._lock:
            thread = self._threads.get(session_id)
        return bool(thread and thread.is_alive())

    def cancel(self, session_id: str) -> None:
        with self._lock:
            cancel_event = self._cancel_events.get(session_id)
        if cancel_event is not None:
            cancel_event.set()
