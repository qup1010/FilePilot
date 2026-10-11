import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n/instance";
import { DEFAULT_LAUNCHER_STRATEGY_SELECTION } from "@/lib/strategy-templates";
import type { LauncherStrategySelection } from "@/types/session";
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
        strategy={{ ...DEFAULT_LAUNCHER_STRATEGY_SELECTION, language: "zh", language_preference: "zh" }}
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
    expect(screen.getByRole("combobox", { name: "Folder name language" })).toHaveValue("zh");
    expect(screen.getByRole("option", { name: "Match app language" })).toBeInTheDocument();
    expect(screen.getByText("项目资料")).toBeInTheDocument();
  });

  it("shows the effective automatic language and preserves it when a template changes", async () => {
    await i18n.changeLanguage("en");
    const onUpdateStrategy = vi.fn();
    const strategy: LauncherStrategySelection = {
      ...DEFAULT_LAUNCHER_STRATEGY_SELECTION,
      language: "zh",
      language_preference: "auto",
    };
    render(
      <StrategyStep
        strategy={strategy}
        loading={false}
        isFullCategorize
        newDirectoryRoot="D:/Desktop"
        previewDirectories={["Project files"]}
        onUpdateStrategy={onUpdateStrategy}
        onOpenAdvancedSettings={() => {}}
      />,
    );

    expect(screen.getByText("Matches app language (English)")).toBeInTheDocument();
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "project_workspace" } });

    const update = onUpdateStrategy.mock.calls[0][0] as (previous: LauncherStrategySelection) => LauncherStrategySelection;
    expect(update(strategy)).toMatchObject({
      template_id: "project_workspace",
      language: "zh",
      language_preference: "auto",
    });
  });

  it("resolves automatic language to the current app language when explicitly selected", async () => {
    await i18n.changeLanguage("en");
    const onUpdateStrategy = vi.fn();
    const strategy: LauncherStrategySelection = {
      ...DEFAULT_LAUNCHER_STRATEGY_SELECTION,
      language: "zh",
      language_preference: "zh",
    };
    render(
      <StrategyStep
        strategy={strategy}
        loading={false}
        isFullCategorize
        newDirectoryRoot="D:/Desktop"
        previewDirectories={["Project files"]}
        onUpdateStrategy={onUpdateStrategy}
        onOpenAdvancedSettings={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Folder name language" }), { target: { value: "auto" } });
    const update = onUpdateStrategy.mock.calls[0][0] as (previous: LauncherStrategySelection) => LauncherStrategySelection;
    expect(update(strategy)).toMatchObject({ language: "en", language_preference: "auto" });
  });
});
