import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/i18n/instance";
import { useHistoryList } from "./use-history-list";

const getHistoryMock = vi.hoisted(() => vi.fn());
const deleteHistoryEntryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({
    getHistory: getHistoryMock,
    deleteHistoryEntry: deleteHistoryEntryMock,
  }),
}));

vi.mock("@/lib/runtime", () => ({
  getApiBaseUrl: () => "http://127.0.0.1:8765",
  getApiToken: () => "",
}));

describe("useHistoryList localization", () => {
  it("uses the active language for history loading errors", async () => {
    await i18n.changeLanguage("en");
    getHistoryMock.mockRejectedValue(new Error());

    const { result } = renderHook(() => useHistoryList());

    await waitFor(() => {
      expect(result.current.error).toBe("Could not load history. Try again shortly.");
    });
  });
});
