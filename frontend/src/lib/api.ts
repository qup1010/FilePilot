import {
  type CleanupResponse,
  type CreateSessionResponse,
  type ExecuteResponse,
  type JournalSummary,
  type MessageResponse,
  type PrecheckResponse,
  type RollbackResponse,
  type ScanAcceptedResponse,
  type SessionSnapshot,
  type UpdateItemRequest,
} from "@/types/session";

function joinUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`).toString();
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Request failed (${response.status} ${response.statusText}): ${errorText}`,
    );
  }

  return (await response.json()) as T;
}

export interface ApiClient {
  createSession(target_dir: string, resume_if_exists?: boolean): Promise<CreateSessionResponse>;
  getSession(session_id: string): Promise<SessionSnapshot>;
  resumeSession(session_id: string): Promise<SessionSnapshot>;
  abandonSession(session_id: string): Promise<{ session_id: string; session_snapshot: SessionSnapshot }>;
  scanSession(session_id: string): Promise<ScanAcceptedResponse>;
  refreshSession(session_id: string): Promise<ScanAcceptedResponse>;
  sendMessage(session_id: string, content: string): Promise<MessageResponse>;
  updateItem(session_id: string, payload: UpdateItemRequest): Promise<{ session_id: string; session_snapshot: SessionSnapshot }>;
  runPrecheck(session_id: string): Promise<PrecheckResponse>;
  execute(session_id: string, confirm?: boolean): Promise<ExecuteResponse>;
  cleanupEmptyDirs(session_id: string): Promise<CleanupResponse>;
  rollback(session_id: string, confirm?: boolean): Promise<RollbackResponse>;
  getJournal(session_id: string): Promise<JournalSummary>;
}

export function createApiClient(baseUrl: string): ApiClient {
  return {
    async createSession(target_dir, resume_if_exists = true) {
      const response = await fetch(joinUrl(baseUrl, "/api/sessions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target_dir,
          resume_if_exists,
        }),
      });

      return parseResponse<CreateSessionResponse>(response);
    },
    async getSession(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}`));
      return parseResponse<SessionSnapshot>(response);
    },
    async resumeSession(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/resume`), {
        method: "POST",
      });
      return parseResponse<SessionSnapshot>(response);
    },
    async abandonSession(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/abandon`), {
        method: "POST",
      });
      return parseResponse<{ session_id: string; session_snapshot: SessionSnapshot }>(response);
    },
    async scanSession(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/scan`), {
        method: "POST",
      });
      return parseResponse<ScanAcceptedResponse>(response);
    },
    async refreshSession(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/refresh`), {
        method: "POST",
      });
      return parseResponse<ScanAcceptedResponse>(response);
    },
    async sendMessage(session_id, content) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/messages`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      });

      return parseResponse<MessageResponse>(response);
    },
    async updateItem(session_id, payload) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/update-item`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      return parseResponse<{ session_id: string; session_snapshot: SessionSnapshot }>(response);
    },
    async runPrecheck(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/precheck`), {
        method: "POST",
      });

      return parseResponse<PrecheckResponse>(response);
    },
    async execute(session_id, confirm = true) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/execute`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirm }),
      });

      return parseResponse<ExecuteResponse>(response);
    },
    async cleanupEmptyDirs(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/cleanup-empty-dirs`), {
        method: "POST",
      });

      return parseResponse<CleanupResponse>(response);
    },
    async rollback(session_id, confirm = true) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/rollback`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirm }),
      });

      return parseResponse<RollbackResponse>(response);
    },
    async getJournal(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/journal`));
      return parseResponse<JournalSummary>(response);
    },
  };
}
