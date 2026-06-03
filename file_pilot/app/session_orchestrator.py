from __future__ import annotations
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from file_pilot.app.models import CreateSessionResult, OrganizerSession, SourceCollectionItem
from file_pilot.app.safety import unsafe_source_path_reason
from file_pilot.app.session_constants import STAGE_INTERRUPTED, is_locked_stage, is_terminal_stage
from file_pilot.organize import service as organize_service
from file_pilot.organize.models import PendingPlan
from file_pilot.organize.strategy_templates import normalize_strategy_selection
from file_pilot.shared.path_utils import canonical_target_dir

if TYPE_CHECKING:
    from file_pilot.app.session_service import OrganizerSessionService

logger = logging.getLogger(__name__)


class SessionOrchestrator:
    def __init__(self, helpers: "OrganizerSessionService"):
        self.helpers = helpers

    @staticmethod
    def _canonical_path(value: str | Path | None) -> str:
        text = str(value or "").strip()
        return canonical_target_dir(text) if text else ""

    @classmethod
    def _source_collection_signature(cls, sources: list[SourceCollectionItem]) -> tuple[tuple[str, str, str], ...]:
        entries: list[tuple[str, str, str]] = []
        for item in sources:
            source_type = str(item.source_type or "").strip().lower()
            if source_type not in {"file", "directory"}:
                continue
            entries.append(
                (
                    source_type,
                    cls._canonical_path(item.path),
                    item.normalized_directory_mode if source_type == "directory" else "atomic",
                )
            )
        return tuple(sorted(entries))

    def _session_source_signature(self, session: OrganizerSession) -> tuple[tuple[str, str, str], ...]:
        sources = self.helpers._normalize_source_collection(session.source_collection)
        if not sources:
            sources = [SourceCollectionItem(source_type="directory", path=session.target_dir, directory_mode="contents")]
        return self._source_collection_signature(sources)

    def _resume_signature_for_session(self, session: OrganizerSession) -> dict:
        placement = self.helpers._placement_payload(session.placement)
        return {
            "sources": self._session_source_signature(session),
            "organize_method": self.helpers._normalize_organize_method(session.organize_method),
            "organize_mode": self.helpers._normalize_organize_mode(session.organize_mode),
            "output_dir": self._canonical_path(session.output_dir),
            "target_profile_id": str(session.target_profile_id or "").strip(),
            "target_directories": tuple(sorted(self._canonical_path(item) for item in session.selected_target_directories or [] if str(item or "").strip())),
            "target_directory_details": tuple(
                sorted(
                    (
                        self._canonical_path(item.path),
                        str(item.label or "").strip(),
                        str(item.description or "").strip(),
                    )
                    for item in self.helpers._target_directory_details_for_session(session)
                )
            ),
            "new_directory_root": self._canonical_path(placement.new_directory_root),
            "review_root": self._canonical_path(placement.review_root),
            "template_id": str(session.strategy_template_id or "").strip(),
            "destination_index_depth": self.helpers._normalize_destination_index_depth(session.destination_index_depth),
            "language": str(session.language or "").strip(),
            "density": str(session.density or "").strip(),
            "prefix_style": str(session.prefix_style or "").strip(),
            "caution_level": str(session.caution_level or "").strip(),
            "note": str(session.strategy_note or "").strip(),
        }

    def _resume_signature_for_request(
        self,
        sources: list[SourceCollectionItem],
        normalized_strategy: dict,
        selected_target_directories: list[str],
        selected_target_directory_details: list[dict],
    ) -> dict:
        placement = self.helpers._placement_payload(
            new_directory_root=str(normalized_strategy.get("new_directory_root") or ""),
            review_root=str(normalized_strategy.get("review_root") or ""),
        )
        return {
            "sources": self._source_collection_signature(sources),
            "organize_method": self.helpers._normalize_organize_method(normalized_strategy.get("organize_method")),
            "organize_mode": self.helpers._normalize_organize_mode(normalized_strategy.get("organize_mode")),
            "output_dir": self._canonical_path(normalized_strategy.get("output_dir")),
            "target_profile_id": str(normalized_strategy.get("target_profile_id") or "").strip(),
            "target_directories": tuple(sorted(self._canonical_path(item) for item in selected_target_directories if str(item or "").strip())),
            "target_directory_details": tuple(
                sorted(
                    (
                        self._canonical_path(item.get("path")),
                        str(item.get("label") or "").strip(),
                        str(item.get("description") or "").strip(),
                    )
                    for item in (selected_target_directory_details or [])
                    if str(item.get("path") or "").strip()
                )
            ),
            "new_directory_root": self._canonical_path(placement.new_directory_root),
            "review_root": self._canonical_path(placement.review_root),
            "template_id": str(normalized_strategy.get("template_id") or "").strip(),
            "destination_index_depth": self.helpers._normalize_destination_index_depth(normalized_strategy.get("destination_index_depth")),
            "language": str(normalized_strategy.get("language") or "").strip(),
            "density": str(normalized_strategy.get("density") or "").strip(),
            "prefix_style": str(normalized_strategy.get("prefix_style") or "").strip(),
            "caution_level": str(normalized_strategy.get("caution_level") or "").strip(),
            "note": str(normalized_strategy.get("note") or "").strip(),
        }

    def _resume_scope_matches(
        self,
        latest: OrganizerSession,
        sources: list[SourceCollectionItem],
        normalized_strategy: dict,
        selected_target_directories: list[str],
        selected_target_directory_details: list[dict],
    ) -> bool:
        return self._resume_signature_for_session(latest) == self._resume_signature_for_request(
            sources,
            normalized_strategy,
            selected_target_directories,
            selected_target_directory_details,
        )

    def run_planner_cycle_for_session(
        self,
        session,
        *,
        source: str,
        pending_plan: PendingPlan | None = None,
        preserving_previous_plan: bool | None = None,
    ) -> None:
        self.helpers._seed_initial_messages(session)
        active_pending = pending_plan or self.helpers._pending_plan_from_session(session)
        task, _ = self.helpers._build_organize_task(session, active_pending)
        adapter = self.helpers._task_planner_adapter(session)

        def on_plan_event(event_type: str, data: dict):
            self.helpers._forward_runtime_event("plan", session.session_id, event_type, data, session=session)

        self.helpers._begin_planner_progress(session, preserving_previous_plan=preserving_previous_plan)
        try:
            assistant_message, cycle_result = organize_service.run_organizer_cycle(
                messages=list(session.messages),
                scan_lines=session.scan_lines,
                planner_items=self.helpers._session_planner_items(session),
                pending_plan=active_pending,
                user_constraints=list(session.user_constraints),
                strategy_instructions=self.helpers._strategy_prompt_fragment(session),
                planning_context=self.helpers._planning_context(session),
                event_handler=on_plan_event,
                session_id=session.session_id,
                target_dir=session.target_dir,
            )
        except Exception as exc:
            session.last_error = str(exc)
            self.helpers._fail_planner_progress(session, str(exc))
            raise

        updated_pending = cycle_result.get("pending_plan", active_pending) if cycle_result else active_pending
        session.user_constraints = list(updated_pending.user_constraints or session.user_constraints)
        updated_task = adapter.apply_pending_plan(task, updated_pending)
        self.helpers._apply_task_state(session, updated_task, cycle_result, prefer_local_summary=False)
        session.assistant_message, assistant_context_messages = self.helpers._assistant_messages_from_cycle(assistant_message, cycle_result)
        self.helpers._clear_manual_sync_messages(session)
        session.messages.extend(assistant_context_messages)
        self.helpers._set_last_ai_pending_state(session, updated_pending, task=updated_task)
        self.helpers._complete_planner_progress(session)
        self.helpers._log_runtime_event("plan.updated", session, source=source)
        self.helpers._write_session_debug_event(
            "plan.updated",
            session,
            payload={"source": source, "summary": session.summary},
        )

    def maybe_run_auto_plan_after_scan(self, session) -> None:
        is_incremental_with_targets = (
            self.helpers._normalize_organize_mode(session.organize_mode) == "incremental"
            and bool(session.selected_target_directories)
        )
        if (
            self.helpers._normalize_organize_mode(session.organize_mode) != "initial"
            and not is_incremental_with_targets
            or session.assistant_message
            or self.helpers._plan_snapshot_has_moves(session.plan_snapshot)
        ):
            return

        try:
            self.helpers._log_runtime_event("plan.auto_started", session)
            self.helpers._write_session_debug_event("plan.auto_started", session)
            self.run_planner_cycle_for_session(
                session,
                source="auto_scan",
                pending_plan=self.helpers._pending_plan_from_session(session),
                preserving_previous_plan=self.helpers._has_existing_plan_content(session),
            )
            self.helpers._sync_session_views(session)
            self.helpers.store.save(session)
            self.helpers._log_runtime_event("plan.auto_completed", session, summary=session.summary)
            self.helpers._write_session_debug_event(
                "plan.auto_completed",
                session,
                payload={"summary": session.summary},
            )
            self.helpers._record_event("plan.updated", session)
        except Exception as exc:
            logger.exception(
                "plan.auto_failed session_id=%s target_dir=%s",
                session.session_id,
                session.target_dir,
            )
            session.last_error = f"自动规划失败: {str(exc)}"
            self.helpers._fail_planner_progress(session, session.last_error)
            session.stage = STAGE_INTERRUPTED
            self.helpers._sync_session_views(session)
            self.helpers.store.save(session)
            self.helpers._log_runtime_event("plan.auto_failed", session, level=logging.ERROR, error=str(exc))
            self.helpers._write_session_debug_event(
                "plan.auto_failed",
                session,
                level="ERROR",
                payload={"error": str(exc)},
            )
            self.helpers._record_event("plan.updated", session)

    def create_session(
        self,
        sources: list[dict],
        resume_if_exists: bool,
        organize_method: str,
        strategy: dict | None = None,
        *,
        output_dir: str = "",
        target_profile_id: str = "",
        target_directories: list[str] | None = None,
        target_directory_details: list[dict] | None = None,
        new_directory_root: str = "",
        review_root: str = "",
    ) -> CreateSessionResult:
        normalized_strategy = normalize_strategy_selection(
            {
                **(strategy or {}),
                "organize_method": organize_method,
                "output_dir": output_dir,
                "target_profile_id": target_profile_id,
                "target_directories": list(target_directories or []),
                "target_directory_details": list(target_directory_details or []),
                "new_directory_root": new_directory_root,
                "review_root": review_root,
            }
        )
        normalized_sources = self.helpers._normalize_source_collection(sources)
        if not normalized_sources:
            raise ValueError("SOURCES_REQUIRED")
        unsafe_reasons = [
            unsafe_source_path_reason(item.path, source_type=item.source_type)
            for item in normalized_sources
        ]
        first_unsafe_reason = next((reason for reason in unsafe_reasons if reason), None)
        if first_unsafe_reason:
            raise ValueError(first_unsafe_reason)
        requested_target_directories = (
            list(target_directories or [])
            or [
                str(item.get("path") or "").strip()
                for item in (target_directory_details or [])
                if isinstance(item, dict) and str(item.get("path") or "").strip()
            ]
        )
        selected_target_directories = self.helpers._normalize_target_directories(requested_target_directories)
        selected_target_directory_details = [
            item.to_dict()
            for item in self.helpers._resolve_target_directory_details(
                target_profile_id=str(target_profile_id or normalized_strategy.get("target_profile_id") or "").strip(),
                target_directories=selected_target_directories,
                target_directory_details=target_directory_details,
            )
        ]
        if selected_target_directory_details:
            selected_target_directories = self.helpers._normalize_target_directories(
                [item["path"] for item in selected_target_directory_details]
            )
        default_workspace_root = self.helpers._derive_session_root_dir(
            normalized_sources,
            normalized_strategy["organize_method"],
            output_dir=str(normalized_strategy.get("output_dir") or ""),
            target_directories=selected_target_directories,
        )
        if normalized_strategy["organize_method"] == "categorize_into_new_structure":
            if not str(normalized_strategy.get("output_dir") or "").strip():
                raise ValueError("OUTPUT_DIR_REQUIRED")
            normalized_strategy["new_directory_root"] = (
                str(normalized_strategy.get("new_directory_root") or "").strip()
                or str(normalized_strategy.get("output_dir") or "").strip()
            )
            normalized_strategy["review_root"] = (
                str(normalized_strategy.get("review_root") or "").strip()
                or self.helpers._default_review_root(str(normalized_strategy.get("new_directory_root") or "").strip())
            )
        else:
            if target_profile_id and not selected_target_directories:
                profile = self.helpers.target_profiles.get(target_profile_id)
                if profile is None:
                    raise ValueError("TARGET_PROFILE_NOT_FOUND")
                selected_target_directory_details = [
                    item.to_dict()
                    for item in self.helpers._resolve_target_directory_details(
                        target_profile_id=target_profile_id,
                        target_directories=None,
                        target_directory_details=None,
                    )
                ]
                selected_target_directories = self.helpers._normalize_target_directories(
                    [item["path"] for item in selected_target_directory_details]
                )
            if not selected_target_directories:
                raise ValueError("TARGET_DIRECTORIES_REQUIRED")
            normalized_strategy["new_directory_root"] = (
                str(normalized_strategy.get("new_directory_root") or "").strip()
                or str(default_workspace_root)
            )
            normalized_strategy["review_root"] = (
                str(normalized_strategy.get("review_root") or "").strip()
                or self.helpers._default_review_root(str(normalized_strategy.get("new_directory_root") or "").strip())
            )

        self.helpers.target_resolver.validate_review_root_safety(
            new_directory_root=str(normalized_strategy.get("new_directory_root") or ""),
            review_root=str(normalized_strategy.get("review_root") or ""),
            target_directories=selected_target_directories,
        )

        path = default_workspace_root
        latest = self.helpers.store.find_latest_by_directory(path)
        if latest is not None and not is_terminal_stage(latest.stage):
            if self._resume_scope_matches(
                latest,
                normalized_sources,
                normalized_strategy,
                selected_target_directories,
                selected_target_directory_details,
            ):
                if resume_if_exists:
                    self.helpers._log_runtime_event(
                        "session.resume_available",
                        latest,
                        existing_session_id=latest.session_id,
                    )
                    return CreateSessionResult(mode="resume_available", restorable_session=latest)
                raise RuntimeError("SESSION_LOCKED")
            if is_locked_stage(latest.stage):
                raise RuntimeError("SESSION_LOCKED")
            try:
                self.helpers._log_runtime_event(
                    "session.superseded",
                    latest,
                    reason="resume_scope_mismatch",
                )
            finally:
                self.helpers.lifecycle.abandon_session(latest.session_id, emit_event_snapshot=False)

        session = self.helpers.store.create(path)
        session.source_collection = normalized_sources
        session.placement = self.helpers._placement_payload(
            new_directory_root=str(normalized_strategy.get("new_directory_root") or ""),
            review_root=str(normalized_strategy.get("review_root") or ""),
        )
        session.organize_method = self.helpers._normalize_organize_method(normalized_strategy.get("organize_method"))
        session.output_dir = str(normalized_strategy.get("output_dir") or "").strip()
        session.target_profile_id = str(target_profile_id or normalized_strategy.get("target_profile_id") or "").strip()
        session.selected_target_directories = list(selected_target_directories)
        session.selected_target_directory_details = self.helpers._normalize_target_directory_details(
            selected_target_directory_details
        )
        session.strategy_template_id = normalized_strategy["template_id"]
        session.strategy_template_label = normalized_strategy["template_label"]
        session.organize_mode = self.helpers._normalize_organize_mode(normalized_strategy.get("organize_mode"))
        session.destination_index_depth = self.helpers._normalize_destination_index_depth(
            normalized_strategy.get("destination_index_depth")
        )
        session.language = normalized_strategy["language"]
        session.density = normalized_strategy["density"]
        session.prefix_style = normalized_strategy["prefix_style"]
        session.caution_level = normalized_strategy["caution_level"]
        session.strategy_note = normalized_strategy["note"]
        session.user_constraints = [normalized_strategy["note"]] if normalized_strategy["note"] else []
        session.incremental_selection = self.helpers._incremental_selection_defaults(session)
        if session.selected_target_directories:
            session.incremental_selection["target_directories"] = list(session.selected_target_directories)
            session.incremental_selection["status"] = "ready"
        self.helpers._sync_session_views(session)
        lock_result = self.helpers.store.acquire_directory_lock(path, session.session_id)
        if not lock_result.acquired:
            raise RuntimeError("SESSION_LOCKED")

        self.helpers.store.save(session)
        self.helpers._log_runtime_event("session.created", session, strategy=self.helpers._strategy_runtime_summary(session))
        self.helpers._write_session_debug_event("session.created", session, payload={"strategy": self.helpers._strategy_runtime_summary(session)})
        self.helpers._record_event("session.created", session, include_snapshot=False)
        return CreateSessionResult(mode="created", session=session)
