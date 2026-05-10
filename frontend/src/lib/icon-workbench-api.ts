import { waitForRuntimeConfig } from "@/lib/runtime";
import { createUserFacingRequestError } from "@/lib/user-facing-copy";
import type {
  ApplyReadyPreparation,
  IconTemplate,
  IconWorkbenchClientActionReportPayload,
  IconWorkbenchConfig,
  IconWorkbenchConfigPayload,
  IconWorkbenchHistoryItem,
  IconWorkbenchSession,
  IconWorkbenchTargetUpdatePayload,
} from "@/types/icon-workbench";

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

export interface IconWorkbenchApiClient {
  createSession(target_paths: string[]): Promise<IconWorkbenchSession>;
  listSessions(): Promise<IconWorkbenchHistoryItem[]>;
  getSession(session_id: string): Promise<IconWorkbenchSession>;
  deleteSession(session_id: string): Promise<{ status: string; session_id: string }>;
  scanSession(session_id: string): Promise<IconWorkbenchSession>;
  updateTargets(session_id: string, payload: IconWorkbenchTargetUpdatePayload): Promise<IconWorkbenchSession>;
  removeTarget(session_id: string, folder_id: string): Promise<IconWorkbenchSession>;
  analyzeFolders(session_id: string, folder_ids: string[]): Promise<IconWorkbenchSession>;
  generatePreviews(session_id: string, folder_ids: string[]): Promise<IconWorkbenchSession>;
  updatePrompt(session_id: string, folder_id: string, prompt: string): Promise<IconWorkbenchSession>;
  selectVersion(session_id: string, folder_id: string, version_id: string): Promise<IconWorkbenchSession>;
  deleteVersion(session_id: string, folder_id: string, version_id: string): Promise<IconWorkbenchSession>;
  getConfig(): Promise<IconWorkbenchConfigPayload>;
  updateConfig(config: IconWorkbenchConfig): Promise<IconWorkbenchConfig>;
  switchConfigPreset(id: string): Promise<IconWorkbenchConfigPayload>;
  addConfigPreset(name: string, config?: Partial<IconWorkbenchConfig> & { name?: string }): Promise<IconWorkbenchConfigPayload>;
  deleteConfigPreset(id: string): Promise<IconWorkbenchConfigPayload>;
  listTemplates(): Promise<IconTemplate[]>;
  createTemplate(payload: Pick<IconTemplate, "name" | "description" | "prompt_template">): Promise<IconTemplate>;
  updateTemplate(template_id: string, payload: Partial<Pick<IconTemplate, "name" | "description" | "prompt_template">>): Promise<IconTemplate>;
  deleteTemplate(template_id: string): Promise<{ status: string; template_id: string }>;
  applyTemplate(session_id: string, template_id: string, folder_ids: string[]): Promise<IconWorkbenchSession>;
  prepareApplyReady(session_id: string, folder_ids: string[]): Promise<ApplyReadyPreparation>;
  reportClientAction(session_id: string, payload: IconWorkbenchClientActionReportPayload): Promise<IconWorkbenchSession>;
}

export function createIconWorkbenchApiClient(baseUrl: string, apiToken?: string): IconWorkbenchApiClient {
  return {
    async createSession(target_paths) {
      return requestJson<IconWorkbenchSession>(
        baseUrl,
        "/api/icon-workbench/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_paths }),
        },
        apiToken,
      );
    },
    async listSessions() {
      const payload = await requestJson<{ sessions: IconWorkbenchHistoryItem[] }>(
        baseUrl,
        "/api/icon-workbench/sessions",
        {},
        apiToken,
      );
      return payload.sessions;
    },
    async getSession(session_id) {
      return requestJson<IconWorkbenchSession>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}`,
        {},
        apiToken,
      );
    },
    async deleteSession(session_id) {
      return requestJson<{ status: string; session_id: string }>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}`,
        { method: "DELETE" },
        apiToken,
      );
    },
    async scanSession(session_id) {
      return requestJson<IconWorkbenchSession>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}/scan`,
        { method: "POST" },
        apiToken,
      );
    },
    async updateTargets(session_id, payload) {
      return requestJson<IconWorkbenchSession>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}/targets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        apiToken,
      );
    },
    async removeTarget(session_id, folder_id) {
      return requestJson<IconWorkbenchSession>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}/targets/${folder_id}`,
        { method: "DELETE" },
        apiToken,
      );
    },
    async analyzeFolders(session_id, folder_ids) {
      return requestJson<IconWorkbenchSession>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_ids }),
        },
        apiToken,
      );
    },
    async generatePreviews(session_id, folder_ids) {
      return requestJson<IconWorkbenchSession>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_ids }),
        },
        apiToken,
      );
    },
    async updatePrompt(session_id, folder_id, prompt) {
      return requestJson<IconWorkbenchSession>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}/folders/${folder_id}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        },
        apiToken,
      );
    },
    async selectVersion(session_id, folder_id, version_id) {
      return requestJson<IconWorkbenchSession>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}/folders/${folder_id}/select-version`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version_id }),
        },
        apiToken,
      );
    },
    async deleteVersion(session_id, folder_id, version_id) {
      return requestJson<IconWorkbenchSession>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}/folders/${folder_id}/versions/${version_id}`,
        { method: "DELETE" },
        apiToken,
      );
    },
    async getConfig() {
      return requestJson<IconWorkbenchConfigPayload>(
        baseUrl,
        "/api/icon-workbench/config",
        {},
        apiToken,
      );
    },
    async updateConfig(config) {
      return requestJson<IconWorkbenchConfig>(
        baseUrl,
        "/api/icon-workbench/config",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        },
        apiToken,
      );
    },
    async switchConfigPreset(id) {
      return requestJson<IconWorkbenchConfigPayload>(
        baseUrl,
        "/api/icon-workbench/config/presets/switch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        },
        apiToken,
      );
    },
    async addConfigPreset(name, config) {
      return requestJson<IconWorkbenchConfigPayload>(
        baseUrl,
        "/api/icon-workbench/config/presets",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, config }),
        },
        apiToken,
      );
    },
    async deleteConfigPreset(id) {
      return requestJson<IconWorkbenchConfigPayload>(
        baseUrl,
        `/api/icon-workbench/config/presets/${id}`,
        { method: "DELETE" },
        apiToken,
      );
    },
    async listTemplates() {
      const payload = await requestJson<{ templates: IconTemplate[] }>(
        baseUrl,
        "/api/icon-workbench/templates",
        {},
        apiToken,
      );
      return payload.templates;
    },
    async createTemplate(payload) {
      const body = await requestJson<{ template: IconTemplate }>(
        baseUrl,
        "/api/icon-workbench/templates",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        apiToken,
      );
      return body.template;
    },
    async updateTemplate(template_id, payload) {
      const body = await requestJson<{ template: IconTemplate }>(
        baseUrl,
        `/api/icon-workbench/templates/${template_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        apiToken,
      );
      return body.template;
    },
    async deleteTemplate(template_id) {
      return requestJson<{ status: string; template_id: string }>(
        baseUrl,
        `/api/icon-workbench/templates/${template_id}`,
        { method: "DELETE" },
        apiToken,
      );
    },
    async applyTemplate(session_id, template_id, folder_ids) {
      return requestJson<IconWorkbenchSession>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}/apply-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template_id, folder_ids }),
        },
        apiToken,
      );
    },
    async prepareApplyReady(session_id, folder_ids) {
      return requestJson<ApplyReadyPreparation>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}/apply-ready`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_ids }),
        },
        apiToken,
      );
    },
    async reportClientAction(session_id, payload) {
      const body = await requestJson<{ session: IconWorkbenchSession }>(
        baseUrl,
        `/api/icon-workbench/sessions/${session_id}/client-actions/report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        apiToken,
      );
      return body.session;
    },
  };
}
