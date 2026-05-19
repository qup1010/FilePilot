"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  Cpu,
  Loader2,
  Sparkles,
  User,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { getSessionStageView } from "@/lib/session-view-model";
import { deriveScannerProgressViewModel } from "@/lib/scanner-progress-view";
import type {
  AssistantRuntimeStatus,
  AssistantMessage,
  ComposerMode,
  ScannerProgress,
  SessionStage,
} from "@/types/session";

import { MarkdownProse } from "./markdown-prose";
import { ComposerBar } from "./composer-bar";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function MessageAvatar({ role, hidden = false }: { role: "assistant" | "user"; hidden?: boolean }) {
  const isAssistant = role === "assistant";
  return (
    <div
      className={cn(
        "mt-[1px] flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition-opacity",
        isAssistant
          ? "border border-primary/10 bg-primary/[0.045] text-primary"
          : "border border-on-surface/8 bg-surface-container-low text-on-surface/45",
        hidden && "opacity-0",
      )}
      aria-hidden={hidden}
    >
      {isAssistant ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
    </div>
  );
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
  error: string | null;
  composerMode: ComposerMode;
  isBusy: boolean;
  isComposerLocked: boolean;
  composerStatus?: AssistantRuntimeStatus | null;
  stage: SessionStage;
  messageInput: string;
  setMessageInput: (val: string) => void;
  onSendMessage: () => void;
  onStartScan: () => void;
  unresolvedCount: number;
  canRunPrecheck: boolean;
  notice?: ConversationNotice | null;
  scanner?: ScannerProgress;
  progressPercent?: number;
  plannerStatus?: {
    label: string;
    detail: string | null;
    elapsedLabel: string | null;
    reassureText: string | null;
    attempt: number;
    phase: string | null;
    isRunning: boolean;
  } | null;
  revealMessageId?: string | null;
}


export function ConversationPanel({
  messages,
  assistantDraft,
  error,
  composerMode,
  isBusy,
  isComposerLocked,
  composerStatus,
  stage,
  messageInput,
  setMessageInput,
  onSendMessage,
  onStartScan,
  unresolvedCount,
  canRunPrecheck,
  notice,
  scanner,
  progressPercent = 0,
  plannerStatus,
  revealMessageId = null,
}: ConversationPanelProps) {
  const stageView = getSessionStageView(stage);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [revealingMessage, setRevealingMessage] = useState<{ id: string | null; visibleLength: number }>({
    id: null,
    visibleLength: 0,
  });
  const justFinalizedRef = useRef<Set<string>>(new Set());
  const prevDraftRef = useRef(assistantDraft);
  const scrollRafRef = useRef<number | null>(null);

  // Track when streaming draft finalizes into a message to skip its entrance animation
  useEffect(() => {
    const wasDrafting = Boolean(prevDraftRef.current);
    const isNowDrafting = Boolean(assistantDraft);
    prevDraftRef.current = assistantDraft;
    if (wasDrafting && !isNowDrafting) {
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.content?.trim());
      if (lastAssistant) {
        justFinalizedRef.current.add(lastAssistant.id);
        requestAnimationFrame(() => {
          justFinalizedRef.current.delete(lastAssistant.id);
        });
      }
    }
  }, [assistantDraft, messages]);

  const revealMessageContent = React.useMemo(() => {
    if (!revealMessageId) {
      return "";
    }
    return messages.find((message) => message.id === revealMessageId)?.content || "";
  }, [messages, revealMessageId]);

  useEffect(() => {
    if (!revealMessageId || !revealMessageContent) {
      setRevealingMessage((current) => current.id ? { id: null, visibleLength: 0 } : current);
      return;
    }

    setRevealingMessage({ id: revealMessageId, visibleLength: 0 });
    const chunkSize = Math.max(1, Math.ceil(revealMessageContent.length / 90));
    const timer = window.setInterval(() => {
      setRevealingMessage((current) => {
        if (current.id !== revealMessageId) {
          return current;
        }
        const nextLength = Math.min(revealMessageContent.length, current.visibleLength + chunkSize);
        if (nextLength >= revealMessageContent.length) {
          window.clearInterval(timer);
        }
        return { id: revealMessageId, visibleLength: nextLength };
      });
    }, 22);

    return () => {
      window.clearInterval(timer);
    };
  }, [revealMessageContent, revealMessageId]);

  // Debounced scroll-to-bottom to avoid competing scrolls during draft→message transition
  useEffect(() => {
    if (!isPinnedToBottom) return;
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = scrollContainerRef.current;
      if (!container) return;
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    });
  }, [messages, assistantDraft, revealingMessage.visibleLength, isPinnedToBottom]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 120;
    const pinned = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
    setIsPinnedToBottom(pinned);
  };

  const handleJumpToBottom = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setIsPinnedToBottom(true);
  };

  // notice is rendered dynamically below with AnimatePresence

  const scanningView = React.useMemo(
    () => deriveScannerProgressViewModel(scanner || {}, progressPercent),
    [progressPercent, scanner],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div ref={scrollContainerRef} onScroll={handleScroll} className="relative min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-4 scroll-smooth scrollbar-thin">
        <AnimatePresence>
          {notice && (
            <motion.div
              initial={{ height: 0, opacity: 0, y: -8 }}
              animate={{ height: "auto", opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: "easeInOut" }}
              className="overflow-hidden mb-3"
            >
              <div
                className={cn(
                  "rounded-xl border p-4",
                  notice.tone === "danger" && "border-error/20 bg-error/[0.03]",
                  notice.tone === "warning" && "border-warning/20 bg-warning/[0.03]",
                  notice.tone === "info" && "border-primary/12 bg-surface-container-lowest",
                )}
              >
                <div className="flex gap-4">
                  <div className={cn(
                     "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                     notice.tone === "danger" && "bg-error text-white border-error/20",
                     notice.tone === "warning" && "bg-warning text-white border-warning/20",
                     notice.tone === "info" && "bg-primary text-white border-primary/20",
                  )}>
                     <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div className="flex-1 space-y-3 min-w-0">
                    <div>
                      <h3 className="text-[14px] font-black text-on-surface tracking-tight">{notice.title}</h3>
                      <p className="mt-1 text-[13px] font-medium leading-relaxed text-ui-muted opacity-80">{notice.description}</p>
                    </div>
                    {(notice.primaryAction || notice.secondaryAction) && (
                      <div className="flex flex-wrap gap-2">
                        {notice.primaryAction && (
                          <button
                            type="button"
                            onClick={notice.primaryAction.onClick}
                            className="rounded-[6px] bg-primary px-4 py-2 text-[12px] font-black text-white transition-all hover:bg-primary-dim active:scale-95"
                          >
                            {notice.primaryAction.label}
                          </button>
                        )}
                        {notice.secondaryAction && (
                          <button
                            type="button"
                            onClick={notice.secondaryAction.onClick}
                            className="rounded-[6px] border border-on-surface/10 bg-surface-container-lowest px-4 py-2 text-[12px] font-black text-on-surface transition-all hover:bg-on-surface/5 active:scale-95"
                          >
                            {notice.secondaryAction.label}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {stageView.isDraftLike && !notice && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }} 
            animate={{ opacity: 1, scale: 1 }} 
            className="flex flex-col items-center justify-center space-y-6 py-16 text-center"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.03] text-primary/60">
              <Cpu className="w-8 h-8" />
            </div>
            <div className="max-w-[400px] space-y-3">
              <h3 className="text-[1.25rem] font-black tracking-tight text-on-surface">
                {isBusy ? "正在准备任务" : "开始读取目录"}
              </h3>
              <p className="text-[13.5px] font-medium leading-relaxed text-ui-muted opacity-70">
                {isBusy
                  ? "正在读取你选择的文件和文件夹，完成后会生成整理建议。"
                  : "先只读扫描目录，确认本次要整理的项目，再决定怎么移动。"}
              </p>
              <div className="pt-4 flex justify-center">
                {isBusy ? (
                   <div className="inline-flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/[0.05] px-6 py-3 text-[13px] font-black text-primary">
                    <Loader2 className="w-4 h-4 animate-spin" /> 正在自动执行
                  </div>
                ) : (
                  <button
                    onClick={onStartScan}
                    disabled={isBusy}
                    className="group relative inline-flex items-center gap-3 overflow-hidden rounded-lg bg-primary px-8 py-3.5 text-[13px] font-black text-white transition-all hover:bg-primary-dim active:scale-95 disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>立即开始扫描</span>
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
        
        {stageView.isScanning && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl border border-primary/15 bg-primary/[0.02] px-5 py-4"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                   <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-primary">
                     {scanningView.stageLabel}
                   </span>
                   <span className="text-[11px] font-bold text-on-surface/60">{scanningView.title}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-on-surface/5 overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(scanningView.progressPercent, 4)}%` }}
                    className="h-full bg-primary"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between">
                   <span className="text-[10px] font-black uppercase tracking-widest text-ui-muted opacity-40">实时同步中</span>
                   <span className="font-mono text-[11px] font-black text-primary">{Math.round(scanningView.progressPercent)}%</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        <div className="space-y-2">
          {messages.map((message, idx) => {
            const isAssistant = message.role === "assistant";
            const prevMessage = messages[idx - 1];
            const isGrouped = prevMessage && prevMessage.role === message.role;
            const isSystemLog = isAssistant && !message.content?.trim();
            const isFirstVisibleMessage = !messages.slice(0, idx).some(m => m.role !== "assistant" || m.content?.trim());
            const isRevealingMessage = isAssistant && revealingMessage.id === message.id && revealingMessage.visibleLength < (message.content?.length || 0);
            const visibleContent = isRevealingMessage
              ? message.content.slice(0, Math.max(1, revealingMessage.visibleLength))
              : message.content;

            if (isSystemLog) {
              return (
                <div key={message.id} className="ml-11 py-2 flex items-center gap-3">
                  <div className="h-px w-6 bg-on-surface/10" />
                  <span className="text-[10px] font-black tracking-widest text-ui-muted opacity-40">任务记录已更新</span>
                </div>
              );
            }
            
            return (
              <motion.div
                key={message.id}
                initial={justFinalizedRef.current.has(message.id) ? false : { opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 350, damping: 30 }}
                className={cn(
                  "relative grid w-full gap-3",
                  isAssistant ? "grid-cols-[28px_minmax(0,1fr)] origin-bottom-left" : "grid-cols-[minmax(0,1fr)_28px] origin-bottom-right",
                  isGrouped ? "mt-1" : isFirstVisibleMessage ? "mt-0" : "mt-2.5",
                )}
              >
                <div className={cn(isAssistant ? "col-start-1 row-start-1" : "col-start-2 row-start-1")}>
                  <MessageAvatar role={isAssistant ? "assistant" : "user"} hidden={Boolean(isGrouped)} />
                </div>
                <div
                  className={cn(
                    "row-start-1 flex min-w-0 max-w-[88%] flex-col gap-2",
                    isAssistant ? "col-start-2 items-start justify-self-start" : "col-start-1 items-end justify-self-end",
                  )}
                >
                  {visibleContent && (
                    <div
                      className={cn(
                        "transition-all leading-relaxed",
                        isAssistant
                          ? "px-1 pt-[1px] text-on-surface"
                          : "rounded-lg bg-on-surface/[0.035] border border-on-surface/[0.03] px-3.5 py-2.5 text-[13px] text-on-surface/80 backdrop-blur-sm shadow-[0_1px_2px_rgba(0,0,0,0.015)]"
                      )}
                    >
                      {isAssistant ? (
                        <div className="relative">
                          <MarkdownProse content={visibleContent} density="compact" />
                          {isRevealingMessage && (
                            <motion.span
                              initial={{ opacity: 0 }}
                              animate={{ opacity: [0.2, 1, 0.2] }}
                              transition={{ repeat: Infinity, duration: 0.8 }}
                              className="ml-1 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-primary/40"
                            />
                          )}
                        </div>
                      ) : <span>{visibleContent}</span>}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
          {assistantDraft && (
            <motion.div
              key="assistant-streaming-bubble"
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
              className="relative mt-2.5 grid w-full grid-cols-[28px_minmax(0,1fr)] gap-3 origin-bottom-left"
            >
              <div className="col-start-1 row-start-1">
                <MessageAvatar role="assistant" />
              </div>
              <div className="row-start-1 col-start-2 flex min-w-0 max-w-[88%] flex-col gap-2 items-start justify-self-start">
                <div className="px-1 pt-[1px] text-on-surface transition-all leading-relaxed">
                  <div className="relative">
                    <MarkdownProse content={assistantDraft} density="compact" />
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ repeat: Infinity, duration: 0.8 }}
                      className="inline-block w-1.5 h-4 bg-primary/40 ml-1 translate-y-0.5 rounded-sm"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {!isPinnedToBottom && (messages.length > 0 || assistantDraft) && (
          <div className="sticky bottom-4 z-40 flex justify-end pr-2 pb-2">
            <button
              type="button"
              onClick={handleJumpToBottom}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/20 bg-surface transition-all hover:scale-110 hover:border-primary/40 active:scale-95 text-primary backdrop-blur-sm"
              title="回到底部"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>

      <ComposerBar
        composerMode={composerMode}
        error={error}
        composerStatus={composerStatus}
        plannerStatus={plannerStatus}
        unresolvedCount={unresolvedCount}
        canRunPrecheck={canRunPrecheck}
        isBusy={isBusy}
        isComposerLocked={isComposerLocked}
        messageInput={messageInput}
        setMessageInput={setMessageInput}
        onSendMessage={onSendMessage}
      />
    </div>
  );
}
