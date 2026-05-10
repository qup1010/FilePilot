import { describe, expect, it } from "vitest";

import type { SessionSnapshot, SessionStage } from "@/types/session";

import {
  buildWorkspaceRoute,
  getWorkspaceRouteForHistoryEntry,
  getWorkspaceRouteForSnapshot,
  getWorkspaceViewForStage,
  getWorkspaceViewForSnapshot,
  hasStablePlan,
} from "./workspace-routes";

function createSnapshot(stage: SessionStage, overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    session_id: "session-1",
    target_dir: "D:/incoming",
    stage,
    summary: "",
    strategy: {} as SessionSnapshot["strategy"],
    assistant_message: null,
    scanner_progress: {},
    planner_progress: {},
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
    updated_at: "2026-05-08T00:00:00Z",
    ...overrides,
  };
}

describe("workspace route helpers", () => {
  it("maps transient stages to the progress route", () => {
    expect(getWorkspaceViewForStage("draft")).toBe("progress");
    expect(getWorkspaceViewForStage("scanning")).toBe("progress");
    expect(getWorkspaceViewForStage("planning", false)).toBe("progress");
    expect(getWorkspaceViewForSnapshot(createSnapshot("planning"))).toBe("progress");
  });

  it("routes stable plans to the plan workspace", () => {
    const snapshot = createSnapshot("planning", {
      assistant_message: { id: "msg-1", role: "assistant", content: "方案已生成" },
    });

    expect(hasStablePlan(snapshot)).toBe(true);
    expect(getWorkspaceViewForSnapshot(snapshot)).toBe("plan");
    expect(getWorkspaceRouteForSnapshot(snapshot)).toBe("/workspace/plan?session_id=session-1&dir=D%3A%2Fincoming");
  });

  it("does not treat placeholder plan snapshots as stable plans", () => {
    const snapshot = createSnapshot("planning", {
      plan_snapshot: {
        summary: "",
        items: [{
          item_id: "F001",
          display_name: "example.pdf",
          source_relpath: "example.pdf",
          target_slot_id: "",
          mapping_status: "pending",
          status: "planned",
        }],
        groups: [{ directory: "", count: 1, items: [] }],
        target_slots: [{ slot_id: "root", display_name: "根目录", relpath: "", depth: 0, is_new: false }],
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
    });

    expect(hasStablePlan(snapshot)).toBe(false);
    expect(getWorkspaceRouteForSnapshot(snapshot)).toBe("/workspace/progress?session_id=session-1&dir=D%3A%2Fincoming");
  });

  it("routes later workflow states to review, result, or recovery pages", () => {
    expect(getWorkspaceViewForStage("ready_to_execute")).toBe("review");
    expect(getWorkspaceViewForStage("executing")).toBe("review");
    expect(getWorkspaceViewForStage("rolling_back")).toBe("review");
    expect(getWorkspaceViewForStage("completed")).toBe("result");
    expect(getWorkspaceViewForStage("interrupted")).toBe("recovery");
    expect(getWorkspaceViewForStage("stale")).toBe("recovery");
    expect(getWorkspaceViewForStage("abandoned")).toBe("recovery");
  });

  it("preserves supported query params when building routes", () => {
    expect(buildWorkspaceRoute("progress", {
      sessionId: "session-1",
      dir: "D:/incoming",
      readonly: true,
      autoScan: true,
    })).toBe("/workspace/progress?session_id=session-1&dir=D%3A%2Fincoming&readonly=1&auto_scan=1");
  });

  it("uses history item counts as the stable-plan signal", () => {
    expect(getWorkspaceRouteForHistoryEntry({
      sessionId: "session-1",
      targetDir: "D:/incoming",
      status: "planning",
      itemCount: 0,
    })).toBe("/workspace/progress?session_id=session-1&dir=D%3A%2Fincoming");

    expect(getWorkspaceRouteForHistoryEntry({
      sessionId: "session-2",
      targetDir: "D:/incoming",
      status: "ready_for_precheck",
      itemCount: 4,
      readonly: true,
    })).toBe("/workspace/plan?session_id=session-2&dir=D%3A%2Fincoming&readonly=1");
  });
});
