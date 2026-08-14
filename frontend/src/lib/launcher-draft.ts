import {
  dedupeSources,
  sourceSelectionKey,
  type SourceDraftType,
  type SourceImportGroup,
  type TargetDirectoryDraft,
} from "@/lib/launcher-sources";
import type { SessionSourceSelection, SessionStrategySelection } from "@/types/session";

export type LauncherDraftState = {
  version: 1;
  step?: 1 | 2 | 3;
  strategy?: SessionStrategySelection;
  sources?: SessionSourceSelection[];
  sourceImportGroups?: SourceImportGroup[];
  sourceDraftType?: SourceDraftType;
  sourceDraftPath?: string;
  newDirectoryRoot?: string;
  reviewRoot?: string;
  reviewFollowsNewRoot?: boolean;
  showPlacementOverrides?: boolean;
  manualTargetDirectories?: TargetDirectoryDraft[];
  targetDirectoryDraft?: string;
  selectedTargetProfileId?: string;
  showManualInput?: boolean;
  showManualTargetInput?: boolean;
};

const LAUNCHER_DRAFT_KEY = "file_pilot_launcher_draft";

export function readLauncherDraft(): LauncherDraftState | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(LAUNCHER_DRAFT_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as LauncherDraftState;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function sanitizeLauncherDraft(draft: LauncherDraftState | null): LauncherDraftState | null {
  if (!draft) {
    return null;
  }
  const sources = dedupeSources(draft.sources || []);
  const sourceKeys = new Set(sources.map((item) => sourceSelectionKey(item)));
  return {
    ...draft,
    step: draft.step === 2 || draft.step === 3 ? draft.step : 1,
    sources,
    sourceImportGroups: (draft.sourceImportGroups || [])
      .map((group) => ({
        ...group,
        item_keys: group.item_keys.filter((key) => sourceKeys.has(key)),
        expanded: Boolean(group.expanded),
      }))
      .filter((group) => group.item_keys.length > 0),
    sourceDraftType: draft.sourceDraftType === "file" ? "file" : "directory",
    sourceDraftPath: draft.sourceDraftPath || "",
    manualTargetDirectories: (draft.manualTargetDirectories || []).filter((item) => item.path.trim()),
    targetDirectoryDraft: draft.targetDirectoryDraft || "",
    selectedTargetProfileId: draft.selectedTargetProfileId || "",
    showManualInput: Boolean(draft.showManualInput),
    showManualTargetInput: Boolean(draft.showManualTargetInput),
    showPlacementOverrides: Boolean(draft.showPlacementOverrides),
  };
}

export function persistLauncherDraft(draft: LauncherDraftState) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(LAUNCHER_DRAFT_KEY, JSON.stringify(draft));
}

export function clearLauncherDraft() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(LAUNCHER_DRAFT_KEY);
}
