from __future__ import annotations

import json
import uuid
from pathlib import Path

from file_pilot.app.models import TargetProfile, TargetProfileDirectory, utc_now_iso


class TargetProfileStore:
    def __init__(self, root_dir: Path):
        self.root_dir = Path(root_dir)
        self.root_dir.mkdir(parents=True, exist_ok=True)
        self.storage_path = self.root_dir / "target_profiles.json"

    def list(self) -> list[TargetProfile]:
        return sorted(self._read_all().values(), key=lambda item: item.updated_at, reverse=True)

    def get(self, profile_id: str) -> TargetProfile | None:
        return self._read_all().get(str(profile_id or "").strip())

    def create(self, name: str, directories: list[dict] | list[TargetProfileDirectory]) -> TargetProfile:
        payload = TargetProfile(
            profile_id=uuid.uuid4().hex,
            name=str(name or "").strip(),
            directories=self._normalize_directories(directories),
        )
        self._write_profile(payload)
        return payload

    def update(
        self,
        profile_id: str,
        *,
        name: str | None = None,
        directories: list[dict] | list[TargetProfileDirectory] | None = None,
    ) -> TargetProfile | None:
        profile = self.get(profile_id)
        if profile is None:
            return None
        if name is not None:
            profile.name = str(name or "").strip()
        if directories is not None:
            profile.directories = self._normalize_directories(directories)
        profile.updated_at = utc_now_iso()
        self._write_profile(profile)
        return profile

    def delete(self, profile_id: str) -> bool:
        payload = self._read_all()
        if profile_id not in payload:
            return False
        payload.pop(profile_id, None)
        self._write_all(payload)
        return True

    def _normalize_directories(
        self,
        directories: list[dict] | list[TargetProfileDirectory] | None,
    ) -> list[TargetProfileDirectory]:
        items: list[TargetProfileDirectory] = []
        for entry in directories or []:
            normalized = TargetProfileDirectory.from_dict(entry) if isinstance(entry, dict) else entry
            if normalized is not None and str(normalized.path).strip():
                items.append(normalized)
        return items

    def _read_all(self) -> dict[str, TargetProfile]:
        if not self.storage_path.exists():
            return {}
        try:
            raw = json.loads(self.storage_path.read_text(encoding="utf-8") or "{}")
        except json.JSONDecodeError:
            return {}
        profiles: dict[str, TargetProfile] = {}
        for profile_id, payload in raw.items():
            profile = TargetProfile.from_dict({"profile_id": profile_id, **payload})
            if profile is not None:
                profiles[profile.profile_id] = profile
        return profiles

    def _write_profile(self, profile: TargetProfile) -> None:
        payload = self._read_all()
        payload[profile.profile_id] = profile
        self._write_all(payload)

    def _write_all(self, profiles: dict[str, TargetProfile]) -> None:
        serialized = {
            profile_id: {
                "name": profile.name,
                "directories": [item.to_dict() for item in profile.directories],
                "created_at": profile.created_at,
                "updated_at": profile.updated_at,
            }
            for profile_id, profile in profiles.items()
        }
        self.storage_path.write_text(json.dumps(serialized, ensure_ascii=False, indent=2), encoding="utf-8")
