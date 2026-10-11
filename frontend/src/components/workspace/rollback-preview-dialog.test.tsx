import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type React from "react";

import { RollbackPreviewDialog } from "./rollback-preview-dialog";
import i18n from "@/i18n/instance";

vi.mock("motion/react", () => ({
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      transition: _transition,
      ...props
    }: React.ComponentProps<"div"> & { initial?: unknown; animate?: unknown; transition?: unknown }) => <div {...props}>{children}</div>,
    button: ({
      children,
      whileTap: _whileTap,
      ...props
    }: React.ComponentProps<"button"> & { whileTap?: unknown }) => <button {...props}>{children}</button>,
  },
}));

describe("RollbackPreviewDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("labels review rollback actions as restoring from the review area", () => {
    render(
      <RollbackPreviewDialog
        open
        loading={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        precheck={{
          can_execute: true,
          blocking_errors: [],
          actions: [
            {
              type: "MOVE",
              display_name: "a.txt",
              source: "D:/download/Review/a.txt",
              target: "D:/download/a.txt",
              target_slot_id: "Review",
              target_kind: "review",
              is_review: true,
              restore_kind: "from_review",
              current_path: "D:/download/Review/a.txt",
              original_path: "D:/download/a.txt",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("从待确认区恢复")).toBeInTheDocument();
    expect(screen.getAllByText("a.txt").length).toBeGreaterThan(0);
  });

  it("shows a localized label for ordinary move actions", () => {
    render(
      <RollbackPreviewDialog
        open
        loading={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        precheck={{
          can_execute: true,
          blocking_errors: [],
          actions: [
            {
              type: "MOVE",
              display_name: "b.txt",
              source: "D:/download/Docs/b.txt",
              target: "D:/download/b.txt",
              restore_kind: "from_directory",
              current_path: "D:/download/Docs/b.txt",
              original_path: "D:/download/b.txt",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("移动")).toBeInTheDocument();
    expect(screen.queryByText("从待确认区恢复")).not.toBeInTheDocument();
  });

  it("renders rollback confirmation copy in English", async () => {
    await i18n.changeLanguage("en");

    render(
      <RollbackPreviewDialog
        open
        loading={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        precheck={{ can_execute: true, blocking_errors: [], actions: [] }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Restore files?" })).toBeInTheDocument();
    expect(screen.getByText("All original paths are writable. After you confirm, FilePilot will try to restore the files and remove folders created by this operation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore files" })).toBeInTheDocument();
  });
});
