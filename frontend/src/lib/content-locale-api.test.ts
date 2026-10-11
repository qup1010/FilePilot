import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "@/lib/api";
import { createIconWorkbenchApiClient } from "@/lib/icon-workbench-api";
import { waitForRuntimeConfig } from "@/lib/runtime";

vi.mock("@/lib/runtime", () => ({
  waitForRuntimeConfig: vi.fn(),
}));

const fetchMock = vi.fn();
const waitForRuntimeConfigMock = vi.mocked(waitForRuntimeConfig);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  waitForRuntimeConfigMock.mockResolvedValue({ base_url: "", api_token: "" });
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AI content locale API requests", () => {
  it("sends the UI language with target profile rule draft requests", async () => {
    await createApiClient("http://127.0.0.1:8765").generateProfileRuleDrafts("profile-1", undefined, "en");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8765/api/target-profiles/profile-1/rule-drafts");
    expect(JSON.parse(init.body)).toEqual({ content_locale: "en" });
  });

  it("sends the captured UI language with icon analysis batches", async () => {
    await createIconWorkbenchApiClient("http://127.0.0.1:8765").analyzeFolders(
      "icon-session-1",
      ["folder-1", "folder-2"],
      "en",
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8765/api/icon-workbench/sessions/icon-session-1/analyze");
    expect(JSON.parse(init.body)).toEqual({ folder_ids: ["folder-1", "folder-2"], content_locale: "en" });
  });
});
