from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from file_pilot.app.models import OrganizerSession
    from file_pilot.app.session_service import OrganizerSessionService


class SessionLifecycleService:
    _SCANNING_RECOVERY_GRACE_SECONDS = 45

    def __init__(self, helpers: "OrganizerSessionService"):
        self.helpers = helpers

    def _scanning_session_recently_active(self, session: "OrganizerSession") -> bool:
        timestamp_text = str(session.updated_at or session.created_at or "").strip()
        if not timestamp_text:
            return False
        try:
            activity_at = datetime.fromisoformat(timestamp_text.replace("Z", "+00:00"))
        except ValueError:
            return False
        if activity_at.tzinfo is None:
            activity_at = activity_at.replace(tzinfo=timezone.utc)
        age_seconds = (datetime.now(timezone.utc) - activity_at).total_seconds()
        return age_seconds < self._SCANNING_RECOVERY_GRACE_SECONDS

    def abandon_session(self, session_id: str, *, emit_event_snapshot: bool = True) -> dict:
        session = self.helpers._load_or_raise(session_id)
        if session.stage in self.helpers._LOCKED_STAGES:
            self.recover_orphaned_locked_session(session)
            if session.stage in self.helpers._LOCKED_STAGES:
                raise RuntimeError("SESSION_LOCKED")
        session.stage = "abandoned"
        if emit_event_snapshot:
            self.helpers._sync_session_views(session)
        self.helpers.store.mark_session_abandoned(session)
        self.helpers._log_runtime_event("session.abandoned", session)
        self.helpers._write_session_debug_event("session.abandoned", session)
        if emit_event_snapshot:
            self.helpers._record_event("session.abandoned", session)
        if not emit_event_snapshot:
            return {}
        return self.helpers._build_snapshot(session)

    def resume_session(self, session_id: str):
        session = self.helpers._load_or_raise(session_id)
        self.helpers._ensure_schema_compatible_for_resume(session)
        lock_result = self.helpers.store.acquire_directory_lock(Path(session.target_dir), session.session_id)
        if not lock_result.acquired:
            raise RuntimeError("SESSION_LOCKED")

        if session.stage in self.helpers._LOCKED_STAGES:
            interrupted_during = session.stage
            if (
                self.helpers._is_locked_stage_active(session.session_id, interrupted_during)
                or (
                    interrupted_during == "scanning"
                    and (
                        self.helpers._is_scan_active(session.session_id)
                        or self.helpers.async_scanner.is_running(session.session_id)
                        or self._scanning_session_recently_active(session)
                    )
                )
            ):
                self.helpers._sync_session_views(session)
                self.helpers.store.save(session)
                self.helpers._log_runtime_event("session.resumed", session)
                self.helpers._write_session_debug_event("session.resumed", session)
                self.helpers._record_event("session.resumed", session)
                return session

            session.stage = "interrupted"
            session.integrity_flags["interrupted_during"] = interrupted_during
            session.last_journal_id = session.last_journal_id or self.helpers._latest_execution_id(Path(session.target_dir))

        if self.helpers._directory_changed(session):
            session.stage = "stale"
            session.stale_reason = "directory_changed"
            session.integrity_flags["is_stale"] = True
            self.helpers._sync_session_views(session)
            self.helpers.store.save(session)
            self.helpers._log_runtime_event("session.stale", session, reason="directory_changed")
            self.helpers._write_session_debug_event("session.stale", session, payload={"reason": "directory_changed"})
            self.helpers._record_event("session.stale", session)
            return session

        self.helpers._sync_session_views(session)
        self.helpers.store.save(session)
        self.helpers._log_runtime_event("session.resumed", session)
        self.helpers._write_session_debug_event("session.resumed", session)
        self.helpers._record_event("session.resumed", session)
        return session

    def recover_orphaned_locked_session(self, session: "OrganizerSession") -> None:
        if session.stage not in self.helpers._LOCKED_STAGES:
            return

        interrupted_during = session.stage
        if self.helpers._is_locked_stage_active(session.session_id, interrupted_during):
            return
        if interrupted_during == "scanning" and (
            self.helpers._is_scan_active(session.session_id)
            or self.helpers.async_scanner.is_running(session.session_id)
        ):
            return
        if interrupted_during == "scanning" and self._scanning_session_recently_active(session):
            return

        session.stage = "interrupted"
        session.integrity_flags["interrupted_during"] = interrupted_during
        session.last_error = session.last_error or f"{interrupted_during}_interrupted"
        session.last_journal_id = session.last_journal_id or self.helpers._latest_execution_id(Path(session.target_dir))
        self.helpers._sync_session_views(session)
        self.helpers.store.save(session)
        self.helpers._log_runtime_event("session.interrupted", session, interrupted_during=interrupted_during)
        self.helpers._write_session_debug_event(
            "session.interrupted",
            session,
            payload={"interrupted_during": interrupted_during},
        )
        self.helpers._record_event("session.interrupted", session)
