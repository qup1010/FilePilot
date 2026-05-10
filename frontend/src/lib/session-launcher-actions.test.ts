import { describe, expect, it, vi } from "vitest";

import { createLaunchSession, firstSourcePath, startFreshSession } from "./session-launcher-actions";

const fullLaunchPayload = {
  sources: [
    { source_type: "directory" as const, path: "D:/inbox", directory_mode: "atomic" as const },
    { source_type: "file" as const, path: "D:/loose/readme.txt" },
  ],
  resume_if_exists: false,
  organize_method: "categorize_into_new_structure" as const,
  output_dir: "D:/sorted",
  strategy: {
    template_id: "general_downloads" as const,
    organize_mode: "initial" as const,
    task_type: "organize_full_directory" as const,
    organize_method: "categorize_into_new_structure" as const,
    destination_index_depth: 2 as const,
    language: "zh" as const,
    density: "normal" as const,
    prefix_style: "none" as const,
    caution_level: "balanced" as const,
    output_dir: "D:/sorted",
    note: "",
  },
};

describe("session-launcher-actions", () => {
  it("returns the first valid source path", () => {
    expect(
      firstSourcePath([
        { source_type: "directory", path: "   ", directory_mode: "atomic" as const },
        { source_type: "file", path: "D:/a.txt" },
        { source_type: "directory", path: "D:/folder", directory_mode: "atomic" as const },
      ]),
    ).toBe("D:/a.txt");
  });

  it("creates a session with the new full-session payload", async () => {
    const api = {
      createSession: vi.fn().mockResolvedValue({
        mode: "created",
        session_id: "session-2",
        restorable_session: null,
        session_snapshot: null,
      }),
    };

    await createLaunchSession(api, fullLaunchPayload);

    expect(api.createSession).toHaveBeenCalledWith(fullLaunchPayload);
  });

  it("restarts from a completed session without abandoning it", async () => {
    const api = {
      abandonSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue({
        mode: "created",
        session_id: "session-2",
        restorable_session: null,
        session_snapshot: null,
      }),
    };

    await startFreshSession(api, "session-1", "completed", fullLaunchPayload);

    expect(api.abandonSession).not.toHaveBeenCalled();
    expect(api.createSession).toHaveBeenCalledWith({
      ...fullLaunchPayload,
      resume_if_exists: false,
    });
  });

  it("submits target profile and manual target directories for existing-category sessions", async () => {
    const api = {
      createSession: vi.fn().mockResolvedValue({
        mode: "created",
        session_id: "session-2",
        restorable_session: null,
        session_snapshot: null,
      }),
    };

    const payload = {
      sources: [{ source_type: "directory" as const, path: "D:/downloads", directory_mode: "atomic" as const }],
      resume_if_exists: true,
      organize_method: "assign_into_existing_categories" as const,
      target_profile_id: "profile-1",
      target_directories: ["D:/archive/docs", "D:/archive/media"],
      strategy: {
        template_id: "general_downloads" as const,
        organize_mode: "incremental" as const,
        task_type: "organize_into_existing" as const,
        organize_method: "assign_into_existing_categories" as const,
        destination_index_depth: 2 as const,
        language: "zh" as const,
        density: "normal" as const,
        prefix_style: "none" as const,
        caution_level: "balanced" as const,
        target_profile_id: "profile-1",
        note: "",
      },
    };

    await createLaunchSession(api, payload);

    expect(api.createSession).toHaveBeenCalledWith(payload);
  });

  it("passes through atomic directory selections unchanged", async () => {
    const api = {
      createSession: vi.fn().mockResolvedValue({
        mode: "created",
        session_id: "session-2",
        restorable_session: null,
        session_snapshot: null,
      }),
    };

    const payload = {
      ...fullLaunchPayload,
      sources: [{ source_type: "directory" as const, path: "D:/projects/repo", directory_mode: "atomic" as const }],
      output_dir: "D:/projects",
      strategy: {
        ...fullLaunchPayload.strategy,
        output_dir: "D:/projects",
      },
    };

    await createLaunchSession(api, payload);

    expect(api.createSession).toHaveBeenCalledWith(payload);
  });
});

