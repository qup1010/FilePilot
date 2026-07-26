"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpenCheck, FolderInput, Loader2, TriangleAlert, Zap } from "lucide-react";

import { createApiClient } from "@/lib/api";
import { rememberActiveWorkspaceRoute } from "@/lib/app-context-store";
import { getPathBasename } from "@/lib/path-normalization";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import { localizeUserFacingError } from "@/lib/user-facing-copy";
import { buildWorkspaceRoute } from "@/lib/workspace-routes";
import type { TargetProfile } from "@/types/session";

const SOURCE_STORAGE_KEY = "filepilot.one_click_sources";

function loadStoredSources(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SOURCE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function storeSource(profileId: string, path: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SOURCE_STORAGE_KEY,
      JSON.stringify({ ...loadStoredSources(), [profileId]: path }),
    );
  } catch {
    // localStorage 不可用时静默降级：只是不记住上次目录
  }
}

function isRuleComplete(profile: TargetProfile): boolean {
  return (
    profile.directories.length > 0 &&
    profile.directories.every((item) => String(item.description || "").trim())
  );
}

export function OneClickPanel() {
  const router = useRouter();
  const api = useMemo(() => createApiClient(getApiBaseUrl(), getApiToken()), []);
  const [profiles, setProfiles] = useState<TargetProfile[] | null>(null);
  const [sourceByProfile, setSourceByProfile] = useState<Record<string, string>>({});
  const [launchingProfileId, setLaunchingProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSourceByProfile(loadStoredSources());
    let cancelled = false;
    void api
      .getTargetProfiles()
      .then((items) => {
        if (!cancelled) setProfiles(items);
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const completeProfiles = useMemo(
    () => (profiles || []).filter(isRuleComplete),
    [profiles],
  );

  const handlePickSource = useCallback(
    async (profileId: string) => {
      try {
        const result = await api.selectDir();
        if (result.path) {
          setSourceByProfile((prev) => ({ ...prev, [profileId]: result.path as string }));
          storeSource(profileId, result.path);
        }
      } catch {
        setError("打开目录选择器失败，请重试。");
      }
    },
    [api],
  );

  const handleLaunch = useCallback(
    async (profile: TargetProfile) => {
      const sourcePath = String(sourceByProfile[profile.profile_id] || "").trim();
      if (!sourcePath) return;
      setLaunchingProfileId(profile.profile_id);
      setError(null);
      try {
        const response = await api.createSession({
          sources: [{ source_type: "directory", path: sourcePath }],
          resume_if_exists: false,
          organize_method: "assign_into_existing_categories",
          unattended: true,
          target_profile_id: profile.profile_id,
          target_directory_details: profile.directories,
        });
        if (!response.session_id) {
          throw new Error("没有成功创建一键整理会话，请再试一次。");
        }
        const route = buildWorkspaceRoute("progress", {
          sessionId: response.session_id,
          dir: sourcePath,
          autoScan: true,
        });
        rememberActiveWorkspaceRoute(route);
        router.push(route);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("TARGET_RULES_INCOMPLETE")) {
          setError("这组目录还有规则没写完，请先到「分类规则」补全。");
        } else if (message.includes("SESSION_LOCKED")) {
          setError("该目录已有正在进行的整理任务，请先处理或放弃它。");
        } else {
          setError(localizeUserFacingError(err, "启动一键整理失败，请再试一次。"));
        }
      } finally {
        setLaunchingProfileId(null);
      }
    },
    [api, router, sourceByProfile],
  );

  if (profiles === null) {
    return null;
  }

  if (completeProfiles.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-on-surface/12 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <BookOpenCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="text-[13px] font-bold text-on-surface">
            {profiles.length === 0 ? "先建立你的目录规则，就能一键整理" : "补全目录规则后即可一键整理"}
          </p>
          <p className="text-[12px] text-on-surface-variant/60">
            为每个目标目录写一句「什么文件放这里」，AI 按规则直接分好类，拿不准的留在原地。
          </p>
          <Link
            href="/rules"
            className="ml-auto shrink-0 rounded-[8px] border border-primary/30 px-3 py-1 text-[12px] font-bold text-primary transition-colors hover:bg-primary/5"
          >
            去写规则
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-[13px] font-black text-on-surface">一键整理</h2>
        <span className="text-[11px] font-semibold text-on-surface-variant/55">
          按已写好的规则直接分类，拿不准的留在原地，完成后给出总结
        </span>
      </div>
      {error ? (
        <div className="flex items-center gap-2 rounded-[8px] border border-error/30 bg-error/5 px-3 py-2 text-[12px] font-semibold text-error">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
          {error.includes("分类规则") ? (
            <Link href="/rules" className="ml-auto shrink-0 font-bold text-primary hover:underline">
              打开分类规则
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {completeProfiles.map((profile) => {
          const sourcePath = String(sourceByProfile[profile.profile_id] || "").trim();
          const launching = launchingProfileId === profile.profile_id;
          return (
            <div
              key={profile.profile_id}
              className="flex items-center gap-2 rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-3 py-2"
            >
              <button
                type="button"
                onClick={() => void handlePickSource(profile.profile_id)}
                title={sourcePath || "选择要整理的目录"}
                className="flex items-center gap-1.5 rounded-[8px] border border-on-surface/10 px-2.5 py-1.5 text-[12px] font-bold text-on-surface transition-colors hover:border-primary/40"
              >
                <FolderInput className="h-3.5 w-3.5 text-on-surface-variant/60" aria-hidden />
                {sourcePath ? getPathBasename(sourcePath, sourcePath) : "选择目录"}
              </button>
              <span className="text-[12px] text-on-surface-variant/50">按</span>
              <span className="max-w-[160px] truncate text-[12px] font-bold text-on-surface" title={profile.name}>
                {profile.name}
              </span>
              <button
                type="button"
                onClick={() => void handleLaunch(profile)}
                disabled={!sourcePath || launching}
                className="flex items-center gap-1.5 rounded-[8px] bg-primary px-3 py-1.5 text-[12px] font-bold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {launching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Zap className="h-3.5 w-3.5" aria-hidden />}
                一键整理
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
