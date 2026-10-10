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

  it("renders planner waiting status in English from stable phase codes", async () => {
    await i18n.changeLanguage("en");
    render(
      <ComposerBar
        composerMode="editable"
        error={null}
        composerStatus={{
          phase: "plan",
          mode: "waiting",
          label: "正在生成整理方案",
          detail: "正在检查条目完整性与目标结构",
          labelCode: "typingPlan",
          detailCode: "typingPlanDetail",
        }}
        plannerStatus={{
          label: "发现问题，正在自动修正",
          labelCode: "retrying",
          detail: "上一轮结果未通过校验，系统正在继续处理",
          detailCode: "retrying_detail",
          elapsedSeconds: 42,
          reassure: true,
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

    expect(screen.getByText("Automatically correcting the plan")).toBeInTheDocument();
    expect(screen.getByText("Attempt 2")).toBeInTheDocument();
    expect(screen.getByText("42 sec")).toBeInTheDocument();
    expect(screen.getByText("Still working. Do not submit the same request again.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Updating the plan. Input will be available when it is ready.")).toBeDisabled();
  });
});
