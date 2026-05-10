import { afterEach, describe, expect, it, vi } from "vitest";

import type { HistoryItem } from "@/types/session";

import {
  clearActiveWorkspaceRouteForSession,
  getHistoryEntryHref,
  getHistoryEntryName,
  getHistoryEntryReadonlyHref,
  getHistoryEntrySummary,
  getHistoryDeletePrompt,
  isHistorySessionEntry,
} from "./use-history-list";

function createHistoryItem(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    execution_id: "entry-1",
    target_dir: "D:/incoming",
    status: "planning",
    created_at: "2026-04-21T00:00:00Z",
    is_session: true,
    item_count: 0,
    failure_count: 0,
    ...overrides,
  };
}

describe("use-history-list helpers", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("treats only unfinished records as session entries", () => {
    expect(isHistorySessionEntry(createHistoryItem({ status: "planning", is_session: true }))).toBe(true);
    expect(isHistorySessionEntry(createHistoryItem({ status: "completed", is_session: false }))).toBe(false);
    expect(isHistorySessionEntry(createHistoryItem({ status: "partial_failure", is_session: false }))).toBe(false);
    expect(isHistorySessionEntry(createHistoryItem({ status: "rolled_back", is_session: false }))).toBe(false);
    expect(isHistorySessionEntry(createHistoryItem({ status: "rollback_partial_failure", is_session: false }))).toBe(false);
  });

  it("builds workspace routes for sessions and history routes for execution records", () => {
    expect(getHistoryEntryHref(createHistoryItem({ execution_id: "session-1", status: "planning", is_session: true }))).toBe(
      "/workspace/progress?session_id=session-1&dir=D%3A%2Fincoming",
    );
    expect(getHistoryEntryReadonlyHref(createHistoryItem({ execution_id: "session-2", status: "planning", is_session: true }))).toBe(
      "/workspace/progress?session_id=session-2&dir=D%3A%2Fincoming&readonly=1",
    );
    expect(
      getHistoryEntryHref(createHistoryItem({ execution_id: "exec-1", status: "completed", is_session: false })),
    ).toBe("/history?entry_id=exec-1");
    expect(
      getHistoryEntryReadonlyHref(createHistoryItem({ execution_id: "exec-2", status: "rolled_back", is_session: false })),
    ).toBe("/history?entry_id=exec-2");
  });

  it("opens unfinished sessions with generated plans in the plan workspace", () => {
    expect(getHistoryEntryHref(createHistoryItem({
      execution_id: "session-ready",
      status: "ready_for_precheck",
      is_session: true,
      item_count: 8,
    }))).toBe("/workspace/plan?session_id=session-ready&dir=D%3A%2Fincoming");
  });

  it("returns normalized summaries for execution states", () => {
    expect(getHistoryEntrySummary(createHistoryItem({ status: "partial_failure", is_session: false }))).toBe("部分失败");
    expect(getHistoryEntrySummary(createHistoryItem({ status: "rollback_partial_failure", is_session: false }))).toBe(
      "回退部分失败",
    );
  });

  it("uses created time as the history entry name", () => {
    expect(getHistoryEntryName(createHistoryItem({ created_at: "2026-04-21T08:30:00+08:00" }))).toBe("2026/04/21 08:30");
  });

  it("uses explicit delete prompts for unfinished sessions and execution records", () => {
    expect(getHistoryDeletePrompt(createHistoryItem({ is_session: true, status: "planning" })).title).toBe("删除这个任务？");
    expect(getHistoryDeletePrompt(createHistoryItem({ is_session: false, status: "completed" })).title).toBe(
      "删除这条历史记录？",
    );
  });

  it("clears the active workspace route only for the deleted session", () => {
    const listener = vi.fn();
    window.addEventListener("file-pilot-context-change", listener);
    window.localStorage.setItem("workspace_active_route", "/workspace/plan?session_id=session-1");

    expect(clearActiveWorkspaceRouteForSession("other-session")).toBe(false);
    expect(window.localStorage.getItem("workspace_active_route")).toBe("/workspace/plan?session_id=session-1");
    expect(clearActiveWorkspaceRouteForSession("session-1")).toBe(true);

    expect(window.localStorage.getItem("workspace_active_route")).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("file-pilot-context-change", listener);
  });
});
