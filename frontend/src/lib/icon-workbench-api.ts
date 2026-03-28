import type {
  ApplyReadyPreparation,
  IconWorkbenchActionResponse,
  IconWorkbenchClientActionReportPayload,
  IconTemplate,
  IconWorkbenchConfig,
  IconWorkbenchMessagePayload,
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

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed (${response.status} ${response.statusText}): ${errorText}`);
  }
  return response.json() as Promise<T>;
}

export interface IconWorkbenchApiClient {
  createSession(target_paths: string[]): Promise<IconWorkbenchSession>;
  getSession(session_id: string): Promise<IconWorkbenchSession>;
  scanSession(session_id: string): Promise<IconWorkbenchSession>;
  updateTargets(session_id: string, payload: IconWorkbenchTargetUpdatePayload): Promise<IconWorkbenchSession>;
  removeTarget(session_id: string, folder_id: string): Promise<IconWorkbenchSession>;
  analyzeFolders(session_id: string, folder_ids: string[]): Promise<IconWorkbenchSession>;
  generatePreviews(session_id: string, folder_ids: string[]): Promise<IconWorkbenchSession>;
  updatePrompt(session_id: string, folder_id: string, prompt: string): Promise<IconWorkbenchSession>;
  selectVersion(session_id: string, folder_id: string, version_id: string): Promise<IconWorkbenchSession>;
  getConfig(): Promise<IconWorkbenchConfig>;
  updateConfig(config: IconWorkbenchConfig): Promise<IconWorkbenchConfig>;
  listTemplates(): Promise<IconTemplate[]>;
  createTemplate(payload: Pick<IconTemplate, "name" | "description" | "prompt_template">): Promise<IconTemplate>;
  updateTemplate(template_id: string, payload: Partial<Pick<IconTemplate, "name" | "description" | "prompt_template">>): Promise<IconTemplate>;
  deleteTemplate(template_id: string): Promise<{ status: string; template_id: string }>;
  applyTemplate(session_id: string, template_id: string, folder_ids: string[]): Promise<IconWorkbenchSession>;
  prepareApplyReady(session_id: string, folder_ids: string[]): Promise<ApplyReadyPreparation>;
  sendMessage(session_id: string, payload: IconWorkbenchMessagePayload): Promise<IconWorkbenchSession>;
  confirmAction(session_id: string, action_id: string): Promise<IconWorkbenchActionResponse>;
  dismissAction(session_id: string, action_id: string): Promise<IconWorkbenchSession>;
  reportClientAction(session_id: string, payload: IconWorkbenchClientActionReportPayload): Promise<IconWorkbenchSession>;
}

export function createIconWorkbenchApiClient(baseUrl: string, apiToken?: string): IconWorkbenchApiClient {
  return {
    async createSession(target_paths) {
      const response = await fetch(joinUrl(baseUrl, "/api/icon-workbench/sessions"), {
        method: "POST",
        headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ target_paths }),
      });
      return parseResponse<IconWorkbenchSession>(response);
    },
    async getSession(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}`), {
        headers: buildAuthHeaders(apiToken),
      });
      return parseResponse<IconWorkbenchSession>(response);
    },
    async scanSession(session_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/scan`), {
        method: "POST",
        headers: buildAuthHeaders(apiToken),
      });
      return parseResponse<IconWorkbenchSession>(response);
    },
    async updateTargets(session_id, payload) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/targets`), {
        method: "POST",
        headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      return parseResponse<IconWorkbenchSession>(response);
    },
    async removeTarget(session_id, folder_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/targets/${folder_id}`), {
        method: "DELETE",
        headers: buildAuthHeaders(apiToken),
      });
      return parseResponse<IconWorkbenchSession>(response);
    },
    async analyzeFolders(session_id, folder_ids) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/analyze`), {
        method: "POST",
        headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ folder_ids }),
      });
      return parseResponse<IconWorkbenchSession>(response);
    },
    async generatePreviews(session_id, folder_ids) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/generate`), {
        method: "POST",
        headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ folder_ids }),
      });
      return parseResponse<IconWorkbenchSession>(response);
    },
    async updatePrompt(session_id, folder_id, prompt) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/folders/${folder_id}/prompt`), {
        method: "POST",
        headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ prompt }),
      });
      return parseResponse<IconWorkbenchSession>(response);
    },
    async selectVersion(session_id, folder_id, version_id) {
      const response = await fetch(
        joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/folders/${folder_id}/select-version`),
        {
          method: "POST",
          headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
          body: JSON.stringify({ version_id }),
        },
      );
      return parseResponse<IconWorkbenchSession>(response);
    },
    async getConfig() {
      const response = await fetch(joinUrl(baseUrl, "/api/icon-workbench/config"), {
        headers: buildAuthHeaders(apiToken),
      });
      return parseResponse<IconWorkbenchConfig>(response);
    },
    async updateConfig(config) {
      const response = await fetch(joinUrl(baseUrl, "/api/icon-workbench/config"), {
        method: "POST",
        headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify(config),
      });
      return parseResponse<IconWorkbenchConfig>(response);
    },
    async listTemplates() {
      const response = await fetch(joinUrl(baseUrl, "/api/icon-workbench/templates"), {
        headers: buildAuthHeaders(apiToken),
      });
      const payload = await parseResponse<{ templates: IconTemplate[] }>(response);
      return payload.templates;
    },
    async createTemplate(payload) {
      const response = await fetch(joinUrl(baseUrl, "/api/icon-workbench/templates"), {
        method: "POST",
        headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const body = await parseResponse<{ template: IconTemplate }>(response);
      return body.template;
    },
    async updateTemplate(template_id, payload) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/templates/${template_id}`), {
        method: "PATCH",
        headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const body = await parseResponse<{ template: IconTemplate }>(response);
      return body.template;
    },
    async deleteTemplate(template_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/templates/${template_id}`), {
        method: "DELETE",
        headers: buildAuthHeaders(apiToken),
      });
      return parseResponse<{ status: string; template_id: string }>(response);
    },
    async applyTemplate(session_id, template_id, folder_ids) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/apply-template`), {
        method: "POST",
        headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ template_id, folder_ids }),
      });
      return parseResponse<IconWorkbenchSession>(response);
    },
    async prepareApplyReady(session_id, folder_ids) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/apply-ready`), {
        method: "POST",
        headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ folder_ids }),
      });
      return parseResponse<ApplyReadyPreparation>(response);
    },
    async sendMessage(session_id, payload) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/messages`), {
        method: "POST",
        headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const body = await parseResponse<{ session: IconWorkbenchSession }>(response);
      return body.session;
    },
    async confirmAction(session_id, action_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/actions/${action_id}/confirm`), {
        method: "POST",
        headers: buildAuthHeaders(apiToken),
      });
      return parseResponse<IconWorkbenchActionResponse>(response);
    },
    async dismissAction(session_id, action_id) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/actions/${action_id}/dismiss`), {
        method: "POST",
        headers: buildAuthHeaders(apiToken),
      });
      const body = await parseResponse<{ session: IconWorkbenchSession }>(response);
      return body.session;
    },
    async reportClientAction(session_id, payload) {
      const response = await fetch(joinUrl(baseUrl, `/api/icon-workbench/sessions/${session_id}/client-actions/report`), {
        method: "POST",
        headers: buildAuthHeaders(apiToken, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const body = await parseResponse<{ session: IconWorkbenchSession }>(response);
      return body.session;
    },
  };
}
