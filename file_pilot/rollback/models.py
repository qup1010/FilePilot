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


@dataclass(frozen=True)
class RollbackItemSkip:
    """无法回退的单项：跳过并说明原因，其余项照常回退。"""

    reason: str  # target_exists | source_missing | invalid_dir | dir_not_empty
    message: str
    action_type: str = ""
    source: str | None = None
    target: str | None = None
    item_id: str | None = None
    display_name: str | None = None

    def to_dict(self) -> dict:
        return {
            "reason": self.reason,
            "message": self.message,
            "action_type": self.action_type,
            "source": self.source,
            "target": self.target,
            "item_id": self.item_id,
            "display_name": self.display_name,
        }


@dataclass
class RollbackPrecheckResult:
    can_execute: bool
    blocking_errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    item_skips: list[RollbackItemSkip] = field(default_factory=list)


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
    skipped_count: int = 0
