"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpenCheck, Check, Folder, Loader2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";

import { createApiClient } from "@/lib/api";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import { getPathBasename } from "@/lib/path-normalization";
import { localizeUserFacingError } from "@/lib/user-facing-copy";
import { cn } from "@/lib/utils";
import type { RuleDraftItem, TargetProfile } from "@/types/session";

interface DraftState {
  loading: boolean;
  items: Record<string, RuleDraftItem>;
  error: string | null;
}

function ruleCompletion(profile: TargetProfile): { total: number; filled: number } {
  const total = profile.directories.length;
  const filled = profile.directories.filter((item) => String(item.description || "").trim()).length;
  return { total, filled };
}

export default function RulesPage() {
  const api = useMemo(() => createApiClient(getApiBaseUrl(), getApiToken()), []);
  const [profiles, setProfiles] = useState<TargetProfile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editedDescriptions, setEditedDescriptions] = useState<Record<string, string>>({});
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [savedProfileId, setSavedProfileId] = useState<string | null>(null);
  const [draftsByProfile, setDraftsByProfile] = useState<Record<string, DraftState>>({});

  const loadProfiles = useCallback(async () => {
    try {
      setLoadError(null);
      const items = await api.getTargetProfiles();
      setProfiles(items);
    } catch (err: unknown) {
      setLoadError(localizeUserFacingError(err, "读取目录规则失败，请稍后重试。"));
      setProfiles([]);
    }
  }, [api]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const editKey = (profileId: string, path: string) => `${profileId}::${path}`;

  const descriptionFor = (profile: TargetProfile, path: string): string => {
    const key = editKey(profile.profile_id, path);
    if (key in editedDescriptions) return editedDescriptions[key];
    return String(profile.directories.find((item) => item.path === path)?.description || "");
  };

  const profileHasEdits = (profile: TargetProfile): boolean =>
    profile.directories.some((item) => {
      const key = editKey(profile.profile_id, item.path);
      return key in editedDescriptions && editedDescriptions[key] !== String(item.description || "");
    });

  async function handleGenerateDrafts(profile: TargetProfile) {
    setDraftsByProfile((prev) => ({
      ...prev,
      [profile.profile_id]: { loading: true, items: prev[profile.profile_id]?.items || {}, error: null },
    }));
    try {
      const result = await api.generateProfileRuleDrafts(profile.profile_id);
      const items: Record<string, RuleDraftItem> = {};
      for (const item of result.items) {
        if (item.draft_description) items[item.path] = item;
      }
      setDraftsByProfile((prev) => ({ ...prev, [profile.profile_id]: { loading: false, items, error: null } }));
    } catch (err: unknown) {
      setDraftsByProfile((prev) => ({
        ...prev,
        [profile.profile_id]: {
          loading: false,
          items: prev[profile.profile_id]?.items || {},
          error: localizeUserFacingError(err, "生成规则初稿失败，请确认模型配置后重试。"),
        },
      }));
    }
  }

  async function handleSaveProfile(profile: TargetProfile) {
    setSavingProfileId(profile.profile_id);
    setSavedProfileId(null);
    try {
      const directories = profile.directories.map((item) => ({
        ...item,
        description: descriptionFor(profile, item.path).trim(),
      }));
      await api.updateTargetProfile(profile.profile_id, { directories });
      setEditedDescriptions((prev) => {
        const next = { ...prev };
        for (const item of profile.directories) {
          delete next[editKey(profile.profile_id, item.path)];
        }
        return next;
      });
      await loadProfiles();
      setSavedProfileId(profile.profile_id);
    } catch (err: unknown) {
      setLoadError(localizeUserFacingError(err, "保存规则失败，请再试一次。"));
    } finally {
      setSavingProfileId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-surface px-6 py-6">
      <div className="mx-auto w-full max-w-[860px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-[20px] font-black text-on-surface">
              <BookOpenCheck className="h-5 w-5 text-primary" aria-hidden />
              分类规则
            </h1>
            <p className="mt-1 text-[13px] leading-6 text-on-surface-variant/70">
              每个目标目录一条规则：什么样的文件应该放进这里。规则写好后即可放心一键整理——AI 只会把文件分到这些目录中，最差的情况也只是分得不够准。
            </p>
          </div>
          <Link
            href="/settings?tab=targets"
            className="shrink-0 rounded-[8px] border border-on-surface/10 px-3 py-1.5 text-[12px] font-bold text-on-surface-variant transition-colors hover:border-primary/40 hover:text-on-surface"
          >
            管理目录池
          </Link>
        </div>

        {loadError ? (
          <div className="mt-4 flex items-center gap-2 rounded-[8px] border border-error/30 bg-error/5 px-3 py-2 text-[12px] font-semibold text-error">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
            {loadError}
          </div>
        ) : null}

        {profiles === null ? (
          <div className="mt-10 flex items-center justify-center gap-2 text-[13px] font-semibold text-on-surface-variant/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            正在读取目录规则
          </div>
        ) : profiles.length === 0 ? (
          <div className="mt-8 rounded-[10px] border border-dashed border-on-surface/15 px-6 py-10 text-center">
            <p className="text-[15px] font-black text-on-surface">先建立你的目录规则</p>
            <p className="mx-auto mt-2 max-w-[460px] text-[13px] leading-6 text-on-surface-variant/70">
              在设置中创建一组目标目录（例如 文档、软件安装包、图片），回到这里为每个目录写一句规则，之后就能对下载目录一键整理。
            </p>
            <Link
              href="/settings?tab=targets"
              className="mt-4 inline-block rounded-[8px] bg-primary px-4 py-2 text-[13px] font-bold text-on-primary transition-opacity hover:opacity-90"
            >
              去创建目标目录
            </Link>
          </div>
        ) : (
          profiles.map((profile) => {
            const completion = ruleCompletion(profile);
            const drafts = draftsByProfile[profile.profile_id];
            const isComplete = completion.total > 0 && completion.filled === completion.total;
            return (
              <section key={profile.profile_id} className="mt-6 rounded-[10px] border border-on-surface/8 bg-surface-container-lowest p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[15px] font-black text-on-surface">{profile.name}</h2>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-bold",
                        isComplete ? "bg-primary/10 text-primary" : "bg-on-surface/5 text-on-surface-variant/70",
                      )}
                    >
                      规则 {completion.filled}/{completion.total}
                    </span>
                    {!isComplete ? (
                      <span className="text-[11px] font-semibold text-on-surface-variant/60">补全后才能一键整理</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleGenerateDrafts(profile)}
                      disabled={Boolean(drafts?.loading)}
                      className="flex items-center gap-1.5 rounded-[8px] border border-primary/30 px-3 py-1.5 text-[12px] font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
                    >
                      {drafts?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
                      {drafts?.loading ? "正在阅读目录内容…" : "AI 生成规则初稿"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveProfile(profile)}
                      disabled={savingProfileId === profile.profile_id || !profileHasEdits(profile)}
                      className="flex items-center gap-1.5 rounded-[8px] bg-primary px-3 py-1.5 text-[12px] font-bold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {savingProfileId === profile.profile_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : savedProfileId === profile.profile_id && !profileHasEdits(profile) ? (
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      ) : null}
                      保存规则
                    </button>
                  </div>
                </div>

                {drafts?.error ? (
                  <p className="mt-2 text-[12px] font-semibold text-error">{drafts.error}</p>
                ) : null}

                <div className="mt-3 space-y-3">
                  {profile.directories.map((directory) => {
                    const draft = drafts?.items[directory.path];
                    const currentValue = descriptionFor(profile, directory.path);
                    return (
                      <div key={directory.path} className="rounded-[8px] border border-on-surface/8 bg-surface p-3">
                        <div className="flex items-center gap-2">
                          <Folder className="h-4 w-4 shrink-0 text-on-surface-variant/50" aria-hidden />
                          <span className="text-[13px] font-bold text-on-surface">
                            {directory.label || getPathBasename(directory.path) || directory.path}
                          </span>
                          <span className="truncate font-mono text-[11px] text-on-surface-variant/50" title={directory.path}>
                            {directory.path}
                          </span>
                          {!currentValue.trim() ? (
                            <span className="ml-auto shrink-0 rounded-full bg-error/10 px-2 py-0.5 text-[11px] font-bold text-error">缺规则</span>
                          ) : null}
                        </div>
                        <textarea
                          value={currentValue}
                          onChange={(event) =>
                            setEditedDescriptions((prev) => ({
                              ...prev,
                              [editKey(profile.profile_id, directory.path)]: event.target.value,
                            }))
                          }
                          rows={2}
                          placeholder="什么样的文件应该放进这里？（例如：技术手册、API 文档等 PDF/Word 资料；发票类除外）"
                          className="mt-2 w-full resize-y rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-3 py-2 text-[13px] leading-6 text-on-surface outline-none transition-colors focus:border-primary/40 placeholder:text-on-surface-variant/35"
                        />
                        {draft ? (
                          <div className="mt-2 rounded-[8px] border border-primary/20 bg-primary/5 p-2.5">
                            <p className="text-[12px] font-semibold leading-5 text-on-surface">{draft.draft_description}</p>
                            {draft.basis ? (
                              <p className="mt-1 text-[11px] leading-5 text-on-surface-variant/70">依据：{draft.basis}</p>
                            ) : null}
                            <button
                              type="button"
                              onClick={() =>
                                setEditedDescriptions((prev) => ({
                                  ...prev,
                                  [editKey(profile.profile_id, directory.path)]: draft.draft_description || "",
                                }))
                              }
                              className="mt-1.5 flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-primary/10"
                            >
                              <RefreshCw className="h-3 w-3" aria-hidden />
                              采纳这条初稿
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
