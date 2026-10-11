import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n/instance";
import { SourceStep } from "./source-step";
import { SourceListPanel } from "./source-list";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measureElement: vi.fn(),
  }),
}));

describe("launcher source localization", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("zh-CN");
  });

  it("translates the source selection instructions and manual path form", async () => {
    await i18n.changeLanguage("en");
    render(
      <SourceStep
        sourceDropZoneRef={{ current: null }}
        loading={false}
        isDropActive={false}
        isDraggingGlobal={false}
        isDesktopEnvironment={false}
        isSourceDropdownOpen={false}
        onSetSourceDropdownOpen={() => {}}
        showManualInput
        onSetShowManualInput={() => {}}
        commonDirs={[]}
        sourceDraftType="directory"
        onSetSourceDraftType={() => {}}
        sourceDraftPath=""
        onSetSourceDraftPath={() => {}}
        onAddManualSource={() => {}}
        onImportDirectoryEntries={() => {}}
        onChooseDirectories={() => {}}
        onChooseFiles={() => {}}
        onImportCommonDir={() => {}}
        listItems={[]}
        sourceStats={{ total: 0, directoryCount: 0, fileCount: 0 }}
        showClearConfirm={false}
        onClearSources={() => {}}
        onRemoveSource={() => {}}
        onImportInternal={() => {}}
        onSetAtomicMode={() => {}}
        onToggleGroupExpanded={() => {}}
        onRemoveGroup={() => {}}
      />,
    );

    expect(screen.getByText("Sources for this task")).toBeInTheDocument();
    expect(screen.getByText("Before you start")).toBeInTheDocument();
    expect(screen.getByText("Drop files or folders here to organize them")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter an absolute path...")).toBeInTheDocument();
  });

  it("translates the source list header and counts", async () => {
    await i18n.changeLanguage("en");
    render(
      <SourceListPanel
        items={[]}
        loading={false}
        stats={{ total: 2, directoryCount: 1, fileCount: 1 }}
        showClearConfirm={false}
        onClearSources={() => {}}
        onRemoveSource={() => {}}
        onImportInternal={() => {}}
        onSetAtomicMode={() => {}}
        onToggleGroupExpanded={() => {}}
        onRemoveGroup={() => {}}
      />,
    );

    expect(screen.getByText("Added sources")).toBeInTheDocument();
    expect(screen.getByText("1 folder · 1 file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear sources" })).toBeInTheDocument();
  });
});
