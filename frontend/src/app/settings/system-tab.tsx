"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ClipboardCopy,
  Github,
  Globe,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SettingsSection, ToggleSwitch } from "@/components/settings/settings-primitives";
import { cn } from "@/lib/utils";
import type { UiLanguagePreference } from "@/i18n/locales";
import { useTranslation } from "react-i18next";

export type UpdateCheckResult = {
  hasUpdate: boolean;
  version: string;
  body?: string;
  url?: string;
};

export interface SystemTabProps {
  appVersion: string;
  checkingUpdate: boolean;
  cooldown: number;
  updateResult: UpdateCheckResult | null;
  updateError: string | null;
  debugMode: boolean;
  uiLanguage: UiLanguagePreference;
  runtimeLogPath: string;
  debugLogPath: string;
  onCheckUpdate: () => void;
  onOpenLink: (url: string, event: ReactMouseEvent) => void;
  onToggleDebugMode: () => void;
  onChangeUiLanguage: (language: UiLanguagePreference) => void;
  onCopyPath: (path: string) => void;
}

export function SystemTab({
  appVersion,
  checkingUpdate,
  cooldown,
  updateResult,
  updateError,
  debugMode,
  uiLanguage,
  runtimeLogPath,
  debugLogPath,
  onCheckUpdate,
  onOpenLink,
  onToggleDebugMode,
  onChangeUiLanguage,
  onCopyPath,
}: SystemTabProps) {
  const { t } = useTranslation("common");

  return (
    <SettingsSection
      icon={ShieldCheck}
      title={t("settingsPage.categories.system.label")}
      description={t("settingsPage.categories.system.description")}
    >
      <div className="rounded-[12px] border border-on-surface/8 bg-surface p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-[13px] font-semibold text-on-surface">{t("settingsPage.systemTab.languageTitle")}</h3>
            <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
              {t("settingsPage.systemTab.languageDescription")}
            </p>
          </div>
          <select
            aria-label={t("settingsPage.systemTab.languageTitle")}
            value={uiLanguage}
            onChange={(event) => onChangeUiLanguage(event.target.value as UiLanguagePreference)}
            className="h-9 min-w-44 rounded-[8px] border border-on-surface/10 bg-surface-container-lowest px-3 text-[12px] font-semibold text-on-surface outline-none focus:border-primary/40"
          >
            <option value="system">{t("language.system")}</option>
            <option value="zh-CN">{t("language.zhCN")}</option>
            <option value="en">{t("language.english")}</option>
          </select>
        </div>
      </div>

      {/* 1. 关于与检查更新卡片 */}
      <div className="rounded-[12px] border border-on-surface/8 bg-surface p-4">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          {/* 左侧：应用品牌与版本信息 */}
          <div className="flex items-center gap-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px] border border-on-surface/8 bg-surface-container-low p-2.5 shadow-sm transition-all hover:shadow-md">
              <img
                src="/app-icon.png"
                alt="FilePilot Logo"
                className="h-full w-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const parent = e.currentTarget.parentElement;
                  if (parent) {
                    const fallback = document.createElement('div');
                    fallback.className = 'text-primary';
                    fallback.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-cpu h-6 w-6"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3"/><path d="M15 1v3"/><path d="M9 20v3"/><path d="M15 20v3"/><path d="M20 9h3"/><path d="M20 15h3"/><path d="M1 9h3"/><path d="M1 15h3"/></svg>`;
                    parent.appendChild(fallback);
                  }
                }}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-bold text-on-surface">FilePilot</h3>
                <span className="rounded-[6px] bg-primary/10 px-2 py-0.5 text-[11px] font-black text-primary uppercase">
                  {appVersion}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
                {t("settingsPage.systemTab.appTagline")}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <a
                  href="https://github.com/qup1010/FilePilot"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => onOpenLink("https://github.com/qup1010/FilePilot", e)}
                  className="inline-flex items-center gap-1.5 text-[12px] font-bold text-primary transition-colors hover:text-primary-dim hover:underline"
                >
                  <Github className="h-3.5 w-3.5" />
                  {t("settingsPage.systemTab.githubRepository")}
                </a>
              </div>
            </div>
          </div>

          {/* 右侧：检查更新操作与提示 */}
          <div className="flex flex-col items-end shrink-0">
            <Button
              type="button"
              onClick={onCheckUpdate}
              disabled={checkingUpdate || cooldown > 0}
              className={cn(
                "h-9 px-4 text-[12px] font-bold transition-all",
                cooldown > 0
                  ? "border border-on-surface/8 bg-surface-container-low text-ui-muted"
                  : "border border-primary/20 bg-primary hover:bg-primary-dim text-white"
              )}
            >
              {checkingUpdate ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("settingsPage.systemTab.checkingUpdates")}
                </span>
              ) : cooldown > 0 ? (
                t("settingsPage.systemTab.checkUpdatesAgain")
              ) : (
                <span className="flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("settingsPage.systemTab.checkForUpdates")}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* 检查更新结果展开项 */}
        {updateResult && (
          <div className="mt-4 pt-4 border-t border-on-surface/6">
            {updateResult.hasUpdate ? (
              <div className="rounded-[8px] border border-primary/25 bg-primary/[0.02] p-3">
                <div className="flex items-center gap-2 text-[13px] font-bold text-primary">
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  {t("settingsPage.systemTab.updateAvailable", { version: updateResult.version })}
                </div>
                {updateResult.body && (
                  <div className="mt-2 max-h-36 overflow-y-auto rounded-[8px] bg-surface-container-lowest/50 p-2.5 font-mono text-[11px] leading-5 text-on-surface-variant/75 border border-on-surface/4">
                    <div className="font-semibold text-on-surface text-[11px] mb-1">
                      {t("settingsPage.systemTab.releaseNotes")}
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-[11px] text-on-surface-variant">{updateResult.body}</pre>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-end">
                  <a
                    href={updateResult.url || "https://github.com/qup1010/FilePilot/releases"}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => onOpenLink(updateResult.url || "https://github.com/qup1010/FilePilot/releases", e)}
                    className="inline-flex items-center gap-1 rounded-[6px] border border-primary/20 bg-primary/8 px-3 py-1.5 text-[12px] font-bold text-primary transition-colors hover:bg-primary/14"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {t("settingsPage.systemTab.downloadUpdate")}
                  </a>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-3 py-2.5 text-[12px] font-semibold text-on-surface-variant/80">
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                {t("settingsPage.systemTab.upToDate", { version: updateResult.version })}
              </div>
            )}
          </div>
        )}

        {/* 异常警示展开项 */}
        {updateError && (
          <div className="mt-4 pt-4 border-t border-on-surface/6">
            <div className="rounded-[8px] border border-yellow-500/20 bg-yellow-500/[0.02] p-3 text-[12px] leading-relaxed text-on-surface-variant">
              <div className="flex items-center gap-2 font-bold text-yellow-600 dark:text-yellow-500 mb-1">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {t("settingsPage.systemTab.updateFailed")}
              </div>
              <p className="text-[12px] text-on-surface-variant/80">
                {updateError}
              </p>
              <div className="mt-2.5 flex justify-end">
                <a
                  href="https://github.com/qup1010/FilePilot/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => onOpenLink("https://github.com/qup1010/FilePilot/releases", e)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-yellow-600 dark:text-yellow-500 underline transition-colors hover:text-yellow-700 dark:hover:text-yellow-400"
                >
                  {t("settingsPage.systemTab.checkReleasesManually")}
                  <ChevronRight className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. 系统日志与调试集成卡片 */}
      <div className="rounded-[12px] border border-on-surface/8 bg-surface p-4">
        {/* 开关调试行 */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-on-surface/6">
          <div>
            <h3 className="text-[13px] font-semibold text-on-surface">
              {t("settingsPage.systemTab.debugModeTitle")}
            </h3>
            <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
              {t("settingsPage.systemTab.debugModeDescription")}
            </p>
          </div>
          <ToggleSwitch
            checked={debugMode}
            onClick={onToggleDebugMode}
            ariaLabel={t("settingsPage.systemTab.debugModeTitle")}
          />
        </div>

        {/* 日志路径行 */}
        <div className="pt-4">
          <div className="mb-3">
            <h3 className="text-[13px] font-semibold text-on-surface">
              {t("settingsPage.systemTab.systemLogPathsTitle")}
            </h3>
            <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
              {t("settingsPage.systemTab.systemLogPathsDescription")}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              {
                label: t("settingsPage.systemTab.runtimeLog"),
                path: runtimeLogPath,
              },
              {
                label: t("settingsPage.systemTab.debugLog"),
                path: debugLogPath,
              },
            ].map((item) => (
              <div key={item.label} className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-black uppercase tracking-[0.15em] text-ui-muted">{item.label}</span>
                  <button
                    type="button"
                    onClick={() => onCopyPath(item.path)}
                    className="inline-flex items-center gap-1 rounded-[6px] border border-on-surface/8 bg-surface px-2.5 py-1 text-[11px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary"
                  >
                    <ClipboardCopy className="h-3 w-3" />
                    {t("settingsPage.systemTab.copyPath")}
                  </button>
                </div>
                <div className="mt-2 break-all font-mono text-[11px] leading-5 text-on-surface-variant/80">
                  {item.path || t("settingsPage.systemTab.notGenerated")}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
