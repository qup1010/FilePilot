import type { ApiClient } from "@/lib/api";
import type { CreateSessionResponse, SessionStage, SessionStrategySelection } from "@/types/session";

async function ensureSessionScan(
  api: Pick<ApiClient, "scanSession">,
  sessionId: string | null,
) {
  if (!sessionId) {
    return;
  }

  try {
    await api.scanSession(sessionId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("SESSION_STAGE_CONFLICT")) {
      return;
    }
    throw error;
  }
}

export async function createSessionAndStartScan(
  api: Pick<ApiClient, "createSession" | "scanSession">,
  targetDir: string,
  resumeIfExists: boolean,
  strategy: SessionStrategySelection,
): Promise<CreateSessionResponse> {
  const response = await api.createSession(targetDir, resumeIfExists, strategy);
  if (response.mode === "created") {
    await ensureSessionScan(api, response.session_id);
  }
  return response;
}

export async function startFreshSession(
  api: Pick<ApiClient, "abandonSession" | "createSession" | "scanSession">,
  previousSessionId: string,
  targetDir: string,
  strategy: SessionStrategySelection,
  previousStage: SessionStage,
): Promise<CreateSessionResponse> {
  if (previousStage !== "completed") {
    await api.abandonSession(previousSessionId);
  }
  const response = await api.createSession(targetDir, false, strategy);
  if (response.mode === "created") {
    await ensureSessionScan(api, response.session_id);
  }
  return response;
}
