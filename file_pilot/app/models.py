from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from file_pilot.app.id_registry import IdRegistryState
from file_pilot.app.session_constants import (
    REVIEW_SLOT_ID,
    STAGE_ABANDONED,
    STAGE_COMPLETED,
    STAGE_DRAFT,
    STAGE_EXECUTING,
    STAGE_INTERRUPTED,
    STAGE_PLANNING,
    STAGE_READY_FOR_PRECHECK,
    STAGE_READY_TO_EXECUTE,
    STAGE_SCANNING,
    STAGE_SELECTING_INCREMENTAL_SCOPE,
    STAGE_STALE,
    TASK_PHASE_ANALYZING,
    TASK_PHASE_DONE,
    TASK_PHASE_EXECUTING,
    TASK_PHASE_PLANNING,
    TASK_PHASE_REVIEWING,
    TASK_PHASE_SETUP,
)
from file_pilot.app.source_payloads import (
    build_planner_items_from_scan_lines,
    source_refs_from_planner_items,
)
from file_pilot.domain.models import MappingEntry, OrganizeTask, SourceRef, TargetSlot
from file_pilot.organize.strategy_templates import (
    DEFAULT_CAUTION_LEVEL,
    DEFAULT_DENSITY,
    DEFAULT_LANGUAGE,
    DEFAULT_ORGANIZE_METHOD,
    DEFAULT_PREFIX_STYLE,
    DEFAULT_TEMPLATE_ID,
    _normalize_organize_method,
    organize_method_for_organize_mode,
    task_type_for_organize_mode,
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class LockResult:
    acquired: bool
    lock_owner_session_id: str | None = None
    reason: str = "acquired"


def _task_phase_for_stage(stage: str | None) -> str:
    normalized = str(stage or "").strip().lower()
    if normalized in {STAGE_DRAFT, STAGE_SELECTING_INCREMENTAL_SCOPE}:
        return TASK_PHASE_SETUP
    if normalized == STAGE_SCANNING:
        return TASK_PHASE_ANALYZING
    if normalized in {STAGE_PLANNING, STAGE_READY_FOR_PRECHECK}:
        return TASK_PHASE_PLANNING
    if normalized == STAGE_READY_TO_EXECUTE:
        return TASK_PHASE_REVIEWING
    if normalized == STAGE_EXECUTING:
        return TASK_PHASE_EXECUTING
    if normalized in {STAGE_COMPLETED, STAGE_ABANDONED, STAGE_STALE, STAGE_INTERRUPTED}:
        return TASK_PHASE_DONE
    return TASK_PHASE_SETUP


@dataclass
class TaskState:
    sources: list[SourceRef] = field(default_factory=list)
    targets: list[TargetSlot] = field(default_factory=list)
    mappings: list[MappingEntry] = field(default_factory=list)
    strategy: dict = field(default_factory=dict)
    phase: str = "setup"

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_task(cls, task: OrganizeTask | None) -> "TaskState" | None:
        if task is None:
            return None
        return cls(
            sources=list(task.sources or []),
            targets=list(task.targets or []),
            mappings=list(task.mappings or []),
            strategy=dict(task.strategy or {}),
            phase=str(task.phase or "setup"),
        )

    def to_task(self, task_id: str) -> OrganizeTask:
        return OrganizeTask(
            task_id=task_id,
            sources=list(self.sources or []),
            targets=list(self.targets or []),
            mappings=list(self.mappings or []),
            strategy=dict(self.strategy or {}),
            user_constraints=[],
            phase=str(self.phase or "setup"),
        )

    @classmethod
    def from_dict(cls, data: dict | "TaskState" | None) -> "TaskState" | None:
        if data is None:
            return None
        if isinstance(data, cls):
            return data
        if not isinstance(data, dict):
            return None

        def load_target(raw: dict) -> TargetSlot:
            slot = TargetSlot(
                slot_id=str(raw.get("slot_id") or ""),
                display_name=str(raw.get("display_name") or ""),
                real_path=str(raw.get("real_path") or ""),
                depth=int(raw.get("depth", 0) or 0),
                is_new=bool(raw.get("is_new", False)),
            )
            slot.children = [load_target(child) for child in raw.get("children", []) if isinstance(child, dict)]
            return slot

        return cls(
            sources=[
                SourceRef(**item)
                for item in data.get("sources", [])
                if isinstance(item, dict)
            ],
            targets=[
                load_target(item)
                for item in data.get("targets", [])
                if isinstance(item, dict)
            ],
            mappings=[
                MappingEntry(**item)
                for item in data.get("mappings", [])
                if isinstance(item, dict)
            ],
            strategy=dict(data.get("strategy", {})),
            phase=str(data.get("phase", "setup") or "setup"),
        )


@dataclass
class SourceCollectionItem:
    source_type: str
    path: str
    directory_mode: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def normalized_directory_mode(self) -> str:
        if self.source_type != "directory":
            return "atomic"
        normalized = str(self.directory_mode or "contents").strip().lower()
        return "atomic" if normalized == "atomic" else "contents"

    @property
    def scans_directory_contents(self) -> bool:
        return self.source_type == "directory" and self.normalized_directory_mode == "contents"

    @property
    def is_atomic_directory(self) -> bool:
        return self.source_type == "directory" and self.normalized_directory_mode == "atomic"

    @classmethod
    def from_dict(cls, data: dict | "SourceCollectionItem" | None) -> "SourceCollectionItem" | None:
        if data is None:
            return None
        if isinstance(data, cls):
            return data
        if not isinstance(data, dict):
            return None
        source_type = str(data.get("source_type") or "").strip().lower()
        path = str(data.get("path") or "").strip()
        if source_type not in {"file", "directory"} or not path:
            return None
        directory_mode = None
        if source_type == "directory":
            raw_mode = str(data.get("directory_mode") or "").strip().lower()
            directory_mode = "atomic" if raw_mode == "atomic" else "contents"
        return cls(source_type=source_type, path=path, directory_mode=directory_mode)


@dataclass
class TargetProfileDirectory:
    path: str
    label: str = ""
    # 规则主字段：「什么样的文件应该放进这里」，一个目录一条，天然无冲突
    description: str = ""
    # 可选硬条件（加速层）：命中即确定性分类，不调模型；不是必需层
    extensions: list[str] = field(default_factory=list)
    name_patterns: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def _normalize_str_list(value, *, canonicalize=None) -> list[str]:
        if not isinstance(value, (list, tuple)):
            return []
        items: list[str] = []
        for entry in value:
            text = str(entry or "").strip()
            if canonicalize is not None:
                text = canonicalize(text)
            if text and text not in items:
                items.append(text)
        return items

    @classmethod
    def from_dict(cls, data: dict | "TargetProfileDirectory" | None) -> "TargetProfileDirectory" | None:
        if data is None:
            return None
        if isinstance(data, cls):
            return data
        if not isinstance(data, dict):
            return None
        path = str(data.get("path") or "").strip()
        if not path:
            return None
        return cls(
            path=path,
            label=str(data.get("label") or "").strip(),
            description=str(data.get("description") or "").strip(),
            extensions=cls._normalize_str_list(
                data.get("extensions"), canonicalize=lambda text: text.lstrip(".").lower()
            ),
            name_patterns=cls._normalize_str_list(data.get("name_patterns")),
        )


@dataclass
class TargetProfile:
    profile_id: str
    name: str
    directories: list[TargetProfileDirectory] = field(default_factory=list)
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | "TargetProfile" | None) -> "TargetProfile" | None:
        if data is None:
            return None
        if isinstance(data, cls):
            return data
        if not isinstance(data, dict):
            return None
        profile_id = str(data.get("profile_id") or "").strip()
        name = str(data.get("name") or "").strip()
        if not profile_id or not name:
            return None
        return cls(
            profile_id=profile_id,
            name=name,
            directories=[
                item
                for item in (
                    TargetProfileDirectory.from_dict(entry)
                    for entry in data.get("directories", [])
                )
                if item is not None
            ],
            created_at=str(data.get("created_at") or utc_now_iso()),
            updated_at=str(data.get("updated_at") or utc_now_iso()),
        )


@dataclass
class ConversationState:
    messages: list[dict] = field(default_factory=list)
    assistant_message: dict | None = None
    scanner_progress: dict = field(default_factory=dict)
    planner_progress: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | "ConversationState" | None) -> "ConversationState" | None:
        if data is None:
            return None
        if isinstance(data, cls):
            return data
        if not isinstance(data, dict):
            return None
        return cls(
            messages=list(data.get("messages", [])),
            assistant_message=data.get("assistant_message"),
            scanner_progress=dict(data.get("scanner_progress", {})),
            planner_progress=dict(data.get("planner_progress", {})),
        )


@dataclass
class ExecutionState:
    precheck_summary: dict | None = None
    execution_report: dict | None = None
    rollback_report: dict | None = None
    last_journal_id: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | "ExecutionState" | None) -> "ExecutionState" | None:
        if data is None:
            return None
        if isinstance(data, cls):
            return data
        if not isinstance(data, dict):
            return None
        return cls(
            precheck_summary=data.get("precheck_summary"),
            execution_report=data.get("execution_report"),
            rollback_report=data.get("rollback_report"),
            last_journal_id=data.get("last_journal_id"),
        )


@dataclass
class AIPendingBaseline:
    schema_version: int = 1
    pending_plan: "PendingPlanPayload | None" = None
    plan_snapshot: "PlanSnapshotPayload | None" = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | "AIPendingBaseline" | None) -> "AIPendingBaseline" | None:
        if data is None:
            return None
        if isinstance(data, cls):
            return data
        if not isinstance(data, dict):
            return None
        pending_plan = PendingPlanPayload.from_dict(data.get("pending_plan"))
        if pending_plan is None:
            pending_plan = PendingPlanPayload.from_dict(
                {
                "directories": list(data.get("directories", [])),
                "moves": list(data.get("moves", [])),
                "user_constraints": list(data.get("user_constraints", [])),
                "unresolved_items": list(data.get("unresolved_items", [])),
                "summary": data.get("summary", ""),
                }
            )
        plan_snapshot = PlanSnapshotPayload.from_dict(data.get("plan_snapshot"))
        return cls(
            schema_version=int(data.get("schema_version", 1) or 1),
            pending_plan=pending_plan,
            plan_snapshot=plan_snapshot,
        )


@dataclass
class PendingPlanPayload:
    directories: list[str] = field(default_factory=list)
    moves: list[dict] = field(default_factory=list)
    user_constraints: list[str] = field(default_factory=list)
    unresolved_items: list[str] = field(default_factory=list)
    summary: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    def get(self, key: str, default=None):
        return self.to_dict().get(key, default)

    def __getitem__(self, key: str):
        return self.to_dict()[key]

    def __bool__(self) -> bool:
        return bool(self.directories or self.moves or self.unresolved_items or self.summary or self.user_constraints)

    @classmethod
    def from_dict(cls, data: dict | "PendingPlanPayload" | None) -> "PendingPlanPayload" | None:
        if data is None:
            return None
        if isinstance(data, cls):
            return data
        if not isinstance(data, dict):
            return None
        return cls(
            directories=list(data.get("directories", [])),
            moves=list(data.get("moves", [])),
            user_constraints=list(data.get("user_constraints", [])),
            unresolved_items=list(data.get("unresolved_items", [])),
            summary=str(data.get("summary", "") or ""),
        )


@dataclass
class PlanTargetSlotPayload:
    slot_id: str
    display_name: str
    relpath: str
    depth: int
    is_new: bool
    real_path: str = ""
    kind: str = "directory"
    is_review: bool = False

    def __post_init__(self) -> None:
        normalized_kind = str(self.kind or "").strip().lower()
        is_review = bool(self.is_review) or str(self.slot_id or "").strip() == REVIEW_SLOT_ID or normalized_kind == "review"
        self.is_review = is_review
        self.kind = "review" if is_review else "directory"


@dataclass
class PlacementPayload:
    new_directory_root: str = ""
    review_root: str = ""

    @classmethod
    def from_dict(cls, data: dict | "PlacementPayload" | None) -> "PlacementPayload":
        if isinstance(data, cls):
            return data
        if not isinstance(data, dict):
            return cls()
        return cls(
            new_directory_root=str(data.get("new_directory_root") or "").strip(),
            review_root=str(data.get("review_root") or "").strip(),
        )


@dataclass
class PlanMappingPayload:
    source_ref_id: str
    item_id: str
    target_slot_id: str
    status: str
    reason: str = ""
    confidence: float | None = None
    user_overridden: bool = False
    original_target_slot_id: str | None = None
    original_status: str | None = None
    overridden_at: str | None = None
    can_restore_ai_suggestion: bool = False


@dataclass
class PlanSnapshotItem:
    item_id: str
    display_name: str
    source_relpath: str
    entry_type: str = ""
    suggested_purpose: str = ""
    content_summary: str = ""
    reason: str = ""
    confidence: float | None = None
    target_slot_id: str = ""
    mapping_status: str = "planned"
    status: str = "planned"
    user_overridden: bool = False
    original_target_slot_id: str | None = None
    original_status: str | None = None
    overridden_at: str | None = None
    can_restore_ai_suggestion: bool = False


@dataclass
class PlanGroupPayload:
    directory: str
    count: int
    items: list[PlanSnapshotItem] = field(default_factory=list)


@dataclass
class PlanSnapshotPayload:
    summary: str
    stats: dict
    placement: PlacementPayload = field(default_factory=PlacementPayload)
    groups: list[PlanGroupPayload] = field(default_factory=list)
    items: list[PlanSnapshotItem] = field(default_factory=list)
    unresolved_items: list[str] = field(default_factory=list)
    review_items: list[PlanSnapshotItem] = field(default_factory=list)
    invalidated_items: list[PlanSnapshotItem] = field(default_factory=list)
    diff_summary: list[str] = field(default_factory=list)
    change_highlights: list[str] = field(default_factory=list)
    target_slots: list[PlanTargetSlotPayload] = field(default_factory=list)
    mappings: list[PlanMappingPayload] = field(default_factory=list)
    readiness: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    def get(self, key: str, default=None):
        return self.to_dict().get(key, default)

    def __getitem__(self, key: str):
        return self.to_dict()[key]

    def __bool__(self) -> bool:
        return bool(
            self.summary
            or self.stats
            or self.groups
            or self.items
            or self.unresolved_items
            or self.review_items
            or self.invalidated_items
            or self.diff_summary
            or self.change_highlights
            or self.target_slots
            or self.mappings
            or self.readiness
        )

    @classmethod
    def from_dict(cls, data: dict | "PlanSnapshotPayload" | None) -> "PlanSnapshotPayload" | None:
        if data is None:
            return None
        if isinstance(data, cls):
            return data
        if not isinstance(data, dict):
            return None
        def normalize_item(item: dict) -> PlanSnapshotItem:
            source_relpath = str(item.get("source_relpath") or item.get("item_id") or "")
            normalized = {
                "item_id": item.get("item_id") or source_relpath,
                "display_name": item.get("display_name") or source_relpath.split("/")[-1],
                "source_relpath": source_relpath,
                "entry_type": item.get("entry_type", ""),
                "suggested_purpose": item.get("suggested_purpose", ""),
                "content_summary": item.get("content_summary", ""),
                "reason": item.get("reason", ""),
                "confidence": item.get("confidence"),
                "target_slot_id": item.get("target_slot_id", ""),
                "mapping_status": item.get(
                    "mapping_status",
                    "unresolved" if item.get("is_unresolved") else item.get("status", "planned"),
                ),
                "status": item.get(
                    "status",
                    "unresolved" if item.get("is_unresolved") else "planned",
                ),
                "user_overridden": bool(item.get("user_overridden", False)),
                "original_target_slot_id": item.get("original_target_slot_id"),
                "original_status": item.get("original_status"),
                "overridden_at": item.get("overridden_at"),
                "can_restore_ai_suggestion": bool(item.get("can_restore_ai_suggestion", False)),
            }
            return PlanSnapshotItem(**normalized)

        return cls(
            summary=str(data.get("summary", "") or ""),
            stats=dict(data.get("stats", {})),
            placement=PlacementPayload.from_dict(data.get("placement")),
            groups=[
                PlanGroupPayload(
                    directory=str(item.get("directory", "") or ""),
                    count=int(item.get("count", 0) or 0),
                    items=[normalize_item(entry) for entry in item.get("items", []) if isinstance(entry, dict)],
                )
                for item in data.get("groups", [])
                if isinstance(item, dict)
            ],
            items=[normalize_item(item) for item in data.get("items", []) if isinstance(item, dict)],
            unresolved_items=list(data.get("unresolved_items", [])),
            review_items=[normalize_item(item) for item in data.get("review_items", []) if isinstance(item, dict)],
            invalidated_items=[normalize_item(item) for item in data.get("invalidated_items", []) if isinstance(item, dict)],
            diff_summary=list(data.get("diff_summary", [])),
            change_highlights=list(data.get("change_highlights", [])),
            target_slots=[PlanTargetSlotPayload(**item) for item in data.get("target_slots", []) if isinstance(item, dict)],
            mappings=[PlanMappingPayload(**item) for item in data.get("mappings", []) if isinstance(item, dict)],
            readiness=dict(data.get("readiness", {})),
        )


@dataclass
class OrganizerSession:
    session_id: str
    target_dir: str
    placement: PlacementPayload = field(default_factory=PlacementPayload)
    source_collection: list[SourceCollectionItem] = field(default_factory=list)
    organize_method: str = DEFAULT_ORGANIZE_METHOD
    # 一键整理：扫描→规划→预检→执行自动推进，不在 ready_* 停站等待前端
    unattended: bool = False
    output_dir: str = ""
    target_profile_id: str = ""
    selected_target_directories: list[str] = field(default_factory=list)
    selected_target_directory_details: list[TargetProfileDirectory] = field(default_factory=list)
    planning_schema_version: int = 5
    stage: str = STAGE_DRAFT
    strategy_template_id: str = DEFAULT_TEMPLATE_ID
    strategy_template_label: str = "通用整理"
    organize_mode: str = "initial"
    destination_index_depth: int = 2
    language: str = DEFAULT_LANGUAGE
    density: str = DEFAULT_DENSITY
    prefix_style: str = DEFAULT_PREFIX_STYLE
    caution_level: str = DEFAULT_CAUTION_LEVEL
    strategy_note: str = ""
    messages: list[dict] = field(default_factory=list)
    scan_lines: str = ""
    planner_items: list[dict] = field(default_factory=list)
    inspection_context: dict[str, dict] = field(default_factory=dict)
    source_tree_entries: list[dict] = field(default_factory=list)
    pending_plan: PendingPlanPayload | None = None
    plan_snapshot: PlanSnapshotPayload | None = None
    user_constraints: list[str] = field(default_factory=list)
    scanner_progress: dict = field(default_factory=dict)
    planner_progress: dict = field(default_factory=dict)
    incremental_selection: dict = field(default_factory=dict)
    assistant_message: dict | None = None
    precheck_summary: dict | None = None
    execution_report: dict | None = None
    rollback_report: dict | None = None
    last_journal_id: str | None = None
    integrity_flags: dict = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)
    stale_reason: str | None = None
    last_error: str | None = None
    last_ai_pending_plan: AIPendingBaseline | None = None
    summary: str = ""
    id_registry_state: IdRegistryState | None = None
    task_state: TaskState | None = None
    conversation_state: ConversationState | None = None
    execution_state: ExecutionState | None = None

    def touch(self) -> None:
        self.updated_at = utc_now_iso()

    def _derived_task_state(self) -> TaskState:
        if self.task_state is not None:
            return self.task_state
        source_origin = str(Path(self.target_dir).resolve())
        sources = source_refs_from_planner_items(self.planner_items, default_origin=source_origin)
        snapshot = self.plan_snapshot or PlanSnapshotPayload(summary="", stats={})
        targets = [
            TargetSlot(
                slot_id=str(item.slot_id or ""),
                display_name=str(item.display_name or ""),
                real_path=(
                    str(Path(item.real_path).resolve())
                    if str(item.real_path or "").strip()
                    else (
                        str((Path(self.target_dir).resolve() / str(item.relpath or "")).resolve())
                        if str(item.relpath or "").strip()
                        else str(Path(self.target_dir).resolve())
                    )
                ),
                depth=int(item.depth or 0),
                is_new=bool(item.is_new),
            )
            for item in (snapshot.target_slots or [])
            if str(item.slot_id or "").strip()
        ]
        mappings = [
            MappingEntry(
                source_ref_id=str(item.source_ref_id or ""),
                target_slot_id=str(item.target_slot_id or ""),
                status=str(item.status or "planned"),
                reason=str(item.reason or ""),
                confidence=item.confidence,
                user_overridden=bool(item.user_overridden),
                original_target_slot_id=item.original_target_slot_id,
                original_status=item.original_status,
                overridden_at=item.overridden_at,
            )
            for item in (snapshot.mappings or [])
            if str(item.source_ref_id or "").strip()
        ]
        return TaskState(
            sources=sources,
            targets=targets,
            mappings=mappings,
            strategy={
                "template_id": self.strategy_template_id,
                "task_type": task_type_for_organize_mode(self.organize_mode),
                "organize_method": self.organize_method or organize_method_for_organize_mode(self.organize_mode),
                "organize_mode": self.organize_mode,
                "destination_index_depth": self.destination_index_depth,
                "language": self.language,
                "density": self.density,
                "prefix_style": self.prefix_style,
                "caution_level": self.caution_level,
                "output_dir": self.output_dir,
                "target_profile_id": self.target_profile_id,
                "target_directories": list(self.selected_target_directories or []),
                "target_directory_details": [
                    item.to_dict()
                    for item in (self.selected_target_directory_details or [])
                ],
                "new_directory_root": str(self.placement.new_directory_root or "").strip(),
                "review_root": str(self.placement.review_root or "").strip(),
                "note": self.strategy_note,
            },
            phase=_task_phase_for_stage(self.stage),
        )

    def _derived_conversation_state(self) -> ConversationState:
        return self.conversation_state or ConversationState(
            messages=list(self.messages or []),
            assistant_message=self.assistant_message,
            scanner_progress=dict(self.scanner_progress or {}),
            planner_progress=dict(self.planner_progress or {}),
        )

    def _derived_execution_state(self) -> ExecutionState:
        return self.execution_state or ExecutionState(
            precheck_summary=self.precheck_summary,
            execution_report=self.execution_report,
            rollback_report=self.rollback_report,
            last_journal_id=self.last_journal_id,
        )

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["task_state"] = self._derived_task_state().to_dict()
        payload["conversation_state"] = self._derived_conversation_state().to_dict()
        payload["execution_state"] = self._derived_execution_state().to_dict()
        return payload

    @classmethod
    def from_dict(cls, data: dict) -> "OrganizerSession":
        conversation_state = ConversationState.from_dict(data.get("conversation_state"))
        execution_state = ExecutionState.from_dict(data.get("execution_state"))
        task_state = TaskState.from_dict(data.get("task_state"))
        scan_lines = str(data.get("scan_lines", "") or "")
        planner_items = list(data.get("planner_items", []))
        organize_mode = str(data.get("organize_mode", "initial") or "initial")
        incremental_selection = dict(data.get("incremental_selection", {}))
        stage = data.get("stage", STAGE_DRAFT)
        stage_text = str(stage or STAGE_DRAFT).strip()
        is_incremental = organize_mode.strip().lower() == "incremental"
        raw_source_scan_completed = incremental_selection.get("source_scan_completed")
        source_scan_completed = raw_source_scan_completed is True or str(raw_source_scan_completed).strip().lower() == "true"
        selection_status = str(incremental_selection.get("status") or "").strip()
        is_incremental_discovery = is_incremental and (
            stage_text == STAGE_SELECTING_INCREMENTAL_SCOPE
            or (not source_scan_completed and selection_status in {"pending", "scanning"})
        )
        can_derive_source_items = bool(scan_lines) and (
            not is_incremental or source_scan_completed or not is_incremental_discovery
        )
        if can_derive_source_items and not planner_items:
            planner_items = build_planner_items_from_scan_lines(scan_lines)
        if task_state is not None and not task_state.sources and planner_items and not is_incremental_discovery:
            task_state.sources = source_refs_from_planner_items(
                planner_items,
                default_origin=str(Path(str(data.get("target_dir") or "")).resolve()),
            )
        organize_method = str(data.get("organize_method") or "").strip()
        if not organize_method:
            organize_method = organize_method_for_organize_mode(organize_mode)
        else:
            organize_method = _normalize_organize_method(organize_method)
        return cls(
            planning_schema_version=int(data.get("planning_schema_version", 1) or 1),
            session_id=data["session_id"],
            target_dir=data["target_dir"],
            placement=PlacementPayload.from_dict(data.get("placement")),
            source_collection=[
                item
                for item in (
                    SourceCollectionItem.from_dict(entry)
                    for entry in data.get("source_collection", [])
                )
                if item is not None
            ],
            organize_method=organize_method,
            unattended=bool(data.get("unattended", False)),
            output_dir=str(data.get("output_dir") or ""),
            target_profile_id=str(data.get("target_profile_id") or ""),
            selected_target_directories=[
                str(item).strip()
                for item in data.get("selected_target_directories", [])
                if str(item).strip()
            ],
            selected_target_directory_details=[
                item
                for item in (
                    TargetProfileDirectory.from_dict(entry)
                    for entry in data.get("selected_target_directory_details", [])
                )
                if item is not None
            ],
            stage=stage,
            strategy_template_id=data.get("strategy_template_id", DEFAULT_TEMPLATE_ID),
            strategy_template_label=data.get("strategy_template_label", "通用整理"),
            organize_mode=organize_mode,
            destination_index_depth=int(data.get("destination_index_depth", 2) or 2),
            language=data.get("language", DEFAULT_LANGUAGE),
            density=data.get("density", DEFAULT_DENSITY),
            prefix_style=data.get("prefix_style", DEFAULT_PREFIX_STYLE),
            caution_level=data.get("caution_level", DEFAULT_CAUTION_LEVEL),
            strategy_note=data.get("strategy_note", ""),
            messages=list(data.get("messages", conversation_state.messages if conversation_state else [])),
            scan_lines=scan_lines,
            planner_items=planner_items,
            inspection_context=dict(data.get("inspection_context", {})),
            source_tree_entries=list(data.get("source_tree_entries", [])),
            pending_plan=PendingPlanPayload.from_dict(data.get("pending_plan")),
            plan_snapshot=PlanSnapshotPayload.from_dict(data.get("plan_snapshot")),
            user_constraints=list(data.get("user_constraints", [])),
            scanner_progress=dict(data.get("scanner_progress", conversation_state.scanner_progress if conversation_state else {})),
            planner_progress=dict(data.get("planner_progress", conversation_state.planner_progress if conversation_state else {})),
            incremental_selection=incremental_selection,
            assistant_message=data.get("assistant_message", conversation_state.assistant_message if conversation_state else None),
            precheck_summary=data.get("precheck_summary", execution_state.precheck_summary if execution_state else None),
            execution_report=data.get("execution_report", execution_state.execution_report if execution_state else None),
            rollback_report=data.get("rollback_report", execution_state.rollback_report if execution_state else None),
            last_journal_id=data.get("last_journal_id", execution_state.last_journal_id if execution_state else None),
            integrity_flags=dict(data.get("integrity_flags", {})),
            created_at=data.get("created_at", utc_now_iso()),
            updated_at=data.get("updated_at", utc_now_iso()),
            stale_reason=data.get("stale_reason"),
            last_error=data.get("last_error"),
            last_ai_pending_plan=AIPendingBaseline.from_dict(data.get("last_ai_pending_plan")),
            summary=data.get("summary", ""),
            id_registry_state=IdRegistryState.from_dict(data.get("id_registry_state")),
            task_state=task_state,
            conversation_state=conversation_state,
            execution_state=execution_state,
        )


@dataclass
class CreateSessionResult:
    mode: str
    session: OrganizerSession | None = None
    restorable_session: OrganizerSession | None = None


@dataclass
class SessionMutationResult:
    session_snapshot: dict
    assistant_message: dict | None = None
    changed: bool = True
    warnings: list[str] = field(default_factory=list)
    rollback_precheck: dict | None = None
