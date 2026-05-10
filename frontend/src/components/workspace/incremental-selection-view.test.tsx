import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IncrementalSelectionView } from "./incremental-selection-view";

describe("IncrementalSelectionView", () => {
  afterEach(() => {
    cleanup();
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
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));

    expect(onConfirm).toHaveBeenCalledWith(["Docs", "Archive"]);
    expect(screen.getAllByText("顶层项 1")).toHaveLength(2);
  });
});
