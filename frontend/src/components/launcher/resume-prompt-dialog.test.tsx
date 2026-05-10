import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResumePromptDialog } from "./resume-prompt-dialog";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
    button: ({ children, whileTap: _whileTap, ...props }: React.ComponentProps<"button"> & { whileTap?: unknown }) => (
      <button {...props}>{children}</button>
    ),
  },
}));

const baseProps = {
  open: true,
  targetDir: "D:/download",
  resumePrompt: {
    sessionId: "session-1",
    snapshot: {
      session_id: "session-1",
      stage: "completed",
      created_at: "2026-04-21T00:00:00Z",
      updated_at: "2026-04-21T00:00:00Z",
      strategy: {
        template_id: "general_downloads",
        template_label: "通用下载",
        task_type: "organize_full_directory",
        task_type_label: "整理整个目录",
        organize_mode: "initial",
        organize_mode_label: "生成新结构",
        organize_method: "categorize_into_new_structure",
        language: "zh",
        language_label: "中文",
        density: "normal",
        density_label: "标准",
        prefix_style: "none",
        prefix_style_label: "无前缀",
        caution_level: "balanced",
        caution_level_label: "平衡",
        destination_index_depth: 2,
        note: "",
      },
    } as any,
  },
  resumeStrategy: {
    template_id: "general_downloads",
    template_label: "通用下载",
    task_type: "organize_full_directory",
    task_type_label: "整理整个目录",
    organize_mode: "initial",
    organize_mode_label: "生成新结构",
    organize_method: "categorize_into_new_structure",
    language: "zh",
    language_label: "中文",
    density: "normal",
    density_label: "标准",
    prefix_style: "none",
    prefix_style_label: "无前缀",
    caution_level: "balanced",
    caution_level_label: "平衡",
    destination_index_depth: 2 as const,
    note: "",
  } as any,
  onConfirmResume: vi.fn(),
  onStartFresh: vi.fn(),
  onReadOnlyView: vi.fn(),
  onCancel: vi.fn(),
};

describe("ResumePromptDialog", () => {
  it("uses readonly result viewing as the primary action for completed sessions", () => {
    render(<ResumePromptDialog {...baseProps} isCompletedResume />);

    expect(screen.getByRole("button", { name: "查看整理结果" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "只读打开" })).not.toBeInTheDocument();
  });

  it("keeps continue and readonly actions for unfinished sessions", () => {
    render(
      <ResumePromptDialog
        {...baseProps}
        isCompletedResume={false}
        resumePrompt={{
          ...baseProps.resumePrompt,
          snapshot: {
            ...baseProps.resumePrompt.snapshot,
            stage: "planning",
          } as any,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "只读打开" }));

    expect(screen.getByRole("button", { name: "继续整理" })).toBeInTheDocument();
    expect(baseProps.onReadOnlyView).toHaveBeenCalledTimes(1);
  });

  it("uses recovery wording for stale sessions", () => {
    render(
      <ResumePromptDialog
        {...baseProps}
        isCompletedResume={false}
        resumePrompt={{
          ...baseProps.resumePrompt,
          snapshot: {
            ...baseProps.resumePrompt.snapshot,
            stage: "stale",
          } as any,
        }}
      />,
    );

    expect(screen.getByText("发现需要复核的整理记录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开复核" })).toBeInTheDocument();
    expect(screen.getByText(/旧记录仍可在历史中查看/)).toBeInTheDocument();
  });
});
