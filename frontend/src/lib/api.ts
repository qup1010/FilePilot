import {
  type CleanupResponse,
  type CreateSessionResponse,
  type ExecuteResponse,
  type JournalSummary,
  type MessageResponse,
  type PrecheckResponse,
  type RollbackResponse,
  type ScanAcceptedResponse,
  type GetSessionResponse,
  type ResumeSessionResponse,
  type SessionSnapshot,
  type HistoryItem,
  type AppConfig,
  type UpdateItemRequest,
  type SessionStrategySelection,
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
  createSession(target_dir: string, resume_if_exists?: boolean, strategy?: SessionStrategySelection): Promise<CreateSessionResponse>;
  getSession(session_id: string): Promise<GetSessionResponse>;
  resumeSession(session_id: string): Promise<ResumeSessionResponse>;
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
  
  // utils
  openDir(path: string): Promise<{ status: string }>;
  selectDir(): Promise<{ path: string | null }>;
  getHistory(): Promise<HistoryItem[]>;
  getConfig(): Promise<AppConfig>;
  updateConfig(config: Record<string, any>): Promise<{ status: string }>;
  switchProfile(id: string): Promise<{ status: string; active_id: string }>;
  addProfile(name: string, copy?: boolean): Promise<{ status: string; id: string }>;
  deleteProfile(id: string): Promise<{ status: string }>;
  testLlm(payload: { test_type: "text" | "vision"; [key: string]: any }): Promise<{ status: string; message: string }>;
}

export function createApiClient(baseUrl: string): ApiClient {
  return {
    async createSession(target_dir, resume_if_exists = true, strategy) {
      const response = await fetch(joinUrl(baseUrl, "/api/sessions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_dir, resume_if_exists, strategy }),
      });
      return parseResponse<CreateSessionResponse>(response);
    },
    async getSession(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}`));
      return parseResponse<GetSessionResponse>(response);
    },
    async resumeSession(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/resume`), {
        method: "POST",
      });
      return parseResponse<ResumeSessionResponse>(response);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      return parseResponse<MessageResponse>(response);
    },
    async updateItem(session_id, payload) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/update-item`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      return parseResponse<RollbackResponse>(response);
    },
    async getJournal(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/sessions/${session_id}/journal`));
      return parseResponse<JournalSummary>(response);
    },
    async openDir(path) {
      const response = await fetch(joinUrl(baseUrl, "/api/utils/open-dir"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      return parseResponse<{ status: string }>(response);
    },
    async selectDir() {
      const response = await fetch(joinUrl(baseUrl, "/api/utils/select-dir"), {
        method: "POST",
      });
      return parseResponse<{ path: string | null }>(response);
    },
    async getHistory() {
      const response = await fetch(joinUrl(baseUrl, "/api/history"));
      return parseResponse<HistoryItem[]>(response);
    },
    async getConfig() {
      const response = await fetch(joinUrl(baseUrl, "/api/utils/config"));
      return parseResponse<AppConfig>(response);
    },
    async updateConfig(config) {
      const response = await fetch(joinUrl(baseUrl, "/api/utils/config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      return parseResponse<{ status: string }>(response);
    },
    async switchProfile(id) {
      const response = await fetch(joinUrl(baseUrl, "/api/utils/config/switch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      return parseResponse<{ status: string; active_id: string }>(response);
    },
    async addProfile(name, copy = true) {
      const response = await fetch(joinUrl(baseUrl, "/api/utils/config/profiles"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, copy }),
      });
      return parseResponse<{ status: string; id: string }>(response);
    },
    async deleteProfile(id) {
      const response = await fetch(joinUrl(baseUrl, `/api/utils/config/profiles/${id}`), {
        method: "DELETE",
      });
      return parseResponse<{ status: string }>(response);
    },
    async testLlm(payload) {
      const response = await fetch(joinUrl(baseUrl, "/api/utils/test-llm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return parseResponse<{ status: string; message: string }>(response);
    },
  };
}
