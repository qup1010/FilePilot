from __future__ import annotations

from collections.abc import Collection

from file_pilot.shared.review import REVIEW_DIR_NAME, REVIEW_DISPLAY_NAME, REVIEW_SLOT_ID


STAGE_DRAFT = "draft"
STAGE_SCANNING = "scanning"
STAGE_SELECTING_INCREMENTAL_SCOPE = "selecting_incremental_scope"
STAGE_PLANNING = "planning"
STAGE_READY_FOR_PRECHECK = "ready_for_precheck"
STAGE_READY_TO_EXECUTE = "ready_to_execute"
STAGE_EXECUTING = "executing"
STAGE_ROLLING_BACK = "rolling_back"
STAGE_COMPLETED = "completed"
STAGE_ABANDONED = "abandoned"
STAGE_STALE = "stale"
STAGE_INTERRUPTED = "interrupted"

TERMINAL_STAGES = {STAGE_ABANDONED, STAGE_COMPLETED, STAGE_STALE}
LOCKED_STAGES = {STAGE_SCANNING, STAGE_EXECUTING, STAGE_ROLLING_BACK}
PLANNING_MUTABLE_STAGES = {STAGE_PLANNING, STAGE_READY_FOR_PRECHECK}
RECOVERY_STAGES = {STAGE_STALE, STAGE_INTERRUPTED}
RECLAIMABLE_LOCK_STAGES = {STAGE_ABANDONED, STAGE_COMPLETED, STAGE_STALE}

TASK_PHASE_SETUP = "setup"
TASK_PHASE_ANALYZING = "analyzing"
TASK_PHASE_PLANNING = "planning"
TASK_PHASE_REVIEWING = "reviewing"
TASK_PHASE_EXECUTING = "executing"
TASK_PHASE_DONE = "done"

SESSION_STAGE_CONFLICT = "SESSION_STAGE_CONFLICT"


def normalize_stage(stage: str | None) -> str:
    return str(stage or "").strip().lower()


def is_stage(stage: str | None, expected: str) -> bool:
    return normalize_stage(stage) == expected


def is_stage_in(stage: str | None, allowed: Collection[str]) -> bool:
    return normalize_stage(stage) in allowed


def is_terminal_stage(stage: str | None) -> bool:
    return is_stage_in(stage, TERMINAL_STAGES)


def is_locked_stage(stage: str | None) -> bool:
    return is_stage_in(stage, LOCKED_STAGES)


def is_planning_mutable_stage(stage: str | None) -> bool:
    return is_stage_in(stage, PLANNING_MUTABLE_STAGES)


def is_recovery_stage(stage: str | None) -> bool:
    return is_stage_in(stage, RECOVERY_STAGES)


def is_reclaimable_lock_stage(stage: str | None) -> bool:
    return is_stage_in(stage, RECLAIMABLE_LOCK_STAGES)


def ensure_stage(stage: str | None, expected: str, *, error_code: str = SESSION_STAGE_CONFLICT) -> None:
    if not is_stage(stage, expected):
        raise RuntimeError(error_code)


def ensure_stage_in(stage: str | None, allowed: Collection[str], *, error_code: str = SESSION_STAGE_CONFLICT) -> None:
    if not is_stage_in(stage, allowed):
        raise RuntimeError(error_code)
