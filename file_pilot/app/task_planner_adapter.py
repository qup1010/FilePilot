from __future__ import annotations

import copy
from datetime import datetime, timezone
from pathlib import Path

from file_pilot.app.session_constants import REVIEW_SLOT_ID
from file_pilot.app.target_slot_registry import TargetSlotRegistry
from file_pilot.domain.models import MappingEntry, OrganizeTask
from file_pilot.organize.models import PendingPlan, PlanMove


class TaskPlannerAdapter:
    def __init__(self, base_dir: str, *, strict_targets: bool = False):
        self.base_dir = Path(base_dir).resolve()
        # 严格模式（归档/一键）：AI 输出的池外目标拒收降级为 unresolved；
        # 用户手动指定（assign_mapping）不受限——用户显式选择即目录池的定义
        self.strict_targets = strict_targets

    @staticmethod
    def _target_slot_number(slot_id: str) -> int:
        return TargetSlotRegistry.slot_number(slot_id)

    @staticmethod
    def _normalize_relpath(value: str | None) -> str:
        return TargetSlotRegistry.normalize_relpath(value)

    @staticmethod
    def _utc_now_iso() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    def _real_path_for_target_dir(self, target_dir: str) -> Path:
        return TargetSlotRegistry(self.base_dir, []).real_path_for_target_dir(target_dir)

    @staticmethod
    def _target_dir_for_move(target_relpath: str) -> str:
        normalized = str(target_relpath or "").replace("\\", "/").strip("/")
        if "/" not in normalized:
            return ""
        return normalized.rsplit("/", 1)[0]

    @staticmethod
    def _target_relpath_for_source(source_relpath: str, destination_dir: str) -> str:
        normalized_source = str(source_relpath or "").replace("\\", "/").strip()
        filename = Path(normalized_source).name
        normalized_dir = str(destination_dir or "").replace("\\", "/").strip().strip("/")
        return f"{normalized_dir}/{filename}" if normalized_dir else normalized_source

    def _target_dir_for_slot(self, task: OrganizeTask, slot_id: str) -> str:
        return TargetSlotRegistry(self.base_dir, task.targets).directory_for_slot(slot_id)

    def _ensure_target_slot(self, task: OrganizeTask, target_dir: str, *, strict: bool = False) -> str:
        return TargetSlotRegistry(self.base_dir, task.targets).ensure_slot(target_dir, strict=strict)

    def to_pending_plan(self, task: OrganizeTask) -> PendingPlan:
        sources_by_id = {source.ref_id: source for source in task.sources}
        ordered_mappings = [
            mapping
            for source in task.sources
            for mapping in task.mappings
            if mapping.source_ref_id == source.ref_id
        ]
        moves: list[PlanMove] = []
        unresolved_items: list[str] = []
        directories: set[str] = set()
        for mapping in ordered_mappings:
            source = sources_by_id.get(mapping.source_ref_id)
            if source is None:
                continue
            target_dir = self._target_dir_for_slot(task, mapping.target_slot_id)
            target_relpath = self._target_relpath_for_source(source.relpath, target_dir)
            moves.append(PlanMove(source=source.relpath, target=target_relpath, raw=""))
            if target_dir:
                directories.add(target_dir)
            if mapping.status == "unresolved":
                unresolved_items.append(source.relpath)
        return PendingPlan(
            directories=sorted(directories),
            moves=moves,
            user_constraints=list(task.user_constraints or []),
            unresolved_items=unresolved_items,
            summary="",
        )

    def apply_pending_plan(self, task: OrganizeTask, pending_plan: PendingPlan) -> OrganizeTask:
        updated_task = copy.deepcopy(task)
        sources_by_id = {source.ref_id: source for source in updated_task.sources}
        source_id_by_relpath = {source.relpath: source.ref_id for source in updated_task.sources}
        existing_by_source_id = {mapping.source_ref_id: mapping for mapping in updated_task.mappings}
        ordered_source_ids = [source.ref_id for source in updated_task.sources]
        mappings: list[MappingEntry] = []
        unresolved_set = {
            self._normalize_relpath(item)
            for item in (pending_plan.unresolved_items or [])
            if self._normalize_relpath(item)
        }
        for move in pending_plan.moves or []:
            source_relpath = self._normalize_relpath(move.source)
            source_ref_id = source_id_by_relpath.get(source_relpath, "")
            source = sources_by_id.get(source_ref_id)
            if source is None:
                continue
            target_dir = self._target_dir_for_move(move.target)
            if source_relpath in unresolved_set:
                target_slot_id = (
                    self._ensure_target_slot(updated_task, target_dir, strict=self.strict_targets)
                    if target_dir and target_dir != REVIEW_SLOT_ID
                    else REVIEW_SLOT_ID
                ) or REVIEW_SLOT_ID
                status = "unresolved"
            elif target_dir == REVIEW_SLOT_ID:
                target_slot_id = REVIEW_SLOT_ID
                status = "review"
            elif not target_dir:
                target_slot_id = ""
                status = "skipped"
            else:
                target_slot_id = self._ensure_target_slot(updated_task, target_dir, strict=self.strict_targets)
                if not target_slot_id:
                    # 严格模式拒收池外目标：降级为 unresolved（留原地/待确认），而不是移去幻觉目录
                    target_slot_id = REVIEW_SLOT_ID
                    status = "unresolved"
                else:
                    status = "assigned"
            existing = existing_by_source_id.get(source.ref_id)
            mappings.append(
                MappingEntry(
                    source_ref_id=source.ref_id,
                    target_slot_id=target_slot_id,
                    status=status,
                    reason=str(existing.reason if existing is not None else source.suggested_purpose),
                    confidence=existing.confidence if existing is not None else source.confidence,
                    user_overridden=bool(existing.user_overridden) if existing is not None else False,
                    original_target_slot_id=existing.original_target_slot_id if existing is not None else None,
                    original_status=existing.original_status if existing is not None else None,
                    overridden_at=existing.overridden_at if existing is not None else None,
                )
            )
        mapped_source_ids = {mapping.source_ref_id for mapping in mappings}
        for source_relpath in unresolved_set:
            source_ref_id = source_id_by_relpath.get(source_relpath, "")
            source = sources_by_id.get(source_ref_id)
            if source is None or source_ref_id in mapped_source_ids:
                continue
            existing = existing_by_source_id.get(source_ref_id)
            mappings.append(
                MappingEntry(
                    source_ref_id=source_ref_id,
                    target_slot_id=REVIEW_SLOT_ID,
                    status="unresolved",
                    reason=str(existing.reason if existing is not None else source.suggested_purpose),
                    confidence=existing.confidence if existing is not None else source.confidence,
                    user_overridden=bool(existing.user_overridden) if existing is not None else False,
                    original_target_slot_id=existing.original_target_slot_id if existing is not None else None,
                    original_status=existing.original_status if existing is not None else None,
                    overridden_at=existing.overridden_at if existing is not None else None,
                )
            )
        mappings.sort(key=lambda item: ordered_source_ids.index(item.source_ref_id) if item.source_ref_id in ordered_source_ids else len(ordered_source_ids))
        updated_task.mappings = mappings
        return updated_task

    def assign_mapping(
        self,
        task: OrganizeTask,
        *,
        source_relpath: str,
        target_dir: str,
        user_overridden: bool = True,
    ) -> OrganizeTask:
        updated_task = copy.deepcopy(task)
        normalized_source = self._normalize_relpath(source_relpath)
        source = next((item for item in updated_task.sources if self._normalize_relpath(item.relpath) == normalized_source), None)
        if source is None:
            raise RuntimeError("ITEM_NOT_FOUND")
        normalized_target_dir = self._normalize_relpath(target_dir)
        if normalized_target_dir == REVIEW_SLOT_ID:
            target_slot_id = REVIEW_SLOT_ID
            status = "review"
        elif not normalized_target_dir:
            target_slot_id = ""
            status = "skipped"
        else:
            target_slot_id = self._ensure_target_slot(updated_task, normalized_target_dir)
            status = "assigned"
        existing = next((mapping for mapping in updated_task.mappings if mapping.source_ref_id == source.ref_id), None)
        original_target_slot_id = existing.original_target_slot_id if existing is not None else None
        original_status = existing.original_status if existing is not None else None
        overridden_at = existing.overridden_at if existing is not None else None
        if user_overridden and existing is not None and not existing.user_overridden:
            original_target_slot_id = existing.target_slot_id
            original_status = existing.status
            overridden_at = self._utc_now_iso()
        elif user_overridden and existing is None:
            overridden_at = self._utc_now_iso()
        elif not user_overridden:
            original_target_slot_id = None
            original_status = None
            overridden_at = None
        updated_mapping = MappingEntry(
            source_ref_id=source.ref_id,
            target_slot_id=target_slot_id,
            status=status,
            reason=source.suggested_purpose,
            confidence=source.confidence,
            user_overridden=user_overridden,
            original_target_slot_id=original_target_slot_id,
            original_status=original_status,
            overridden_at=overridden_at,
        )
        next_mappings = [mapping for mapping in updated_task.mappings if mapping.source_ref_id != source.ref_id]
        next_mappings.append(updated_mapping)
        ordered_source_ids = [item.ref_id for item in updated_task.sources]
        next_mappings.sort(key=lambda item: ordered_source_ids.index(item.source_ref_id) if item.source_ref_id in ordered_source_ids else len(ordered_source_ids))
        updated_task.mappings = next_mappings
        return updated_task

    def restore_ai_mapping(self, task: OrganizeTask, *, source_relpath: str) -> OrganizeTask:
        updated_task = copy.deepcopy(task)
        normalized_source = self._normalize_relpath(source_relpath)
        source = next((item for item in updated_task.sources if self._normalize_relpath(item.relpath) == normalized_source), None)
        if source is None:
            raise RuntimeError("ITEM_NOT_FOUND")
        existing = next((mapping for mapping in updated_task.mappings if mapping.source_ref_id == source.ref_id), None)
        if existing is None:
            raise RuntimeError("ITEM_NOT_FOUND")
        if existing.original_target_slot_id is None or existing.original_status is None:
            raise RuntimeError("AI_SUGGESTION_NOT_FOUND")
        restored_mapping = MappingEntry(
            source_ref_id=existing.source_ref_id,
            target_slot_id=existing.original_target_slot_id,
            status=existing.original_status,
            reason=existing.reason,
            confidence=existing.confidence,
            user_overridden=False,
            original_target_slot_id=None,
            original_status=None,
            overridden_at=None,
        )
        next_mappings = [mapping for mapping in updated_task.mappings if mapping.source_ref_id != source.ref_id]
        next_mappings.append(restored_mapping)
        ordered_source_ids = [item.ref_id for item in updated_task.sources]
        next_mappings.sort(key=lambda item: ordered_source_ids.index(item.source_ref_id) if item.source_ref_id in ordered_source_ids else len(ordered_source_ids))
        updated_task.mappings = next_mappings
        return updated_task
