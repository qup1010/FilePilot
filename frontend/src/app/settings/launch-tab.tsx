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
  PREFIX_STYLE_OPTIONS,
  STRATEGY_TEMPLATES,
} from "@/lib/strategy-templates";
import { FOLDER_NAME_LANGUAGE_OPTIONS, resolveFolderNameLanguage } from "@/lib/folder-name-language";
import { cn } from "@/lib/utils";
import type { SettingsSnapshot } from "@/types/settings";
import type { OrganizeMethod } from "@/types/session";
import { useTranslation } from "react-i18next";

export type LaunchSection = "strategy" | "placement";

const LAUNCH_SECTIONS: Array<{
  id: LaunchSection;
  labelKey: string;
  descriptionKey: string;
  icon: typeof SettingsIcon;
}> = [
  { id: "strategy", labelKey: "strategySection", descriptionKey: "strategySectionDescription", icon: SlidersHorizontal },
  { id: "placement", labelKey: "placementSection", descriptionKey: "placementSectionDescription", icon: FolderOpen },
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
  const { t, i18n } = useTranslation("common");
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
    : t("settingsPage.launchTab.newFolderReviewPath");
  const folderNameLanguagePreference = globalConfig.LAUNCH_DEFAULT_LANGUAGE ?? "auto";
  const resolvedFolderNameLanguage = resolveFolderNameLanguage(
    folderNameLanguagePreference,
    i18n.resolvedLanguage || i18n.language,
  );
  const launchStrategyPreview = buildStrategySummary({
    template_id: globalConfig.LAUNCH_DEFAULT_TEMPLATE_ID ?? "general_downloads",
    organize_mode: launchDefaultOrganizeMode,
    task_type: launchDefaultOrganizeMethod === "assign_into_existing_categories" ? "organize_into_existing" : "organize_full_directory",
    organize_method: launchDefaultOrganizeMethod,
    target_profile_id: launchDefaultTargetProfileId || undefined,
    destination_index_depth: 2,
    language: resolvedFolderNameLanguage,
    density: globalConfig.LAUNCH_DEFAULT_DENSITY ?? "normal",
    prefix_style: globalConfig.LAUNCH_DEFAULT_PREFIX_STYLE ?? "none",
    caution_level: globalConfig.LAUNCH_DEFAULT_CAUTION_LEVEL ?? "balanced",
    note: globalConfig.LAUNCH_DEFAULT_NOTE ?? "",
  });

  return (
    <SettingsSection
      icon={SettingsIcon}
      title={t("settingsPage.categories.launch.label")}
      description={t("settingsPage.launchTab.description")}
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
                  <p className="text-[13px] font-bold">{t(`settingsPage.launchTab.${section.labelKey}`)}</p>
                  <p className="mt-1 truncate text-[11px] font-medium text-ui-muted">
                    {t(`settingsPage.launchTab.${section.descriptionKey}`)}
                  </p>
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
              <span className="rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">
                {t(`strategy.templates.${launchTemplate.id}.label`)}
              </span>
              <span className="rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">
                {t(`strategy.taskType.${launchStrategyPreview.task_type}`)}
              </span>
              <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">
                {folderNameLanguagePreference === "auto"
                  ? t("strategy.languageOptions.autoResolved", {
                      language: t(`strategy.languageOptions.${resolvedFolderNameLanguage}`),
                    })
                  : t(`strategy.languageOptions.${folderNameLanguagePreference}`)}
              </span>
              <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">
                {t(`strategy.densityOptions.${globalConfig.LAUNCH_DEFAULT_DENSITY ?? "normal"}`)}
              </span>
              <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">
                {t(`strategy.prefixOptions.${globalConfig.LAUNCH_DEFAULT_PREFIX_STYLE ?? "none"}`)}
              </span>
              <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">
                {t(`strategy.cautionOptions.${globalConfig.LAUNCH_DEFAULT_CAUTION_LEVEL ?? "balanced"}`)}
              </span>
            </div>
          </div>
          <FieldGroup label={t("settingsPage.launchTab.organizationMethod")}>
            <div className="grid gap-3 md:grid-cols-2">
              <StrategyOptionButton
                active={launchDefaultOrganizeMethod === "categorize_into_new_structure"}
                label={t("settingsPage.launchTab.newStructure")}
                description={t("settingsPage.launchTab.newStructureDescription")}
                onClick={() => onUpdateGlobal("LAUNCH_DEFAULT_ORGANIZE_METHOD", "categorize_into_new_structure")}
              />
              <StrategyOptionButton
                active={launchDefaultOrganizeMethod === "assign_into_existing_categories"}
                label={t("settingsPage.launchTab.savedRules")}
                description={t("settingsPage.launchTab.savedRulesDescription")}
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
                    {t("settingsPage.launchTab.rulesHeading")}
                  </h3>
                  <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/70">
                    {t("settingsPage.launchTab.rulesDescription")}
                  </p>
                </div>
                <Link
                  href="/rules"
                  className="shrink-0 rounded-[8px] border border-primary/30 bg-surface px-3 py-1.5 text-[12px] font-bold text-primary transition-colors hover:bg-primary/5"
                >
                  {t("settingsPage.launchTab.openRules")}
                </Link>
              </div>
            </div>
          ) : null}

          <FieldGroup label={t("settingsPage.launchTab.defaultTemplate")}>
            <div className="grid gap-2 xl:grid-cols-2">
              {STRATEGY_TEMPLATES.map((template) => (
                <StrategyOptionButton
                  key={template.id}
                  active={globalConfig.LAUNCH_DEFAULT_TEMPLATE_ID === template.id}
                  label={t(`strategy.templates.${template.id}.label`)}
                  description={t(`strategy.templates.${template.id}.description`)}
                  onClick={() => {
                    const suggested = getSuggestedSelection(template.id);
                    onUpdateGlobal("LAUNCH_DEFAULT_TEMPLATE_ID", template.id);
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
              { labelKey: "folderNameLanguage", hintKey: "folderNameLanguageHint", key: "LAUNCH_DEFAULT_LANGUAGE", options: FOLDER_NAME_LANGUAGE_OPTIONS, optionNamespace: "languageOptions" },
              { labelKey: "categoryDetail", key: "LAUNCH_DEFAULT_DENSITY", options: DENSITY_OPTIONS, optionNamespace: "densityOptions" },
              { labelKey: "prefixStyle", key: "LAUNCH_DEFAULT_PREFIX_STYLE", options: PREFIX_STYLE_OPTIONS, optionNamespace: "prefixOptions" },
              { labelKey: "cautionLevel", key: "LAUNCH_DEFAULT_CAUTION_LEVEL", options: CAUTION_LEVEL_OPTIONS, optionNamespace: "cautionOptions" },
            ].map((group) => (
              <FieldGroup
                key={group.key}
                label={t(`settingsPage.launchTab.${group.labelKey}`)}
                hint={group.hintKey ? t(`settingsPage.launchTab.${group.hintKey}`) : undefined}
              >
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
                        <span className="text-[12px] font-bold">
                          {t(`strategy.${group.optionNamespace}.${option.id}`)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </FieldGroup>
            ))}
          </div>
          <FieldGroup label={t("settingsPage.launchTab.additionalInstructions")}>
            <textarea
              value={globalConfig.LAUNCH_DEFAULT_NOTE ?? ""}
              onChange={(event) => onUpdateGlobal("LAUNCH_DEFAULT_NOTE", event.target.value.slice(0, 200))}
              className="min-h-24 w-full resize-none rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3 text-[13px] leading-6 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary focus:ring-4 focus:ring-primary/5"
              placeholder={t("settingsPage.launchTab.notesPlaceholder")}
            />
          </FieldGroup>
        </div>
      )}

      {activeSection === "placement" && (
        <div className="space-y-4">
          <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-4">
            <div className="mb-4">
              <h3 className="text-[13px] font-semibold text-on-surface">
                {t("settingsPage.launchTab.placementHeading")}
              </h3>
              <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
                {t("settingsPage.launchTab.placementDescription")}
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <FieldGroup
                label={t("settingsPage.launchTab.newFolderLocation")}
                hint={t("settingsPage.launchTab.newFolderLocationHint")}
              >
                <InputShell icon={FolderOpen} className="flex items-center">
                  <input
                    value={launchDefaultNewDirectoryRoot}
                    onChange={(event) => onUpdateGlobal("LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT", event.target.value)}
                    className="flex-1 bg-transparent py-2 text-sm font-semibold text-on-surface outline-none"
                    placeholder={t("settingsPage.launchTab.pathExample")}
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
                    {t("settingsPage.launchTab.browse")}
                  </button>
                </InputShell>
              </FieldGroup>
              <FieldGroup
                label={t("settingsPage.launchTab.reviewLocation")}
                hint={
                  launchReviewFollowsNewRoot
                    ? t("settingsPage.launchTab.reviewFollowsHint", { path: launchDerivedReviewRoot })
                    : t("settingsPage.launchTab.reviewSeparateHint")
                }
              >
                <InputShell icon={FolderOpen} className="flex items-center">
                  <input
                    value={launchDefaultReviewRoot}
                    onChange={(event) => onUpdateGlobal("LAUNCH_DEFAULT_REVIEW_ROOT", event.target.value)}
                    disabled={launchReviewFollowsNewRoot}
                    className="flex-1 bg-transparent py-2 text-sm font-semibold text-on-surface outline-none disabled:opacity-60"
                    placeholder={launchReviewFollowsNewRoot ? launchDerivedReviewRoot : t("settingsPage.launchTab.reviewPathExample")}
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
                    {t("settingsPage.launchTab.browse")}
                  </button>
                </InputShell>
              </FieldGroup>
            </div>
            <div className="mt-4 rounded-[12px] border border-on-surface/8 bg-surface-container-low px-4 py-3.5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-[13px] font-semibold text-on-surface">
                    {t("settingsPage.launchTab.reviewFollowsNewRoot")}
                  </h3>
                  <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
                    {t("settingsPage.launchTab.reviewFollowsNewRootDescription")}
                  </p>
                </div>
                <ToggleSwitch
                  checked={launchReviewFollowsNewRoot}
                  onClick={() => onUpdateGlobal("LAUNCH_REVIEW_FOLLOWS_NEW_ROOT", !launchReviewFollowsNewRoot)}
                  ariaLabel={t("settingsPage.launchTab.reviewFollowsNewRoot")}
                />
              </div>
            </div>
          </div>
          <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-3.5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[13px] font-semibold text-on-surface">
                  {t("settingsPage.launchTab.skipLaunchConfirmation")}
                </h3>
                <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
                  {t("settingsPage.launchTab.skipLaunchConfirmationDescription")}
                </p>
              </div>
              <ToggleSwitch
                checked={Boolean(globalConfig.LAUNCH_SKIP_STRATEGY_PROMPT)}
                onClick={() => onUpdateGlobal("LAUNCH_SKIP_STRATEGY_PROMPT", !globalConfig.LAUNCH_SKIP_STRATEGY_PROMPT)}
                ariaLabel={t("settingsPage.launchTab.skipLaunchConfirmation")}
              />
            </div>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
