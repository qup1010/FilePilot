import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import type { ApiClient } from "@/lib/api";
import type { SettingsSnapshot } from "@/types/settings";
import { UI_LANGUAGE_STORAGE_KEY } from "./locales";
import { UiLocaleProvider, useUiLocale } from "./locale-provider";

const getSettings = vi.hoisted(() => vi.fn<() => Promise<SettingsSnapshot>>());

vi.mock("@/lib/runtime", () => ({
  getApiBaseUrl: () => "http://127.0.0.1:8765",
  getApiToken: () => "",
  waitForRuntimeConfig: vi.fn().mockResolvedValue({ base_url: "http://127.0.0.1:8765" }),
}));

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({ getSettings }) satisfies Partial<ApiClient>,
}));

function LocaleProbe() {
  const { uiLanguage, resolvedUiLocale, saveUiLanguage } = useUiLocale();
  const [count, setCount] = useState(0);
  return (
    <div>
      <span>{`${uiLanguage}|${resolvedUiLocale}`}</span>
      <span>{`count:${count}`}</span>
      <button onClick={() => setCount((value) => value + 1)}>increment</button>
      <button onClick={() => saveUiLanguage("zh-CN")}>apply Chinese</button>
    </div>
  );
}

function settingsWithLanguage(language: string): SettingsSnapshot {
  return { global_config: { UI_LANGUAGE: language } } as SettingsSnapshot;
}

describe("UiLocaleProvider", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    localStorage.clear();
    getSettings.mockReset();
    document.documentElement.lang = "zh-CN";
  });

  it("uses the backend preference over a cached value and updates the document language", async () => {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "zh-CN");
    getSettings.mockResolvedValue(settingsWithLanguage("en"));

    render(<UiLocaleProvider><LocaleProbe /></UiLocaleProvider>);

    expect(await screen.findByText("en|en")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe("en");
  });

  it("uses the cached preference when the settings API is unavailable", async () => {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "en");
    getSettings.mockRejectedValue(new Error("offline"));

    render(<UiLocaleProvider><LocaleProbe /></UiLocaleProvider>);

    expect(await screen.findByText("en|en")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("updates the cache and html lang after a settings save succeeds", async () => {
    getSettings.mockResolvedValue(settingsWithLanguage("en"));

    render(<UiLocaleProvider><LocaleProbe /></UiLocaleProvider>);
    await screen.findByText("en|en");
    fireEvent.click(screen.getByRole("button", { name: "increment" }));
    fireEvent.click(screen.getByRole("button", { name: "apply Chinese" }));

    await waitFor(() => expect(screen.getByText("zh-CN|zh-CN")).toBeInTheDocument());
    expect(screen.getByText("count:1")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe("zh-CN");
  });
});
