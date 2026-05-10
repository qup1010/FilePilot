import { waitForRuntimeConfig } from "@/lib/runtime";
import { createUserFacingRequestError } from "@/lib/user-facing-copy";
import type {
  CleanupResponse,
  ConfirmTargetsRequest,
  ConfirmTargetsResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  ExecuteResponse,
  GetSessionResponse,
  HistoryItem,
  JournalSummary,
  MessageResponse,
  PrecheckResponse,
  ResumeSessionResponse,
  RollbackResponse,
  ScanAcceptedResponse,
  SessionSnapshot,
  TargetProfile,
  UpdateItemRequest,
} from "@/types/session";
import type {
  SettingsPresetCreatePayload,
  SettingsSnapshot,
  SettingsTestResult,
  SettingsUpdatePayload,
} from "@/types/settings";

function joinUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`).toString();
}

function buildAuthHeaders(apiToken?: string, headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  if (apiToken) {
    nextHeaders.set("Authorization", `Bearer ${apiToken}`);
  }
  return nextHeaders;
}

async function resolveRequestRuntime(baseUrl: string, apiToken?: string) {
  const runtime = await waitForRuntimeConfig();
  return {
    baseUrl: runtime.base_url?.trim() || baseUrl,
    apiToken: runtime.api_token?.trim() || apiToken || "",
  };
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  apiToken?: string,
): Promise<T> {
  const runtime = await resolveRequestRuntime(baseUrl, apiToken);
  const response = await fetch(joinUrl(runtime.baseUrl, path), {
    ...init,
    headers: buildAuthHeaders(runtime.apiToken, init.headers),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw createUserFacingRequestError(response.status, response.statusText, errorText);
  }

  return (await response.json()) as T;
}

export interface ApiClient {
  createSession(payload: CreateSessionRequest): Promise<CreateSessionResponse>;
  getSession(session_id: string): Promise<GetSessionResponse>;
  resumeSession(session_id: string): Promise<ResumeSessionResponse>;
  abandonSession(session_id: string): Promise<{ session_id: string; session_snapshot: SessionSnapshot }>;
  scanSession(session_id: string): Promise<ScanAcceptedResponse>;
  refreshSession(session_id: string): Promise<ScanAcceptedResponse>;
  confirmTargetDirectories(session_id: string, payload: ConfirmTargetsRequest): Promise<ConfirmTargetsResponse>;
  sendMessage(session_id: string, content: string): Promise<MessageResponse>;
  updateItem(session_id: string, payload: UpdateItemRequest): Promise<{ session_id: string; session_snapshot: SessionSnapshot }>;
  runPrecheck(session_id: string): Promise<PrecheckResponse>;
  returnToPlanning(session_id: string): Promise<{ session_id: string; session_snapshot: SessionSnapshot }>;
  execute(session_id: string, confirm?: boolean): Promise<ExecuteResponse>;
  cleanupEmptyDirs(session_id: string): Promise<CleanupResponse>;
  rollback(session_id: string, confirm?: boolean): Promise<RollbackResponse>;
  getJournal(session_id: string): Promise<JournalSummary>;
  openDir(path: string): Promise<{ status: string }>;
  selectDir(): Promise<{ path: string | null }>;
  getCommonDirs(): Promise<{ label: string; path: string }[]>;
  getHistory(): Promise<HistoryItem[]>;
  deleteHistoryEntry(entry_id: string): Promise<{ status: string; entry_id: string; entry_type: string }>;
  getTargetProfiles(): Promise<TargetProfile[]>;
  createTargetProfile(payload: { name: string; directories: Array<{ path: string; label?: string; description?: string }> }): Promise<TargetProfile>;
  updateTargetProfile(profile_id: string, payload: { name?: string; directories?: Array<{ path: string; label?: string; description?: string }> }): Promise<TargetProfile>;
  deleteTargetProfile(profile_id: string): Promise<{ status: string; profile_id: string }>;
  getSettings(): Promise<SettingsSnapshot>;
  getSettingsRuntime<T = Record<string, unknown>>(family: string): Promise<T>;
  updateSettings(payload: SettingsUpdatePayload): Promise<SettingsSnapshot>;
  activateSettingsPreset(family: "text" | "vision" | "icon_image", id: string): Promise<{ status: string }>;
  createSettingsPreset(family: "text" | "vision" | "icon_image", payload: SettingsPresetCreatePayload): Promise<{ status: string; id: string }>;
  deleteSettingsPreset(family: "text" | "vision" | "icon_image", id: string): Promise<{ status: string }>;
  testSettings(payload: { family: "text" | "vision" | "icon_image"; mode?: "shared_text" | "separate"; preset?: Record<string, any>; secret?: { action: string; value?: string } }): Promise<SettingsTestResult>;
}

export function createApiClient(baseUrl: string, apiToken?: string): ApiClient {
  return {
    async createSession(payload) {
      return requestJson<CreateSessionResponse>(
        baseUrl,
        "/api/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        apiToken,
      );
    },
    async getSession(session_id) {
      return requestJson<GetSessionResponse>(baseUrl, `/api/sessions/${session_id}`, {}, apiToken);
    },
    async resumeSession(session_id) {
      return requestJson<ResumeSessionResponse>(
        baseUrl,
        `/api/sessions/${session_id}/resume`,
        { method: "POST" },
        apiToken,
      );
    },
    async abandonSession(session_id) {
      return requestJson<{ session_id: string; session_snapshot: SessionSnapshot }>(
        baseUrl,
        `/api/sessions/${session_id}/abandon`,
        { method: "POST" },
        apiToken,
      );
    },
    async scanSession(session_id) {
      return requestJson<ScanAcceptedResponse>(
        baseUrl,
        `/api/sessions/${session_id}/scan`,
        { method: "POST" },
        apiToken,
      );
    },
    async refreshSession(session_id) {
      return requestJson<ScanAcceptedResponse>(
        baseUrl,
        `/api/sessions/${session_id}/refresh`,
        { method: "POST" },
        apiToken,
      );
    },
    async confirmTargetDirectories(session_id, payload) {
      return requestJson<ConfirmTargetsResponse>(
        baseUrl,
        `/api/sessions/${session_id}/incremental-selection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        apiToken,
      );
    },
    async sendMessage(session_id, content) {
      return requestJson<MessageResponse>(
        baseUrl,
        `/api/sessions/${session_id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
        apiToken,
      );
    },
    async updateItem(session_id, payload) {
      return requestJson<{ session_id: string; session_snapshot: SessionSnapshot }>(
        baseUrl,
        `/api/sessions/${session_id}/update-item`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        apiToken,
      );
    },
    async runPrecheck(session_id) {
      return requestJson<PrecheckResponse>(
        baseUrl,
        `/api/sessions/${session_id}/precheck`,
        { method: "POST" },
        apiToken,
      );
    },
    async returnToPlanning(session_id) {
      return requestJson<{ session_id: string; session_snapshot: SessionSnapshot }>(
        baseUrl,
        `/api/sessions/${session_id}/return-to-planning`,
        { method: "POST" },
        apiToken,
      );
    },
    async execute(session_id, confirm = true) {
      return requestJson<ExecuteResponse>(
        baseUrl,
        `/api/sessions/${session_id}/execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm }),
        },
        apiToken,
      );
    },
    async cleanupEmptyDirs(session_id) {
      return requestJson<CleanupResponse>(
        baseUrl,
        `/api/sessions/${session_id}/cleanup-empty-dirs`,
        { method: "POST" },
        apiToken,
      );
    },
    async rollback(session_id, confirm = true) {
      return requestJson<RollbackResponse>(
        baseUrl,
        `/api/sessions/${session_id}/rollback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm }),
        },
        apiToken,
      );
    },
    async getJournal(session_id) {
      return requestJson<JournalSummary>(baseUrl, `/api/sessions/${session_id}/journal`, {}, apiToken);
    },
    async openDir(path) {
      return requestJson<{ status: string }>(
        baseUrl,
        "/api/utils/open-dir",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        },
        apiToken,
      );
    },
    async selectDir() {
      return requestJson<{ path: string | null }>(
        baseUrl,
        "/api/utils/select-dir",
        { method: "POST" },
        apiToken,
      );
    },
    async getCommonDirs() {
      return requestJson<{ label: string; path: string }[]>(baseUrl, "/api/utils/common-dirs", {}, apiToken);
    },
    async getHistory() {
      return requestJson<HistoryItem[]>(baseUrl, "/api/history", {}, apiToken);
    },
    async deleteHistoryEntry(entry_id) {
      return requestJson<{ status: string; entry_id: string; entry_type: string }>(
        baseUrl,
        `/api/history/${entry_id}`,
        { method: "DELETE" },
        apiToken,
      );
    },
    async getTargetProfiles() {
      const response = await requestJson<{ items: TargetProfile[] }>(baseUrl, "/api/target-profiles", {}, apiToken);
      return response.items || [];
    },
    async createTargetProfile(payload) {
      const response = await requestJson<{ item: TargetProfile }>(
        baseUrl,
        "/api/target-profiles",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        apiToken,
      );
      return response.item;
    },
    async updateTargetProfile(profile_id, payload) {
      const response = await requestJson<{ item: TargetProfile }>(
        baseUrl,
        `/api/target-profiles/${profile_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        apiToken,
      );
      return response.item;
    },
    async deleteTargetProfile(profile_id) {
      return requestJson<{ status: string; profile_id: string }>(
        baseUrl,
        `/api/target-profiles/${profile_id}`,
        { method: "DELETE" },
        apiToken,
      );
    },
    async getSettings() {
      return requestJson<SettingsSnapshot>(baseUrl, "/api/settings", {}, apiToken);
    },
    async getSettingsRuntime(family) {
      return requestJson(baseUrl, `/api/settings/runtime/${family}`, {}, apiToken);
    },
    async updateSettings(payload) {
      return requestJson<SettingsSnapshot>(
        baseUrl,
        "/api/settings",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        apiToken,
      );
    },
    async activateSettingsPreset(family, id) {
      return requestJson<{ status: string }>(
        baseUrl,
        `/api/settings/presets/${family}/${id}/activate`,
        { method: "POST" },
        apiToken,
      );
    },
    async createSettingsPreset(family, payload) {
      return requestJson<{ status: string; id: string }>(
        baseUrl,
        `/api/settings/presets/${family}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        apiToken,
      );
    },
    async deleteSettingsPreset(family, id) {
      return requestJson<{ status: string }>(
        baseUrl,
        `/api/settings/presets/${family}/${id}`,
        { method: "DELETE" },
        apiToken,
      );
    },
    async testSettings(payload) {
      const runtime = await resolveRequestRuntime(baseUrl, apiToken);
      const response = await fetch(joinUrl(runtime.baseUrl, "/api/settings/test"), {
        method: "POST",
        headers: buildAuthHeaders(runtime.apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as SettingsTestResult;
      if (!response.ok && data?.status !== "error") {
        throw createUserFacingRequestError(response.status, response.statusText, JSON.stringify(data));
      }
      return data;
    },
  };
}
