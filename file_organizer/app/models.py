from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class LockResult:
    acquired: bool
    lock_owner_session_id: str | None = None
    reason: str = "acquired"


@dataclass
class OrganizerSession:
    session_id: str
    target_dir: str
    stage: str = "draft"
    messages: list[dict] = field(default_factory=list)
    scan_lines: str = ""
    pending_plan: dict = field(default_factory=dict)
    plan_snapshot: dict = field(default_factory=dict)
    user_constraints: list[str] = field(default_factory=list)
    scanner_progress: dict = field(default_factory=dict)
    assistant_message: dict | None = None
    precheck_summary: dict | None = None
    execution_report: dict | None = None
    rollback_report: dict | None = None
    last_journal_id: str | None = None
    integrity_flags: dict = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)
    stale_reason: str | None = None
    last_error: str | None = None
    summary: str = ""

    def touch(self) -> None:
        self.updated_at = utc_now_iso()

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "OrganizerSession":
        return cls(
            session_id=data["session_id"],
            target_dir=data["target_dir"],
            stage=data.get("stage", "draft"),
            messages=list(data.get("messages", [])),
            scan_lines=data.get("scan_lines", ""),
            pending_plan=dict(data.get("pending_plan", {})),
            plan_snapshot=dict(data.get("plan_snapshot", {})),
            user_constraints=list(data.get("user_constraints", [])),
            scanner_progress=dict(data.get("scanner_progress", {})),
            assistant_message=data.get("assistant_message"),
            precheck_summary=data.get("precheck_summary"),
            execution_report=data.get("execution_report"),
            rollback_report=data.get("rollback_report"),
            last_journal_id=data.get("last_journal_id"),
            integrity_flags=dict(data.get("integrity_flags", {})),
            created_at=data.get("created_at", utc_now_iso()),
            updated_at=data.get("updated_at", utc_now_iso()),
            stale_reason=data.get("stale_reason"),
            last_error=data.get("last_error"),
            summary=data.get("summary", ""),
        )


@dataclass
class CreateSessionResult:
    mode: str
    session: OrganizerSession | None = None
    restorable_session: OrganizerSession | None = None


@dataclass
class SessionMutationResult:
    session_snapshot: dict
    assistant_message: dict | None = None
    changed: bool = True
    warnings: list[str] = field(default_factory=list)
