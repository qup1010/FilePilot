import type { SessionSourceSelection } from "@/types/session";

function isDriveRoot(value: string): boolean {
  return /^[A-Za-z]:\/$/.test(value);
}

function normalizeDrivePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (/^[A-Za-z]:$/.test(normalized)) {
    return `${normalized}/`;
  }
  return normalized;
}

function normalizeUncPath(value: string): string {
  const parts = value.replace(/^\\+/, "").split(/[\\/]+/).filter(Boolean);
  if (parts.length < 2) {
    return value.trim();
  }
  return `\\\\${parts.join("\\")}`;
}

export function normalizeFilesystemPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^\\\\/.test(trimmed)) {
    return normalizeUncPath(trimmed);
  }
  return normalizeDrivePath(trimmed);
}

export function getPathParent(path: string): string {
  const normalized = normalizeFilesystemPath(path);
  if (!normalized) return "";

  if (/^\\\\/.test(normalized)) {
    const parts = normalized.replace(/^\\+/, "").split("\\").filter(Boolean);
    if (parts.length <= 2) {
      return `\\\\${parts.join("\\")}`;
    }
    return `\\\\${parts.slice(0, -1).join("\\")}`;
  }

  if (isDriveRoot(normalized)) {
    return normalized;
  }
  const parts = normalized.split("/");
  if (parts.length <= 1) return normalized;
  const parent = parts.slice(0, -1).join("/");
  if (/^[A-Za-z]:$/.test(parent)) {
    return `${parent}/`;
  }
  return parent || "/";
}

function normalizeDirectoryMode(item: Pick<SessionSourceSelection, "source_type" | "directory_mode">): string {
  if (item.source_type !== "directory") {
    return "atomic";
  }
  return item.directory_mode === "atomic" ? "atomic" : "contents";
}

export function deriveWorkspaceRoot(sources: SessionSourceSelection[]): string {
  const normalizedPaths = sources
    .map((item) => {
      const path = normalizeFilesystemPath(item.path);
      if (!path) return "";
      return item.source_type === "directory" && normalizeDirectoryMode(item) === "contents"
        ? path
        : getPathParent(path);
    })
    .filter(Boolean);
  if (!normalizedPaths.length) return "";
  if (normalizedPaths.length === 1) return normalizedPaths[0];

  const firstPath = normalizedPaths[0];
  if (/^\\\\/.test(firstPath)) {
    const pathSegments = normalizedPaths.map((path) => path.replace(/^\\+/, "").split("\\").filter(Boolean));
    const first = pathSegments[0];
    const common: string[] = [];
    for (let index = 0; index < first.length; index += 1) {
      const segment = first[index];
      if (pathSegments.every((parts) => parts[index]?.toLowerCase() === segment.toLowerCase())) {
        common.push(segment);
        continue;
      }
      break;
    }
    return common.length >= 2 ? `\\\\${common.join("\\")}` : "";
  }

  const pathSegments = normalizedPaths.map((path) => path.split("/").filter(Boolean));
  const first = pathSegments[0];
  const common: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index];
    if (pathSegments.every((parts) => parts[index]?.toLowerCase() === segment.toLowerCase())) {
      common.push(segment);
      continue;
    }
    break;
  }
  if (common.length === 1 && /^[A-Za-z]:$/.test(common[0])) {
    return `${common[0]}/`;
  }
  return common.join("/");
}
