from __future__ import annotations

from dataclasses import dataclass, field

from file_pilot.shared.path_utils import split_relative_parts


@dataclass
class PlanMove:
    source: str
    target: str
    raw: str = ""

    @classmethod
    def from_dict(cls, data: dict) -> "PlanMove":
        return cls(
            source=data.get("source", ""),
            target=data.get("target", ""),
            raw=data.get("raw", ""),
        )

    def to_move_command(self) -> str:
        return self.raw or f'MOVE "{self.source}" "{self.target}"'


@dataclass
class PlanDirectoryRename:
    from_name: str
    to_name: str

    @classmethod
    def from_dict(cls, data: dict) -> "PlanDirectoryRename":
        return cls(
            from_name=data.get("from", ""),
            to_name=data.get("to", ""),
        )


@dataclass
class PlanDiff:
    directory_renames: list[PlanDirectoryRename] = field(default_factory=list)
    move_updates: list[PlanMove] = field(default_factory=list)
    unresolved_adds: list[str] = field(default_factory=list)
    unresolved_removals: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict) -> "PlanDiff":
        return cls(
            directory_renames=[PlanDirectoryRename.from_dict(item) for item in data.get("directory_renames", [])],
            move_updates=[PlanMove.from_dict(item) for item in data.get("move_updates", [])],
            unresolved_adds=list(data.get("unresolved_adds", [])),
            unresolved_removals=list(data.get("unresolved_removals", [])),
        )


@dataclass
class PendingPlan:
    directories: list[str] = field(default_factory=list)
    moves: list[PlanMove] = field(default_factory=list)
    user_constraints: list[str] = field(default_factory=list)
    unresolved_items: list[str] = field(default_factory=list)
    summary: str = ""

    @classmethod
    def from_dict(cls, data: dict) -> "PendingPlan":
        plan = cls(
            directories=list(data.get("directories", [])),
            moves=[PlanMove.from_dict(item) for item in data.get("moves", [])],
            user_constraints=list(data.get("user_constraints", [])),
            unresolved_items=list(data.get("unresolved_items", [])),
            summary=data.get("summary", ""),
        )
        return plan.with_derived_directories()

    def with_derived_directories(self) -> "PendingPlan":
        return PendingPlan(
            directories=derive_directories_from_moves(self.moves),
            moves=[PlanMove(source=move.source, target=move.target, raw=move.raw) for move in self.moves],
            user_constraints=list(self.user_constraints),
            unresolved_items=list(self.unresolved_items),
            summary=self.summary,
        )


@dataclass
class FinalPlan:
    directories: list[str] = field(default_factory=list)
    moves: list[PlanMove] = field(default_factory=list)
    unresolved_items: list[str] = field(default_factory=list)
    summary: str = ""

    @classmethod
    def from_dict(cls, data: dict) -> "FinalPlan":
        return cls(
            directories=list(data.get("directories", [])),
            moves=[PlanMove.from_dict(item) for item in data.get("moves", [])],
            unresolved_items=list(data.get("unresolved_items", [])),
            summary=data.get("summary", ""),
        )


@dataclass
class PlanDisplayRequest:
    focus: str = "summary"
    summary: str = ""
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            "focus": self.focus,
            "summary": self.summary,
            "reason": self.reason
        }


def derive_directories_from_moves(moves: list[PlanMove]) -> list[str]:
    directories = set()
    for move in moves:
        target_parts = split_relative_parts(move.target)
        if target_parts and len(target_parts) > 1:
            for i in range(1, len(target_parts)):
                directories.add("/".join(target_parts[:i]))
    return sorted(directories, key=lambda item: item.lower())
