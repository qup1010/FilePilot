from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class SourceRef:
    ref_id: str
    display_name: str
    entry_type: str
    origin: str
    relpath: str
    suggested_purpose: str = ""
    content_summary: str = ""
    confidence: float | None = None
    size_bytes: int | None = None
    modified_at: str | None = None
    ext: str = ""

    @property
    def absolute_path(self) -> Path:
        return Path(self.origin) / self.relpath


@dataclass
class TargetSlot:
    slot_id: str
    display_name: str
    real_path: str
    children: list["TargetSlot"] = field(default_factory=list)
    depth: int = 0
    is_new: bool = False


@dataclass
class MappingEntry:
    source_ref_id: str
    target_slot_id: str
    status: str
    reason: str = ""
    confidence: float | None = None
    user_overridden: bool = False


@dataclass
class OrganizeTask:
    task_id: str
    sources: list[SourceRef] = field(default_factory=list)
    targets: list[TargetSlot] = field(default_factory=list)
    mappings: list[MappingEntry] = field(default_factory=list)
    strategy: dict = field(default_factory=dict)
    user_constraints: list[str] = field(default_factory=list)
    phase: str = "setup"
