"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { createApiClient } from "@/lib/api";
import { getApiBaseUrl, getApiToken, waitForRuntimeConfig } from "@/lib/runtime";
import i18n from "@/i18n/instance";
import {
  DEFAULT_UI_LANGUAGE,
  isUiLanguagePreference,
  normalizeSavedUiLanguage,
  resolveUiLocale,
  UI_LANGUAGE_STORAGE_KEY,
  type ResolvedUiLocale,
  type UiLanguagePreference,
} from "@/i18n/locales";

interface UiLocaleState {
  uiLanguage: UiLanguagePreference;
  resolvedUiLocale: ResolvedUiLocale;
  ready: boolean;
}

interface UiLocaleContextValue extends UiLocaleState {
  saveUiLanguage: (preference: UiLanguagePreference) => void;
}

const fallbackLocaleState: UiLocaleState = {
  uiLanguage: "zh-CN",
  resolvedUiLocale: "zh-CN",
  ready: true,
};

const UiLocaleContext = createContext<UiLocaleContextValue>({
  ...fallbackLocaleState,
  saveUiLanguage: () => {},
});

function readCachedUiLanguage(): UiLanguagePreference | null {
  try {
    const cached = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    return isUiLanguagePreference(cached) ? cached : null;
  } catch {
    return null;
  }
}

function persistUiLanguage(preference: UiLanguagePreference) {
  try {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // Backend settings remain authoritative when browser storage is unavailable.
  }
}

async function loadSettingsWithTimeout() {
  let timer: number | undefined;
  try {
    return await Promise.race([
      createApiClient(getApiBaseUrl(), getApiToken()).getSettings(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("Settings bootstrap timed out")), 3000);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

export function UiLocaleProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UiLocaleState>({
    uiLanguage: DEFAULT_UI_LANGUAGE,
    resolvedUiLocale: "zh-CN",
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;
    const cachedPreference = readCachedUiLanguage();

    const initialize = async () => {
      let preference = cachedPreference ?? DEFAULT_UI_LANGUAGE;
      try {
        await waitForRuntimeConfig();
        const settings = await loadSettingsWithTimeout();
        preference = normalizeSavedUiLanguage(settings.global_config?.UI_LANGUAGE);
        persistUiLanguage(preference);
      } catch {
        // The cache lets the UI start in its last saved language while the backend is unavailable.
      }

      if (!cancelled) {
        const resolvedUiLocale = resolveUiLocale(preference);
        document.documentElement.lang = resolvedUiLocale;
        await i18n.changeLanguage(resolvedUiLocale);
        if (cancelled) return;
        setState({
          uiLanguage: preference,
          resolvedUiLocale,
          ready: true,
        });
      }
    };

    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.ready) return;
    document.documentElement.lang = state.resolvedUiLocale;
    void i18n.changeLanguage(state.resolvedUiLocale);
  }, [state.ready, state.resolvedUiLocale]);

  useEffect(() => {
    if (!state.ready || state.uiLanguage !== "system") return;
    const handleLanguageChange = () => {
      const resolved = resolveUiLocale("system");
      document.documentElement.lang = resolved;
      void i18n.changeLanguage(resolved);
      setState((current) => ({ ...current, resolvedUiLocale: resolved }));
    };
    window.addEventListener("languagechange", handleLanguageChange);
    return () => window.removeEventListener("languagechange", handleLanguageChange);
  }, [state.ready, state.uiLanguage]);

  const saveUiLanguage = useCallback((preference: UiLanguagePreference) => {
    persistUiLanguage(preference);
    const resolvedUiLocale = resolveUiLocale(preference);
    document.documentElement.lang = resolvedUiLocale;
    void i18n.changeLanguage(resolvedUiLocale);
    setState({
      uiLanguage: preference,
      resolvedUiLocale,
      ready: true,
    });
  }, []);

  const value = useMemo(() => ({ ...state, saveUiLanguage }), [saveUiLanguage, state]);
  if (!state.ready) {
    return <main className="min-h-screen bg-surface" aria-busy="true" aria-label="FilePilot" />;
  }

  return <UiLocaleContext.Provider value={value}>{children}</UiLocaleContext.Provider>;
}

export function useUiLocale() {
  return useContext(UiLocaleContext);
}
