from __future__ import annotations

import json
import logging
import uuid
from queue import Queue
from pathlib import Path

from file_organizer.analysis import service as analysis_service
from file_organizer.app.async_scanner import AsyncScanner
from file_organizer.app.models import CreateSessionResult, OrganizerSession, SessionMutationResult
from file_organizer.app.session_store import SessionStore
from file_organizer.execution import service as execution_service
from file_organizer.organize import service as organize_service
from file_organizer.organize.models import FinalPlan, PendingPlan, PlanMove
from file_organizer.organize.strategy_templates import (
    build_strategy_prompt_fragment,
    normalize_strategy_selection,
)
from file_organizer.rollback import service as rollback_service
from file_organizer.shared.logging_utils import append_debug_event


logger = logging.getLogger(__name__)


class OrganizerSessionService:
    _TERMINAL_STAGES = {"abandoned", "completed", "stale"}
    _LOCKED_STAGES = {"scanning", "executing", "rolling_back"}

    def __init__(self, store: SessionStore, scanner: AsyncScanner | None = None):
        self.store = store
        self.async_scanner = scanner or AsyncScanner()
        self._event_log: dict[str, list[dict]] = {}
        self._subscribers: dict[str, list[Queue]] = {}

    def create_session(self, target_dir: str, resume_if_exists: bool, strategy: dict | None = None) -> CreateSessionResult:
        path = Path(target_dir)
        latest = self.store.find_latest_by_directory(path)
        if latest is not None and latest.stage not in self._TERMINAL_STAGES:
            if resume_if_exists:
                self._log_runtime_event(
                    "session.resume_available",
                    latest,
                    existing_session_id=latest.session_id,
                )
                return CreateSessionResult(mode="resume_available", restorable_session=latest)
            raise RuntimeError("SESSION_LOCKED")

        session = self.store.create(path)
        normalized_strategy = normalize_strategy_selection(strategy)
        session.strategy_template_id = normalized_strategy["template_id"]
        session.strategy_template_label = normalized_strategy["template_label"]
        session.naming_style = normalized_strategy["naming_style"]
        session.caution_level = normalized_strategy["caution_level"]
        session.strategy_note = normalized_strategy["note"]
        session.user_constraints = [normalized_strategy["note"]] if normalized_strategy["note"] else []
        lock_result = self.store.acquire_directory_lock(path, session.session_id)
        if not lock_result.acquired:
            raise RuntimeError("SESSION_LOCKED")

        self.store.save(session)
        self._log_runtime_event("session.created", session, strategy=self._strategy_selection(session))
        self._write_session_debug_event("session.created", session, payload={"strategy": self._strategy_selection(session)})
        self._record_event("session.created", session)
        return CreateSessionResult(mode="created", session=session)

    def abandon_session(self, session_id: str) -> dict:
        session = self._load_or_raise(session_id)
        session.stage = "abandoned"
        self.store.save(session)
        self.store.mark_abandoned(session_id)
        self.store.release_directory_lock(Path(session.target_dir), session_id)
        self._log_runtime_event("session.abandoned", session)
        self._write_session_debug_event("session.abandoned", session)
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
            self._log_runtime_event("session.stale", session, reason="directory_changed")
            self._write_session_debug_event("session.stale", session, payload={"reason": "directory_changed"})
            self._record_event("session.stale", session)
            return session

        self.store.save(session)
        self._log_runtime_event("session.resumed", session)
        self._write_session_debug_event("session.resumed", session)
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
        session.plan_snapshot = self._plan_snapshot(rebuilt_pending, {"diff_summary": ["refresh"]}, scan_lines=scan_lines)
        session.plan_snapshot["invalidated_items"] = invalidated_items
        session.integrity_flags["is_stale"] = False
        session.integrity_flags["has_invalidated_items"] = bool(invalidated_items)
        session.stale_reason = None
        session.stage = "planning"
        session.precheck_summary = None
        self.store.save(session)
        self._log_runtime_event(
            "session.refreshed",
            session,
            invalidated_count=len(invalidated_items),
        )
        self._write_session_debug_event(
            "session.refreshed",
            session,
            payload={
                "invalidated_count": len(invalidated_items),
                "invalidated_items": invalidated_items,
            },
        )
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

        target_dir = Path(session.target_dir).resolve()
        session.stage = "scanning"
        session.scanner_progress = self._initial_scan_progress(target_dir)
        self.store.save(session)
        self._log_runtime_event("scan.started", session)
        self._write_session_debug_event(
            "scan.started",
            session,
            payload={"entry_count": session.scanner_progress.get("total_count", 0)},
        )
        self._record_event("scan.started", session)
        seen_entries: set[str] = set()
        parallel_state = {"enabled": False}

        def on_scan_event(event_type: str, data: dict):
            self._forward_runtime_event("scan", session.session_id, event_type, data)
            if event_type == "batch_split":
                parallel_state["enabled"] = True
                batch_count = max(1, int(data.get("batch_count") or 1))
                worker_count = max(1, int(data.get("worker_count") or batch_count))
                session.scanner_progress["batch_count"] = batch_count
                session.scanner_progress["completed_batches"] = 0
                session.scanner_progress["message"] = f"文件较多，已拆分为 {batch_count} 个批次并行分析"
                session.scanner_progress["current_item"] = f"已启动 {worker_count} 个并行分析线程"
                self.store.save(session)
                self._record_event("scan.progress", session)
            elif event_type == "batch_progress":
                total_batches = max(1, int(data.get("total_batches") or session.scanner_progress.get("batch_count") or 1))
                completed_batches = max(0, int(data.get("completed_batches") or 0))
                batch_index = max(0, int(data.get("batch_index") or 0))
                batch_size = max(0, int(data.get("batch_size") or 0))
                status = data.get("status") or "completed"
                total_count = max(0, int(session.scanner_progress.get("total_count") or 0))
                session.scanner_progress["batch_count"] = total_batches
                session.scanner_progress["completed_batches"] = completed_batches
                session.scanner_progress["processed_count"] = min(
                    total_count,
                    int((completed_batches / total_batches) * total_count) if total_count else 0,
                )
                if batch_size:
                    session.scanner_progress["current_item"] = f"第 {min(batch_index + 1, total_batches)}/{total_batches} 批（{batch_size} 项）"
                else:
                    session.scanner_progress["current_item"] = f"第 {min(batch_index + 1, total_batches)}/{total_batches} 批"
                if status == "failed":
                    session.scanner_progress["message"] = f"第 {batch_index + 1}/{total_batches} 批失败，正在继续汇总其余批次"
                else:
                    session.scanner_progress["message"] = f"已完成 {completed_batches}/{total_batches} 批并行分析"
                self.store.save(session)
                self._record_event("scan.progress", session)
            elif not parallel_state["enabled"] and self._update_single_scan_progress(
                session,
                target_dir,
                seen_entries,
                event_type,
                data,
            ):
                self.store.save(session)
                self._record_event("scan.progress", session)

        self.async_scanner.start(
            session_id=session.session_id,
            target_dir=target_dir,
            run_scan=lambda d: self._default_scan_runner(d, event_handler=on_scan_event),
            on_complete=self._finish_async_scan,
            on_error=self._fail_async_scan,
        )
        return session

    def get_snapshot(self, session_id: str) -> dict:
        session = self._load_or_raise(session_id)
        self._recover_orphaned_locked_session(session)
        
        # 确保消息 ID 被分配且持久化，以保证连续调用时 ID 稳定（修复单元测试失败）
        changed = self._ensure_message_ids(session.messages)
        if session.assistant_message and not session.assistant_message.get("id"):
            self._ensure_message_id(session.assistant_message)
            changed = True
            
        if changed:
            self.store.save(session)
            
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

    @staticmethod
    def _new_message_id(role: str | None = None) -> str:
        prefix = (role or "msg").replace("_", "-")
        return f"{prefix}-{uuid.uuid4().hex}"

    def _ensure_message_id(self, message: dict) -> dict:
        message.setdefault("id", self._new_message_id(message.get("role")))
        return message

    def _ensure_message_ids(self, messages: list[dict]) -> bool:
        changed = False
        for message in messages:
            if not message.get("id"):
                self._ensure_message_id(message)
                changed = True
        return changed

    def _assistant_messages_from_cycle(self, display_text: str, cycle_result: dict | None) -> tuple[dict, list[dict]]:
        result = cycle_result or {}
        assistant_message = dict(result.get("assistant_message") or {"role": "assistant", "content": display_text or ""})
        assistant_message.setdefault("role", "assistant")
        assistant_message.setdefault("content", display_text or "")
        self._ensure_message_id(assistant_message)

        assistant_context_messages = result.get("assistant_context_messages")
        if assistant_context_messages:
            context_messages = [dict(message) for message in assistant_context_messages]
        else:
            assistant_context_message = dict(result.get("assistant_context_message") or assistant_message)
            assistant_context_message.setdefault("role", "assistant")
            assistant_context_message.setdefault("content", display_text or "")
            context_messages = [assistant_context_message]
        self._ensure_message_ids(context_messages)
        return assistant_message, context_messages

    @staticmethod
    def _message_blocks(message: dict) -> list[dict]:
        blocks = message.get("blocks")
        return blocks if isinstance(blocks, list) else []

    def _find_unresolved_request_message(self, session: OrganizerSession, request_id: str) -> tuple[dict | None, dict | None]:
        for message in reversed(session.messages):
            if message.get("role") != "assistant":
                continue
            for block in self._message_blocks(message):
                if block.get("type") == "unresolved_choices" and block.get("request_id") == request_id:
                    return message, block
        return None, None

    @staticmethod
    def _set_unresolved_request_status(message: dict, request_id: str, submitted_resolutions: list[dict]) -> bool:
        updated = False
        blocks = message.get("blocks")
        if not isinstance(blocks, list):
            return updated
        for block in blocks:
            if block.get("type") != "unresolved_choices" or block.get("request_id") != request_id:
                continue
            block["status"] = "submitted"
            block["submitted_resolutions"] = [dict(item) for item in submitted_resolutions]
            updated = True
        return updated

    def _mark_unresolved_request_submitted(
        self,
        session: OrganizerSession,
        request_id: str,
        submitted_resolutions: list[dict],
    ) -> None:
        for message in session.messages:
            self._set_unresolved_request_status(message, request_id, submitted_resolutions)
        if session.assistant_message:
            self._set_unresolved_request_status(session.assistant_message, request_id, submitted_resolutions)

    @staticmethod
    def _resolution_summary_lines(resolutions: list[dict]) -> list[str]:
        lines = ["我已提交以下待确认项选择："]
        for item in resolutions:
            label = item.get("display_name") or item.get("item_id", "")
            selected_folder = (item.get("selected_folder") or "").strip()
            note = (item.get("note") or "").strip()
            if selected_folder:
                lines.append(f"- {label} -> {selected_folder}")
            if note:
                lines.append(f"- {label} 备注：{note}")
        return lines


    def submit_user_intent(self, session_id: str, content: str) -> SessionMutationResult:
        session = self._load_or_raise(session_id)
        self._ensure_mutable_stage(session)
        session.messages.append(self._ensure_message_id({"role": "user", "content": content}))
        pending_plan = self._pending_plan_from_session(session)
        self._log_runtime_event(
            "plan.user_intent_submitted",
            session,
            message_count=len(session.messages),
            content_preview=content[:120],
        )
        self._write_session_debug_event(
            "plan.user_intent_submitted",
            session,
            payload={"content": content},
        )
        def on_plan_event(event_type: str, data: dict):
            self._forward_runtime_event("plan", session.session_id, event_type, data)

        assistant_message, cycle_result = organize_service.run_organizer_cycle(
            messages=list(session.messages),
            scan_lines=session.scan_lines,
            pending_plan=pending_plan,
            user_constraints=list(session.user_constraints),
            strategy_instructions=self._strategy_prompt_fragment(session),
            event_handler=on_plan_event,
        )
        updated_pending = cycle_result.get("pending_plan", pending_plan) if cycle_result else pending_plan
        session.pending_plan = self._pending_plan_to_dict(updated_pending)
        session.plan_snapshot = self._plan_snapshot(updated_pending, cycle_result or {}, scan_lines=session.scan_lines)
        session.assistant_message, assistant_context_messages = self._assistant_messages_from_cycle(assistant_message, cycle_result)
        session.messages.extend(assistant_context_messages)
        session.summary = updated_pending.summary
        session.user_constraints = list(updated_pending.user_constraints or session.user_constraints)
        session.stage = self._planning_stage_for(updated_pending, session.scan_lines)
        
        # 记录基准方案，用于后续手动操作的 Diff 计算
        session.last_ai_pending_plan = self._pending_plan_to_dict(updated_pending)
        
        self.store.save(session)
        self._log_runtime_event("plan.updated", session, source="user_intent")
        self._write_session_debug_event(
            "plan.updated",
            session,
            payload={"source": "user_intent", "summary": session.summary},
        )
        self._record_event("plan.updated", session)
        return SessionMutationResult(
            session_snapshot=self._build_snapshot(session),
            assistant_message=session.assistant_message,
        )

    def resolve_unresolved_choices(self, session_id: str, request_id: str, resolutions: list[dict]) -> SessionMutationResult:
        session = self._load_or_raise(session_id)
        self._ensure_mutable_stage(session)
        self._log_runtime_event(
            "plan.unresolved_choices_submitted",
            session,
            request_id=request_id,
            resolution_count=len(resolutions or []),
        )
        self._write_session_debug_event(
            "plan.unresolved_choices_submitted",
            session,
            payload={"request_id": request_id, "resolutions": resolutions or []},
        )

        message, request_block = self._find_unresolved_request_message(session, request_id)
        if request_block is None or message is None:
            raise RuntimeError("UNRESOLVED_REQUEST_NOT_FOUND")
        if request_block.get("status") == "submitted":
            return SessionMutationResult(
                session_snapshot=self._build_snapshot(session),
                assistant_message=session.assistant_message,
                changed=False,
            )

        request_items = request_block.get("items") or []
        item_map = {
            item.get("item_id"): dict(item)
            for item in request_items
            if isinstance(item, dict) and item.get("item_id")
        }
        if not item_map:
            raise ValueError("UNRESOLVED_REQUEST_INVALID")

        pending = self._pending_plan_from_session(session)
        move_map = {move.source: move for move in pending.moves}

        submitted_map: dict[str, dict] = {}
        for resolution in resolutions or []:
            item_id = str(resolution.get("item_id") or "").strip()
            if not item_id or item_id not in item_map:
                raise RuntimeError("UNRESOLVED_ITEM_CONFLICT")
            
            # 补救逻辑：如果 AI 在 resolution 中使用了占位 ID（如 unresolved_1），
            # 但 move_map 中没有这个 ID，则尝试通过 display_name 找回真实的 item_id
            real_item_id = item_id
            if item_id not in move_map:
                display_name = item_map[item_id].get("display_name")
                if display_name:
                    # 在 moves 中寻找 display_name 匹配或者是 item_id 包含 display_name 的项
                    for move in pending.moves:
                        if move.source == display_name or Path(move.source).name == display_name:
                            real_item_id = move.source
                            break
            
            selected_folder = str(resolution.get("selected_folder") or "").strip()
            note = str(resolution.get("note") or "").strip()
            allowed_folders = set(item_map[item_id].get("suggested_folders") or [])
            if selected_folder and selected_folder not in allowed_folders and selected_folder != "Review":
                raise ValueError("UNRESOLVED_RESOLUTION_INVALID_FOLDER")
            if not selected_folder and not note:
                raise ValueError("UNRESOLVED_RESOLUTION_EMPTY")
            
            submitted_map[real_item_id] = {
                "item_id": real_item_id,
                "display_name": item_map[item_id].get("display_name", real_item_id),
                "selected_folder": selected_folder,
                "note": note,
            }

        if len(submitted_map) != len(item_map):
            raise ValueError("UNRESOLVED_RESOLUTION_INCOMPLETE")

        for mid in submitted_map:
            # 补丁：容错处理。如果由于 AI 不一致导致该项在 pending_plan 中未被标记为 unresolved，
            # 但既然它存在于我们刚刚找到的 request_block 中，说明 UI 确实发起了这个请求，
            # 因此我们在此处自动将其视为有效的 unresolved 项。
            is_unresolved = False
            for u_item in pending.unresolved_items:
                if mid in u_item:
                    is_unresolved = True
                    break
            
            # 如果依然没找，但该 ID 在当前请求的项目列表中，则强制视为 unresolved
            if not is_unresolved and mid in item_map:
                is_unresolved = True
                if mid not in pending.unresolved_items:
                    pending.unresolved_items.append(mid)

            if mid not in move_map:
                # 最后的补救：如果在 moves 中也没找到，则临时补一个
                new_move = PlanMove(source=mid, target="Review", raw="")
                pending.moves.append(new_move)
                move_map[mid] = new_move
            
            if not is_unresolved:
                raise RuntimeError("UNRESOLVED_ITEM_CONFLICT")

        has_note = False
        for item_id, resolution in submitted_map.items():
            selected_folder = resolution["selected_folder"]
            note = resolution["note"]
            if note:
                has_note = True
            if not selected_folder:
                continue

            move = move_map[item_id]
            filename = Path(item_id).name
            normalized_dir = selected_folder.strip().strip("/\\").replace("\\", "/")
            move.target = f"{normalized_dir}/{filename}" if normalized_dir else filename
            pending.unresolved_items = [value for value in pending.unresolved_items if value != item_id]

        pending.directories = self._directories_from_moves(pending.moves)
        self._mark_unresolved_request_submitted(session, request_id, list(submitted_map.values()))
        summary_message = self._ensure_message_id(
            {
                "role": "user",
                "content": "\n".join(self._resolution_summary_lines(list(submitted_map.values()))),
                "visibility": "internal",
            }
        )
        session.messages.append(summary_message)

        if has_note:
            def on_plan_event(event_type: str, data: dict):
                self._forward_runtime_event("plan", session.session_id, event_type, data)

            assistant_message, cycle_result = organize_service.run_organizer_cycle(
                messages=list(session.messages),
                scan_lines=session.scan_lines,
                pending_plan=pending,
                user_constraints=list(session.user_constraints),
                strategy_instructions=self._strategy_prompt_fragment(session),
                event_handler=on_plan_event,
            )
            updated_pending = cycle_result.get("pending_plan", pending) if cycle_result else pending
            session.pending_plan = self._pending_plan_to_dict(updated_pending)
            session.plan_snapshot = self._plan_snapshot(updated_pending, cycle_result or {}, scan_lines=session.scan_lines)
            session.assistant_message, assistant_context_messages = self._assistant_messages_from_cycle(assistant_message, cycle_result)
            session.messages.extend(assistant_context_messages)
            session.summary = updated_pending.summary
            session.user_constraints = list(updated_pending.user_constraints or session.user_constraints)
            session.stage = self._planning_stage_for(updated_pending, session.scan_lines)
            session.precheck_summary = None
        else:
            session.pending_plan = self._pending_plan_to_dict(pending)
            session.plan_snapshot = self._plan_snapshot(pending, {"diff_summary": ["resolve_unresolved_choices"]}, scan_lines=session.scan_lines)
            session.summary = pending.summary
            session.stage = self._planning_stage_for(pending, session.scan_lines)
            session.precheck_summary = None

        self.store.save(session)
        self._log_runtime_event("plan.updated", session, source="resolve_unresolved_choices")
        self._write_session_debug_event(
            "plan.updated",
            session,
            payload={"source": "resolve_unresolved_choices", "summary": session.summary},
        )
        self._record_event("plan.updated", session)
        return SessionMutationResult(
            session_snapshot=self._build_snapshot(session),
            assistant_message=session.assistant_message,
        )

    def run_precheck(self, session_id: str) -> SessionMutationResult:
        session = self._load_or_raise(session_id)
        self._ensure_mutable_stage(session)
        self._log_runtime_event("precheck.started", session)
        self._write_session_debug_event("precheck.started", session)
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
        self._log_runtime_event(
            "precheck.completed",
            session,
            can_execute=precheck.can_execute,
            blocking_error_count=len(precheck.blocking_errors),
            warning_count=len(precheck.warnings),
        )
        self._write_session_debug_event(
            "precheck.completed",
            session,
            payload=session.precheck_summary,
        )
        self._record_event("precheck.ready", session)
        return SessionMutationResult(session_snapshot=self._build_snapshot(session))

    def return_to_planning(self, session_id: str) -> SessionMutationResult:
        session = self._load_or_raise(session_id)
        if session.stage != "ready_to_execute":
            raise RuntimeError("SESSION_STAGE_CONFLICT")

        pending = self._pending_plan_from_session(session)
        session.precheck_summary = None
        session.stage = self._planning_stage_for(pending, session.scan_lines)
        self.store.save(session)
        self._record_event("plan.updated", session)
        return SessionMutationResult(session_snapshot=self._build_snapshot(session))

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
        filename = Path(item_id).name
        updated = False

        for move in pending.moves:
            if move.source != item_id:
                continue
            destination_dir = "Review" if move_to_review else (target_dir or "")
            normalized_dir = destination_dir.strip().strip("/\\").replace("\\", "/")
            move.target = f"{normalized_dir}/{filename}" if normalized_dir else filename
            updated = True
            break

        if not updated:
            raise RuntimeError("ITEM_NOT_FOUND")

        if move_to_review or target_dir is not None:
            pending.unresolved_items = [value for value in pending.unresolved_items if value != item_id]

        pending.directories = self._directories_from_moves(pending.moves)
        session.pending_plan = self._pending_plan_to_dict(pending)
        session.plan_snapshot = self._plan_snapshot(pending, {"diff_summary": ["update_item"]}, scan_lines=session.scan_lines)
        session.summary = pending.summary
        session.precheck_summary = None
        session.stage = self._planning_stage_for(pending, session.scan_lines)

        # 查找或创建一个用于同步手动操作的消息
        # 我们希望 AI 看到的是从它上次给出建议到目前为止，用户所做的“全量差异汇总”
        sync_tag = "[用户手动调整记录]"
        baseline = session.last_ai_pending_plan
        if not baseline:
             # 如果没有基准（理论上不应发生），则使用当前方案作为基准（此时 Diff 为空）
             baseline = self._pending_plan_to_dict(pending)
             session.last_ai_pending_plan = baseline

        # 计算从 AI 基准到当前手动修改后的全量 Diff
        diff_lines = organize_service._build_plan_change_summary(
            self._pending_plan_from_dict(baseline, session),
            pending
        )
        
        diff_content = f"{sync_tag}\n用户在预览区域对方案进行了如下手动调整：\n" + "\n".join(f"- {line}" for line in diff_lines)
        
        # 尝试寻找并覆盖现有的同步消息，避免对话历史堆积
        existing_sync_index = -1
        for i in range(len(session.messages) - 1, -1, -1):
            msg = session.messages[i]
            if msg.get("role") == "user" and sync_tag in (msg.get("content") or ""):
                existing_sync_index = i
                break
        
        if existing_sync_index >= 0:
            session.messages[existing_sync_index]["content"] = diff_content
            session.messages[existing_sync_index]["visibility"] = "internal"
        else:
            sync_message = self._ensure_message_id({
                "role": "user",
                "content": diff_content,
                "visibility": "internal",
            })
            session.messages.append(sync_message)

        self.store.save(session)
        self._record_event("plan.updated", session)
        return SessionMutationResult(session_snapshot=self._build_snapshot(session))

    def execute(self, session_id: str, confirm: bool) -> SessionMutationResult:
        if not confirm:
            raise ValueError("confirmation_required")

        session = self._load_or_raise(session_id)
        if session.stage != "ready_to_execute":
            raise RuntimeError("SESSION_STAGE_CONFLICT")

        session.stage = "executing"
        self.store.save(session)
        self._log_runtime_event("execution.started", session)
        self._write_session_debug_event("execution.started", session)
        self._record_event("execution.started", session)

        final_plan = self._final_plan_from_session(session)
        plan = execution_service.build_execution_plan(final_plan, Path(session.target_dir))
        report = execution_service.execute_plan(plan)
        journal_id = self._latest_execution_id(Path(session.target_dir))
        if not journal_id:
            session.stage = "interrupted"
            session.last_error = "missing_execution_journal"
            self.store.save(session)
            self._log_runtime_event("execution.failed", session, reason="missing_execution_journal", level=logging.ERROR)
            self._write_session_debug_event(
                "execution.failed",
                session,
                level="ERROR",
                payload={"reason": "missing_execution_journal"},
            )
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
        self._log_runtime_event(
            "execution.completed",
            session,
            execution_id=journal_id,
            success_count=report.success_count,
            failure_count=report.failure_count,
        )
        self._write_session_debug_event(
            "execution.completed",
            session,
            payload=session.execution_report,
        )
        self._record_event("execution.completed", session)
        return SessionMutationResult(session_snapshot=self._build_snapshot(session))

    def rollback(self, session_id: str, confirm: bool) -> SessionMutationResult:
        if not confirm:
            raise ValueError("confirmation_required")

        session = self.store.load(session_id)
        if session is None:
            journal = execution_service.load_execution_journal(session_id)
            if journal is None:
                raise KeyError(f"Session {session_id} not found")
            return self._rollback_execution_journal(journal)

        if session.stage not in {"completed", "interrupted"}:
            raise RuntimeError("SESSION_STAGE_CONFLICT")

        lock_result = self.store.acquire_directory_lock(Path(session.target_dir), session.session_id)
        if not lock_result.acquired:
            raise RuntimeError("SESSION_LOCKED")

        session.stage = "rolling_back"
        self.store.save(session)
        self._log_runtime_event("rollback.started", session)
        self._write_session_debug_event("rollback.started", session)
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
        self._log_runtime_event(
            "rollback.completed",
            session,
            journal_id=journal.execution_id,
            success_count=report.success_count,
            failure_count=report.failure_count,
        )
        self._write_session_debug_event(
            "rollback.completed",
            session,
            payload=session.rollback_report,
        )
        self._record_event("rollback.completed", session)
        return SessionMutationResult(session_snapshot=self._build_snapshot(session))

    def _rollback_execution_journal(self, journal) -> SessionMutationResult:
        if journal.status not in {"completed", "partial_failure"}:
            raise RuntimeError("SESSION_STAGE_CONFLICT")

        target_dir = Path(journal.target_dir)
        lock_result = self.store.acquire_directory_lock(target_dir, journal.execution_id)
        if not lock_result.acquired:
            raise RuntimeError("SESSION_LOCKED")

        try:
            plan = rollback_service.build_rollback_plan(journal)
            report = rollback_service.execute_rollback_plan(plan)
            rollback_service.finalize_rollback_state(journal, report)
        finally:
            self.store.release_directory_lock(target_dir, journal.execution_id)

        return SessionMutationResult(
            session_snapshot={
                "session_id": journal.execution_id,
                "target_dir": journal.target_dir,
                "stage": "stale",
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

    def list_history(self) -> list[dict]:
        from file_organizer.shared import config
        import json
        
        history_map: dict[str, dict] = {}
        
        # 1. 加载已执行的历史记录 (Executions)
        executions_dir = config.EXECUTION_LOG_DIR
        if executions_dir.exists():
            for path in executions_dir.glob("*.json"):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    exec_id = data["execution_id"]
                    history_map[exec_id] = {
                        "execution_id": exec_id,
                        "target_dir": data["target_dir"],
                        "status": data["status"],
                        "created_at": data["created_at"],
                        "item_count": len(data.get("items", [])),
                        "failure_count": sum(1 for it in data.get("items", []) if it.get("status") == "failed"),
                        "is_session": False
                    }
                except (json.JSONDecodeError, KeyError):
                    continue

        # 2. 加载活跃会话 (Active Sessions)
        # 即使应用在扫描/执行中被关闭，也要能在历史里看到这条会话
        for session in self.store.list_sessions():
            self._recover_orphaned_locked_session(session)
            stage = session.stage
            if stage in {"abandoned", "completed"}:
                continue

            history_map[session.session_id] = {
                "execution_id": session.session_id,
                "target_dir": session.target_dir,
                "status": stage,
                "created_at": session.updated_at or session.created_at,
                "item_count": session.plan_snapshot.get("stats", {}).get("move_count", 0),
                "failure_count": 0,
                "is_session": True,
            }
                
        history = list(history_map.values())
        # Sort by creation/update time descending
        history.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
        return history

    def delete_history_entry(self, entry_id: str) -> dict:
        session = self.store.load(entry_id)
        if session is not None:
            deleted = self.store.delete(entry_id)
            if not deleted:
                raise FileNotFoundError(entry_id)
            return {"status": "deleted", "entry_id": entry_id, "entry_type": "session"}

        journal = execution_service.load_execution_journal(entry_id)
        if journal is not None:
            deleted = execution_service.delete_execution_journal(entry_id)
            if not deleted:
                raise FileNotFoundError(entry_id)
            return {"status": "deleted", "entry_id": entry_id, "entry_type": "execution"}

        raise FileNotFoundError(entry_id)

    def get_journal_summary(self, session_id: str) -> dict:
        journal_id = None
        try:
            session = self._load_or_raise(session_id)
            journal_id = session.last_journal_id or self._latest_execution_id(Path(session.target_dir))
        except (KeyError, FileNotFoundError):
            # Fallback: assume the ID itself is a journal/execution ID
            journal_id = session_id
            
        if not journal_id:
            raise FileNotFoundError("latest_execution")
        journal = execution_service.load_execution_journal(journal_id)
        if journal is None:
            raise FileNotFoundError(f"execution_journal_not_found: {journal_id}")
        restore_items = []
        if journal.rollback_attempts:
            latest_attempt = journal.rollback_attempts[-1]
            restore_items = [
                {
                    "action_type": item.get("action_type"),
                    "status": item.get("status"),
                    "source": item.get("source"),
                    "target": item.get("target"),
                    "display_name": Path(item.get("source") or item.get("target") or "unknown").name,
                }
                for item in latest_attempt.get("results", [])
                if item.get("action_type") == "MOVE"
            ]
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
            "restore_items": restore_items,
            "items": [
                {
                    "action_type": item.action_type,
                    "status": item.status,
                    "source": item.source_before,
                    "target": item.target_after,
                    "display_name": Path(item.source_before).name if item.source_before else (Path(item.created_path).name if item.created_path else "unknown")
                }
                for item in journal.items
            ]
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
        self._log_runtime_event(
            "cleanup.completed",
            session,
            cleaned_count=len(cleaned),
            candidate_count=len(empty_dirs),
        )
        self._write_session_debug_event(
            "cleanup.completed",
            session,
            payload={
                "candidate_count": len(empty_dirs),
                "cleaned_count": len(cleaned),
                "cleaned_dirs": [str(path) for path in cleaned],
            },
        )
        self._record_event("cleanup.completed", session, cleaned_count=len(cleaned))
        return {
            "session_id": session_id,
            "cleaned_count": len(cleaned),
            "session_snapshot": self._build_snapshot(session),
        }

    def _forward_runtime_event(self, phase: str, session_id: str, event_type: str, data: dict) -> None:
        if event_type in {"model_wait_start", "tool_start"}:
            self._record_event(f"{phase}.action", session_id=session_id, action=data)
        elif event_type == "ai_chunk":
            self._record_event(f"{phase}.ai_typing", session_id=session_id, content=data.get("content"))

    def _initial_scan_progress(self, target_dir: Path) -> dict:
        return {
            "status": "running",
            "processed_count": 0,
            "total_count": self._count_visible_entries(target_dir),
            "current_item": "正在准备扫描任务",
            "recent_analysis_items": [],
            "completed_batches": 0,
            "message": "正在读取目录结构",
        }

    def _top_level_scan_entry(self, target_dir: Path, raw_path: str | None) -> str | None:
        if not raw_path:
            return None
        candidate = Path(raw_path)
        if not candidate.is_absolute():
            candidate = (target_dir / candidate).resolve()
        else:
            candidate = candidate.resolve()
        try:
            relative = candidate.relative_to(target_dir.resolve())
        except ValueError:
            return None
        if not relative.parts:
            return None
        return relative.parts[0]

    def _update_single_scan_progress(
        self,
        session: OrganizerSession,
        target_dir: Path,
        seen_entries: set[str],
        event_type: str,
        data: dict,
    ) -> bool:
        progress = dict(session.scanner_progress or {})
        total_count = max(0, int(progress.get("total_count") or 0))
        changed = False

        def set_field(key: str, value) -> None:
            nonlocal changed
            if progress.get(key) != value:
                progress[key] = value
                changed = True

        if event_type == "model_wait_start":
            set_field("message", data.get("message") or "正在分析目录内容")
            if not progress.get("current_item"):
                set_field("current_item", "正在等待模型响应")
        elif event_type == "tool_start":
            args = data.get("args") or {}
            tool_name = data.get("name") or ""
            target_name = None
            message = "正在补充扫描证据"

            if tool_name == "read_local_file":
                raw_filename = args.get("filename")
                target_name = self._top_level_scan_entry(target_dir, raw_filename) or Path(str(raw_filename or "文件")).name
                message = f"正在读取 {target_name}"
            elif tool_name == "list_local_files":
                raw_directory = args.get("directory")
                target_name = self._top_level_scan_entry(target_dir, raw_directory)
                if target_name:
                    message = f"正在查看 {target_name} 的目录内容"
                else:
                    target_name = "当前目录"
                    message = "正在读取目录结构"

            if target_name:
                set_field("current_item", target_name)
                # 实时追加到最近分析项列表中，用于前端“正在看什么”的可视化
                if target_name not in {"当前目录", "正在准备扫描任务"}:
                    recent = list(progress.get("recent_analysis_items") or [])
                    # 避免重复添加同一个正在处理的项目
                    if not any(item.get("display_name") == target_name for item in recent):
                        recent.insert(0, {
                            "item_id": target_name,
                            "display_name": target_name,
                            "source_relpath": target_name,
                            "suggested_purpose": "分析中",
                            "summary": "正在读取内容"
                        })
                        set_field("recent_analysis_items", recent[:8]) # 保留最近 8 条

            set_field("message", message)

            if target_name and target_name not in {"当前目录", "正在准备扫描任务"} and target_name not in seen_entries:
                seen_entries.add(target_name)
                set_field("processed_count", min(total_count, len(seen_entries)) if total_count else len(seen_entries))
        elif event_type == "ai_streaming_start":
            set_field("message", "正在汇总扫描结果")
        elif event_type == "ai_chunk":
            set_field("message", "正在输出扫描结论")
        elif event_type == "validation_fail":
            set_field("message", "扫描结果需要修正，正在重新校验")
        elif event_type == "validation_pass" or event_type == "batch_progress":
            # 强化：当一个批次或单次扫描验证通过时，同步更新最近分析项为“真实结果”
            items_data = data.get("items") or []
            if items_data:
                recent = list(progress.get("recent_analysis_items") or [])
                # 转换数据格式
                new_items = []
                for item in items_data:
                    new_items.append({
                        "item_id": item.get("entry_name"),
                        "display_name": item.get("entry_name"),
                        "source_relpath": item.get("entry_name"),
                        "suggested_purpose": item.get("suggested_purpose", "待判断"),
                        "summary": item.get("summary", ""),
                    })
                
                # 合并并去重（优先使用最新的真实分析结果）
                # 用字典按 display_name 去重，真实结果覆盖占位符
                merged_map = {item["display_name"]: item for item in reversed(recent)}
                for item in new_items:
                    merged_map[item["display_name"]] = item
                
                # 重新转回列表，新结果排在前面
                updated_recent = sorted(merged_map.values(), key=lambda x: 0 if any(ni["display_name"] == x["display_name"] for ni in new_items) else 1)
                set_field("recent_analysis_items", updated_recent[:10])

            if event_type == "validation_pass":
                set_field("message", "扫描分析已完成")
                if total_count > 1:
                    set_field("processed_count", max(int(progress.get("processed_count") or 0), total_count - 1))
            else:
                # batch_progress
                set_field("batch_count", data.get("total_batches"))
                set_field("completed_batches", data.get("completed_batches"))
                if data.get("status") == "failed":
                    set_field("message", "当前批次正在重试")
                else:
                    set_field("message", f"已完成 {data.get('completed_batches')}/{data.get('total_batches')} 个批次")
        
        elif event_type == "cycle_start" and int(data.get("attempt") or 1) > 1:
            attempt = int(data.get("attempt") or 1)
            max_attempts = int(data.get("max_attempts") or attempt)
            set_field("message", f"正在进行第 {attempt}/{max_attempts} 轮校验")

        if changed:
            session.scanner_progress = progress
        return changed

    def _default_scan_runner(self, target_dir: Path, event_handler=None) -> str:
        return analysis_service.run_analysis_cycle(target_dir, event_handler=event_handler)

    def _finish_async_scan(self, session_id: str, scan_lines: str) -> None:
        session = self._load_or_raise(session_id)
        if session.stage != "scanning":
            return
        all_entries = self._scan_entries(scan_lines)
        session.scan_lines = scan_lines or ""
        recent_items = all_entries[-5:]
        existing_progress = dict(session.scanner_progress or {})
        session.scanner_progress = {
            **existing_progress,
            "status": "completed",
            "processed_count": len(all_entries),
            "total_count": self._count_visible_entries(Path(session.target_dir)),
            "current_item": recent_items[-1]["display_name"] if recent_items else None,
            "recent_analysis_items": recent_items,
        }
        if existing_progress.get("batch_count"):
            session.scanner_progress["completed_batches"] = existing_progress.get("batch_count")
            session.scanner_progress["message"] = f"已完成 {existing_progress.get('batch_count')}/{existing_progress.get('batch_count')} 个并行批次"
        else:
            session.scanner_progress["message"] = "扫描分析已完成"
        session.stage = "planning"
        
        # Initialize messages if empty
        if not session.messages:
            session.messages = organize_service.build_initial_messages(
                session.scan_lines,
                strategy=self._strategy_selection(session),
                user_constraints=list(session.user_constraints),
            )
            self._ensure_message_ids(session.messages)
            
        self.store.save(session)
        self._log_runtime_event(
            "scan.completed",
            session,
            entry_count=len(all_entries),
            auto_plan_pending=not session.assistant_message and not (session.plan_snapshot or {}).get("moves"),
        )
        self._write_session_debug_event(
            "scan.completed",
            session,
            payload={
                "entry_count": len(all_entries),
                "recent_items": recent_items,
            },
        )
        self._record_event("scan.completed", session)

        # Trigger initial organization cycle automatically if no plan suggestion yet
        if not session.assistant_message and not (session.plan_snapshot or {}).get("moves"):
            def on_plan_event(event_type: str, data: dict):
                self._forward_runtime_event("plan", session.session_id, event_type, data)

            try:
                self._log_runtime_event("plan.auto_started", session)
                self._write_session_debug_event("plan.auto_started", session)
                assistant_message, cycle_result = organize_service.run_organizer_cycle(
                    messages=list(session.messages),
                    scan_lines=session.scan_lines,
                    pending_plan=self._pending_plan_from_session(session),
                    user_constraints=list(session.user_constraints),
                    strategy_instructions=self._strategy_prompt_fragment(session),
                    event_handler=on_plan_event,
                )
                # NOTE: 即使 content 为空字符串也必须追加，否则后续对话上下文断裂
                session.assistant_message, assistant_context_messages = self._assistant_messages_from_cycle(
                    assistant_message or "",
                    cycle_result,
                )
                session.messages.extend(assistant_context_messages)
                
                if cycle_result:
                    updated_pending = cycle_result.get("pending_plan")
                    if updated_pending:
                        session.pending_plan = self._pending_plan_to_dict(updated_pending)
                        session.plan_snapshot = self._plan_snapshot(updated_pending, cycle_result, scan_lines=session.scan_lines)
                        session.summary = updated_pending.summary
                        session.stage = self._planning_stage_for(updated_pending, session.scan_lines)
                        # 记录基准方案
                        session.last_ai_pending_plan = self._pending_plan_to_dict(updated_pending)
                
                self.store.save(session)
                self._log_runtime_event("plan.auto_completed", session, summary=session.summary)
                self._write_session_debug_event(
                    "plan.auto_completed",
                    session,
                    payload={"summary": session.summary},
                )
                self._record_event("plan.updated", session)
            except Exception as exc:
                logger.exception(
                    "plan.auto_failed session_id=%s target_dir=%s",
                    session.session_id,
                    session.target_dir,
                )
                session.last_error = f"自动规划失败: {str(exc)}"
                session.stage = "interrupted"
                self.store.save(session)
                self._log_runtime_event("plan.auto_failed", session, level=logging.ERROR, error=str(exc))
                self._write_session_debug_event(
                    "plan.auto_failed",
                    session,
                    level="ERROR",
                    payload={"error": str(exc)},
                )
                self._record_event("plan.updated", session)

    def _fail_async_scan(self, session_id: str, exc: Exception) -> None:
        session = self._load_or_raise(session_id)
        session.stage = "interrupted"
        session.last_error = str(exc)
        session.scanner_progress = {**dict(session.scanner_progress or {}), "status": "failed", "message": str(exc)}
        self.store.save(session)
        logger.exception(
            "scan.failed session_id=%s target_dir=%s",
            session.session_id,
            session.target_dir,
            exc_info=exc,
        )
        self._log_runtime_event("scan.failed", session, level=logging.ERROR, error=str(exc))
        self._write_session_debug_event(
            "scan.failed",
            session,
            level="ERROR",
            payload={"error": str(exc)},
        )
        self._record_event("session.error", session)

    def _run_scan_sync(self, session: OrganizerSession, scan_runner) -> str:
        session.stage = "scanning"
        session.scanner_progress = self._initial_scan_progress(Path(session.target_dir))
        self.store.save(session)
        self._record_event("scan.started", session)
        result = scan_runner(Path(session.target_dir))
        all_entries = self._scan_entries(result)
        recent_items = all_entries[-5:]
        session.scan_lines = result or ""
        session.stage = "planning"
        session.scanner_progress = {
            **dict(session.scanner_progress or {}),
            "status": "completed",
            "processed_count": len(all_entries),
            "total_count": self._count_visible_entries(Path(session.target_dir)),
            "current_item": recent_items[-1]["display_name"] if recent_items else None,
            "recent_analysis_items": recent_items,
            "message": "已完成单线程扫描分析",
        }
        self.store.save(session)
        self._log_runtime_event("scan.completed", session, entry_count=len(all_entries), mode="sync")
        self._write_session_debug_event(
            "scan.completed",
            session,
            payload={"entry_count": len(all_entries), "mode": "sync"},
        )
        self._record_event("scan.completed", session)
        return result

    def _load_or_raise(self, session_id: str) -> OrganizerSession:
        session = self.store.load(session_id)
        if session is None:
            raise KeyError(f"Session {session_id} not found")
        if self._ensure_plan_snapshot_consistency(session):
            self.store.save(session)
        return session

    def _ensure_not_locked(self, session: OrganizerSession):
        if session.stage in self._LOCKED_STAGES:
            raise RuntimeError("SESSION_LOCKED")

    def _ensure_mutable_stage(self, session: OrganizerSession):
        if session.stage in self._TERMINAL_STAGES or session.stage in self._LOCKED_STAGES:
            raise RuntimeError("SESSION_STAGE_CONFLICT")

    def _build_snapshot(self, session: OrganizerSession) -> dict:
        for message in session.messages:
            if not message.get("id"):
                self._ensure_message_id(message)
        if session.assistant_message and not session.assistant_message.get("id"):
            self._ensure_message_id(session.assistant_message)
        self._ensure_plan_snapshot_consistency(session)
        return {
            "session_id": session.session_id,
            "target_dir": str(session.target_dir),
            "stage": session.stage,
            "summary": session.summary,
            "scanner_progress": session.scanner_progress,
            "plan_snapshot": session.plan_snapshot,
            "precheck_summary": session.precheck_summary,
            "execution_report": session.execution_report,
            "rollback_report": session.rollback_report,
            "assistant_message": session.assistant_message,
            "messages": session.messages,
            "user_constraints": list(session.user_constraints),
            "integrity_flags": session.integrity_flags,
            "stale_reason": session.stale_reason,
            "last_journal_id": session.last_journal_id,
            "last_error": session.last_error,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "strategy": {
                "template_id": session.strategy_template_id,
                "template_label": session.strategy_template_label,
                "naming_style": session.naming_style,
                "naming_style_label": {"zh": "中文目录", "en": "英文目录", "minimal": "极简目录"}.get(session.naming_style, session.naming_style),
                "caution_level": session.caution_level,
                "caution_level_label": {"conservative": "保守", "balanced": "平衡"}.get(session.caution_level, session.caution_level),
                "note": session.strategy_note,
            }
        }

    def _pending_plan_from_session(self, session: OrganizerSession) -> PendingPlan:
        return self._pending_plan_from_dict(session.pending_plan, session)

    def _ensure_plan_snapshot_consistency(self, session: OrganizerSession) -> bool:
        existing = session.plan_snapshot or {}
        pending = self._pending_plan_from_session(session)
        pending.summary = pending.summary or session.summary or existing.get("summary", "")

        if not pending.moves and not existing:
            return False

        rebuilt = self._plan_snapshot(
            pending,
            {
                "invalidated_items": list(existing.get("invalidated_items", [])),
                "diff_summary": list(existing.get("diff_summary", [])),
            },
            scan_lines=session.scan_lines,
        )

        if existing.get("change_highlights"):
            rebuilt["change_highlights"] = list(existing.get("change_highlights", []))

        if existing == rebuilt:
            return False

        session.plan_snapshot = rebuilt
        if pending.summary:
            session.summary = pending.summary
        return True

    def _pending_plan_from_dict(self, data: dict | None, session: OrganizerSession) -> PendingPlan:
        if not data:
            return PendingPlan(directories=[], moves=[], user_constraints=list(session.user_constraints))
        return PendingPlan(
            directories=data.get("directories", []),
            moves=[PlanMove(**m) for m in data.get("moves", [])],
            user_constraints=data.get("user_constraints", list(session.user_constraints)),
            unresolved_items=data.get("unresolved_items", []),
            summary=data.get("summary", ""),
        )

    def _pending_plan_to_dict(self, plan: PendingPlan) -> dict:
        return {
            "directories": plan.directories,
            "moves": [m.__dict__ for m in plan.moves],
            "user_constraints": plan.user_constraints,
            "unresolved_items": plan.unresolved_items,
            "summary": plan.summary,
        }

    def _final_plan_from_session(self, session: OrganizerSession) -> FinalPlan:
        pending = self._pending_plan_from_session(session)
        return FinalPlan(
            directories=pending.directories,
            moves=pending.moves,
        )

    def _plan_snapshot(self, plan: PendingPlan, cycle_result: dict, scan_lines: str = "") -> dict:
        scan_entry_map = {
            entry["item_id"]: entry
            for entry in self._scan_entries(scan_lines)
            if isinstance(entry, dict) and entry.get("item_id")
        }
        items = []
        review_items = []
        grouped_items: dict[str, list[dict]] = {}
        for move in plan.moves:
            scan_meta = scan_entry_map.get(move.source, {})
            status = "planned"
            if move.source in plan.unresolved_items:
                status = "unresolved"
            elif move.target.startswith("Review/") or move.target == "Review":
                status = "review"

            item = {
                "item_id": move.source,
                "display_name": Path(move.source).name,
                "source_relpath": move.source,
                "target_relpath": move.target,
                "suggested_purpose": scan_meta.get("suggested_purpose", ""),
                "content_summary": scan_meta.get("summary", ""),
                "is_unresolved": move.source in plan.unresolved_items,
                "reason": getattr(move, "reason", ""),
                "status": status,
            }
            items.append(item)
            if status == "review":
                review_items.append(item)
            directory = move.target.rsplit("/", 1)[0] if "/" in move.target else ""
            grouped_items.setdefault(directory, []).append(item)
        
        move_count = len([m for m in plan.moves if m.source not in plan.unresolved_items])
        unresolved_count = len(plan.unresolved_items)
        can_precheck = bool(plan.moves) and unresolved_count == 0
        groups = [
            {
                "directory": directory,
                "count": len(group_items),
                "items": group_items,
            }
            for directory, group_items in sorted(grouped_items.items(), key=lambda pair: pair[0])
            if directory
        ]
        
        return {
            "summary": plan.summary,
            "stats": {
                "move_count": move_count,
                "unresolved_count": unresolved_count,
                "directory_count": len(plan.directories),
            },
            "groups": groups,
            "items": items,
            "unresolved_items": list(plan.unresolved_items),
            "review_items": review_items,
            "invalidated_items": list(cycle_result.get("invalidated_items", [])),
            "diff_summary": cycle_result.get("diff_summary", []),
            "readiness": {
                "can_precheck": can_precheck,
            },
        }

    def _directories_from_moves(self, moves: list[PlanMove]) -> list[str]:
        dirs = set()
        for move in moves:
            if "/" in move.target:
                dirs.add(move.target.rsplit("/", 1)[0])
        return sorted(list(dirs))

    def _log_runtime_event(
        self,
        event_type: str,
        session: OrganizerSession,
        *,
        level: int = logging.INFO,
        **details,
    ) -> None:
        summary = {
            "moves": len((session.pending_plan or {}).get("moves", [])),
            "unresolved": len((session.pending_plan or {}).get("unresolved_items", [])),
        }
        if details:
            summary.update(details)
        logger.log(
            level,
            "%s session_id=%s target_dir=%s stage=%s summary=%s",
            event_type,
            session.session_id,
            session.target_dir,
            session.stage,
            json.dumps(summary, ensure_ascii=False),
        )

    def _write_session_debug_event(
        self,
        kind: str,
        session: OrganizerSession,
        *,
        level: str = "INFO",
        payload: dict | list | str | None = None,
    ) -> None:
        append_debug_event(
            kind=kind,
            level=level,
            session_id=session.session_id,
            target_dir=session.target_dir,
            stage=session.stage,
            payload=payload,
        )

    def _record_event(self, event_type: str, session: OrganizerSession | None = None, session_id: str | None = None, **kwargs):
        s_id = session_id or (session.session_id if session else None)
        if not s_id:
            return
        import datetime
        event = {
            "event_type": event_type,
            "session_id": s_id,
            "timestamp": datetime.datetime.now().isoformat(),
            **kwargs
        }
        if session is not None:
            event["stage"] = session.stage
            event["session_snapshot"] = self._build_snapshot(session)
        self._event_log.setdefault(s_id, []).append(event)
        
        # Notify subscribers
        for queue in self._subscribers.get(s_id, []):
            queue.put(event)

    def _planning_stage_for(self, plan: PendingPlan, scan_lines: str) -> str:
        if plan.unresolved_items:
            return "planning"
        if plan.moves:
            return "ready_for_precheck"
        return "planning"

    def _directory_changed(self, session: OrganizerSession) -> bool:
        target_dir = Path(session.target_dir)
        try:
            current_entries = {
                path.name
                for path in target_dir.iterdir()
                if not path.name.startswith(".")
            } if target_dir.exists() else set()
        except Exception:
            return False
        scanned_entries = {
            entry["source_relpath"].replace("\\", "/").split("/", 1)[0]
            for entry in self._scan_entries(session.scan_lines)
            if entry.get("source_relpath")
        }
        if not scanned_entries:
            return False
        return current_entries != scanned_entries

    def _count_visible_entries(self, path: Path) -> int:
        try:
            return len([p for p in path.iterdir() if not p.name.startswith(".")])
        except Exception:
            return 0

    def _scan_entries(self, scan_lines: str) -> list[dict]:
        entries = []
        for line in (scan_lines or "").splitlines():
            if not line.strip():
                continue
            entry_path = ""
            suggested_purpose = ""
            summary = ""
            if "|" in line:
                parts = [part.strip() for part in line.split("|")]
                entry_path = parts[0] if parts else ""
                suggested_purpose = parts[1] if len(parts) > 1 else ""
                summary = parts[2] if len(parts) > 2 else ""
            else:
                parts = line.split(":", 1)
                if len(parts) >= 2:
                    entry_path = parts[1].split("(")[0].strip()
            if not entry_path:
                continue
            entries.append({
                "item_id": entry_path,
                "display_name": Path(entry_path).name,
                "source_relpath": entry_path,
                "suggested_purpose": suggested_purpose,
                "summary": summary,
            })
        return entries

    def _latest_execution_id(self, target_dir: Path) -> str | None:
        journal = rollback_service.load_latest_execution_for_directory(target_dir)
        return journal.execution_id if journal else None

    def _strategy_summary(self, session: OrganizerSession) -> str:
        return f"{session.strategy_template_label} ({session.naming_style}, {session.caution_level})"

    def _strategy_selection(self, session: OrganizerSession) -> dict:
        return {
            "template_id": session.strategy_template_id,
            "naming_style": session.naming_style,
            "caution_level": session.caution_level,
            "note": session.strategy_note,
        }

    def _strategy_prompt_fragment(self, session: OrganizerSession) -> str:
        return build_strategy_prompt_fragment(self._strategy_selection(session))

    def _recover_orphaned_locked_session(self, session: OrganizerSession):
        """If a persisted session was left in a locked stage after app shutdown, mark it interrupted."""
        if session.stage not in self._LOCKED_STAGES:
            return

        interrupted_during = session.stage
        if interrupted_during == "scanning" and self.async_scanner.is_running(session.session_id):
            return

        session.stage = "interrupted"
        session.integrity_flags["interrupted_during"] = interrupted_during
        session.last_error = session.last_error or f"{interrupted_during}_interrupted"
        session.last_journal_id = session.last_journal_id or self._latest_execution_id(Path(session.target_dir))
        self.store.save(session)
        self._log_runtime_event("session.interrupted", session, interrupted_during=interrupted_during)
        self._write_session_debug_event(
            "session.interrupted",
            session,
            payload={"interrupted_during": interrupted_during},
        )
        self._record_event("session.interrupted", session)
