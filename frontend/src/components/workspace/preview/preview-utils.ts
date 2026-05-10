import type { 
  PlacementConfig, 
  PlanItem, 
  PlanTargetSlot, 
  SourceTreeEntry 
} from "@/types/session";

export type PreviewFilter = "all" | "changed" | "unresolved" | "review" | "invalidated";

export interface PreviewFocusRequest {
  token: number;
  itemIds: string[];
  filter?: PreviewFilter;
}

export { type PlanSnapshot } from "@/types/session";

export interface TreeNode {
  name: string;
  path: string;
  kind: "directory" | "file";
  item?: PlanItem;
  sourceEntry?: SourceTreeEntry;
  children: TreeNode[];
}

export interface AvailableTargetOption {
  key: string;
  label: string;
  directory: string;
  targetSlotId?: string;
}

export type TargetSlotLookup = Map<string, PlanTargetSlot>;

export const REVIEW_DIRECTORY = "Review";
export const REVIEW_LABEL = "待确认区";

export function normalizePath(path: string | null | undefined): string {
  return String(path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim();
}

export function isAbsolutePath(path: string | null | undefined): boolean {
  const value = String(path || "").trim();
  return /^[a-zA-Z]:/.test(value) || value.startsWith("/");
}

export function escapesRelativeRoot(path: string | null | undefined): boolean {
  const parts = normalizePath(path).split("/").filter(Boolean);
  let depth = 0;
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (depth === 0) return true;
      depth -= 1;
      continue;
    }
    depth += 1;
  }
  return false;
}

export function normalizeEntryKind(entryType: string | null | undefined): "directory" | "file" {
  return ["dir", "directory", "folder"].includes(String(entryType || "").toLowerCase()) ? "directory" : "file";
}

export function fileExtension(item: Pick<PlanItem | SourceTreeEntry, "display_name" | "source_relpath" | "entry_type">): string {
  if (normalizeEntryKind(item.entry_type) === "directory") return "目录";
  const source = item.display_name || item.source_relpath;
  const ext = source.split(".").pop()?.toLowerCase();
  return ext && ext !== source.toLowerCase() ? ext : "无后缀";
}

export function statusMeta(status: PlanItem["status"]) {
  if (status === "unresolved") return { label: "待决策", tone: "bg-warning/10 text-warning border-warning/20" };
  if (status === "review") return { label: "待核对", tone: "bg-primary/10 text-primary border-primary/20" };
  if (status === "invalidated") return { label: "需重确认", tone: "bg-error/10 text-error border-error/20" };
  return { label: "已就绪", tone: "text-success-dim/40 border-transparent" };
}

export function acceptedReviewStatusMeta() {
  return { label: "已保留", tone: "border-success/20 bg-success/10 text-success-dim" };
}

export function itemStatusMeta(item: PlanItem, acceptedReviewItemIds: string[]) {
  if (item.status === "review" && acceptedReviewItemIds.includes(item.item_id)) {
    return acceptedReviewStatusMeta();
  }
  return statusMeta(item.status);
}

export function resolveItemDirectory(item: PlanItem, targetSlotById: TargetSlotLookup, placement: PlacementConfig): string {
  if (item.status === "review" || item.target_slot_id === REVIEW_DIRECTORY) return REVIEW_DIRECTORY;
  if (item.target_slot_id) {
    const slot = targetSlotById.get(item.target_slot_id);
    if (slot?.relpath) return slot.relpath;
  }
  return "当前目录";
}

export function displayDirectoryLabel(directory: string): string {
  return directory === REVIEW_DIRECTORY ? REVIEW_LABEL : directory;
}

export function resolveItemTargetPath(item: PlanItem, targetSlotById: TargetSlotLookup, placement: PlacementConfig): string {
  const directoryLabel = resolveItemDirectory(item, targetSlotById, placement);
  const filename = item.display_name || item.source_relpath.split("/").pop() || item.source_relpath;
  return directoryLabel && directoryLabel !== "当前目录" ? `${displayDirectoryLabel(directoryLabel)}/${filename}` : filename;
}

export function isItemChanged(item: PlanItem, targetSlotById: TargetSlotLookup, placement: PlacementConfig) {
  return normalizePath(item.source_relpath) !== normalizePath(resolveItemTargetPath(item, targetSlotById, placement));
}

export function groupItemsByTargetSlot(items: PlanItem[], targetSlotById: TargetSlotLookup, placement: PlacementConfig) {
  const groups = new Map<string, PlanItem[]>();
  items.forEach((item) => {
    const directory = resolveItemDirectory(item, targetSlotById, placement);
    if (!directory || directory === "当前目录") return;
    const existing = groups.get(directory) || [];
    existing.push(item);
    groups.set(directory, existing);
  });
  return groups;
}

export function matchesFilter(item: PlanItem, filter: PreviewFilter, targetSlotById: TargetSlotLookup, placement: PlacementConfig) {
  if (filter === "all") return true;
  if (filter === "changed") return isItemChanged(item, targetSlotById, placement);
  if (filter === "unresolved") return item.status === "unresolved";
  if (filter === "review") return item.status === "review";
  return item.status === "invalidated";
}

export function sortTree(root: TreeNode) {
  const sortNode = (node: TreeNode) => {
    node.children.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name, "zh-CN");
    });
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root.children;
}

export function buildPlanTree(items: PlanItem[], mkdirPreview: string[], resolveItemPath: (item: PlanItem) => string): TreeNode[] {
  const root: TreeNode = { name: "", path: "", kind: "directory", children: [] };
  const ensureDir = (parts: string[]) => {
    let current = root;
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let next = current.children.find((child) => child.kind === "directory" && child.name === part);
      if (!next) {
        next = { name: part, path: currentPath, kind: "directory", children: [] };
        current.children.push(next);
      }
      current = next;
    }
    return current;
  };
  mkdirPreview.forEach((dir) => {
    const parts = normalizePath(dir).split("/").filter(Boolean);
    if (parts.length) ensureDir(parts);
  });
  items.forEach((item) => {
    const rawPath = resolveItemPath(item) || item.source_relpath;
    const parts = normalizePath(rawPath).split("/").filter(Boolean);
    if (parts.length === 0) return;
    if (normalizeEntryKind(item.entry_type) === "directory") {
      const directoryNode = ensureDir(parts);
      directoryNode.item = directoryNode.item || item;
      return;
    }
    const filename = parts.pop();
    if (!filename) return;
    const parent = ensureDir(parts);
    parent.children.push({ name: filename, path: normalizePath(rawPath), kind: "file", item, children: [] });
  });
  return sortTree(root);
}

export function buildSourceTree(entries: SourceTreeEntry[], itemBySource: Map<string, PlanItem>): TreeNode[] {
  const root: TreeNode = { name: "", path: "", kind: "directory", children: [] };
  const ensureDir = (parts: string[]) => {
    let current = root;
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let next = current.children.find((child) => child.kind === "directory" && child.name === part);
      if (!next) {
        next = { name: part, path: currentPath, kind: "directory", children: [] };
        current.children.push(next);
      }
      current = next;
    }
    return current;
  };

  entries.forEach((entry) => {
    const entryPath = normalizePath(entry.source_relpath);
    const parts = entryPath.split("/").filter(Boolean);
    if (parts.length === 0) return;
    const linkedItem = itemBySource.get(entryPath);
    if (normalizeEntryKind(entry.entry_type) === "directory") {
      const directoryNode = ensureDir(parts);
      directoryNode.sourceEntry = directoryNode.sourceEntry || entry;
      directoryNode.item = directoryNode.item || linkedItem;
      return;
    }
    const filename = parts.pop();
    if (!filename) return;
    const parent = ensureDir(parts);
    parent.children.push({
      name: filename,
      path: entryPath,
      kind: "file",
      item: linkedItem,
      sourceEntry: entry,
      children: [],
    });
  });

  return sortTree(root);
}

export function mappingStatusLabel(status: string | undefined, item?: PlanItem, acceptedReviewItemIds: string[] = []): string {
  if (item && item.status === "review" && acceptedReviewItemIds.includes(item.item_id)) return "已保留";
  if (status === "review") return "待核对";
  if (status === "unresolved") return "待决策";
  if (status === "assigned") return "已分配";
  if (status === "skipped") return "保留原位";
  return "已规划";
}
