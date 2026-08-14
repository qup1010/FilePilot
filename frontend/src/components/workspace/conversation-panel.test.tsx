import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationPanel } from "./conversation-panel";

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: React.ComponentProps<"span">) => <span {...props}>{children}</span>,
  },
}));

const baseProps = {
  error: null,
  composerMode: "editable" as const,
  isBusy: false,
  isComposerLocked: false,
  stage: "ready_for_precheck" as const,
  messageInput: "",
  setMessageInput: () => {},
  onSendMessage: () => {},
  onStartScan: () => {},
  unresolvedCount: 0,
  canRunPrecheck: true,
};

describe("ConversationPanel", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not render the assistant draft when the finalized assistant message already contains the same content", () => {
    render(
      <ConversationPanel
        {...baseProps}
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content: "我已经根据你的要求更新了方案。",
          },
        ]}
        assistantDraft="我已经根据你的要求更新了方案。"
      />,
    );

    expect(screen.getAllByText("我已经根据你的要求更新了方案。")).toHaveLength(1);
  });

  it("supports progressive reveal for a newly generated plan message", () => {
    vi.useFakeTimers();
    const onRevealComplete = vi.fn();
    const messageContent = "方案已经为您生成完毕，请查阅分类结构。";

    render(
      <ConversationPanel
        {...baseProps}
        messages={[
          {
            id: "msg-initial",
            role: "assistant",
            content: messageContent,
          },
        ]}
        assistantDraft=""
        revealMessageId="msg-initial"
        onRevealComplete={onRevealComplete}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText(messageContent)).toBeInTheDocument();
    expect(onRevealComplete).toHaveBeenCalled();
  });

  it("automatically progressively reveals the first fresh assistant message when mounted in editable mode", () => {
    vi.useFakeTimers();
    const messageContent = "这是自动识别并渐渐输出的首条方案消息。";

    render(
      <ConversationPanel
        {...baseProps}
        messages={[
          {
            id: "msg-auto-fresh",
            role: "assistant",
            content: messageContent,
          },
        ]}
        assistantDraft=""
      />,
    );

    // Initial state: not full content yet
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(screen.queryByText(messageContent)).not.toBeInTheDocument();

    // Advance to completion
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(messageContent)).toBeInTheDocument();
  });

  it("does not trigger progressive reveal animation when a message was already streamed via assistantDraft", () => {
    vi.useFakeTimers();
    const messageContent = "这是通过 SSE 实时草稿流输出的内容。";

    // 1. Initial render with active assistantDraft
    const { rerender } = render(
      <ConversationPanel
        {...baseProps}
        messages={[]}
        assistantDraft={messageContent}
      />,
    );

    // 2. SSE finishes, assistantDraft is cleared, and finalized message is added
    rerender(
      <ConversationPanel
        {...baseProps}
        messages={[
          {
            id: "msg-drafted",
            role: "assistant",
            content: messageContent,
          },
        ]}
        assistantDraft=""
      />,
    );

    // Should immediately display full content without requiring typewriter timer ticks
    expect(screen.getByText(messageContent)).toBeInTheDocument();
  });
});
