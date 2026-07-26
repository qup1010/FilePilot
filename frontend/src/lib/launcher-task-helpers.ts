import {
  ACTIVE_WORKSPACE_ROUTE_KEY,
  readActiveWorkspaceRoute,
  rememberActiveWorkspaceRoute,
} from "@/lib/app-context-store";
import { isHistorySessionEntry } from "@/lib/use-history-list";
import { getWorkspaceRouteForHistoryEntry } from "@/lib/workspace-routes";
import type { HistoryItem } from "@/types/session";

export type LaunchWorkbenchTask = {
  route: string;
  sessionId: string | null;
};

export function rememberWorkspaceRoute(route: string) {
  if (typeof window === "undefined") {
    return;
  }
  const [pathname, search = ""] = route.split("?");
  const params = new URLSearchParams(search);
  params.delete("auto_scan");
  const normalizedRoute = params.toString() ? `${pathname}?${params.toString()}` : pathname;
  rememberActiveWorkspaceRoute(normalizedRoute);
}

export function readActiveWorkspaceTask(): LaunchWorkbenchTask | null {
  if (typeof window === "undefined") {
    return null;
  }
  const route = readActiveWorkspaceRoute();
  if (!route?.startsWith("/workspace")) {
    return null;
  }
  const [pathname, search = ""] = route.split("?");
  const params = new URLSearchParams(search);
  const isReadOnly = params.get("readonly") === "1";
  const isResultView = pathname.includes("/workspace/result") || pathname.includes("/result");
  const sessionId = params.get("session_id");

  if (isReadOnly || isResultView) {
    window.localStorage.removeItem(ACTIVE_WORKSPACE_ROUTE_KEY);
    return null;
  }

  return {
    route,
    sessionId,
  };
}

export function describeWorkspaceTask(task: LaunchWorkbenchTask): string {
  try {
    const [pathname, search = ""] = task.route.split("?");
    const params = new URLSearchParams(search);
    const stageLabel = pathname.includes("/review")
      ? "安全检查"
      : pathname.includes("/plan")
        ? "方案调整"
        : pathname.includes("/recovery")
          ? "等待恢复"
          : "整理进行中";
    const dir = params.get("dir");
    if (dir) {
      const name = dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;
      return `${name} · ${stageLabel}`;
    }
    return stageLabel;
  } catch {
    return "整理任务进行中";
  }
}

export function getHistoryRoute(entry: HistoryItem, options?: { readonly?: boolean }) {
  return getWorkspaceRouteForHistoryEntry({
    sessionId: entry.execution_id,
    targetDir: entry.target_dir,
    status: entry.status,
    itemCount: entry.item_count,
    readonly: options?.readonly,
  });
}

export function getHistoryActionLabel(entry: HistoryItem): string {
  if (isHistorySessionEntry(entry)) {
    const status = String(entry.status || "").toLowerCase();
    if (status === "draft" || status === "idle") {
      return "继续并扫描";
    }
    if (status === "interrupted" || status === "stale") {
      return "恢复处理";
    }
    return "继续任务";
  }
  return "查看记录";
}
