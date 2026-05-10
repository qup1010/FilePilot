from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from file_pilot.app.session_service import OrganizerSessionService
    from file_pilot.app.models import OrganizerSession


class TargetManager:
    def __init__(self, helpers: "OrganizerSessionService"):
        self.helpers = helpers

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

    def validate_incremental_target_dir(self, session: "OrganizerSession", target_dir: str, selection: dict | None) -> bool:
        return self.helpers.target_resolver.validate_incremental_target_dir(session, target_dir, selection)

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
