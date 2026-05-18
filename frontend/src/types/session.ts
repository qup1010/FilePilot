export type SessionStage =
  | "idle"
  | "draft"
  | "scanning"
  | "selecting_incremental_scope"
  | "planning"
  | "ready_for_precheck"
  | "ready_to_execute"
  | "executing"
  | "completed"
  | "rolling_back"
  | "abandoned"
  | "stale"
  | "interrupted";

export type StreamStatus = "connecting" | "connected" | "reconnecting" | "offline";
export type AssistantRuntimePhase = "scan" | "plan";
export type AssistantRuntimeMode = "waiting" | "tool" | "streaming";

export type StrategyTemplateId =
  | "general_downloads"
  | "project_workspace"
  | "study_materials"
  | "office_admin"
  | "personal_archive"
  | "media_assets";

export type StrategyLanguage = "zh" | "en";
export type StrategyDensity = "normal" | "minimal";
export type StrategyPrefixStyle = "none" | "numeric" | "category";
export type StrategyCautionLevel = "conservative" | "balanced";
export type OrganizeMode = "initial" | "incremental";
export type TaskType = "organize_full_directory" | "organize_into_existing";
export type OrganizeMethod = "categorize_into_new_structure" | "assign_into_existing_categories";
export type DestinationIndexDepth = 1 | 2 | 3;
export type DirectorySourceMode = "contents" | "atomic";

export interface SessionSourceSelection {
  source_type: "file" | "directory";
  path: string;
  directory_mode?: DirectorySourceMode;
}

export interface TargetProfileDirectory {
  path: string;
  label?: string;
  description?: string;
}

export interface TargetProfile {
  profile_id: string;
  name: string;
  directories: TargetProfileDirectory[];
  created_at: string;
  updated_at: string;
}

export interface SessionStrategySelection {
  template_id: StrategyTemplateId;
  organize_mode: OrganizeMode;
  task_type?: TaskType;
  organize_method?: OrganizeMethod;
  destination_index_depth: DestinationIndexDepth;
  language: StrategyLanguage;
  density: StrategyDensity;
  prefix_style: StrategyPrefixStyle;
  caution_level: StrategyCautionLevel;
  output_dir?: string;
  target_profile_id?: string;
  target_directory_details?: TargetProfileDirectory[];
  new_directory_root?: string;
  review_root?: string;
  note: string;
}

export interface SessionStrategySummary extends SessionStrategySelection {
  template_label: string;
  template_description?: string;
  task_type: TaskType;
  task_type_label: string;
  organize_method: OrganizeMethod;
  organize_mode_label: string;
  language_label: string;
  density_label: string;
  prefix_style_label: string;
  caution_level_label: string;
  target_directories?: string[];
  target_directory_details?: TargetProfileDirectory[];
  preview_directories?: string[];
}

export interface LaunchStrategyConfig {
  LAUNCH_DEFAULT_ORGANIZE_METHOD?: OrganizeMethod;
  LAUNCH_DEFAULT_TARGET_PROFILE_ID?: string;
  LAUNCH_DEFAULT_TEMPLATE_ID?: StrategyTemplateId;
  LAUNCH_DEFAULT_LANGUAGE?: StrategyLanguage;
  LAUNCH_DEFAULT_DENSITY?: StrategyDensity;
  LAUNCH_DEFAULT_PREFIX_STYLE?: StrategyPrefixStyle;
  LAUNCH_DEFAULT_CAUTION_LEVEL?: StrategyCautionLevel;
  LAUNCH_DEFAULT_NOTE?: string;
  LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT?: string;
  LAUNCH_DEFAULT_REVIEW_ROOT?: string;
  LAUNCH_REVIEW_FOLLOWS_NEW_ROOT?: boolean;
  LAUNCH_SKIP_STRATEGY_PROMPT?: boolean;
}

export interface RecentAnalysisItem {
  item_id: string;
  display_name: string;
  source_relpath: string;
  entry_type?: string;
  suggested_purpose: string;
  summary: string;
}

export interface ScannerProgress {
  status?: string;
  processed_count?: number;
  total_count?: number;
  current_item?: string | null;
  recent_analysis_items?: RecentAnalysisItem[];
  batch_count?: number;
  completed_batches?: number;
  message?: string;
  is_retrying?: boolean;
  retry_kind?: string | null;
  retry_attempt?: number;
  retry_max_attempts?: number;
  ai_thinking?: boolean;
}

export type PlannerProgressStatus = "idle" | "running" | "completed" | "failed" | string;
export type PlannerProgressPhase =
  | "waiting_model"
  | "streaming_reply"
  | "validating"
  | "retrying"
  | "repairing"
  | "applying"
  | null
  | string;

export interface PlannerProgress {
  status?: PlannerProgressStatus;
  phase?: PlannerProgressPhase;
  message?: string;
  detail?: string | null;
  attempt?: number;
  started_at?: string | null;
  updated_at?: string | null;
  last_completed_at?: string | null;
  preserving_previous_plan?: boolean;
}

export interface PlanItem {
  item_id: string;
  display_name: string;
  source_relpath: string;
  target_slot_id: string;
  entry_type?: string;
  suggested_purpose?: string;
  content_summary?: string;
  reason?: string;
  confidence?: number | null;
  mapping_status: string;
  status: "planned" | "unresolved" | "review" | "invalidated" | string;
}

export interface PlanTargetSlot {
  slot_id: string;
  display_name: string;
  relpath: string;
  depth: number;
  is_new: boolean;
  real_path?: string;
}

export interface PlacementConfig {
  new_directory_root: string;
  review_root: string;
}

export interface PlanMappingEntry {
  item_id: string;
  source_ref_id: string;
  target_slot_id: string;
  status: string;
  reason?: string;
  confidence?: number | null;
  user_overridden?: boolean;
}

export interface SourceTreeEntry {
  source_relpath: string;
  display_name: string;
  entry_type: "file" | "directory" | string;
  source_mode?: DirectorySourceMode | string;
}

export interface TargetDirectoryNode {
  relpath: string;
  name: string;
  children: TargetDirectoryNode[];
}

export interface IncrementalSelectionSnapshot {
  required: boolean;
  status: "pending" | "scanning" | "ready" | string;
  destination_index_depth: DestinationIndexDepth;
  root_directory_options: string[];
  target_directories: string[];
  target_directory_tree: TargetDirectoryNode[];
  pending_items_count: number;
  source_scan_completed: boolean;
}

export interface PlanGroup {
  directory: string;
  count: number;
  items: PlanItem[];
}

export interface PlanSnapshot {
  summary: string;
  items: PlanItem[];
  groups: PlanGroup[];
  placement?: PlacementConfig;
  target_slots: PlanTargetSlot[];
  mappings: PlanMappingEntry[];
  display_plan?: any;
  unresolved_items: string[];
  review_items: PlanItem[];
  invalidated_items: PlanItem[];
  change_highlights: string[];
  stats: {
    directory_count: number;
    move_count: number;
    unresolved_count: number;
  };
  readiness: {
    can_precheck: boolean;
  };
}

export interface PrecheckMovePreview {
  item_id: string;
  source: string;
  target: string;
}

export interface PrecheckIssue {
  id: string;
  severity: "blocking" | "warning" | "review";
  issue_type: string;
  message: string;
  related_item_ids: string[];
}

export interface PrecheckSummary {
  can_execute: boolean;
  blocking_errors: string[];
  warnings: string[];
  mkdir_preview: string[];
  move_preview: PrecheckMovePreview[];
  issues: PrecheckIssue[];
}

export interface ExecutionReport {
  execution_id: string | null;
  journal_id: string | null;
  success_count: number;
  failure_count: number;
  status: "success" | "partial_failure" | "aborted" | string;
  has_cleanup_candidates: boolean;
  cleanup_candidate_count: number;
}

export interface RollbackReport {
  journal_id: string;
  restored_from_execution_id: string;
  success_count: number;
  failure_count: number;
  status: "success" | "partial_failure" | "aborted" | string;
}

export interface AssistantMessage {
  id: string;
  role: string;
  content: string;
  blocks?: Array<Record<string, unknown>>;
  visibility?: "public" | "internal" | string;
}

export interface ActivityFeedEntry {
  id: string;
  phase: "scan" | "plan" | "execution" | "rollback" | "system";
  message: string;
  time: string;
  important?: boolean;
}

export interface AssistantRuntimeStatus {
  phase: AssistantRuntimePhase;
  mode: AssistantRuntimeMode;
  label: string;
  detail?: string;
}

export type ComposerMode = "hidden" | "readonly" | "editable";

export type IntegrityFlags = Record<string, unknown> & {
  notes?: string[];
};

export interface SessionSnapshot {
  session_id: string;
  target_dir: string;
  session_title?: string;
  placement?: PlacementConfig;
  stage: SessionStage;
  summary: string;
  strategy: SessionStrategySummary;
  assistant_message: AssistantMessage | null;
  scanner_progress: ScannerProgress;
  planner_progress: PlannerProgress;
  plan_snapshot: PlanSnapshot;
  source_tree_entries?: SourceTreeEntry[];
  incremental_selection?: IncrementalSelectionSnapshot;
  precheck_summary: PrecheckSummary | null;
  execution_report: ExecutionReport | null;
  rollback_report: RollbackReport | null;
  last_journal_id: string | null;
  integrity_flags: IntegrityFlags;
  available_actions: string[];
  messages: AssistantMessage[];
  updated_at: string;
  stale_reason?: string | null;
  last_error?: string | null;
}

export interface SessionEvent {
  event_type: string;
  session_id: string;
  stage: SessionStage;
  session_snapshot?: SessionSnapshot;
  content?: string;
  action?: Record<string, any>;
}

export interface CreateSessionResponse {
  mode: "created" | "resume_available";
  session_id: string | null;
  restorable_session: SessionSnapshot | null;
  session_snapshot: SessionSnapshot | null;
}

export interface ScanAcceptedResponse {
  session_id: string;
  session_snapshot: SessionSnapshot;
}

export interface GetSessionResponse {
  session_id: string;
  session_snapshot: SessionSnapshot;
}

export interface ResumeSessionResponse {
  session_id: string;
  session_snapshot: SessionSnapshot;
}

export interface MessageResponse {
  session_id: string;
  assistant_message: AssistantMessage | null;
  session_snapshot: SessionSnapshot;
}

export interface CreateSessionRequest {
  sources: SessionSourceSelection[];
  resume_if_exists?: boolean;
  organize_method: OrganizeMethod;
  strategy?: SessionStrategySelection;
  output_dir?: string;
  target_profile_id?: string;
  target_directories?: string[];
  target_directory_details?: TargetProfileDirectory[];
  new_directory_root?: string;
  review_root?: string;
}

export interface ConfirmTargetsRequest {
  selected_target_dirs: string[];
}

export interface ConfirmTargetsResponse {
  session_id: string;
  assistant_message: AssistantMessage | null;
  session_snapshot: SessionSnapshot;
}

export interface HistoryItem {
  execution_id: string;
  target_dir: string;
  status: string;
  created_at: string;
  item_count: number;
  failure_count?: number;
  is_session?: boolean;
}

export interface UpdateItemRequest {
  item_id: string;
  target_dir?: string;
  target_slot?: string;
  move_to_review?: boolean;
}

export interface PrecheckResponse {
  session_id: string;
  session_snapshot: SessionSnapshot;
}

export interface ExecuteResponse {
  session_id: string;
  session_snapshot: SessionSnapshot;
}

export interface CleanupResponse {
  session_id: string;
  cleaned_count: number;
  session_snapshot: SessionSnapshot;
}

export interface RollbackPrecheckAction {
  type: string;
  display_name: string;
  source: string;
  target: string;
}

export interface RollbackPrecheckSummary {
  can_execute: boolean;
  blocking_errors: string[];
  actions: RollbackPrecheckAction[];
}

export interface RollbackResponse {
  session_id: string;
  session_snapshot: SessionSnapshot;
  rollback_precheck?: RollbackPrecheckSummary;
}

export interface JournalSummary {
  journal_id: string;
  execution_id: string;
  target_dir: string;
  status: string;
  created_at: string;
  item_count: number;
  success_count: number;
  failure_count: number;
  rollback_attempt_count: number;
  restore_items?: {
    action_type: string;
    status: string;
    source: string | null;
    target: string | null;
    display_name: string;
    item_id?: string | null;
    source_ref_id?: string | null;
    target_slot_id?: string | null;
  }[];
  items?: {
    action_type: string;
    status: string;
    source: string | null;
    target: string | null;
    display_name: string;
    item_id?: string | null;
    source_ref_id?: string | null;
    target_slot_id?: string | null;
  }[];
}

export interface RuntimeConfig {
  base_url?: string;
  started_at?: string;
  api_token?: string;
}
