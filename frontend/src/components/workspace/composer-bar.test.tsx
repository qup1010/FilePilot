import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposerBar } from "./composer-bar";
import i18n from "@/i18n/instance";

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
  },
}));

describe("ComposerBar", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("zh-CN");
  });

  it("localizes its input and safety-check hint", async () => {
    await i18n.changeLanguage("en");
    const { unmount } = render(
      <ComposerBar
        composerMode="editable"
        error={null}
        unresolvedCount={0}
        canRunPrecheck
        isBusy={false}
        isComposerLocked={false}
        messageInput=""
        setMessageInput={() => {}}
        onSendMessage={() => {}}
      />,
    );

    expect(screen.getByPlaceholderText("Describe what you want to change in the plan")).toBeInTheDocument();
    expect(screen.getByText("The plan is confirmed. You can run the safety check now.")).toBeInTheDocument();
    unmount();
  });

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
