import { Activity, FileText, FolderOpen, Sparkles } from "lucide-react";

import {
  CAUTION_LEVEL_OPTIONS,
  getSuggestedSelection,
  LANGUAGE_OPTIONS,
  PREFIX_STYLE_OPTIONS,
  STRATEGY_TEMPLATES,
} from "@/lib/strategy-templates";
import { cn } from "@/lib/utils";
import type {
  SessionStrategySelection,
  StrategyPrefixStyle,
  StrategyTemplateId,
} from "@/types/session";

interface StrategyStepProps {
  strategy: SessionStrategySelection;
  loading: boolean;
  isFullCategorize: boolean;
  newDirectoryRoot: string;
  previewDirectories: string[] | undefined;
  templateDescription: string;
  onUpdateStrategy: (updater: (previous: SessionStrategySelection) => SessionStrategySelection) => void;
  onOpenAdvancedSettings: () => void;
}

export function StrategyStep({
  strategy,
  loading,
  isFullCategorize,
  newDirectoryRoot,
  previewDirectories,
  templateDescription,
  onUpdateStrategy,
  onOpenAdvancedSettings,
}: StrategyStepProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {isFullCategorize ? (
        <>
          {/* 分类控制参数 */}
          <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[160px] border border-on-surface/5">
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] font-bold text-on-surface flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  分类控制参数
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* 分类模板 */}
                <div className="space-y-1">
                  <div className="text-[11px] font-bold text-on-surface/60">分类模板</div>
                  <select
                    value={strategy.template_id}
                    onChange={(event) => {
                      const tid = event.target.value as StrategyTemplateId;
                      onUpdateStrategy((previous) => ({
                        ...previous,
                        template_id: tid,
                        ...getSuggestedSelection(tid),
                      }));
                    }}
                    disabled={loading}
                    className="h-8.5 w-full rounded-[6px] border border-on-surface/8 bg-surface px-2 text-[12px] font-medium text-on-surface outline-none transition-all focus:border-primary/45 focus:ring-2 focus:ring-primary/5"
                  >
                    {STRATEGY_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 目录语言 */}
                <div className="space-y-1">
                  <div className="text-[11px] font-bold text-on-surface/60">目录语言</div>
                  <div className="flex h-8.5 rounded-[6px] border border-on-surface/8 bg-surface p-0.5 items-center">
                    {LANGUAGE_OPTIONS.map((option) => {
                      const active = strategy.language === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => onUpdateStrategy((prev) => ({ ...prev, language: option.id }))}
                          className={cn(
                            "flex-1 rounded-[4px] h-full text-[12px] transition-all",
                            active
                              ? "bg-primary/10 text-primary font-semibold"
                              : "text-on-surface/60 font-medium hover:text-on-surface"
                          )}
                        >
                          {option.label.replace("目录", "")}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 前缀样式 */}
              <div className="space-y-1">
                <div className="text-[11px] font-bold text-on-surface/60">前缀样式</div>
                <select
                  value={strategy.prefix_style}
                  onChange={(event) => onUpdateStrategy((prev) => ({ ...prev, prefix_style: event.target.value as StrategyPrefixStyle }))}
                  className="h-8.5 w-full rounded-[6px] border border-on-surface/8 bg-surface px-2.5 text-[12px] font-medium text-on-surface outline-none transition-all focus:border-primary/45 focus:ring-2 focus:ring-primary/5"
                >
                  {PREFIX_STYLE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3.5 flex justify-between items-center border-t border-on-surface/5 pt-2">
              <span className="text-[11px] text-on-surface/40 font-medium">微调更多细节？</span>
              <button
                type="button"
                onClick={onOpenAdvancedSettings}
                className="text-[11px] font-bold text-primary hover:underline underline-offset-2"
              >
                更多高级参数...
              </button>
            </div>
          </div>

          {/* 分类样式示例 */}
          <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[220px] border border-on-surface/5">
            <div className="space-y-3">
              <div className="text-[13px] font-black text-on-surface">分类样式示例</div>

              {/* 极简模拟树状图面板 */}
              <div className="rounded-[6px] border border-on-surface/8 bg-surface p-3 font-mono text-[11px] text-on-surface/80 max-h-[140px] overflow-y-auto scrollbar-thin space-y-2">
                {/* 根目录节点 */}
                <div className="flex items-center gap-1.5 text-on-surface-variant/70 font-semibold truncate border-b border-on-surface/5 pb-2">
                  <FolderOpen className="h-3.5 w-3.5 text-primary/60 shrink-0" />
                  <span className="truncate" title={newDirectoryRoot || "D:/Desktop/毕业/毕业答辩PPT"}>
                    {newDirectoryRoot || "D:/Desktop/毕业/毕业答辩PPT"}
                  </span>
                </div>

                {/* 子树节点 */}
                <div className="pl-1.5 space-y-2 pt-0.5">
                  {previewDirectories?.map((directory, idx, arr) => {
                    const isLastDir = idx === arr.length - 1;

                    // 智能模拟子文件类型
                    let mockFile = "相关文档.docx";
                    if (directory.includes("票") || directory.includes("账") || directory.includes("财")) {
                      mockFile = "账单发票.xlsx";
                    } else if (directory.includes("资料") || directory.includes("学习")) {
                      mockFile = "复习课件.pptx";
                    } else if (directory.includes("归") || directory.includes("史") || directory.includes("备份")) {
                      mockFile = "备份归档.zip";
                    } else if (directory.includes("图") || directory.includes("照") || directory.includes("影")) {
                      mockFile = "素材照片.png";
                    }

                    return (
                      <div key={directory} className="space-y-1">
                        {/* 文件夹行 */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-on-surface/20 font-bold font-sans shrink-0">{isLastDir ? "└─" : "├─"}</span>
                          <span className="inline-flex items-center gap-1 rounded-[4px] border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[11px] font-bold text-primary max-w-[85%] truncate">
                            <FolderOpen className="h-3 w-3 shrink-0 text-primary/60" />
                            <span className="truncate">{directory}</span>
                          </span>
                        </div>

                        {/* 模拟文件行 */}
                        <div className="flex items-center gap-1.5 text-[10.5px] text-ui-muted opacity-55" style={{ paddingLeft: "24px" }}>
                          <span className="text-on-surface/20 font-bold font-sans shrink-0">{isLastDir ? "    └─" : "│   └─"}</span>
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate">{mockFile}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[10.5px] font-medium leading-relaxed text-ui-muted truncate" title={templateDescription}>
              {templateDescription}
            </p>
          </div>
        </>
      ) : (
        <>
          {/* 归归档倾向配置 */}
          <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[160px] border border-on-surface/5">
            <div className="space-y-3.5">
              <h2 className="text-[13px] font-black text-on-surface flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-primary" />
                归档倾向配置
              </h2>

              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-ui-muted">分类归档策略</div>
                <div className="grid grid-cols-2 gap-2">
                  {CAUTION_LEVEL_OPTIONS.map((option) => {
                    const active = strategy.caution_level === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => onUpdateStrategy((prev) => ({ ...prev, caution_level: option.id }))}
                        className={cn(
                          "rounded-[6px] border px-2.5 py-1.5 text-left transition-all text-[11px] font-bold",
                          active
                            ? "border-primary/25 bg-primary/10 text-primary"
                            : "border-on-surface/8 bg-surface text-on-surface hover:bg-surface-container-low"
                        )}
                      >
                        <div>{option.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* 任务补充说明 */}
          <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[160px] border border-on-surface/5">
            <div className="space-y-2 flex-1 flex flex-col">
              <div className="text-[11px] font-black text-on-surface flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-primary" />
                补充说明 (可选)
              </div>
              <textarea
                value={strategy.note}
                disabled={loading}
                onChange={(event) => onUpdateStrategy((previous) => ({ ...previous, note: event.target.value.slice(0, 200) }))}
                placeholder="例如：拿不准的先放待确认区；优先归入现有项目目录。"
                className="w-full flex-1 min-h-[80px] resize-none rounded-[6px] border border-on-surface/8 bg-surface px-3 py-2 text-[12px] leading-relaxed text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/30"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
