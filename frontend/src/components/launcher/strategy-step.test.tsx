import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/i18n/instance";
import { DEFAULT_STRATEGY_SELECTION } from "@/lib/strategy-templates";
import { StrategyStep } from "./strategy-step";

describe("launcher strategy localization", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("zh-CN");
  });

  it("translates strategy controls without changing the selected output folder language", async () => {
    await i18n.changeLanguage("en");
    render(
      <StrategyStep
        strategy={{ ...DEFAULT_STRATEGY_SELECTION, language: "zh" }}
        loading={false}
        isFullCategorize
        newDirectoryRoot="D:/Desktop"
        previewDirectories={["项目资料"]}
        onUpdateStrategy={() => {}}
        onOpenAdvancedSettings={() => {}}
      />,
    );

    expect(screen.getByText("Organization settings")).toBeInTheDocument();
    expect(screen.getByText("General cleanup")).toBeInTheDocument();
    expect(screen.getByText("Folder name language")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chinese" })).toBeInTheDocument();
    expect(screen.getByText("项目资料")).toBeInTheDocument();
  });
});
