"use client";

import React, { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Send,
  ShieldAlert,
  User,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn, formatDisplayDate } from "@/lib/utils";
import type {
  IconWorkbenchChatMessage,
  IconWorkbenchPendingAction,
  IconWorkbenchSession,
} from "@/types/icon-workbench";

interface IconChatPanelProps {
  session: IconWorkbenchSession | null;
  messageInput: string;
  onMessageInputChange: (value: string) => void;
  onSendMessage: () => void;
  sending: boolean;
  actionLoadingId: string | null;
  onConfirmAction: (action: IconWorkbenchPendingAction) => void;
  onDismissAction: (action: IconWorkbenchPendingAction) => void;
  selectedCount: number;
  activeFolderName?: string | null;
  allowClientActions: boolean;
}

function messageBubbleClass(role: string) {
  if (role === "user") {
    return "ml-8 bg-primary text-white shadow-[0_18px_40px_rgba(77,99,87,0.18)]";
  }
  if (role === "system") {
    return "mx-auto max-w-[88%] border-warning/18 bg-warning-container/28 text-on-surface";
  }
  return "mr-8 border-on-surface/8 bg-white text-on-surface shadow-[0_18px_40px_rgba(36,48,42,0.06)]";
}

function roleIcon(role: string) {
  if (role === "user") {
    return <User className="h-4 w-4" />;
  }
  if (role === "system") {
    return <ShieldAlert className="h-4 w-4" />;
  }
  return <Bot className="h-4 w-4" />;
}

function MessageBubble({ message }: { message: IconWorkbenchChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={cn("flex", isUser ? "justify-end" : "justify-start")}
    >
      <div className={cn("w-full max-w-[92%] rounded-[22px] border px-4 py-4", messageBubbleClass(message.role))}>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
          <span
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-full border",
              isUser
                ? "border-white/20 bg-white/12"
                : isSystem
                  ? "border-warning/20 bg-warning/12 text-warning"
                  : "border-primary/12 bg-primary/10 text-primary",
            )}
          >
            {roleIcon(message.role)}
          </span>
          <span className={isUser ? "text-white/72" : "text-ui-muted"}>
            {isUser ? "你" : isSystem ? "系统" : "Icon Agent"}
          </span>
          <span className={isUser ? "text-white/54" : "text-ui-muted"}>{formatDisplayDate(message.created_at)}</span>
        </div>

        {message.content ? (
          <p className={cn("mt-3 whitespace-pre-wrap text-[14px] leading-7", isUser ? "text-white" : "text-on-surface")}>
            {message.content}
          </p>
        ) : null}

        {message.tool_results.length > 0 ? (
          <div className="mt-3 space-y-2">
            {message.tool_results.map((result, index) => (
              <div
                key={`${message.message_id}-${result.tool_name}-${index}`}
                className={cn(
                  "rounded-[14px] border px-3 py-2.5 text-[12px] leading-6",
                  result.success
                    ? isUser
                      ? "border-white/16 bg-white/10 text-white/92"
                      : "border-primary/12 bg-primary/8 text-on-surface"
                    : isUser
                      ? "border-white/14 bg-white/8 text-white/88"
                      : "border-error/14 bg-error-container/35 text-on-surface",
                )}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={cn("h-3.5 w-3.5", result.success ? "" : "opacity-60")} />
                  <span className="font-semibold">{result.tool_name}</span>
                </div>
                <p className="mt-1">{result.message}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

function PendingActionCard({
  action,
  busy,
  allowClientActions,
  onConfirm,
  onDismiss,
}: {
  action: IconWorkbenchPendingAction;
  busy: boolean;
  allowClientActions: boolean;
  onConfirm: (action: IconWorkbenchPendingAction) => void;
  onDismiss: (action: IconWorkbenchPendingAction) => void;
}) {
  const blocked = action.requires_client && !allowClientActions;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="rounded-[20px] border border-warning/16 bg-[linear-gradient(180deg,rgba(244,184,78,0.12),rgba(255,255,255,0.96))] p-4 shadow-[0_18px_44px_rgba(36,48,42,0.06)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-warning/18 bg-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-warning">
            <Clock3 className="h-3.5 w-3.5" />
            待确认
          </div>
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-on-surface">{action.title}</h3>
            <p className="mt-1 text-[13px] leading-6 text-on-surface-variant">{action.description}</p>
          </div>
        </div>
        <span className="text-[11px] text-ui-muted">{formatDisplayDate(action.created_at)}</span>
      </div>

      {blocked ? (
        <div className="mt-3 rounded-[14px] border border-error/14 bg-error-container/30 px-3 py-2 text-[12px] text-error">
          当前为浏览器模式，这个动作需要桌面壳执行。
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => onConfirm(action)}
          disabled={busy || blocked}
          loading={busy}
        >
          确认执行
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onDismiss(action)} disabled={busy}>
          <X className="h-4 w-4" />
          取消
        </Button>
      </div>
    </motion.div>
  );
}

export function IconChatPanel({
  session,
  messageInput,
  onMessageInputChange,
  onSendMessage,
  sending,
  actionLoadingId,
  onConfirmAction,
  onDismissAction,
  selectedCount,
  activeFolderName,
  allowClientActions,
}: IconChatPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [session?.chat_updated_at, session?.pending_actions.length]);

  const messages = session?.messages || [];
  const pendingActions = session?.pending_actions || [];

  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-on-surface/8 bg-[linear-gradient(180deg,rgba(246,248,244,0.96),rgba(237,241,236,0.9))] xl:max-w-[380px] xl:border-b-0 xl:border-r">
      <div className="border-b border-on-surface/8 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[15px] border border-primary/12 bg-primary/10 text-primary shadow-[0_14px_32px_rgba(77,99,87,0.12)]">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">Agent Console</p>
            <h2 className="truncate text-[20px] font-black tracking-tight text-on-surface">图标对话工作台</h2>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-[12px] text-ui-muted">
          <div className="rounded-[14px] border border-on-surface/8 bg-white/78 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-[0.18em]">选中</p>
            <p className="mt-1 text-[15px] font-bold tracking-tight text-on-surface">{selectedCount} 个文件夹</p>
          </div>
          <div className="rounded-[14px] border border-on-surface/8 bg-white/78 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-[0.18em]">当前焦点</p>
            <p className="mt-1 truncate text-[15px] font-bold tracking-tight text-on-surface">{activeFolderName || "未选择"}</p>
          </div>
        </div>
      </div>

      <div ref={scrollContainerRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 scrollbar-thin">
        {!session ? (
          <div className="rounded-[24px] border border-on-surface/8 bg-white/84 p-5 shadow-[0_18px_48px_rgba(36,48,42,0.06)]">
            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-primary/70">准备开始</p>
            <p className="mt-3 text-[14px] leading-7 text-on-surface">
              先在右侧选择父目录。建立图标工坊会话后，这里可以直接让 agent 分析、套模板、生成预览，或在确认后执行应用与恢复。
            </p>
          </div>
        ) : null}

        {pendingActions.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-warning">待确认动作</p>
              <span className="text-[12px] text-ui-muted">{pendingActions.length} 项</span>
            </div>
            <AnimatePresence initial={false}>
              {pendingActions.map((action) => (
                <PendingActionCard
                  key={action.action_id}
                  action={action}
                  busy={actionLoadingId === action.action_id}
                  allowClientActions={allowClientActions}
                  onConfirm={onConfirmAction}
                  onDismiss={onDismissAction}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : null}

        <div className="space-y-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-ui-muted">会话记录</p>
          <AnimatePresence initial={false}>
            {messages.map((message) => (
              <MessageBubble key={message.message_id} message={message} />
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className="border-t border-on-surface/8 px-4 py-4">
        <div className="rounded-[22px] border border-on-surface/8 bg-white/88 p-3 shadow-[0_16px_40px_rgba(36,48,42,0.06)]">
          <textarea
            value={messageInput}
            onChange={(event) => onMessageInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!sending && messageInput.trim()) {
                  onSendMessage();
                }
              }
            }}
            rows={4}
            disabled={!session || sending}
            placeholder={session ? "例如：分析当前文件夹，并给选中的目录套一个更偏简洁线稿的模板" : "先在右侧建立图标工坊会话"}
            className="w-full resize-none bg-transparent px-1 py-1 text-[14px] leading-7 text-on-surface outline-none placeholder:text-ui-muted"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[12px] text-ui-muted">Enter 发送，Shift + Enter 换行</p>
            <Button
              variant="primary"
              size="sm"
              onClick={onSendMessage}
              disabled={!session || !messageInput.trim() || sending}
              loading={sending}
            >
              {!sending ? <Send className="h-4 w-4" /> : <LoaderCircle className="h-4 w-4" />}
              发送
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
