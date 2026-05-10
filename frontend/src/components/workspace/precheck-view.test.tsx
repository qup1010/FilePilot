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
});
