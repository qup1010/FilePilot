import { getSessionStageView } from "@/lib/session-view-model";
import type { SessionSnapshot, SessionStage } from "@/types/session";

export type WorkspaceView = "progress" | "plan" | "review" | "result" | "recovery";

export interface WorkspaceRouteParams {
  sessionId?: string | null;
  dir?: string | null;
  readonly?: boolean;
  autoScan?: boolean;
}

export function hasStablePlan(snapshot?: SessionSnapshot | null): boolean {
  const plan = snapshot?.plan_snapshot;
  if (!snapshot || !plan) {
    return false;
  }
  return Boolean(
    snapshot.assistant_message ||
      Number(plan.stats?.move_count || 0) > 0 ||
      Number(plan.stats?.unresolved_count || 0) > 0 ||
      Boolean(plan.readiness?.can_precheck),
  );
}

export function getWorkspaceViewForStage(stage: SessionStage | string | undefined, stablePlan = false): WorkspaceView {
  const stageView = getSessionStageView((stage || "idle") as SessionStage);
  if (stageView.isRecovery || stageView.isInactive) {
    return "recovery";
  }
  if (stageView.isCompleted) {
    return "result";
  }
  if (stageView.isReadyToExecute || stageView.isExecuting || stageView.isRollingBack) {
    return "review";
  }
  if (stageView.isPlanningConversation && stablePlan) {
    return "plan";
  }
  return "progress";
}

export function getWorkspaceViewForSnapshot(snapshot?: SessionSnapshot | null): WorkspaceView {
  return getWorkspaceViewForStage(snapshot?.stage, hasStablePlan(snapshot));
}

export function buildWorkspaceRoute(view: WorkspaceView, params: WorkspaceRouteParams): string {
  const query = new URLSearchParams();
  if (params.sessionId) {
    query.set("session_id", params.sessionId);
  }
  if (params.dir) {
    query.set("dir", params.dir);
  }
  if (params.readonly) {
    query.set("readonly", "1");
  }
  if (params.autoScan) {
    query.set("auto_scan", "1");
  }
  const suffix = query.toString();
  return suffix ? `/workspace/${view}?${suffix}` : `/workspace/${view}`;
}

export function getWorkspaceRouteForSnapshot(
  snapshot: SessionSnapshot,
  params: Omit<WorkspaceRouteParams, "sessionId"> = {},
): string {
  return buildWorkspaceRoute(getWorkspaceViewForSnapshot(snapshot), {
    ...params,
    sessionId: snapshot.session_id,
    dir: params.dir ?? snapshot.target_dir,
  });
}

export function getWorkspaceRouteForHistoryEntry(params: {
  sessionId: string;
  targetDir?: string | null;
  status?: string | null;
  itemCount?: number | null;
  readonly?: boolean;
}): string {
  const stablePlan = Number(params.itemCount || 0) > 0;
  const view = getWorkspaceViewForStage(params.status || "idle", stablePlan);
  return buildWorkspaceRoute(view, {
    sessionId: params.sessionId,
    dir: params.targetDir || null,
    readonly: params.readonly,
  });
}
