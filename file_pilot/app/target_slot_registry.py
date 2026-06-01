from __future__ import annotations

from pathlib import Path

from file_pilot.app.session_constants import REVIEW_SLOT_ID
from file_pilot.domain.models import TargetSlot


class TargetSlotRegistry:
    def __init__(self, base_dir: str | Path, targets: list[TargetSlot]):
        self.base_dir = Path(base_dir).resolve()
        self.targets = targets

    @staticmethod
    def slot_number(slot_id: str) -> int:
        text = str(slot_id or "").strip()
        if len(text) >= 2 and text[0].upper() == "D" and text[1:].isdigit():
            return int(text[1:])
        return 0

    @staticmethod
    def normalize_relpath(value: str | None) -> str:
        return str(value or "").replace("\\", "/").strip().strip("/")

    def real_path_for_target_dir(self, target_dir: str) -> Path:
        raw = str(target_dir or "").strip()
        candidate = Path(raw)
        if candidate.is_absolute():
            return candidate.resolve()
        normalized = self.normalize_relpath(raw)
        return (self.base_dir / normalized).resolve()

    def directory_for_slot(self, slot_id: str) -> str:
        normalized_slot_id = str(slot_id or "").strip()
        if not normalized_slot_id:
            return ""
        if normalized_slot_id == REVIEW_SLOT_ID:
            return REVIEW_SLOT_ID
        for target in self.targets:
            if str(target.slot_id or "").strip() != normalized_slot_id:
                continue
            try:
                return self.normalize_relpath(Path(target.real_path).resolve().relative_to(self.base_dir).as_posix())
            except ValueError:
                return self.normalize_relpath(Path(target.real_path).resolve().as_posix())
        return ""

    def ensure_slot(self, target_dir: str) -> str:
        normalized_target_dir = self.normalize_relpath(target_dir)
        if not normalized_target_dir:
            return ""
        if normalized_target_dir == REVIEW_SLOT_ID:
            return REVIEW_SLOT_ID
        desired_real_path = self.real_path_for_target_dir(target_dir)
        for target in self.targets:
            if Path(target.real_path).resolve() == desired_real_path:
                return str(target.slot_id or "")
        next_number = max((self.slot_number(target.slot_id) for target in self.targets), default=0) + 1
        slot_id = f"D{next_number:03d}"
        try:
            relative_target_dir = self.normalize_relpath(desired_real_path.relative_to(self.base_dir).as_posix())
        except ValueError:
            relative_target_dir = normalized_target_dir
        self.targets.append(
            TargetSlot(
                slot_id=slot_id,
                display_name=Path(relative_target_dir or normalized_target_dir).name or normalized_target_dir,
                real_path=str(desired_real_path),
                depth=max(0, len([part for part in relative_target_dir.split("/") if part]) - 1),
                is_new=True,
            )
        )
        return slot_id
