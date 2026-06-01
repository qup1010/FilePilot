import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrecheckView } from "./precheck-view";

vi.mock("./directory-tree-diff", () => ({
  DirectoryTreeDiff: ({ after }: { after: { leafEntries: { path: string }[] } }) => (
    <div>
      DirectoryTreeDiff
      {after.leafEntries.map((entry) => (
        <span key={entry.path}>{entry.path}</span>
      ))}
    </div>
  ),
}));

describe("PrecheckView", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders item metadata from plan items and target slots", () => {
    render(
      <PrecheckView
        summary={{
          can_execute: true,
          blocking_errors: [],
          warnings: [],
          mkdir_preview: [],
          move_preview: [
            {
              item_id: "F001",
              source: "D:/download/contract.pdf",
              target: "D:/download/Docs/contract.pdf",
            },
          ],
          issues: [],
        }}
        planItems={[
          {
            item_id: "F001",
            display_name: "contract.pdf",
            source_relpath: "contract.pdf",
            target_slot_id: "D001",
            status: "planned",
            mapping_status: "planned",
          },
        ]}
        targetSlots={[
          {
            slot_id: "D001",
            display_name: "合同",
            relpath: "Docs",
            depth: 1,
            is_new: false,
          },
        ]}
        isBusy={false}
        onRequestExecute={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getAllByText("contract.pdf").length).toBeGreaterThan(0);
    expect(screen.queryByText(/F001/)).not.toBeInTheDocument();
    expect(screen.getByText("合同")).toBeInTheDocument();
  });

  it("uses user-facing review labels instead of raw Review target paths", () => {
    render(
      <PrecheckView
        summary={{
          can_execute: true,
          blocking_errors: [],
          warnings: [],
          mkdir_preview: [],
          move_preview: [
            {
              item_id: "F001",
              source: "D:/download/unknown.pdf",
              target: "D:/download/Review/unknown.pdf",
            },
          ],
          issues: [],
        }}
        planItems={[
          {
            item_id: "F001",
            display_name: "unknown.pdf",
            source_relpath: "unknown.pdf",
            target_slot_id: "Review",
            status: "review",
            mapping_status: "review",
          },
        ]}
        targetSlots={[]}
        isBusy={false}
        onRequestExecute={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getAllByText(/待确认区/).length).toBeGreaterThan(0);
    expect(screen.queryByText("D:/download/Review/unknown.pdf")).not.toBeInTheDocument();
  });

  it("uses explicit review metadata without relying on Review path segments", () => {
    render(
      <PrecheckView
        summary={{
          can_execute: true,
          blocking_errors: [],
          warnings: [],
          mkdir_preview: [],
          move_preview: [
            {
              item_id: "F001",
              source: "D:/download/unknown.pdf",
              target: "D:/custom-review-root/unknown.pdf",
              target_slot_id: "D999",
              target_kind: "review",
              is_review: true,
            },
          ],
          issues: [],
        }}
        planItems={[
          {
            item_id: "F001",
            display_name: "unknown.pdf",
            source_relpath: "unknown.pdf",
            target_slot_id: "D999",
            status: "review",
            mapping_status: "review",
          },
        ]}
        targetSlots={[]}
        isBusy={false}
        onRequestExecute={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getAllByText(/待确认区/).length).toBeGreaterThan(0);
    expect(screen.queryByText("D:/custom-review-root/unknown.pdf")).not.toBeInTheDocument();
  });

  it("falls back to source file names instead of internal item ids", () => {
    render(
      <PrecheckView
        summary={{
          can_execute: true,
          blocking_errors: [],
          warnings: [],
          mkdir_preview: [],
          move_preview: [
            {
              item_id: "F001",
              source: "D:/download/report.pdf",
              target: "D:/archive/Docs/report.pdf",
            },
          ],
          issues: [],
        }}
        planItems={[]}
        targetSlots={[]}
        isBusy={false}
        onRequestExecute={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getAllByText("report.pdf").length).toBeGreaterThan(0);
    expect(screen.queryByText("F001")).not.toBeInTheDocument();
  });

  it("renders target conflict suggestions with suggested rename targets", () => {
    render(
      <PrecheckView
        summary={{
          can_execute: false,
          blocking_errors: ["计划内多个项目指向同一目标: Docs/report.pdf"],
          warnings: [],
          mkdir_preview: [],
          move_preview: [],
          target_conflict_suggestions: [
            {
              type: "target_name_conflict",
              target: "Docs/report.pdf",
              items: [
                {
                  item_id: "F001",
                  display_name: "report.pdf",
                  source: "alpha/report.pdf",
                  current_target: "Docs/report.pdf",
                  suggested_target: "Docs/report.pdf",
                },
                {
                  item_id: "F002",
                  display_name: "report.pdf",
                  source: "beta/report.pdf",
                  current_target: "Docs/report.pdf",
                  suggested_target: "Docs/report (2).pdf",
                },
              ],
            },
          ],
          issues: [],
        }}
        planItems={[]}
        targetSlots={[]}
        isBusy={false}
        onRequestExecute={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText("同名冲突建议")).toBeInTheDocument();
    expect(screen.getByText("Docs/report (2).pdf")).toBeInTheDocument();
  });

  it("renders existing-target suggestions with suggested rename targets", () => {
    render(
      <PrecheckView
        summary={{
          can_execute: false,
          blocking_errors: ["目标已存在: Docs/report.pdf"],
          warnings: [],
          mkdir_preview: [],
          move_preview: [],
          target_conflict_suggestions: [
            {
              type: "target_exists",
              target: "Docs/report.pdf",
              items: [
                {
                  item_id: "F001",
                  display_name: "report.pdf",
                  source: "alpha/report.pdf",
                  current_target: "Docs/report.pdf",
                  suggested_target: "Docs/report (2).pdf",
                },
              ],
            },
          ],
          issues: [],
        }}
        planItems={[]}
        targetSlots={[]}
        isBusy={false}
        onRequestExecute={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText("同名冲突建议")).toBeInTheDocument();
    expect(screen.getByText("目标已存在")).toBeInTheDocument();
    expect(screen.getByText("Docs/report (2).pdf")).toBeInTheDocument();
  });
});
