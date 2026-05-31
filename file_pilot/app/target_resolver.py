from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import posixpath
from typing import TYPE_CHECKING

from file_pilot.app.models import OrganizerSession, PlacementPayload
from file_pilot.app.session_constants import REVIEW_DIR_NAME, REVIEW_SLOT_ID
from file_pilot.shared.path_utils import canonical_target_dir

if TYPE_CHECKING:
    from file_pilot.app.session_service import OrganizerSessionService
    from file_pilot.organize.models import FinalPlan, PendingPlan
    from file_pilot.domain.models import TargetSlot


@dataclass(frozen=True)
class ResolvedTarget:
    kind: str
    normalized_dir: str
    absolute_dir: str
    target_slot_id: str = ""


class TargetResolver:
    def __init__(self, helpers: "OrganizerSessionService"):
        self.helpers = helpers

    @staticmethod
    def normalize_placement_root(value: str | None) -> str:
        text = str(value or "").strip()
        return str(Path(text).resolve()) if text else ""

    @classmethod
    def default_review_root(cls, new_directory_root: str) -> str:
        normalized_new_root = cls.normalize_placement_root(new_directory_root)
        if not normalized_new_root:
            return ""
        return str((Path(normalized_new_root) / REVIEW_DIR_NAME).resolve())

    @classmethod
    def placement_payload(
        cls,
        placement: PlacementPayload | dict | None = None,
        *,
        new_directory_root: str | None = None,
        review_root: str | None = None,
    ) -> PlacementPayload:
        base = PlacementPayload.from_dict(placement)
        normalized_new_root = cls.normalize_placement_root(
            new_directory_root if new_directory_root is not None else base.new_directory_root
        )
        normalized_review_root = cls.normalize_placement_root(
            review_root if review_root is not None else base.review_root
        )
        if normalized_new_root and not normalized_review_root:
            normalized_review_root = cls.default_review_root(normalized_new_root)
        return PlacementPayload(
            new_directory_root=normalized_new_root,
            review_root=normalized_review_root,
        )

    @staticmethod
    def is_absolute_target_path(value: str | None) -> bool:
        text = str(value or "").strip()
        if not text:
            return False
        if Path(text).drive:
            return True
        try:
            return Path(text).is_absolute()
        except OSError:
            return False

    @staticmethod
    def normalize_target_dir(value: str | None) -> str:
        normalized = str(value or "").replace("\\", "/").strip().strip("/")
        if not normalized:
            return ""
        normalized = posixpath.normpath(normalized)
        return "" if normalized == "." else normalized.strip("/")

    @staticmethod
    def is_outside_relative_target(value: str | None) -> bool:
        normalized = TargetResolver.normalize_target_dir(value)
        return normalized == ".." or normalized.startswith("../")

    def resolve_target_real_path(self, session: OrganizerSession, target_dir: str) -> Path:
        text = str(target_dir or "").strip()
        candidate = Path(text)
        if candidate.is_absolute():
            return candidate.resolve()
        placement = self.placement_payload(session.placement)
        base_root = placement.new_directory_root or session.target_dir
        return (Path(base_root).resolve() / text).resolve()

    def review_target_path(self, session: OrganizerSession, source_relpath: str) -> Path:
        placement = self.placement_payload(session.placement)
        filename = Path(str(source_relpath or "")).name
        base_root = placement.review_root or self.default_review_root(
            placement.new_directory_root or session.target_dir
        )
        return (Path(base_root).resolve() / filename).resolve()

    def target_slot_relpath(self, session: OrganizerSession, target: "TargetSlot") -> str:
        try:
            relative = Path(target.real_path).resolve().relative_to(Path(session.target_dir).resolve()).as_posix()
        except ValueError:
            return ""
        return self.helpers._normalize_relpath(relative)

    def target_dir_from_slot_id(
        self,
        session: OrganizerSession,
        slot_id: str | None,
        plan: "PendingPlan | FinalPlan | None" = None,
    ) -> str:
        normalized_slot_id = str(slot_id or "").strip()
        if not normalized_slot_id:
            return ""
        if normalized_slot_id == REVIEW_SLOT_ID:
            return REVIEW_SLOT_ID
        task, _ = self.helpers._build_organize_task(session, plan)
        for target in task.targets:
            if target.slot_id == normalized_slot_id:
                relpath = self.target_slot_relpath(session, target)
                if relpath:
                    return relpath
                return self.helpers._normalize_relpath(target.real_path)
        raise RuntimeError("TARGET_SLOT_NOT_FOUND")

    def validate_incremental_target_dir(self, session: OrganizerSession, target_dir: str, selection: dict | None) -> bool:
        normalized = self.helpers._normalize_relpath(target_dir)
        if not normalized or normalized == REVIEW_SLOT_ID:
            return True

        incremental_selection = selection or {}
        selected_relpaths = {
            self.helpers._normalize_relpath(path)
            for path in (incremental_selection.get("target_directories") or [])
            if self.helpers._normalize_relpath(path)
        }
        if normalized in selected_relpaths:
            return True

        selected_real_paths = {
            canonical_target_dir(path)
            for path in (incremental_selection.get("target_directories") or [])
            if str(path or "").strip()
        }
        if not selected_real_paths:
            return False

        resolved_target_path = canonical_target_dir(self.resolve_target_real_path(session, normalized))
        return resolved_target_path in selected_real_paths

    def normalized_target(
        self,
        session: OrganizerSession,
        pending: "PendingPlan",
        *,
        target_dir: str | None = None,
        target_slot: str | None = None,
        move_to_review: bool = False,
    ) -> ResolvedTarget:
        if move_to_review:
            absolute_dir = str(self.review_target_path(session, "placeholder").parent)
            return ResolvedTarget(kind="review", normalized_dir=REVIEW_SLOT_ID, absolute_dir=absolute_dir, target_slot_id=REVIEW_SLOT_ID)

        if target_slot is not None:
            normalized_dir = self.target_dir_from_slot_id(session, target_slot, pending)
            if normalized_dir == REVIEW_SLOT_ID:
                absolute_dir = str(self.review_target_path(session, "placeholder").parent)
                return ResolvedTarget(kind="review", normalized_dir=normalized_dir, absolute_dir=absolute_dir, target_slot_id=REVIEW_SLOT_ID)
            absolute_dir = str(self.resolve_target_real_path(session, normalized_dir))
            return ResolvedTarget(
                kind="existing_slot",
                normalized_dir=normalized_dir,
                absolute_dir=absolute_dir,
                target_slot_id=str(target_slot or "").strip(),
            )

        if self.is_absolute_target_path(target_dir):
            raise RuntimeError("ABSOLUTE_TARGET_DIR_NOT_ALLOWED")
        if self.is_outside_relative_target(target_dir):
            raise RuntimeError("TARGET_DIR_OUTSIDE_ROOT")
        normalized_dir = self.normalize_target_dir(target_dir)
        if normalized_dir == REVIEW_SLOT_ID or normalized_dir.startswith(f"{REVIEW_SLOT_ID}/"):
            raise RuntimeError("REVIEW_SUBDIRECTORY_NOT_ALLOWED")
        if self.helpers._normalize_organize_mode(session.organize_mode) == "incremental" and normalized_dir:
            selection = self.helpers._incremental_selection_snapshot(session)
            if not self.validate_incremental_target_dir(session, normalized_dir, selection):
                raise RuntimeError("INCREMENTAL_TARGET_NOT_ALLOWED")
        absolute_dir = str(self.resolve_target_real_path(session, normalized_dir)) if normalized_dir else ""
        return ResolvedTarget(
            kind="new_dir" if normalized_dir else "none",
            normalized_dir=normalized_dir,
            absolute_dir=absolute_dir,
            target_slot_id="",
        )
