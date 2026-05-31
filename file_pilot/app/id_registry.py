from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
from pathlib import Path

from file_pilot.domain.models import SourceRef, TargetSlot


@dataclass
class IdRegistryState:
    source_ids_by_relpath: dict[str, str] = field(default_factory=dict)
    target_ids_by_real_path: dict[str, str] = field(default_factory=dict)
    next_source_number: int = 1
    next_target_number: int = 1

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | "IdRegistryState" | None) -> "IdRegistryState" | None:
        if data is None:
            return None
        if isinstance(data, cls):
            return data
        if not isinstance(data, dict):
            return None
        return cls(
            source_ids_by_relpath={
                IdRegistry._normalize_path(key): str(value).strip()
                for key, value in dict(data.get("source_ids_by_relpath", {})).items()
                if IdRegistry._normalize_path(key) and str(value).strip()
            },
            target_ids_by_real_path={
                IdRegistry._normalize_path(key): str(value).strip()
                for key, value in dict(data.get("target_ids_by_real_path", {})).items()
                if IdRegistry._normalize_path(key) and str(value).strip()
            },
            next_source_number=max(1, int(data.get("next_source_number", 1) or 1)),
            next_target_number=max(1, int(data.get("next_target_number", 1) or 1)),
        )


class IdRegistry:
    def __init__(self, state: IdRegistryState | None = None) -> None:
        self._sources: dict[str, SourceRef] = {}
        self._targets: dict[str, TargetSlot] = {}
        state = state or IdRegistryState()
        self._source_ids_by_relpath: dict[str, str] = dict(state.source_ids_by_relpath or {})
        self._target_ids_by_real_path: dict[str, str] = dict(state.target_ids_by_real_path or {})
        self._next_source_number = max(1, int(state.next_source_number or 1))
        self._next_target_number = max(1, int(state.next_target_number or 1))

    @staticmethod
    def _normalize_path(value: str | Path) -> str:
        return str(value).replace("\\", "/").strip().rstrip("/")

    @staticmethod
    def _id_number(value: str, prefix: str) -> int:
        text = str(value or "").strip()
        if len(text) >= 2 and text[0].upper() == prefix.upper() and text[1:].isdigit():
            return int(text[1:])
        return 0

    def _allocate_source_id(self) -> str:
        while True:
            ref_id = f"F{self._next_source_number:03d}"
            self._next_source_number += 1
            if ref_id not in self._sources and ref_id not in self._source_ids_by_relpath.values():
                return ref_id

    def _allocate_target_id(self) -> str:
        while True:
            slot_id = f"D{self._next_target_number:03d}"
            self._next_target_number += 1
            if slot_id not in self._targets and slot_id not in self._target_ids_by_real_path.values():
                return slot_id

    def register_source(self, source: SourceRef) -> SourceRef:
        normalized_relpath = self._normalize_path(source.relpath)
        has_persisted_id = normalized_relpath in self._source_ids_by_relpath
        ref_id = self._source_ids_by_relpath.get(normalized_relpath) or str(source.ref_id or "").strip()
        suggested_number = self._id_number(ref_id, "F")
        id_reserved_for_other_source = any(
            registered_relpath != normalized_relpath and registered_id == ref_id
            for registered_relpath, registered_id in self._source_ids_by_relpath.items()
        )
        if (
            not ref_id
            or id_reserved_for_other_source
            or (not has_persisted_id and suggested_number and suggested_number < self._next_source_number)
            or (ref_id in self._sources and self._sources[ref_id].relpath != normalized_relpath)
        ):
            ref_id = self._allocate_source_id()
        normalized_source = replace(source, ref_id=ref_id, relpath=normalized_relpath)
        self._sources[normalized_source.ref_id] = normalized_source
        self._source_ids_by_relpath[normalized_relpath] = normalized_source.ref_id
        number = self._id_number(normalized_source.ref_id, "F")
        self._next_source_number = max(self._next_source_number, number + 1)
        return normalized_source

    def register_target(self, target: TargetSlot) -> TargetSlot:
        normalized_path = self._normalize_path(target.real_path)
        persisted_slot_id = self._target_ids_by_real_path.get(normalized_path)
        slot_id = persisted_slot_id or str(target.slot_id or "").strip()
        if not persisted_slot_id and slot_id:
            # Current session target slots are authoritative over stale registry-only reservations.
            for registered_path, registered_id in list(self._target_ids_by_real_path.items()):
                if registered_path != normalized_path and registered_id == slot_id and slot_id not in self._targets:
                    self._target_ids_by_real_path.pop(registered_path, None)
        id_reserved_for_other_target = any(
            registered_path != normalized_path and registered_id == slot_id
            for registered_path, registered_id in self._target_ids_by_real_path.items()
        )
        if not slot_id or id_reserved_for_other_target or (slot_id in self._targets and self._targets[slot_id].real_path != normalized_path):
            slot_id = self._allocate_target_id()
        normalized_target = replace(target, slot_id=slot_id, real_path=normalized_path)
        self._targets[normalized_target.slot_id] = normalized_target
        self._target_ids_by_real_path[normalized_path] = normalized_target.slot_id
        number = self._id_number(normalized_target.slot_id, "D")
        self._next_target_number = max(self._next_target_number, number + 1)
        return normalized_target

    def to_state(self) -> IdRegistryState:
        return IdRegistryState(
            source_ids_by_relpath=dict(self._source_ids_by_relpath),
            target_ids_by_real_path=dict(self._target_ids_by_real_path),
            next_source_number=max(1, self._next_source_number),
            next_target_number=max(1, self._next_target_number),
        )

    @classmethod
    def from_state(cls, state: IdRegistryState | dict | None) -> "IdRegistry":
        return cls(IdRegistryState.from_dict(state))

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
        normalized_path = self._normalize_path(real_path)
        slot = TargetSlot(
            slot_id=self._target_ids_by_real_path.get(normalized_path) or self._allocate_target_id(),
            display_name=display_name,
            real_path=normalized_path,
            depth=depth,
            is_new=is_new,
        )
        return self.register_target(slot)
