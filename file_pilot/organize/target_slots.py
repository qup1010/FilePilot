from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from file_pilot.shared.review import REVIEW_SLOT_ID


def is_review_slot(slot: Mapping[str, Any] | None) -> bool:
    if not isinstance(slot, Mapping):
        return False
    kind = str(slot.get("kind") or "").strip().lower()
    slot_id = str(slot.get("slot_id") or "").strip()
    return bool(slot.get("is_review")) or kind == "review" or slot_id == REVIEW_SLOT_ID


def directory_target_slots(target_slots: list[dict]) -> list[dict]:
    return [slot for slot in target_slots if not is_review_slot(slot)]


def slot_label(slot: Mapping[str, Any]) -> str:
    return str(slot.get("relpath") or slot.get("display_name") or slot.get("slot_id") or "").strip()
