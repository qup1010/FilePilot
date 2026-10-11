import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n/instance";
import { ErrorBoundary } from "./error-boundary";
import { ModelConfigBanner } from "./model-config-banner";

function ThrowingChild(): never {
  throw new Error("render failure");
}

describe("shared UI localization", () => {
  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await i18n.changeLanguage("zh-CN");
  });

  it("uses English defaults for the model warning and error fallback", async () => {
    await i18n.changeLanguage("en");
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <>
        <ModelConfigBanner />
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>
      </>,
    );

    expect(screen.getByText("AI text model not configured")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure text model" })).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
