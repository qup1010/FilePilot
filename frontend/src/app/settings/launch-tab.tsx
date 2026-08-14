"use client";

import Link from "next/link";
import {
  BookOpenCheck,
  FolderOpen,
  Settings as SettingsIcon,
  SlidersHorizontal,
} from "lucide-react";

import {
  FieldGroup,
  InputShell,
  SettingsSection,
  StrategyOptionButton,
  ToggleSwitch,
} from "@/components/settings/settings-primitives";
import {
  buildStrategySummary,
  CAUTION_LEVEL_OPTIONS,
  DENSITY_OPTIONS,
  getSuggestedSelection,
  getTemplateMeta,
  LANGUAGE_OPTIONS,
  PREFIX_STYLE_OPTIONS,
  STRATEGY_TEMPLATES,
} from "@/lib/strategy-templates";
import { cn } from "@/lib/utils";
import type { SettingsSnapshot } from "@/types/settings";
import type { OrganizeMethod } from "@/types/session";

export type LaunchSection = "strategy" | "placement";

const LAUNCH_SECTIONS: Array<{
  id: LaunchSection;
  label: string;
  description: string;
  icon: typeof SettingsIcon;
}> = [
  { id: "strategy", label: "启动策略", description: "模板、语言、粒度", icon: SlidersHorizontal },
  { id: "placement", label: "放置规则", description: "新目录与待确认区", icon: FolderOpen },
];

export interface LaunchTabProps {
  globalConfig: SettingsSnapshot["global_config"];
  activeSection: LaunchSection;
  onSelectSection: (section: LaunchSection) => void;
  onUpdateGlobal: (key: string, value: unknown) => void;
  onPickDirectory: () => Promise<string | null>;
}

export function LaunchTab({
  globalConfig,
  activeSection,
  onSelectSection,
  onUpdateGlobal,
  onPickDirectory,
}: LaunchTabProps) {
  const launchTemplate = getTemplateMeta(globalConfig.LAUNCH_DEFAULT_TEMPLATE_ID ?? "general_downloads");
  const launchDefaultOrganizeMethod = (
    globalConfig.LAUNCH_DEFAULT_ORGANIZE_METHOD === "assign_into_existing_categories"
      ? "assign_into_existing_categories"
      : "categorize_into_new_structure"
  ) satisfies OrganizeMethod;
  const launchDefaultTargetProfileId = String(globalConfig.LAUNCH_DEFAULT_TARGET_PROFILE_ID ?? "");
  const launchDefaultOrganizeMode = launchDefaultOrganizeMethod === "assign_into_existing_categories" ? "incremental" : "initial";
  const launchReviewFollowsNewRoot = globalConfig.LAUNCH_REVIEW_FOLLOWS_NEW_ROOT !== false;
  const launchDefaultNewDirectoryRoot = String(globalConfig.LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT ?? "");
  const launchDefaultReviewRoot = String(globalConfig.LAUNCH_DEFAULT_REVIEW_ROOT ?? "");
  const launchDerivedReviewRoot = launchDefaultNewDirectoryRoot
    ? `${launchDefaultNewDirectoryRoot.replace(/[\\/]$/, "")}/Review`
    : "新目录生成位置/Review";
  const launchStrategyPreview = buildStrategySummary({
    template_id: globalConfig.LAUNCH_DEFAULT_TEMPLATE_ID ?? "general_downloads",
    organize_mode: launchDefaultOrganizeMode,
    task_type: launchDefaultOrganizeMethod === "assign_into_existing_categories" ? "organize_into_existing" : "organize_full_directory",
    organize_method: launchDefaultOrganizeMethod,
    target_profile_id: launchDefaultTargetProfileId || undefined,
    destination_index_depth: 2,
    language: globalConfig.LAUNCH_DEFAULT_LANGUAGE ?? "zh",
    density: globalConfig.LAUNCH_DEFAULT_DENSITY ?? "normal",
    prefix_style: globalConfig.LAUNCH_DEFAULT_PREFIX_STYLE ?? "none",
    caution_level: globalConfig.LAUNCH_DEFAULT_CAUTION_LEVEL ?? "balanced",
    note: globalConfig.LAUNCH_DEFAULT_NOTE ?? "",
  });

  return (
    <SettingsSection
      icon={SettingsIcon}
      title="任务默认策略"
      description="配置新建任务时的默认整理方式、模板与放置规则。如需管理目标分类目录，请前往「分类规则」页面。"
    >
      <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-4">
        <div className="grid gap-2 md:grid-cols-2">
          {LAUNCH_SECTIONS.map((section) => {
            const active = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onSelectSection(section.id)}
                className={cn(
                  "flex min-h-[58px] items-center gap-3 rounded-[8px] border px-3 py-2 text-left transition-colors",
                  active
                    ? "border-primary/28 bg-primary/8 text-primary"
                    : "border-on-surface/8 bg-surface-container-lowest text-on-surface hover:border-primary/18 hover:bg-surface-container-low",
                )}
              >
                <section.icon className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[13px] font-black">{section.label}</p>
                  <p className="mt-1 truncate text-[11px] font-medium text-ui-muted">{section.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {activeSection === "strategy" && (
        <div className="space-y-4">
          <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">{launchTemplate.label}</span>
              <span className="rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">{launchStrategyPreview.organize_mode_label}</span>
              <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">{launchStrategyPreview.language_label}</span>
              <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">{launchStrategyPreview.density_label}</span>
              <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">{launchStrategyPreview.prefix_style_label}</span>
              <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">{launchStrategyPreview.caution_level_label}</span>
            </div>
          </div>
          <FieldGroup label="默认整理方式">
            <div className="grid gap-3 md:grid-cols-2">
              <StrategyOptionButton
                active={launchDefaultOrganizeMethod === "categorize_into_new_structure"}
                label="全新分类整理"
                description="AI 自动按内容生成一套清晰的新文件夹结构，适合整理混乱的下载或杂物文件夹。"
                onClick={() => onUpdateGlobal("LAUNCH_DEFAULT_ORGANIZE_METHOD", "categorize_into_new_structure")}
              />
              <StrategyOptionButton
                active={launchDefaultOrganizeMethod === "assign_into_existing_categories"}
                label="按固定规则归档"
                description="按已设定好的分类规则自动分发到指定目标文件夹，适合日常规律归档。"
                onClick={() => onUpdateGlobal("LAUNCH_DEFAULT_ORGANIZE_METHOD", "assign_into_existing_categories")}
              />
            </div>
          </FieldGroup>

          {launchDefaultOrganizeMethod === "assign_into_existing_categories" ? (
            <div className="rounded-[12px] border border-primary/15 bg-primary/[0.04] px-4 py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-on-surface">
                    <BookOpenCheck className="h-4 w-4 text-primary" aria-hidden />
                    分类规则
                  </h3>
                  <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/70">
                    目标目录、规则文案与默认配置请在「分类规则」页管理。默认配置会影响一键整理与直启。
                  </p>
                </div>
                <Link
                  href="/rules"
                  className="shrink-0 rounded-[8px] border border-primary/30 bg-surface px-3 py-1.5 text-[12px] font-bold text-primary transition-colors hover:bg-primary/5"
                >
                  打开分类规则
                </Link>
              </div>
            </div>
          ) : null}

          <FieldGroup label="默认模板">
            <div className="grid gap-2 xl:grid-cols-2">
              {STRATEGY_TEMPLATES.map((template) => (
                <StrategyOptionButton
                  key={template.id}
                  active={globalConfig.LAUNCH_DEFAULT_TEMPLATE_ID === template.id}
                  label={template.label}
                  description={template.description}
                  onClick={() => {
                    const suggested = getSuggestedSelection(template.id);
                    onUpdateGlobal("LAUNCH_DEFAULT_TEMPLATE_ID", template.id);
                    onUpdateGlobal("LAUNCH_DEFAULT_LANGUAGE", suggested.language);
                    onUpdateGlobal("LAUNCH_DEFAULT_DENSITY", suggested.density);
                    onUpdateGlobal("LAUNCH_DEFAULT_PREFIX_STYLE", suggested.prefix_style);
                    onUpdateGlobal("LAUNCH_DEFAULT_CAUTION_LEVEL", suggested.caution_level);
                  }}
                />
              ))}
            </div>
          </FieldGroup>
          <div className="grid gap-3 xl:grid-cols-4">
            {[
              { label: "目录语言", key: "LAUNCH_DEFAULT_LANGUAGE", options: LANGUAGE_OPTIONS },
              { label: "分类粒度", key: "LAUNCH_DEFAULT_DENSITY", options: DENSITY_OPTIONS },
              { label: "目录前缀", key: "LAUNCH_DEFAULT_PREFIX_STYLE", options: PREFIX_STYLE_OPTIONS },
              { label: "归档倾向", key: "LAUNCH_DEFAULT_CAUTION_LEVEL", options: CAUTION_LEVEL_OPTIONS },
            ].map((group) => (
              <FieldGroup key={group.key} label={group.label}>
                <div className="grid gap-1.5">
                  {group.options.map((option) => {
                    const active = globalConfig[group.key] === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => onUpdateGlobal(group.key, option.id)}
                        className={cn(
                          "rounded-[6px] border px-3 py-2 text-left transition-colors",
                          active
                            ? "border-primary/35 bg-primary/[0.06] text-primary"
                            : "border-on-surface/8 bg-surface-container-lowest text-on-surface hover:border-primary/20",
                        )}
                      >
                        <span className="text-[12px] font-black">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </FieldGroup>
            ))}
          </div>
          <FieldGroup label="补充说明">
            <textarea
              value={globalConfig.LAUNCH_DEFAULT_NOTE ?? ""}
              onChange={(event) => onUpdateGlobal("LAUNCH_DEFAULT_NOTE", event.target.value.slice(0, 200))}
              className="min-h-24 w-full resize-none rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3 text-[13px] leading-6 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary focus:ring-4 focus:ring-primary/5"
              placeholder="例如：拿不准的先放待确认区，课程资料尽量按学期整理。"
            />
          </FieldGroup>
        </div>
      )}

      {activeSection === "placement" && (
        <div className="space-y-4">
          <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-4">
            <div className="mb-4">
              <h3 className="text-[13px] font-semibold text-on-surface">默认放置规则</h3>
              <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
                这里只定义新任务的默认落点；任务页仍然可以按单次任务覆盖。
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <FieldGroup label="默认新目录生成位置" hint="留空时，将默认保存在源文件夹同级或任务输出目录下；支持在此自定义固定整理落点。">
                <InputShell icon={FolderOpen} className="flex items-center">
                  <input
                    value={launchDefaultNewDirectoryRoot}
                    onChange={(event) => onUpdateGlobal("LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT", event.target.value)}
                    className="flex-1 bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                    placeholder="例如：D:/archive/sorted"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        const selected = await onPickDirectory();
                        if (selected) {
                          onUpdateGlobal("LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT", selected);
                        }
                      })();
                    }}
                    className="ml-2 shrink-0 rounded-[4px] border border-on-surface/10 bg-surface px-2.5 py-1 text-[11px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary active:scale-95"
                  >
                    浏览...
                  </button>
                </InputShell>
              </FieldGroup>
              <FieldGroup
                label="默认待确认区位置"
                hint={
                  launchReviewFollowsNewRoot
                    ? `当前会自动跟随新目录位置，默认使用 ${launchDerivedReviewRoot}。`
                    : "只在关闭“跟随新目录位置”后单独生效。"
                }
              >
                <InputShell icon={FolderOpen} className="flex items-center">
                  <input
                    value={launchDefaultReviewRoot}
                    onChange={(event) => onUpdateGlobal("LAUNCH_DEFAULT_REVIEW_ROOT", event.target.value)}
                    disabled={launchReviewFollowsNewRoot}
                    className="flex-1 bg-transparent py-2 text-sm font-semibold text-on-surface outline-none disabled:opacity-60"
                    placeholder={launchReviewFollowsNewRoot ? launchDerivedReviewRoot : "例如：D:/archive/review"}
                  />
                  <button
                    type="button"
                    disabled={launchReviewFollowsNewRoot}
                    onClick={() => {
                      void (async () => {
                        const selected = await onPickDirectory();
                        if (selected) {
                          onUpdateGlobal("LAUNCH_DEFAULT_REVIEW_ROOT", selected);
                        }
                      })();
                    }}
                    className="ml-2 shrink-0 rounded-[4px] border border-on-surface/10 bg-surface px-2.5 py-1 text-[11px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                  >
                    浏览...
                  </button>
                </InputShell>
              </FieldGroup>
            </div>
            <div className="mt-4 rounded-[12px] border border-on-surface/8 bg-surface-container-low px-4 py-3.5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-[13px] font-semibold text-on-surface">待确认区跟随新目录位置</h3>
                  <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
                    开启后，分类不确定或拿不准的文件会自动暂存至 `新目录/Review` 待确认文件夹，不打乱主目录结构。
                  </p>
                </div>
                <ToggleSwitch
                  checked={launchReviewFollowsNewRoot}
                  onClick={() => onUpdateGlobal("LAUNCH_REVIEW_FOLLOWS_NEW_ROOT", !launchReviewFollowsNewRoot)}
                  ariaLabel="待确认区跟随新目录位置"
                />
              </div>
            </div>
          </div>
          <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-3.5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[13px] font-semibold text-on-surface">跳过启动确认直接整理</h3>
                <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">开启后，在首页选择文件夹并点击开始时，将直接使用上述默认策略运行，不再弹出确认窗口。</p>
              </div>
              <ToggleSwitch
                checked={Boolean(globalConfig.LAUNCH_SKIP_STRATEGY_PROMPT)}
                onClick={() => onUpdateGlobal("LAUNCH_SKIP_STRATEGY_PROMPT", !globalConfig.LAUNCH_SKIP_STRATEGY_PROMPT)}
                ariaLabel="跳过启动确认直接整理"
              />
            </div>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
