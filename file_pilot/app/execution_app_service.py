import logging
from pathlib import Path
from typing import TYPE_CHECKING

from file_pilot.app.models import SessionMutationResult
from file_pilot.app.safety import risky_move_reason
from file_pilot.app.session_constants import (
    REVIEW_DISPLAY_NAME,
    REVIEW_SLOT_ID,
    SESSION_STAGE_CONFLICT,
    STAGE_COMPLETED,
    STAGE_EXECUTING,
    STAGE_INTERRUPTED,
    STAGE_PLANNING,
    STAGE_READY_TO_EXECUTE,
    STAGE_ROLLING_BACK,
    STAGE_STALE,
    ensure_stage,
    ensure_stage_in,
)
from file_pilot.execution import service as execution_service
from file_pilot.execution.models import MappedExecutionAction, MappedExecutionPlan
from file_pilot.rollback import service as rollback_service

if TYPE_CHECKING:
    from file_pilot.app.session_service import OrganizerSessionService


class ExecutionAppService:
    def __init__(self, helpers: "OrganizerSessionService"):
        self.helpers = helpers

    @staticmethod
    def _display_path(path: Path, base_dir: Path) -> str:
        try:
            return path.relative_to(base_dir).as_posix()
        except ValueError:
            return path.as_posix()

    @staticmethod
    def _resolve_mapping_target_path(registry, slot_id: str, filename: str, target_slot) -> Path:
        try:
            return registry.resolve_target(slot_id, filename)
        except KeyError:
            return Path(target_slot.real_path) / filename

    def _build_mapped_execution_plan(self, session, final_plan, task, registry) -> MappedExecutionPlan:
        base_dir = Path(session.target_dir).resolve()
        placement = self.helpers.target_resolver.placement_payload(session.placement)
        source_by_id = {item.ref_id: item for item in task.sources}
        target_by_id = {item.slot_id: item for item in task.targets}
        planner_by_source = self.helpers._planner_items_by_source(session)
        mapping_by_source_id = {mapping.source_ref_id: mapping for mapping in task.mappings}

        mkdir_actions: list[MappedExecutionAction] = []
        known_mkdir_targets: set[str] = set()

        move_actions: list[MappedExecutionAction] = []
        for mapping in task.mappings:
            if mapping.target_slot_id in {"", None}:
                continue
            source = source_by_id.get(mapping.source_ref_id)
            if source is None:
                continue
            filename = Path(source.relpath).name
            display_name = str(source.display_name or filename)
            if mapping.target_slot_id == REVIEW_SLOT_ID:
                review_root = Path(
                    placement.review_root
                    or self.helpers.target_resolver.default_review_root(placement.new_directory_root or session.target_dir)
                ).resolve()
                if str(review_root) not in known_mkdir_targets and not review_root.exists():
                    known_mkdir_targets.add(str(review_root))
                    raw_target_dir = self._display_path(review_root, base_dir)
                    mkdir_actions.append(
                        MappedExecutionAction(
                            type="MKDIR",
                            target_path=review_root,
                            raw=f'MKDIR "{raw_target_dir}"',
                            target_slot_id=REVIEW_SLOT_ID,
                            display_name=REVIEW_DISPLAY_NAME,
                            status="planned",
                        )
                    )
                target_path = (review_root / filename).resolve()
            else:
                target_slot = target_by_id.get(mapping.target_slot_id)
                if target_slot is None:
                    continue
                target_path = self._resolve_mapping_target_path(registry, mapping.target_slot_id, filename, target_slot)
                target_dir_path = target_path.parent.resolve(strict=False)
                if str(target_dir_path) not in known_mkdir_targets and not target_dir_path.exists():
                    known_mkdir_targets.add(str(target_dir_path))
                    raw_target_dir = self._display_path(target_dir_path, base_dir)
                    mkdir_actions.append(
                        MappedExecutionAction(
                            type="MKDIR",
                            target_path=target_dir_path,
                            raw=f'MKDIR "{raw_target_dir}"',
                            target_slot_id=target_slot.slot_id,
                            display_name=target_slot.display_name,
                            status="planned",
                        )
                    )
            raw_target = self._display_path(target_path, base_dir)
            move_actions.append(
                MappedExecutionAction(
                    type="MOVE",
                    source_path=registry.resolve_source(mapping.source_ref_id),
                    target_path=target_path,
                    raw=f'MOVE "{source.relpath}" "{raw_target}"',
                    item_id=str(planner_by_source.get(source.relpath, {}).get("planner_id") or source.ref_id),
                    source_ref_id=mapping.source_ref_id,
                    target_slot_id=str(mapping.target_slot_id or ""),
                    display_name=display_name,
                    status=mapping.status,
                )
            )

        mkdir_actions.sort(key=lambda action: action.target_path.as_posix())
        move_actions.sort(key=lambda action: action.item_id)
        return MappedExecutionPlan(
            base_dir=base_dir,
            mkdir_actions=mkdir_actions,
            move_actions=move_actions,
            all_actions=[*mkdir_actions, *move_actions],
        )

    def run_precheck(self, session_id: str) -> SessionMutationResult:
        session = self.helpers._load_or_raise(session_id)
        self.helpers._ensure_mutable_stage(session)
        self.helpers._log_runtime_event("precheck.started", session)
        self.helpers._write_session_debug_event("precheck.started", session)
        final_plan = self.helpers._final_plan_from_session(session)
        task, registry = self.helpers._build_organize_task(session, final_plan)
        planner_by_source = self.helpers._planner_items_by_source(session)
        source_by_id = {item.ref_id: item for item in task.sources}
        source_id_by_relpath = {item.relpath: item.ref_id for item in task.sources}
        target_by_id = {item.slot_id: item for item in task.targets}
        missing_target_errors = []
        for mapping in task.mappings:
            if mapping.target_slot_id in {"", REVIEW_SLOT_ID}:
                continue
            if target_by_id.get(mapping.target_slot_id) is not None:
                continue
            source_ref = source_by_id.get(mapping.source_ref_id)
            display_name = str(source_ref.display_name or source_ref.relpath or mapping.source_ref_id) if source_ref is not None else str(mapping.source_ref_id)
            missing_target_errors.append(f"整理方案引用了不存在的目标目录：{display_name}")
        mapped_plan = self._build_mapped_execution_plan(session, final_plan, task, registry)
        if self.helpers._normalize_organize_mode(session.organize_mode) == "incremental":
            selection = self.helpers._incremental_selection_snapshot(session)
            incremental_target_errors = []
            for mapping in task.mappings:
                if mapping.target_slot_id in {"", REVIEW_SLOT_ID}:
                    continue
                source_ref = source_by_id.get(mapping.source_ref_id)
                target_slot = target_by_id.get(mapping.target_slot_id)
                if source_ref is None or target_slot is None:
                    continue
                resolved_target = self._resolve_mapping_target_path(
                    registry,
                    mapping.target_slot_id,
                    Path(source_ref.relpath).name,
                    target_slot,
                )
                try:
                    target_dir = resolved_target.parent.relative_to(Path(session.target_dir).resolve()).as_posix()
                except ValueError:
                    target_dir = target_slot.real_path
                if not self.helpers._validate_incremental_target_dir(session, target_dir, selection):
                    display_name = str(source_ref.display_name or source_ref.ref_id)
                    incremental_target_errors.append(
                        f"“归入已有目录”任务的目标超出允许范围：{display_name} -> {target_dir or '(root)'}"
                    )
        else:
            incremental_target_errors = []
        plan = execution_service.build_execution_plan_from_mapped(mapped_plan)
        precheck = execution_service.validate_execution_preconditions(plan)
        safety_warnings: list[str] = []
        for action in mapped_plan.move_actions:
            if action.source_path is None:
                continue
            source_label = self._display_path(action.source_path, mapped_plan.base_dir)
            target_label = self._display_path(action.target_path, mapped_plan.base_dir)
            reason = risky_move_reason(source_label, target_label)
            if reason:
                display_name = action.display_name or action.item_id or self._display_path(action.source_path, mapped_plan.base_dir)
                safety_warnings.append(f"高影响移动：{display_name}（{reason}，来源：{source_label}）")
        if missing_target_errors:
            precheck.can_execute = False
            precheck.blocking_errors = list(precheck.blocking_errors) + missing_target_errors
        if incremental_target_errors:
            precheck.can_execute = False
            precheck.blocking_errors = list(precheck.blocking_errors) + incremental_target_errors
        if safety_warnings:
            precheck.warnings = list(precheck.warnings) + safety_warnings
        move_preview = []
        for action in mapped_plan.move_actions:
            source_relpath = self._display_path(action.source_path, plan.base_dir) if action.source_path is not None else ""
            target_text = self._display_path(action.target_path, plan.base_dir)
            move_preview.append(
                {
                    "item_id": action.item_id,
                    "source": source_relpath,
                    "target": target_text,
                }
            )
        session.precheck_summary = {
            "can_execute": precheck.can_execute,
            "blocking_errors": list(precheck.blocking_errors),
            "warnings": list(precheck.warnings),
            "mkdir_preview": [self._display_path(action.target_path, plan.base_dir) for action in mapped_plan.mkdir_actions],
            "move_preview": move_preview,
            "issues": self.helpers._precheck_issues(
                list(precheck.blocking_errors),
                list(precheck.warnings),
                final_plan.moves,
                planner_by_source,
            ),
        }
        session.stage = STAGE_READY_TO_EXECUTE if precheck.can_execute else STAGE_PLANNING
        self.helpers._sync_session_views(session)
        self.helpers.store.save(session)
        self.helpers._log_runtime_event(
            "precheck.completed",
            session,
            can_execute=precheck.can_execute,
            blocking_error_count=len(precheck.blocking_errors),
            warning_count=len(precheck.warnings),
        )
        self.helpers._write_session_debug_event(
            "precheck.completed",
            session,
            payload=session.precheck_summary,
        )
        self.helpers._record_event("precheck.ready", session)
        return SessionMutationResult(session_snapshot=self.helpers._build_snapshot(session))

    def return_to_planning(self, session_id: str) -> SessionMutationResult:
        session = self.helpers._load_or_raise(session_id)
        ensure_stage(session.stage, STAGE_READY_TO_EXECUTE)

        pending = self.helpers._pending_plan_from_session(session)
        session.precheck_summary = None
        session.stage = self.helpers._planning_stage_for(pending, session.scan_lines)
        self.helpers._sync_session_views(session)
        self.helpers.store.save(session)
        self.helpers._record_event("plan.updated", session)
        return SessionMutationResult(session_snapshot=self.helpers._build_snapshot(session))

    def execute(self, session_id: str, confirm: bool) -> SessionMutationResult:
        if not confirm:
            raise ValueError("confirmation_required")

        session = self.helpers._load_or_raise(session_id)
        ensure_stage(session.stage, STAGE_READY_TO_EXECUTE)

        self.helpers._mark_locked_stage_active(session.session_id, STAGE_EXECUTING)
        try:
            session.stage = STAGE_EXECUTING
            self.helpers._sync_session_views(session)
            self.helpers.store.save(session)
            self.helpers._log_runtime_event("execution.started", session)
            self.helpers._write_session_debug_event("execution.started", session)
            self.helpers._record_event("execution.started", session)

            final_plan = self.helpers._final_plan_from_session(session)
            task, registry = self.helpers._build_organize_task(session, final_plan)
            mapped_plan = self._build_mapped_execution_plan(session, final_plan, task, registry)
            plan = execution_service.build_execution_plan_from_mapped(mapped_plan)
            try:
                report = execution_service.execute_plan(plan)
            except Exception as exc:
                session.stage = STAGE_INTERRUPTED
                session.last_error = str(exc)
                self.helpers._sync_session_views(session)
                self.helpers.store.save(session)
                self.helpers._log_runtime_event("execution.failed", session, level=logging.ERROR, error=str(exc))
                self.helpers._write_session_debug_event(
                    "execution.failed",
                    session,
                    level="ERROR",
                    payload={"error": str(exc)},
                )
                self.helpers._record_event("session.interrupted", session)
                raise
            journal_id = self.helpers._latest_execution_id(Path(session.target_dir))
            if not journal_id:
                session.stage = STAGE_INTERRUPTED
                session.last_error = "missing_execution_journal"
                self.helpers._sync_session_views(session)
                self.helpers.store.save(session)
                self.helpers._log_runtime_event("execution.failed", session, reason="missing_execution_journal", level=logging.ERROR)
                self.helpers._write_session_debug_event(
                    "execution.failed",
                    session,
                    level="ERROR",
                    payload={"reason": "missing_execution_journal"},
                )
                self.helpers._record_event("session.interrupted", session)
                return SessionMutationResult(session_snapshot=self.helpers._build_snapshot(session))

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
            session.stage = STAGE_COMPLETED
            self.helpers._sync_session_views(session)
            self.helpers.store.save(session)
            self.helpers.store.release_directory_lock(Path(session.target_dir), session.session_id)
            self.helpers._log_runtime_event(
                "execution.completed",
                session,
                execution_id=journal_id,
                success_count=report.success_count,
                failure_count=report.failure_count,
            )
            self.helpers._write_session_debug_event(
                "execution.completed",
                session,
                payload=session.execution_report,
            )
            self.helpers._record_event("execution.completed", session)
            return SessionMutationResult(session_snapshot=self.helpers._build_snapshot(session))
        finally:
            self.helpers._mark_locked_stage_inactive(session.session_id, STAGE_EXECUTING)

    def rollback(self, session_id: str, confirm: bool) -> SessionMutationResult:
        if not confirm:
            session = self.helpers.store.load(session_id)
            if session is None:
                journal = execution_service.load_execution_journal(session_id)
                if journal is None:
                    raise KeyError(f"Session {session_id} not found")
                return self._build_rollback_precheck_result_for_journal(journal)

            journal = rollback_service.load_latest_execution_for_directory(Path(session.target_dir))
            if journal is None:
                raise FileNotFoundError("latest_execution")
            return self._build_rollback_precheck_result_for_session(session, journal)

        session = self.helpers.store.load(session_id)
        if session is None:
            journal = execution_service.load_execution_journal(session_id)
            if journal is None:
                raise KeyError(f"Session {session_id} not found")
            return self.rollback_execution_journal(journal)

        ensure_stage_in(session.stage, {STAGE_COMPLETED, STAGE_INTERRUPTED})

        lock_result = self.helpers.store.acquire_directory_lock(Path(session.target_dir), session.session_id)
        if not lock_result.acquired:
            raise RuntimeError("SESSION_LOCKED")

        self.helpers._mark_locked_stage_active(session.session_id, STAGE_ROLLING_BACK)
        session.stage = STAGE_ROLLING_BACK
        self.helpers._sync_session_views(session)
        self.helpers.store.save(session)
        self.helpers._log_runtime_event("rollback.started", session)
        self.helpers._write_session_debug_event("rollback.started", session)
        self.helpers._record_event("rollback.started", session)

        try:
            journal = rollback_service.load_latest_execution_for_directory(Path(session.target_dir))
            if journal is None:
                raise FileNotFoundError("latest_execution")
            plan = rollback_service.build_rollback_plan(journal)
            report = rollback_service.execute_rollback_plan(plan)
            rollback_service.finalize_rollback_state(journal, report)
        except Exception as exc:
            session.stage = STAGE_INTERRUPTED
            session.last_error = str(exc)
            self.helpers._sync_session_views(session)
            self.helpers.store.save(session)
            self.helpers._log_runtime_event("rollback.failed", session, level=logging.ERROR, error=str(exc))
            self.helpers._write_session_debug_event(
                "rollback.failed",
                session,
                level="ERROR",
                payload={"error": str(exc)},
            )
            self.helpers._record_event("session.interrupted", session)
            raise
        finally:
            self.helpers.store.release_directory_lock(Path(session.target_dir), session.session_id)
            self.helpers._mark_locked_stage_inactive(session.session_id, STAGE_ROLLING_BACK)
        session.rollback_report = {
            "journal_id": journal.execution_id,
            "restored_from_execution_id": journal.execution_id,
            "success_count": report.success_count,
            "failure_count": report.failure_count,
            "status": "success" if report.failure_count == 0 else "partial_failure",
        }
        session.last_journal_id = journal.execution_id
        session.stage = STAGE_STALE
        session.integrity_flags["is_stale"] = True
        self.helpers._sync_session_views(session)
        self.helpers.store.save(session)
        self.helpers._log_runtime_event(
            "rollback.completed",
            session,
            journal_id=journal.execution_id,
            success_count=report.success_count,
            failure_count=report.failure_count,
        )
        self.helpers._write_session_debug_event(
            "rollback.completed",
            session,
            payload=session.rollback_report,
        )
        self.helpers._record_event("rollback.completed", session)
        return SessionMutationResult(session_snapshot=self.helpers._build_snapshot(session))

    def _build_rollback_precheck_result_for_session(self, session, journal) -> SessionMutationResult:
        plan = rollback_service.build_rollback_plan(journal)
        precheck = rollback_service.validate_rollback_preconditions(plan)
        return SessionMutationResult(
            session_snapshot=self.helpers._build_snapshot(session),
            changed=False,
            rollback_precheck=self._rollback_precheck_payload(plan, precheck),
        )

    def _build_rollback_precheck_result_for_journal(self, journal) -> SessionMutationResult:
        plan = rollback_service.build_rollback_plan(journal)
        precheck = rollback_service.validate_rollback_preconditions(plan)
        return SessionMutationResult(
            session_snapshot={
                "session_id": journal.execution_id,
                "target_dir": journal.target_dir,
                "stage": STAGE_COMPLETED,
                "execution_report": {
                    "execution_id": journal.execution_id,
                    "journal_id": journal.execution_id,
                    "status": journal.status,
                },
                "integrity_flags": {},
            },
            changed=False,
            rollback_precheck=self._rollback_precheck_payload(plan, precheck),
        )

    @staticmethod
    def _rollback_precheck_payload(plan, precheck) -> dict:
        return {
            "can_execute": bool(precheck.can_execute),
            "blocking_errors": list(precheck.blocking_errors or []),
            "actions": [
                {
                    "type": action.type,
                    "display_name": str(action.display_name or action.item_id or action.source.name or action.type),
                    "source": action.source.as_posix(),
                    "target": action.target.as_posix(),
                }
                for action in plan.actions
            ],
        }

    def rollback_execution_journal(self, journal) -> SessionMutationResult:
        if journal.status not in {"completed", "partial_failure"}:
            raise RuntimeError(SESSION_STAGE_CONFLICT)

        target_dir = Path(journal.target_dir)
        lock_result = self.helpers.store.acquire_directory_lock(target_dir, journal.execution_id)
        if not lock_result.acquired:
            raise RuntimeError("SESSION_LOCKED")

        self.helpers._mark_locked_stage_active(journal.execution_id, STAGE_ROLLING_BACK)
        try:
            plan = rollback_service.build_rollback_plan(journal)
            report = rollback_service.execute_rollback_plan(plan)
            rollback_service.finalize_rollback_state(journal, report)
        finally:
            self.helpers.store.release_directory_lock(target_dir, journal.execution_id)
            self.helpers._mark_locked_stage_inactive(journal.execution_id, STAGE_ROLLING_BACK)

        return SessionMutationResult(
            session_snapshot={
                "session_id": journal.execution_id,
                "target_dir": journal.target_dir,
                "stage": STAGE_STALE,
                "execution_report": {
                    "execution_id": journal.execution_id,
                    "journal_id": journal.execution_id,
                    "status": journal.status,
                },
                "rollback_report": {
                    "journal_id": journal.execution_id,
                    "restored_from_execution_id": journal.execution_id,
                    "success_count": report.success_count,
                    "failure_count": report.failure_count,
                    "status": "success" if report.failure_count == 0 else "partial_failure",
                },
                "integrity_flags": {
                    "is_stale": True,
                },
            }
        )

    def cleanup_empty_dirs(self, session_id: str) -> dict:
        session = self.helpers._load_or_raise(session_id)
        ensure_stage(session.stage, STAGE_COMPLETED)
        final_plan = self.helpers._final_plan_from_session(session)
        task, registry = self.helpers._build_organize_task(session, final_plan)
        mapped_plan = self._build_mapped_execution_plan(session, final_plan, task, registry)
        plan = execution_service.build_execution_plan_from_mapped(mapped_plan)
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
        self.helpers._sync_session_views(session)
        self.helpers.store.save(session)
        self.helpers._log_runtime_event(
            "cleanup.completed",
            session,
            cleaned_count=len(cleaned),
            candidate_count=len(empty_dirs),
        )
        self.helpers._write_session_debug_event(
            "cleanup.completed",
            session,
            payload={
                "candidate_count": len(empty_dirs),
                "cleaned_count": len(cleaned),
                "cleaned_dirs": [str(path) for path in cleaned],
            },
        )
        self.helpers._record_event("cleanup.completed", session, cleaned_count=len(cleaned))
        return {
            "session_id": session_id,
            "cleaned_count": len(cleaned),
            "session_snapshot": self.helpers._build_snapshot(session),
        }
