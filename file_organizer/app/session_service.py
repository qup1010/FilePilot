from __future__ import annotations

from queue import Queue
from pathlib import Path

from file_organizer.analysis import service as analysis_service
from file_organizer.app.async_scanner import AsyncScanner
from file_organizer.app.models import CreateSessionResult, OrganizerSession, SessionMutationResult
from file_organizer.app.session_store import SessionStore
from file_organizer.execution import service as execution_service
from file_organizer.organize import service as organize_service
from file_organizer.organize.models import FinalPlan, PendingPlan, PlanMove
from file_organizer.rollback import service as rollback_service


class OrganizerSessionService:
    _TERMINAL_STAGES = {"abandoned", "completed", "stale"}
    _LOCKED_STAGES = {"scanning", "executing", "rolling_back"}

    def __init__(self, store: SessionStore, scanner: AsyncScanner | None = None):
        self.store = store
        self.async_scanner = scanner or AsyncScanner()
        self._event_log: dict[str, list[dict]] = {}
        self._subscribers: dict[str, list[Queue]] = {}

    def create_session(self, target_dir: str, resume_if_exists: bool) -> CreateSessionResult:
        path = Path(target_dir)
        latest = self.store.find_latest_by_directory(path)
        if latest is not None and latest.stage not in self._TERMINAL_STAGES:
            if resume_if_exists:
                return CreateSessionResult(mode="resume_available", restorable_session=latest)
            raise RuntimeError("SESSION_LOCKED")

        session = self.store.create(path)
        lock_result = self.store.acquire_directory_lock(path, session.session_id)
        if not lock_result.acquired:
            raise RuntimeError("SESSION_LOCKED")

        self.store.save(session)
        self._record_event("session.created", session)
        return CreateSessionResult(mode="created", session=session)

    def abandon_session(self, session_id: str) -> dict:
        session = self._load_or_raise(session_id)
        session.stage = "abandoned"
        self.store.save(session)
        self.store.mark_abandoned(session_id)
        self.store.release_directory_lock(Path(session.target_dir), session_id)
        self._record_event("session.abandoned", session)
        return self._build_snapshot(session)

    def resume_session(self, session_id: str) -> OrganizerSession:
        session = self._load_or_raise(session_id)
        lock_result = self.store.acquire_directory_lock(Path(session.target_dir), session.session_id)
        if not lock_result.acquired:
            raise RuntimeError("SESSION_LOCKED")

        if session.stage in {"scanning", "executing"}:
            interrupted_during = session.stage
            session.stage = "interrupted"
            session.integrity_flags["interrupted_during"] = interrupted_during
            session.last_journal_id = session.last_journal_id or self._latest_execution_id(Path(session.target_dir))

        if self._directory_changed(session):
            session.stage = "stale"
            session.stale_reason = "directory_changed"
            session.integrity_flags["is_stale"] = True
            self.store.save(session)
            self._record_event("session.stale", session)
            return session

        self.store.save(session)
        self._record_event("session.resumed", session)
        return session

    def refresh_session(self, session_id: str, scan_runner=None) -> SessionMutationResult:
        session = self._load_or_raise(session_id)
        if session.stage in self._LOCKED_STAGES:
            raise RuntimeError("SESSION_STAGE_CONFLICT")
        old_snapshot_items = {
            item["item_id"]: dict(item)
            for item in session.plan_snapshot.get("items", [])
            if item.get("item_id")
        }
        old_pending = self._pending_plan_from_session(session)
        scan_lines = self._run_scan_sync(session, scan_runner or self._default_scan_runner)
        current_ids = {entry["item_id"] for entry in self._scan_entries(scan_lines)}
        kept_moves = [move for move in old_pending.moves if move.source in current_ids]
        kept_unresolved = [item for item in old_pending.unresolved_items if item in current_ids]
        directories = self._directories_from_moves(kept_moves)
        rebuilt_pending = PendingPlan(
            directories=directories,
            moves=kept_moves,
            user_constraints=list(old_pending.user_constraints),
            unresolved_items=kept_unresolved,
            summary=old_pending.summary,
        )
        invalidated_items = []
        for item_id, item in old_snapshot_items.items():
            if item_id not in current_ids:
                invalidated_items.append(
                    {
                        "item_id": item_id,
                        "display_name": item.get("display_name", item_id),
                        "source_relpath": item.get("source_relpath", item_id),
                        "target_relpath": item.get("target_relpath"),
                        "status": "invalidated",
                    }
                )

        session.scan_lines = scan_lines
        session.pending_plan = self._pending_plan_to_dict(rebuilt_pending)
        session.plan_snapshot = self._plan_snapshot(rebuilt_pending, {"diff_summary": ["refresh"]})
        session.plan_snapshot["invalidated_items"] = invalidated_items
        session.integrity_flags["is_stale"] = False
        session.integrity_flags["has_invalidated_items"] = bool(invalidated_items)
        session.stale_reason = None
        session.stage = "planning"
        session.precheck_summary = None
        self.store.save(session)
        self._record_event("plan.updated", session)
        return SessionMutationResult(session_snapshot=self._build_snapshot(session))

    def start_scan(self, session_id: str, scan_runner=None) -> OrganizerSession:
        session = self._load_or_raise(session_id)
        self._ensure_not_locked(session)
        if scan_runner is not None:
            self._run_scan_sync(session, scan_runner)
            return self._load_or_raise(session_id)

        if session.stage not in {"draft", "stale", "interrupted", "planning"}:
            raise RuntimeError("SESSION_STAGE_CONFLICT")

        session.stage = "scanning"
        session.scanner_progress = {
            "status": "running",
            "processed_count": 0,
            "total_count": self._count_visible_entries(Path(session.target_dir)),
            "current_item": None,
            "recent_analysis_items": [],
        }
        self.store.save(session)
        self._record_event("scan.started", session)
        def on_scan_event(event_type: str, data: dict):
            # Mirror specific low-level events to the frontend via SSE
            if event_type in {"tool_start", "model_wait_start"}:
                self._record_event("scan.action", session_id=session.session_id, action=data)
            elif event_type == "ai_chunk":
                self._record_event("plan.ai_typing", session_id=session.session_id, content=data.get("content"))

        self.async_scanner.start(
            session_id=session.session_id,
            target_dir=Path(session.target_dir),
            run_scan=lambda d: self._default_scan_runner(d, event_handler=on_scan_event),
            on_complete=self._finish_async_scan,
            on_error=self._fail_async_scan,
        )
        return session

    def get_snapshot(self, session_id: str) -> dict:
        session = self._load_or_raise(session_id)
        return self._build_snapshot(session)

    def read_events(self, session_id: str) -> list[dict]:
        snapshot = self.get_snapshot(session_id)
        events = [{"event_type": "session.snapshot", "session_id": session_id, "stage": snapshot["stage"], "session_snapshot": snapshot}]
        events.extend(self._event_log.get(session_id, []))
        return events

    def subscribe(self, session_id: str) -> Queue:
        queue = Queue()
        self._subscribers.setdefault(session_id, []).append(queue)
        return queue

    def unsubscribe(self, session_id: str, queue: Queue) -> None:
        subscribers = self._subscribers.get(session_id, [])
        if queue in subscribers:
            subscribers.remove(queue)
        if not subscribers and session_id in self._subscribers:
            self._subscribers.pop(session_id, None)

    def update_item_target(
        self,
        session_id: str,
        item_id: str,
        target_dir: str | None,
        move_to_review: bool,
    ) -> SessionMutationResult:
        session = self._load_or_raise(session_id)
        self._ensure_mutable_stage(session)

        pending = self._pending_plan_from_session(session)
        file_name = Path(item_id).name
        target_relpath = f"Review/{file_name}" if move_to_review else f"{(target_dir or '').strip('/')}/{file_name}".lstrip("/")
        if not target_relpath:
            raise ValueError("target_dir_required")

        found = False
        updated_moves: list[PlanMove] = []
        for move in pending.moves:
            if move.source == item_id:
                updated_moves.append(PlanMove(source=move.source, target=target_relpath, raw=move.raw))
                found = True
            else:
                updated_moves.append(move)

        if not found:
            raise KeyError(item_id)

        pending = PendingPlan(
            directories=self._directories_from_moves(updated_moves),
            moves=updated_moves,
            user_constraints=list(pending.user_constraints),
            unresolved_items=[item for item in pending.unresolved_items if item != item_id],
            summary=pending.summary,
        )
        session.pending_plan = self._pending_plan_to_dict(pending)
        session.plan_snapshot = self._plan_snapshot(pending, {"diff_summary": [f"update:{item_id}"]})
        session.stage = "planning"
        self.store.save(session)
        self._record_event("plan.updated", session)
        return SessionMutationResult(session_snapshot=self._build_snapshot(session))

    def submit_user_intent(self, session_id: str, content: str) -> SessionMutationResult:
        session = self._load_or_raise(session_id)
        self._ensure_mutable_stage(session)
        session.messages.append({"role": "user", "content": content})
        pending_plan = self._pending_plan_from_session(session)
        def on_plan_event(event_type: str, data: dict):
            if event_type in {"model_wait_start", "tool_start"}:
                self._record_event("plan.action", session_id=session.session_id, action=data)
            elif event_type == "ai_chunk":
                self._record_event("plan.ai_typing", session_id=session.session_id, content=data.get("content"))

        assistant_message, cycle_result = organize_service.run_organizer_cycle(
            messages=list(session.messages),
            scan_lines=session.scan_lines,
            pending_plan=pending_plan,
            user_constraints=list(session.user_constraints),
            event_handler=on_plan_event,
        )
        updated_pending = cycle_result.get("pending_plan", pending_plan) if cycle_result else pending_plan
        session.pending_plan = self._pending_plan_to_dict(updated_pending)
        session.plan_snapshot = self._plan_snapshot(updated_pending, cycle_result or {})
        session.assistant_message = {"role": "assistant", "content": assistant_message}
        session.messages.append(session.assistant_message)
        session.summary = updated_pending.summary
        session.stage = "planning" if not (cycle_result or {}).get("is_valid") else "ready_for_precheck"
        self.store.save(session)
        self._record_event("plan.updated", session)
        return SessionMutationResult(
            session_snapshot=self._build_snapshot(session),
            assistant_message=session.assistant_message,
        )

    def run_precheck(self, session_id: str) -> SessionMutationResult:
        session = self._load_or_raise(session_id)
        self._ensure_mutable_stage(session)
        final_plan = self._final_plan_from_session(session)
        plan = execution_service.build_execution_plan(final_plan, Path(session.target_dir))
        precheck = execution_service.validate_execution_preconditions(plan)
        session.precheck_summary = {
            "can_execute": precheck.can_execute,
            "blocking_errors": list(precheck.blocking_errors),
            "warnings": list(precheck.warnings),
            "mkdir_preview": [action.target.relative_to(plan.base_dir).as_posix() for action in plan.mkdir_actions],
            "move_preview": [
                {
                    "source": action.source.relative_to(plan.base_dir).as_posix(),
                    "target": action.target.relative_to(plan.base_dir).as_posix(),
                }
                for action in plan.move_actions
                if action.source is not None
            ],
        }
        session.stage = "ready_to_execute" if precheck.can_execute else "planning"
        self.store.save(session)
        self._record_event("precheck.ready", session)
        return SessionMutationResult(session_snapshot=self._build_snapshot(session))

    def execute(self, session_id: str, confirm: bool) -> SessionMutationResult:
        if not confirm:
            raise ValueError("confirmation_required")

        session = self._load_or_raise(session_id)
        if session.stage != "ready_to_execute":
            raise RuntimeError("SESSION_STAGE_CONFLICT")

        session.stage = "executing"
        self.store.save(session)
        self._record_event("execution.started", session)

        final_plan = self._final_plan_from_session(session)
        plan = execution_service.build_execution_plan(final_plan, Path(session.target_dir))
        report = execution_service.execute_plan(plan)
        journal_id = self._latest_execution_id(Path(session.target_dir))
        if not journal_id:
            session.stage = "interrupted"
            session.last_error = "missing_execution_journal"
            self.store.save(session)
            self._record_event("session.interrupted", session)
            return SessionMutationResult(session_snapshot=self._build_snapshot(session))

        session.execution_report = {
            "execution_id": journal_id,
            "journal_id": journal_id,
            "success_count": report.success_count,
            "failure_count": report.failure_count,
            "status": "success" if report.failure_count == 0 else "partial_failure",
            "has_cleanup_candidates": False,
            "cleanup_candidate_count": 0,
        }
        session.last_journal_id = journal_id
        session.stage = "completed"
        self.store.save(session)
        self.store.release_directory_lock(Path(session.target_dir), session.session_id)
        self._record_event("execution.completed", session)
        return SessionMutationResult(session_snapshot=self._build_snapshot(session))

    def rollback(self, session_id: str, confirm: bool) -> SessionMutationResult:
        if not confirm:
            raise ValueError("confirmation_required")

        session = self._load_or_raise(session_id)
        if session.stage not in {"completed", "interrupted"}:
            raise RuntimeError("SESSION_STAGE_CONFLICT")

        lock_result = self.store.acquire_directory_lock(Path(session.target_dir), session.session_id)
        if not lock_result.acquired:
            raise RuntimeError("SESSION_LOCKED")

        session.stage = "rolling_back"
        self.store.save(session)
        self._record_event("rollback.started", session)

        journal = rollback_service.load_latest_execution_for_directory(Path(session.target_dir))
        if journal is None:
            raise FileNotFoundError("latest_execution")

        plan = rollback_service.build_rollback_plan(journal)
        report = rollback_service.execute_rollback_plan(plan)
        rollback_service.finalize_rollback_state(journal, report)
        session.rollback_report = {
            "journal_id": journal.execution_id,
            "restored_from_execution_id": journal.execution_id,
            "success_count": report.success_count,
            "failure_count": report.failure_count,
            "status": "success" if report.failure_count == 0 else "partial_failure",
        }
        session.last_journal_id = journal.execution_id
        session.stage = "stale"
        session.integrity_flags["is_stale"] = True
        self.store.save(session)
        self._record_event("rollback.completed", session)
        return SessionMutationResult(session_snapshot=self._build_snapshot(session))

    def list_history(self) -> list[dict]:
        from file_organizer.shared import config
        import json
        executions_dir = config.EXECUTION_LOG_DIR
        if not executions_dir.exists():
            return []
        
        history = []
        for path in executions_dir.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                history.append({
                    "execution_id": data["execution_id"],
                    "target_dir": data["target_dir"],
                    "status": data["status"],
                    "created_at": data["created_at"],
                    "item_count": len(data.get("items", [])),
                })
            except (json.JSONDecodeError, KeyError):
                continue
        
        # Sort by creation time descending
        history.sort(key=lambda x: x["created_at"], reverse=True)
        return history

    def get_journal_summary(self, session_id: str) -> dict:
        session = self._load_or_raise(session_id)
        journal_id = session.last_journal_id or self._latest_execution_id(Path(session.target_dir))
        if not journal_id:
            raise FileNotFoundError("latest_execution")
        journal = execution_service.load_execution_journal(journal_id)
        if journal is None:
            raise FileNotFoundError("latest_execution")
        return {
            "journal_id": journal.execution_id,
            "execution_id": journal.execution_id,
            "target_dir": journal.target_dir,
            "status": journal.status,
            "created_at": journal.created_at,
            "item_count": len(journal.items),
            "success_count": sum(1 for item in journal.items if item.status == "success"),
            "failure_count": sum(1 for item in journal.items if item.status == "failed"),
            "rollback_attempt_count": len(journal.rollback_attempts),
        }

    def cleanup_empty_dirs(self, session_id: str) -> dict:
        session = self._load_or_raise(session_id)
        if session.stage != "completed":
            raise RuntimeError("SESSION_STAGE_CONFLICT")
        final_plan = self._final_plan_from_session(session)
        plan = execution_service.build_execution_plan(final_plan, Path(session.target_dir))
        empty_dirs = execution_service.get_empty_source_dirs(plan)
        if not empty_dirs:
            empty_dirs = [
                path
                for path in (plan.base_dir / directory for directory in final_plan.directories)
                if path.exists() and path.is_dir() and not any(path.iterdir())
            ]
        cleaned = execution_service.cleanup_empty_dirs(empty_dirs)
        if session.execution_report is not None:
            session.execution_report["has_cleanup_candidates"] = False
            session.execution_report["cleanup_candidate_count"] = max(0, len(empty_dirs) - len(cleaned))
        self.store.save(session)
        self._record_event("cleanup.completed", session, cleaned_count=len(cleaned))
        return {
            "session_id": session_id,
            "cleaned_count": len(cleaned),
            "session_snapshot": self._build_snapshot(session),
        }

    def _default_scan_runner(self, target_dir: Path, event_handler=None) -> str:
        return analysis_service.run_analysis_cycle(target_dir, event_handler=event_handler)

    def _finish_async_scan(self, session_id: str, scan_lines: str) -> None:
        session = self._load_or_raise(session_id)
        if session.stage != "scanning":
            return
        all_entries = self._scan_entries(scan_lines)
        session.scan_lines = scan_lines or ""
        recent_items = all_entries[-5:]
        session.scanner_progress = {
            "status": "completed",
            "processed_count": len(all_entries),
            "total_count": self._count_visible_entries(Path(session.target_dir)),
            "current_item": recent_items[-1]["display_name"] if recent_items else None,
            "recent_analysis_items": recent_items,
        }
        session.stage = "planning"
        
        # Initialize messages if empty
        if not session.messages:
            session.messages = organize_service.build_initial_messages(session.scan_lines)
            
        self.store.save(session)
        self._record_event("scan.completed", session)

        # Trigger initial organization cycle automatically if no plan suggestion yet
        if not session.assistant_message and not (session.plan_snapshot or {}).get("moves"):
            def on_plan_event(event_type: str, data: dict):
                if event_type in {"model_wait_start", "tool_start"}:
                    self._record_event("plan.action", session_id=session.session_id, action=data)
                elif event_type == "ai_chunk":
                    self._record_event("plan.ai_typing", session_id=session.session_id, content=data.get("content"))

            try:
                assistant_message, cycle_result = organize_service.run_organizer_cycle(
                    messages=list(session.messages),
                    scan_lines=session.scan_lines,
                    pending_plan=self._pending_plan_from_session(session),
                    user_constraints=list(session.user_constraints),
                    event_handler=on_plan_event,
                )
                # NOTE: 即使 content 为空字符串也必须追加，否则后续对话上下文断裂
                session.assistant_message = {"role": "assistant", "content": assistant_message or ""}
                session.messages.append(session.assistant_message)
                
                if cycle_result:
                    updated_pending = cycle_result.get("pending_plan")
                    if updated_pending:
                        session.pending_plan = self._pending_plan_to_dict(updated_pending)
                        session.plan_snapshot = self._plan_snapshot(updated_pending, cycle_result)
                        session.summary = updated_pending.summary
                        
                    if cycle_result.get("is_valid"):
                        session.stage = "ready_for_precheck"
                
                self.store.save(session)
                self._record_event("plan.updated", session)
            except Exception as exc:
                # Fail silently for auto-planning, log it
                import traceback
                traceback.print_exc()
                session.last_error = f"自动规划失败: {str(exc)}"
                session.stage = "interrupted"
                self.store.save(session)
                self._record_event("plan.updated", session)

    def _fail_async_scan(self, session_id: str, exc: Exception) -> None:
        session = self._load_or_raise(session_id)
        session.stage = "interrupted"
        session.last_error = str(exc)
        session.scanner_progress = {"status": "failed", "message": str(exc)}
        self.store.save(session)
        self._record_event("session.error", session)

    def _run_scan_sync(self, session: OrganizerSession, scan_runner) -> str:
        session.stage = "scanning"
        session.scanner_progress = {
            "status": "running",
            "processed_count": 0,
            "total_count": self._count_visible_entries(Path(session.target_dir)),
            "current_item": None,
            "recent_analysis_items": [],
        }
        self.store.save(session)
        self._record_event("scan.started", session)
        result = scan_runner(Path(session.target_dir))
        all_entries = self._scan_entries(result)
        recent_items = all_entries[-5:]
        session.scan_lines = result or ""
        session.stage = "planning"
        session.scanner_progress = {
            "status": "completed",
            "processed_count": len(all_entries),
            "total_count": self._count_visible_entries(Path(session.target_dir)),
            "current_item": recent_items[-1]["display_name"] if recent_items else None,
            "recent_analysis_items": recent_items,
        }
        self.store.save(session)
        self._record_event("scan.completed", session)
        return session.scan_lines

    def _build_snapshot(self, session: OrganizerSession) -> dict:
        return {
            "session_id": session.session_id,
            "target_dir": session.target_dir,
            "stage": session.stage,
            "summary": session.summary,
            "assistant_message": session.assistant_message,
            "scanner_progress": dict(session.scanner_progress),
            "plan_snapshot": dict(session.plan_snapshot),
            "precheck_summary": session.precheck_summary,
            "execution_report": session.execution_report,
            "rollback_report": session.rollback_report,
            "last_journal_id": session.last_journal_id,
            "integrity_flags": dict(session.integrity_flags),
            "available_actions": self._available_actions_for(session.stage),
            "updated_at": session.updated_at,
            "stale_reason": session.stale_reason,
            "last_error": session.last_error,
        }

    def _available_actions_for(self, stage: str) -> list[str]:
        if stage == "draft":
            return ["scan", "abandon"]
        if stage in self._LOCKED_STAGES:
            return ["view_journal"] if stage != "scanning" else []
        if stage in {"stale", "interrupted"}:
            return ["refresh", "view_journal", "abandon"]
        if stage == "ready_to_execute":
            return ["execute", "abandon", "view_journal"]
        if stage == "completed":
            return ["rollback", "view_journal", "cleanup_empty_dirs"]
        return ["submit_intent", "update_item", "precheck", "abandon"]

    def _record_event(self, event_type: str, session: OrganizerSession | None = None, session_id: str | None = None, **extra) -> None:
        sid = session_id or (session.session_id if session else None)
        stage = extra.get("stage") or (session.stage if session else "unknown")
        
        payload = {
            "event_type": event_type,
            "session_id": sid,
            "stage": stage,
        }
        
        # Only build heavy snapshot if it's a state-change event
        if session and event_type not in {"scan.action", "plan.action", "plan.ai_typing"}:
            payload["session_snapshot"] = self._build_snapshot(session)
            
        payload.update(extra)
        
        if sid:
            events = self._event_log.setdefault(sid, [])
            events.append(payload)
            if len(events) > 50:
                del events[:-50]
            for subscriber in self._subscribers.get(sid, []):
                subscriber.put(payload)

    def _load_or_raise(self, session_id: str) -> OrganizerSession:
        session = self.store.load(session_id)
        if session is not None:
            return session
            
        # Try to restore from execution journal if session file is missing
        journal = execution_service.load_execution_journal(session_id)
        if journal:
            session = OrganizerSession(
                session_id=journal.execution_id,
                target_dir=journal.target_dir,
                stage="completed",
                last_journal_id=journal.execution_id,
            )
            # Add a flag to indicate this is a virtual session from history
            session.integrity_flags["is_history_virtual"] = True
            return session
            
        raise FileNotFoundError(session_id)

    def _ensure_not_locked(self, session: OrganizerSession) -> None:
        if session.stage in self._LOCKED_STAGES:
            raise RuntimeError("SESSION_STAGE_CONFLICT")

    def _ensure_mutable_stage(self, session: OrganizerSession) -> None:
        self._ensure_not_locked(session)
        if session.stage == "completed":
            raise RuntimeError("SESSION_STAGE_CONFLICT")

    def _final_plan_from_session(self, session: OrganizerSession) -> FinalPlan:
        pending = session.pending_plan or {}
        return FinalPlan(
            directories=list(pending.get("directories", [])),
            moves=[
                PlanMove(source=move["source"], target=move["target"], raw=move.get("raw", ""))
                for move in pending.get("moves", [])
            ],
            unresolved_items=list(pending.get("unresolved_items", [])),
            summary=pending.get("summary", ""),
        )

    def _pending_plan_from_session(self, session: OrganizerSession) -> PendingPlan:
        pending = session.pending_plan or {}
        return PendingPlan(
            directories=list(pending.get("directories", [])),
            moves=[
                PlanMove(source=move["source"], target=move["target"], raw=move.get("raw", ""))
                for move in pending.get("moves", [])
            ],
            user_constraints=list(pending.get("user_constraints", [])),
            unresolved_items=list(pending.get("unresolved_items", [])),
            summary=pending.get("summary", ""),
        )

    def _pending_plan_to_dict(self, pending: PendingPlan) -> dict:
        return {
            "directories": list(pending.directories),
            "moves": [
                {"source": move.source, "target": move.target, "raw": move.raw}
                for move in pending.moves
            ],
            "user_constraints": list(pending.user_constraints),
            "unresolved_items": list(pending.unresolved_items),
            "summary": pending.summary,
        }

    def _plan_snapshot(self, pending: PendingPlan, cycle_result: dict) -> dict:
        items = []
        grouped: dict[str, list[dict]] = {}
        for move in pending.moves:
            directory = move.target.rsplit("/", 1)[0] if "/" in move.target else "."
            status = "review" if move.target.startswith("Review/") else "planned"
            if move.source in pending.unresolved_items:
                status = "unresolved"
            item = {
                "item_id": move.source,
                "display_name": Path(move.source).name,
                "source_relpath": move.source,
                "target_relpath": move.target,
                "status": status,
            }
            items.append(item)
            grouped.setdefault(directory, []).append(item)
        groups = [
            {"directory": directory, "count": len(group_items), "items": group_items}
            for directory, group_items in sorted(grouped.items())
        ]
        return {
            "summary": pending.summary,
            "items": items,
            "groups": groups,
            "unresolved_items": list(pending.unresolved_items),
            "review_items": [item for item in items if item["status"] == "review"],
            "invalidated_items": [],
            "change_highlights": list(cycle_result.get("diff_summary", [])),
            "stats": {
                "directory_count": len(groups),
                "move_count": len(pending.moves),
                "unresolved_count": len(pending.unresolved_items),
            },
            "readiness": {"can_precheck": not pending.unresolved_items},
        }

    def _latest_execution_id(self, target_dir: Path) -> str | None:
        journal = rollback_service.load_latest_execution_for_directory(target_dir)
        return journal.execution_id if journal else None

    def _directory_changed(self, session: OrganizerSession) -> bool:
        if not session.scan_lines:
            return False

        path = Path(session.target_dir)
        if not path.exists():
            return True

        current_entries = sorted(entry.name for entry in path.iterdir() if not entry.name.startswith("."))
        previous_entries = sorted(entry["item_id"] for entry in self._scan_entries(session.scan_lines))
        return current_entries != previous_entries

    def _scan_entries(self, scan_lines: str) -> list[dict]:
        entries: list[dict] = []
        for raw_line in (scan_lines or "").splitlines():
            parts = [part.strip() for part in raw_line.split("|")]
            if len(parts) < 3 or not parts[0]:
                continue
            entries.append(
                {
                    "item_id": parts[0],
                    "display_name": Path(parts[0]).name,
                    "source_relpath": parts[0],
                    "suggested_purpose": parts[1],
                    "summary": parts[2],
                }
            )
        return entries

    def _directories_from_moves(self, moves: list[PlanMove]) -> list[str]:
        directories = {move.target.rsplit("/", 1)[0] for move in moves if "/" in move.target}
        return sorted(directory for directory in directories if directory and directory != ".")

    def _count_visible_entries(self, target_dir: Path) -> int:
        if not target_dir.exists():
            return 0
        return sum(1 for entry in target_dir.iterdir() if not entry.name.startswith("."))
