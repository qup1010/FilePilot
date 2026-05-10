import { getSessionStageView } from "@/lib/session-view-model";
import type { SessionStage } from "@/types/session";

export function canRunPrecheck(
  stage: SessionStage,
  readiness: { can_precheck?: boolean } | null | undefined,
  isPlanSyncing: boolean,
): boolean {
  const stageView = getSessionStageView(stage);
  return (stageView.isPlanning || stageView.isAwaitingPrecheck) && Boolean(readiness?.can_precheck) && !isPlanSyncing;
}
