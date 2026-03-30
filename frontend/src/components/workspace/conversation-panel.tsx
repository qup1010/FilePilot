"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  Cpu,
  ExternalLink,
  Loader2,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type {
  AssistantRuntimeStatus,
  AssistantMessage,
  ComposerMode,
  ScannerProgress,
  SessionStage,
  UnresolvedChoiceResolution,
  UnresolvedChoicesBlock,
} from "@/types/session";

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
  onResolveUnresolved: (payload: { request_id: string; resolutions: UnresolvedChoiceResolution[] }) => Promise<void> | void;
  unresolvedCount: number;
  notice?: ConversationNotice | null;
  scanner?: ScannerProgress;
  progressPercent?: number;
}

interface ResolutionDraft {
  selected_folder: string;
  note: string;
  custom_selected: boolean;
}

type ResolutionDraftMap = Record<string, ResolutionDraft>;

interface UnresolvedChoicesBubbleProps {
  block: UnresolvedChoicesBlock;
  drafts: ResolutionDraftMap;
  warning: string | null;
  isSubmitting: boolean;
  onPickFolder: (itemId: string, folder: string) => void;
  onPickCustom: (itemId: string) => void;
  onChangeNote: (itemId: string, note: string) => void;
  onSetAllReview: () => void;
  onSubmit: () => void;
}

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const code = String(children).replace(/\n$/, "");

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-[10px] border border-on-surface/8 bg-surface-container-lowest transition-colors">
      <div className="flex items-center justify-between border-b border-on-surface/8 bg-surface-container-low px-3 py-2">
        <span className="text-[12px] font-medium text-ui-muted">代码片段</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[12px] font-medium text-on-surface-variant/55 transition-colors hover:bg-on-surface/5 hover:text-on-surface"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className={cn("overflow-x-auto scrollbar-none p-3 font-mono text-[12px] leading-6", className)}>
        {children}
      </pre>
    </div>
  );
}

function MarkdownProse({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ node, ...props }) => <div className="mb-1.5 last:mb-0 text-[14px] leading-7" {...props} />,
        strong: ({ node, ...props }) => <strong className="font-black text-on-surface" {...props} />,
        em: ({ node, ...props }) => <em className="italic text-on-surface/80" {...props} />,
        ul: ({ node, ...props }) => <ul className="mb-2 ml-4 list-disc space-y-1.5 text-[14px]" {...props} />,
        ol: ({ node, ...props }) => <ol className="mb-2 ml-4 list-decimal space-y-1.5 text-[14px]" {...props} />,
        li: ({ node, ...props }) => (
          <li className={cn("pl-1 leading-7", String(node?.position?.start.line).length > 2 && "ml-4")} {...props} />
        ),
        a: ({ node, ...props }) => (
          <a
            className="text-primary font-bold underline underline-offset-4 hover:text-primary-dim transition-colors inline-flex items-center gap-1 group/link"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          >
            {props.children}
            <ExternalLink className="w-3 h-3 opacity-30 group-hover/link:opacity-100 transition-opacity" />
          </a>
        ),
        table: ({ node, ...props }) => (
          <div className="my-4 overflow-x-auto rounded-[10px] border border-on-surface/8 bg-surface-container-low">
            <table className="w-full text-left border-collapse text-[13px]" {...props} />
          </div>
        ),
        thead: ({ node, ...props }) => <thead className="bg-surface-container text-[12px] font-semibold text-on-surface-variant/80" {...props} />,
        th: ({ node, ...props }) => <th className="px-3 py-2 border-b border-on-surface/5" {...props} />,
        td: ({ node, ...props }) => <td className="px-3 py-2 border-b border-on-surface/[0.03] leading-relaxed" {...props} />,
        hr: ({ node, ...props }) => <hr className="my-5 border-t border-on-surface/5" {...props} />,
        h1: ({ node, ...props }) => <h1 className="mb-3 mt-4 text-xl font-black font-headline tracking-tighter text-on-surface" {...props} />,
        h2: ({ node, ...props }) => <h2 className="mb-2.5 mt-4 text-lg font-black tracking-tight text-on-surface/90 flex items-center gap-2" {...props} />,
        h3: ({ node, ...props }) => (
          <h3 className="mb-2 mt-3 flex items-center gap-2 text-[14px] font-semibold text-on-surface/70" {...props} />
        ),
        blockquote: ({ node, ...props }) => (
          <blockquote className="my-4 rounded-r-[10px] border-l-4 border-primary/20 bg-primary/[0.03] px-4 py-3 text-on-surface/75 leading-7" {...props} />
        ),
        code: ({ node, inline, className, children, ...props }: any) => {
          if (inline) {
            return <code className="rounded bg-on-surface/5 px-1.5 py-0.5 font-mono text-[0.9em] font-bold text-primary" {...props}>{children}</code>;
          }
          return <CodeBlock className={className}>{children}</CodeBlock>;
        },
        input: ({ node, ...props }: any) => {
          if (props.type === "checkbox") {
            return (
              <input
                type="checkbox"
                readOnly
                checked={props.checked}
                className="w-4 h-4 rounded border-on-surface/10 bg-on-surface/5 text-primary focus:ring-primary/20 transition-all mr-2"
              />
            );
          }
          return <input {...props} />;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function UnresolvedChoicesBubble({
  block,
  drafts,
  warning,
  isSubmitting,
  onPickFolder,
  onPickCustom,
  onChangeNote,
  onSetAllReview,
  onSubmit,
}: UnresolvedChoicesBubbleProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isSubmitted = block.status === "submitted";
  const submittedMap = Object.fromEntries(
    (block.submitted_resolutions || []).map((item) => [item.item_id, item]),
  );

  const COLLAPSE_THRESHOLD = 3;
  const showExpandButton = !isSubmitted && block.items.length > COLLAPSE_THRESHOLD;
  const visibleItems = isExpanded || isSubmitted ? block.items : block.items.slice(0, COLLAPSE_THRESHOLD);

  if (isSubmitted) {
    return (
      <div className="mt-2.5 rounded-[10px] border border-emerald-600/15 bg-emerald-600/[0.03] p-3 text-ui-body">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-emerald-700">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Check className="h-3 w-3" />
            </div>
            <span className="text-[13px] font-bold">处理完成</span>
          </div>
          <span className="text-[12px] font-medium text-emerald-600/60 tabular-nums">
            共处理 {block.items.length} 项
          </span>
        </div>
        <div className="mt-2 space-y-1.5 border-t border-emerald-600/10 pt-2 text-[12px]">
          {block.items.map((item) => {
            const submitted = submittedMap[item.item_id];
            return (
              <div key={item.item_id} className="flex items-baseline gap-2 text-on-surface/60">
                <span className="shrink-0 font-bold text-on-surface/80">{item.display_name}</span>
                <div className="h-[1px] flex-1 border-b border-dashed border-on-surface/5" />
                <span className="shrink-0 rounded-md bg-emerald-600/10 px-1.5 py-0.5 font-semibold text-emerald-700">
                  {submitted?.selected_folder || "自定义/Review"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2.5 rounded-[16px] border border-on-surface/[0.04] bg-surface-container-low/70 backdrop-blur-md p-4 font-sans shadow-sm ring-1 ring-inset ring-white/5 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h4 className="flex items-center gap-2 text-[13px] font-black tracking-tight text-on-surface/90">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-warning/10 text-warning">
              <Sparkles className="h-3 w-3" />
            </div>
            待确认项目
          </h4>
          <p className="text-[12px] font-medium leading-relaxed text-on-surface-variant/70">
            {block.summary || "请为以下文件选择合适的归类建议。"}
          </p>
        </div>
        <button
          type="button"
          onClick={onSetAllReview}
          className="shrink-0 rounded-[8px] border border-on-surface/5 bg-on-surface/[0.02] px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-on-surface-variant/60 transition-all hover:bg-white hover:text-on-surface active:scale-95"
        >
          全部 Review
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {visibleItems.map((item) => {
          const draft = drafts[item.item_id] || { selected_folder: "", note: "", custom_selected: false };
          const selectedFolder = draft.selected_folder;
          const currentNote = draft.note;
          const customSelected = draft.custom_selected;
          
          return (
            <div key={item.item_id} className="group/item rounded-[12px] border border-on-surface/[0.03] bg-surface-container-lowest/50 p-3.5 transition-all hover:border-primary/10 hover:shadow-md hover:shadow-black/[0.02]">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3 min-w-0">
                <span className="shrink-0 text-[13.5px] font-black text-on-surface truncate max-w-[70%] sm:max-w-[60%]">{item.display_name}</span>
                <span className="text-[12px] font-medium text-ui-muted opacity-60 truncate flex-1">{item.question}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {item.suggested_folders.map((folder) => (
                  <button
                    key={folder}
                    type="button"
                    onClick={() => onPickFolder(item.item_id, folder)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[11.5px] font-black transition-all active:scale-95",
                      selectedFolder === folder
                        ? "border-primary bg-primary text-white shadow-lg shadow-primary/20"
                        : "border-on-surface/[0.06] bg-surface/80 text-on-surface-variant/80 hover:border-on-surface/20 hover:text-on-surface",
                    )}
                  >
                    {folder}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onPickFolder(item.item_id, "Review")}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[11.5px] font-black transition-all active:scale-95",
                    selectedFolder === "Review"
                      ? "border-warning bg-warning text-white shadow-lg shadow-warning/20"
                      : "border-warning/10 bg-warning/5 text-warning/80 hover:bg-warning/10 hover:text-warning",
                  )}
                >
                  Review
                </button>
                <button
                  type="button"
                  onClick={() => onPickCustom(item.item_id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[11.5px] font-black transition-all active:scale-95",
                    customSelected
                      ? "border-on-surface bg-on-surface text-white"
                      : "border-on-surface/[0.06] bg-surface/80 text-on-surface-variant/80 hover:bg-on-surface/5 hover:text-on-surface",
                  )}
                >
                  自定义
                </button>
              </div>

              {customSelected && (
                <textarea
                  value={currentNote}
                  onChange={(event) => onChangeNote(item.item_id, event.target.value)}
                  placeholder="补充你的分类建议..."
                  className="mt-3 min-h-[64px] w-full rounded-[10px] border border-on-surface/[0.08] bg-surface-container-low/50 px-3 py-2.5 text-[12px] font-medium leading-relaxed text-on-surface outline-none transition-all focus:border-primary/30"
                />
              )}
            </div>
          );
        })}

        {showExpandButton && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex w-full items-center justify-center gap-2 py-1 text-[11px] font-black uppercase tracking-widest text-on-surface-variant/40 transition-colors hover:text-primary"
          >
            {isExpanded ? (
              <>收起所有项目 <ChevronDown className="h-3 w-3 rotate-180" /></>
            ) : (
              <>展开其余 {block.items.length - COLLAPSE_THRESHOLD} 个项目 <ChevronDown className="h-3 w-3" /></>
            )}
          </button>
        )}
      </div>

      {warning && (
        <div className="mt-4 flex items-center gap-2.5 rounded-[10px] border border-error/10 bg-error-container/10 px-4 py-2.5 text-[11.5px] font-bold text-error">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {warning}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting}
        className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-[12px] border border-primary/20 bg-primary py-2.5 text-[13px] font-black text-white transition-all hover:bg-primary-dim hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-40"
      >
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        确认并推送到计划阶段
      </button>
    </div>
  );
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
  onResolveUnresolved,
  unresolvedCount,
  notice,
  scanner,
  progressPercent = 0,
}: ConversationPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, ResolutionDraftMap>>({});
  const [resolutionWarnings, setResolutionWarnings] = useState<Record<string, string | null>>({});
  const [submittingRequestId, setSubmittingRequestId] = useState<string | null>(null);

  useEffect(() => {
    setResolutionDrafts((prev) => {
      const next = { ...prev };
      for (const message of messages) {
        for (const block of message.blocks || []) {
          if (block.type !== "unresolved_choices") {
            continue;
          }
          const existing = next[block.request_id] || {};
          const merged: ResolutionDraftMap = { ...existing };
          for (const item of block.items) {
            if (!merged[item.item_id]) {
              merged[item.item_id] = { selected_folder: "", note: "", custom_selected: false };
            }
          }
          next[block.request_id] = merged;
        }
      }
      return next;
    });
  }, [messages]);

  // 自适应输入框高度
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    }
  }, [messageInput]);

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
  }, [messages, assistantDraft, isPinnedToBottom]);

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

  const updateDraft = (requestId: string, itemId: string, updater: (draft: ResolutionDraft) => ResolutionDraft) => {
    setResolutionDrafts((prev) => ({
      ...prev,
      [requestId]: {
        ...(prev[requestId] || {}),
        [itemId]: updater(prev[requestId]?.[itemId] || { selected_folder: "", note: "", custom_selected: false }),
      },
    }));
  };

  const handleSubmitUnresolved = async (block: UnresolvedChoicesBlock) => {
    const drafts = resolutionDrafts[block.request_id] || {};
    const missing = block.items
      .filter((item) => {
        const draft = drafts[item.item_id] || { selected_folder: "", note: "", custom_selected: false };
        const customNote = draft.custom_selected ? draft.note.trim() : "";
        return !draft.selected_folder && !customNote;
      })
      .map((item) => item.display_name);

    if (missing.length > 0) {
      setResolutionWarnings((prev) => ({
        ...prev,
        [block.request_id]: `以下条目仍未处理：${missing.join("、")}`,
      }));
      return;
    }

    setResolutionWarnings((prev) => ({ ...prev, [block.request_id]: null }));
    setSubmittingRequestId(block.request_id);
    try {
      await onResolveUnresolved({
        request_id: block.request_id,
        resolutions: block.items.map((item) => {
          const draft = drafts[item.item_id] || { selected_folder: "", note: "", custom_selected: false };
          return {
            item_id: item.item_id,
            selected_folder: draft.selected_folder,
            note: draft.custom_selected ? draft.note.trim() : "",
          };
        }),
      });
    } finally {
      setSubmittingRequestId((current) => (current === block.request_id ? null : current));
    }
  };

  const renderNotice = notice ? (
    <div
      className={cn(
        "rounded-[10px] border p-4",
        notice.tone === "danger" && "border-error/20 bg-error-container/10",
        notice.tone === "warning" && "border-warning/20 bg-warning-container/20",
        notice.tone === "info" && "border-primary/12 bg-surface-container-lowest",
      )}
    >
      <div className="space-y-3">
        <div>
          <h3 className="text-[14px] font-semibold text-on-surface">{notice.title}</h3>
          <p className="mt-1 text-[13px] leading-6 text-ui-muted">{notice.description}</p>
        </div>
        {(notice.primaryAction || notice.secondaryAction) && (
          <div className="flex flex-wrap gap-3">
            {notice.primaryAction ? (
              <button
                type="button"
                onClick={notice.primaryAction.onClick}
                className="rounded-[10px] border border-primary/20 bg-primary px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary-dim"
              >
                {notice.primaryAction.label}
              </button>
            ) : null}
            {notice.secondaryAction ? (
              <button
                type="button"
                onClick={notice.secondaryAction.onClick}
                className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-2.5 text-[13px] font-medium text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
              >
                {notice.secondaryAction.label}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  ) : null;
  const scanningItems = [...(scanner?.recent_analysis_items || [])].slice(-5).reverse();
  const currentScanningItem = scanner?.current_item || scanningItems[0]?.display_name || "正在准备扫描";
  const scanningPercent = Math.max(0, Math.min(100, Math.round(progressPercent)));

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div ref={scrollContainerRef} onScroll={handleScroll} className="relative min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 scroll-smooth lg:px-6 lg:py-6">
        {(stage === "idle" || stage === "draft") && messages.length === 0 && !notice && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }} 
            animate={{ opacity: 1, scale: 1 }} 
            className="flex flex-col items-center justify-center space-y-5 py-18 text-center"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-[10px] border border-primary/12 bg-primary/6 text-primary/55">
              <Cpu className="w-7 h-7" />
            </div>
            <div className="max-w-[360px] space-y-3">
              <h3 className="text-[1.1rem] font-black font-headline leading-tight text-on-surface tracking-tight">
                {isBusy ? "正在启动扫描" : "开始扫描以生成初始方案"}
              </h3>
              <p className="text-ui-body font-medium leading-relaxed text-ui-muted">
                {isBusy
                  ? "系统正在进入扫描阶段，读取目录结构后会生成第一版整理方案。"
                  : "先扫描当前目录并分析文件结构，再生成第一版整理方案。"}
              </p>
              {isBusy ? (
                <div className="pt-2">
                  <div className="inline-flex items-center gap-2.5 rounded-[10px] border border-primary/16 bg-primary/8 px-6 py-3 text-[13px] font-semibold text-primary">
                    <Loader2 className="w-4 h-4 animate-spin" /> 正在自动开始
                  </div>
                </div>
              ) : (
                <div className="pt-2">
                  <button
                    onClick={onStartScan}
                    disabled={isBusy}
                    className="inline-flex items-center gap-2.5 rounded-[10px] border border-primary/20 bg-primary px-6 py-3 text-[13px] font-semibold text-white transition-colors hover:bg-primary-dim active:scale-[0.96] disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" /> 开始扫描
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
        {stage === "scanning" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-3.5 rounded-[12px] border border-on-surface/8 bg-surface-container-low px-4 py-3 shadow-sm shadow-black/[0.02]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-primary/20 bg-primary/5 text-primary">
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex flex-1 items-center justify-between gap-4">
          <div className="space-y-0.5">
                <p className="text-[13px] font-bold text-on-surface">正在分析目录结构...</p>
                <div className="flex items-center gap-2 text-[10px] text-ui-muted font-bold uppercase tracking-wider">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40 opacity-75"></span>
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary/60"></span>
                  </span>
                  AI 引擎扫描中
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] font-black tabular-nums text-primary">
                {scanningPercent}%
              </div>
            </div>
          </motion.div>
        )}

        <div className="space-y-1.5">
          {messages.map((message, idx) => {
            const isAssistant = message.role === "assistant";
            const prevMessage = messages[idx - 1];
            const isGrouped = prevMessage && prevMessage.role === message.role;
            const isSystemLog = isAssistant && !message.content?.trim() && (message.blocks || []).length === 0;

            if (isSystemLog) {
              return (
                <div key={message.id} className="ml-10 py-1.5 text-[11.5px] font-bold text-on-surface-variant/40 flex items-center gap-2">
                  <div className="h-[1px] w-4 bg-on-surface-variant/10" />
                  日志: 系统任务同步完成
                </div>
              );
            }
            
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                className={cn(
                  "relative flex gap-3", 
                  isAssistant ? "flex-row" : "flex-row-reverse justify-start",
                  isGrouped ? "mt-1.5" : "mt-6",
                  isGrouped ? "pb-0.5" : "pb-1"
                )}
              >
                {/* 垂直连接引导线 (Thread Line) */}
                {isAssistant && (
                  <div className={cn(
                    "absolute left-[13px] w-[1px] bg-on-surface-variant/10 transition-all pointer-events-none",
                    !isGrouped ? "top-8" : "top-0",
                    messages[idx + 1]?.role === "assistant" ? "bottom-[-1.5rem]" : "bottom-0"
                  )} />
                )}

                <div className={cn(
                  "flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-[6px] border border-on-surface/8 transition-opacity z-10",
                  isAssistant ? "bg-surface-container-lowest text-primary" : "bg-primary text-white",
                  isGrouped ? "opacity-0" : "opacity-100"
                )}>
                  {isAssistant ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
                </div>
                
                <div className="flex-1 flex flex-col gap-2 min-w-0">
                  {message.content && (
                    <div
                      className={cn(
                        "max-w-[90%] 2xl:max-w-[84%] rounded-[12px] px-3.5 py-2.5 text-ui-body leading-relaxed transition-all shadow-sm shadow-black/[0.01]",
                        isAssistant
                          ? "border border-on-surface/8 bg-surface-container-lowest text-on-surface"
                          : "bg-surface-container-low text-on-surface font-medium whitespace-pre-wrap ml-auto",
                        isGrouped && isAssistant && "rounded-tl-[4px]",
                        isGrouped && !isAssistant && "rounded-tr-[4px]"
                      )}
                    >
                      <MarkdownProse content={message.content} />
                    </div>
                  )}

                  {isAssistant && (message.blocks || []).map((block) => {
                    if (block.type !== "unresolved_choices") {
                      return null;
                    }
                    return (
                      <div key={block.request_id} className="max-w-[90%] 2xl:max-w-[88%] transform group">
                        <UnresolvedChoicesBubble
                          block={block}
                          drafts={resolutionDrafts[block.request_id] || {}}
                          warning={resolutionWarnings[block.request_id] || null}
                          isSubmitting={submittingRequestId === block.request_id}
                          onPickFolder={(itemId, folder) => {
                            updateDraft(block.request_id, itemId, (draft) => ({
                              ...draft,
                              selected_folder: folder,
                              custom_selected: false,
                            }));
                          }}
                          onPickCustom={(itemId) => {
                            updateDraft(block.request_id, itemId, (draft) => ({
                              ...draft,
                              selected_folder: "",
                              custom_selected: true,
                            }));
                          }}
                          onChangeNote={(itemId, note) => {
                            updateDraft(block.request_id, itemId, (draft) => ({
                              ...draft,
                              note,
                              custom_selected: true,
                              selected_folder: "",
                            }));
                          }}
                          onSetAllReview={() => {
                            setResolutionDrafts((prev) => ({
                              ...prev,
                              [block.request_id]: Object.fromEntries(
                                block.items.map((item) => {
                                  const current = prev[block.request_id]?.[item.item_id] || {
                                    selected_folder: "",
                                    note: "",
                                    custom_selected: false,
                                  };
                                  return [item.item_id, { ...current, selected_folder: "Review", custom_selected: false }];
                                }),
                              ),
                            }));
                            setResolutionWarnings((prev) => ({ ...prev, [block.request_id]: null }));
                          }}
                          onSubmit={() => void handleSubmitUnresolved(block)}
                        />
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}

          {assistantDraft && (
            <motion.div
              key="assistant-streaming-bubble"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            className="flex gap-3 mt-5.5"
          >
              <div className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-[6px] border border-on-surface/8 bg-surface-container-lowest text-primary">
                <Bot className="w-3 h-3" />
              </div>
              <div className="flex-1 rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-3.5 py-2.5 text-ui-body leading-relaxed text-on-surface shadow-sm shadow-black/[0.01]">
                <div className="mb-3 flex items-center gap-2 text-primary/70">
                  <div className="flex gap-0.5">
                    <motion.span 
                      animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }} 
                      transition={{ repeat: Infinity, duration: 2, delay: 0 }}
                      className="w-1.5 h-1.5 bg-current rounded-full" 
                    />
                    <motion.span 
                      animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }} 
                      transition={{ repeat: Infinity, duration: 2, delay: 0.2 }}
                      className="w-1.5 h-1.5 bg-current rounded-full" 
                    />
                    <motion.span 
                      animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }} 
                      transition={{ repeat: Infinity, duration: 2, delay: 0.4 }}
                      className="w-1.5 h-1.5 bg-current rounded-full" 
                    />
                  </div>
                  <span className="ml-1 text-[12px] font-medium">正在整理回复...</span>
                </div>
                <div className="relative">
                  <MarkdownProse content={assistantDraft} />
                  <motion.span 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{ repeat: Infinity, duration: 0.8 }}
                    className="inline-block w-1.5 h-4 bg-primary/40 ml-1 translate-y-0.5"
                  />
                </div>
              </div>
            </motion.div>
          )}

        </div>

        {!isPinnedToBottom && (messages.length > 0 || assistantDraft) && (
          <button
            type="button"
            onClick={handleJumpToBottom}
            className="sticky bottom-4 ml-auto flex items-center gap-2 rounded-full bg-on-surface px-4 py-2 text-[12px] font-medium text-white shadow-lg"
          >
            回到底部
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {composerMode !== "hidden" && (
        <div className="flex shrink-0 flex-col justify-center border-t border-on-surface/8 bg-surface-container-low px-5 py-4 lg:px-6">
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mb-4 rounded-[10px] border border-error/12 bg-error-container/22 px-4 py-3 text-[13px] text-error"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="leading-6">{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {composerStatus && composerMode === "editable" ? (
              <motion.div
                key="composer-status-badge"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                className="mb-2 flex items-center gap-2 px-1 text-[12px] font-bold text-primary"
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{composerStatus.label}</span>
                {composerStatus.detail && (
                  <span className="font-medium text-primary/60 truncate opacity-80">— {composerStatus.detail}</span>
                )}
              </motion.div>
            ) : null}

            {unresolvedCount > 0 && composerMode === "editable" ? (
              <motion.div
                key="unresolved-count-pill"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="mb-2 flex items-center gap-2 rounded-full border border-warning/15 bg-warning-container/10 px-2.5 py-1 text-[11px] font-bold text-warning-dim shadow-sm"
              >
                <AlertTriangle className="h-3 w-3" />
                还有 {unresolvedCount} 项归类需要你确认
              </motion.div>
            ) : (unresolvedCount === 0 && stage === "planning" && composerMode === "editable" && !isBusy) ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mb-2 flex items-center gap-2 px-1 text-[11px] font-bold text-emerald-600/70"
              >
                <Sparkles className="h-3 w-3" />
                <p>方案已绪，可以点击右侧底部的 “开始预检” 执行整理</p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {composerMode === "editable" ? (
            <div className={cn(
              "relative flex items-end rounded-[8px] border px-3 pb-1.5 pt-1.5 transition-all duration-300",
              isComposerLocked 
                ? "cursor-not-allowed border-on-surface/[0.06] bg-on-surface/[0.02] grayscale-[0.2]" 
                : "border-on-surface/[0.08] bg-surface-container-lowest focus-within:border-primary/30 focus-within:ring-4 focus-within:ring-primary/[0.015]"
            )}>
              <textarea
                ref={inputRef}
                rows={1}
                className={cn(
                  "min-h-[44px] w-full resize-none border-none bg-transparent px-4 py-3 text-[14px] text-on-surface outline-none scrollbar-none transition-opacity placeholder:text-on-surface-variant/35",
                  isComposerLocked && "opacity-40 select-none overflow-hidden"
                )}
                placeholder={isComposerLocked ? (composerStatus?.label || "正在处理当前调整...") : "输入调整意见，或说明你希望修改的地方..."}
                value={messageInput}
                disabled={isComposerLocked}
                onChange={(event) => setMessageInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    onSendMessage();
                  }
                }}
              />
              <button
                onClick={onSendMessage}
                disabled={isComposerLocked || !messageInput.trim()}
                className={cn(
                  "mb-1.5 mr-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] transition-all active:scale-90",
                  messageInput.trim() && !isComposerLocked
                    ? "bg-primary text-white shadow-[0_4px_12px_rgba(0,120,212,0.16)]"
                    : "text-on-surface-variant/20 bg-on-surface/[0.03]"
                )}
              >
                {isComposerLocked ? (
                  <div className="relative flex items-center justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <motion.div 
                      animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="absolute inset-0 rounded-full bg-primary/20"
                    />
                  </div>
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          ) : (
            <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-5 py-4 text-[13px] text-on-surface-variant">
              正在扫描目录，暂时还不能继续输入。
            </div>
          )}

        </div>
      )}
    </div>
  );
}
