import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/lib/api";
import type { RollbackPrecheckSummary, SessionEvent, SessionSnapshot } from "@/types/session";

import { useSession } from "./use-session";

const getSession = vi.fn();
const rollback = vi.fn();
const streamClose = vi.fn();
let latestStreamOptions:
  | {
      onEvent: (event: SessionEvent) => void;
      onError?: (error: Event) => void;
    }
  | null = null;

vi.mock("@/lib/runtime", () => ({
  getApiBaseUrl: () => "http://127.0.0.1:8765",
  getApiToken: () => "",
  isTauriDesktop: () => false,
  waitForRuntimeConfig: vi.fn().mockResolvedValue({ base_url: "http://127.0.0.1:8765", api_token: "" }),
}));

vi.mock("@/lib/api", () => ({
  createApiClient: () =>
    ({
      getSession,
      resumeSession: vi.fn(),
      abandonSession: vi.fn(),
      scanSession: vi.fn(),
      refreshSession: vi.fn(),
      confirmTargetDirectories: vi.fn(),
      sendMessage: vi.fn(),
      updateItem: vi.fn(),
      runPrecheck: vi.fn(),
      returnToPlanning: vi.fn(),
      execute: vi.fn(),
      cleanupEmptyDirs: vi.fn(),
      rollback,
      getJournal: vi.fn(),
      openDir: vi.fn(),
    }) satisfies Partial<ApiClient>,
}));

vi.mock("@/lib/sse", () => ({
  createSessionEventStream: (options: {
    onEvent: (event: SessionEvent) => void;
    onError?: (error: Event) => void;
  }) => {
    latestStreamOptions = options;
    return {
      close: streamClose,
    };
  },
}));

function createSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    session_id: "session-1",
    target_dir: "C:/demo",
    stage: "planning",
    summary: "",
    strategy: {
      template_id: "general_downloads",
      template_label: "默认",
      template_description: "",
      task_type: "organize_full_directory",
      task_type_label: "整理整个目录",
      organize_method: "categorize_into_new_structure",
      organize_mode: "initial",
      organize_mode_label: "整理整个目录",
      destination_index_depth: 2,
      language: "zh",
      language_label: "中文",
      density: "normal",
      density_label: "标准",
      prefix_style: "none",
      prefix_style_label: "无前缀",
      caution_level: "balanced",
      caution_level_label: "平衡",
      note: "",
      preview_directories: [],
    },
    assistant_message: null,
    scanner_progress: {},
    planner_progress: {},
    incremental_selection: {
      required: false,
      status: "pending",
      destination_index_depth: 2,
      root_directory_options: [],
      target_directories: [],
      target_directory_tree: [],
      pending_items_count: 0,
      source_scan_completed: false,
    },
    plan_snapshot: {
      summary: "",
      items: [],
      groups: [],
      target_slots: [],
      mappings: [],
      unresolved_items: [],
      review_items: [],
      invalidated_items: [],
      change_highlights: [],
      stats: {
        directory_count: 0,
        move_count: 0,
        unresolved_count: 0,
      },
      readiness: {
        can_precheck: false,
      },
    },
    precheck_summary: null,
    execution_report: null,
    rollback_report: null,
    last_journal_id: null,
    integrity_flags: {},
    available_actions: [],
    messages: [],
    updated_at: "2026-04-18T00:00:00Z",
    ...overrides,
  };
}

function createEvent(event_type: string, overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    event_type,
    session_id: "session-1",
    stage: "planning",
    ...overrides,
  };
}

describe("useSession assistant draft", () => {
  beforeEach(() => {
    getSession.mockReset();
    rollback.mockReset();
    streamClose.mockReset();
    latestStreamOptions = null;
    getSession.mockResolvedValue({
      session_id: "session-1",
      session_snapshot: createSnapshot(),
    });
  });

  it("keeps assistantDraft when a normal snapshot event arrives during plan streaming", async () => {
    const { result } = renderHook(() => useSession("session-1"));

    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith("session-1");
      expect(latestStreamOptions).not.toBeNull();
    });

    act(() => {
      latestStreamOptions?.onEvent(
        createEvent("plan.ai_typing", {
          content: "第一段草稿",
          session_snapshot: createSnapshot(),
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.assistantDraft).toBe("第一段草稿");
    });

    act(() => {
      latestStreamOptions?.onEvent(
        createEvent("scan.progress", {
          session_snapshot: createSnapshot({
            planner_progress: {
              status: "running",
              phase: "streaming_reply",
              message: "仍在整理",
            },
          }),
        }),
      );
    });

    expect(result.current.assistantDraft).toBe("第一段草稿");
  });

  it("clears assistantDraft when plan.updated arrives with the final snapshot", async () => {
    const { result } = renderHook(() => useSession("session-1"));

    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith("session-1");
      expect(latestStreamOptions).not.toBeNull();
    });

    act(() => {
      latestStreamOptions?.onEvent(
        createEvent("plan.ai_typing", {
          content: "即将完成",
          session_snapshot: createSnapshot(),
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.assistantDraft).toBe("即将完成");
    });

    act(() => {
      latestStreamOptions?.onEvent(
        createEvent("plan.updated", {
          session_snapshot: createSnapshot({
            messages: [{ id: "assistant-1", role: "assistant", content: "最终答复" }],
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.assistantDraft).toBe("");
    });
  });

  it("shows a local fallback reply when plan updated after tool-only model output", async () => {
    const { result } = renderHook(() => useSession("session-1"));

    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith("session-1");
      expect(latestStreamOptions).not.toBeNull();
    });

    act(() => {
      latestStreamOptions?.onEvent(
        createEvent("plan.action", {
          action: { name: "submit_plan_diff" },
          session_snapshot: createSnapshot(),
        }),
      );
    });

    act(() => {
      latestStreamOptions?.onEvent(
        createEvent("plan.updated", {
          session_snapshot: createSnapshot({ messages: [] }),
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.assistantDraft).toBe("我已经更新了整理计划，请您查看。");
    });
  });

  it("shows the fallback reply from a ready plan snapshot without assistant text", async () => {
    const baseSnapshot = createSnapshot();
    getSession.mockResolvedValue({
      session_id: "session-1",
      session_snapshot: createSnapshot({
        stage: "ready_for_precheck",
        messages: [],
        plan_snapshot: {
          ...baseSnapshot.plan_snapshot,
          items: [
            {
              item_id: "F001",
              display_name: "demo.png",
              source_relpath: "demo.png",
              target_slot_id: "T001",
              suggested_purpose: "图片素材",
              mapping_status: "planned",
              status: "planned",
            },
          ],
          target_slots: [
            {
              slot_id: "T001",
              display_name: "素材",
              relpath: "素材",
              depth: 1,
              is_new: true,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 1,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: true,
          },
        },
      }),
    });

    const { result } = renderHook(() => useSession("session-1"));

    await waitFor(() => {
      expect(result.current.chatMessages).toEqual([
        expect.objectContaining({
          role: "assistant",
          content: "我已经更新了整理计划，请您查看。",
        }),
      ]);
    });
  });

  it("renders assistant_message from the session snapshot", async () => {
    getSession.mockResolvedValue({
      session_id: "session-1",
      session_snapshot: createSnapshot({
        messages: [],
        assistant_message: {
          id: "assistant-current",
          role: "assistant",
          content: "这是后端快照中的当前回复",
        },
      }),
    });

    const { result } = renderHook(() => useSession("session-1"));

    await waitFor(() => {
      expect(result.current.chatMessages).toEqual([
        expect.objectContaining({
          id: "assistant-current",
          content: "这是后端快照中的当前回复",
        }),
      ]);
    });
  });

  it("deduplicates assistant_message when the stored history already contains the same reply with a different id", async () => {
    getSession.mockResolvedValue({
      session_id: "session-1",
      session_snapshot: createSnapshot({
        messages: [
          {
            id: "assistant-history",
            role: "assistant",
            content: "1+1 等于 2。",
          },
        ],
        assistant_message: {
          id: "assistant-current",
          role: "assistant",
          content: "1+1 等于 2。",
        },
      }),
    });

    const { result } = renderHook(() => useSession("session-1"));

    await waitFor(() => {
      expect(result.current.chatMessages).toEqual([
        expect.objectContaining({
          id: "assistant-current",
          content: "1+1 等于 2。",
        }),
      ]);
    });
  });

  it("collapses adjacent duplicate assistant replies from the same snapshot", async () => {
    getSession.mockResolvedValue({
      session_id: "session-1",
      session_snapshot: createSnapshot({
        messages: [
          {
            id: "assistant-first",
            role: "assistant",
            content: "方案已更新，请查看右侧预览。",
          },
          {
            id: "assistant-second",
            role: "assistant",
            content: "方案已更新，请查看右侧预览。",
          },
        ],
      }),
    });

    const { result } = renderHook(() => useSession("session-1"));

    await waitFor(() => {
      expect(result.current.chatMessages).toEqual([
        expect.objectContaining({
          id: "assistant-second",
          content: "方案已更新，请查看右侧预览。",
        }),
      ]);
    });
  });

  it("does not show the local fallback for unrelated plan updates", async () => {
    const { result } = renderHook(() => useSession("session-1"));

    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith("session-1");
      expect(latestStreamOptions).not.toBeNull();
    });

    act(() => {
      latestStreamOptions?.onEvent(
        createEvent("plan.updated", {
          session_snapshot: createSnapshot({ messages: [] }),
        }),
      );
    });

    expect(result.current.assistantDraft).toBe("");
  });

  it("clears stale chatError after the session returns to planning", async () => {
    const { result } = renderHook(() => useSession("session-1"));

    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith("session-1");
      expect(latestStreamOptions).not.toBeNull();
    });

    act(() => {
      latestStreamOptions?.onEvent(
        createEvent("session.interrupted", {
          stage: "interrupted",
          session_snapshot: createSnapshot({
            stage: "interrupted",
            last_error: "scanning_interrupted",
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.chatError).toBe("扫描过程中已中断，请重新扫描后再继续。");
    });

    act(() => {
      latestStreamOptions?.onEvent(
        createEvent("scan.completed", {
          stage: "planning",
          session_snapshot: createSnapshot({
            stage: "planning",
            last_error: null,
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.chatError).toBeNull();
      expect(result.current.chatErrorCode).toBeNull();
    });
  });

  it("requests rollback precheck without confirming execution", async () => {
    const precheck: RollbackPrecheckSummary = {
      can_execute: true,
      blocking_errors: [],
      actions: [],
    };
    rollback.mockResolvedValueOnce({
      session_id: "session-1",
      session_snapshot: createSnapshot({ stage: "completed" }),
      rollback_precheck: precheck,
    });
    const { result } = renderHook(() => useSession("session-1"));

    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith("session-1");
    });

    let received: RollbackPrecheckSummary | null = null;
    await act(async () => {
      received = await result.current.prepareRollback();
    });

    expect(rollback).toHaveBeenCalledWith("session-1", false);
    expect(received).toEqual(precheck);
  });

  it("confirms rollback only after explicit confirmation", async () => {
    rollback.mockResolvedValueOnce({
      session_id: "session-1",
      session_snapshot: createSnapshot({ stage: "stale" }),
    });
    const { result } = renderHook(() => useSession("session-1"));

    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith("session-1");
    });

    await act(async () => {
      await result.current.confirmRollback();
    });

    expect(rollback).toHaveBeenCalledWith("session-1", true);
    expect(result.current.snapshot?.stage).toBe("stale");
  });
});
