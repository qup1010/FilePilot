import { waitForRuntimeConfig } from "@/lib/runtime";
import { createUserFacingRequestError } from "@/lib/user-facing-copy";

export function joinUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`).toString();
}

export function buildAuthHeaders(apiToken?: string, headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  if (apiToken) {
    nextHeaders.set("Authorization", `Bearer ${apiToken}`);
  }
  return nextHeaders;
}

export async function resolveRequestRuntime(
  baseUrl: string,
  apiToken?: string,
): Promise<{ baseUrl: string; apiToken: string }> {
  const runtime = await waitForRuntimeConfig();
  return {
    baseUrl: runtime.base_url?.trim() || baseUrl,
    apiToken: runtime.api_token?.trim() || apiToken || "",
  };
}

export async function requestJson<T>(
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
