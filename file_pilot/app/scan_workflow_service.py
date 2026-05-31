import threading
from dataclasses import asdict
from pathlib import Path
from typing import TYPE_CHECKING

from file_pilot.app.models import SessionMutationResult
from file_pilot.app.session_constants import (
    SESSION_STAGE_CONFLICT,
    STAGE_DRAFT,
    STAGE_INTERRUPTED,
    STAGE_PLANNING,
    STAGE_SCANNING,
    STAGE_SELECTING_INCREMENTAL_SCOPE,
    STAGE_STALE,
    ensure_stage,
    ensure_stage_in,
    is_locked_stage,
    is_stage,
)
from file_pilot.organize.models import PendingPlan

if TYPE_CHECKING:
    from file_pilot.app.session_service import OrganizerSessionService


class ScanWorkflowService:
    def __init__(self, helpers: "OrganizerSessionService"):
        self.helpers = helpers

    def refresh_session(self, session_id: str, scan_runner=None) -> SessionMutationResult:
        session = self.helpers._load_or_raise(session_id)
        self.helpers._ensure_schema_compatible_for_resume(session)
        self.helpers._ensure_refreshable_stage(session)
        if is_locked_stage(session.stage):
            raise RuntimeError(SESSION_STAGE_CONFLICT)

        is_incremental = self.helpers._normalize_organize_mode(session.organize_mode) == "incremental"

        if is_incremental and is_stage(session.stage, STAGE_SELECTING_INCREMENTAL_SCOPE):
            self.helpers._run_incremental_target_discovery(
                session,
                scan_runner or self.helpers._incremental_root_discovery_runner,
            )
            session.plan_snapshot = self.helpers._plan_snapshot_payload(
                self.helpers._plan_snapshot(PendingPlan(), {"diff_summary": ["refresh"]}, scan_lines=session.scan_lines, session=session)
            )
            session.integrity_flags["is_stale"] = False
            session.integrity_flags["has_invalidated_items"] = False
            session.stale_reason = None
            self.helpers._sync_session_views(session)
            self.helpers.store.save(session)
            self.helpers._log_runtime_event("session.refreshed", session, invalidated_count=0)
            self.helpers._write_session_debug_event(
                "session.refreshed",
                session,
                payload={"invalidated_count": 0, "incremental_scope_reset": True},
            )
            self.helpers._record_event("plan.updated", session)
            return SessionMutationResult(session_snapshot=self.helpers._build_snapshot(session))

        existing_snapshot = self.helpers._plan_snapshot_payload(session.plan_snapshot)
        old_snapshot_items = {
            item.source_relpath or item.item_id: asdict(item)
            for item in existing_snapshot.items
            if item.source_relpath or item.item_id
        }
        old_pending = self.helpers._pending_plan_from_session(session)

        if is_incremental:
            selection = self.helpers._incremental_selection_snapshot(session)
            selected_targets = list(selection.get("target_directories") or [])
            if self.helpers._can_use_single_directory_scan(session):
                discovery_scan_lines = self.helpers._incremental_root_discovery_runner(Path(session.target_dir))
            else:
                discovery_scan_lines, _ = self.helpers._scan_source_collection(
                    session,
                    scan_runner or self.helpers._default_scan_runner,
                    session_id=session.session_id,
                )
            available_root_dirs = set(self.helpers._root_directory_options_from_scan(discovery_scan_lines))
            if not selected_targets or any(item not in available_root_dirs for item in selected_targets):
                session.scan_lines = discovery_scan_lines
                session.messages = []
                session.assistant_message = None
                session.pending_plan = self.helpers._pending_plan_payload(PendingPlan())
                session.plan_snapshot = self.helpers._plan_snapshot_payload(
                    self.helpers._plan_snapshot(PendingPlan(), {"diff_summary": ["refresh"]}, scan_lines=discovery_scan_lines, session=session)
                )
                session.precheck_summary = None
                session.last_ai_pending_plan = None
                session.summary = ""
                session.planner_items = []
                session.inspection_context = {}
                session.source_tree_entries = self.helpers._build_source_tree_entries(
                    Path(session.target_dir),
                    discovery_scan_lines,
                    planner_items=[],
                )
                self.helpers._set_incremental_selection_pending(session, discovery_scan_lines)
                session.stage = STAGE_SELECTING_INCREMENTAL_SCOPE
                session.integrity_flags["is_stale"] = False
                session.integrity_flags["has_invalidated_items"] = False
                session.stale_reason = None
                self.helpers._sync_session_views(session)
                self.helpers.store.save(session)
                self.helpers._log_runtime_event("session.refreshed", session, invalidated_count=0)
                self.helpers._write_session_debug_event(
                    "session.refreshed",
                    session,
                    payload={"invalidated_count": 0, "incremental_scope_reset": True, "reason": "target_dirs_changed"},
                )
                self.helpers._record_event("plan.updated", session)
                return SessionMutationResult(session_snapshot=self.helpers._build_snapshot(session))

            if self.helpers._can_use_single_directory_scan(session):
                full_scan_lines = self.helpers._call_with_optional_session_id(
                    scan_runner or self.helpers._default_scan_runner,
                    Path(session.target_dir),
                    session_id=session.session_id,
                )
            else:
                full_scan_lines, _ = self.helpers._scan_source_collection(
                    session,
                    scan_runner or self.helpers._default_scan_runner,
                    session_id=session.session_id,
                )
            active_scan_lines = self.helpers._filter_incremental_pending_scan_lines(full_scan_lines, selected_targets)
            session.incremental_selection = {
                **selection,
                "status": "ready",
                "root_directory_options": sorted(available_root_dirs),
                "target_directories": selected_targets,
                "target_directory_tree": [
                    {"relpath": item, "name": Path(str(item)).name or item, "children": []}
                    for item in selected_targets
                ],
                "pending_items_count": len(self.helpers._scan_entries(active_scan_lines)),
                "source_scan_completed": True,
            }
        else:
            full_scan_lines = self.helpers._run_scan_sync(session, scan_runner or self.helpers._default_scan_runner)
            active_scan_lines = full_scan_lines

        if self.helpers._is_empty_scan_result_completed(session):
            self.helpers._sync_session_views(session)
            self.helpers.store.save(session)
            self.helpers._log_runtime_event("session.refreshed", session, invalidated_count=0, empty_result=True)
            self.helpers._write_session_debug_event(
                "session.refreshed",
                session,
                payload={"invalidated_count": 0, "is_incremental": is_incremental, "empty_result": True},
            )
            self.helpers._record_event("plan.updated", session)
            return SessionMutationResult(session_snapshot=self.helpers._build_snapshot(session))

        session.scan_lines = active_scan_lines
        self.helpers._ensure_planner_items(session, active_scan_lines)

        current_entries = self.helpers._scan_entries(active_scan_lines)
        current_ids = {entry["source_relpath"] for entry in current_entries}
        kept_moves = [move for move in old_pending.moves if move.source in current_ids]
        kept_unresolved = [item for item in old_pending.unresolved_items if item in current_ids]

        directories = self.helpers._directories_from_moves(kept_moves)
        rebuilt_pending = PendingPlan(
            directories=directories,
            moves=kept_moves,
            user_constraints=list(old_pending.user_constraints),
            unresolved_items=kept_unresolved,
            summary=old_pending.summary,
        )

        session.planning_schema_version = self.helpers.CURRENT_PLANNING_SCHEMA_VERSION if hasattr(self.helpers, "CURRENT_PLANNING_SCHEMA_VERSION") else 5
        session.pending_plan = self.helpers._pending_plan_payload(rebuilt_pending)
        invalidated_items = [
            self.helpers._normalize_plan_snapshot_item(
                item,
                target_slots=[],
                slot_state={"known_slot_ids": set(), "slot_id_by_relpath": {}, "next_number": 1},
                session=session,
                default_status="invalidated",
                default_mapping_status="invalidated",
            )
            for item_id, item in old_snapshot_items.items()
            if item_id not in current_ids
        ]
        session.integrity_flags["is_stale"] = False
        session.integrity_flags["has_invalidated_items"] = bool(invalidated_items)
        session.stale_reason = None
        session.precheck_summary = None
        session.stage = STAGE_PLANNING

        try:
            self.helpers.orchestrator.run_planner_cycle_for_session(
                session,
                source="refresh",
                pending_plan=rebuilt_pending,
                preserving_previous_plan=bool(rebuilt_pending.moves or rebuilt_pending.unresolved_items),
            )
        except Exception:
            session.stage = STAGE_INTERRUPTED
            self.helpers._sync_session_views(session)
            self.helpers.store.save(session)
            self.helpers._record_event("plan.updated", session)
            raise

        rebuilt_snapshot = self.helpers._plan_snapshot_payload(session.plan_snapshot)
        invalidated_target_slots = list(rebuilt_snapshot.target_slots)
        invalidated_slot_state = self.helpers._target_slot_payload_state(invalidated_target_slots)
        normalized_invalidated_items = [
            self.helpers._normalize_plan_snapshot_item(
                asdict(item) if hasattr(item, "__dict__") else dict(item),
                target_slots=invalidated_target_slots,
                slot_state=invalidated_slot_state,
                session=session,
                default_status="invalidated",
                default_mapping_status="invalidated",
            )
            for item in invalidated_items
        ]
        rebuilt_snapshot.target_slots = invalidated_target_slots
        rebuilt_snapshot.invalidated_items = normalized_invalidated_items
        rebuilt_snapshot.change_highlights = list(existing_snapshot.change_highlights)
        session.plan_snapshot = rebuilt_snapshot
        session.stage = self.helpers._planning_stage_for(
            self.helpers._pending_plan_from_session(session),
            session.scan_lines,
        )
        self.helpers._sync_session_views(session)
        self.helpers.store.save(session)
        self.helpers._log_runtime_event(
            "session.refreshed",
            session,
            invalidated_count=len(normalized_invalidated_items),
        )
        self.helpers._write_session_debug_event(
            "session.refreshed",
            session,
            payload={
                "invalidated_count": len(normalized_invalidated_items),
                "is_incremental": is_incremental,
                "invalidated_items": normalized_invalidated_items,
            },
        )
        self.helpers._record_event("plan.updated", session)
        return SessionMutationResult(session_snapshot=self.helpers._build_snapshot(session))

    def start_scan(self, session_id: str, scan_runner=None):
        session = self.helpers._load_or_raise(session_id)
        self.helpers._ensure_schema_compatible_for_resume(session)
        self.helpers._ensure_not_locked(session)
        is_incremental = self.helpers._normalize_organize_mode(session.organize_mode) == "incremental"
        has_preselected_targets = bool(session.selected_target_directories)
        if scan_runner is not None:
            if is_incremental and not has_preselected_targets:
                self.helpers._run_incremental_target_discovery(session, scan_runner)
                return self.helpers._load_or_raise(session_id)
            self.helpers._run_scan_sync(session, scan_runner)
            return self.helpers._load_or_raise(session_id)

        if not self.helpers._is_empty_scan_result_completed(session):
            ensure_stage_in(
                session.stage,
                {STAGE_DRAFT, STAGE_STALE, STAGE_INTERRUPTED, STAGE_PLANNING, STAGE_SELECTING_INCREMENTAL_SCOPE},
            )

        if is_incremental and not has_preselected_targets:
            self.helpers._run_incremental_target_discovery(session, self.helpers._incremental_root_discovery_runner)
            return self.helpers._load_or_raise(session_id)

        target_dir = Path(session.target_dir).resolve()
        use_single_directory_scan = self.helpers._can_use_single_directory_scan(session)
        session.stage = STAGE_SCANNING
        self.helpers._clear_scan_recovery_state(session)
        session.scanner_progress = (
            self.helpers._initial_scan_progress(target_dir)
            if use_single_directory_scan
            else self.helpers._initial_source_collection_scan_progress(session)
        )
        self.helpers._sync_session_views(session)
        self.helpers.store.save(session)
        self.helpers._log_runtime_event("scan.started", session)
        self.helpers._write_session_debug_event(
            "scan.started",
            session,
            payload={"entry_count": session.scanner_progress.get("total_count", 0)},
        )
        self.helpers._record_event("scan.started", session)
        seen_entries: set[str] = set()
        progress_lock = threading.Lock()

        def on_scan_event(event_type: str, data: dict):
            with progress_lock:
                self.helpers._forward_runtime_event("scan", session.session_id, event_type, data)
                changed = False
                if event_type == "batch_split":
                    batch_count = max(1, int(data.get("batch_count") or 1))
                    worker_count = max(1, int(data.get("worker_count") or batch_count))
                    session.scanner_progress["batch_count"] = batch_count
                    session.scanner_progress["completed_batches"] = 0
                    session.scanner_progress["message"] = f"文件较多，已拆分为 {batch_count} 个批次并行分析"
                    session.scanner_progress["current_item"] = f"已启动 {worker_count} 个并行分析线程"
                    changed = True
                elif event_type == "batch_progress":
                    total_batches = max(1, int(data.get("total_batches") or session.scanner_progress.get("batch_count") or 1))
                    completed_batches = max(0, int(data.get("completed_batches") or 0))
                    total_count = max(0, int(session.scanner_progress.get("total_count") or 0))
                    processed_count = min(total_count, int((completed_batches / total_batches) * total_count) if total_count else 0)
                    if session.scanner_progress.get("processed_count") != processed_count:
                        session.scanner_progress["processed_count"] = processed_count
                        changed = True

                if event_type != "batch_split" and self.helpers._update_single_scan_progress(session, target_dir, seen_entries, event_type, data):
                    changed = True

                if changed:
                    self.helpers._sync_session_views(session)
                    self.helpers.store.save(session)
                    self.helpers._record_event("scan.progress", session)

        self.helpers._mark_scan_active(session.session_id)
        self.helpers.async_scanner.start(
            session_id=session.session_id,
            target_dir=target_dir,
            run_scan=(
                lambda d, cancel_event=None: self.helpers._default_scan_runner(
                    d,
                    event_handler=on_scan_event,
                    session_id=session.session_id,
                    cancel_event=cancel_event,
                )
                if use_single_directory_scan
                else self.helpers._scan_source_collection(
                    session,
                    self.helpers._default_scan_runner,
                    session_id=session.session_id,
                    event_handler=on_scan_event,
                    cancel_event=cancel_event,
                )[0]
            ),
            on_complete=self.helpers._finish_async_scan,
            on_error=self.helpers._fail_async_scan,
        )
        return session

    def confirm_target_directories(self, session_id: str, selected_target_dirs: list[str], scan_runner=None) -> SessionMutationResult:
        session = self.helpers._load_or_raise(session_id)
        if self.helpers._normalize_organize_mode(session.organize_mode) != "incremental":
            raise RuntimeError(SESSION_STAGE_CONFLICT)
        ensure_stage(session.stage, STAGE_SELECTING_INCREMENTAL_SCOPE)

        self.helpers._confirm_target_directories(
            session,
            selected_target_dirs=selected_target_dirs,
            scan_runner=scan_runner,
        )
        session.pending_plan = self.helpers._pending_plan_payload(PendingPlan())
        session.plan_snapshot = self.helpers._plan_snapshot_payload(
            self.helpers._plan_snapshot(PendingPlan(), {"diff_summary": ["confirm_target_directories"]}, scan_lines=session.scan_lines, session=session)
        )
        session.precheck_summary = None
        session.messages = []
        session.assistant_message = None
        session.summary = ""
        session.stage = STAGE_PLANNING
        self.helpers._sync_session_views(session)

        try:
            self.helpers.orchestrator.run_planner_cycle_for_session(
                session,
                source="confirm_target_directories",
                pending_plan=PendingPlan(),
                preserving_previous_plan=False,
            )
        except Exception:
            session.stage = STAGE_INTERRUPTED
            self.helpers._sync_session_views(session)
            self.helpers.store.save(session)
            self.helpers._record_event("plan.updated", session)
            raise

        self.helpers._sync_session_views(session)
        self.helpers.store.save(session)
        self.helpers._record_event("plan.updated", session)
        return SessionMutationResult(
            session_snapshot=self.helpers._build_snapshot(session),
            assistant_message=session.assistant_message,
        )
