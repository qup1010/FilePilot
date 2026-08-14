from __future__ import annotations

from dataclasses import dataclass, field, fields
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
    # 判定来源："ai"（模型分类）| "user"（用户手动指定），随 journal 留档
    decision_basis: str = ""


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
    decision_basis: str = ""


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


@dataclass(frozen=True)
class PrecheckItemSkip:
    """预检发现的单项跳过：该项不执行、留在原地，其余项照常放行。"""

    reason: str  # target_exists | source_missing | duplicate_target | self_subpath | parent_missing
    message: str
    item_id: str | None = None
    display_name: str | None = None
    source: str | None = None
    target: str | None = None

    def to_dict(self) -> dict:
        return {
            "reason": self.reason,
            "message": self.message,
            "item_id": self.item_id,
            "display_name": self.display_name,
            "source": self.source,
            "target": self.target,
        }


@dataclass
class PrecheckResult:
    can_execute: bool
    blocking_errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    item_skips: list[PrecheckItemSkip] = field(default_factory=list)


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
    skipped_count: int = 0


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
    # 文件身份（跨改名/挪动追踪的依据），仅 MOVE 且来源为文件时记录
    size_bytes: int | None = None
    mtime: float | None = None
    # 判定依据："rule"（命中用户规则）| "ai"（模型判断），由一键管线填充
    decision_basis: str | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "ExecutionJournalItem":
        known = {f.name for f in fields(cls)}
        return cls(**{key: value for key, value in data.items() if key in known})


@dataclass
class ExecutionJournal:
    execution_id: str
    target_dir: str
    created_at: str
    status: str
    items: list[ExecutionJournalItem] = field(default_factory=list)
    rollback_attempts: list[dict] = field(default_factory=list)
    # 执行时刻的规则快照（profile + 各目录 description），规则会演进，
    # 回看历史必须还能理解当时的分类依据
    rule_snapshot: dict | None = None

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
                    "size_bytes": item.size_bytes,
                    "mtime": item.mtime,
                    "decision_basis": item.decision_basis,
                }
                for item in self.items
            ],
            "rollback_attempts": list(self.rollback_attempts),
            "rule_snapshot": self.rule_snapshot,
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
            rule_snapshot=data.get("rule_snapshot"),
        )
