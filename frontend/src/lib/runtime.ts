import type { RuntimeConfig } from "@/types/session";

declare global {
  interface Window {
    __FILE_ORGANIZER_RUNTIME__?: RuntimeConfig;
    __TAURI_INTERNALS__?: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    };
  }
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8765";

export function readRuntimeConfig(): RuntimeConfig {
  if (typeof window !== "undefined" && window.__FILE_ORGANIZER_RUNTIME__) {
    return window.__FILE_ORGANIZER_RUNTIME__;
  }

  return {
    base_url:
      process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || DEFAULT_BASE_URL,
  };
}

export function getApiBaseUrl(): string {
  const baseUrl = readRuntimeConfig().base_url?.trim() || DEFAULT_BASE_URL;
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

export function getApiToken(): string {
  return readRuntimeConfig().api_token?.trim() || "";
}

export function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__?.invoke;
}

export async function invokeTauriCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauriDesktop()) {
    return null;
  }
  return window.__TAURI_INTERNALS__!.invoke<T>(command, args);
}

export async function pickDirectoryWithTauri(): Promise<string | null> {
  return invokeTauriCommand<string | null>("pick_directory");
}
