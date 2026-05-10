import type { RuntimeConfig } from "@/types/session";

declare global {
  interface Window {
    __FILE_PILOT_RUNTIME__?: RuntimeConfig;
    __TAURI_INTERNALS__?: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    };
  }
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8765";
const RUNTIME_READY_EVENT = "file-pilot-runtime-ready";

function hasInjectedDesktopRuntime(): boolean {
  return Boolean(
    typeof window !== "undefined" &&
      window.__FILE_PILOT_RUNTIME__?.base_url?.trim(),
  );
}

async function hasTauriCore(): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    await import("@tauri-apps/api/core");
    return true;
  } catch {
    return false;
  }
}

async function tryHydrateRuntimeFromTauri(): Promise<RuntimeConfig | null> {
  const runtime = await invokeTauriCommand<RuntimeConfig>("get_runtime_config");
  if (runtime?.base_url?.trim() && typeof window !== "undefined") {
    window.__FILE_PILOT_RUNTIME__ = runtime;
    window.dispatchEvent(
      new CustomEvent(RUNTIME_READY_EVENT, { detail: runtime }),
    );
    return runtime;
  }
  return runtime ?? null;
}

export function readRuntimeConfig(): RuntimeConfig {
  if (typeof window !== "undefined" && window.__FILE_PILOT_RUNTIME__) {
    return window.__FILE_PILOT_RUNTIME__;
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
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function waitForRuntimeConfig(
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<RuntimeConfig> {
  if (typeof window === "undefined" || hasInjectedDesktopRuntime()) {
    return readRuntimeConfig();
  }

  if (!(await hasTauriCore())) {
    return readRuntimeConfig();
  }

  const tauriRuntime = await tryHydrateRuntimeFromTauri();
  if (tauriRuntime?.base_url?.trim()) {
    return tauriRuntime;
  }

  await new Promise<void>((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let timer: number | null = null;

    const cleanup = () => {
      window.removeEventListener(RUNTIME_READY_EVENT, onReady);
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };

    const onReady = () => {
      cleanup();
      resolve();
    };

    window.addEventListener(RUNTIME_READY_EVENT, onReady, { once: true });
    timer = window.setInterval(() => {
      if (hasInjectedDesktopRuntime() || Date.now() >= deadline) {
        cleanup();
        resolve();
      }
    }, intervalMs);
  });

  if (!hasInjectedDesktopRuntime()) {
    const fallbackRuntime = await tryHydrateRuntimeFromTauri();
    if (fallbackRuntime?.base_url?.trim()) {
      return fallbackRuntime;
    }
  }

  return readRuntimeConfig();
}

export async function invokeTauriCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch (error) {
    console.warn(`Tauri command failed: ${command}`, error);
    return null;
  }
}

export async function pickDirectoryWithTauri(): Promise<string | null> {
  return invokeTauriCommand<string | null>("pick_directory");
}

export async function pickDirectoriesWithTauri(): Promise<string[] | null> {
  return invokeTauriCommand<string[] | null>("pick_directories");
}

export async function pickFilesWithTauri(): Promise<string[] | null> {
  return invokeTauriCommand<string[] | null>("pick_files");
}

export type TauriInspectedPath = {
  path: string;
  is_dir: boolean;
  is_file: boolean;
  error_code?: string | null;
  message?: string | null;
};

export type TauriResultEnvelope<T> = {
  ok: boolean;
  items: T[];
  ignored_count: number;
  error_code?: string | null;
  message?: string | null;
};

function unwrapTauriItems<T>(result: T[] | TauriResultEnvelope<T> | null): T[] {
  if (!result) {
    return [];
  }
  return Array.isArray(result) ? result : result.items;
}

export async function inspectPathsWithTauri(paths: string[]): Promise<TauriInspectedPath[]> {
  const result = await invokeTauriCommand<TauriInspectedPath[] | TauriResultEnvelope<TauriInspectedPath>>("inspect_paths", { paths });
  return unwrapTauriItems(result);
}

export type TauriDirectoryEntry = {
  path: string;
  is_dir: boolean;
  is_file: boolean;
};

export async function listDirectoryEntriesWithTauri(path: string): Promise<TauriDirectoryEntry[]> {
  const result = await listDirectoryEntriesResultWithTauri(path);
  return result.items;
}

export async function listDirectoryEntriesResultWithTauri(path: string): Promise<TauriResultEnvelope<TauriDirectoryEntry>> {
  const result = await invokeTauriCommand<TauriDirectoryEntry[] | TauriResultEnvelope<TauriDirectoryEntry>>("list_directory_entries", { path });
  if (!result) {
    return {
      ok: false,
      items: [],
      ignored_count: 0,
      error_code: "TAURI_COMMAND_FAILED",
      message: "无法读取桌面端目录列表。",
    };
  }
  if (Array.isArray(result)) {
    return { ok: true, items: result, ignored_count: 0, error_code: null, message: null };
  }
  return result;
}

export async function openDirectoryWithTauri(path: string): Promise<void> {
  await invokeTauriCommand<void>("open_directory", { path });
}

export async function saveFileAsTauri(sourcePath: string, filename: string): Promise<boolean> {
  const result = await invokeTauriCommand<boolean>("save_file_as", { sourcePath, filename });
  return result ?? false;
}
