from __future__ import annotations

import hashlib
import json
import os
import uuid
from pathlib import Path

from file_organizer.app.models import LockResult, OrganizerSession
from file_organizer.shared.path_utils import canonical_target_dir


def _atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp_path, path)


class SessionStore:
    def __init__(self, root_dir: Path):
        self.root_dir = Path(root_dir)
        self.root_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_dir = self.root_dir
        self.locks_dir = self.root_dir / "locks"
        self.latest_index_path = self.root_dir / "latest_by_directory.json"

    def create(self, target_dir: Path) -> OrganizerSession:
        return OrganizerSession(session_id=uuid.uuid4().hex, target_dir=canonical_target_dir(target_dir))

    def load(self, session_id: str) -> OrganizerSession | None:
        path = self.sessions_dir / f"{session_id}.json"
        if not path.exists():
            return None
        return OrganizerSession.from_dict(json.loads(path.read_text(encoding="utf-8")))

    def save(self, session: OrganizerSession) -> None:
        session.touch()
        _atomic_write_json(self.sessions_dir / f"{session.session_id}.json", session.to_dict())
        latest_index = self._read_latest_index()
        latest_index[session.target_dir] = session.session_id
        _atomic_write_json(self.latest_index_path, latest_index)

    def find_latest_by_directory(self, target_dir: Path) -> OrganizerSession | None:
        session_id = self._read_latest_index().get(canonical_target_dir(target_dir))
        if not session_id:
            return None
        return self.load(session_id)

    def mark_abandoned(self, session_id: str) -> None:
        session = self.load(session_id)
        if session is None:
            return
        session.stage = "abandoned"
        self.save(session)
        latest_index = self._read_latest_index()
        if latest_index.get(session.target_dir) == session_id:
            latest_index.pop(session.target_dir, None)
            _atomic_write_json(self.latest_index_path, latest_index)

    def acquire_directory_lock(self, target_dir: Path, owner_id: str) -> LockResult:
        lock_path = self._lock_path(target_dir)
        canonical = canonical_target_dir(target_dir)
        if not lock_path.exists():
            _atomic_write_json(lock_path, {"target_dir": canonical, "owner_session_id": owner_id})
            return LockResult(acquired=True, lock_owner_session_id=owner_id, reason="acquired")

        payload = json.loads(lock_path.read_text(encoding="utf-8"))
        current_owner = payload.get("owner_session_id")
        if current_owner == owner_id:
            return LockResult(acquired=True, lock_owner_session_id=owner_id, reason="acquired")
        owner_session = self.load(current_owner) if current_owner else None
        if owner_session is not None and owner_session.stage in {"abandoned", "completed"}:
            _atomic_write_json(lock_path, {"target_dir": canonical, "owner_session_id": owner_id})
            return LockResult(acquired=True, lock_owner_session_id=owner_id, reason="reclaimed_stale_lock")
        return LockResult(acquired=False, lock_owner_session_id=current_owner, reason="active_lock")

    def release_directory_lock(self, target_dir: Path, owner_id: str) -> None:
        lock_path = self._lock_path(target_dir)
        if not lock_path.exists():
            return
        payload = json.loads(lock_path.read_text(encoding="utf-8"))
        if payload.get("owner_session_id") == owner_id:
            lock_path.unlink()

    def _read_latest_index(self) -> dict[str, str]:
        if not self.latest_index_path.exists():
            return {}
        try:
            return json.loads(self.latest_index_path.read_text(encoding="utf-8") or "{}")
        except json.JSONDecodeError:
            return {}

    def _lock_path(self, target_dir: Path) -> Path:
        digest = hashlib.sha1(canonical_target_dir(target_dir).encode("utf-8")).hexdigest()
        return self.locks_dir / f"{digest}.lock"
