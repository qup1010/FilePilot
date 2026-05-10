import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ComposerBar } from "./composer-bar";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
  },
}));

describe("ComposerBar", () => {
  it("renders planner waiting status with elapsed time, retry attempt and reassure copy", () => {
    render(
      <ComposerBar
        composerMode="editable"
        error={null}
        composerStatus={{
          phase: "plan",
          mode: "waiting",
          label: "正在生成整理方案",
          detail: "正在检查条目完整性与目标结构",
        }}
        plannerStatus={{
          label: "发现问题，正在自动修正",
          detail: "上一轮结果未通过校验，系统正在继续处理",
          elapsedLabel: "已耗时 42 秒",
          reassureText: "系统仍在处理中，请不要重复提交",
          attempt: 2,
          phase: "retrying",
          isRunning: true,
        }}
        unresolvedCount={0}
        canRunPrecheck={false}
        isBusy={false}
        isComposerLocked
        messageInput=""
        setMessageInput={() => {}}
        onSendMessage={() => {}}
      />,
    );

    expect(screen.getByText("发现问题，正在自动修正")).toBeInTheDocument();
    expect(screen.getByText("第 2 次尝试")).toBeInTheDocument();
    expect(screen.getByText("已耗时 42 秒")).toBeInTheDocument();
    expect(screen.getByText("系统仍在处理中，请不要重复提交")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("系统正在更新方案，完成后会自动恢复输入")).toBeDisabled();
  });
});
