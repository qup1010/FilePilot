from __future__ import annotations

import copy
import json
import logging
import threading
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from queue import Queue
from pathlib import Path

from file_pilot.analysis import service as analysis_service
from file_pilot.app.async_scanner import AsyncScanner
from file_pilot.app.id_registry import IdRegistry
from file_pilot.app.execution_app_service import ExecutionAppService
from file_pilot.app.history_app_service import HistoryAppService
from file_pilot.app.models import (
    AIPendingBaseline,
    ConversationState,
    CreateSessionResult,
    ExecutionState,
    OrganizerSession,
    PendingPlanPayload,
    PlacementPayload,
    PlanGroupPayload,
    PlanMappingPayload,
    PlanSnapshotItem,
    PlanSnapshotPayload,
    PlanTargetSlotPayload,
    SessionMutationResult,
    SourceCollectionItem,
    TaskState,
    TargetProfile,
    TargetProfileDirectory,
    utc_now_iso,
)
from file_pilot.app.planning_conversation_service import PlanningConversationService
from file_pilot.app.session_lifecycle_service import SessionLifecycleService
from file_pilot.app.session_orchestrator import SessionOrchestrator
from file_pilot.app.scan_workflow_service import ScanWorkflowService
from file_pilot.app.snapshot_builder import SnapshotBuilder
from file_pilot.app.source_manager import SourceManager
from file_pilot.app.session_store import SessionStore
from file_pilot.app.target_profile_store import TargetProfileStore
from file_pilot.app.target_manager import TargetManager
from file_pilot.app.target_resolver import TargetResolver
from file_pilot.app.task_planner_adapter import TaskPlannerAdapter
from file_pilot.domain.models import MappingEntry, OrganizeTask, SourceRef, TargetSlot
from file_pilot.execution import service as execution_service
from file_pilot.organize import service as organize_service
from file_pilot.organize.models import FinalPlan, PendingPlan, PlanMove
from file_pilot.organize.strategy_templates import (
    build_strategy_prompt_fragment,
    organize_method_for_organize_mode,
    organize_mode_for_organize_method,
    normalize_strategy_selection,
    task_type_for_organize_mode,
    task_type_for_organize_method,
)
from file_pilot.rollback import service as rollback_service
from file_pilot.shared.config import get_text_stream_max_seconds
from file_pilot.shared.logging_utils import append_debug_event
from file_pilot.shared.path_utils import canonical_target_dir


logger = logging.getLogger(__name__)
CURRENT_PLANNING_SCHEMA_VERSION = 5
CURRENT_AI_BASELINE_SCHEMA_VERSION = 1


class OrganizerSessionService:
    _TERMINAL_STAGES = {"abandoned", "completed", "stale"}
    _LOCKED_STAGES = {"scanning", "executing", "rolling_back"}
    _PLANNING_MUTABLE_STAGES = {"planning", "ready_for_precheck"}
    _RECOVERY_STAGES = {"stale", "interrupted"}
    _EMPTY_SCAN_RESULT_FLAG = "empty_scan_result"

    def __init__(self, store: SessionStore, scanner: AsyncScanner | None = None):
        self.store = store
        self.target_profiles = TargetProfileStore(self.store.root_dir / "target_profiles")
        self.async_scanner = scanner or AsyncScanner()
        self._event_log: dict[str, list[dict]] = {}
        self._subscribers: dict[str, list[Queue]] = {}
        self._active_scan_sessions: set[str] = set()
        self._active_scan_lock = threading.RLock()
        self._active_locked_sessions: dict[str, str] = {}
        self._active_locked_lock = threading.RLock()
        self.source_manager = SourceManager(self)
        self.target_resolver = TargetResolver(self)
        self.target_manager = TargetManager(self)
        self.snapshot_builder = SnapshotBuilder(self)
        self.execution_app = ExecutionAppService(self)
        self.history_app = HistoryAppService(self)
        self.lifecycle = SessionLifecycleService(self)
        self.planning_conversation = PlanningConversationService(self)
        self.scan_workflow = ScanWorkflowService(self)
        self.orchestrator = SessionOrchestrator(self)

    def _mark_scan_active(self, session_id: str) -> None:
        with self._active_scan_lock:
            self._active_scan_sessions.add(str(session_id))

    def _mark_scan_inactive(self, session_id: str) -> None:
        with self._active_scan_lock:
            self._active_scan_sessions.discard(str(session_id))

    def _is_scan_active(self, session_id: str) -> bool:
        with self._active_scan_lock:
            return str(session_id) in self._active_scan_sessions

    def _mark_locked_stage_active(self, session_id: str, stage: str) -> None:
        normalized_stage = str(stage or "").strip()
        if not normalized_stage:
            return
        with self._active_locked_lock:
            self._active_locked_sessions[str(session_id)] = normalized_stage

    def _mark_locked_stage_inactive(self, session_id: str, stage: str | None = None) -> None:
        key = str(session_id)
        with self._active_locked_lock:
            if stage is not None and self._active_locked_sessions.get(key) != str(stage).strip():
                return
            self._active_locked_sessions.pop(key, None)

    def _is_locked_stage_active(self, session_id: str, stage: str | None = None) -> bool:
        key = str(session_id)
        with self._active_locked_lock:
            active_stage = self._active_locked_sessions.get(key)
        if not active_stage:
            return False
        return stage is None or active_stage == str(stage).strip()

    @staticmethod
    def _planner_id_number(planner_id: str) -> int:
        text = str(planner_id or "").strip()
        if len(text) >= 2 and text[0].upper() == "F" and text[1:].isdigit():
            return int(text[1:])
        return 0

    @staticmethod
    def _entry_extension(entry_path: str) -> str:
        suffix = Path(entry_path or "").suffix.lower().lstrip(".")
        return suffix or "item"

    @staticmethod
    def _detect_entry_type(target_dir: Path, entry_name: str) -> str:
        candidate = (target_dir / str(entry_name or "")).resolve()
        if candidate.exists():
            return "dir" if candidate.is_dir() else "file"
        return ""

    def _build_planner_items(self, scan_lines: str, existing_items: list[dict] | None = None) -> list[dict]:
        return self.source_manager.build_planner_items(scan_lines, existing_items=existing_items)

    @staticmethod
    def _planner_items_by_id(session: OrganizerSession) -> dict[str, dict]:
        return {
            str(item.get("planner_id") or "").strip(): dict(item)
            for item in (session.planner_items or [])
            if str(item.get("planner_id") or "").strip()
        }

    @staticmethod
    def _planner_items_by_source(session: OrganizerSession) -> dict[str, dict]:
        return {
            str(item.get("source_relpath") or "").replace("\\", "/").strip(): dict(item)
            for item in (session.planner_items or [])
            if str(item.get("source_relpath") or "").strip()
        }

    def _planner_id_for_source(self, session: OrganizerSession, source_relpath: str) -> str:
        source_key = str(source_relpath or "").replace("\\", "/").strip()
        item = self._planner_items_by_source(session).get(source_key, {})
        return str(item.get("planner_id") or source_key)

    def _planner_source_for_item_id(self, session: OrganizerSession, item_id: str) -> str | None:
        raw_id = str(item_id or "").strip()
        if not raw_id:
            return None
        planner_item = self._planner_items_by_id(session).get(raw_id)
        if planner_item:
            return str(planner_item.get("source_relpath") or "").replace("\\", "/").strip() or None
        source_item = self._planner_items_by_source(session).get(raw_id.replace("\\", "/"))
        if source_item:
            return str(source_item.get("source_relpath") or "").replace("\\", "/").strip() or None
        return None

    def _planner_display_name(self, session: OrganizerSession, item_id: str) -> str:
        source_relpath = self._planner_source_for_item_id(session, item_id) or str(item_id or "").strip()
        planner_item = self._planner_items_by_source(session).get(source_relpath, {})
        return str(planner_item.get("display_name") or Path(source_relpath).name or item_id)

    @staticmethod
    def _target_dir_for_move(target_relpath: str) -> str:
        normalized = str(target_relpath or "").replace("\\", "/").strip("/")
        if "/" not in normalized:
            return ""
        return normalized.rsplit("/", 1)[0]

    @staticmethod
    def _normalize_relpath(value: str | None) -> str:
        return str(value or "").replace("\\", "/").strip().strip("/")

    @staticmethod
    def _normalize_organize_mode(value: str | None) -> str:
        return "incremental" if str(value or "").strip().lower() == "incremental" else "initial"

    @staticmethod
    def _normalize_organize_method(value: str | None) -> str:
        return (
            "assign_into_existing_categories"
            if str(value or "").strip().lower() == "assign_into_existing_categories"
            else "categorize_into_new_structure"
        )

    def _reconcile_session_strategy_fields(self, session: OrganizerSession) -> bool:
        normalized_mode = self._normalize_organize_mode(session.organize_mode)
        expected_method = organize_method_for_organize_mode(normalized_mode)
        changed = False

        if session.organize_mode != normalized_mode:
            session.organize_mode = normalized_mode
            changed = True

        if self._normalize_organize_method(session.organize_method) != expected_method:
            session.organize_method = expected_method
            changed = True

        return changed

    @staticmethod
    def _normalize_source_collection(
        sources: list[dict] | list[SourceCollectionItem] | None,
    ) -> list[SourceCollectionItem]:
        normalized: dict[tuple[str, str], SourceCollectionItem] = {}
        for entry in sources or []:
            if isinstance(entry, SourceCollectionItem):
                item = entry
            elif isinstance(entry, dict):
                item = SourceCollectionItem.from_dict(entry)
            else:
                item = None
            if item is not None:
                key = (item.source_type, canonical_target_dir(item.path))
                normalized.pop(key, None)
                normalized[key] = item
        return list(normalized.values())

    @staticmethod
    def _normalize_target_directories(value: list[str] | None) -> list[str]:
        normalized: dict[str, str] = {}
        for item in value or []:
            text = str(item or "").strip()
            if text:
                key = canonical_target_dir(text)
                normalized.pop(key, None)
                normalized[key] = text
        return list(normalized.values())

    @staticmethod
    def _normalize_target_directory_details(
        value: list[dict] | list[TargetProfileDirectory] | None,
    ) -> list[TargetProfileDirectory]:
        normalized: dict[str, TargetProfileDirectory] = {}
        for entry in value or []:
            if isinstance(entry, TargetProfileDirectory):
                item = entry
            elif isinstance(entry, dict):
                item = TargetProfileDirectory.from_dict(entry)
            else:
                item = None
            if item is None or not str(item.path).strip():
                continue
            key = canonical_target_dir(item.path)
            normalized.pop(key, None)
            normalized[key] = TargetProfileDirectory(
                path=str(item.path).strip(),
                label=str(item.label or "").strip(),
                description=str(item.description or "").strip(),
            )
        return list(normalized.values())

    def _target_directory_details_for_session(self, session: OrganizerSession) -> list[TargetProfileDirectory]:
        details = self._normalize_target_directory_details(session.selected_target_directory_details)
        if details:
            return details
        if session.selected_target_directories:
            return self._resolve_target_directory_details(
                target_profile_id=session.target_profile_id,
                target_directories=list(session.selected_target_directories or []),
                target_directory_details=None,
            )
        return []

    def _resolve_target_directory_details(
        self,
        *,
        target_profile_id: str = "",
        target_directories: list[str] | None = None,
        target_directory_details: list[dict] | list[TargetProfileDirectory] | None = None,
    ) -> list[TargetProfileDirectory]:
        explicit_details = self._normalize_target_directory_details(target_directory_details)
        if explicit_details:
            return explicit_details

        normalized_paths = self._normalize_target_directories(target_directories)
        if not normalized_paths and str(target_profile_id or "").strip():
            profile = self.target_profiles.get(str(target_profile_id or "").strip())
            if profile is not None:
                return self._normalize_target_directory_details(profile.directories)
            return []

        profile_by_path: dict[str, TargetProfileDirectory] = {}
        if str(target_profile_id or "").strip():
            profile = self.target_profiles.get(str(target_profile_id or "").strip())
            if profile is not None:
                profile_by_path = {
                    canonical_target_dir(item.path): item
                    for item in self._normalize_target_directory_details(profile.directories)
                }

        resolved: list[TargetProfileDirectory] = []
        for path in normalized_paths:
            key = canonical_target_dir(path)
            matched = profile_by_path.get(key)
            resolved.append(
                TargetProfileDirectory(
                    path=path,
                    label=str(matched.label or "").strip() if matched else "",
                    description=str(matched.description or "").strip() if matched else "",
                )
            )
        return resolved

    @staticmethod
    def _normalize_placement_root(value: str | None) -> str:
        return TargetResolver.normalize_placement_root(value)

    @classmethod
    def _default_review_root(cls, new_directory_root: str) -> str:
        return TargetResolver.default_review_root(new_directory_root)

    @staticmethod
    def _source_item_scans_contents(item: SourceCollectionItem) -> bool:
        return item.scans_directory_contents

    @staticmethod
    def _source_item_workspace_root(item: SourceCollectionItem) -> Path:
        path = Path(item.path).resolve()
        if item.scans_directory_contents:
            return path
        return path.parent

    @staticmethod
    def _source_item_display_name(item: SourceCollectionItem) -> str:
        return Path(item.path).name or ("file" if item.source_type == "file" else "source")

    @staticmethod
    def _source_item_matches(left: SourceCollectionItem, right: SourceCollectionItem) -> bool:
        return (
            left.source_type == right.source_type
            and str(left.path).strip() == str(right.path).strip()
            and left.normalized_directory_mode == right.normalized_directory_mode
        )

    @classmethod
    def _placement_payload(
        cls,
        placement: PlacementPayload | dict | None = None,
        *,
        new_directory_root: str | None = None,
        review_root: str | None = None,
    ) -> PlacementPayload:
        return TargetResolver.placement_payload(
            placement,
            new_directory_root=new_directory_root,
            review_root=review_root,
        )

    @classmethod
    def _session_title_for(cls, session: OrganizerSession) -> str:
        sources = session.source_collection
        if not sources:
            target_path = Path(session.target_dir)
            name = target_path.name or str(target_path)
            import re
            trimmed = name.strip()
            if re.match(r"^[a-zA-Z]:[\\/]?$", trimmed):
                return f"{trimmed[0].upper()}:\\"
            return name

        def format_source_display_name(path_str: str) -> str:
            trimmed = str(path_str or "").strip()
            if not trimmed:
                return "当前任务"
            import re
            if re.match(r"^[a-zA-Z]:[\\/]?$", trimmed):
                return f"{trimmed[0].upper()}:\\"
            p = Path(trimmed)
            name = p.name
            if not name:
                name = str(p)
            return name

        if len(sources) == 1:
            return format_source_display_name(sources[0].path)
        else:
            first_name = format_source_display_name(sources[0].path)
            return f"{first_name} 等 {len(sources)} 项"

    @classmethod
    def _derive_session_root_dir(
        cls,
        source_collection: list[SourceCollectionItem],
        organize_method: str,
        *,
        output_dir: str = "",
        target_directories: list[str] | None = None,
    ) -> Path:
        if output_dir.strip():
            return Path(output_dir).resolve()
        paths = [
            cls._source_item_workspace_root(item)
            for item in source_collection
            if str(item.path).strip()
        ]
        if not paths:
            raise ValueError("SOURCES_REQUIRED")
        if len(paths) == 1:
            return paths[0]
        directory_paths = [path if path.is_dir() else path.parent for path in paths]
        common = Path(directory_paths[0])
        for candidate in directory_paths[1:]:
            while not str(candidate).lower().startswith(str(common).lower()) and common != common.parent:
                common = common.parent
            while common != common.parent and not str(candidate).lower().startswith(str(common).lower()):
                common = common.parent
        return common.resolve()

    @staticmethod
    def _normalize_destination_index_depth(value: int | str | None) -> int:
        try:
            parsed = int(value or 2)
        except (TypeError, ValueError):
            parsed = 2
        return max(1, min(3, parsed))

    @staticmethod
    def _target_slot_number(slot_id: str) -> int:
        text = str(slot_id or "").strip()
        if len(text) >= 2 and text[0].upper() == "D" and text[1:].isdigit():
            return int(text[1:])
        return 0

    @staticmethod
    def _is_absolute_target_path(value: str | None) -> bool:
        return TargetResolver.is_absolute_target_path(value)

    def _resolve_target_real_path(self, session: OrganizerSession, target_dir: str) -> Path:
        return self.target_resolver.resolve_target_real_path(session, target_dir)

    def _review_target_path(self, session: OrganizerSession, source_relpath: str) -> Path:
        return self.target_resolver.review_target_path(session, source_relpath)

    @staticmethod
    def _task_phase_for_stage(stage: str) -> str:
        normalized = str(stage or "").strip().lower()
        if normalized in {"draft", "selecting_incremental_scope"}:
            return "setup"
        if normalized == "scanning":
            return "analyzing"
        if normalized in {"planning", "ready_for_precheck"}:
            return "planning"
        if normalized == "ready_to_execute":
            return "reviewing"
        if normalized == "executing":
            return "executing"
        if normalized in {"completed", "abandoned", "stale", "interrupted"}:
            return "done"
        return "setup"

    def _source_refs_from_session(self, session: OrganizerSession) -> list[SourceRef]:
        planner_items = list(session.planner_items or [])
        source_collection = self._normalize_source_collection(session.source_collection)
        alias_map = self._source_alias_map_for_items(source_collection)
        if planner_items:
            refs: list[SourceRef] = []
            for item in planner_items:
                source_relpath = str(item.get("source_relpath") or "").replace("\\", "/").strip()
                if not source_relpath:
                    continue
                source_origin, _ = self._origin_for_source_relpath_from_context(
                    session,
                    source_relpath,
                    source_collection,
                    alias_map,
                )
                refs.append(
                    SourceRef(
                        ref_id=str(item.get("planner_id") or self._planner_id_for_source(session, source_relpath) or source_relpath),
                        display_name=str(item.get("display_name") or Path(source_relpath).name),
                        entry_type=str(item.get("entry_type") or ""),
                        origin=source_origin,
                        relpath=source_relpath,
                        suggested_purpose=str(item.get("suggested_purpose") or ""),
                        content_summary=str(item.get("summary") or ""),
                        confidence=item.get("confidence"),
                        ext=str(item.get("ext") or self._entry_extension(source_relpath)),
                    )
                )
            return refs

        refs = []
        for index, entry in enumerate(self._scan_entries(session.scan_lines), start=1):
            source_relpath = str(entry.get("source_relpath") or "").replace("\\", "/").strip()
            if not source_relpath:
                continue
            source_origin, _ = self._origin_for_source_relpath_from_context(
                session,
                source_relpath,
                source_collection,
                alias_map,
            )
            refs.append(
                SourceRef(
                    ref_id=f"F{index:03d}",
                    display_name=str(entry.get("display_name") or Path(source_relpath).name),
                    entry_type=str(entry.get("entry_type") or ""),
                    origin=source_origin,
                    relpath=source_relpath,
                    suggested_purpose=str(entry.get("suggested_purpose") or ""),
                    content_summary=str(entry.get("summary") or ""),
                    confidence=entry.get("confidence"),
                    ext=str(entry.get("ext") or self._entry_extension(source_relpath)),
                )
            )
        return refs

    def _target_slots_from_session(self, session: OrganizerSession) -> list[TargetSlot]:
        if self._normalize_organize_mode(session.organize_mode) != "incremental":
            task_state = self._task_state_payload(session.task_state)
            if task_state.targets:
                return copy.deepcopy(list(task_state.targets or []))

            snapshot = self._plan_snapshot_payload(session.plan_snapshot)
            if snapshot and snapshot.target_slots:
                slots: list[TargetSlot] = []
                for item in snapshot.target_slots:
                    slot_id = str(item.slot_id or "").strip()
                    if not slot_id:
                        continue
                    raw_relpath = str(item.relpath or "").strip()
                    relpath = self._normalize_relpath(raw_relpath)
                    real_path = str(item.real_path or "").strip()
                    if not real_path:
                        if self._is_absolute_target_path(raw_relpath):
                            real_path = str(Path(raw_relpath).resolve())
                        elif relpath:
                            real_path = str(self._resolve_target_real_path(session, relpath))
                        else:
                            real_path = str(Path(session.target_dir).resolve())
                    slots.append(
                        TargetSlot(
                            slot_id=slot_id,
                            display_name=str(item.display_name or Path(relpath or real_path).name),
                            real_path=real_path,
                            depth=int(item.depth or 0),
                            is_new=bool(item.is_new),
                        )
                    )
                if slots:
                    slots.sort(key=lambda item: self._target_slot_number(item.slot_id))
                    return slots
            return []

        selection = self._incremental_selection_snapshot(session)

        base_dir = Path(session.target_dir).resolve()
        next_number = 1
        slots: list[TargetSlot] = []
        tree_nodes = list(selection.get("target_directory_tree") or [])
        if not tree_nodes and selection.get("target_directories"):
            tree_nodes = [
                {"relpath": self._normalize_relpath(path), "name": Path(str(path)).name, "children": []}
                for path in selection.get("target_directories") or []
                if self._normalize_relpath(path)
            ]

        def walk(nodes: list[dict], depth: int) -> list[TargetSlot]:
            nonlocal next_number
            branch: list[TargetSlot] = []
            for node in nodes:
                if not isinstance(node, dict):
                    continue
                relpath = self._normalize_relpath(node.get("relpath"))
                if not relpath:
                    continue
                real_path = (
                    Path(relpath).resolve()
                    if self._is_absolute_target_path(relpath)
                    else (base_dir / relpath).resolve()
                )
                slot = TargetSlot(
                    slot_id=f"D{next_number:03d}",
                    display_name=str(node.get("name") or Path(relpath).name),
                    real_path=str(real_path),
                    depth=depth,
                    is_new=False,
                )
                next_number += 1
                slot.children = []
                slots.append(slot)
                branch.append(slot)
            return branch

        walk(tree_nodes, 0)
        slots.sort(key=lambda item: self._target_slot_number(item.slot_id))
        return slots

    def _build_id_registry(self, session: OrganizerSession, plan: PendingPlan | FinalPlan | None = None) -> IdRegistry:
        registry = IdRegistry()
        for source_ref in self._source_refs_from_session(session):
            registry.register_source(source_ref)

        def register_target_tree(targets: list[TargetSlot]) -> None:
            for target in targets:
                registry.register_target(target)
                if target.children:
                    register_target_tree(target.children)

        register_target_tree(self._target_slots_from_session(session))

        if plan is not None:
            for move in (plan.moves or []):
                target_dir = self._target_dir_for_move(move.target)
                if not target_dir or target_dir == "Review":
                    continue
                real_path = str(self._resolve_target_real_path(session, target_dir))
                registry.ensure_target(
                    display_name=Path(target_dir).name or target_dir,
                    real_path=real_path,
                    depth=max(0, len(Path(target_dir).parts) - 1),
                    is_new=registry.target_for_real_path(real_path) is None,
                )
        return registry

    def _mapping_entries_from_plan(
        self,
        session: OrganizerSession,
        plan: PendingPlan | FinalPlan,
        registry: IdRegistry,
    ) -> list[MappingEntry]:
        source_refs = {source.ref_id: source for source in registry.list_sources()}
        source_ref_ids_by_relpath = {source.relpath: source.ref_id for source in registry.list_sources()}
        entries: list[MappingEntry] = []
        for move in plan.moves or []:
            source_relpath = str(move.source or "").replace("\\", "/").strip()
            if not source_relpath:
                continue
            source_ref_id = source_ref_ids_by_relpath.get(source_relpath)
            if not source_ref_id:
                continue
            target_dir = self._target_dir_for_move(move.target)
            if not target_dir:
                target_slot_id = ""
                status = "skipped"
            elif target_dir == "Review":
                target_slot_id = "Review"
                status = "review"
            else:
                resolved_target = str(self._resolve_target_real_path(session, target_dir))
                slot = registry.ensure_target(
                    display_name=Path(target_dir).name or target_dir,
                    real_path=resolved_target,
                    depth=max(0, len(Path(target_dir).parts) - 1),
                    is_new=registry.target_for_real_path(resolved_target) is None,
                )
                target_slot_id = slot.slot_id
                status = "assigned"
            if source_relpath in (plan.unresolved_items or []):
                status = "unresolved"
            source_ref = source_refs.get(source_ref_id)
            entries.append(
                MappingEntry(
                    source_ref_id=source_ref_id,
                    target_slot_id=target_slot_id,
                    status=status,
                    reason=str(self._planner_items_by_source(session).get(source_relpath, {}).get("suggested_purpose") or ""),
                    confidence=source_ref.confidence if source_ref is not None else None,
                    user_overridden=False,
                )
            )
        return entries

    def _build_organize_task(
        self,
        session: OrganizerSession,
        plan: PendingPlan | FinalPlan | None = None,
    ) -> tuple[OrganizeTask, IdRegistry]:
        active_plan = plan or self._pending_plan_from_session(session)
        base_task = self._task_state_payload(session.task_state).to_task(session.session_id)
        if not base_task.sources:
            base_task = OrganizeTask(
                task_id=session.session_id,
                sources=self._source_refs_from_session(session),
                targets=self._target_slots_from_session(session),
                mappings=[],
                strategy=self._strategy_selection(session),
                user_constraints=list(session.user_constraints),
                phase=self._task_phase_for_stage(session.stage),
            )
        if not base_task.sources:
            base_task.sources = [
                SourceRef(
                    ref_id=f"F{index:03d}",
                    display_name=Path(str(move.source or "")).name,
                    entry_type="file",
                    origin=self._origin_for_source_relpath(session, str(move.source or ""))[0],
                    relpath=str(move.source or "").replace("\\", "/").strip(),
                    suggested_purpose="",
                    content_summary="",
                    ext=self._entry_extension(str(move.source or "")),
                )
                for index, move in enumerate(active_plan.moves or [], start=1)
                if str(move.source or "").strip()
            ]
        adapter = TaskPlannerAdapter(session.target_dir)
        task = adapter.apply_pending_plan(base_task, active_plan)
        task.strategy = self._strategy_selection(session)
        task.user_constraints = list(session.user_constraints)
        task.phase = self._task_phase_for_stage(session.stage)
        registry = self._build_id_registry(session, active_plan)
        if task.sources:
            registered_source_ids = {source.ref_id for source in registry.list_sources()}
            for source in task.sources:
                if source.ref_id not in registered_source_ids:
                    registry.register_source(source)
        if not task.sources:
            task.sources = registry.list_sources()
        if not task.targets:
            task.targets = registry.list_targets()
        if not task.mappings:
            task.mappings = self._mapping_entries_from_plan(session, active_plan, registry)
        return task, registry

    def _target_slot_relpath(self, session: OrganizerSession, target: TargetSlot) -> str:
        return self.target_resolver.target_slot_relpath(session, target)

    def _target_dir_from_slot_id(
        self,
        session: OrganizerSession,
        slot_id: str | None,
        plan: PendingPlan | FinalPlan | None = None,
    ) -> str:
        return self.target_resolver.target_dir_from_slot_id(session, slot_id, plan)

    def _planning_scope_sources(self, session: OrganizerSession) -> list[str]:
        if session.planner_items:
            return [
                str(item.get("source_relpath") or "").replace("\\", "/").strip()
                for item in session.planner_items
                if str(item.get("source_relpath") or "").strip()
            ]
        return [
            str(entry.get("source_relpath") or "").replace("\\", "/").strip()
            for entry in self._scan_entries(session.scan_lines)
            if str(entry.get("source_relpath") or "").strip()
        ]

    @staticmethod
    def _iso_from_timestamp(timestamp: float | None) -> str | None:
        if timestamp is None:
            return None
        return datetime.fromtimestamp(timestamp, timezone.utc).replace(microsecond=0).isoformat()

    def _incremental_selection_defaults(self, session: OrganizerSession) -> dict:
        return {
            "required": self._normalize_organize_mode(session.organize_mode) == "incremental",
            "status": "ready" if session.selected_target_directories else "pending",
            "destination_index_depth": self._normalize_destination_index_depth(session.destination_index_depth),
            "root_directory_options": [],
            "target_directories": list(session.selected_target_directories or []),
            "target_directory_tree": [],
            "pending_items_count": 0,
            "source_scan_completed": False,
        }

    def _incremental_selection_snapshot(self, session: OrganizerSession) -> dict:
        selection = self._incremental_selection_defaults(session)
        selection.update(dict(session.incremental_selection or {}))
        selection["required"] = self._normalize_organize_mode(session.organize_mode) == "incremental"
        status = str(selection.get("status") or "").strip()
        selection["status"] = status if status in {"pending", "scanning", "ready"} else "pending"
        selection["destination_index_depth"] = self._normalize_destination_index_depth(
            selection.get("destination_index_depth", session.destination_index_depth)
        )
        selection["root_directory_options"] = [
            self._normalize_relpath(path)
            for path in (selection.get("root_directory_options") or [])
            if self._normalize_relpath(path)
        ]
        selection["target_directories"] = [
            self._normalize_relpath(path)
            for path in (selection.get("target_directories") or [])
            if self._normalize_relpath(path)
        ]
        selection["target_directory_tree"] = list(selection.get("target_directory_tree") or [])
        try:
            selection["pending_items_count"] = max(0, int(selection.get("pending_items_count") or 0))
        except (TypeError, ValueError):
            selection["pending_items_count"] = 0
        selection["source_scan_completed"] = bool(selection.get("source_scan_completed"))
        return selection

    def _iter_visible_tree_entries(self, root: Path, *, prefix: str = "") -> list[dict]:
        entries: list[dict] = []
        try:
            children = sorted(
                [child for child in root.iterdir() if not child.name.startswith(".")],
                key=lambda child: child.name.lower(),
            )
        except OSError:
            return entries

        for child in children:
            relpath = self._normalize_relpath(f"{prefix}/{child.name}" if prefix else child.name)
            if not relpath:
                continue
            entry_type = "dir" if child.is_dir() else "file"
            entries.append(
                {
                    "source_relpath": relpath,
                    "display_name": child.name,
                    "entry_type": entry_type,
                    "suggested_purpose": "",
                    "summary": "",
                }
            )
            if child.is_dir():
                entries.extend(self._iter_visible_tree_entries(child, prefix=relpath))
        return entries

    def _current_scope_entries_for_session(self, session: OrganizerSession) -> list[dict]:
        source_collection = self._normalize_source_collection(session.source_collection)
        if not source_collection:
            source_collection = [SourceCollectionItem(source_type="directory", path=session.target_dir, directory_mode="contents")]

        alias_map = self._source_alias_map(session)
        entries: list[dict] = []

        def alias_for(item: SourceCollectionItem) -> str:
            return next((key for key, value in alias_map.items() if self._source_item_matches(value, item)), "")

        for item in source_collection:
            item_path = Path(item.path).resolve()
            alias = alias_for(item)
            if item.scans_directory_contents:
                entries.extend(self._iter_visible_tree_entries(item_path, prefix=alias))
                continue

            source_relpath = self._normalize_relpath(alias or item_path.name)
            if not source_relpath:
                continue
            entries.append(
                {
                    "source_relpath": source_relpath,
                    "display_name": item_path.name,
                    "entry_type": "dir" if item.is_atomic_directory else "file",
                    "suggested_purpose": "",
                    "summary": "",
                }
            )
        return entries

    def _current_scope_scan_lines(self, session: OrganizerSession) -> str:
        if self._normalize_organize_mode(session.organize_mode) == "incremental":
            selection = self._incremental_selection_snapshot(session)
            if not selection.get("source_scan_completed"):
                return self._incremental_root_discovery_runner(Path(session.target_dir))

            scan_lines = self._render_scan_lines(self._current_scope_entries_for_session(session))
            selected_targets = list(selection.get("target_directories") or [])
            if selected_targets:
                scan_lines = self._filter_incremental_pending_scan_lines(scan_lines, selected_targets)
            return scan_lines

        return self._render_scan_lines(self._current_scope_entries_for_session(session))

    def _is_empty_scan_result_completed(self, session: OrganizerSession) -> bool:
        return session.stage == "completed" and bool(session.integrity_flags.get(self._EMPTY_SCAN_RESULT_FLAG))

    def _ensure_refreshable_stage(self, session: OrganizerSession) -> None:
        if session.stage in self._RECOVERY_STAGES or session.stage == "selecting_incremental_scope":
            return
        if self._is_empty_scan_result_completed(session):
            return
        raise RuntimeError("SESSION_STAGE_CONFLICT")

    @staticmethod
    def _render_scan_lines(entries: list[dict]) -> str:
        lines: list[str] = []
        for entry in entries:
            source_relpath = str(entry.get("source_relpath") or "").replace("\\", "/").strip()
            if not source_relpath:
                continue
            entry_type = str(entry.get("entry_type") or "").strip().lower() or "file"
            purpose = str(entry.get("suggested_purpose") or "").strip()
            summary = str(entry.get("summary") or "").strip()
            lines.append(f"{source_relpath} | {entry_type} | {purpose} | {summary}".rstrip())
        return "\n".join(lines)

    def _source_alias_map_for_items(self, items: list[SourceCollectionItem]) -> dict[str, SourceCollectionItem]:
        if len(items) == 1 and self._source_item_scans_contents(items[0]):
            return {}
        counts: dict[str, int] = {}
        mapping: dict[str, SourceCollectionItem] = {}
        for item in items:
            base = self._source_item_display_name(item)
            alias = base
            counts[base] = counts.get(base, 0) + 1
            if counts[base] > 1:
                alias = f"{base}_{counts[base]}"
            mapping[alias] = item
        return mapping

    def _source_alias_map(self, session: OrganizerSession) -> dict[str, SourceCollectionItem]:
        return self._source_alias_map_for_items(self._normalize_source_collection(session.source_collection))

    def _source_collection_entry_context(self, session: OrganizerSession) -> dict[str, dict[str, str]]:
        source_collection = self._normalize_source_collection(session.source_collection)
        if not source_collection:
            source_collection = [SourceCollectionItem(source_type="directory", path=session.target_dir)]
        alias_map = self._source_alias_map(session)
        records: list[dict] = []

        def alias_for(item: SourceCollectionItem) -> str:
            return next((key for key, value in alias_map.items() if self._source_item_matches(value, item)), "")

        for item in source_collection:
            item_path = Path(item.path).resolve()
            alias = alias_for(item)
            if item.scans_directory_contents:
                try:
                    children = sorted(
                        [child for child in item_path.iterdir() if not child.name.startswith(".")],
                        key=lambda child: child.name.lower(),
                    )
                except OSError:
                    children = []
                for child in children:
                    child_name = self._normalize_relpath(child.name) or child.name
                    source_relpath = f"{alias}/{child_name}" if alias else child_name
                    records.append(
                        {
                            "entry_id": f"F{len(records) + 1:03d}",
                            "entry_name": source_relpath,
                            "display_name": child.name,
                            "entry_type": "dir" if child.is_dir() else "file",
                            "absolute_path": str(child.resolve()),
                            "source_relpath": source_relpath,
                            "origin_path": str(item_path),
                            "origin_relpath": child_name,
                            "allowed_base_dir": str(item_path),
                        }
                    )
                continue

            selected_entry_name = self._normalize_relpath(item_path.name) or item_path.name
            source_relpath = alias or selected_entry_name
            records.append(
                {
                    "entry_id": f"F{len(records) + 1:03d}",
                    "entry_name": source_relpath,
                    "display_name": item_path.name,
                    "entry_type": "dir" if item.is_atomic_directory else "file",
                    "absolute_path": str(item_path),
                    "source_relpath": source_relpath,
                    "origin_path": str(item_path.parent if item.is_atomic_directory else item_path.parent),
                    "origin_relpath": selected_entry_name,
                    "allowed_base_dir": str(item_path.parent),
                }
            )

        return analysis_service.build_entry_context_from_records(records)

    def _scan_source_collection(
        self,
        session: OrganizerSession,
        scan_runner,
        *,
        session_id: str | None = None,
        event_handler=None,
        cancel_event: threading.Event | None = None,
    ) -> tuple[str, list[dict]]:
        source_collection = self._normalize_source_collection(session.source_collection)
        if not source_collection:
            source_collection = [SourceCollectionItem(source_type="directory", path=session.target_dir)]
        entry_context = self._source_collection_entry_context(session)
        if not entry_context:
            return "", []
        scan_lines = analysis_service.run_analysis_cycle_for_entry_context(
            Path(session.target_dir),
            entry_context,
            event_handler=event_handler,
            session_id=session_id,
            cancel_event=cancel_event,
        )
        entries = self._scan_entries(scan_lines)
        context_by_relpath = {
            str(item.get("entry_name") or "").replace("\\", "/"): item
            for item in entry_context.values()
        }
        enriched_entries: list[dict] = []
        for entry in entries:
            source_relpath = self._normalize_relpath(entry.get("source_relpath"))
            if not source_relpath:
                continue
            context_item = context_by_relpath.get(source_relpath, {})
            enriched_entries.append(
                {
                    **entry,
                    "item_id": source_relpath,
                    "display_name": str(entry.get("display_name") or context_item.get("display_name") or Path(source_relpath).name),
                    "source_relpath": source_relpath,
                    "origin_path": str(context_item.get("origin_path") or Path(session.target_dir).resolve()),
                    "origin_relpath": str(context_item.get("origin_relpath") or source_relpath),
                }
            )
        return self._render_scan_lines(enriched_entries), enriched_entries

    def _origin_for_source_relpath_from_context(
        self,
        session: OrganizerSession,
        source_relpath: str,
        source_collection: list[SourceCollectionItem],
        alias_map: dict[str, SourceCollectionItem],
    ) -> tuple[str, str]:
        normalized = self._normalize_relpath(source_relpath)
        if not source_collection:
            base_dir = Path(session.target_dir).resolve()
            return str(base_dir), normalized
        if not alias_map and len(source_collection) == 1:
            item = source_collection[0]
            if item.scans_directory_contents:
                return str(Path(item.path).resolve()), normalized
            item_path = Path(item.path).resolve()
            return str(item_path.parent), item_path.name
        first_segment, _, remainder = normalized.partition("/")
        target_item = alias_map.get(first_segment)
        if target_item is None:
            first_item = source_collection[0]
            if first_item.scans_directory_contents:
                return str(Path(first_item.path).resolve()), normalized
            first_item_path = Path(first_item.path).resolve()
            return str(first_item_path.parent), first_item_path.name
        if target_item.scans_directory_contents:
            return str(Path(target_item.path).resolve()), remainder or ""
        target_item_path = Path(target_item.path).resolve()
        return str(target_item_path.parent), target_item_path.name

    def _origin_for_source_relpath(self, session: OrganizerSession, source_relpath: str) -> tuple[str, str]:
        source_collection = self._normalize_source_collection(session.source_collection)
        return self._origin_for_source_relpath_from_context(
            session,
            source_relpath,
            source_collection,
            self._source_alias_map_for_items(source_collection),
        )

    def _can_use_single_directory_scan(self, session: OrganizerSession) -> bool:
        source_collection = self._normalize_source_collection(session.source_collection)
        if len(source_collection) != 1:
            return False
        item = source_collection[0]
        if not item.scans_directory_contents:
            return False
        return Path(item.path).resolve() == Path(session.target_dir).resolve()

    def _build_incremental_root_entries(self, target_dir: Path) -> list[dict]:
        if not target_dir.exists():
            return []

        entries: list[dict] = []
        try:
            children = sorted(
                [child for child in target_dir.iterdir() if not child.name.startswith(".")],
                key=lambda item: item.name.lower(),
            )
        except OSError:
            return []

        for child in children:
            relpath = self._normalize_relpath(child.name)
            if not relpath:
                continue
            entry_type = "dir" if child.is_dir() else "file"
            entries.append(
                {
                    "source_relpath": relpath,
                    "display_name": child.name,
                    "entry_type": entry_type,
                    "suggested_purpose": "现有目录" if entry_type == "dir" else "待整理项",
                    "summary": "",
                }
            )
        return entries

    def _incremental_root_discovery_runner(self, target_dir: Path, session_id: str | None = None) -> str:
        del session_id
        return self._render_scan_lines(self._build_incremental_root_entries(target_dir))

    def _root_directory_options_from_scan(self, scan_lines: str) -> list[str]:
        return self.target_manager.root_directory_options_from_scan(scan_lines)

    def _explore_target_directories(
        self,
        target_dir: Path,
        selected_dirs: list[str],
        *,
        max_depth: int = 10,
    ) -> list[dict]:
        return self.target_manager.explore_target_directories(target_dir, selected_dirs, max_depth=max_depth)

    def _filter_incremental_pending_scan_lines(self, scan_lines: str, target_directories: list[str]) -> str:
        return self.target_manager.filter_incremental_pending_scan_lines(scan_lines, target_directories)

    def _validate_incremental_target_dir(self, session: OrganizerSession, target_dir: str, selection: dict | None) -> bool:
        return self.target_resolver.validate_incremental_target_dir(session, target_dir, selection)

    def _planning_context(self, session: OrganizerSession) -> dict:
        selection = self._incremental_selection_snapshot(session)
        task, _ = self._build_organize_task(session)
        return {
            "organize_method": self._normalize_organize_method(session.organize_method),
            "organize_mode": self._normalize_organize_mode(session.organize_mode),
            "scope_sources": self._planning_scope_sources(session),
            "destination_index_depth": selection["destination_index_depth"],
            "new_directory_root": str(self._placement_payload(session.placement).new_directory_root or ""),
            "review_root": str(self._placement_payload(session.placement).review_root or ""),
            "root_directory_options": list(selection["root_directory_options"]),
            "target_directories": list(selection["target_directories"]),
            "target_directory_details": [
                item.to_dict()
                for item in self._target_directory_details_for_session(session)
            ],
            "target_directory_tree": copy.deepcopy(selection["target_directory_tree"]),
            "output_dir": str(session.output_dir or "").strip(),
            "target_profile_id": str(session.target_profile_id or "").strip(),
            "source_refs": [
                {
                    "ref_id": item.ref_id,
                    "display_name": item.display_name,
                    "entry_type": item.entry_type,
                    "relpath": item.relpath,
                }
                for item in task.sources
            ],
            "target_slots": [
                {
                    "slot_id": item.slot_id,
                    "display_name": item.display_name,
                    "relpath": (
                        self._normalize_relpath(Path(item.real_path).resolve().relative_to(Path(session.target_dir).resolve()).as_posix())
                        if Path(item.real_path).resolve().is_relative_to(Path(session.target_dir).resolve())
                        else ""
                    ),
                    "real_path": item.real_path,
                    "depth": item.depth,
                    "is_new": item.is_new,
                }
                for item in task.targets
            ],
            "inspection_context": copy.deepcopy(session.inspection_context or {}),
        }

    @staticmethod
    def _manual_sync_message_tag() -> str:
        return "[用户手动调整记录]"

    def _local_pending_summary(self, plan: PendingPlan) -> str:
        total_moves = len(plan.moves or [])
        unresolved_count = len(plan.unresolved_items or [])
        classified_count = max(0, total_moves - unresolved_count)
        return f"已分类 {classified_count} 项，调整 {total_moves} 项，仍剩 {unresolved_count} 项待定"

    def _sync_pending_summary(
        self,
        session: OrganizerSession,
        pending: PendingPlan,
        *,
        prefer_local: bool = False,
    ) -> str:
        summary = str(pending.summary or "").strip()
        if prefer_local or not summary:
            summary = self._local_pending_summary(pending)
        pending.summary = summary
        session.summary = summary
        return summary

    def _clear_manual_sync_messages(self, session: OrganizerSession) -> bool:
        sync_tag = self._manual_sync_message_tag()
        next_messages = [
            message
            for message in session.messages
            if not (
                message.get("role") == "user"
                and message.get("visibility") == "internal"
                and sync_tag in str(message.get("content") or "")
            )
        ]
        changed = next_messages != session.messages
        if changed:
            session.messages = next_messages
        return changed

    def _structured_plan_snapshot_for_pending(self, session: OrganizerSession, pending: PendingPlan) -> dict:
        return self.snapshot_builder.plan_snapshot(
            pending,
            {"invalidated_items": [], "diff_summary": []},
            scan_lines=session.scan_lines,
            planner_items=session.planner_items,
            session=session,
        )

    @staticmethod
    def _target_directory_from_snapshot_item(item: dict, target_slots: list[dict]) -> str:
        return SnapshotBuilder.target_directory_from_snapshot_item(item, target_slots)

    @classmethod
    def _target_path_from_snapshot_item(cls, item: dict, target_slots: list[dict]) -> str:
        return SnapshotBuilder.target_path_from_snapshot_item(item, target_slots)

    def _build_manual_sync_diff_lines(self, previous_snapshot: dict, updated_snapshot: dict) -> list[str]:
        return self.snapshot_builder.build_manual_sync_diff_lines(previous_snapshot, updated_snapshot)

    @staticmethod
    def _plan_snapshot_payload(snapshot: PlanSnapshotPayload | dict | None) -> PlanSnapshotPayload:
        return PlanSnapshotPayload.from_dict(snapshot or {}) or PlanSnapshotPayload(summary="", stats={})

    def _pending_plan_payload(self, plan: PendingPlan | PendingPlanPayload | dict | None) -> PendingPlanPayload:
        if isinstance(plan, PendingPlanPayload):
            return plan
        if isinstance(plan, PendingPlan):
            return PendingPlanPayload.from_dict(self._pending_plan_to_dict(plan)) or PendingPlanPayload()
        return PendingPlanPayload.from_dict(plan or {}) or PendingPlanPayload()

    def _task_planner_adapter(self, session: OrganizerSession) -> TaskPlannerAdapter:
        return TaskPlannerAdapter(session.target_dir)

    @staticmethod
    def _task_state_payload(task_state: TaskState | dict | None) -> TaskState:
        return TaskState.from_dict(task_state or {}) or TaskState()

    def _task_from_session(self, session: OrganizerSession) -> OrganizeTask:
        task_state = self._task_state_payload(session.task_state)
        if task_state.sources or task_state.targets or task_state.mappings:
            task = task_state.to_task(session.session_id)
            task.user_constraints = list(session.user_constraints or [])
            return task
        task, _ = self._build_organize_task(session, self._pending_plan_from_session(session))
        return task

    def _pending_plan_from_task(self, session: OrganizerSession, task: OrganizeTask) -> PendingPlan:
        adapter = self._task_planner_adapter(session)
        pending = adapter.to_pending_plan(task)
        pending.user_constraints = list(session.user_constraints or pending.user_constraints or [])
        return pending

    def _sync_session_views(self, session: OrganizerSession, task: OrganizeTask | None = None) -> None:
        self._reconcile_session_strategy_fields(session)
        active_task = task or self._task_from_session(session)
        active_task.user_constraints = list(session.user_constraints or active_task.user_constraints or [])
        session.task_state = TaskState.from_task(active_task)
        session.conversation_state = ConversationState(
            messages=list(session.messages or []),
            assistant_message=copy.deepcopy(session.assistant_message),
            scanner_progress=copy.deepcopy(session.scanner_progress or {}),
            planner_progress=copy.deepcopy(session.planner_progress or {}),
        )
        session.execution_state = ExecutionState(
            precheck_summary=copy.deepcopy(session.precheck_summary),
            execution_report=copy.deepcopy(session.execution_report),
            rollback_report=copy.deepcopy(session.rollback_report),
            last_journal_id=session.last_journal_id,
        )

    def _plan_snapshot_has_moves(self, snapshot: PlanSnapshotPayload | dict | None) -> bool:
        payload = self._plan_snapshot_payload(snapshot)
        if int(payload.stats.get("move_count", 0) or 0) > 0:
            return True
        return any(item.status != "invalidated" for item in payload.items)

    def _normalize_last_ai_pending_plan(self, session: OrganizerSession) -> bool:
        baseline = AIPendingBaseline.from_dict(session.last_ai_pending_plan)
        if baseline is None:
            return False

        pending = self._pending_plan_from_dict(baseline.pending_plan, session)
        plan_snapshot = self._plan_snapshot_payload(baseline.plan_snapshot)
        if not plan_snapshot:
            plan_snapshot = self._plan_snapshot_payload(self._structured_plan_snapshot_for_pending(session, pending))

        normalized = AIPendingBaseline(
            schema_version=CURRENT_AI_BASELINE_SCHEMA_VERSION,
            pending_plan=self._pending_plan_payload(pending),
            plan_snapshot=plan_snapshot,
        )
        if session.last_ai_pending_plan != normalized:
            session.last_ai_pending_plan = normalized
            return True
        return False

    def _last_ai_pending_state(self, session: OrganizerSession) -> AIPendingBaseline | None:
        baseline = AIPendingBaseline.from_dict(session.last_ai_pending_plan)
        if baseline is None:
            return None
        if self._normalize_last_ai_pending_plan(session):
            baseline = session.last_ai_pending_plan
        return baseline if isinstance(baseline, AIPendingBaseline) else AIPendingBaseline.from_dict(baseline)

    def _set_last_ai_pending_state(
        self,
        session: OrganizerSession,
        pending: PendingPlan | None = None,
        *,
        task: OrganizeTask | None = None,
    ) -> None:
        active_task = task or (self._build_organize_task(session, pending)[0] if pending is not None else self._task_from_session(session))
        active_pending = pending or self._pending_plan_from_task(session, active_task)
        session.last_ai_pending_plan = AIPendingBaseline(
            schema_version=CURRENT_AI_BASELINE_SCHEMA_VERSION,
            pending_plan=self._pending_plan_payload(active_pending),
            plan_snapshot=self._plan_snapshot_payload(self._structured_plan_snapshot_for_pending(session, active_pending)),
        )
        self._sync_session_views(session, active_task)

    def _sync_manual_diff_from_last_ai(self, session: OrganizerSession, pending: PendingPlan) -> None:
        sync_tag = self._manual_sync_message_tag()
        baseline_dict = self._last_ai_pending_state(session)
        if not baseline_dict:
            self._set_last_ai_pending_state(session, pending)
            self._clear_manual_sync_messages(session)
            return

        baseline_plan = self._pending_plan_from_dict(baseline_dict.pending_plan, session)
        baseline_snapshot = self._plan_snapshot_payload(baseline_dict.plan_snapshot)
        if not baseline_snapshot:
            baseline_snapshot = self._plan_snapshot_payload(self._structured_plan_snapshot_for_pending(session, baseline_plan))
        updated_snapshot = self._plan_snapshot_payload(self._structured_plan_snapshot_for_pending(session, pending))
        diff_lines = self._build_manual_sync_diff_lines(baseline_snapshot.to_dict(), updated_snapshot.to_dict())
        if not diff_lines:
            self._clear_manual_sync_messages(session)
            return

        diff_content = (
            f"{sync_tag}\n"
            "用户在预览区域对方案进行了如下手动调整：\n"
            + "\n".join(f"- {line}" for line in diff_lines)
        )
        existing_sync_index = -1
        for i in range(len(session.messages) - 1, -1, -1):
            message = session.messages[i]
            if (
                message.get("role") == "user"
                and message.get("visibility") == "internal"
                and sync_tag in str(message.get("content") or "")
            ):
                existing_sync_index = i
                break

        if existing_sync_index >= 0:
            session.messages[existing_sync_index]["content"] = diff_content
            session.messages[existing_sync_index]["visibility"] = "internal"
            self._ensure_message_id(session.messages[existing_sync_index])
            return

        sync_message = self._ensure_message_id(
            {
                "role": "user",
                "content": diff_content,
                "visibility": "internal",
            }
        )
        session.messages.append(sync_message)

    def _apply_pending_plan_state(
        self,
        session: OrganizerSession,
        pending: PendingPlan,
        cycle_result: dict | None,
        *,
        prefer_local_summary: bool = False,
        task: OrganizeTask | None = None,
    ) -> None:
        active_task = task or self._build_organize_task(session, pending)[0]
        active_pending = pending
        self._sync_pending_summary(session, active_pending, prefer_local=prefer_local_summary)
        session.pending_plan = self._pending_plan_payload(active_pending)
        session.plan_snapshot = self._plan_snapshot_payload(
            self._plan_snapshot(
                active_pending,
                cycle_result or {},
                scan_lines=session.scan_lines,
                planner_items=session.planner_items,
                session=session,
            )
        )
        session.stage = self._planning_stage_for(active_pending, session.scan_lines)
        session.precheck_summary = None
        self._sync_session_views(session, active_task)

    def _apply_task_state(
        self,
        session: OrganizerSession,
        task: OrganizeTask,
        cycle_result: dict | None,
        *,
        prefer_local_summary: bool = False,
    ) -> PendingPlan:
        active_task = copy.deepcopy(task)
        active_task.strategy = self._strategy_selection(session)
        active_task.user_constraints = list(session.user_constraints or active_task.user_constraints or [])
        active_task.phase = self._task_phase_for_stage(session.stage)
        pending = self._pending_plan_from_task(session, active_task)
        self._apply_pending_plan_state(
            session,
            pending,
            cycle_result,
            prefer_local_summary=prefer_local_summary,
            task=active_task,
        )
        return pending

    def _related_item_ids_for_message(
        self,
        message: str,
        planner_by_source: dict[str, dict],
        moves: list[PlanMove],
    ) -> list[str]:
        normalized_message = str(message or "")
        related: list[str] = []
        for move in moves:
            source = str(move.source or "").replace("\\", "/")
            target = str(move.target or "").replace("\\", "/")
            if source and source in normalized_message or target and target in normalized_message:
                related.append(str(planner_by_source.get(source, {}).get("planner_id") or source))
        seen: set[str] = set()
        ordered: list[str] = []
        for item_id in related:
            if item_id and item_id not in seen:
                seen.add(item_id)
                ordered.append(item_id)
        return ordered

    def _precheck_issues(
        self,
        blocking_errors: list[str],
        warnings: list[str],
        plan_moves: list[PlanMove],
        planner_by_source: dict[str, dict],
    ) -> list[dict]:
        issues: list[dict] = []
        for index, message in enumerate(blocking_errors):
            issues.append(
                {
                    "id": f"blocking-{index + 1}",
                    "severity": "blocking",
                    "issue_type": "precheck_blocking_error",
                    "message": message,
                    "related_item_ids": self._related_item_ids_for_message(message, planner_by_source, plan_moves),
                }
            )
        for index, message in enumerate(warnings):
            issues.append(
                {
                    "id": f"warning-{index + 1}",
                    "severity": "warning",
                    "issue_type": "precheck_warning",
                    "message": message,
                    "related_item_ids": self._related_item_ids_for_message(message, planner_by_source, plan_moves),
                }
            )
        review_item_ids = [
            str(planner_by_source.get(str(move.source or "").replace("\\", "/"), {}).get("planner_id") or move.source)
            for move in plan_moves
            if self._target_dir_for_move(move.target) == "Review"
        ]
        if review_item_ids:
            issues.append(
                {
                    "id": "review-items",
                    "severity": "review",
                    "issue_type": "review_items",
                    "message": f"这次有 {len(review_item_ids)} 项会先进入待确认区，建议执行前先核对。",
                    "related_item_ids": review_item_ids,
                }
            )
        return issues

    def _ensure_planner_items(self, session: OrganizerSession, scan_lines: str | None = None) -> bool:
        changed = self.source_manager.ensure_planner_items(session, scan_lines=scan_lines)
        if self._sync_inspection_context(session):
            changed = True
        return changed

    def _build_inspection_context(self, session: OrganizerSession) -> dict[str, dict[str, str]]:
        if not session.planner_items:
            return {}

        entry_context = self._source_collection_entry_context(session)
        if not entry_context:
            return {}

        context_by_relpath = {
            self._normalize_relpath(item.get("source_relpath") or item.get("entry_name")): item
            for item in entry_context.values()
            if self._normalize_relpath(item.get("source_relpath") or item.get("entry_name"))
        }
        inspection_context: dict[str, dict[str, str]] = {}
        for planner_item in session.planner_items or []:
            item_id = str(planner_item.get("planner_id") or "").strip()
            source_relpath = self._normalize_relpath(planner_item.get("source_relpath"))
            if not item_id or not source_relpath:
                continue
            context_item = context_by_relpath.get(source_relpath)
            if not context_item:
                continue
            inspection_context[item_id] = {
                "item_id": item_id,
                "source_relpath": source_relpath,
                "display_name": str(planner_item.get("display_name") or context_item.get("display_name") or Path(source_relpath).name),
                "entry_type": str(planner_item.get("entry_type") or context_item.get("entry_type") or "file"),
                "absolute_path": str(context_item.get("absolute_path") or ""),
                "allowed_base_dir": str(context_item.get("allowed_base_dir") or ""),
            }
        return inspection_context

    def _sync_inspection_context(self, session: OrganizerSession) -> bool:
        next_context = self._build_inspection_context(session)
        if next_context == (session.inspection_context or {}):
            return False
        session.inspection_context = next_context
        return True

    def _set_incremental_selection_pending(self, session: OrganizerSession, scan_lines: str) -> None:
        self.target_manager.set_incremental_selection_pending(session, scan_lines)

    def _run_incremental_target_discovery(
        self,
        session: OrganizerSession,
        discovery_runner,
    ) -> str:
        target_dir = Path(session.target_dir).resolve()
        session.stage = "scanning"
        session.scanner_progress = self._initial_scan_progress(target_dir)
        self.store.save(session)
        self._log_runtime_event("scan.started", session)
        self._write_session_debug_event(
            "scan.started",
            session,
            payload={"entry_count": session.scanner_progress.get("total_count", 0), "incremental_target_discovery": True},
        )
        self._record_event("scan.started", session)
        discovery_scan_lines = self._call_with_optional_session_id(
            discovery_runner,
            target_dir,
            session_id=session.session_id,
        )
        discovery_entries = self._scan_entries(discovery_scan_lines)
        total_count = len(discovery_entries)
        if not discovery_entries:
            outcome = self._handle_empty_scan_result(session, total_count=total_count, mode="sync")
            if outcome == "scan_empty_result":
                raise RuntimeError(outcome)
            return discovery_scan_lines

        session.scan_lines = discovery_scan_lines
        session.planning_schema_version = CURRENT_PLANNING_SCHEMA_VERSION
        session.planner_items = []
        session.inspection_context = {}
        session.pending_plan = self._pending_plan_payload(PendingPlan())
        session.plan_snapshot = self._plan_snapshot_payload(
            self._plan_snapshot(PendingPlan(), {}, scan_lines=discovery_scan_lines, session=session)
        )
        session.precheck_summary = None
        session.messages = []
        session.assistant_message = None
        session.last_ai_pending_plan = None
        session.summary = ""
        session.source_tree_entries = self._build_source_tree_entries(
            target_dir,
            discovery_scan_lines,
            planner_items=[],
            session=session,
        )
        self._set_incremental_selection_pending(session, discovery_scan_lines)
        session.stage = "selecting_incremental_scope"
        session.scanner_progress = {
            **dict(session.scanner_progress or {}),
            "status": "completed",
            "processed_count": total_count,
            "total_count": total_count,
            "current_item": discovery_entries[-1]["display_name"] if discovery_entries else None,
            "recent_analysis_items": discovery_entries[-5:],
            "message": f"已发现 {total_count} 个根目录条目，请先选择目标目录。",
        }
        self.store.save(session)
        self._log_runtime_event("scan.completed", session, entry_count=total_count, mode="sync")
        self._write_session_debug_event(
            "scan.completed",
            session,
            payload={"entry_count": total_count, "mode": "sync", "incremental_target_discovery": True},
        )
        self._record_event("scan.completed", session)
        return discovery_scan_lines

    def _confirm_target_directories(
        self,
        session: OrganizerSession,
        *,
        selected_target_dirs: list[str],
        scan_runner=None,
    ) -> None:
        current_selection = self._incremental_selection_snapshot(session)
        normalized_selected = [
            self._normalize_relpath(item)
            for item in selected_target_dirs
            if self._normalize_relpath(item)
        ]
        normalized_selected = list(dict.fromkeys(normalized_selected))
        if not normalized_selected:
            raise RuntimeError("INCREMENTAL_TARGETS_EMPTY")

        available_root_dirs = set(current_selection.get("root_directory_options") or [])
        invalid = [item for item in normalized_selected if item not in available_root_dirs]
        if invalid:
            raise RuntimeError("INCREMENTAL_TARGET_DIR_NOT_FOUND")

        target_dir = Path(session.target_dir).resolve()
        source_scan_runner = scan_runner or self._default_scan_runner
        full_scan_lines = self._call_with_optional_session_id(
            source_scan_runner,
            target_dir,
            session_id=session.session_id,
        )
        filtered_scan_lines = self._filter_incremental_pending_scan_lines(full_scan_lines, normalized_selected)
        pending_entries = self._scan_entries(filtered_scan_lines)
        if not pending_entries:
            raise RuntimeError("INCREMENTAL_SOURCE_EMPTY")

        session.scan_lines = filtered_scan_lines
        session.planning_schema_version = CURRENT_PLANNING_SCHEMA_VERSION
        session.organize_mode = self._normalize_organize_mode(session.organize_mode)
        session.organize_method = organize_method_for_organize_mode(session.organize_mode)
        session.planner_items = self._build_planner_items(filtered_scan_lines, existing_items=session.planner_items)
        session.source_tree_entries = self._build_source_tree_entries(
            target_dir,
            filtered_scan_lines,
            planner_items=session.planner_items,
            session=session,
        )
        session.incremental_selection = {
            **current_selection,
            "status": "ready",
            "target_directories": normalized_selected,
            "target_directory_tree": [
                {"relpath": item, "name": Path(str(item)).name or item, "children": []}
                for item in normalized_selected
            ],
            "pending_items_count": len(pending_entries),
            "source_scan_completed": True,
        }

    @staticmethod
    def _normalize_move_target_for_source(source_relpath: str, target: str) -> str:
        normalized_target = str(target or "").strip().replace("\\", "/")
        filename = Path(str(source_relpath or "")).name
        if not filename:
            return normalized_target
        if not normalized_target:
            return filename
        target_name = Path(normalized_target).name
        if target_name.lower() == filename.lower():
            target_dir = normalized_target.rsplit("/", 1)[0] if "/" in normalized_target else ""
            return f"{target_dir}/{filename}" if target_dir else filename
        return f"{normalized_target.rstrip('/')}/{filename}"

    @staticmethod
    def _move_specificity(source_relpath: str, target: str) -> tuple[int, int]:
        filename = Path(str(source_relpath or "")).name.lower()
        normalized_target = str(target or "").strip().replace("\\", "/")
        target_name = Path(normalized_target).name.lower() if normalized_target else ""
        return (1 if filename and target_name == filename else 0, len(normalized_target))

    def _normalize_pending_plan_identifiers(self, session: OrganizerSession) -> bool:
        if not self._pending_plan_payload(session.pending_plan):
            return False

        pending = self._pending_plan_from_session(session)
        changed = False

        normalized_moves: list[PlanMove] = []
        for move in pending.moves:
            source_relpath = self._planner_source_for_item_id(session, move.source) or str(move.source or "").replace("\\", "/").strip()
            target_relpath = self._normalize_move_target_for_source(source_relpath, move.target)
            normalized_move = PlanMove(source=source_relpath, target=target_relpath, raw=move.raw)
            if normalized_move.source != move.source or normalized_move.target != move.target:
                changed = True
            existing_index = next((index for index, item in enumerate(normalized_moves) if item.source == normalized_move.source), -1)
            if existing_index >= 0:
                existing = normalized_moves[existing_index]
                if self._move_specificity(normalized_move.source, normalized_move.target) > self._move_specificity(existing.source, existing.target):
                    normalized_moves[existing_index] = normalized_move
                changed = True
                continue
            normalized_moves.append(normalized_move)

        normalized_unresolved: list[str] = []
        seen_unresolved: set[str] = set()
        for item_id in pending.unresolved_items:
            source_relpath = self._planner_source_for_item_id(session, item_id) or str(item_id or "").replace("\\", "/").strip()
            if source_relpath != item_id:
                changed = True
            if not source_relpath or source_relpath in seen_unresolved:
                if source_relpath:
                    changed = True
                continue
            normalized_unresolved.append(source_relpath)
            seen_unresolved.add(source_relpath)

        if not changed:
            return False

        pending.moves = normalized_moves
        pending.unresolved_items = normalized_unresolved
        pending.directories = self._directories_from_moves(normalized_moves)
        session.pending_plan = self._pending_plan_payload(pending)
        if pending.summary:
            session.summary = pending.summary
        return True

    def _ensure_planning_schema_compatibility(self, session: OrganizerSession) -> bool:
        if session.stage in self._TERMINAL_STAGES:
            return False
        if session.planning_schema_version >= CURRENT_PLANNING_SCHEMA_VERSION:
            if (
                self._normalize_organize_mode(session.organize_mode) == "incremental"
                and not self._incremental_selection_snapshot(session).get("source_scan_completed")
            ):
                if session.scan_lines and not session.source_tree_entries:
                    session.source_tree_entries = self._build_source_tree_entries(
                        Path(session.target_dir),
                        session.scan_lines,
                        planner_items=[],
                        session=session,
                    )
                    return True
                return False
            if session.scan_lines and not session.planner_items:
                return self._ensure_planner_items(session)
            return False
        session.planning_schema_version = CURRENT_PLANNING_SCHEMA_VERSION
        session.stage = "stale"
        session.stale_reason = "planning_schema_incompatible"
        session.integrity_flags["is_stale"] = True
        session.integrity_flags["planning_schema_incompatible"] = True
        return True

    @staticmethod
    def _call_with_optional_session_id(func, *args, session_id: str | None = None, **kwargs):
        call_kwargs = dict(kwargs)
        include_session_id = True

        for _ in range(3):
            try:
                if include_session_id:
                    return func(*args, session_id=session_id, **call_kwargs)
                return func(*args, **call_kwargs)
            except TypeError as exc:
                message = str(exc)
                if "unexpected keyword argument 'session_id'" in message and include_session_id:
                    include_session_id = False
                    continue
                if "unexpected keyword argument 'cancel_event'" in message and "cancel_event" in call_kwargs:
                    call_kwargs.pop("cancel_event", None)
                    continue
                raise

        if include_session_id:
            return func(*args, session_id=session_id, **call_kwargs)
        return func(*args, **call_kwargs)

    def create_session(
        self,
        sources: list[dict] | str,
        resume_if_exists: bool,
        organize_method: str | None = None,
        strategy: dict | None = None,
        *,
        output_dir: str = "",
        target_profile_id: str = "",
        target_directories: list[str] | None = None,
        target_directory_details: list[dict] | list[TargetProfileDirectory] | None = None,
        new_directory_root: str = "",
        review_root: str = "",
    ) -> CreateSessionResult:
        normalized_sources = sources
        normalized_method = organize_method
        if isinstance(sources, str):
            normalized_sources = [{"source_type": "directory", "path": sources}]
            normalized_method = normalized_method or self._normalize_organize_method(
                (strategy or {}).get("organize_method")
                or (
                    "assign_into_existing_categories"
                    if str((strategy or {}).get("task_type") or "").strip() == "organize_into_existing"
                    else ""
                )
                or organize_method_for_organize_mode((strategy or {}).get("organize_mode"))
            )
            if not output_dir and normalized_method == "categorize_into_new_structure":
                output_dir = sources
            if (
                normalized_method == "assign_into_existing_categories"
                and not target_profile_id
                and not (target_directories or [])
                and not (target_directory_details or [])
            ):
                target_directories = [sources]
        return self.orchestrator.create_session(
            normalized_sources,
            resume_if_exists,
            normalized_method or "categorize_into_new_structure",
            strategy=strategy,
            output_dir=output_dir,
            target_profile_id=target_profile_id,
            target_directories=target_directories,
            target_directory_details=target_directory_details,
            new_directory_root=new_directory_root,
            review_root=review_root,
        )

    def list_target_profiles(self) -> list[dict]:
        return [item.to_dict() for item in self.target_profiles.list()]

    def create_target_profile(self, name: str, directories: list[dict]) -> dict:
        if not str(name or "").strip():
            raise ValueError("TARGET_PROFILE_NAME_REQUIRED")
        profile = self.target_profiles.create(str(name).strip(), directories)
        return profile.to_dict()

    def update_target_profile(self, profile_id: str, *, name: str | None = None, directories: list[dict] | None = None) -> dict:
        profile = self.target_profiles.update(profile_id, name=name, directories=directories)
        if profile is None:
            raise FileNotFoundError(profile_id)
        return profile.to_dict()

    def delete_target_profile(self, profile_id: str) -> bool:
        return self.target_profiles.delete(profile_id)

    def abandon_session(self, session_id: str) -> dict:
        return self.lifecycle.abandon_session(session_id)

    def resume_session(self, session_id: str) -> OrganizerSession:
        return self.lifecycle.resume_session(session_id)

    def refresh_session(self, session_id: str, scan_runner=None) -> SessionMutationResult:
        return self.scan_workflow.refresh_session(session_id, scan_runner=scan_runner)

    def start_scan(self, session_id: str, scan_runner=None) -> OrganizerSession:
        return self.scan_workflow.start_scan(session_id, scan_runner=scan_runner)

    def confirm_target_directories(
        self,
        session_id: str,
        selected_target_dirs: list[str],
        scan_runner=None,
    ) -> SessionMutationResult:
        return self.scan_workflow.confirm_target_directories(
            session_id,
            selected_target_dirs=selected_target_dirs,
            scan_runner=scan_runner,
        )

    def get_snapshot(self, session_id: str) -> dict:
        return self.planning_conversation.get_snapshot(session_id)

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
        for context_message in context_messages:
            if (
                str(context_message.get("role") or "").strip() == "assistant"
                and str(context_message.get("content") or "") == str(assistant_message.get("content") or "")
                and context_message.get("tool_calls") == assistant_message.get("tool_calls")
            ):
                context_message["id"] = assistant_message["id"]
                break
        self._ensure_message_ids(context_messages)
        return assistant_message, context_messages

    def _seed_initial_messages(self, session: OrganizerSession) -> None:
        if session.messages or not session.scan_lines:
            return
        session.messages = organize_service.build_initial_messages(
            session.scan_lines,
            planner_items=session.planner_items,
            strategy=self._strategy_selection(session),
            user_constraints=list(session.user_constraints),
            planning_context=self._planning_context(session),
        )
        self._ensure_message_ids(session.messages)

    def _run_planner_cycle_for_session(
        self,
        session: OrganizerSession,
        *,
        source: str,
        pending_plan: PendingPlan | None = None,
        preserving_previous_plan: bool | None = None,
    ) -> None:
        self.orchestrator.run_planner_cycle_for_session(
            session,
            source=source,
            pending_plan=pending_plan,
            preserving_previous_plan=preserving_previous_plan,
        )

    def _normalized_target_directory(
        self,
        session: OrganizerSession,
        pending: PendingPlan,
        *,
        target_dir: str | None = None,
        target_slot: str | None = None,
        move_to_review: bool = False,
    ) -> str:
        return self.target_resolver.normalized_target(
            session,
            pending,
            target_dir=target_dir,
            target_slot=target_slot,
            move_to_review=move_to_review,
        ).normalized_dir

    @staticmethod
    def _target_relpath_for_source(source_relpath: str, destination_dir: str) -> str:
        normalized_source = str(source_relpath or "").replace("\\", "/").strip()
        filename = Path(normalized_source).name
        normalized_dir = str(destination_dir or "").replace("\\", "/").strip().strip("/")
        return f"{normalized_dir}/{filename}" if normalized_dir else filename

    def _ensure_pending_move_for_source(
        self,
        pending: PendingPlan,
        source_relpath: str,
        *,
        default_target_dir: str = "Review",
    ) -> PlanMove:
        normalized_source = self._normalize_relpath(source_relpath)
        for move in pending.moves:
            if self._normalize_relpath(move.source) == normalized_source:
                return move
        move = PlanMove(
            source=normalized_source,
            target=self._target_relpath_for_source(normalized_source, default_target_dir),
            raw="",
        )
        pending.moves.append(move)
        return move

    def _apply_pending_item_destination(
        self,
        session: OrganizerSession,
        pending: PendingPlan,
        source_relpath: str,
        *,
        target_dir: str | None = None,
        target_slot: str | None = None,
        move_to_review: bool = False,
        create_if_missing: bool = False,
        clear_unresolved: bool = True,
    ) -> dict:
        normalized_source = self._normalize_relpath(source_relpath)
        move: PlanMove | None = None
        for candidate in pending.moves:
            if self._normalize_relpath(candidate.source) == normalized_source:
                move = candidate
                break
        if move is None and create_if_missing:
            move = self._ensure_pending_move_for_source(pending, normalized_source)
        if move is None:
            raise RuntimeError("ITEM_NOT_FOUND")

        destination_dir = self._normalized_target_directory(
            session,
            pending,
            target_dir=target_dir,
            target_slot=target_slot,
            move_to_review=move_to_review,
        )
        move.target = self._target_relpath_for_source(normalized_source, destination_dir)
        if clear_unresolved:
            pending.unresolved_items = [
                value for value in pending.unresolved_items if self._normalize_relpath(value) != normalized_source
            ]
        pending.directories = self._directories_from_moves(pending.moves)
        return {
            "source_relpath": normalized_source,
            "target_dir": destination_dir,
            "target_relpath": move.target,
        }


    def submit_user_intent(self, session_id: str, content: str) -> SessionMutationResult:
        return self.planning_conversation.submit_user_intent(session_id, content)

    def run_precheck(self, session_id: str) -> SessionMutationResult:
        return self.execution_app.run_precheck(session_id)

    def return_to_planning(self, session_id: str) -> SessionMutationResult:
        return self.execution_app.return_to_planning(session_id)

    def update_item_target(
        self,
        session_id: str,
        item_id: str,
        target_dir: str | None,
        target_slot: str | None,
        move_to_review: bool,
    ) -> SessionMutationResult:
        return self.planning_conversation.update_item_target(
            session_id,
            item_id=item_id,
            target_dir=target_dir,
            target_slot=target_slot,
            move_to_review=move_to_review,
        )

    def execute(self, session_id: str, confirm: bool) -> SessionMutationResult:
        return self.execution_app.execute(session_id, confirm)

    def rollback(self, session_id: str, confirm: bool) -> SessionMutationResult:
        return self.execution_app.rollback(session_id, confirm)

    def _rollback_execution_journal(self, journal) -> SessionMutationResult:
        return self.execution_app.rollback_execution_journal(journal)

    def list_history(self) -> list[dict]:
        return self.history_app.list_history()

    def delete_history_entry(self, entry_id: str) -> dict:
        return self.history_app.delete_history_entry(entry_id)

    def get_journal_summary(self, session_id: str) -> dict:
        return self.history_app.get_journal_summary(session_id)

    def cleanup_empty_dirs(self, session_id: str) -> dict:
        return self.execution_app.cleanup_empty_dirs(session_id)

    def _forward_runtime_event(self, phase: str, session_id: str, event_type: str, data: dict, session: OrganizerSession | None = None) -> None:
        if phase == "plan" and session is not None:
            changed = self._update_planner_progress_from_event(session, event_type, data)
            if changed:
                self.store.save(session)
            if event_type in {"model_wait_start", "tool_start"}:
                self._record_event(f"{phase}.action", session=session, action=data)
            elif event_type == "ai_chunk":
                self._record_event(f"{phase}.ai_typing", session=session, content=data.get("content"))
            elif changed:
                self._record_event(f"{phase}.progress", session=session, planner_event=event_type)
            return
        if event_type in {"model_wait_start", "tool_start"}:
            self._record_event(f"{phase}.action", session_id=session_id, action=data)
        elif event_type == "ai_chunk":
            self._record_event(f"{phase}.ai_typing", session_id=session_id, content=data.get("content"))

    def _list_visible_entries(self, path: Path) -> list[str]:
        try:
            return sorted([p.name for p in path.iterdir() if not p.name.startswith(".")])
        except Exception:
            return []

    def _initial_scan_progress(self, target_dir: Path) -> dict:
        entries = self._list_visible_entries(target_dir)[:10]
        recent_items = [
            {
                "item_id": entry,
                "display_name": entry,
                "source_relpath": entry,
                "entry_type": self._detect_entry_type(target_dir, entry),
                "suggested_purpose": "准备分析",
                "summary": "等待分配并进行文件内容分析...",
            }
            for entry in entries
        ]
        return {
            "status": "running",
            "processed_count": 0,
            "total_count": self._count_visible_entries(target_dir),
            "current_item": "正在准备扫描任务",
            "recent_analysis_items": recent_items,
            "completed_batches": 0,
            "had_failed_batches": False,
            "unrecovered_failed_batches": False,
            "placeholder_count": 0,
            "message": "正在读取目录结构",
        }

    def _initial_source_collection_scan_progress(self, session: OrganizerSession) -> dict:
        entry_context = self._source_collection_entry_context(session)
        if not entry_context:
            return self._initial_scan_progress(Path(session.target_dir))

        recent_items = [
            {
                "item_id": str(item.get("entry_id") or index),
                "display_name": str(item.get("display_name") or item.get("entry_name") or index),
                "source_relpath": str(item.get("source_relpath") or item.get("entry_name") or index),
                "entry_type": str(item.get("entry_type") or "file"),
                "suggested_purpose": "准备分析",
                "summary": "等待分配并进行文件内容分析...",
            }
            for index, item in enumerate(list(entry_context.values())[:10], start=1)
        ]
        return {
            "status": "running",
            "processed_count": 0,
            "total_count": len(entry_context),
            "current_item": "正在准备扫描任务",
            "recent_analysis_items": recent_items,
            "completed_batches": 0,
            "had_failed_batches": False,
            "unrecovered_failed_batches": False,
            "placeholder_count": 0,
            "message": "正在读取本次整理来源",
        }

    @staticmethod
    def _clear_scan_recovery_state(session: OrganizerSession) -> None:
        session.last_error = None
        session.integrity_flags.pop("interrupted_during", None)
        session.integrity_flags.pop("scan_incomplete", None)
        session.integrity_flags.pop("scan_placeholder_count", None)
        session.integrity_flags.pop("scan_had_failed_batches", None)
        session.integrity_flags.pop("scan_unrecovered_failed_batches", None)
        session.integrity_flags.pop(OrganizerSessionService._EMPTY_SCAN_RESULT_FLAG, None)

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

    @staticmethod
    def _is_specific_scan_target(value: str | None) -> bool:
        text = str(value or "").strip()
        if not text:
            return False
        generic_prefixes = ("已启动 ", "第 ")
        generic_labels = {
            "当前目录",
            "正在准备扫描任务",
            "正在等待模型响应",
        }
        return text not in generic_labels and not text.startswith(generic_prefixes)

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
            set_field("ai_thinking", True)
            set_field("message", data.get("message") or "正在分析目录内容")
            if not progress.get("current_item"):
                set_field("current_item", "正在等待模型响应")
        elif event_type == "api_retry":
            attempt = max(1, int(data.get("attempt") or 1))
            max_attempts = max(attempt, int(data.get("max_attempts") or attempt))
            retry_delay = max(0, int(data.get("retry_delay_seconds") or 0))
            retry_after = data.get("retry_after_seconds")
            summary = str(data.get("summary") or "模型服务暂时没有响应").strip()
            wait_seconds = retry_delay
            try:
                if retry_after is not None:
                    wait_seconds = max(wait_seconds, int(float(retry_after)))
            except (TypeError, ValueError):
                pass

            set_field("ai_thinking", False)
            set_field("is_retrying", True)
            set_field("retry_kind", "api")
            set_field("retry_attempt", attempt)
            set_field("retry_max_attempts", max_attempts)
            set_field("current_item", "正在等待模型服务恢复")
            if wait_seconds > 0:
                set_field("message", f"{summary}，将在约 {wait_seconds} 秒后重试（{attempt}/{max_attempts}）")
            else:
                set_field("message", f"{summary}，正在重试（{attempt}/{max_attempts}）")
        elif event_type == "tool_start":
            set_field("ai_thinking", False)
            set_field("retry_kind", None)
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
                            "entry_type": self._detect_entry_type(target_dir, target_name),
                            "suggested_purpose": "分析中",
                            "summary": "正在读取内容"
                        })
                        set_field("recent_analysis_items", recent[:8]) # 保留最近 8 条

            set_field("message", message)

            if target_name and target_name not in {"当前目录", "正在准备扫描任务"} and target_name not in seen_entries:
                seen_entries.add(target_name)
                set_field("processed_count", min(total_count, len(seen_entries)) if total_count else len(seen_entries))
        elif event_type == "ai_streaming_start":
            set_field("ai_thinking", False)
            set_field("message", "正在汇总扫描结果")
        elif event_type == "ai_chunk":
            set_field("ai_thinking", False)
            set_field("message", "正在输出扫描结论")
        elif event_type == "validation_fail":
            set_field("is_retrying", True)
            set_field("message", "扫描结果需要修正，正在重新校验")
        elif event_type == "validation_pass" or event_type == "batch_progress":
            if event_type == "validation_pass" or (data.get("status") in ("completed", "success")):
                set_field("is_retrying", False)
            
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
                        "entry_type": item.get("entry_type", ""),
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
                total_batches = max(0, int(data.get("total_batches") or progress.get("batch_count") or 0))
                batch_index = data.get("batch_index")
                set_field("batch_count", data.get("total_batches"))
                completed_batches = max(0, int(data.get("completed_batches") or 0))
                if total_batches > 0:
                    completed_batches = min(total_batches, completed_batches)
                set_field("completed_batches", completed_batches)
                status = str(data.get("status") or "completed")
                if status == "failed":
                    set_field("had_failed_batches", True)
                    set_field("unrecovered_failed_batches", True)
                    set_field("message", "有批次失败，正在准备重试")
                elif status == "retrying":
                    set_field("had_failed_batches", True)
                    set_field("unrecovered_failed_batches", True)
                    set_field("is_retrying", True)
                    set_field("message", "正在重试失败批次")
                    retry_size = max(0, int(data.get("batch_size") or 0))
                    if retry_size:
                        set_field("current_item", f"正在重试失败批次（{retry_size} 项）")
                    else:
                        set_field("current_item", "正在重试失败批次")
                else:
                    is_retry_completion = (
                        total_batches > 0
                        and batch_index is not None
                        and int(batch_index) >= total_batches
                    )
                    if is_retry_completion:
                        set_field("unrecovered_failed_batches", False)
                        set_field("is_retrying", False)
                        set_field("message", "失败批次已补齐，正在完成扫描")
                    else:
                        set_field("message", f"已完成 {completed_batches}/{total_batches or data.get('total_batches')} 个批次")
        
        elif event_type == "cycle_start" and int(data.get("attempt") or 1) > 1:
            attempt = int(data.get("attempt") or 1)
            max_attempts = int(data.get("max_attempts") or attempt)
            set_field("is_retrying", True)
            set_field("message", f"正在进行第 {attempt}/{max_attempts} 轮校验")

        if changed:
            session.scanner_progress = progress
        return changed

    def _default_scan_runner(
        self,
        target_dir: Path,
        event_handler=None,
        session_id: str | None = None,
        cancel_event: threading.Event | None = None,
    ) -> str:
        return self._call_with_optional_session_id(
            analysis_service.run_analysis_cycle,
            target_dir,
            event_handler=event_handler,
            session_id=session_id,
            cancel_event=cancel_event,
        )

    def _handle_empty_scan_result(self, session: OrganizerSession, *, total_count: int, mode: str) -> str:
        if total_count == 0:
            self._clear_scan_recovery_state(session)
            session.scan_lines = ""
            session.source_tree_entries = []
            session.summary = "当前目录为空，无需整理"
            session.pending_plan = self._pending_plan_payload(PendingPlan(summary=session.summary))
            session.plan_snapshot = self._plan_snapshot_payload(
                self._plan_snapshot(PendingPlan(summary=session.summary), {}, scan_lines="", session=session)
            )
            session.assistant_message = {"role": "assistant", "content": "当前目录为空，没有可整理的文件。"}
            session.messages = []
            session.precheck_summary = None
            session.execution_report = None
            session.rollback_report = None
            session.last_journal_id = None
            session.last_ai_pending_plan = None
            session.stage = "completed"
            session.integrity_flags["is_stale"] = False
            session.stale_reason = None
            session.integrity_flags[self._EMPTY_SCAN_RESULT_FLAG] = True
            session.scanner_progress = {
                **dict(session.scanner_progress or {}),
                "status": "completed",
                "processed_count": 0,
                "total_count": 0,
                "current_item": None,
                "recent_analysis_items": [],
                "message": "目录为空，无需整理",
            }
            self.store.save(session)
            self._log_runtime_event("scan.completed", session, entry_count=0, mode=mode, auto_plan_pending=False)
            self._write_session_debug_event(
                "scan.completed",
                session,
                payload={"entry_count": 0, "mode": mode, "reason": "empty_directory"},
            )
            self._record_event("scan.completed", session)
            return "empty_directory"

        session.stage = "interrupted"
        session.scan_lines = ""
        session.source_tree_entries = []
        session.last_error = "scan_empty_result"
        session.scanner_progress = {
            **dict(session.scanner_progress or {}),
            "status": "failed",
            "processed_count": 0,
            "current_item": None,
            "recent_analysis_items": [],
            "message": "扫描未返回任何条目，请检查模型输出或调试日志",
        }
        self.store.save(session)
        self._log_runtime_event("scan.failed", session, level=logging.ERROR, error="scan_empty_result", mode=mode)
        self._write_session_debug_event(
            "scan.failed",
            session,
            level="ERROR",
            payload={"error": "scan_empty_result", "mode": mode},
        )
        self._record_event("session.error", session)
        return "scan_empty_result"

    @staticmethod
    def _placeholder_scan_item_count(entries: list[dict]) -> int:
        return sum(
            1
            for entry in entries
            if str(entry.get("suggested_purpose") or "").strip() == "待判断"
            and str(entry.get("summary") or "").strip() == "分析未覆盖，需手动确认"
        )

    @staticmethod
    def _has_unrecovered_failed_batches(progress: dict | None) -> bool:
        return bool(dict(progress or {}).get("unrecovered_failed_batches"))

    def _scan_completion_message(
        self,
        entries: list[dict],
        *,
        parallel: bool,
        batch_count: int | None = None,
        recovered_failed_batches: bool = False,
    ) -> str:
        placeholder_count = self._placeholder_scan_item_count(entries)
        if placeholder_count > 0:
            return f"扫描完成，{placeholder_count} 项分析未覆盖，已标记为待确认"
        if recovered_failed_batches:
            if parallel and batch_count:
                return f"已完成 {batch_count}/{batch_count} 批并行分析，失败批次已自动补齐"
            return "扫描已完成，失败批次已自动补齐"
        if parallel and batch_count:
            return f"已完成 {batch_count}/{batch_count} 批并行分析"
        return "已完成并行扫描分析" if parallel else "已完成单线程扫描分析"

    def _handle_incomplete_scan_result(
        self,
        session: OrganizerSession,
        entries: list[dict],
        *,
        total_count: int,
        mode: str,
    ) -> None:
        existing_progress = dict(session.scanner_progress or {})
        placeholder_count = self._placeholder_scan_item_count(entries)
        had_failed_batches = bool(existing_progress.get("had_failed_batches"))
        unrecovered_failed_batches = self._has_unrecovered_failed_batches(existing_progress)
        reasons: list[str] = []
        if unrecovered_failed_batches:
            reasons.append("重试后仍有失败批次")
        if placeholder_count > 0:
            reasons.append(f"{placeholder_count} 项未成功分析")
        detail = "，".join(reasons) if reasons else "扫描结果不完整"
        message = f"扫描结果不完整：{detail}。请稍后重试或降低并发后重新扫描。"
        recent_items = entries[-5:]

        session.stage = "interrupted"
        session.last_error = message
        session.summary = ""
        session.pending_plan = self._pending_plan_payload({})
        session.plan_snapshot = self._plan_snapshot_payload({})
        session.assistant_message = None
        session.integrity_flags["scan_incomplete"] = True
        session.integrity_flags["scan_placeholder_count"] = placeholder_count
        session.integrity_flags["scan_had_failed_batches"] = had_failed_batches
        session.integrity_flags["scan_unrecovered_failed_batches"] = unrecovered_failed_batches
        session.scanner_progress = {
            **existing_progress,
            "status": "failed",
            "processed_count": len(entries),
            "total_count": total_count,
            "current_item": None,
            "recent_analysis_items": recent_items,
            "placeholder_count": placeholder_count,
            "ai_thinking": False,
            "is_retrying": False,
            "message": message,
        }
        self.store.save(session)
        self._log_runtime_event(
            "scan.failed",
            session,
            level=logging.ERROR,
            error="scan_incomplete_result",
            mode=mode,
            placeholder_count=placeholder_count,
            had_failed_batches=had_failed_batches,
            unrecovered_failed_batches=unrecovered_failed_batches,
        )
        self._write_session_debug_event(
            "scan.failed",
            session,
            level="ERROR",
            payload={
                "error": "scan_incomplete_result",
                "mode": mode,
                "placeholder_count": placeholder_count,
                "had_failed_batches": had_failed_batches,
                "unrecovered_failed_batches": unrecovered_failed_batches,
                "recent_items": recent_items,
            },
        )
        self._record_event("session.interrupted", session)

    def _finish_async_scan(self, session_id: str, scan_lines: str) -> None:
        try:
            session = self._load_or_raise(session_id)
            if session.stage != "scanning":
                return
            all_entries = self._scan_entries(scan_lines)
            total_count = int((session.scanner_progress or {}).get("total_count") or 0)
            if total_count <= 0:
                total_count = (
                    self._count_visible_entries(Path(session.target_dir))
                    if self._can_use_single_directory_scan(session)
                    else len(all_entries)
                )
            if not all_entries:
                self._handle_empty_scan_result(session, total_count=total_count, mode="async")
                return
            session.scan_lines = scan_lines or ""
            session.planning_schema_version = CURRENT_PLANNING_SCHEMA_VERSION
            self._ensure_planner_items(session, session.scan_lines)
            recent_items = all_entries[-5:]
            existing_progress = dict(session.scanner_progress or {})
            placeholder_count = self._placeholder_scan_item_count(all_entries)
            had_failed_batches = bool(existing_progress.get("had_failed_batches"))
            unrecovered_failed_batches = self._has_unrecovered_failed_batches(existing_progress)
            session.scanner_progress = {
                **existing_progress,
                "status": "completed",
                "processed_count": len(all_entries),
                "total_count": total_count,
                "current_item": recent_items[-1]["display_name"] if recent_items else None,
                "recent_analysis_items": recent_items,
                "placeholder_count": placeholder_count,
                "ai_thinking": False,
                "is_retrying": False,
            }
            if existing_progress.get("batch_count"):
                session.scanner_progress["completed_batches"] = existing_progress.get("batch_count")
                session.scanner_progress["message"] = self._scan_completion_message(
                    all_entries,
                    parallel=True,
                    batch_count=int(existing_progress.get("batch_count") or 0),
                    recovered_failed_batches=had_failed_batches and not unrecovered_failed_batches,
                )
            else:
                session.scanner_progress["message"] = self._scan_completion_message(all_entries, parallel=False)

            if unrecovered_failed_batches or placeholder_count > 0:
                self._handle_incomplete_scan_result(
                    session,
                    all_entries,
                    total_count=total_count,
                    mode="async",
                )
                return

            self._clear_scan_recovery_state(session)
            if self._normalize_organize_mode(session.organize_mode) == "incremental":
                if session.selected_target_directories:
                    session.scan_lines = self._filter_incremental_pending_scan_lines(
                        session.scan_lines,
                        list(session.selected_target_directories),
                    )
                    all_entries = self._scan_entries(session.scan_lines)
                session.pending_plan = self._pending_plan_payload(PendingPlan())
                session.plan_snapshot = self._plan_snapshot_payload(
                    self._plan_snapshot(PendingPlan(), {}, scan_lines=session.scan_lines, session=session)
                )
                session.precheck_summary = None
                session.messages = []
                session.assistant_message = None
                session.last_ai_pending_plan = None
                session.summary = ""
                self._ensure_planner_items(session, session.scan_lines)
                session.source_tree_entries = self._build_source_tree_entries(
                    Path(session.target_dir),
                    session.scan_lines,
                    planner_items=session.planner_items,
                    session=session,
                )
                if session.selected_target_directories:
                    session.incremental_selection = {
                        **self._incremental_selection_snapshot(session),
                        "status": "ready",
                        "target_directories": list(session.selected_target_directories),
                        "target_directory_tree": [
                            {"relpath": item, "name": Path(str(item)).name or item, "children": []}
                            for item in session.selected_target_directories
                        ],
                        "pending_items_count": len(all_entries),
                        "source_scan_completed": True,
                    }
                    session.stage = "planning"
                else:
                    session.planner_items = []
                    session.inspection_context = {}
                    session.source_tree_entries = self._build_source_tree_entries(
                        Path(session.target_dir),
                        session.scan_lines,
                        planner_items=[],
                        session=session,
                    )
                    self._set_incremental_selection_pending(session, session.scan_lines)
                    session.stage = "selecting_incremental_scope"
            else:
                session.incremental_selection = self._incremental_selection_defaults(session)
                session.stage = "planning"
                self._seed_initial_messages(session)

            self.store.save(session)
            self._log_runtime_event(
                "scan.completed",
                session,
                entry_count=len(all_entries),
                auto_plan_pending=not session.assistant_message and not self._plan_snapshot_has_moves(session.plan_snapshot),
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

            self.orchestrator.maybe_run_auto_plan_after_scan(session)
        finally:
            self._mark_scan_inactive(session_id)

    def _fail_async_scan(self, session_id: str, exc: Exception) -> None:
        try:
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
        finally:
            self._mark_scan_inactive(session_id)

    def _run_scan_sync(self, session: OrganizerSession, scan_runner) -> str:
        self._mark_scan_active(session.session_id)
        session.stage = "scanning"
        self._clear_scan_recovery_state(session)
        if self._can_use_single_directory_scan(session):
            session.scanner_progress = self._initial_scan_progress(Path(session.target_dir))
        else:
            session.scanner_progress = self._initial_source_collection_scan_progress(session)
        self.store.save(session)
        self._record_event("scan.started", session)
        try:
            if self._can_use_single_directory_scan(session):
                result = self._call_with_optional_session_id(
                    scan_runner,
                    Path(session.target_dir),
                    session_id=session.session_id,
                )
                all_entries = self._scan_entries(result)
                total_count = self._count_visible_entries(Path(session.target_dir))
            else:
                result, all_entries = self._scan_source_collection(
                    session,
                    scan_runner,
                    session_id=session.session_id,
                )
                total_count = len(all_entries)
            if not all_entries:
                outcome = self._handle_empty_scan_result(session, total_count=total_count, mode="sync")
                if outcome == "scan_empty_result":
                    raise RuntimeError(outcome)
                return result or ""
            recent_items = all_entries[-5:]
            session.scan_lines = result or ""
            session.planning_schema_version = CURRENT_PLANNING_SCHEMA_VERSION
            self._clear_scan_recovery_state(session)
            if self._normalize_organize_mode(session.organize_mode) == "incremental":
                if session.selected_target_directories:
                    session.scan_lines = self._filter_incremental_pending_scan_lines(
                        session.scan_lines,
                        list(session.selected_target_directories),
                    )
                    all_entries = self._scan_entries(session.scan_lines)
                session.pending_plan = self._pending_plan_payload(PendingPlan())
                session.plan_snapshot = self._plan_snapshot_payload(
                    self._plan_snapshot(PendingPlan(), {}, scan_lines=session.scan_lines, session=session)
                )
                session.messages = []
                session.assistant_message = None
                session.summary = ""
                self._ensure_planner_items(session, session.scan_lines)
                session.source_tree_entries = self._build_source_tree_entries(
                    Path(session.target_dir),
                    session.scan_lines,
                    planner_items=session.planner_items,
                    session=session,
                )
                if session.selected_target_directories:
                    session.incremental_selection = {
                        **self._incremental_selection_snapshot(session),
                        "status": "ready",
                        "target_directories": list(session.selected_target_directories),
                        "target_directory_tree": [
                            {"relpath": item, "name": Path(str(item)).name or item, "children": []}
                            for item in session.selected_target_directories
                        ],
                        "pending_items_count": len(all_entries),
                        "source_scan_completed": True,
                    }
                    session.stage = "planning"
                else:
                    session.planner_items = []
                    session.inspection_context = {}
                    session.source_tree_entries = self._build_source_tree_entries(
                        Path(session.target_dir),
                        session.scan_lines,
                        planner_items=[],
                        session=session,
                    )
                    self._set_incremental_selection_pending(session, session.scan_lines)
                    session.stage = "selecting_incremental_scope"
            else:
                self._ensure_planner_items(session, session.scan_lines)
                session.incremental_selection = self._incremental_selection_defaults(session)
                session.stage = "planning"
            session.scanner_progress = {
                **dict(session.scanner_progress or {}),
                "status": "completed",
                "processed_count": len(all_entries),
                "total_count": total_count,
                "current_item": recent_items[-1]["display_name"] if recent_items else None,
                "recent_analysis_items": recent_items,
                "message": self._scan_completion_message(all_entries, parallel=False),
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
        finally:
            self._mark_scan_inactive(session.session_id)

    def _load_or_raise(self, session_id: str, *, recover_locked: bool = False) -> OrganizerSession:
        session = self.store.load(session_id)
        if session is None:
            raise FileNotFoundError(f"Session {session_id} not found")
        if recover_locked and session.stage in self._LOCKED_STAGES:
            previous_stage = session.stage
            self._recover_orphaned_locked_session(session)
            if session.stage != previous_stage:
                return session
        if self._recover_stale_planner_progress(session):
            self.store.save(session)
            return session
        if self._ensure_planning_schema_compatibility(session):
            self.store.save(session)
            return session
        changed = self._normalize_pending_plan_identifiers(session)
        if self._normalize_last_ai_pending_plan(session):
            changed = True
        if self._sync_inspection_context(session):
            changed = True
        if self._ensure_plan_snapshot_consistency(session) or changed:
            self.store.save(session)
        return session

    def _ensure_not_locked(self, session: OrganizerSession):
        if session.stage in self._LOCKED_STAGES:
            raise RuntimeError("SESSION_LOCKED")

    def _ensure_mutable_stage(self, session: OrganizerSession):
        if session.stage not in self._PLANNING_MUTABLE_STAGES:
            raise RuntimeError("SESSION_STAGE_CONFLICT")

    @staticmethod
    def _ensure_schema_compatible_for_resume(session: OrganizerSession) -> None:
        if session.stale_reason == "planning_schema_incompatible":
            raise RuntimeError("SESSION_STAGE_CONFLICT")

    def _recover_stale_planner_progress(self, session: OrganizerSession) -> bool:
        progress = self._planner_progress_snapshot(session)
        if progress.get("status") != "running":
            return False

        timestamp_text = str(progress.get("updated_at") or session.updated_at or session.created_at or "").strip()
        if not timestamp_text:
            return False
        try:
            activity_at = datetime.fromisoformat(timestamp_text.replace("Z", "+00:00"))
        except ValueError:
            return False
        if activity_at.tzinfo is None:
            activity_at = activity_at.replace(tzinfo=timezone.utc)

        stale_after_seconds = get_text_stream_max_seconds() + 60
        age_seconds = (datetime.now(timezone.utc) - activity_at).total_seconds()
        if age_seconds < stale_after_seconds:
            return False

        session.last_error = session.last_error or "planning_interrupted"
        session.integrity_flags["interrupted_during"] = "planning"
        self._fail_planner_progress(session, session.last_error)
        if session.stage == "planning":
            session.stage = "interrupted"
        self._sync_session_views(session)
        self._log_runtime_event("session.interrupted", session, interrupted_during="planning")
        self._write_session_debug_event(
            "session.interrupted",
            session,
            payload={"interrupted_during": "planning"},
        )
        self._record_event("session.interrupted", session)
        return True

    def _build_snapshot(self, session: OrganizerSession) -> dict:
        for message in session.messages:
            if not message.get("id"):
                self._ensure_message_id(message)
        if session.assistant_message and not session.assistant_message.get("id"):
            self._ensure_message_id(session.assistant_message)
        self._normalize_pending_plan_identifiers(session)
        self._normalize_last_ai_pending_plan(session)
        self._ensure_plan_snapshot_consistency(session)
        self._sync_session_views(session)
        source_tree_entries = copy.deepcopy(
            session.source_tree_entries
            or self._build_source_tree_entries(
                Path(session.target_dir),
                session.scan_lines,
                planner_items=session.planner_items,
                session=session,
            )
        )
        strategy_summary = normalize_strategy_selection(self._strategy_selection(session))
        incremental_selection = self._incremental_selection_snapshot(session)
        return {
            "session_id": session.session_id,
            "session_title": self._session_title_for(session),
            "target_dir": str(session.target_dir),
            "placement": copy.deepcopy(self._placement_payload(session.placement).__dict__),
            "stage": session.stage,
            "summary": session.summary,
            "scanner_progress": copy.deepcopy(session.scanner_progress),
            "planner_progress": copy.deepcopy(self._planner_progress_snapshot(session)),
            "plan_snapshot": copy.deepcopy(self._plan_snapshot_payload(session.plan_snapshot).to_dict()),
            "precheck_summary": copy.deepcopy(session.precheck_summary),
            "execution_report": copy.deepcopy(session.execution_report),
            "rollback_report": copy.deepcopy(session.rollback_report),
            "assistant_message": copy.deepcopy(session.assistant_message),
            "messages": copy.deepcopy(session.messages),
            "user_constraints": list(session.user_constraints),
            "source_tree_entries": source_tree_entries,
            "incremental_selection": copy.deepcopy(incremental_selection),
            "integrity_flags": copy.deepcopy(session.integrity_flags),
            "stale_reason": session.stale_reason,
            "last_journal_id": session.last_journal_id,
            "last_error": session.last_error,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "strategy": {
                "template_id": strategy_summary["template_id"],
                "template_label": strategy_summary["template_label"],
                "template_description": strategy_summary["template_description"],
                "language": strategy_summary["language"],
                "language_label": strategy_summary["language_label"],
                "density": strategy_summary["density"],
                "density_label": strategy_summary["density_label"],
                "prefix_style": strategy_summary["prefix_style"],
                "prefix_style_label": strategy_summary["prefix_style_label"],
                "caution_level": strategy_summary["caution_level"],
                "caution_level_label": strategy_summary["caution_level_label"],
                "task_type": strategy_summary["task_type"],
                "task_type_label": strategy_summary["task_type_label"],
                "organize_method": strategy_summary["organize_method"],
                "organize_mode": strategy_summary["organize_mode"],
                "organize_mode_label": strategy_summary["organize_mode_label"],
                "destination_index_depth": strategy_summary["destination_index_depth"],
                "output_dir": strategy_summary["output_dir"],
                "target_profile_id": strategy_summary["target_profile_id"],
                "target_directories": list(strategy_summary["target_directories"]),
                "target_directory_details": list(strategy_summary.get("target_directory_details") or []),
                "new_directory_root": strategy_summary["new_directory_root"],
                "review_root": strategy_summary["review_root"],
                "note": strategy_summary["note"],
                "preview_directories": strategy_summary["preview_directories"],
            }
        }

    @staticmethod
    def _planner_progress_defaults() -> dict:
        return {
            "status": "idle",
            "phase": None,
            "message": "",
            "detail": None,
            "attempt": 1,
            "started_at": None,
            "updated_at": None,
            "last_completed_at": None,
            "preserving_previous_plan": False,
        }

    def _planner_progress_snapshot(self, session: OrganizerSession) -> dict:
        progress = dict(session.planner_progress or {})
        normalized = self._planner_progress_defaults()
        normalized.update(progress)
        normalized["attempt"] = max(1, int(normalized.get("attempt") or 1))
        normalized["preserving_previous_plan"] = bool(normalized.get("preserving_previous_plan"))
        return normalized

    @staticmethod
    def _planner_phase_copy(phase: str) -> tuple[str, str | None]:
        copies = {
            "waiting_model": ("正在理解你的新要求", "正在结合目录状态与最新要求更新方案"),
            "streaming_reply": ("正在生成整理方案", "内容会逐步更新到对话区"),
            "validating": ("正在校验方案完整性", "正在检查条目完整性与目标结构"),
            "retrying": ("发现问题，正在自动修正", "上一轮结果未通过校验，系统正在继续处理"),
            "repairing": ("正在进行深度修复", "系统正在重建一版更完整的方案"),
            "applying": ("正在应用本轮更新", "马上会同步到右侧预览"),
        }
        return copies.get(phase, ("正在更新方案", None))

    def _has_existing_plan_content(self, session: OrganizerSession) -> bool:
        snapshot = self._plan_snapshot_payload(session.plan_snapshot)
        return bool(
            snapshot.summary
            or snapshot.items
            or snapshot.groups
            or snapshot.review_items
            or snapshot.invalidated_items
        )

    def _set_planner_progress(
        self,
        session: OrganizerSession,
        *,
        status: str | None = None,
        phase: str | None = None,
        attempt: int | None = None,
        preserving_previous_plan: bool | None = None,
        message: str | None = None,
        detail: str | None = None,
        started_at: str | None = None,
        last_completed_at: str | None = None,
    ) -> bool:
        progress = self._planner_progress_snapshot(session)
        changed = False
        now = utc_now_iso()

        def assign(key: str, value) -> None:
            nonlocal changed
            if progress.get(key) != value:
                progress[key] = value
                changed = True

        if status is not None:
            assign("status", status)
        if phase is not None:
            assign("phase", phase)
        if attempt is not None:
            assign("attempt", max(1, int(attempt)))
        if preserving_previous_plan is not None:
            assign("preserving_previous_plan", bool(preserving_previous_plan))
        if started_at is not None:
            assign("started_at", started_at)
        if last_completed_at is not None:
            assign("last_completed_at", last_completed_at)

        effective_phase = phase if phase is not None else progress.get("phase")
        if message is None and effective_phase:
            phase_message, phase_detail = self._planner_phase_copy(str(effective_phase))
            message = phase_message
            if detail is None:
                detail = phase_detail
        if message is not None:
            assign("message", message)
        if detail is not None or effective_phase is None:
            assign("detail", detail)

        if changed:
            progress["updated_at"] = now
            session.planner_progress = progress
        return changed

    def _begin_planner_progress(self, session: OrganizerSession, *, preserving_previous_plan: bool | None = None) -> None:
        started_at = utc_now_iso()
        session.last_error = None
        self._set_planner_progress(
            session,
            status="running",
            phase="waiting_model",
            attempt=1,
            started_at=started_at,
            preserving_previous_plan=self._has_existing_plan_content(session)
            if preserving_previous_plan is None
            else preserving_previous_plan,
        )
        self.store.save(session)
        self._record_event("plan.progress", session, planner_event="planner_started")

    def _complete_planner_progress(self, session: OrganizerSession) -> None:
        completed_at = utc_now_iso()
        self._set_planner_progress(
            session,
            status="completed",
            phase=None,
            message="方案已更新",
            detail=None,
            preserving_previous_plan=False,
            last_completed_at=completed_at,
        )

    def _fail_planner_progress(self, session: OrganizerSession, error: str) -> None:
        last_completed_at = self._planner_progress_snapshot(session).get("last_completed_at")
        self._set_planner_progress(
            session,
            status="failed",
            phase=None,
            message="本轮方案更新失败",
            detail=str(error or "请稍后重试"),
            preserving_previous_plan=False,
            last_completed_at=last_completed_at,
        )

    def _update_planner_progress_from_event(self, session: OrganizerSession, event_type: str, data: dict) -> bool:
        progress = self._planner_progress_snapshot(session)
        current_attempt = max(1, int(progress.get("attempt") or 1))
        preserving_previous_plan = bool(progress.get("preserving_previous_plan"))

        if event_type == "model_wait_start":
            return self._set_planner_progress(
                session,
                status="running",
                phase="waiting_model",
                attempt=current_attempt,
                preserving_previous_plan=preserving_previous_plan,
            )
        if event_type == "ai_chunk":
            return self._set_planner_progress(
                session,
                status="running",
                phase="streaming_reply",
                attempt=current_attempt,
                preserving_previous_plan=preserving_previous_plan,
            )
        if event_type == "ai_streaming_end":
            return self._set_planner_progress(
                session,
                status="running",
                phase="validating",
                attempt=current_attempt,
                preserving_previous_plan=preserving_previous_plan,
            )
        if event_type == "command_validation_fail":
            return self._set_planner_progress(
                session,
                status="running",
                phase="retrying",
                attempt=current_attempt + 1,
                preserving_previous_plan=preserving_previous_plan,
            )
        if event_type == "repair_mode_start":
            return self._set_planner_progress(
                session,
                status="running",
                phase="repairing",
                attempt=current_attempt,
                preserving_previous_plan=preserving_previous_plan,
            )
        if event_type == "command_validation_pass":
            return self._set_planner_progress(
                session,
                status="running",
                phase="applying",
                attempt=current_attempt,
                preserving_previous_plan=preserving_previous_plan,
            )
        return False

    def _pending_plan_from_session(self, session: OrganizerSession) -> PendingPlan:
        return self._pending_plan_from_dict(session.pending_plan, session)

    def _ensure_plan_snapshot_consistency(self, session: OrganizerSession) -> bool:
        existing_payload = self._plan_snapshot_payload(session.plan_snapshot)
        existing = existing_payload.to_dict()
        pending = self._pending_plan_from_session(session)
        pending.summary = str(pending.summary or session.summary or existing.get("summary", "")).strip()
        if not pending.summary and (pending.moves or pending.unresolved_items):
            pending.summary = self._local_pending_summary(pending)

        if (
            not pending.moves
            and not pending.unresolved_items
            and not existing_payload.items
            and not existing_payload.mappings
            and not existing_payload.target_slots
            and not existing_payload.groups
            and not existing_payload.review_items
            and not existing_payload.invalidated_items
        ):
            return False

        if not pending.moves and not existing:
            return False

        rebuilt_payload = self._plan_snapshot_payload(
            self._plan_snapshot(
            pending,
            {
                "invalidated_items": list(existing.get("invalidated_items", [])),
                "diff_summary": list(existing.get("diff_summary", [])),
            },
            scan_lines=session.scan_lines,
            planner_items=session.planner_items,
            session=session,
            )
        )

        if existing_payload.change_highlights:
            rebuilt_payload.change_highlights = list(existing_payload.change_highlights)

        if existing == rebuilt_payload.to_dict():
            return False

        session.plan_snapshot = rebuilt_payload
        if pending.summary:
            session.summary = pending.summary
        return True

    def _pending_plan_from_dict(self, data: PendingPlanPayload | dict | None, session: OrganizerSession) -> PendingPlan:
        payload = self._pending_plan_payload(data)
        if not payload:
            return PendingPlan(directories=[], moves=[], user_constraints=list(session.user_constraints))
        return PendingPlan(
            directories=list(payload.directories),
            moves=[PlanMove(**m) for m in payload.moves],
            user_constraints=list(payload.user_constraints or session.user_constraints),
            unresolved_items=list(payload.unresolved_items),
            summary=str(payload.summary or ""),
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

    def _target_slot_payloads_from_task(self, session: OrganizerSession, task: OrganizeTask) -> list[PlanTargetSlotPayload]:
        target_root = Path(session.target_dir).resolve()
        payloads: list[PlanTargetSlotPayload] = []
        for item in task.targets:
            real_path = Path(item.real_path).resolve()
            try:
                relpath = real_path.relative_to(target_root).as_posix()
            except ValueError:
                relpath = str(real_path)
            payloads.append(
                PlanTargetSlotPayload(
                    slot_id=item.slot_id,
                    display_name=item.display_name,
                    relpath=relpath,
                    depth=item.depth,
                    is_new=item.is_new,
                    real_path=str(real_path),
                )
            )
        return payloads

    def _target_slot_payload_state(self, target_slots: list[PlanTargetSlotPayload]) -> dict:
        return self.snapshot_builder.target_slot_payload_state(target_slots)

    def _ensure_target_slot_payload(
        self,
        target_slots: list[PlanTargetSlotPayload],
        slot_state: dict,
        target_dir: str,
        *,
        is_new: bool = False,
    ) -> str:
        return self.snapshot_builder.ensure_target_slot_payload(target_slots, slot_state, target_dir, is_new=is_new)

    def _mapping_payloads_from_task(
        self,
        session: OrganizerSession,
        task: OrganizeTask,
        relpath_by_source_ref_id: dict[str, str],
    ) -> list[PlanMappingPayload]:
        return self.snapshot_builder.mapping_payloads_from_task(session, task, relpath_by_source_ref_id)

    def _normalize_plan_snapshot_item(
        self,
        raw_item: dict,
        *,
        target_slots: list[PlanTargetSlotPayload],
        slot_state: dict,
        session: OrganizerSession | None = None,
        default_status: str = "planned",
        default_mapping_status: str | None = None,
    ) -> PlanSnapshotItem:
        return self.snapshot_builder.normalize_plan_snapshot_item(
            raw_item,
            target_slots=target_slots,
            slot_state=slot_state,
            session=session,
            default_status=default_status,
            default_mapping_status=default_mapping_status,
        )

    def _plan_snapshot(
        self,
        plan: PendingPlan,
        cycle_result: dict,
        scan_lines: str = "",
        planner_items: list[dict] | None = None,
        session: OrganizerSession | None = None,
    ) -> dict:
        return self.snapshot_builder.plan_snapshot(
            plan,
            cycle_result,
            scan_lines=scan_lines,
            planner_items=planner_items,
            session=session,
        )

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
            "moves": len(self._pending_plan_payload(session.pending_plan).moves),
            "unresolved": len(self._pending_plan_payload(session.pending_plan).unresolved_items),
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

    def _record_event(
        self,
        event_type: str,
        session: OrganizerSession | None = None,
        session_id: str | None = None,
        *,
        include_snapshot: bool = True,
        **kwargs,
    ):
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
        if session is not None and include_snapshot:
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

    def _build_source_tree_entries(
        self,
        target_dir: Path,
        scan_lines: str,
        planner_items: list[dict] | None = None,
        session: OrganizerSession | None = None,
    ) -> list[dict]:
        return self.source_manager.build_source_tree_entries(
            target_dir,
            scan_lines,
            planner_items=planner_items,
            session=session,
        )

    def _directory_changed(self, session: OrganizerSession) -> bool:
        scanned_entries = {
            self._normalize_relpath(entry.get("source_relpath"))
            for entry in self._scan_entries(session.scan_lines)
            if self._normalize_relpath(entry.get("source_relpath"))
        }
        if not scanned_entries:
            return False
        current_entries = {
            self._normalize_relpath(entry.get("source_relpath"))
            for entry in self._scan_entries(self._current_scope_scan_lines(session))
            if self._normalize_relpath(entry.get("source_relpath"))
        }
        return current_entries != scanned_entries

    def _count_visible_entries(self, path: Path) -> int:
        try:
            return len([p for p in path.iterdir() if not p.name.startswith(".")])
        except Exception:
            return 0

    def _scan_entries(self, scan_lines: str) -> list[dict]:
        return self.source_manager.scan_entries(scan_lines)

    def _latest_execution_id(self, target_dir: Path) -> str | None:
        journal = rollback_service.load_latest_execution_for_directory(target_dir)
        return journal.execution_id if journal else None

    def _strategy_selection(self, session: OrganizerSession) -> dict:
        self._reconcile_session_strategy_fields(session)
        organize_mode = self._normalize_organize_mode(session.organize_mode)
        organize_method = self._normalize_organize_method(session.organize_method or organize_method_for_organize_mode(organize_mode))
        return {
            "template_id": session.strategy_template_id,
            "task_type": task_type_for_organize_method(organize_method),
            "organize_method": organize_method,
            "organize_mode": organize_mode,
            "destination_index_depth": self._normalize_destination_index_depth(session.destination_index_depth),
            "language": session.language,
            "density": session.density,
            "prefix_style": session.prefix_style,
            "caution_level": session.caution_level,
            "output_dir": str(session.output_dir or "").strip(),
            "target_profile_id": str(session.target_profile_id or "").strip(),
            "target_directories": list(session.selected_target_directories or []),
            "target_directory_details": [
                item.to_dict()
                for item in self._target_directory_details_for_session(session)
            ],
            "new_directory_root": str(self._placement_payload(session.placement).new_directory_root or "").strip(),
            "review_root": str(self._placement_payload(session.placement).review_root or "").strip(),
            "note": session.strategy_note,
        }

    def _strategy_runtime_summary(self, session: OrganizerSession) -> dict:
        summary = normalize_strategy_selection(self._strategy_selection(session))
        return {
            "template_id": summary["template_id"],
            "template_label": summary["template_label"],
            "task_type": summary["task_type"],
            "task_type_label": summary["task_type_label"],
            "organize_method": summary["organize_method"],
            "destination_index_depth": summary["destination_index_depth"],
            "output_dir": summary["output_dir"],
            "target_profile_id": summary["target_profile_id"],
            "target_directories": list(summary["target_directories"]),
            "target_directory_details": list(summary.get("target_directory_details") or []),
            "new_directory_root": summary["new_directory_root"],
            "review_root": summary["review_root"],
            "caution_level": summary["caution_level"],
            "caution_level_label": summary["caution_level_label"],
            "note": summary["note"],
        }

    def _strategy_prompt_fragment(self, session: OrganizerSession) -> str:
        return build_strategy_prompt_fragment(self._strategy_selection(session))

    def _recover_orphaned_locked_session(self, session: OrganizerSession):
        """If a persisted session was left in a locked stage after app shutdown, mark it interrupted."""
        self.lifecycle.recover_orphaned_locked_session(session)
