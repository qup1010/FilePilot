import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompletionView } from "./completion-view";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("./directory-tree-diff", () => ({
  DirectoryTreeDiff: () => <div>DirectoryTreeDiff</div>,
}));

vi.mock("./markdown-prose", () => ({
  MarkdownProse: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: () => null,
}));

describe("CompletionView", () => {
  afterEach(() => {
    cleanup();
    pushMock.mockReset();
  });

  it("shows review items in the completion summary", () => {
    render(
      <CompletionView
        journal={{
          journal_id: "j1",
          execution_id: "e1",
          target_dir: "D:/download",
          status: "completed",
          created_at: "2026-04-20T00:00:00Z",
          item_count: 1,
          success_count: 1,
          failure_count: 0,
          rollback_attempt_count: 0,
          items: [
            {
              action_type: "MOVE",
              status: "success",
              source: "D:/download/contract.pdf",
              target: "D:/download/Review/contract.pdf",
              display_name: "contract.pdf",
              item_id: "F001",
              target_slot_id: "Review",
            },
          ],
        }}
        summary="done"
        loading={false}
        targetDir="D:/download"
        organizeMethod="categorize_into_new_structure"
        isBusy={false}
        onOpenExplorer={() => {}}
        onCleanupDirs={() => {}}
        onRollback={() => {}}
        onGoHome={() => {}}
      />,
    );

    expect(screen.getAllByText("待确认区").length).toBeGreaterThan(0);
    expect(screen.getAllByText("contract.pdf").length).toBeGreaterThan(0);
  });

  it("uses explicit review metadata even when the target path does not contain Review", () => {
    render(
      <CompletionView
        journal={{
          journal_id: "j1",
          execution_id: "e1",
          target_dir: "D:/download",
          status: "completed",
          created_at: "2026-04-20T00:00:00Z",
          item_count: 1,
          success_count: 1,
          failure_count: 0,
          rollback_attempt_count: 0,
          items: [
            {
              action_type: "MOVE",
              status: "success",
              source: "D:/download/contract.pdf",
              target: "D:/download/pending/contract.pdf",
              display_name: "contract.pdf",
              item_id: "F001",
              target_slot_id: "D999",
              target_kind: "review",
              is_review: true,
            },
          ],
        }}
        summary="done"
        loading={false}
        targetDir="D:/download"
        organizeMethod="categorize_into_new_structure"
        isBusy={false}
        onOpenExplorer={() => {}}
        onCleanupDirs={() => {}}
        onRollback={() => {}}
        onGoHome={() => {}}
      />,
    );

    expect(screen.getAllByText("待确认区").length).toBeGreaterThan(0);
    expect(screen.getByText("待确认 (1)")).toBeInTheDocument();
    expect(screen.getAllByText("contract.pdf").length).toBeGreaterThan(0);
  });

  it("only shows beautify entry for newly created top-level directories", () => {
    render(
      <CompletionView
        journal={{
          journal_id: "j1",
          execution_id: "e1",
          target_dir: "D:/download",
          status: "completed",
          created_at: "2026-04-20T00:00:00Z",
          item_count: 4,
          success_count: 4,
          failure_count: 0,
          rollback_attempt_count: 0,
          items: [
            {
              action_type: "MKDIR",
              status: "success",
              source: null,
              target: "D:/download/Finance",
              display_name: "Finance",
            },
            {
              action_type: "MKDIR",
              status: "success",
              source: null,
              target: "D:/download/Finance/Invoices",
              display_name: "Invoices",
            },
            {
              action_type: "MKDIR",
              status: "success",
              source: null,
              target: "D:/download/Review",
              display_name: "Review",
            },
            {
              action_type: "MOVE",
              status: "success",
              source: "D:/download/a.txt",
              target: "D:/download/Finance/a.txt",
              display_name: "a.txt",
            },
          ],
        }}
        summary="done"
        loading={false}
        targetDir="D:/download"
        organizeMethod="categorize_into_new_structure"
        isBusy={false}
        onOpenExplorer={() => {}}
        onCleanupDirs={() => {}}
        onRollback={() => {}}
        onGoHome={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "去生成文件夹图标" }));
    expect(pushMock).toHaveBeenCalledWith("/icons?import_paths=%5B%22D%3A%2Fdownload%2FFinance%22%5D");
  });

  it("hides beautify entry when organizing into existing directories", () => {
    render(
      <CompletionView
        journal={{
          journal_id: "j1",
          execution_id: "e1",
          target_dir: "D:/download",
          status: "completed",
          created_at: "2026-04-20T00:00:00Z",
          item_count: 1,
          success_count: 1,
          failure_count: 0,
          rollback_attempt_count: 0,
          items: [
            {
              action_type: "MOVE",
              status: "success",
              source: "D:/download/a.txt",
              target: "D:/docs/a.txt",
              display_name: "a.txt",
            },
          ],
        }}
        summary="done"
        loading={false}
        targetDir="D:/download"
        organizeMethod="assign_into_existing_categories"
        isBusy={false}
        onOpenExplorer={() => {}}
        onCleanupDirs={() => {}}
        onRollback={() => {}}
        onGoHome={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "去生成文件夹图标" })).not.toBeInTheDocument();
  });

  it("delegates rollback action to the workspace precheck flow", () => {
    const onRollback = vi.fn();

    render(
      <CompletionView
        journal={{
          journal_id: "j1",
          execution_id: "e1",
          target_dir: "D:/download",
          status: "completed",
          created_at: "2026-04-20T00:00:00Z",
          item_count: 1,
          success_count: 1,
          failure_count: 0,
          rollback_attempt_count: 0,
          items: [
            {
              action_type: "MOVE",
              status: "success",
              source: "D:/download/a.txt",
              target: "D:/docs/a.txt",
              display_name: "a.txt",
            },
          ],
        }}
        summary="done"
        loading={false}
        targetDir="D:/download"
        organizeMethod="assign_into_existing_categories"
        isBusy={false}
        onOpenExplorer={() => {}}
        onCleanupDirs={() => {}}
        onRollback={onRollback}
        onGoHome={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "回退整理" }));

    expect(onRollback).toHaveBeenCalledOnce();
  });
});
