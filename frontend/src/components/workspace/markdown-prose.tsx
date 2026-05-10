import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type MarkdownDensity = "default" | "compact";

export function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const code = String(children).replace(/\n$/, "");

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-on-surface/10 bg-surface-container-lowest transition-all ring-1 ring-black/[0.02]">
      <div className="flex items-center justify-between border-b border-on-surface/8 bg-on-surface/[0.02] px-3 py-1">
        <div className="flex items-center gap-2">
           <div className="h-1.2 w-1.2 rounded-full bg-primary/40" />
           <span className="text-[9px] font-black uppercase tracking-[0.15em] text-ui-muted opacity-60">Source</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-black text-on-surface/40 transition-all hover:bg-on-surface/5 hover:text-primary active:scale-95"
        >
          {copied ? <Check className="h-3 w-3 text-success-dim" /> : <Copy className="h-3 w-3" />}
          <span className="uppercase tracking-wider">{copied ? "Done" : "Copy"}</span>
        </button>
      </div>
      <pre className={cn("overflow-x-auto scrollbar-none p-3 font-mono text-[11.5px] leading-relaxed text-on-surface/80", className)}>
        {children}
      </pre>
    </div>
  );
}

function CompactCodeBlock({ children }: { children: React.ReactNode }) {
  const code = String(children).replace(/\n$/, "").trim();
  const singleLine = !code.includes("\n");

  if (singleLine && code.length <= 80) {
    return (
      <code className="mx-1 rounded-[5px] border border-primary/12 bg-primary/[0.05] px-1.5 py-0.5 font-mono text-[12px] font-bold text-primary">
        {code}
      </code>
    );
  }

  return (
    <pre className="my-2 max-h-28 overflow-auto rounded-[7px] border border-on-surface/8 bg-surface-container-lowest px-3 py-2 font-mono text-[11px] leading-5 text-on-surface/75 scrollbar-thin">
      {code}
    </pre>
  );
}

export function MarkdownProse({ content, density = "default" }: { content: string; density?: MarkdownDensity }) {
  const compact = density === "compact";

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ node, ...props }) => <div className={cn("mb-1 last:mb-0 text-[13px] text-on-surface/85", compact ? "leading-5" : "leading-6")} {...props} />,
        strong: ({ node, ...props }) => <strong className="font-black text-on-surface tracking-tight" {...props} />,
        em: ({ node, ...props }) => <em className="italic text-on-surface/60 font-medium" {...props} />,
        ul: ({ node, ...props }) => <ul className={cn("mb-2 ml-4 list-disc text-[13px] text-on-surface/80", compact ? "space-y-0" : "space-y-0.5")} {...props} />,
        ol: ({ node, ...props }) => <ol className={cn("mb-2 ml-4 list-decimal text-[13px] text-on-surface/80", compact ? "space-y-0" : "space-y-0.5")} {...props} />,
        li: ({ node, ...props }) => (
          <li className={cn("pl-0.5", compact ? "leading-5" : "leading-6", String(node?.position?.start.line).length > 2 && "ml-4")} {...props} />
        ),
        a: ({ node, ...props }) => (
          <a
            className="text-primary font-black underline underline-offset-4 hover:text-primary-dim transition-all inline-flex items-center gap-1 group/link"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          >
            {props.children}
            <ExternalLink className="w-3 h-3 opacity-30 group-hover/link:opacity-100 transition-opacity" />
          </a>
        ),
        table: ({ node, ...props }) => (
          <div className="my-3 overflow-hidden rounded-lg border border-on-surface/8 bg-surface ring-1 ring-black/[0.01]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[12px]" {...props} />
            </div>
          </div>
        ),
        thead: ({ node, ...props }) => <thead className="bg-on-surface/[0.03] text-[10.5px] font-black uppercase tracking-widest text-ui-muted/70" {...props} />,
        th: ({ node, ...props }) => <th className="px-3 py-2 border-b border-on-surface/5" {...props} />,
        td: ({ node, ...props }) => <td className="px-3 py-2 border-b border-on-surface/[0.02] leading-relaxed font-medium text-on-surface/70" {...props} />,
        hr: ({ node, ...props }) => <hr className="my-4 border-t border-on-surface/8" {...props} />,
        h1: ({ node, ...props }) => <h1 className="mb-2 mt-3 text-[18px] font-black tracking-tight text-on-surface" {...props} />,
        h2: ({ node, ...props }) => <h2 className="mb-1.5 mt-2.5 text-[15px] font-black tracking-tight text-on-surface border-b border-on-surface/8 pb-1 flex items-center gap-2" {...props} />,
        h3: ({ node, ...props }) => (
          <h3 className="mb-1 mt-2 flex items-center gap-2 text-[13.5px] font-black tracking-tight text-on-surface/80" {...props} />
        ),
        blockquote: ({ node, ...props }) => (
          <blockquote className="my-3 rounded-md border-l-4 border-primary/30 bg-primary/[0.01] px-4 py-2 text-[13px] font-medium italic text-on-surface/70 leading-6" {...props} />
        ),
        code: ({ node, inline, className, children, ...props }: any) => {
          if (inline) {
            return <code className="rounded bg-primary/[0.05] px-1 py-0.5 font-mono text-[0.85em] font-black text-primary border border-primary/10 mx-0.5" {...props}>{children}</code>;
          }
          if (compact) {
            return <CompactCodeBlock>{children}</CompactCodeBlock>;
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
