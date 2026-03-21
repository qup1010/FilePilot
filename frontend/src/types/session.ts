export type SessionStage =
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

export interface RecentAnalysisItem {
  item_id: string;
  display_name: string;
  source_relpath: string;
  suggested_purpose: string;
  summary: string;
}

export interface ScannerProgress {
  status?: string;
  processed_count: number;
  total_count: number;
  current_item: string | null;
  recent_analysis_items: RecentAnalysisItem[];
}

export interface PlanItem {
  item_id: string;
  display_name: string;
  source_relpath: string;
  target_relpath: string | null;
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

export interface AssistantMessage {
  role: string;
  content: string;
}

export type IntegrityFlags = Record<string, unknown> & {
  notes?: string[];
};

export interface SessionSnapshot {
  session_id: string;
  target_dir: string;
  stage: SessionStage;
  summary: string;
  assistant_message: AssistantMessage | null;
  scanner_progress: ScannerProgress;
  plan_snapshot: PlanSnapshot;
  precheck_summary: PrecheckSummary | null;
  execution_report: ExecutionReport | null;
  rollback_report: RollbackReport | null;
  last_journal_id: string | null;
  integrity_flags: IntegrityFlags;
  available_actions: string[];
  updated_at: string;
  stale_reason?: string | null;
  last_error?: string | null;
}

export interface SessionEvent {
  event_type: string;
  session_id: string;
  stage: SessionStage;
  session_snapshot: SessionSnapshot;
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

export interface MessageResponse {
  session_id: string;
  assistant_message: AssistantMessage | null;
  session_snapshot: SessionSnapshot;
}

export interface UpdateItemRequest {
  item_id: string;
  target_dir?: string;
  move_to_review: boolean;
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
}

export interface RuntimeConfig {
  base_url?: string;
  started_at?: string;
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
        ? "整理已经执行完成，可查看 journal 或回退。"
        : stage === "ready_to_execute"
          ? "预检已通过，等待用户确认执行。"
          : stage === "scanning"
            ? "正在分析目录内容，并持续更新最近理解结果。"
            : "当前是桌面工作台骨架，后续会接入真实 session_snapshot。",
    assistant_message:
      stage === "planning"
        ? { role: "assistant", content: "已将发票归入 Docs，未确认的二进制文件保留在 Review。" }
        : null,
    scanner_progress: {
      status: stage === "scanning" ? "running" : "completed",
      processed_count: stage === "scanning" ? 12 : 24,
      total_count: 40,
      current_item: stage === "scanning" ? "project-notes.docx" : null,
      recent_analysis_items: [
        {
          item_id: "notes.md",
          display_name: "notes.md",
          source_relpath: "notes.md",
          suggested_purpose: "学习资料",
          summary: "内容像课程笔记，建议归到 Study。",
        },
        {
          item_id: "report.pdf",
          display_name: "report.pdf",
          source_relpath: "report.pdf",
          suggested_purpose: "工作文档",
          summary: "是项目汇报文档，适合放在 Docs。",
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
    updated_at: now,
    stale_reason: stage === "stale" ? "directory_changed" : null,
    last_error: null,
  };
}
