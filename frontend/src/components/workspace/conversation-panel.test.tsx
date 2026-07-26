import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
});
