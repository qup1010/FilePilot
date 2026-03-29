export type SessionStage =
  | "idle"
  | "draft"
  | "scanning"
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
  | "conservative";

export type StrategyNamingStyle = "zh" | "en" | "minimal";

export type StrategyCautionLevel = "conservative" | "balanced";

export interface SessionStrategySelection {
  template_id: StrategyTemplateId;
  naming_style: StrategyNamingStyle;
  caution_level: StrategyCautionLevel;
  note: string;
}

export interface SessionStrategySummary extends SessionStrategySelection {
  template_label: string;
  template_description?: string;
  naming_style_label: string;
  caution_level_label: string;
  preview_directories?: string[];
}

export interface LaunchStrategyConfig {
  LAUNCH_DEFAULT_TEMPLATE_ID?: StrategyTemplateId;
  LAUNCH_DEFAULT_NAMING_STYLE?: StrategyNamingStyle;
  LAUNCH_DEFAULT_CAUTION_LEVEL?: StrategyCautionLevel;
  LAUNCH_DEFAULT_NOTE?: string;
  LAUNCH_SKIP_STRATEGY_PROMPT?: boolean;
}

export interface RecentAnalysisItem {
  item_id: string;
  display_name: string;
  source_relpath: string;
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
}

export interface PlanItem {
  item_id: string;
  display_name: string;
  source_relpath: string;
  target_relpath: string | null;
  suggested_purpose?: string;
  content_summary?: string;
  status: "planned" | "unresolved" | "review" | "invalidated" | string;
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
  source: string;
  target: string;
}

export interface PrecheckSummary {
  can_execute: boolean;
  blocking_errors: string[];
  warnings: string[];
  mkdir_preview: string[];
  move_preview: PrecheckMovePreview[];
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

export interface UnresolvedChoiceItem {
  item_id: string;
  display_name: string;
  question: string;
  suggested_folders: string[];
}

export interface UnresolvedChoiceResolution {
  item_id: string;
  display_name?: string;
  selected_folder: string;
  note: string;
}

export interface UnresolvedChoicesBlock {
  type: "unresolved_choices";
  request_id: string;
  summary: string;
  status?: "pending" | "submitted" | string;
  items: UnresolvedChoiceItem[];
  submitted_resolutions?: UnresolvedChoiceResolution[];
}

export type AssistantMessageBlock = UnresolvedChoicesBlock;

export interface AssistantMessage {
  id: string;
  role: string;
  content: string;
  blocks?: AssistantMessageBlock[];
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
  stage: SessionStage;
  summary: string;
  strategy: SessionStrategySummary;
  assistant_message: AssistantMessage | null;
  scanner_progress: ScannerProgress;
  plan_snapshot: PlanSnapshot;
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

export interface ResolveUnresolvedChoicesResponse {
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

export interface AppConfig {
  config: Record<string, any> & LaunchStrategyConfig;
  text_presets: { id: string; name: string }[];
  vision_presets: { id: string; name: string }[];
  active_text_preset_id: string;
  active_vision_preset_id: string;
}

export interface UpdateItemRequest {
  item_id: string;
  target_dir?: string;
  move_to_review?: boolean;
}

export interface ResolveUnresolvedChoicesRequest {
  request_id: string;
  resolutions: UnresolvedChoiceResolution[];
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

export interface RollbackResponse {
  session_id: string;
  session_snapshot: SessionSnapshot;
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
  }[];
  items?: {
    action_type: string;
    status: string;
    source: string | null;
    target: string | null;
    display_name: string;
  }[];
}

export interface RuntimeConfig {
  base_url?: string;
  started_at?: string;
  api_token?: string;
}

export function createDemoSessionSnapshot(stage: SessionStage): SessionSnapshot {
  const now = new Date().toISOString();
  const precheckSummary: PrecheckSummary = {
    can_execute: stage === "ready_to_execute" || stage === "completed",
    blocking_errors: stage === "planning" ? ["仍有 1 个待确认项未处理"] : [],
    warnings: stage === "completed" ? [] : ["建议先确认 Review 组中的异常文件"],
    mkdir_preview: ["Docs", "Review"],
    move_preview: [
      { source: "invoice-2026.pdf", target: "Docs/invoice-2026.pdf" },
      { source: "weird-asset.bin", target: "Review/weird-asset.bin" },
    ],
  };

  const items: PlanItem[] = [
    {
      item_id: "invoice-2026.pdf",
      display_name: "invoice-2026.pdf",
      source_relpath: "invoice-2026.pdf",
      target_relpath: "Docs/invoice-2026.pdf",
      status: "planned",
    },
    {
      item_id: "weird-asset.bin",
      display_name: "weird-asset.bin",
      source_relpath: "weird-asset.bin",
      target_relpath: "Review/weird-asset.bin",
      status: stage === "planning" ? "unresolved" : "review",
    },
  ];

  return {
    session_id: `demo-${stage}`,
    target_dir: "D:/Downloads",
    stage,
    summary:
      stage === "completed"
        ? "整理已完成，可查看执行记录或执行回退。"
        : stage === "ready_to_execute"
          ? "预检已通过，等待确认执行。"
          : stage === "scanning"
            ? "正在分析目录内容，并持续更新最近的扫描结果。"
        : "当前为工作台示例数据，后续会接入真实 session_snapshot。",
    strategy: {
      template_id: "general_downloads",
      template_label: "通用下载",
      template_description: "适合混合下载目录、桌面暂存区等场景。",
      naming_style: "zh",
      naming_style_label: "中文目录",
      caution_level: "balanced",
      caution_level_label: "平衡",
      note: "",
      preview_directories: ["项目资料", "学习资料", "财务票据", "待确认"],
    },
    assistant_message:
      stage === "planning"
        ? { id: "msg-demo-assistant", role: "assistant", content: "已将发票归入 Docs，未确认的二进制文件保留在 Review。" }
        : null,
    scanner_progress: {
      status: stage === "scanning" ? "running" : "completed",
      processed_count: stage === "scanning" ? 12 : 24,
      total_count: 40,
      current_item: stage === "scanning" ? "project-notes.docx" : null,
      batch_count: stage === "scanning" ? 3 : undefined,
      completed_batches: stage === "scanning" ? 1 : undefined,
      message: stage === "scanning" ? "文件较多，已拆分为 3 个批次并行扫描" : undefined,
      recent_analysis_items: [
        {
          item_id: "notes.md",
          display_name: "notes.md",
          source_relpath: "notes.md",
          suggested_purpose: "学习资料",
          summary: "内容接近课程笔记，建议归到 Study。",
        },
        {
          item_id: "report.pdf",
          display_name: "report.pdf",
          source_relpath: "report.pdf",
          suggested_purpose: "工作文档",
          summary: "属于项目汇报文档，适合放在 Docs。",
        },
      ],
    },
    plan_snapshot: {
      summary: "2 个文件已归组，1 个条目仍待确认。",
      items,
      groups: [
        {
          directory: "Docs",
          count: 1,
          items: [items[0]],
        },
        {
          directory: "Review",
          count: 1,
          items: [items[1]],
        },
      ],
      unresolved_items: stage === "planning" ? ["weird-asset.bin"] : [],
      review_items: [items[1]],
      invalidated_items:
        stage === "stale"
          ? [
              {
                item_id: "missing-contract.pdf",
                display_name: "missing-contract.pdf",
                source_relpath: "missing-contract.pdf",
                target_relpath: "Docs/missing-contract.pdf",
                status: "invalidated",
              },
            ]
          : [],
      change_highlights: ["新增 Docs 目录", "将 weird-asset.bin 归入 Review"],
      stats: {
        directory_count: 2,
        move_count: 2,
        unresolved_count: stage === "planning" ? 1 : 0,
      },
      readiness: {
        can_precheck: stage !== "planning",
      },
    },
    precheck_summary: stage === "planning" ? null : precheckSummary,
    execution_report:
      stage === "completed"
        ? {
            execution_id: "exec-demo-001",
            journal_id: "exec-demo-001",
            success_count: 2,
            failure_count: 0,
            status: "success",
            has_cleanup_candidates: false,
            cleanup_candidate_count: 0,
          }
        : null,
    rollback_report:
      stage === "stale"
        ? {
            journal_id: "exec-demo-001",
            restored_from_execution_id: "exec-demo-001",
            success_count: 2,
            failure_count: 0,
            status: "success",
          }
        : null,
    last_journal_id: stage === "completed" || stage === "stale" ? "exec-demo-001" : null,
    integrity_flags: {
      is_stale: stage === "stale",
      has_invalidated_items: stage === "stale",
      notes: stage === "stale" ? ["有 1 个历史分类失效，需要重新确认。"] : ["当前为 mock 数据。"],
    },
    available_actions:
      stage === "completed"
        ? ["rollback", "view_journal", "cleanup_empty_dirs"]
        : stage === "ready_to_execute"
          ? ["execute", "abandon", "view_journal"]
          : ["submit_intent", "update_item", "precheck", "abandon"],
    messages: [
      { id: "msg-demo-welcome", role: "assistant", content: "初步扫描已完成，当前已生成第一版整理建议。" }
    ],
    updated_at: now,
    stale_reason: stage === "stale" ? "directory_changed" : null,
    last_error: null,
  };
}
