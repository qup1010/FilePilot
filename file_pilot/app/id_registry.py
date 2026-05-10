from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from file_pilot.domain.models import SourceRef, TargetSlot


class IdRegistry:
    def __init__(self) -> None:
        self._sources: dict[str, SourceRef] = {}
        self._targets: dict[str, TargetSlot] = {}
        self._source_ids_by_relpath: dict[str, str] = {}
        self._target_ids_by_real_path: dict[str, str] = {}
        self._next_target_number = 1

    @staticmethod
    def _normalize_path(value: str | Path) -> str:
        return str(value).replace("\\", "/").strip().rstrip("/")

    def register_source(self, source: SourceRef) -> SourceRef:
        normalized_relpath = self._normalize_path(source.relpath)
        normalized_source = replace(source, relpath=normalized_relpath)
        self._sources[normalized_source.ref_id] = normalized_source
        self._source_ids_by_relpath[normalized_relpath] = normalized_source.ref_id
        return normalized_source

    def register_target(self, target: TargetSlot) -> TargetSlot:
        normalized_path = self._normalize_path(target.real_path)
        normalized_target = replace(target, real_path=normalized_path)
        self._targets[normalized_target.slot_id] = normalized_target
        self._target_ids_by_real_path[normalized_path] = normalized_target.slot_id
        try:
            number = int(normalized_target.slot_id[1:])
        except (TypeError, ValueError):
            number = 0
        self._next_target_number = max(self._next_target_number, number + 1)
        return normalized_target

    def list_sources(self) -> list[SourceRef]:
        return list(self._sources.values())

    def list_targets(self) -> list[TargetSlot]:
        return list(self._targets.values())

    def resolve_source(self, ref_id: str) -> Path:
        source = self._sources[ref_id]
        return source.absolute_path

    def resolve_target(self, slot_id: str, filename: str) -> Path:
        target = self._targets[slot_id]
        return Path(target.real_path) / filename

    def source_for_relpath(self, relpath: str) -> SourceRef | None:
        normalized_relpath = self._normalize_path(relpath)
        source_id = self._source_ids_by_relpath.get(normalized_relpath)
        return self._sources.get(source_id or "")

    def target_for_real_path(self, real_path: str | Path) -> TargetSlot | None:
        normalized_path = self._normalize_path(real_path)
        slot_id = self._target_ids_by_real_path.get(normalized_path)
        return self._targets.get(slot_id or "")

    def ensure_target(self, *, display_name: str, real_path: str, depth: int = 0, is_new: bool = True) -> TargetSlot:
        existing = self.target_for_real_path(real_path)
        if existing is not None:
            return existing
        slot = TargetSlot(
            slot_id=f"D{self._next_target_number:03d}",
            display_name=display_name,
            real_path=self._normalize_path(real_path),
            depth=depth,
            is_new=is_new,
        )
        self._next_target_number += 1
        return self.register_target(slot)
