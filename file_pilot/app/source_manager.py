from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from file_pilot.app.source_payloads import (
    build_planner_items_from_scan_lines,
    normalize_relpath,
    planner_items_from_source_refs,
    scan_entries_from_planner_items,
    scan_entries_from_lines,
)

if TYPE_CHECKING:
    from file_pilot.app.models import OrganizerSession
    from file_pilot.app.session_service import OrganizerSessionService


class SourceManager:
    def __init__(self, helpers: "OrganizerSessionService"):
        self.helpers = helpers

    def scan_entries(self, scan_lines: str) -> list[dict]:
        return scan_entries_from_lines(scan_lines)

    def build_planner_items(self, scan_lines: str, existing_items: list[dict] | None = None) -> list[dict]:
        return build_planner_items_from_scan_lines(scan_lines, existing_items=existing_items)

    def planner_items_from_task_sources(self, session: "OrganizerSession") -> list[dict]:
        task_state = session.task_state
        if not task_state or not task_state.sources:
            return []
        return planner_items_from_source_refs(task_state.sources)

    def session_planner_items(self, session: "OrganizerSession") -> list[dict]:
        task_items = self.planner_items_from_task_sources(session)
        base_items = list(session.planner_items or task_items or [])
        if not session.scan_lines:
            return base_items
        scan_items = self.build_planner_items(session.scan_lines, existing_items=base_items)
        known_sources = {normalize_relpath(item.get("source_relpath")) for item in base_items}
        scan_sources = {normalize_relpath(item.get("source_relpath")) for item in scan_items}
        if not base_items or not scan_sources.issubset(known_sources):
            return scan_items
        return base_items

    def session_scan_entries(self, session: "OrganizerSession") -> list[dict]:
        planner_items = self.session_planner_items(session)
        if planner_items:
            return scan_entries_from_planner_items(planner_items)
        return self.scan_entries(session.scan_lines)

    def build_source_tree_entries(
        self,
        target_dir: Path,
        scan_lines: str,
        planner_items: list[dict] | None = None,
        session: "OrganizerSession" | None = None,
    ) -> list[dict]:
        scan_entries = self.scan_entries(scan_lines)
        if not scan_entries:
            return []

        planner_by_source = {
            normalize_relpath(item.get("source_relpath")): dict(item)
            for item in (planner_items or [])
            if normalize_relpath(item.get("source_relpath"))
        }
        entries_by_path: dict[str, dict] = {}
        atomic_root_entries: dict[str, dict] = {}

        if session is not None:
            alias_map = self.helpers._source_alias_map(session)

            def alias_for_session_item(item) -> str:
                return next((key for key, value in alias_map.items() if self.helpers._source_item_matches(value, item)), "")

            for item in self.helpers._normalize_source_collection(session.source_collection):
                if not item.is_atomic_directory:
                    continue
                item_path = Path(item.path).resolve()
                source_relpath = normalize_relpath(alias_for_session_item(item) or item_path.name)
                if not source_relpath:
                    continue
                atomic_root_entries[source_relpath] = {
                    "source_relpath": source_relpath,
                    "display_name": item_path.name,
                    "entry_type": "directory",
                    "source_mode": "atomic",
                }

        def normalize_entry_type(source_relpath: str, raw_entry_type: str | None) -> str:
            normalized = str(raw_entry_type or "").strip().lower()
            if normalized in {"dir", "directory", "folder"}:
                return "directory"
            if normalized == "file":
                return "file"
            source_prefix = f"{source_relpath}/"
            if any(
                normalize_relpath(entry.get("source_relpath")).startswith(source_prefix)
                for entry in scan_entries
            ):
                return "directory"
            detected = self.helpers._detect_entry_type(target_dir, source_relpath)
            if detected == "dir":
                return "directory"
            return "file"

        def remember_entry(source_relpath: str, display_name: str, entry_type: str) -> None:
            if not source_relpath:
                return
            entry = {
                "source_relpath": source_relpath,
                "display_name": display_name or Path(source_relpath).name,
                "entry_type": entry_type,
            }
            if source_relpath in atomic_root_entries:
                entry["source_mode"] = "atomic"
            entries_by_path[source_relpath] = entry

        def belongs_to_atomic_descendant(source_relpath: str) -> bool:
            return any(
                source_relpath != root_path and source_relpath.startswith(f"{root_path}/")
                for root_path in atomic_root_entries
            )

        for entry in scan_entries:
            source_relpath = normalize_relpath(entry.get("source_relpath"))
            if not source_relpath:
                continue
            if belongs_to_atomic_descendant(source_relpath):
                continue
            planner_meta = planner_by_source.get(source_relpath, {})
            normalized_type = normalize_entry_type(source_relpath, entry.get("entry_type") or planner_meta.get("entry_type"))
            parts = [part for part in source_relpath.split("/") if part]
            parent_path = ""
            for parent in parts[:-1]:
                parent_path = f"{parent_path}/{parent}" if parent_path else parent
                remember_entry(parent_path, parent, "directory")
            remember_entry(source_relpath, str(entry.get("display_name") or Path(source_relpath).name), normalized_type)

        for root_path, entry in atomic_root_entries.items():
            entries_by_path[root_path] = entry

        return sorted(
            entries_by_path.values(),
            key=lambda item: (
                str(item.get("source_relpath") or "").count("/"),
                str(item.get("source_relpath") or "").lower(),
            ),
        )

    def ensure_planner_items(self, session: "OrganizerSession", scan_lines: str | None = None) -> bool:
        source_scan_lines = scan_lines if scan_lines is not None else session.scan_lines
        existing_items = session.planner_items or self.planner_items_from_task_sources(session)
        next_items = self.build_planner_items(source_scan_lines or "", existing_items=existing_items)
        changed = False
        if next_items != (session.planner_items or []):
            session.planner_items = next_items
            changed = True
        next_source_tree = self.build_source_tree_entries(
            Path(session.target_dir),
            source_scan_lines or "",
            planner_items=next_items,
            session=session,
        )
        if next_source_tree != (session.source_tree_entries or []):
            session.source_tree_entries = next_source_tree
            changed = True
        return changed
