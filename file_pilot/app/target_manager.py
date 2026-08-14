from __future__ import annotations

import copy
from pathlib import Path
from typing import TYPE_CHECKING

from file_pilot.app.models import PlanTargetSlotPayload
from file_pilot.domain.models import TargetSlot

if TYPE_CHECKING:
    from file_pilot.app.models import OrganizerSession
    from file_pilot.app.session_service import OrganizerSessionService
    from file_pilot.domain.models import OrganizeTask


class TargetManager:
    def __init__(self, helpers: "OrganizerSessionService"):
        self.helpers = helpers

    def target_slots_from_session(self, session: "OrganizerSession") -> list[TargetSlot]:
        if self.helpers._normalize_organize_mode(session.organize_mode) != "incremental":
            task_state = self.helpers._task_state_payload(session.task_state)
            if task_state.targets:
                return copy.deepcopy(list(task_state.targets or []))

            snapshot = self.helpers._plan_snapshot_payload(session.plan_snapshot)
            if snapshot and snapshot.target_slots:
                slots: list[TargetSlot] = []
                for item in snapshot.target_slots:
                    slot_id = str(item.slot_id or "").strip()
                    if not slot_id:
                        continue
                    raw_relpath = str(item.relpath or "").strip()
                    relpath = self.helpers._normalize_relpath(raw_relpath)
                    real_path = str(item.real_path or "").strip()
                    if not real_path:
                        if self.helpers._is_absolute_target_path(raw_relpath):
                            real_path = str(Path(raw_relpath).resolve())
                        elif relpath:
                            real_path = str(self.helpers._resolve_target_real_path(session, relpath))
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
                    slots.sort(key=lambda item: self.helpers._target_slot_number(item.slot_id))
                    return slots
            return []

        selection = self.helpers._incremental_selection_snapshot(session)
        base_dir = Path(session.target_dir).resolve()
        next_number = 1
        slots: list[TargetSlot] = []
        tree_nodes = list(selection.get("target_directory_tree") or [])
        if not tree_nodes and selection.get("target_directories"):
            tree_nodes = [
                {"relpath": self.helpers._normalize_relpath(path), "name": Path(str(path)).name, "children": []}
                for path in selection.get("target_directories") or []
                if self.helpers._normalize_relpath(path)
            ]

        def walk(nodes: list[dict], depth: int) -> list[TargetSlot]:
            nonlocal next_number
            branch: list[TargetSlot] = []
            for node in nodes:
                if not isinstance(node, dict):
                    continue
                relpath = self.helpers._normalize_relpath(node.get("relpath"))
                if not relpath:
                    continue
                real_path = (
                    Path(relpath).resolve()
                    if self.helpers._is_absolute_target_path(relpath)
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
                slot.children = walk(list(node.get("children") or []), depth + 1)
                slots.append(slot)
                branch.append(slot)
            return branch

        walk(tree_nodes, 0)
        slots.sort(key=lambda item: self.helpers._target_slot_number(item.slot_id))
        return slots

    def target_slot_payloads_from_task(
        self,
        session: "OrganizerSession",
        task: "OrganizeTask",
    ) -> list[PlanTargetSlotPayload]:
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

    def root_directory_options_from_scan(self, scan_lines: str) -> list[str]:
        options = [
            self.helpers._normalize_relpath(entry.get("source_relpath"))
            for entry in self.helpers._scan_entries(scan_lines)
            if str(entry.get("entry_type") or "").strip().lower() in {"dir", "directory", "folder"}
        ]
        return [item for item in options if item and "/" not in item]

    def explore_target_directories(
        self,
        target_dir: Path,
        selected_dirs: list[str],
        *,
        max_depth: int = 10,
    ) -> list[dict]:
        normalized_selected = [
            self.helpers._normalize_relpath(path)
            for path in selected_dirs
            if self.helpers._normalize_relpath(path)
        ]
        if not target_dir.exists():
            return []

        def build_node(current: Path, depth: int) -> dict:
            try:
                relpath = self.helpers._normalize_relpath(current.relative_to(target_dir).as_posix())
            except ValueError:
                relpath = str(current.resolve())
            children: list[dict] = []
            if depth < max_depth:
                try:
                    child_dirs = sorted(
                        [child for child in current.iterdir() if child.is_dir() and not child.name.startswith(".")],
                        key=lambda item: item.name.lower(),
                    )
                except OSError:
                    child_dirs = []
                for child in child_dirs:
                    children.append(build_node(child, depth + 1))
            return {
                "relpath": relpath,
                "name": current.name,
                "children": children,
            }

        tree: list[dict] = []
        for relpath in normalized_selected:
            candidate = Path(relpath).resolve() if Path(relpath).is_absolute() else (target_dir / relpath).resolve()
            if not candidate.exists() or not candidate.is_dir():
                continue
            tree.append(build_node(candidate, 1))
        return tree

    def filter_incremental_pending_scan_lines(self, scan_lines: str, target_directories: list[str]) -> str:
        selected_roots = {
            self.helpers._normalize_relpath(path)
            for path in target_directories
            if self.helpers._normalize_relpath(path)
        }
        selected_root_names = {
            Path(path).name
            for path in selected_roots
            if Path(path).is_absolute() and Path(path).name
        }
        filtered_lines: list[str] = []
        for line in (scan_lines or "").splitlines():
            source_relpath = self.helpers._normalize_relpath(line.split("|", 1)[0])
            if not source_relpath:
                continue
            root_name = source_relpath.split("/", 1)[0]
            if source_relpath in selected_roots or root_name in selected_roots or root_name in selected_root_names:
                continue
            filtered_lines.append(line)
        return "\n".join(filtered_lines)

    def set_incremental_selection_pending(self, session: "OrganizerSession", scan_lines: str) -> None:
        if self.helpers._normalize_organize_mode(session.organize_mode) != "incremental":
            session.incremental_selection = self.helpers._incremental_selection_defaults(session)
            return
        selected_target_directories = self.helpers._normalize_target_directories(session.selected_target_directories)
        session.incremental_selection = {
            "required": True,
            "status": "ready" if selected_target_directories else "pending",
            "destination_index_depth": self.helpers._normalize_destination_index_depth(session.destination_index_depth),
            "root_directory_options": self.root_directory_options_from_scan(scan_lines),
            "target_directories": selected_target_directories,
            "target_directory_tree": [],
            "pending_items_count": 0,
            "source_scan_completed": False,
        }
