import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IncrementalSelectionView } from "./incremental-selection-view";
import i18n from "@/i18n/instance";

describe("IncrementalSelectionView", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("zh-CN");
  });

  it("normalizes root options before selecting all", () => {
    const onConfirm = vi.fn();

    render(
      <IncrementalSelectionView
        rootDirectoryOptions={["Docs\\", "Docs", "Archive/"]}
        sourceTreeEntries={[
          { source_relpath: "Docs", display_name: "Docs", entry_type: "directory" },
          { source_relpath: "Archive", display_name: "Archive", entry_type: "directory" },
          { source_relpath: "Docset", display_name: "Docset", entry_type: "directory" },
        ]}
        loading={false}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("2 个候选")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    fireEvent.click(screen.getByRole("button", { name: /确认选择并继续/ }));

    expect(onConfirm).toHaveBeenCalledWith(["Docs", "Archive"]);
    expect(screen.getAllByText(/已包含 1 项/)).toHaveLength(2);
  });

  it("renders the existing-folder selection flow in English", async () => {
    await i18n.changeLanguage("en");
    render(
      <IncrementalSelectionView
        rootDirectoryOptions={["Documents"]}
        sourceTreeEntries={[{ source_relpath: "Documents", display_name: "Documents", entry_type: "directory" }]}
        loading={false}
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByText("Choose folders to use as targets")).toBeInTheDocument();
    expect(screen.getByText("Available folders")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm and continue/ })).toBeDisabled();
  });
});
