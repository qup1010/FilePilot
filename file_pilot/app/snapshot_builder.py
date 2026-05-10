from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import TYPE_CHECKING

from file_pilot.app.models import (
    PlanGroupPayload,
    PlanMappingPayload,
    PlanSnapshotItem,
    PlanSnapshotPayload,
    PlanTargetSlotPayload,
)
from file_pilot.domain.models import MappingEntry

if TYPE_CHECKING:
    from file_pilot.app.models import OrganizerSession
    from file_pilot.app.session_service import OrganizerSessionService
    from file_pilot.organize.models import PendingPlan


class SnapshotBuilder:
    def __init__(self, helpers: "OrganizerSessionService"):
        self.helpers = helpers

    @staticmethod
    def item_identity(item: dict) -> str:
        item_id = str(item.get("item_id") or "").strip()
        if item_id:
            return item_id
        return str(item.get("source_relpath") or "").replace("\\", "/").strip()

    @staticmethod
    def item_filename(item: dict) -> str:
        display_name = str(item.get("display_name") or "").strip()
        if display_name:
            return display_name
        source_relpath = str(item.get("source_relpath") or item.get("item_id") or "").replace("\\", "/").strip()
        return Path(source_relpath).name if source_relpath else ""

    @staticmethod
    def target_directory_from_snapshot_item(item: dict, target_slots: list[dict]) -> str:
        slot_id = str(item.get("target_slot_id") or "").strip()
        if not slot_id:
            return ""
        if slot_id == "Review":
            return "Review"
        for slot in target_slots:
            if str(slot.get("slot_id") or "").strip() == slot_id:
                return str(slot.get("relpath") or "").strip()
        return ""

    @classmethod
    def target_path_from_snapshot_item(cls, item: dict, target_slots: list[dict]) -> str:
        filename = cls.item_filename(item)
        directory = cls.target_directory_from_snapshot_item(item, target_slots)
        return f"{directory}/{filename}" if directory else filename

    def build_manual_sync_diff_lines(self, previous_snapshot: dict, updated_snapshot: dict) -> list[str]:
        previous_items = {
            self.item_identity(item): dict(item)
            for item in (previous_snapshot.get("items") or [])
            if self.item_identity(item)
        }
        updated_items = {
            self.item_identity(item): dict(item)
            for item in (updated_snapshot.get("items") or [])
            if self.item_identity(item)
        }
        previous_slots = list(previous_snapshot.get("target_slots") or [])
        updated_slots = list(updated_snapshot.get("target_slots") or [])
        diff_lines: list[str] = []

        previous_dirs = {
            self.target_directory_from_snapshot_item(item, previous_slots)
            for item in previous_items.values()
            if self.target_directory_from_snapshot_item(item, previous_slots)
        }
        updated_dirs = {
            self.target_directory_from_snapshot_item(item, updated_slots)
            for item in updated_items.values()
            if self.target_directory_from_snapshot_item(item, updated_slots)
        }
        for directory in sorted(updated_dirs - previous_dirs):
            diff_lines.append(f"新增目录：{directory}")
        for directory in sorted(previous_dirs - updated_dirs):
            diff_lines.append(f"移除目录：{directory}")

        for item_key in sorted(updated_items):
            old_item = previous_items.get(item_key)
            updated_item = updated_items[item_key]
            item_label = self.item_filename(updated_item) or item_key
            new_target = self.target_path_from_snapshot_item(updated_item, updated_slots)
            old_target = self.target_path_from_snapshot_item(old_item, previous_slots) if old_item else None
            if old_target != new_target:
                diff_lines.append(f"{'新增移动' if old_item is None else '调整移动'}：{item_label} -> {new_target}")
        for item_key in sorted(previous_items.keys() - updated_items.keys()):
            diff_lines.append(f"移除移动：{self.item_filename(previous_items[item_key]) or item_key}")

        previous_unresolved = set(previous_snapshot.get("unresolved_items") or [])
        updated_unresolved = set(updated_snapshot.get("unresolved_items") or [])
        for item in sorted(previous_unresolved - updated_unresolved):
            diff_lines.append(f"已解决待确认项：{item}")
        for item in sorted(updated_unresolved - previous_unresolved):
            diff_lines.append(f"新增待确认项：{item}")
        return diff_lines

    def target_slot_payload_state(self, target_slots: list[PlanTargetSlotPayload]) -> dict:
        normalized_slots = [
            slot
            if isinstance(slot, PlanTargetSlotPayload)
            else PlanTargetSlotPayload(
                slot_id=str(slot.get("slot_id") or ""),
                display_name=str(slot.get("display_name") or ""),
                relpath=str(slot.get("relpath") or ""),
                depth=int(slot.get("depth", 0) or 0),
                is_new=bool(slot.get("is_new", False)),
                real_path=str(slot.get("real_path") or ""),
            )
            for slot in target_slots
        ]
        if normalized_slots != target_slots:
            target_slots[:] = normalized_slots
        known_slot_ids = {
            str(slot.slot_id or "").strip()
            for slot in normalized_slots
            if str(slot.slot_id or "").strip()
        }
        slot_id_by_relpath = {
            str(slot.relpath or "").strip(): str(slot.slot_id or "").strip()
            for slot in normalized_slots
            if str(slot.relpath or "").strip() and str(slot.slot_id or "").strip()
        }
        next_number = max(
            (
                self.helpers._target_slot_number(str(slot_id))
                for slot_id in known_slot_ids
                if str(slot_id).strip().startswith("D")
            ),
            default=0,
        ) + 1
        return {
            "known_slot_ids": known_slot_ids,
            "slot_id_by_relpath": slot_id_by_relpath,
            "next_number": next_number,
        }

    def ensure_target_slot_payload(
        self,
        target_slots: list[PlanTargetSlotPayload],
        slot_state: dict,
        target_dir: str,
        *,
        is_new: bool = False,
        session: "OrganizerSession" | None = None,
    ) -> str:
        raw_target_dir = str(target_dir or "").strip()
        if not raw_target_dir:
            return ""
        normalized_target_dir = self.helpers._normalize_relpath(raw_target_dir)
        if normalized_target_dir == "Review":
            return "Review"
        existing_slot_id = slot_state["slot_id_by_relpath"].get(normalized_target_dir)
        if existing_slot_id:
            return existing_slot_id
        while True:
            candidate = f"D{slot_state['next_number']:03d}"
            slot_state["next_number"] += 1
            if candidate not in slot_state["known_slot_ids"]:
                break
        slot_state["slot_id_by_relpath"][normalized_target_dir] = candidate
        slot_state["known_slot_ids"].add(candidate)
        target_slots.append(
            PlanTargetSlotPayload(
                slot_id=candidate,
                display_name=Path(normalized_target_dir).name or normalized_target_dir,
                relpath=normalized_target_dir,
                depth=max(0, len([part for part in normalized_target_dir.split("/") if part]) - 1),
                is_new=is_new,
                real_path=(
                    str(self.helpers.target_resolver.resolve_target_real_path(session, raw_target_dir))
                    if session is not None
                    else ""
                ),
            )
        )
        return candidate

    def mapping_payloads_from_task(
        self,
        session: "OrganizerSession",
        task,
        relpath_by_source_ref_id: dict[str, str],
    ) -> list[PlanMappingPayload]:
        return [
            PlanMappingPayload(
                source_ref_id=mapping.source_ref_id,
                item_id=self.helpers._planner_id_for_source(session, relpath_by_source_ref_id.get(mapping.source_ref_id, "")),
                target_slot_id=mapping.target_slot_id,
                status=mapping.status,
                reason=mapping.reason,
                confidence=mapping.confidence,
                user_overridden=mapping.user_overridden,
            )
            for mapping in task.mappings
        ]

    def normalize_plan_snapshot_item(
        self,
        raw_item: dict,
        *,
        target_slots: list[PlanTargetSlotPayload],
        slot_state: dict,
        session: "OrganizerSession" | None = None,
        default_status: str = "planned",
        default_mapping_status: str | None = None,
    ) -> PlanSnapshotItem:
        source_relpath = self.helpers._normalize_relpath(raw_item.get("source_relpath") or raw_item.get("item_id"))
        display_name = str(raw_item.get("display_name") or Path(source_relpath).name or source_relpath)
        target_slot_id = str(raw_item.get("target_slot_id") or "").strip()
        if not target_slot_id:
            legacy_target = self.helpers._normalize_relpath(raw_item.get("target_relpath"))
            if legacy_target:
                target_dir = self.helpers._target_dir_for_move(legacy_target)
                target_slot_id = self.ensure_target_slot_payload(target_slots, slot_state, target_dir, session=session)
        raw_status = str(raw_item.get("status") or "").strip()
        status = str(default_status or "planned") if default_status and default_status != "planned" else (raw_status or str(default_status or "planned"))
        if status == "planned" and target_slot_id == "Review":
            status = "review"
        raw_mapping_status = str(raw_item.get("mapping_status") or "").strip()
        mapping_status = str(
            default_mapping_status
            or raw_mapping_status
            or ("skipped" if not target_slot_id else ("review" if target_slot_id == "Review" else status))
        )
        return PlanSnapshotItem(
            item_id=str(raw_item.get("item_id") or source_relpath),
            display_name=display_name,
            source_relpath=source_relpath,
            entry_type=str(raw_item.get("entry_type") or ""),
            suggested_purpose=str(raw_item.get("suggested_purpose") or ""),
            content_summary=str(raw_item.get("content_summary") or ""),
            reason=str(raw_item.get("reason") or ""),
            confidence=raw_item.get("confidence"),
            target_slot_id=target_slot_id,
            mapping_status=mapping_status,
            status=status,
        )

    def plan_snapshot(
        self,
        plan: "PendingPlan",
        cycle_result: dict,
        scan_lines: str = "",
        planner_items: list[dict] | None = None,
        session: "OrganizerSession" | None = None,
    ) -> dict:
        scan_entry_map = {
            entry["source_relpath"]: entry
            for entry in self.helpers._scan_entries(scan_lines)
            if isinstance(entry, dict) and entry.get("source_relpath")
        }
        planner_by_source = {
            str(item.get("source_relpath") or "").replace("\\", "/").strip(): dict(item)
            for item in (planner_items or [])
            if str(item.get("source_relpath") or "").strip()
        }
        planner_by_id = {
            str(item.get("planner_id") or "").strip(): dict(item)
            for item in (planner_items or [])
            if str(item.get("planner_id") or "").strip()
        }

        def target_directory_for_slot(slot_id: str) -> str:
            normalized_slot_id = str(slot_id or "").strip()
            if not normalized_slot_id:
                return ""
            if normalized_slot_id == "Review":
                return "Review"
            for slot in target_slots:
                if str(slot.slot_id or "").strip() == normalized_slot_id:
                    return str(slot.relpath or "").strip()
            return ""

        items: list[PlanSnapshotItem] = []
        review_items: list[PlanSnapshotItem] = []
        grouped_items: dict[str, list[PlanSnapshotItem]] = {}
        target_slots: list[PlanTargetSlotPayload] = []
        mappings: list[PlanMappingPayload] = []
        mapping_by_source: dict[str, MappingEntry] = {}
        mapping_by_source_id: dict[str, MappingEntry] = {}
        source_by_ref_id = {}
        source_ref_ids_by_relpath: dict[str, str] = {}
        relpath_by_source_ref_id: dict[str, str] = {}
        if session is not None:
            task, _ = self.helpers._build_organize_task(session, plan)
            target_slots = self.helpers._target_slot_payloads_from_task(session, task)
            source_by_ref_id = {source.ref_id: source for source in task.sources}
            source_ref_ids_by_relpath = {source.relpath: source.ref_id for source in task.sources}
            relpath_by_source_ref_id = {ref_id: relpath for relpath, ref_id in source_ref_ids_by_relpath.items()}
            mapping_by_source_id = {mapping.source_ref_id: mapping for mapping in task.mappings}
            mapping_by_source = {
                relpath_by_source_ref_id.get(mapping.source_ref_id, ""): mapping
                for mapping in task.mappings
                if relpath_by_source_ref_id.get(mapping.source_ref_id, "")
            }
            mappings = self.mapping_payloads_from_task(session, task, relpath_by_source_ref_id)
        slot_state = self.target_slot_payload_state(target_slots)

        item_ids_from_snapshot: set[str] = set()

        if source_by_ref_id and mapping_by_source_id:
            for source_ref_id in [source.ref_id for source in source_by_ref_id.values()]:
                mapping = mapping_by_source_id.get(source_ref_id)
                if mapping is None:
                    continue
                source = source_by_ref_id.get(source_ref_id)
                if source is None:
                    continue
                planner_meta = planner_by_source.get(source.relpath, {})
                scan_meta = scan_entry_map.get(source.relpath, {})
                source_relpath = source.relpath
                item_id = str(planner_meta.get("planner_id") or source.ref_id or source_relpath)
                item = PlanSnapshotItem(
                    item_id=item_id,
                    display_name=str(planner_meta.get("display_name") or source.display_name or Path(source_relpath).name),
                    source_relpath=source_relpath,
                    entry_type=str(scan_meta.get("entry_type") or planner_meta.get("entry_type") or source.entry_type or ""),
                    suggested_purpose=str(scan_meta.get("suggested_purpose") or planner_meta.get("suggested_purpose") or source.suggested_purpose or ""),
                    content_summary=str(scan_meta.get("summary") or planner_meta.get("summary") or source.content_summary or ""),
                    reason=str(mapping.reason or ""),
                    confidence=mapping.confidence if mapping.confidence is not None else source.confidence,
                    target_slot_id=str(mapping.target_slot_id or ""),
                    mapping_status=str(mapping.status or ""),
                    status=(
                        "review"
                        if mapping.target_slot_id == "Review"
                        else ("unresolved" if mapping.status == "unresolved" else ("planned" if mapping.status == "assigned" else str(mapping.status or "planned")))
                    ),
                )
                item_ids_from_snapshot.add(item.item_id)
                items.append(item)
                if item.status == "review":
                    review_items.append(item)
                directory = target_directory_for_slot(item.target_slot_id)
                grouped_items.setdefault(directory, []).append(item)

        for move in plan.moves:
            scan_meta = scan_entry_map.get(move.source, {})
            planner_meta = planner_by_source.get(move.source, {})
            mapping = mapping_by_source.get(move.source)
            legacy_item_id = str(planner_meta.get("planner_id", move.source))
            if legacy_item_id in item_ids_from_snapshot:
                continue
            normalized_source = self.helpers._normalize_relpath(move.source)
            normalized_target = self.helpers._normalize_relpath(move.target)
            status = "planned"
            if move.source in plan.unresolved_items:
                status = "unresolved"
            target_dir = self.helpers._target_dir_for_move(move.target)
            if move.target.startswith("Review/") or move.target == "Review":
                status = "review"
            target_slot_id = mapping.target_slot_id if mapping is not None else self.ensure_target_slot_payload(target_slots, slot_state, target_dir, session=session)
            mapping_status = mapping.status if mapping is not None else ("skipped" if not target_slot_id and normalized_target == normalized_source else status)

            item = PlanSnapshotItem(
                item_id=legacy_item_id,
                display_name=planner_meta.get("display_name", Path(move.source).name),
                source_relpath=move.source,
                entry_type=scan_meta.get("entry_type") or planner_meta.get("entry_type", ""),
                suggested_purpose=scan_meta.get("suggested_purpose") or planner_meta.get("suggested_purpose", ""),
                content_summary=scan_meta.get("summary") or planner_meta.get("summary", ""),
                reason=getattr(move, "reason", ""),
                confidence=scan_meta.get("confidence", planner_meta.get("confidence")),
                target_slot_id=target_slot_id,
                mapping_status=mapping_status,
                status=status,
            )
            if mapping is None:
                mappings.append(
                    PlanMappingPayload(
                        source_ref_id=source_ref_ids_by_relpath.get(move.source) or planner_meta.get("planner_id", move.source),
                        item_id=planner_meta.get("planner_id", move.source),
                        target_slot_id=target_slot_id,
                        status=mapping_status,
                        reason=getattr(move, "reason", ""),
                        confidence=scan_meta.get("confidence", planner_meta.get("confidence")),
                        user_overridden=False,
                    )
                )
            items.append(item)
            if status == "review":
                review_items.append(item)
            directory = target_directory_for_slot(target_slot_id)
            grouped_items.setdefault(directory, []).append(item)

        items.sort(key=lambda item: self.helpers._planner_id_number(item.item_id))
        review_items.sort(key=lambda item: self.helpers._planner_id_number(item.item_id))
        mappings.sort(key=lambda item: self.helpers._planner_id_number(item.item_id))

        move_count = len([item for item in items if item.status != "unresolved"])
        unresolved_count = len([item for item in items if item.status == "unresolved"])
        groups = [
            PlanGroupPayload(directory=directory, count=len(group_items), items=group_items)
            for directory, group_items in sorted(grouped_items.items(), key=lambda pair: pair[0])
            if directory
        ]
        invalidated_items = [
            self.normalize_plan_snapshot_item(
                asdict(item) if isinstance(item, PlanSnapshotItem) else dict(item),
                target_slots=target_slots,
                slot_state=slot_state,
                session=session,
                default_status="invalidated",
                default_mapping_status="invalidated",
            )
            for item in (cycle_result.get("invalidated_items", []) or [])
        ]
        payload = PlanSnapshotPayload(
            summary=plan.summary,
            stats={
                "move_count": move_count,
                "unresolved_count": unresolved_count,
                "directory_count": len([slot for slot in target_slots if str(slot.relpath or "").strip()]),
            },
            placement=self.helpers._placement_payload(session.placement if session is not None else None),
            groups=groups,
            items=items,
            unresolved_items=[item.item_id for item in items if item.status == "unresolved"],
            review_items=review_items,
            invalidated_items=invalidated_items,
            diff_summary=list(cycle_result.get("diff_summary", [])),
            target_slots=target_slots,
            mappings=mappings,
            readiness={"can_precheck": bool(plan.moves) and unresolved_count == 0},
        )
        return asdict(payload)
