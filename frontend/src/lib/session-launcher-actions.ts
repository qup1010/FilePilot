import type { ApiClient } from "@/lib/api";
import type { CreateSessionResponse, SessionStrategySelection } from "@/types/session";

export async function startFreshSession(
  api: Pick<ApiClient, "abandonSession" | "createSession">,
  previousSessionId: string,
  targetDir: string,
  strategy: SessionStrategySelection,
): Promise<CreateSessionResponse> {
  await api.abandonSession(previousSessionId);
  return api.createSession(targetDir, false, strategy);
}
