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
        p: ({ node, ...props }) => <div className="mb-3 last:mb-0 text-[14px] leading-7" {...props} />,
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
          <div className="my-6 overflow-x-auto rounded-[10px] border border-on-surface/8 bg-surface-container-low">
            <table className="w-full text-left border-collapse text-[13px]" {...props} />
          </div>
        ),
        thead: ({ node, ...props }) => <thead className="bg-surface-container text-[12px] font-semibold text-on-surface-variant/80" {...props} />,
        th: ({ node, ...props }) => <th className="px-4 py-3 border-b border-on-surface/5" {...props} />,
        td: ({ node, ...props }) => <td className="px-4 py-3 border-b border-on-surface/[0.03] leading-relaxed" {...props} />,
        hr: ({ node, ...props }) => <hr className="my-8 border-t border-on-surface/5" {...props} />,
        h1: ({ node, ...props }) => <h1 className="mb-5 mt-8 text-xl font-black font-headline tracking-tighter text-on-surface" {...props} />,
        h2: ({ node, ...props }) => <h2 className="mb-4 mt-7 text-lg font-black tracking-tight text-on-surface/90 flex items-center gap-2" {...props} />,
        h3: ({ node, ...props }) => (
          <h3 className="mb-3 mt-6 flex items-center gap-2 text-[14px] font-semibold text-on-surface/70" {...props} />
        ),
        blockquote: ({ node, ...props }) => (
          <blockquote className="my-6 rounded-r-[10px] border-l-4 border-primary/20 bg-primary/[0.03] px-5 py-4 text-on-surface/75 leading-7" {...props} />
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
    <div className="mt-3 rounded-[10px] border border-warning/18 bg-warning-container/18 p-4 font-sans text-ui-body">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[14px] font-semibold text-on-surface">待你确认的项目</h4>
          <p className="mt-1 text-[13px] leading-6 text-ui-muted">
            {block.summary || "你可以直接选一个目录，或者补充一点想法。"}
          </p>
        </div>
        {!isSubmitted ? (
          <button
            type="button"
            onClick={onSetAllReview}
            className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-3 py-1.5 text-[12px] font-medium text-on-surface-variant transition-colors hover:bg-white hover:text-on-surface"
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
            <div key={item.item_id} className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest p-4">
              <div className="space-y-1">
                <p className="text-[14px] font-semibold text-on-surface">{item.display_name}</p>
                <p className="text-[13px] leading-6 text-ui-muted">{item.question}</p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {item.suggested_folders.map((folder) => (
                  <button
                    key={folder}
                    type="button"
                    disabled={isSubmitted}
                    onClick={() => onPickFolder(item.item_id, folder)}
                    className={cn(
                      "rounded-full border px-3 py-2 text-[12px] font-medium transition-colors",
                      selectedFolder === folder
                        ? "border-primary bg-primary text-white"
                        : "border-on-surface/8 bg-surface text-on-surface-variant hover:text-on-surface",
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
                    "rounded-full border px-3 py-2 text-[12px] font-medium transition-colors",
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
                    "rounded-full border px-3 py-2 text-[12px] font-medium transition-colors",
                    customSelected
                      ? "border-on-surface bg-on-surface text-white"
                      : "border-on-surface/8 bg-surface text-on-surface-variant hover:text-on-surface",
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
                  className="mt-3 min-h-[88px] w-full rounded-[10px] border border-on-surface/8 bg-surface px-4 py-3 text-[13px] leading-6 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/45 focus:border-primary/25 disabled:opacity-70"
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {warning ? (
        <div className="mt-4 rounded-[10px] border border-warning/20 bg-surface-container-lowest px-4 py-3 text-[13px] text-warning">
          {warning}
        </div>
      ) : null}

      {isSubmitted ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-[8px] bg-emerald-600 px-3 py-2 text-[12px] font-medium text-white">
          <ArrowRight className="h-3.5 w-3.5" />
          已提交本批选择
        </div>
      ) : (
        <button
          type="button"
          onClick={onSubmit}
          disabled={isSubmitting}
          className="mt-4 inline-flex items-center gap-2 rounded-[10px] border border-primary/20 bg-primary px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary-dim disabled:opacity-40"
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
                {isBusy ? "正在启动扫描" : "准备好开始扫描了吗？"}
              </h3>
              <p className="text-ui-body font-medium leading-relaxed text-ui-muted">
                {isBusy
                  ? "系统正在自动进入扫描阶段，读取目录结构后就会生成第一版整理方案。"
                  : "我会先扫描你的目录，分析现有文件结构，然后再为你提供整理方案。"}
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
                    <Sparkles className="w-4 h-4" /> 开启智能扫描
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {renderNotice}

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
                <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-on-surface/8 transition-opacity",
                  isAssistant ? "bg-surface-container-lowest text-primary" : "bg-primary text-white",
                  isGrouped ? "opacity-0" : "opacity-100"
                )}>
                  {isAssistant ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                </div>
                
                <div
                  className={cn(
                    "max-w-[90%] 2xl:max-w-[84%] rounded-[10px] p-4 text-ui-body leading-relaxed transition-all",
                    isAssistant
                      ? "border border-on-surface/8 bg-surface-container-lowest text-on-surface"
                      : "bg-surface-container-high text-on-surface font-medium whitespace-pre-wrap",
                    isGrouped && isAssistant && "rounded-tl-[4px]",
                    isGrouped && !isAssistant && "rounded-tr-[4px]"
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
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-on-surface/8 bg-surface-container-lowest text-primary">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 rounded-[10px] border border-on-surface/8 bg-surface-container-lowest p-4 text-ui-body leading-relaxed text-on-surface">
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
                  <span className="ml-1 text-[12px] font-medium">AI 正在整理回复...</span>
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
                key="composer-status-bubble"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mb-4 flex items-start gap-3 rounded-[10px] border border-primary/12 bg-primary/[0.05] px-4 py-3 text-[13px] text-primary"
              >
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                <div className="space-y-1">
                  <p className="font-semibold">{composerStatus.label}</p>
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
                className="mb-4 flex items-center gap-2 rounded-[10px] border border-warning/12 bg-warning-container/16 px-4 py-2.5 text-[12px] font-medium text-warning"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                还有 {unresolvedCount} 项待确认
              </motion.div>
            ) : (unresolvedCount === 0 && stage === "planning" && composerMode === "editable") ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mb-3 flex items-center gap-2.5 px-1 text-[12px] font-medium text-ui-muted"
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
              "relative flex items-end rounded-[12px] border px-3 pb-1.5 pt-1.5 transition-all duration-300",
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
                  "mb-1.5 mr-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] transition-all active:scale-90",
                  messageInput.trim() && !isComposerLocked
                    ? "bg-primary text-white shadow-[0_4px_12px_rgba(76,98,88,0.16)]"
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
