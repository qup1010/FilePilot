import type { ComposerMode, SessionStage } from "@/types/session";

export type SessionWorkspacePhase =
  | "setup"
  | "analyzing"
  | "planning"
  | "reviewing"
  | "executing"
  | "completed"
  | "recovery"
  | "inactive";

export interface SessionStageViewModel {
  stage: SessionStage;
  phase: SessionWorkspacePhase;
  isDraftLike: boolean;
  isTargetSelection: boolean;
  isScanning: boolean;
  isPlanning: boolean;
  isPlanningConversation: boolean;
  isAwaitingPrecheck: boolean;
  isReadyToExecute: boolean;
  isExecuting: boolean;
  isRollingBack: boolean;
  isBusyStage: boolean;
  isCompleted: boolean;
  isStale: boolean;
  isInterrupted: boolean;
  isRecovery: boolean;
  isInactive: boolean;
  composerMode: ComposerMode;
}

function phaseFromStage(stage: SessionStage): SessionWorkspacePhase {
  if (stage === "idle" || stage === "draft" || stage === "selecting_incremental_scope") {
    return "setup";
  }
  if (stage === "scanning") {
    return "analyzing";
  }
  if (stage === "planning" || stage === "ready_for_precheck") {
    return "planning";
  }
  if (stage === "ready_to_execute") {
    return "reviewing";
  }
  if (stage === "executing" || stage === "rolling_back") {
    return "executing";
  }
  if (stage === "completed") {
    return "completed";
  }
  if (stage === "stale" || stage === "interrupted") {
    return "recovery";
  }
  return "inactive";
}

function composerModeFromStage(stage: SessionStage): ComposerMode {
  if (stage === "planning" || stage === "ready_for_precheck") {
    return "editable";
  }
  if (stage === "scanning" || stage === "idle" || stage === "draft" || stage === "selecting_incremental_scope") {
    return "readonly";
  }
  return "hidden";
}

export function getSessionStageView(stage: SessionStage): SessionStageViewModel {
  const phase = phaseFromStage(stage);
  const isDraftLike = stage === "idle" || stage === "draft";
  const isTargetSelection = stage === "selecting_incremental_scope";
  const isScanning = stage === "scanning";
  const isPlanning = stage === "planning";
  const isPlanningConversation = stage === "planning" || stage === "ready_for_precheck";
  const isAwaitingPrecheck = stage === "ready_for_precheck";
  const isReadyToExecute = stage === "ready_to_execute";
  const isExecuting = stage === "executing";
  const isRollingBack = stage === "rolling_back";
  const isCompleted = stage === "completed";
  const isStale = stage === "stale";
  const isInterrupted = stage === "interrupted";
  const isRecovery = isStale || isInterrupted;
  const isInactive = stage === "abandoned";

  return {
    stage,
    phase,
    isDraftLike,
    isTargetSelection,
    isScanning,
    isPlanning,
    isPlanningConversation,
    isAwaitingPrecheck,
    isReadyToExecute,
    isExecuting,
    isRollingBack,
    isBusyStage: isScanning || isExecuting || isRollingBack,
    isCompleted,
    isStale,
    isInterrupted,
    isRecovery,
    isInactive,
    composerMode: composerModeFromStage(stage),
  };
}
