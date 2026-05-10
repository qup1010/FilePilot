import type { ApiClient } from "@/lib/api";
import { getSessionStageView } from "@/lib/session-view-model";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionSourceSelection,
  SessionStage,
  SessionStrategySelection,
} from "@/types/session";

export async function createLaunchSession(
  api: Pick<ApiClient, "createSession">,
  payload: CreateSessionRequest & { strategy: SessionStrategySelection },
): Promise<CreateSessionResponse> {
  const response = await api.createSession(payload);
  return response;
}

export async function startFreshSession(
  api: Pick<ApiClient, "abandonSession" | "createSession">,
  previousSessionId: string,
  previousStage: SessionStage,
  payload: CreateSessionRequest & { strategy: SessionStrategySelection },
): Promise<CreateSessionResponse> {
  if (!getSessionStageView(previousStage).isCompleted) {
    await api.abandonSession(previousSessionId);
  }
  const response = await api.createSession({ ...payload, resume_if_exists: false });
  return response;
}

export function firstSourcePath(sources: SessionSourceSelection[]): string {
  return sources.find((item) => item.path.trim())?.path.trim() || "";
}
