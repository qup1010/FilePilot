"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Activity,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Cpu,
  Edit2,
  ExternalLink,
  Hash,
  Layers,
  ListChecks,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type {
  ActivityFeedEntry,
  AssistantRuntimeStatus,
  AssistantMessage,
  ComposerMode,
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
  activityFeed: ActivityFeedEntry[];
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
}

const BUSY_STAGES = new Set<SessionStage>(["scanning", "planning", "executing", "rolling_back"]);

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
    <div className="group relative my-2 rounded-lg bg-on-surface/[0.03] overflow-hidden transition-colors hover:bg-on-surface/[0.05]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-on-surface/2 border-b border-on-surface/[0.02]">
        <span className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/20">Code Snippet</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-on-surface/5 text-[9px] font-bold transition-all text-on-surface-variant/40 hover:text-on-surface"
        >
          {copied ? <Check className="w-2.5 h-2.5 text-emerald-500/60" /> : <Copy className="w-2.5 h-2.5" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className={cn("p-3 font-mono text-[12px] leading-relaxed overflow-x-auto scrollbar-none", className)}>
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
        p: ({ node, ...props }) => <div className="mb-3 last:mb-0 leading-8 text-[14px]" {...props} />,
        strong: ({ node, ...props }) => <strong className="font-black text-on-surface" {...props} />,
        em: ({ node, ...props }) => <em className="italic text-on-surface/80" {...props} />,
        ul: ({ node, ...props }) => <ul className="mb-4 ml-4 list-disc space-y-2 text-[14px]" {...props} />,
        ol: ({ node, ...props }) => <ol className="mb-4 ml-4 list-decimal space-y-2 text-[14px]" {...props} />,
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
          <div className="my-6 overflow-x-auto rounded-xl border border-on-surface/5 bg-on-surface/[0.02]">
            <table className="w-full text-left border-collapse text-[13px]" {...props} />
          </div>
        ),
        thead: ({ node, ...props }) => <thead className="bg-on-surface/[0.03] text-on-surface/40 font-black uppercase tracking-widest text-[10px]" {...props} />,
        th: ({ node, ...props }) => <th className="px-4 py-3 border-b border-on-surface/5" {...props} />,
        td: ({ node, ...props }) => <td className="px-4 py-3 border-b border-on-surface/[0.03] leading-relaxed" {...props} />,
        hr: ({ node, ...props }) => <hr className="my-8 border-t border-on-surface/5" {...props} />,
        h1: ({ node, ...props }) => <h1 className="mb-5 mt-8 text-xl font-black font-headline tracking-tighter text-on-surface" {...props} />,
        h2: ({ node, ...props }) => <h2 className="mb-4 mt-7 text-lg font-black tracking-tight text-on-surface/90 flex items-center gap-2" {...props} />,
        h3: ({ node, ...props }) => (
          <h3 className="mb-3 mt-6 text-sm font-black uppercase tracking-[0.2em] text-on-surface/60 flex items-center gap-2" {...props} />
        ),
        blockquote: ({ node, ...props }) => (
          <blockquote className="border-l-4 border-primary/20 bg-primary/[0.03] rounded-r-lg px-6 py-4 my-6 italic text-on-surface/70 leading-8" {...props} />
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
  const isSubmitted = block.status === "submitted";
  const submittedMap = Object.fromEntries(
    (block.submitted_resolutions || []).map((item) => [item.item_id, item]),
  );

  return (
    <div className="mt-3 rounded-lg border border-warning/20 bg-warning-container/10 p-4 font-sans text-ui-body">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-on-surface">请帮我确认这几项</h4>
          <p className="mt-1 text-ui-meta text-on-surface-variant">
            {block.summary || "你可以直接选一个目录，或者补充一点想法。"}
          </p>
        </div>
        {!isSubmitted ? (
          <button
            type="button"
            onClick={onSetAllReview}
            className="rounded-lg border border-on-surface/10 px-3 py-1.5 text-[11px] font-bold text-on-surface-variant transition-colors hover:bg-white hover:text-on-surface"
          >
            全部放入 Review
          </button>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        {block.items.map((item) => {
          const submitted = submittedMap[item.item_id];
          const draft = drafts[item.item_id] || { selected_folder: "", note: "", custom_selected: false };
          const selectedFolder = isSubmitted ? (submitted?.selected_folder || "") : draft.selected_folder;
          const currentNote = isSubmitted ? (submitted?.note || "") : draft.note;
          const customSelected = isSubmitted ? Boolean(submitted?.note) && !submitted?.selected_folder : draft.custom_selected;
          return (
            <div key={item.item_id} className="rounded-lg border border-on-surface/8 bg-white/80 p-4">
              <div className="space-y-1">
                <p className="text-[13px] font-bold text-on-surface">{item.display_name}</p>
                <p className="text-[13px] leading-relaxed text-on-surface-variant/80">{item.question}</p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {item.suggested_folders.map((folder) => (
                  <button
                    key={folder}
                    type="button"
                    disabled={isSubmitted}
                    onClick={() => onPickFolder(item.item_id, folder)}
                    className={cn(
                      "rounded-full border px-3 py-2 text-xs font-bold transition-colors",
                      selectedFolder === folder
                        ? "border-primary bg-primary text-white"
                        : "border-on-surface/10 bg-surface text-on-surface-variant hover:text-on-surface",
                      isSubmitted && "cursor-default",
                    )}
                  >
                    {folder}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={isSubmitted}
                  onClick={() => onPickFolder(item.item_id, "Review")}
                  className={cn(
                    "rounded-full border px-3 py-2 text-xs font-bold transition-colors",
                    selectedFolder === "Review"
                      ? "border-warning bg-warning text-white"
                      : "border-warning/20 bg-warning-container/10 text-warning hover:bg-warning/15",
                    isSubmitted && "cursor-default",
                  )}
                >
                  归入 Review
                </button>
                <button
                  type="button"
                  disabled={isSubmitted}
                  onClick={() => onPickCustom(item.item_id)}
                  className={cn(
                    "rounded-full border px-3 py-2 text-xs font-bold transition-colors",
                    customSelected
                      ? "border-on-surface bg-on-surface text-white"
                      : "border-on-surface/10 bg-surface text-on-surface-variant hover:text-on-surface",
                    isSubmitted && "cursor-default",
                  )}
                >
                  自定义
                </button>
              </div>

              {(customSelected || (isSubmitted && currentNote)) ? (
                <textarea
                  value={currentNote}
                  disabled={isSubmitted}
                  onChange={(event) => onChangeNote(item.item_id, event.target.value)}
                  placeholder="请输入你的自定义分类想法。"
                  className="mt-3 min-h-[84px] w-full rounded-lg border border-on-surface/8 bg-surface px-4 py-3 text-sm leading-6 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/45 focus:border-primary/25 disabled:opacity-70"
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {warning ? (
        <div className="mt-4 rounded-xl border border-warning/20 bg-white/80 px-4 py-3 text-sm text-warning">
          {warning}
        </div>
      ) : null}

      {isSubmitted ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white">
          <ArrowRight className="h-3.5 w-3.5" />
          已提交本批选择
        </div>
      ) : (
        <button
          type="button"
          onClick={onSubmit}
          disabled={isSubmitting}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          提交这些选择
        </button>
      )}
    </div>
  );
}

export function ConversationPanel({
  messages,
  assistantDraft,
  activityFeed,
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
}: ConversationPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [activityOpen, setActivityOpen] = useState(BUSY_STAGES.has(stage));
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, ResolutionDraftMap>>({});
  const [resolutionWarnings, setResolutionWarnings] = useState<Record<string, string | null>>({});
  const [submittingRequestId, setSubmittingRequestId] = useState<string | null>(null);

  useEffect(() => {
    setActivityOpen(BUSY_STAGES.has(stage));
  }, [stage]);

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
        "rounded-lg border p-4",
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
                className="rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
              >
                {notice.primaryAction.label}
              </button>
            ) : null}
            {notice.secondaryAction ? (
              <button
                type="button"
                onClick={notice.secondaryAction.onClick}
                className="rounded-lg border border-on-surface/10 px-4 py-2.5 text-sm font-bold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
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
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }} 
            animate={{ opacity: 1, scale: 1 }} 
            className="flex flex-col items-center justify-center py-20 text-center space-y-6"
          >
            <div className="w-14 h-14 rounded-xl bg-primary/[0.03] border border-primary/10 flex items-center justify-center text-primary/40 shadow-sm transition-transform hover:scale-105 duration-500">
              <Cpu className="w-7 h-7" />
            </div>
            <div className="space-y-3 max-w-[320px]">
              <h3 className="text-lg font-black font-headline text-on-surface tracking-tight leading-tight">准备好开始扫描了吗？</h3>
              <p className="text-ui-body text-ui-muted leading-relaxed font-medium">
                我会先扫描你的目录，分析现有文件结构，然后再为你提供整理方案。
              </p>
              <div className="pt-2">
                <button
                  onClick={onStartScan}
                  disabled={isBusy}
                  className="inline-flex items-center gap-2.5 bg-primary hover:bg-primary-dim text-white px-6 py-2.5 rounded-lg text-[13px] font-bold transition-all active:scale-[0.96] shadow-[0_4px_12px_rgba(76,98,88,0.1)] hover:shadow-[0_6px_16px_rgba(76,98,88,0.2)] disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" /> 开启智能扫描
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {renderNotice}

        {activityFeed.length > 0 && (
          <div className="group/activity relative">
            <div 
              className={cn(
                "flex items-center gap-3 px-4 py-2 rounded-lg transition-all cursor-pointer group-hover/activity:bg-on-surface/2",
                activityOpen ? "bg-on-surface/2 mb-4" : "bg-transparent"
              )}
              onClick={() => setActivityOpen((prev) => !prev)}
            >
              <div className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md text-on-surface-variant/30 transition-colors",
                activityOpen ? "bg-primary/10 text-primary" : "bg-on-surface/5"
              )}>
                {BUSY_STAGES.has(stage) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
              </div>
              
              <div className="flex-1 min-w-0 flex items-center gap-3">
                <span className="text-ui-meta font-semibold text-ui-muted shrink-0">运行轨迹</span>
                {!activityOpen && activityFeed.length > 0 && (
                  <p className="text-ui-meta truncate italic flex-1 border-l border-on-surface/5 pl-3">
                    {activityFeed[activityFeed.length - 1].message}
                  </p>
                )}
              </div>

              {activityOpen ? <ChevronDown className="h-3 w-3 text-on-surface-variant/20" /> : <ChevronRight className="h-3 w-3 text-on-surface-variant/20" />}
            </div>

            <AnimatePresence initial={false}>
              {activityOpen ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mb-6"
                >
                  <div className="space-y-1.5 px-4 pb-2 border-l-2 border-on-surface/5 ml-3 mt-2">
                    {activityFeed.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-3 py-1 text-[12px] group/item text-ui-muted hover:text-on-surface transition-colors">
                        <span className="text-[11px] font-mono opacity-50 tabular-nums shrink-0">{entry.time}</span>
                        <div className={cn("h-1 w-1 rounded-full shrink-0", entry.important ? "bg-primary" : "bg-on-surface/20")} />
                        <p className="flex-1 truncate tracking-tight">{entry.message}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        )}

        <div className="space-y-2">
          {messages.map((message, idx) => {
            const isAssistant = message.role === "assistant";
            const prevMessage = messages[idx - 1];
            const isGrouped = prevMessage && prevMessage.role === message.role;
            
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex gap-4", 
                  isAssistant ? "flex-row" : "flex-row-reverse justify-start",
                  isGrouped ? "mt-1" : "mt-8"
                )}
              >
                {/* 头像仅在组的第一条显示 */}
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-on-surface/5 transition-opacity",
                  isAssistant ? "bg-white/90 text-primary" : "bg-primary/90 text-white shadow-sm",
                  isGrouped ? "opacity-0" : "opacity-100"
                )}>
                  {isAssistant ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                </div>
                
                <div
                  className={cn(
                    "p-4 rounded-lg text-ui-body leading-relaxed max-w-[82%] transition-all",
                    isAssistant
                      ? "bg-white/88 text-on-surface border border-on-surface/5 shadow-sm"
                      : "bg-surface-container-high text-on-surface font-medium whitespace-pre-wrap",
                    isGrouped && isAssistant && "rounded-tl-sm",
                    isGrouped && !isAssistant && "rounded-tr-sm"
                  )}
                >
                  {message.content ? <MarkdownProse content={message.content} /> : null}
                  {isAssistant && (message.blocks || []).map((block) => {
                    if (block.type !== "unresolved_choices") {
                      return null;
                    }
                    return (
                      <UnresolvedChoicesBubble
                        key={block.request_id}
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
              className="flex gap-4 mt-8"
            >
              <div className="w-8 h-8 rounded-lg bg-white/90 border border-on-surface/5 flex items-center justify-center text-primary shrink-0">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="p-4 flex-1 bg-white/88 border border-on-surface/8 rounded-lg text-ui-body leading-relaxed text-on-surface shadow-[0_4px_20px_rgba(0,0,0,0.03)] ring-1 ring-on-surface/[0.01]">
                <div className="mb-3 flex gap-2 items-center text-primary/60">
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
                  <span className="text-ui-meta font-semibold ml-1">AI 正在整理回复...</span>
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

          {!assistantDraft && isComposerLocked && (
            <motion.div
              key="assistant-status-bubble"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-4 mt-8"
            >
              <div className="w-8 h-8 rounded-lg bg-white/90 border border-on-surface/5 flex items-center justify-center text-primary shrink-0">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="p-4 flex-1 bg-white/88 border border-on-surface/8 rounded-lg text-ui-body leading-relaxed text-on-surface shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <motion.div 
                        animate={{ opacity: [0.2, 1, 0.2] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                        className="w-2 h-2 rounded-full bg-primary"
                      />
                      <span className="text-ui-meta font-semibold text-primary/70">思考中</span>
                    </div>
                  </div>
                  
                  {composerStatus ? (
                    <div className="space-y-1 animate-in fade-in duration-500">
                      <p className="text-sm font-bold text-on-surface/80">{composerStatus.label}</p>
                      {composerStatus.detail && (
                        <p className="text-[13px] leading-6 text-ui-muted">{composerStatus.detail}</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="h-4 w-3/4 bg-on-surface/[0.03] rounded animate-pulse" />
                      <div className="h-4 w-1/2 bg-on-surface/[0.02] rounded animate-pulse" />
                    </div>
                  )}
                </div>
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
            {composerStatus && composerMode === "editable" ? (
              <motion.div
                key="composer-status-bubble"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mb-4 flex items-start gap-3 rounded-2xl border border-primary/10 bg-primary/[0.05] px-4 py-3 text-sm text-primary"
              >
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                <div className="space-y-1">
                  <p className="font-bold">{composerStatus.label}</p>
                  {composerStatus.detail ? (
                    <p className="leading-6 text-primary/80">{composerStatus.detail}</p>
                  ) : null}
                </div>
              </motion.div>
            ) : null}

            {unresolvedCount > 0 && composerMode === "editable" ? (
              <motion.div
                key="unresolved-count-bubble"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mb-4 px-4 py-2.5 bg-warning-container/10 rounded-2xl text-xs font-medium text-warning flex items-center gap-2 border border-warning/10"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                还有 {unresolvedCount} 项待确认
              </motion.div>
            ) : (unresolvedCount === 0 && stage === "planning" && composerMode === "editable") ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mb-3 px-5 flex items-center gap-2.5 text-ui-meta font-medium text-ui-muted"
              >
                <span className="w-1 h-1 rounded-full bg-primary/20 shrink-0" />
                <p>
                  方案已经准备好了。如果你觉得没问题，可以点右侧底部的
                  <span className="text-primary/70 font-semibold mx-1">“开始预检”</span>
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {composerMode === "editable" ? (
            <div className={cn(
              "relative flex items-end rounded-[28px] border transition-all duration-300 px-3 pt-1.5 pb-1.5",
              isComposerLocked 
                ? "border-on-surface/[0.04] bg-on-surface/[0.02] cursor-not-allowed grayscale-[0.2]" 
                : "border-on-surface/[0.06] bg-surface-container-low/50 focus-within:border-primary/30 focus-within:bg-white focus-within:shadow-[0_8px_40px_rgba(0,0,0,0.05)] focus-within:ring-4 focus-within:ring-primary/[0.015]"
            )}>
              <textarea
                ref={inputRef}
                rows={1}
                className={cn(
                  "w-full bg-transparent border-none py-3 px-4 text-[14px] text-on-surface placeholder:text-on-surface-variant/30 outline-none resize-none scrollbar-none min-h-[44px] transition-opacity",
                  isComposerLocked && "opacity-40 select-none overflow-hidden"
                )}
                placeholder={isComposerLocked ? (composerStatus?.label || "AI 正在思考中...") : "说说你的整理想法，或告诉我哪里想调整..."}
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
                  "mb-1.5 mr-1.5 w-10 h-10 rounded-full transition-all flex items-center justify-center active:scale-90 shrink-0",
                  messageInput.trim() && !isComposerLocked
                    ? "bg-primary text-white shadow-[0_4px_12px_rgba(76,98,88,0.2)]"
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
            <div className="rounded-2xl border border-on-surface/5 bg-white/78 px-5 py-4 text-sm text-on-surface-variant">
              正在扫描目录，暂时还不能继续输入。
            </div>
          )}

        </div>
      )}
    </div>
  );
}
