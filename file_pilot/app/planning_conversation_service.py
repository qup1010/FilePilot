from typing import TYPE_CHECKING

from file_pilot.app.models import SessionMutationResult

if TYPE_CHECKING:
    from file_pilot.app.session_service import OrganizerSessionService


class PlanningConversationService:
    def __init__(self, helpers: "OrganizerSessionService"):
        self.helpers = helpers

    def get_snapshot(self, session_id: str) -> dict:
        session = self.helpers._load_or_raise(session_id, recover_locked=True)
        self.helpers._recover_orphaned_locked_session(session)

        changed = self.helpers._ensure_message_ids(session.messages)
        if session.assistant_message and not session.assistant_message.get("id"):
            self.helpers._ensure_message_id(session.assistant_message)
            changed = True
        if self.helpers._normalize_last_ai_pending_plan(session):
            changed = True

        if changed:
            self.helpers._sync_session_views(session)
            self.helpers.store.save(session)

        return self.helpers._build_snapshot(session)

    def submit_user_intent(self, session_id: str, content: str) -> SessionMutationResult:
        session = self.helpers._load_or_raise(session_id)
        self.helpers._ensure_mutable_stage(session)
        if session.stage == "selecting_incremental_scope":
            raise RuntimeError("SESSION_STAGE_CONFLICT")
        self.helpers._seed_initial_messages(session)
        session.messages.append(self.helpers._ensure_message_id({"role": "user", "content": content}))
        pending_plan = self.helpers._pending_plan_from_session(session)
        self.helpers._log_runtime_event(
            "plan.user_intent_submitted",
            session,
            message_count=len(session.messages),
            content_preview=content[:120],
        )
        self.helpers._write_session_debug_event(
            "plan.user_intent_submitted",
            session,
            payload={"content": content},
        )

        try:
            self.helpers.orchestrator.run_planner_cycle_for_session(
                session,
                source="user_intent",
                pending_plan=pending_plan,
            )
        except Exception:
            self.helpers._sync_session_views(session)
            self.helpers.store.save(session)
            raise
        self.helpers._sync_session_views(session)
        self.helpers.store.save(session)
        self.helpers._record_event("plan.updated", session)
        return SessionMutationResult(
            session_snapshot=self.helpers._build_snapshot(session),
            assistant_message=session.assistant_message,
        )

    def update_item_target(
        self,
        session_id: str,
        item_id: str,
        target_dir: str | None,
        target_slot: str | None,
        move_to_review: bool,
    ) -> SessionMutationResult:
        session = self.helpers._load_or_raise(session_id)
        self.helpers._ensure_mutable_stage(session)

        pending = self.helpers._pending_plan_from_session(session)
        source_relpath = self.helpers._planner_source_for_item_id(session, item_id)
        if not source_relpath and any(move.source == item_id for move in pending.moves):
            source_relpath = item_id
        if not source_relpath:
            raise RuntimeError("ITEM_NOT_FOUND")

        if move_to_review or target_dir is not None or target_slot is not None:
            destination_dir = self.helpers._normalized_target_directory(
                session,
                pending,
                target_dir=target_dir,
                target_slot=target_slot,
                move_to_review=move_to_review,
            )
            task, _ = self.helpers._build_organize_task(session, pending)
            adapter = self.helpers._task_planner_adapter(session)
            task = adapter.assign_mapping(
                task,
                source_relpath=source_relpath,
                target_dir=destination_dir,
                user_overridden=True,
            )
            pending = self.helpers._pending_plan_from_task(session, task)
        else:
            raise RuntimeError("ITEM_NOT_FOUND")

        pending = self.helpers._apply_task_state(
            session,
            task,
            {"diff_summary": ["update_item"]},
            prefer_local_summary=True,
        )
        self.helpers._sync_manual_diff_from_last_ai(session, pending)
        self.helpers._sync_session_views(session)

        self.helpers.store.save(session)
        self.helpers._record_event("plan.updated", session)
        return SessionMutationResult(session_snapshot=self.helpers._build_snapshot(session))
