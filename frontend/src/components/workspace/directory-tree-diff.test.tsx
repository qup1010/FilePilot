import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DirectoryTreeDiff } from "./directory-tree-diff";

describe("DirectoryTreeDiff", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks parent directories as review from explicit leaf status without a Review path segment", () => {
    render(
      <DirectoryTreeDiff
        before={{
          title: "整理前目录树",
          subtitle: "",
          leafEntries: [],
        }}
        after={{
          title: "整理后目录树",
          subtitle: "",
          leafEntries: [{ path: "Pending/item.pdf", status: "review" }],
        }}
      />
    );

    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("待确认")).toBeInTheDocument();
    expect(screen.getByText("待核对")).toBeInTheDocument();
  });
});
