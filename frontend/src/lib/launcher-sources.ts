import { getPathBasename } from "@/lib/path-normalization";
import type {
  DirectorySourceMode,
  SessionSourceSelection,
  TargetProfileDirectory,
} from "@/types/session";

export type SourceDraftType = "directory" | "file";

export type TargetDirectoryDraft = {
  path: string;
  label: string;
  description: string;
};

export type SourceImportGroup = {
  group_id: string;
  source_path: string;
  item_keys: string[];
  expanded: boolean;
};

export type SourceImportGroupView = SourceImportGroup & { items: SessionSourceSelection[] };

export function createImportGroupId(): string {
  return `import-group:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeDirectoryMode(item: Pick<SessionSourceSelection, "source_type" | "directory_mode">): DirectorySourceMode {
  if (item.source_type !== "directory") {
    return "atomic";
  }
  return item.directory_mode === "atomic" ? "atomic" : "contents";
}

export function createDirectorySource(path: string, directoryMode: DirectorySourceMode = "atomic"): SessionSourceSelection {
  return {
    source_type: "directory",
    path,
    directory_mode: directoryMode,
  };
}

export function pathKey(path: string): string {
  let normalized = String(path || "").trim().replace(/\\/g, "/");
  normalized = normalized.replace(/\/+/g, "/");
  while (normalized.length > 1 && normalized.endsWith("/") && !/^[a-z]:\/$/i.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

export function targetDirectoryEditorKey(path: string): string {
  return `target:${pathKey(path)}`;
}

export function sourceSelectionKey(item: Pick<SessionSourceSelection, "source_type" | "path">): string {
  return `${item.source_type}:${pathKey(item.path)}`;
}

function normalizeSourceSelection(item: SessionSourceSelection): SessionSourceSelection | null {
  const path = item.path.trim();
  if (!path) {
    return null;
  }
  if (item.source_type === "directory") {
    return createDirectorySource(path, normalizeDirectoryMode(item));
  }
  if (item.source_type === "file") {
    return { source_type: "file", path };
  }
  return null;
}

export function dedupeSources(items: SessionSourceSelection[]): SessionSourceSelection[] {
  const seen = new Map<string, SessionSourceSelection>();
  for (const item of items) {
    const normalized = normalizeSourceSelection(item);
    if (!normalized) continue;
    const key = sourceSelectionKey(normalized);
    if (seen.has(key)) {
      seen.delete(key);
    }
    seen.set(key, normalized);
  }
  return Array.from(seen.values());
}

function compareSourceForDisplay(a: SessionSourceSelection, b: SessionSourceSelection): number {
  if (a.source_type !== b.source_type) {
    return a.source_type === "directory" ? -1 : 1;
  }
  return getPathBasename(a.path, a.path).localeCompare(getPathBasename(b.path, b.path), "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortSourcesForDisplay(items: SessionSourceSelection[]): SessionSourceSelection[] {
  return [...items].sort(compareSourceForDisplay);
}

export function dedupeTargetDirectories(items: TargetProfileDirectory[]): TargetProfileDirectory[] {
  const seen = new Map<string, TargetProfileDirectory>();
  for (const item of items) {
    const path = item.path.trim();
    if (!path) continue;
    const key = pathKey(path);
    if (seen.has(key)) {
      seen.delete(key);
    }
    seen.set(key, {
      path,
      label: item.label?.trim() || "",
      description: item.description?.trim() || "",
    });
  }
  return Array.from(seen.values());
}

function inferDropSourceType(path: string, entry: { isDirectory?: boolean; isFile?: boolean } | null): SourceDraftType {
  if (entry?.isDirectory) return "directory";
  if (entry?.isFile) return "file";
  return /\.[^./\\]+$/.test(path) ? "file" : "directory";
}

export function extractDroppedSources(dataTransfer: DataTransfer): SessionSourceSelection[] {
  const result: SessionSourceSelection[] = [];
  const items = Array.from(dataTransfer.items || []);
  const fallbackFiles = Array.from(dataTransfer.files || []);

  for (const item of items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean; isFile?: boolean } | null }).webkitGetAsEntry?.() || null;
    const path = String((file as File & { path?: string }).path || "");
    if (!path) continue;
    result.push({
      ...(inferDropSourceType(path, entry) === "file"
        ? ({ source_type: "file", path } as SessionSourceSelection)
        : createDirectorySource(path, "atomic")),
    });
  }

  if (!result.length) {
    for (const file of fallbackFiles) {
      const path = String((file as File & { path?: string }).path || "");
      if (!path) continue;
      result.push(
        /\.[^./\\]+$/.test(path)
          ? { source_type: "file", path }
          : createDirectorySource(path, "atomic"),
      );
    }
  }

  return dedupeSources(result);
}

export function inferSourceSelectionsFromPaths(paths: string[]): SessionSourceSelection[] {
  return dedupeSources(
    paths.map((path) => (
      /\.[^./\\]+$/.test(path)
        ? ({ source_type: "file", path } as SessionSourceSelection)
        : createDirectorySource(path, "atomic")
    )),
  );
}

export function sourceSelectionFromDraft(path: string, draftType: SourceDraftType): SessionSourceSelection {
  if (draftType === "file") {
    return { source_type: "file", path };
  }
  return createDirectorySource(path, "atomic");
}

export function getSourceBehaviorLabel(item: SessionSourceSelection): string {
  if (item.source_type === "file") {
    return "单个文件";
  }
  return normalizeDirectoryMode(item) === "atomic" ? "整体移动" : "整理里面内容";
}

export function mapDirectoryEntryToSource(entry: { path: string; is_dir: boolean; is_file: boolean }): SessionSourceSelection | null {
  const path = String(entry.path || "").trim();
  if (!path) return null;
  if (entry.is_dir) {
    return createDirectorySource(path, "atomic");
  }
  if (entry.is_file) {
    return { source_type: "file", path };
  }
  return null;
}
