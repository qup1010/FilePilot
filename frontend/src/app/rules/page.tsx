"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  Check,
  Folder,
  FolderPlus,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { createApiClient } from "@/lib/api";
import { getApiBaseUrl, getApiToken, isTauriDesktop, pickDirectoryWithTauri, pickDirectoriesWithTauri } from "@/lib/runtime";
import { getPathBasename } from "@/lib/path-normalization";
import { localizeUserFacingError } from "@/lib/user-facing-copy";
import { cn } from "@/lib/utils";
import type { RuleDraftItem, TargetProfile, TargetProfileDirectory } from "@/types/session";

interface DraftState {
  loading: boolean;
  loadingPath: string | null;
  items: Record<string, RuleDraftItem>;
  error: string | null;
}

const SELECTED_PROFILE_STORAGE_KEY = "filepilot.rules.selected_profile_id";

function ruleCompletion(profile: TargetProfile): { total: number; filled: number } {
  const total = profile.directories.length;
  const filled = profile.directories.filter((item) => String(item.description || "").trim()).length;
  return { total, filled };
}

function directoryTitle(directory: TargetProfileDirectory): string {
  return directory.label || getPathBasename(directory.path) || directory.path;
}

export default function RulesPage() {
  const api = useMemo(() => createApiClient(getApiBaseUrl(), getApiToken()), []);
  const desktopReady = isTauriDesktop();

  const [profiles, setProfiles] = useState<TargetProfile[] | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [defaultProfileId, setDefaultProfileId] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editedDescriptions, setEditedDescriptions] = useState<Record<string, string>>({});
  const [editedName, setEditedName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [draftState, setDraftState] = useState<DraftState>({
    loading: false,
    loadingPath: null,
    items: {},
    error: null,
  });
  const [creating, setCreating] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedProfile = useMemo(
    () => profiles?.find((item) => item.profile_id === selectedProfileId) || profiles?.[0] || null,
    [profiles, selectedProfileId],
  );

  const loadProfiles = useCallback(async () => {
    try {
      setLoadError(null);
      const [items, settings] = await Promise.all([api.getTargetProfiles(), api.getSettings()]);
      setProfiles(items);
      const defaultId = String(settings.global_config?.LAUNCH_DEFAULT_TARGET_PROFILE_ID || "");
      setDefaultProfileId(defaultId);

      const stored =
        typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY) || "" : "";
      const nextSelected =
        (stored && items.some((item) => item.profile_id === stored) && stored) ||
        (defaultId && items.some((item) => item.profile_id === defaultId) && defaultId) ||
        items[0]?.profile_id ||
        "";
      setSelectedProfileId(nextSelected);
    } catch (err: unknown) {
      setLoadError(localizeUserFacingError(err, "读取分类规则失败，请稍后重试。"));
      setProfiles([]);
      setSelectedProfileId("");
    }
  }, [api]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!selectedProfileId || typeof window === "undefined") return;
    window.localStorage.setItem(SELECTED_PROFILE_STORAGE_KEY, selectedProfileId);
  }, [selectedProfileId]);

  useEffect(() => {
    setEditedName(null);
    setDraftState({ loading: false, loadingPath: null, items: {}, error: null });
    setSavedFlash(false);
    setActionError(null);
  }, [selectedProfileId]);

  const editKey = (profileId: string, path: string) => `${profileId}::${path}`;

  const descriptionFor = (profile: TargetProfile, path: string): string => {
    const key = editKey(profile.profile_id, path);
    if (key in editedDescriptions) return editedDescriptions[key];
    return String(profile.directories.find((item) => item.path === path)?.description || "");
  };

  const profileName = selectedProfile
    ? editedName !== null
      ? editedName
      : selectedProfile.name
    : "";

  const hasEdits = Boolean(
    selectedProfile &&
      ((editedName !== null && editedName.trim() !== selectedProfile.name) ||
        selectedProfile.directories.some((item) => {
          const key = editKey(selectedProfile.profile_id, item.path);
          return key in editedDescriptions && editedDescriptions[key] !== String(item.description || "");
        })),
  );

  const completion = selectedProfile ? ruleCompletion({
    ...selectedProfile,
    directories: selectedProfile.directories.map((item) => ({
      ...item,
      description: descriptionFor(selectedProfile, item.path),
    })),
  }) : { total: 0, filled: 0 };
  const isComplete = completion.total > 0 && completion.filled === completion.total;
  const isDefault = Boolean(selectedProfile && selectedProfile.profile_id === defaultProfileId);

  function selectProfile(profileId: string) {
    if (hasEdits && !window.confirm("当前规则尚未保存，切换配置将丢弃未保存的修改。继续？")) {
      return;
    }
    setSelectedProfileId(profileId);
    if (selectedProfile) {
      setEditedDescriptions((prev) => {
        const next = { ...prev };
        for (const item of selectedProfile.directories) {
          delete next[editKey(selectedProfile.profile_id, item.path)];
        }
        return next;
      });
    }
    setEditedName(null);
  }

  async function handleCreateProfile() {
    const name = newProfileName.trim() || "未命名规则";
    setBusy(true);
    setActionError(null);
    try {
      const created = await api.createTargetProfile({ name, directories: [] });
      setNewProfileName("");
      setCreating(false);
      await loadProfiles();
      setSelectedProfileId(created.profile_id);
    } catch (err: unknown) {
      setActionError(localizeUserFacingError(err, "创建规则配置失败，请再试一次。"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProfile() {
    if (!selectedProfile) return;
    if (
      !window.confirm(
        `确定删除规则配置「${selectedProfile.name}」？其中的目录与规则都会被移除（不会删除磁盘上的文件夹）。`,
      )
    ) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const deletedId = selectedProfile.profile_id;
      await api.deleteTargetProfile(deletedId);
      if (defaultProfileId === deletedId) {
        await api.updateSettings({
          global_config: { LAUNCH_DEFAULT_TARGET_PROFILE_ID: "" },
        });
      }
      setEditedDescriptions((prev) => {
        const next = { ...prev };
        for (const item of selectedProfile.directories) {
          delete next[editKey(deletedId, item.path)];
        }
        return next;
      });
      await loadProfiles();
    } catch (err: unknown) {
      setActionError(localizeUserFacingError(err, "删除规则配置失败，请再试一次。"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefault() {
    if (!selectedProfile) return;
    setBusy(true);
    setActionError(null);
    try {
      const nextId = isDefault ? "" : selectedProfile.profile_id;
      await api.updateSettings({
        global_config: { LAUNCH_DEFAULT_TARGET_PROFILE_ID: nextId },
      });
      setDefaultProfileId(nextId);
    } catch (err: unknown) {
      setActionError(localizeUserFacingError(err, "设置默认配置失败，请再试一次。"));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddDirectories() {
    if (!selectedProfile) return;
    setBusy(true);
    setActionError(null);
    try {
      let paths: string[] = [];
      if (desktopReady) {
        const picked = (await pickDirectoriesWithTauri()) || [];
        paths = picked.filter(Boolean);
        if (paths.length === 0) {
          const single = await pickDirectoryWithTauri();
          if (single) paths = [single];
        }
      } else {
        const manual = window.prompt("请输入要添加的目标目录完整路径");
        if (manual?.trim()) paths = [manual.trim()];
      }
      if (paths.length === 0) return;

      const existing = new Set(
        selectedProfile.directories.map((item) => item.path.replace(/[\\/]+$/, "").toLowerCase()),
      );
      const additions: TargetProfileDirectory[] = [];
      for (const path of paths) {
        const normalized = path.replace(/[\\/]+$/, "");
        if (!normalized || existing.has(normalized.toLowerCase())) continue;
        existing.add(normalized.toLowerCase());
        additions.push({
          path: normalized,
          label: getPathBasename(normalized) || normalized,
          description: "",
        });
      }
      if (additions.length === 0) {
        setActionError("这些目录已在当前配置中，或路径无效。");
        return;
      }

      const directories = [
        ...selectedProfile.directories.map((item) => ({
          ...item,
          description: descriptionFor(selectedProfile, item.path).trim(),
        })),
        ...additions,
      ];
      const name = profileName.trim() || selectedProfile.name;
      await api.updateTargetProfile(selectedProfile.profile_id, { name, directories });
      setEditedName(null);
      await loadProfiles();
      setSelectedProfileId(selectedProfile.profile_id);
    } catch (err: unknown) {
      setActionError(localizeUserFacingError(err, "添加目录失败，请再试一次。"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveDirectory(path: string) {
    if (!selectedProfile) return;
    const title = directoryTitle(
      selectedProfile.directories.find((item) => item.path === path) || { path },
    );
    if (!window.confirm(`从当前规则配置中移除「${title}」？（不会删除磁盘文件夹）`)) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const directories = selectedProfile.directories
        .filter((item) => item.path !== path)
        .map((item) => ({
          ...item,
          description: descriptionFor(selectedProfile, item.path).trim(),
        }));
      const name = profileName.trim() || selectedProfile.name;
      await api.updateTargetProfile(selectedProfile.profile_id, { name, directories });
      setEditedDescriptions((prev) => {
        const next = { ...prev };
        delete next[editKey(selectedProfile.profile_id, path)];
        return next;
      });
      setDraftState((prev) => {
        const items = { ...prev.items };
        delete items[path];
        return { ...prev, items };
      });
      await loadProfiles();
      setSelectedProfileId(selectedProfile.profile_id);
    } catch (err: unknown) {
      setActionError(localizeUserFacingError(err, "移除目录失败，请再试一次。"));
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateDrafts(paths?: string[]) {
    if (!selectedProfile) return;
    const singlePath = paths?.length === 1 ? paths[0] : null;
    setDraftState((prev) => ({
      ...prev,
      loading: true,
      loadingPath: singlePath,
      error: null,
    }));
    try {
      const result = await api.generateProfileRuleDrafts(selectedProfile.profile_id, paths);
      setDraftState((prev) => {
        const items = { ...prev.items };
        for (const item of result.items) {
          if (item.draft_description) items[item.path] = item;
        }
        return { loading: false, loadingPath: null, items, error: null };
      });
    } catch (err: unknown) {
      setDraftState((prev) => ({
        ...prev,
        loading: false,
        loadingPath: null,
        error: localizeUserFacingError(err, "生成规则初稿失败，请确认模型配置后重试。"),
      }));
    }
  }

  async function handleSave() {
    if (!selectedProfile || !hasEdits) return;
    setSaving(true);
    setActionError(null);
    setSavedFlash(false);
    try {
      const directories = selectedProfile.directories.map((item) => ({
        ...item,
        description: descriptionFor(selectedProfile, item.path).trim(),
      }));
      const name = profileName.trim() || selectedProfile.name;
      await api.updateTargetProfile(selectedProfile.profile_id, { name, directories });
      setEditedDescriptions((prev) => {
        const next = { ...prev };
        for (const item of selectedProfile.directories) {
          delete next[editKey(selectedProfile.profile_id, item.path)];
        }
        return next;
      });
      setEditedName(null);
      await loadProfiles();
      setSelectedProfileId(selectedProfile.profile_id);
      setSavedFlash(true);
    } catch (err: unknown) {
      setActionError(localizeUserFacingError(err, "保存规则失败，请再试一次。"));
    } finally {
      setSaving(false);
    }
  }

  function acceptDraft(path: string, draftDescription: string) {
    if (!selectedProfile) return;
    setEditedDescriptions((prev) => ({
      ...prev,
      [editKey(selectedProfile.profile_id, path)]: draftDescription,
    }));
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
              管理你的归档方案：切换配置、添加目标目录、为每个目录写规则。AI 只会把文件分到这些目录中；拿不准的会留在待确认区。
            </p>
          </div>
        </div>

        {(loadError || actionError) ? (
          <div className="mt-4 flex items-center gap-2 rounded-[8px] border border-error/30 bg-error/5 px-3 py-2 text-[12px] font-semibold text-error">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
            {actionError || loadError}
          </div>
        ) : null}

        {profiles === null ? (
          <div className="mt-10 flex items-center justify-center gap-2 text-[13px] font-semibold text-on-surface-variant/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            正在读取分类规则
          </div>
        ) : profiles.length === 0 && !creating ? (
          <div className="mt-8 rounded-[10px] border border-dashed border-on-surface/15 px-6 py-10 text-center">
            <p className="text-[15px] font-black text-on-surface">先建立一套分类规则</p>
            <p className="mx-auto mt-2 max-w-[460px] text-[13px] leading-6 text-on-surface-variant/70">
              例如「下载常用」：添加文档、安装包、图片等目标目录，为每个目录写一句规则，之后就能对下载目录一键整理。
            </p>
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setNewProfileName("下载常用");
              }}
              className="mt-4 inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-4 py-2 text-[13px] font-bold text-on-primary transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" aria-hidden />
              新建规则配置
            </button>
          </div>
        ) : (
          <>
            <div className="mt-5 rounded-[10px] border border-on-surface/8 bg-surface-container-lowest p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-[200px] flex-1">
                  <span className="mb-1 block text-[11px] font-bold text-on-surface-variant/60">当前规则配置</span>
                  <select
                    value={selectedProfile?.profile_id || ""}
                    onChange={(event) => selectProfile(event.target.value)}
                    disabled={!profiles.length || busy}
                    className="h-10 w-full rounded-[8px] border border-on-surface/10 bg-surface px-3 text-[13px] font-bold text-on-surface outline-none transition-colors focus:border-primary/40 disabled:opacity-60"
                  >
                    {profiles.map((profile) => {
                      const done = ruleCompletion(profile);
                      const mark = profile.profile_id === defaultProfileId ? " · 默认" : "";
                      return (
                        <option key={profile.profile_id} value={profile.profile_id}>
                          {profile.name}
                          {mark}
                          {`（规则 ${done.filled}/${done.total}）`}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setCreating((prev) => !prev);
                    if (!creating) setNewProfileName("");
                  }}
                  disabled={busy}
                  className="flex h-10 items-center gap-1.5 rounded-[8px] border border-on-surface/10 px-3 text-[12px] font-bold text-on-surface transition-colors hover:border-primary/30 hover:text-primary disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  新建
                </button>
                <button
                  type="button"
                  onClick={() => void handleSetDefault()}
                  disabled={!selectedProfile || busy}
                  className={cn(
                    "flex h-10 items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-bold transition-colors disabled:opacity-50",
                    isDefault
                      ? "border-primary/30 bg-primary/5 text-primary"
                      : "border-on-surface/10 text-on-surface hover:border-primary/30 hover:text-primary",
                  )}
                >
                  <Star className={cn("h-3.5 w-3.5", isDefault && "fill-current")} aria-hidden />
                  {isDefault ? "默认配置" : "设为默认"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteProfile()}
                  disabled={!selectedProfile || busy}
                  className="flex h-10 items-center gap-1.5 rounded-[8px] border border-error/20 px-3 text-[12px] font-bold text-error transition-colors hover:bg-error/5 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  删除
                </button>
              </div>

              {creating ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-primary/15 bg-primary/5 p-3">
                  <input
                    value={newProfileName}
                    onChange={(event) => setNewProfileName(event.target.value)}
                    placeholder="新配置名称，例如：下载常用"
                    className="h-9 min-w-[200px] flex-1 rounded-[8px] border border-on-surface/10 bg-surface px-3 text-[13px] font-semibold text-on-surface outline-none focus:border-primary/40"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateProfile()}
                    disabled={busy}
                    className="h-9 rounded-[8px] bg-primary px-3 text-[12px] font-bold text-on-primary disabled:opacity-50"
                  >
                    {busy ? "创建中…" : "创建"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setNewProfileName("");
                    }}
                    className="h-9 rounded-[8px] border border-on-surface/10 px-3 text-[12px] font-bold text-on-surface-variant"
                  >
                    取消
                  </button>
                </div>
              ) : null}

              {selectedProfile ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="min-w-[180px] flex-1">
                    <span className="mb-1 block text-[11px] font-bold text-on-surface-variant/60">配置名称</span>
                    <input
                      value={profileName}
                      onChange={(event) => setEditedName(event.target.value)}
                      className="h-9 w-full rounded-[8px] border border-on-surface/10 bg-surface px-3 text-[13px] font-semibold text-on-surface outline-none focus:border-primary/40"
                    />
                  </label>
                  <div className="flex items-center gap-2 pt-5">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-bold",
                        isComplete ? "bg-primary/10 text-primary" : "bg-on-surface/5 text-on-surface-variant/70",
                      )}
                    >
                      规则 {completion.filled}/{completion.total}
                    </span>
                    {!isComplete && completion.total > 0 ? (
                      <span className="text-[11px] font-semibold text-on-surface-variant/60">补全后才能一键整理</span>
                    ) : null}
                    {isDefault ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">一键默认</span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {selectedProfile ? (
              <section className="mt-4 rounded-[10px] border border-on-surface/8 bg-surface-container-lowest p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-black text-on-surface">目标目录与规则</h2>
                    <p className="mt-0.5 text-[12px] text-on-surface-variant/65">
                      每个目录一句规则。可整套生成初稿，也可只分析某一个目录。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAddDirectories()}
                      disabled={busy || draftState.loading}
                      className="flex items-center gap-1.5 rounded-[8px] border border-on-surface/10 px-3 py-1.5 text-[12px] font-bold text-on-surface transition-colors hover:border-primary/30 hover:text-primary disabled:opacity-50"
                    >
                      <FolderPlus className="h-3.5 w-3.5" aria-hidden />
                      添加目录
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleGenerateDrafts()}
                      disabled={busy || draftState.loading || selectedProfile.directories.length === 0}
                      className="flex items-center gap-1.5 rounded-[8px] border border-primary/30 px-3 py-1.5 text-[12px] font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
                    >
                      {draftState.loading && !draftState.loadingPath ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {draftState.loading && !draftState.loadingPath ? "正在阅读目录…" : "整套 AI 初稿"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={saving || busy || !hasEdits}
                      className="flex items-center gap-1.5 rounded-[8px] bg-primary px-3 py-1.5 text-[12px] font-bold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : savedFlash && !hasEdits ? (
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      ) : null}
                      保存
                    </button>
                  </div>
                </div>

                {draftState.error ? (
                  <p className="mt-2 text-[12px] font-semibold text-error">{draftState.error}</p>
                ) : null}

                {selectedProfile.directories.length === 0 ? (
                  <div className="mt-4 rounded-[8px] border border-dashed border-on-surface/15 px-4 py-8 text-center">
                    <p className="text-[13px] font-bold text-on-surface">还没有目标目录</p>
                    <p className="mt-1 text-[12px] text-on-surface-variant/65">
                      添加文档、安装包、图片等文件夹，再为每个目录写规则或让 AI 读目录生成初稿。
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleAddDirectories()}
                      disabled={busy}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-3 py-1.5 text-[12px] font-bold text-on-primary disabled:opacity-50"
                    >
                      <FolderPlus className="h-3.5 w-3.5" aria-hidden />
                      添加目录
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {selectedProfile.directories.map((directory) => {
                      const draft = draftState.items[directory.path];
                      const currentValue = descriptionFor(selectedProfile, directory.path);
                      const pathLoading = draftState.loading && draftState.loadingPath === directory.path;
                      const batchLoading = draftState.loading && !draftState.loadingPath;
                      return (
                        <div key={directory.path} className="rounded-[8px] border border-on-surface/8 bg-surface p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Folder className="h-4 w-4 shrink-0 text-on-surface-variant/50" aria-hidden />
                            <span className="text-[13px] font-bold text-on-surface">{directoryTitle(directory)}</span>
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-on-surface-variant/50" title={directory.path}>
                              {directory.path}
                            </span>
                            {!currentValue.trim() ? (
                              <span className="shrink-0 rounded-full bg-error/10 px-2 py-0.5 text-[11px] font-bold text-error">缺规则</span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void handleGenerateDrafts([directory.path])}
                              disabled={busy || draftState.loading}
                              className="flex shrink-0 items-center gap-1 rounded-[6px] border border-primary/25 px-2 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
                              title="只分析这一个目录并生成规则建议"
                            >
                              {pathLoading ? (
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                              ) : (
                                <Sparkles className="h-3 w-3" aria-hidden />
                              )}
                              {pathLoading ? "分析中…" : currentValue.trim() ? "AI 重写建议" : "AI 分析"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRemoveDirectory(directory.path)}
                              disabled={busy || draftState.loading}
                              className="flex shrink-0 items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-bold text-on-surface-variant/70 transition-colors hover:bg-error/5 hover:text-error disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3" aria-hidden />
                              移除
                            </button>
                          </div>
                          <textarea
                            value={currentValue}
                            onChange={(event) =>
                              setEditedDescriptions((prev) => ({
                                ...prev,
                                [editKey(selectedProfile.profile_id, directory.path)]: event.target.value,
                              }))
                            }
                            disabled={batchLoading || pathLoading}
                            rows={2}
                            placeholder="什么样的文件应该放进这里？（例如：技术手册、API 文档等 PDF/Word 资料；发票类除外）"
                            className="mt-2 w-full resize-y rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-3 py-2 text-[13px] leading-6 text-on-surface outline-none transition-colors focus:border-primary/40 placeholder:text-on-surface-variant/35 disabled:opacity-60"
                          />
                          {draft?.draft_description ? (
                            <div className="mt-2 rounded-[8px] border border-primary/20 bg-primary/5 p-2.5">
                              <p className="text-[11px] font-bold text-primary">AI 建议（未写入，需点采纳）</p>
                              <p className="mt-1 text-[12px] font-semibold leading-5 text-on-surface">{draft.draft_description}</p>
                              {draft.basis ? (
                                <p className="mt-1 text-[11px] leading-5 text-on-surface-variant/70">依据：{draft.basis}</p>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => acceptDraft(directory.path, draft.draft_description || "")}
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
                )}
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
