"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  BookOpenCheck,
  Check,
  CheckCircle2,
  Copy,
  Folder,
  FolderPlus,
  Loader2,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { createApiClient } from "@/lib/api";
import { contentLocaleForUiLanguage } from "@/lib/content-locale";
import { getApiBaseUrl, getApiToken, inspectPathsWithTauri, isTauriDesktop, pickDirectoryWithTauri, pickDirectoriesWithTauri } from "@/lib/runtime";
import {
  findDropZoneForPosition,
  isTauriDragDropPayload,
  isTauriDragLeavePayload,
  isTauriDragOverPayload,
  listenToTauriDragDrop,
} from "@/lib/tauri-drag-drop";
import { getPathBasename } from "@/lib/path-normalization";
import { localizeUserFacingError } from "@/lib/user-facing-copy";
import { cn } from "@/lib/utils";
import type { RuleDraftItem, TargetProfile, TargetProfileDirectory } from "@/types/session";
import { RULES_CONTEXT_KEY, notifyAppContextChange } from "@/lib/app-context-store";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface DraftState {
  loading: boolean;
  loadingPath: string | null;
  items: Record<string, RuleDraftItem>;
  error: string | null;
}

const SELECTED_PROFILE_STORAGE_KEY = "filepilot.rules.selected_profile_id";

const RULE_INSPIRATION_IDS = ["documents", "media", "software", "code"] as const;
const RULE_ERROR_PREFIX = "rules:i18n:";

function ruleError(key: string): string {
  return `${RULE_ERROR_PREFIX}${key}`;
}

function displayRuleMessage(message: string, t: (key: string) => string): string {
  return message.startsWith(RULE_ERROR_PREFIX) ? t(message.slice(RULE_ERROR_PREFIX.length)) : message;
}

function CopyPathButton({ path }: { path: string }) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? t("rules.copiedPathTitle") : t("rules.copyPathTitle")}
      className="inline-flex h-4.5 items-center gap-1 rounded px-1.5 text-[10px] font-semibold text-on-surface-variant/50 hover:bg-on-surface/5 hover:text-on-surface transition-colors"
    >
      {copied ? <Check className="h-2.5 w-2.5 text-emerald-500" /> : <Copy className="h-2.5 w-2.5" />}
      <span>{copied ? t("rules.copied") : t("rules.copyPath")}</span>
    </button>
  );
}

function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const autoResize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(52, el.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      rows={2}
      className={cn("resize-none overflow-hidden transition-all", className)}
    />
  );
}

function ruleCompletion(profile: TargetProfile): { total: number; filled: number } {
  const total = profile.directories.length;
  const filled = profile.directories.filter((item) => String(item.description || "").trim()).length;
  return { total, filled };
}

function directoryTitle(directory: TargetProfileDirectory): string {
  return directory.label || getPathBasename(directory.path) || directory.path;
}

// 从 HTML5 拖拽事件中提取本地绝对路径（网页端兜底；桌面端走 Tauri 原生拖拽事件）。
function extractDroppedPaths(event: React.DragEvent): string[] {
  const textPayload = event.dataTransfer.getData("text/plain");
  const uriPayload = event.dataTransfer.getData("text/uri-list");
  const files = Array.from(event.dataTransfer.files)
    .map((file) => String((file as File & { path?: string }).path || ""))
    .filter(Boolean);

  const textPaths = `${textPayload}\n${uriPayload}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => (line.startsWith("file://") ? decodeURIComponent(line.replace(/^file:\/+/, "")) : line));

  const seen = new Set<string>();
  return [...files, ...textPaths].filter((path) => {
    const key = path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function RulesPage() {
  const { t, i18n } = useTranslation("common");
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
  const [isDropActive, setIsDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  const dropZoneRef = useRef<HTMLElement | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [busy, setBusy] = useState(false);
  // ConfirmDialog 状态
  const [deleteProfileConfirm, setDeleteProfileConfirm] = useState(false);
  const [removeDirectoryConfirm, setRemoveDirectoryConfirm] = useState<string | null>(null);
  const [discardEditsConfirm, setDiscardEditsConfirm] = useState<string | null>(null); // 目标 profileId

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
      setLoadError(localizeUserFacingError(err, t("rules.errors.load")));
      setProfiles([]);
      setSelectedProfileId("");
    }
  }, [api, t]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!selectedProfileId || typeof window === "undefined") return;
    window.localStorage.setItem(SELECTED_PROFILE_STORAGE_KEY, selectedProfileId);
  }, [selectedProfileId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedProfile?.name) {
      window.localStorage.setItem(
        RULES_CONTEXT_KEY,
        JSON.stringify({ detail: selectedProfile.name }),
      );
    } else {
      window.localStorage.setItem(
        RULES_CONTEXT_KEY,
        JSON.stringify({ detail_code: "rule_config" }),
      );
    }
    notifyAppContextChange();
  }, [selectedProfile]);

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
    if (hasEdits) {
      setDiscardEditsConfirm(profileId);
      return;
    }
    doSelectProfile(profileId);
  }

  function doSelectProfile(profileId: string) {
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
    const name = newProfileName.trim() || t("rules.starterProfile");
    setBusy(true);
    setActionError(null);
    try {
      const created = await api.createTargetProfile({ name, directories: [] });
      setNewProfileName("");
      setCreating(false);
      await loadProfiles();
      setSelectedProfileId(created.profile_id);
    } catch (err: unknown) {
      setActionError(localizeUserFacingError(err, t("rules.errors.create")));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProfile() {
    if (!selectedProfile) return;
    setDeleteProfileConfirm(true);
  }

  async function doDeleteProfile() {
    if (!selectedProfile) return;
    setDeleteProfileConfirm(false);
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
      setActionError(localizeUserFacingError(err, t("rules.errors.delete")));
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
      setActionError(localizeUserFacingError(err, t("rules.errors.setDefault")));
    } finally {
      setBusy(false);
    }
  }

  // 把一批绝对路径写入当前配置（去重后调用 API），返回是否新增了目录。
  async function addDirectoryPaths(paths: string[]): Promise<boolean> {
    if (!selectedProfile || paths.length === 0) return false;

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
      setActionError(ruleError("errors.duplicateFolders"));
      return false;
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
    return true;
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
        const manual = window.prompt(t("rules.errors.manualPathPrompt"));
        if (manual?.trim()) paths = [manual.trim()];
      }
      if (paths.length === 0) return;
      await addDirectoryPaths(paths);
    } catch (err: unknown) {
      setActionError(localizeUserFacingError(err, t("rules.errors.addFolder")));
    } finally {
      setBusy(false);
    }
  }

  // 从一批绝对路径里过滤出文件夹（桌面端用 Tauri 精确判断，网页端用扩展名启发式）。
  const resolveDroppedDirectories = useCallback(async (paths: string[]): Promise<string[]> => {
    const normalizedPaths = paths.map((path) => path.trim()).filter(Boolean);
    if (!normalizedPaths.length) return [];
    if (!desktopReady) {
      return normalizedPaths.filter((path) => !/\.[^./\\]+$/.test(path));
    }
    const inspected = await inspectPathsWithTauri(normalizedPaths);
    const resolved = inspected
      .filter((item) => item.is_dir)
      .map((item) => item.path.trim())
      .filter(Boolean);
    const fallback = normalizedPaths.filter((path) => !/\.[^./\\]+$/.test(path));
    const unique = new Map<string, string>();
    for (const path of resolved.length ? resolved : fallback) {
      unique.set(path.toLowerCase(), path);
    }
    return Array.from(unique.values());
  }, [desktopReady]);

  // Tauri 原生拖拽监听是常驻的，用 ref 持有每次渲染后的最新回调与状态，避免闭包过期。
  const dropHandlersRef = useRef({
    busy: false,
    draftLoading: false,
    hasProfile: false,
    resolveDirectories: resolveDroppedDirectories,
    addDirectories: addDirectoryPaths,
    setError: (_message: string | null) => {},
  });
  useEffect(() => {
    dropHandlersRef.current = {
      busy,
      draftLoading: draftState.loading,
      hasProfile: Boolean(selectedProfile),
      resolveDirectories: resolveDroppedDirectories,
      addDirectories: addDirectoryPaths,
      setError: setActionError,
    };
  });

  // 桌面端：监听 Tauri 原生拖拽事件（HTML5 拖拽在 WebView 里拿不到文件夹绝对路径）。
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listenToTauriDragDrop((event) => {
      const payload = event.payload;
      if (isTauriDragLeavePayload(payload)) {
        dragDepthRef.current = 0;
        setIsDropActive(false);
        return;
      }

      const overDropZone = findDropZoneForPosition(payload.position, [
        { key: "rules", element: dropZoneRef.current },
      ]);

      if (isTauriDragOverPayload(payload)) {
        if (overDropZone === "rules") {
          dragDepthRef.current = 1;
          setIsDropActive(true);
        } else {
          dragDepthRef.current = 0;
          setIsDropActive(false);
        }
        return;
      }

      if (!isTauriDragDropPayload(payload)) return;

      dragDepthRef.current = 0;
      setIsDropActive(false);
      if (overDropZone !== "rules") return;

      void (async () => {
        const handlers = dropHandlersRef.current;
        if (!handlers.hasProfile) {
          handlers.setError(ruleError("errors.selectOrCreate"));
          return;
        }
        if (handlers.busy || handlers.draftLoading) {
          handlers.setError(ruleError("errors.busy"));
          return;
        }
        const dirs = await handlers.resolveDirectories(payload.paths);
        if (cancelled) return;
        if (!dirs.length) {
          handlers.setError(ruleError("errors.noFolderDrop"));
          return;
        }
        await handlers.addDirectories(dirs);
      })();
    }).then((dispose) => {
      if (cancelled) {
        dispose?.();
        return;
      }
      unlisten = dispose;
    }).catch(() => {});

    return () => {
      cancelled = true;
      dragDepthRef.current = 0;
      setIsDropActive(false);
      unlisten?.();
    };
  }, []);

  function handleDropZoneDragEnter(event: React.DragEvent) {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDropActive(true);
  }

  function handleDropZoneDragOver(event: React.DragEvent) {
    event.preventDefault();
    if (dragDepthRef.current === 0) dragDepthRef.current = 1;
    setIsDropActive(true);
  }

  function handleDropZoneDragLeave(event: React.DragEvent) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDropActive(false);
  }

  async function handleDropZoneDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDropActive(false);
    if (!selectedProfile) {
      setActionError(ruleError("errors.selectOrCreate"));
      return;
    }
    if (busy || draftState.loading) {
      setActionError(ruleError("errors.busy"));
      return;
    }
    const paths = extractDroppedPaths(event);
    if (!paths.length) {
      setActionError(ruleError("errors.noFolderDrop"));
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const dirs = await resolveDroppedDirectories(paths);
      if (!dirs.length) {
        setActionError(ruleError("errors.noFolderDrop"));
        return;
      }
      await addDirectoryPaths(dirs);
    } catch (err: unknown) {
      setActionError(localizeUserFacingError(err, t("rules.errors.addFolder")));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveDirectory(path: string) {
    if (!selectedProfile) return;
    setRemoveDirectoryConfirm(path);
  }

  async function doRemoveDirectory(path: string) {
    if (!selectedProfile) return;
    setRemoveDirectoryConfirm(null);
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
      setActionError(localizeUserFacingError(err, t("rules.errors.removeFolder")));
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
      const contentLocale = contentLocaleForUiLanguage(i18n.resolvedLanguage || i18n.language);
      const result = await api.generateProfileRuleDrafts(selectedProfile.profile_id, paths, contentLocale);
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
        error: localizeUserFacingError(err, t("rules.errors.generateDraft")),
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
      setActionError(localizeUserFacingError(err, t("rules.errors.save")));
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

  function acceptAllDrafts() {
    if (!selectedProfile) return;
    const additions: Record<string, string> = {};
    const items = draftState.items || {};
    for (const [path, item] of Object.entries(items)) {
      if (item?.draft_description) {
        additions[editKey(selectedProfile.profile_id, path)] = item.draft_description;
      }
    }
    if (Object.keys(additions).length === 0) return;
    setEditedDescriptions((prev) => ({ ...prev, ...additions }));
  }

  return (
    <>
    <div className="flex flex-1 flex-col overflow-y-auto bg-surface px-6 py-6">
      <div className="mx-auto w-full max-w-[920px]">
        {/* 顶部标题与说明 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-[18px] font-bold tracking-tight text-on-surface">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <BookOpenCheck className="h-4.5 w-4.5" aria-hidden />
              </div>
              {t("rules.title")}
            </h1>
            <p className="mt-1 text-[13px] leading-relaxed text-on-surface-variant/75">
              {t("rules.description")}
            </p>
          </div>
        </div>

        {/* 错误提示 */}
        {(loadError || actionError) ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-error/25 bg-error/5 px-3.5 py-2.5 text-[12px] font-semibold text-error shadow-sm">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{displayRuleMessage(actionError || loadError || "", t)}</span>
          </div>
        ) : null}

        {profiles === null ? (
          <div className="mt-16 flex flex-col items-center justify-center gap-3 py-12 text-[13px] font-medium text-on-surface-variant/60">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
            <span>{t("rules.loading")}</span>
          </div>
        ) : profiles.length === 0 && !creating ? (
          <div className="mt-8 rounded-2xl border border-dashed border-on-surface/15 bg-surface-container-lowest/50 px-6 py-12 text-center shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FolderPlus className="h-6 w-6" />
            </div>
            <p className="mt-3 text-[15px] font-bold text-on-surface">{t("rules.emptyTitle")}</p>
            <p className="mx-auto mt-2 max-w-[460px] text-[13px] leading-6 text-on-surface-variant/70">
              {t("rules.emptyDescription")}
            </p>
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setNewProfileName(t("rules.starterProfile"));
              }}
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-bold text-on-primary shadow-sm transition-all hover:bg-primary-dim active:scale-95"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t("rules.createProfile")}
            </button>
          </div>
        ) : (
          <>
            {/* 吸顶操作栏（Sticky Toolbar） */}
            <div className="sticky top-0 z-20 -mx-6 mt-4 mb-4 border-y border-on-surface/8 bg-surface/90 px-6 py-3 backdrop-blur-md transition-all">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* 左侧：配置快速选择与管理 */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex items-center rounded-lg border border-on-surface/10 bg-surface-container-lowest shadow-sm transition-all focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
                    <SlidersHorizontal className="ml-2.5 h-3.5 w-3.5 shrink-0 text-on-surface-variant/50 pointer-events-none" />
                    <select
                      value={selectedProfile?.profile_id || ""}
                      onChange={(event) => selectProfile(event.target.value)}
                      disabled={!profiles.length || busy}
                      className="h-9 rounded-lg bg-transparent pl-2 pr-7 text-[13px] font-bold text-on-surface outline-none cursor-pointer disabled:opacity-60"
                    >
                      {profiles.map((profile) => {
                        const done = ruleCompletion(profile);
                        const mark = profile.profile_id === defaultProfileId ? t("rules.defaultMarker") : "";
                        return (
                          <option key={profile.profile_id} value={profile.profile_id}>
                            {profile.name}
                            {mark}
                            {` (${done.filled}/${done.total})`}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCreating((prev) => !prev);
                      if (!creating) setNewProfileName("");
                    }}
                    disabled={busy}
                    className="flex h-9 items-center gap-1 rounded-lg border border-on-surface/10 bg-surface-container-lowest px-2.5 text-[12px] font-bold text-on-surface shadow-sm transition-all hover:border-primary/30 hover:text-primary active:scale-95 disabled:opacity-50"
                    title={t("rules.newProfileTitle")}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    {t("rules.new")}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleSetDefault()}
                    disabled={!selectedProfile || busy}
                    className={cn(
                      "flex h-9 items-center gap-1 rounded-lg border px-2.5 text-[12px] font-bold shadow-sm transition-all active:scale-95 disabled:opacity-50",
                      isDefault
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold"
                        : "border-on-surface/10 bg-surface-container-lowest text-on-surface hover:border-amber-500/30 hover:text-amber-600",
                    )}
                    title={isDefault ? t("rules.isDefaultTitle") : t("rules.setDefaultTitle")}
                  >
                    <Star className={cn("h-3.5 w-3.5", isDefault ? "fill-amber-500 text-amber-500" : "")} aria-hidden />
                    {isDefault ? t("rules.currentDefault") : t("rules.setDefault")}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDeleteProfile()}
                    disabled={!selectedProfile || busy}
                    className="flex h-9 items-center gap-1 rounded-lg border border-transparent px-2 text-[12px] font-bold text-on-surface-variant/60 transition-all hover:border-error/20 hover:bg-error/5 hover:text-error active:scale-95 disabled:opacity-50"
                    title={t("rules.deleteProfile")}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>

                {/* 右侧：目录操作、AI 初稿与保存按钮 */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* 规则补全度胶囊 */}
                  {selectedProfile && (
                    <div
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold tracking-tight",
                        isComplete
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
                      )}
                    >
                      {isComplete ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      )}
                      <span>{t("rules.completion", { filled: completion.filled, total: completion.total })}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleAddDirectories()}
                    disabled={busy || draftState.loading}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-on-surface/10 bg-surface-container-lowest px-2.5 text-[12px] font-bold text-on-surface shadow-sm transition-all hover:border-primary/30 hover:text-primary active:scale-95 disabled:opacity-50"
                  >
                    <FolderPlus className="h-3.5 w-3.5 text-primary" aria-hidden />
                    {t("rules.addDirectory")}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleGenerateDrafts()}
                    disabled={busy || draftState.loading || (selectedProfile?.directories.length ?? 0) === 0}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2.5 text-[12px] font-bold text-primary shadow-sm transition-all hover:bg-primary/10 active:scale-95 disabled:opacity-50"
                  >
                    {draftState.loading && !draftState.loadingPath ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {draftState.loading && !draftState.loadingPath ? t("rules.readingFolders") : t("rules.generateAllDrafts")}
                  </button>

                  {Object.keys(draftState.items).length > 0 && !draftState.loading ? (
                    <button
                      type="button"
                      onClick={acceptAllDrafts}
                      disabled={busy}
                      className="flex h-8 items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 text-[12px] font-bold text-emerald-600 dark:text-emerald-400 shadow-sm transition-all hover:bg-emerald-500/20 active:scale-95 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      {t("rules.acceptAll")}
                    </button>
                  ) : null}

                  {/* 保存按钮：未保存时显著脉冲高亮 */}
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving || busy || !hasEdits}
                    className={cn(
                      "relative flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[12px] font-bold transition-all active:scale-95 disabled:opacity-40",
                      hasEdits
                        ? "bg-primary text-on-primary shadow-[0_2px_8px_rgba(0,120,212,0.35)] hover:bg-primary-dim"
                        : "border border-on-surface/10 bg-surface-container-lowest text-on-surface-variant/70",
                    )}
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : savedFlash && !hasEdits ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                    ) : hasEdits ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" />
                    ) : null}
                    <span>{hasEdits ? t("rules.saveChanges") : savedFlash ? t("rules.saved") : t("rules.save")}</span>
                  </button>
                </div>
              </div>

              {/* 新建配置输入展开 */}
              {creating ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 p-2.5">
                  <input
                    value={newProfileName}
                    onChange={(event) => setNewProfileName(event.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleCreateProfile(); }}
                    placeholder={t("rules.newProfilePlaceholder")}
                    autoFocus
                    className="h-8 min-w-[200px] flex-1 rounded-lg border border-on-surface/10 bg-surface-container-lowest px-3 text-[13px] font-semibold text-on-surface outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateProfile()}
                    disabled={busy}
                    className="h-8 rounded-lg bg-primary px-3 text-[12px] font-bold text-on-primary shadow-sm hover:bg-primary-dim active:scale-95 disabled:opacity-50"
                  >
                    {busy ? t("rules.creating") : t("rules.create")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setNewProfileName("");
                    }}
                    className="h-8 rounded-lg border border-on-surface/10 bg-surface-container-lowest px-2.5 text-[12px] font-bold text-on-surface-variant hover:bg-on-surface/5"
                  >
                    {t("rules.cancel")}
                  </button>
                </div>
              ) : null}
            </div>

            {/* 配置重命名及概览 */}
            {selectedProfile ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-on-surface/8 bg-surface-container-lowest px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                <div className="flex min-w-[220px] flex-1 items-center gap-2">
                  <span className="text-[12px] font-bold text-on-surface-variant/60 shrink-0">{t("rules.profileName")}</span>
                  <input
                    value={profileName}
                    onChange={(event) => setEditedName(event.target.value)}
                    placeholder={t("rules.profileNamePlaceholder")}
                    className="h-8 max-w-[260px] flex-1 rounded-lg border border-on-surface/10 bg-surface px-2.5 text-[13px] font-bold text-on-surface outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
                  />
                  {editedName !== null && editedName.trim() !== selectedProfile.name && (
                    <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">{t("rules.unsaved")}</span>
                  )}
                </div>
                <div className="text-[12px] text-on-surface-variant/65">
                  {t("rules.directoryCount", { count: selectedProfile.directories.length })}
                  {!isComplete && completion.total > 0 && (
                    <span className="ml-2 font-medium text-amber-600 dark:text-amber-400">{t("rules.completeForOneClick")}</span>
                  )}
                </div>
              </div>
            ) : null}

            {/* 目标目录与规则列表区 */}
            {selectedProfile ? (
              <section
                ref={dropZoneRef}
                onDragEnter={(event) => handleDropZoneDragEnter(event)}
                onDragOver={(event) => handleDropZoneDragOver(event)}
                onDragLeave={(event) => handleDropZoneDragLeave(event)}
                onDrop={(event) => void handleDropZoneDrop(event)}
                className={cn(
                  "relative rounded-2xl border p-4 shadow-sm transition-all duration-200",
                  isDropActive
                    ? "border-primary bg-primary/[0.04] ring-2 ring-primary/20"
                    : "border-on-surface/8 bg-surface-container-lowest/40",
                )}
              >
                {/* 拖入文件夹时的半透明遮罩与动画 */}
                <AnimatePresence>
                  {isDropActive ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-primary/10 backdrop-blur-[1px]"
                    >
                      <motion.div
                        initial={{ scale: 0.9, y: 10 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.9, y: 10 }}
                        className="flex flex-col items-center gap-2 rounded-xl border border-primary/20 bg-surface px-6 py-5 shadow-lg"
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <FolderPlus className="h-6 w-6 animate-pulse" />
                        </div>
                        <p className="text-sm font-bold text-on-surface">{t("rules.dropTitle")}</p>
                        <p className="text-[11px] text-on-surface-variant/65">{t("rules.dropDescription")}</p>
                      </motion.div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {draftState.error ? (
                  <p className="mb-3 text-[12px] font-semibold text-error">{displayRuleMessage(draftState.error, t)}</p>
                ) : null}

                {selectedProfile.directories.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-on-surface/15 px-4 py-10 text-center">
                    <p className="text-[13px] font-bold text-on-surface">{t("rules.noTargetsTitle")}</p>
                    <p className="mt-1 text-[12px] text-on-surface-variant/65">
                      {t("rules.noTargetsDescription")}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleAddDirectories()}
                      disabled={busy}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[12px] font-bold text-on-primary shadow-sm hover:bg-primary-dim active:scale-95 disabled:opacity-50"
                    >
                      <FolderPlus className="h-3.5 w-3.5" aria-hidden />
                      {t("rules.addTargetFolders")}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedProfile.directories.map((directory) => {
                      const draft = draftState.items[directory.path];
                      const currentValue = descriptionFor(selectedProfile, directory.path);
                      const pathLoading = draftState.loading && draftState.loadingPath === directory.path;
                      const batchLoading = draftState.loading && !draftState.loadingPath;
                      return (
                        <div
                          key={directory.path}
                          className="group relative rounded-xl border border-on-surface/8 bg-surface-container-lowest p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all hover:border-on-surface/16 hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)]"
                        >
                          {/* 卡片头部第 1 行：目录图标、名称、状态胶囊、右侧操作 */}
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Folder className="h-4 w-4" aria-hidden />
                              </div>
                              <span className="truncate text-[14px] font-bold text-on-surface tracking-tight">
                                {directoryTitle(directory)}
                              </span>
                              {currentValue.trim() ? (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                  <Check className="h-3 w-3" />
                                  {t("rules.configured")}
                                </span>
                              ) : (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                                  {t("rules.needsRule")}
                                </span>
                              )}
                            </div>

                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleGenerateDrafts([directory.path])}
                                disabled={busy || draftState.loading}
                                className="flex items-center gap-1 rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1 text-[11px] font-bold text-primary transition-all hover:bg-primary/10 active:scale-95 disabled:opacity-50"
                                title={t("rules.analyzeFolderTitle")}
                              >
                                {pathLoading ? (
                                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                                ) : (
                                  <Sparkles className="h-3 w-3" aria-hidden />
                                )}
                                <span>{pathLoading ? t("rules.analyzing") : currentValue.trim() ? t("rules.rewriteSuggestion") : t("rules.analyzeGenerate")}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRemoveDirectory(directory.path)}
                                disabled={busy || draftState.loading}
                                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-on-surface-variant/50 transition-colors hover:bg-error/10 hover:text-error active:scale-95 disabled:opacity-50"
                                title={t("rules.removeFolderTitle")}
                              >
                                <Trash2 className="h-3 w-3" aria-hidden />
                                <span>{t("rules.remove")}</span>
                              </button>
                            </div>
                          </div>

                          {/* 卡片头部第 2 行：路径展示与快捷复制 */}
                          <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-on-surface-variant/50">
                            <span className="truncate" title={directory.path}>{directory.path}</span>
                            <CopyPathButton path={directory.path} />
                          </div>

                          {/* 规则编辑输入框 */}
                          <div className="mt-3 rounded-lg border border-on-surface/8 bg-surface/50 p-2.5 transition-all focus-within:border-primary/40 focus-within:bg-surface-container-lowest focus-within:ring-2 focus-within:ring-primary/10">
                            <AutoGrowTextarea
                              value={currentValue}
                              onChange={(val) =>
                                setEditedDescriptions((prev) => ({
                                  ...prev,
                                  [editKey(selectedProfile.profile_id, directory.path)]: val,
                                }))
                              }
                              disabled={batchLoading || pathLoading}
                              placeholder={t("rules.rulePlaceholder")}
                              className="w-full text-[13px] leading-relaxed text-on-surface placeholder:text-on-surface-variant/35"
                            />
                            {/* 空规则时的灵感快捷参考 */}
                            {!currentValue.trim() && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-on-surface/5 pt-2">
                                <span className="text-[10px] font-bold text-on-surface-variant/45">{t("rules.inspirationLabel")}</span>
                                {RULE_INSPIRATION_IDS.map((inspirationId) => (
                                  <button
                                    key={inspirationId}
                                    type="button"
                                    onClick={() => {
                                      setEditedDescriptions((prev) => ({
                                        ...prev,
                                        [editKey(selectedProfile.profile_id, directory.path)]: t(`rules.inspirations.${inspirationId}.text`),
                                      }));
                                    }}
                                    className="rounded-md border border-on-surface/8 bg-surface-container-lowest px-1.5 py-0.5 text-[10px] font-semibold text-on-surface-variant/70 hover:border-primary/30 hover:text-primary transition-all active:scale-95"
                                  >
                                    {t(`rules.inspirations.${inspirationId}.label`)}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* AI 建议与重叠冲突卡片 */}
                          {draft?.draft_description ? (
                            <div className="mt-3 space-y-2.5">
                              {/* 冲突警告 */}
                              {draft.overlap_paths && draft.overlap_paths.length > 0 ? (
                                <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3">
                                  <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                    {t("rules.overlapTitle")}
                                  </p>
                                  <p className="mt-1 text-[12px] font-medium leading-relaxed text-on-surface/80">
                                    {draft.overlap_note || t("rules.overlapDescription")}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {draft.overlap_paths.map((op) => {
                                      const overlappedDir = selectedProfile?.directories.find((d) => d.path === op);
                                      const label = overlappedDir
                                        ? directoryTitle(overlappedDir)
                                        : op.split(/[\\/]/).pop() || op;
                                      return (
                                        <span
                                          key={op}
                                          title={op}
                                          className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-700 dark:text-amber-300"
                                        >
                                          {label}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}

                              {/* AI 建议卡片 */}
                              <div className="rounded-lg border border-primary/20 bg-gradient-to-r from-primary/[0.04] to-primary/[0.01] p-3 shadow-sm">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary">
                                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                                    <span>{t("rules.draftTitle")}</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => acceptDraft(directory.path, draft.draft_description || "")}
                                    className="flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary transition-all hover:bg-primary hover:text-on-primary active:scale-95"
                                  >
                                    <Check className="h-3 w-3" aria-hidden />
                                    {t("rules.acceptDraft")}
                                  </button>
                                </div>
                                <p className="mt-1.5 text-[12px] font-semibold leading-relaxed text-on-surface">
                                  {draft.draft_description}
                                </p>
                                {draft.basis ? (
                                  <p className="mt-1 text-[11px] leading-5 text-on-surface-variant/70">
                                    {t("rules.basisPrefix")}{draft.basis}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {/* 列表底部常驻添加引导卡片 */}
                    <button
                      type="button"
                      onClick={() => void handleAddDirectories()}
                      disabled={busy || draftState.loading}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-on-surface/12 bg-surface-container-lowest/30 py-3.5 text-[12px] font-bold text-on-surface-variant/60 transition-all hover:border-primary/40 hover:bg-primary/[0.02] hover:text-primary active:scale-[0.99] disabled:opacity-50"
                    >
                      <FolderPlus className="h-4 w-4" />
                      <span>{t("rules.bottomAdd")}</span>
                    </button>
                  </div>
                )}
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>

    {/* 删除规则配置确认 */}
    <ConfirmDialog
      open={deleteProfileConfirm}
      title={t("rules.confirmDeleteTitle", { name: selectedProfile?.name || "" })}
      description={t("rules.deleteDescription")}
      confirmLabel={t("rules.confirmDelete")}
      cancelLabel={t("rules.cancel")}
      tone="danger"
      loading={busy}
      onConfirm={() => void doDeleteProfile()}
      onCancel={() => setDeleteProfileConfirm(false)}
    />

    {/* 移除目录确认 */}
    <ConfirmDialog
      open={removeDirectoryConfirm !== null}
      title={t("rules.confirmRemoveTitle", { name: removeDirectoryConfirm ? directoryTitle(selectedProfile?.directories.find((d) => d.path === removeDirectoryConfirm) || { path: removeDirectoryConfirm }) : "" })}
      description={t("rules.removeDescription")}
      confirmLabel={t("rules.confirmRemove")}
      cancelLabel={t("rules.cancel")}
      tone="danger"
      loading={busy}
      onConfirm={() => { if (removeDirectoryConfirm) void doRemoveDirectory(removeDirectoryConfirm); }}
      onCancel={() => setRemoveDirectoryConfirm(null)}
    />

    {/* 丢弃未保存修改确认 */}
    <ConfirmDialog
      open={discardEditsConfirm !== null}
      title={t("rules.discardTitle")}
      description={t("rules.discardDescription")}
      confirmLabel={t("rules.discardAndSwitch")}
      cancelLabel={t("rules.keepEditing")}
      tone="primary"
      onConfirm={() => {
        const targetId = discardEditsConfirm;
        setDiscardEditsConfirm(null);
        if (targetId) doSelectProfile(targetId);
      }}
      onCancel={() => setDiscardEditsConfirm(null)}
    />
  </>
  );
}
