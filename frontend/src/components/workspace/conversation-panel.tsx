"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Cpu,
  Loader2,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { ActivityFeedEntry, AssistantMessage, ComposerMode, SessionStage } from "@/types/session";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ConversationNotice {
  tone: "info" | "warning" | "danger";
  title: string;
  description: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

interface ConversationPanelProps {
  messages: AssistantMessage[];
  assistantDraft: string;
  activityFeed: ActivityFeedEntry[];
  error: string | null;
  composerMode: ComposerMode;
  isBusy: boolean;
  stage: SessionStage;
  messageInput: string;
  setMessageInput: (val: string) => void;
  onSendMessage: () => void;
  onStartScan: () => void;
  unresolvedCount: number;
  notice?: ConversationNotice | null;
}

const BUSY_STAGES = new Set<SessionStage>(["scanning", "planning", "executing", "rolling_back"]);

export function ConversationPanel({
  messages,
  assistantDraft,
  activityFeed,
  error,
  composerMode,
  isBusy,
  stage,
  messageInput,
  setMessageInput,
  onSendMessage,
  onStartScan,
  unresolvedCount,
  notice,
}: ConversationPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [activityOpen, setActivityOpen] = useState(BUSY_STAGES.has(stage));

  useEffect(() => {
    setActivityOpen(BUSY_STAGES.has(stage));
  }, [stage]);

  useEffect(() => {
    if (!isPinnedToBottom) {
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, assistantDraft, activityFeed, isPinnedToBottom]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const threshold = 32;
    const pinned =
      container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
    setIsPinnedToBottom(pinned);
  };

  const handleJumpToBottom = () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setIsPinnedToBottom(true);
  };

  const renderNotice = notice ? (
    <div
      className={cn(
        "rounded-2xl border p-4",
        notice.tone === "danger" && "border-error/20 bg-error-container/10",
        notice.tone === "warning" && "border-warning/20 bg-warning-container/20",
        notice.tone === "info" && "border-primary/10 bg-white/78",
      )}
    >
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-on-surface">{notice.title}</h3>
          <p className="mt-1 text-sm leading-6 text-on-surface-variant">{notice.description}</p>
        </div>
        {(notice.primaryAction || notice.secondaryAction) && (
          <div className="flex flex-wrap gap-3">
            {notice.primaryAction ? (
              <button
                type="button"
                onClick={notice.primaryAction.onClick}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
              >
                {notice.primaryAction.label}
              </button>
            ) : null}
            {notice.secondaryAction ? (
              <button
                type="button"
                onClick={notice.secondaryAction.onClick}
                className="rounded-xl border border-on-surface/10 px-4 py-2.5 text-sm font-bold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
              >
                {notice.secondaryAction.label}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 flex-col h-full bg-surface">
      <div ref={scrollContainerRef} onScroll={handleScroll} className="relative min-h-0 flex-1 overflow-y-auto px-8 py-8 space-y-6 scroll-smooth">
        {(stage === "idle" || stage === "draft") && messages.length === 0 && activityFeed.length === 0 && !notice && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-6 max-w-2xl">
            <div className="shrink-0 pt-1 text-primary/40">
              <Cpu className="w-5 h-5" />
            </div>
            <div className="space-y-4 font-sans">
              <p className="text-sm leading-relaxed text-on-surface-variant italic">
                我是你的文件架构助手。我会先扫描目录、理解文件语义，再和你一起把方案收敛到可执行状态。
              </p>
              <button
                onClick={onStartScan}
                disabled={isBusy}
                className="inline-flex items-center gap-2 bg-linear-to-b from-primary to-primary-dim text-white px-6 py-2.5 rounded-md text-xs font-bold transition-transform active:scale-[0.98] shadow-sm disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" /> 开始架构深度扫描
              </button>
            </div>
          </motion.div>
        )}

        {renderNotice}

        {activityFeed.length > 0 && (
          <div className="rounded-2xl border border-on-surface/5 bg-white/66">
            <button
              type="button"
              onClick={() => setActivityOpen((prev) => !prev)}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-container-low text-outline-variant">
                  <Cpu className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-on-surface">运行轨迹</p>
                  <p className="text-xs text-on-surface-variant">
                    {BUSY_STAGES.has(stage) ? "当前正在处理任务，自动展开中" : "可展开查看最近的扫描与规划动作"}
                  </p>
                </div>
              </div>
              {activityOpen ? <ChevronDown className="h-4 w-4 text-on-surface-variant" /> : <ChevronRight className="h-4 w-4 text-on-surface-variant" />}
            </button>
            <AnimatePresence initial={false}>
              {activityOpen ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t border-on-surface/5"
                >
                  <div className="space-y-2 px-5 py-4">
                    {activityFeed.map((entry) => (
                      <div key={entry.id} className="flex items-start gap-3 rounded-xl bg-surface-container-low/38 px-4 py-3">
                        <div className={cn("mt-1 h-2 w-2 rounded-full", entry.important ? "bg-primary" : "bg-outline-variant/60")} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-bold uppercase tracking-wide text-on-surface-variant/70">
                              {entry.phase === "scan" ? "扫描" : entry.phase === "plan" ? "规划" : entry.phase}
                            </span>
                            <span className="text-[10px] font-mono text-on-surface-variant/50">{entry.time}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-6 text-on-surface-variant">
                            {entry.message}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        )}

        <div className="space-y-6">
          {messages.map((message) => {
            const isAssistant = message.role === "assistant";
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex gap-4", isAssistant ? "flex-row" : "flex-row-reverse justify-start")}
              >
                <div
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border border-on-surface/5",
                    isAssistant ? "bg-white/88 text-primary" : "bg-primary text-white",
                  )}
                >
                  {isAssistant ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </div>
                <div
                  className={cn(
                    "p-4 rounded-2xl text-[14px] leading-7 max-w-[85%] transition-all whitespace-pre-wrap",
                    isAssistant
                      ? "bg-white/78 text-on-surface border border-on-surface/5"
                      : "bg-primary/7 text-on-surface font-medium",
                  )}
                >
                  {message.content}
                </div>
              </motion.div>
            );
          })}

          {assistantDraft && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-4">
              <div className="w-9 h-9 rounded-xl bg-white/88 border border-on-surface/5 flex items-center justify-center text-primary shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="p-4 flex-1 bg-white/78 border border-on-surface/5 rounded-2xl text-[14px] leading-7 text-on-surface whitespace-pre-wrap">
                <div className="mb-2 flex gap-1 items-center opacity-50">
                  <span className="w-1 h-1 bg-primary rounded-full animate-bounce" />
                  <span className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:0.4s]" />
                  <span className="text-xs font-medium ml-2 text-on-surface-variant">正在生成回复...</span>
                </div>
                {assistantDraft}
              </div>
            </motion.div>
          )}
        </div>

        {!isPinnedToBottom && (messages.length > 0 || assistantDraft || activityFeed.length > 0) && (
          <button
            type="button"
            onClick={handleJumpToBottom}
            className="sticky bottom-4 ml-auto flex items-center gap-2 rounded-full bg-on-surface px-4 py-2 text-xs font-bold text-white shadow-lg"
          >
            回到底部
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {composerMode !== "hidden" && (
        <div className="shrink-0 px-8 py-5 flex flex-col justify-center bg-surface/92 backdrop-blur-sm border-t border-on-surface/5">
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mb-4 rounded-xl border border-error/10 bg-error-container/20 px-4 py-3 text-sm text-error"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="leading-6">{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {unresolvedCount > 0 && composerMode === "editable" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mb-4 px-4 py-2.5 bg-on-surface/4 rounded-2xl text-xs font-medium text-on-surface-variant flex items-center gap-2 border border-on-surface/5"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                还有 {unresolvedCount} 项待确认冲突
              </motion.div>
            )}
          </AnimatePresence>

          {composerMode === "editable" ? (
            <div className="relative flex items-center rounded-[26px] border border-on-surface/8 bg-white/85 px-2 shadow-[0_10px_24px_rgba(36,48,42,0.05)]">
              <input
                ref={inputRef}
                className="w-full bg-transparent border-l-2 border-transparent focus:border-primary rounded-[22px] py-4 px-4 pr-14 text-sm text-on-surface placeholder:text-on-surface-variant/45 outline-none transition-all disabled:opacity-50"
                placeholder={isBusy ? "系统正在处理请求..." : "输入你的整理意图或修改要求..."}
                type="text"
                value={messageInput}
                disabled={isBusy}
                onChange={(event) => setMessageInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onSendMessage();
                  }
                }}
              />
              <button
                onClick={onSendMessage}
                disabled={isBusy || !messageInput.trim()}
                className="absolute right-2.5 text-on-surface-variant hover:text-primary p-2.5 transition-colors disabled:opacity-20 flex items-center justify-center active:scale-90"
              >
                {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-on-surface/5 bg-white/78 px-5 py-4 text-sm text-on-surface-variant">
              正在扫描目录并分析文件语义，当前阶段暂不接收新的聊天输入。
            </div>
          )}

          <div className="mt-4 flex items-center justify-center gap-6 text-xs text-on-surface-variant/45 font-medium pointer-events-none">
            <span>对话整理引擎</span>
            <div className="w-1 h-1 bg-on-surface-variant/10 rounded-full" />
            <span>当前阶段 {stage}</span>
          </div>
        </div>
      )}
    </div>
  );
}
