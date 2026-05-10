from __future__ import annotations

import copy
from pathlib import Path

from file_pilot.domain.models import MappingEntry, OrganizeTask, TargetSlot
from file_pilot.organize.models import PendingPlan, PlanMove


class TaskPlannerAdapter:
    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir).resolve()

    @staticmethod
    def _target_slot_number(slot_id: str) -> int:
        text = str(slot_id or "").strip()
        if len(text) >= 2 and text[0].upper() == "D" and text[1:].isdigit():
            return int(text[1:])
        return 0

    @staticmethod
    def _normalize_relpath(value: str | None) -> str:
        return str(value or "").replace("\\", "/").strip().strip("/")

    def _real_path_for_target_dir(self, target_dir: str) -> Path:
        raw = str(target_dir or "").strip()
        candidate = Path(raw)
        if candidate.is_absolute():
            return candidate.resolve()
        normalized = self._normalize_relpath(raw)
        return (self.base_dir / normalized).resolve()

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
        normalized_slot_id = str(slot_id or "").strip()
        if not normalized_slot_id:
            return ""
        if normalized_slot_id == "Review":
            return "Review"
        for target in task.targets:
            if str(target.slot_id or "").strip() != normalized_slot_id:
                continue
            try:
                return self._normalize_relpath(Path(target.real_path).resolve().relative_to(self.base_dir).as_posix())
            except ValueError:
                return self._normalize_relpath(Path(target.real_path).resolve().as_posix())
        return ""

    def _ensure_target_slot(self, task: OrganizeTask, target_dir: str) -> str:
        normalized_target_dir = self._normalize_relpath(target_dir)
        if not normalized_target_dir:
            return ""
        if normalized_target_dir == "Review":
            return "Review"
        desired_real_path = self._real_path_for_target_dir(target_dir)
        for target in task.targets:
            if Path(target.real_path).resolve() == desired_real_path:
                return str(target.slot_id or "")
        next_number = max((self._target_slot_number(target.slot_id) for target in task.targets), default=0) + 1
        slot_id = f"D{next_number:03d}"
        try:
            relative_target_dir = self._normalize_relpath(desired_real_path.relative_to(self.base_dir).as_posix())
        except ValueError:
            relative_target_dir = normalized_target_dir
        task.targets.append(
            TargetSlot(
                slot_id=slot_id,
                display_name=Path(relative_target_dir or normalized_target_dir).name or normalized_target_dir,
                real_path=str(desired_real_path),
                depth=max(0, len([part for part in relative_target_dir.split("/") if part]) - 1),
                is_new=True,
            )
        )
        return slot_id

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
                target_slot_id = self._ensure_target_slot(updated_task, target_dir) if target_dir and target_dir != "Review" else "Review"
                status = "unresolved"
            elif target_dir == "Review":
                target_slot_id = "Review"
                status = "review"
            elif not target_dir:
                target_slot_id = ""
                status = "skipped"
            else:
                target_slot_id = self._ensure_target_slot(updated_task, target_dir)
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
                    target_slot_id="Review",
                    status="unresolved",
                    reason=str(existing.reason if existing is not None else source.suggested_purpose),
                    confidence=existing.confidence if existing is not None else source.confidence,
                    user_overridden=bool(existing.user_overridden) if existing is not None else False,
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
        if normalized_target_dir == "Review":
            target_slot_id = "Review"
            status = "review"
        elif not normalized_target_dir:
            target_slot_id = ""
            status = "skipped"
        else:
            target_slot_id = self._ensure_target_slot(updated_task, normalized_target_dir)
            status = "assigned"
        updated_mapping = MappingEntry(
            source_ref_id=source.ref_id,
            target_slot_id=target_slot_id,
            status=status,
            reason=source.suggested_purpose,
            confidence=source.confidence,
            user_overridden=user_overridden,
        )
        next_mappings = [mapping for mapping in updated_task.mappings if mapping.source_ref_id != source.ref_id]
        next_mappings.append(updated_mapping)
        ordered_source_ids = [item.ref_id for item in updated_task.sources]
        next_mappings.sort(key=lambda item: ordered_source_ids.index(item.source_ref_id) if item.source_ref_id in ordered_source_ids else len(ordered_source_ids))
        updated_task.mappings = next_mappings
        return updated_task
