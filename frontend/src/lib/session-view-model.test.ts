import { describe, expect, it } from "vitest";

import { getSessionStageView } from "./session-view-model";

describe("session-view-model", () => {
  it("maps setup and planning related stages to stable view flags", () => {
    const targetSelection = getSessionStageView("selecting_incremental_scope");
    expect(targetSelection.phase).toBe("setup");
    expect(targetSelection.isTargetSelection).toBe(true);
    expect(targetSelection.composerMode).toBe("readonly");

    const awaitingPrecheck = getSessionStageView("ready_for_precheck");
    expect(awaitingPrecheck.phase).toBe("planning");
    expect(awaitingPrecheck.isPlanningConversation).toBe(true);
    expect(awaitingPrecheck.isAwaitingPrecheck).toBe(true);
    expect(awaitingPrecheck.composerMode).toBe("editable");

    const readyToExecute = getSessionStageView("ready_to_execute");
    expect(readyToExecute.phase).toBe("reviewing");
    expect(readyToExecute.isReadyToExecute).toBe(true);
    expect(readyToExecute.composerMode).toBe("hidden");
  });

  it("marks recovery and busy stages consistently", () => {
    const interrupted = getSessionStageView("interrupted");
    expect(interrupted.phase).toBe("recovery");
    expect(interrupted.isRecovery).toBe(true);
    expect(interrupted.isInterrupted).toBe(true);
    expect(interrupted.isBusyStage).toBe(false);

    const rollingBack = getSessionStageView("rolling_back");
    expect(rollingBack.phase).toBe("executing");
    expect(rollingBack.isRollingBack).toBe(true);
    expect(rollingBack.isBusyStage).toBe(true);
  });
});
