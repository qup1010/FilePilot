from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ExecutionAction:
    type: str
    target: Path
    source: Path | None = None
    raw: str = ""
    item_id: str = ""
    source_ref_id: str = ""
    target_slot_id: str = ""
    display_name: str = ""


@dataclass
class MappedExecutionAction:
    type: str
    target_path: Path
    source_path: Path | None = None
    raw: str = ""
    item_id: str = ""
    source_ref_id: str = ""
    target_slot_id: str = ""
    display_name: str = ""
    status: str = ""


@dataclass
class MappedExecutionPlan:
    base_dir: Path
    mkdir_actions: list[MappedExecutionAction] = field(default_factory=list)
    move_actions: list[MappedExecutionAction] = field(default_factory=list)
    all_actions: list[MappedExecutionAction] = field(default_factory=list)


@dataclass
class ExecutionPlan:
    base_dir: Path
    mkdir_actions: list[ExecutionAction] = field(default_factory=list)
    move_actions: list[ExecutionAction] = field(default_factory=list)
    all_actions: list[ExecutionAction] = field(default_factory=list)


@dataclass
class PrecheckResult:
    can_execute: bool
    blocking_errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class ExecutionItemResult:
    action: ExecutionAction
    status: str
    message: str


@dataclass
class ExecutionReport:
    success_count: int
    failure_count: int
    results: list[ExecutionItemResult] = field(default_factory=list)


@dataclass
class ExecutionJournalItem:
    action_type: str
    status: str
    message: str
    raw: str = ""
    source_before: str | None = None
    target_after: str | None = None
    created_path: str | None = None
    item_id: str | None = None
    source_ref_id: str | None = None
    target_slot_id: str | None = None
    display_name: str | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "ExecutionJournalItem":
        return cls(**data)


@dataclass
class ExecutionJournal:
    execution_id: str
    target_dir: str
    created_at: str
    status: str
    items: list[ExecutionJournalItem] = field(default_factory=list)
    rollback_attempts: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "execution_id": self.execution_id,
            "target_dir": self.target_dir,
            "created_at": self.created_at,
            "status": self.status,
            "items": [
                {
                    "action_type": item.action_type,
                    "status": item.status,
                    "message": item.message,
                    "raw": item.raw,
                    "source_before": item.source_before,
                    "target_after": item.target_after,
                    "created_path": item.created_path,
                    "item_id": item.item_id,
                    "source_ref_id": item.source_ref_id,
                    "target_slot_id": item.target_slot_id,
                    "display_name": item.display_name,
                }
                for item in self.items
            ],
            "rollback_attempts": list(self.rollback_attempts),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ExecutionJournal":
        return cls(
            execution_id=data["execution_id"],
            target_dir=data["target_dir"],
            created_at=data["created_at"],
            status=data["status"],
            items=[ExecutionJournalItem.from_dict(item) for item in data.get("items", [])],
            rollback_attempts=list(data.get("rollback_attempts", [])),
        )
