from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class RollbackAction:
    type: str
    source: Path
    target: Path
    raw: str = ""
    item_id: str = ""
    source_ref_id: str = ""
    target_slot_id: str = ""
    display_name: str = ""


@dataclass
class RollbackPlan:
    execution_id: str
    target_dir: Path
    actions: list[RollbackAction] = field(default_factory=list)


@dataclass
class RollbackPrecheckResult:
    can_execute: bool
    blocking_errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class RollbackItemResult:
    action: RollbackAction
    status: str
    message: str


@dataclass
class RollbackReport:
    success_count: int
    failure_count: int
    results: list[RollbackItemResult] = field(default_factory=list)
