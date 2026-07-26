import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PathDiffViewer } from "./path-diff-viewer";

describe("PathDiffViewer", () => {
  afterEach(() => {
    cleanup();
  });

  it("extracts common root and renders modified folders with correct style in wide grid mode", () => {
    render(
      <PathDiffViewer
        source="D:/projects/active/FilePilot/frontend/src/old.tsx"
        target="D:/projects/active/FilePilot/frontend/dist/old.tsx"
        compact={false}
      />
    );

    // Common root should be D:/projects/active/FilePilot/frontend/ (truncated as D:/.../FilePilot/frontend/)
    expect(screen.getAllByText("D:/.../FilePilot/frontend/").length).toBeGreaterThan(0);

    // Source segment should display "src"
    expect(screen.getByText("src")).toBeInTheDocument();

    // Target segment should display "dist"
    expect(screen.getByText("dist")).toBeInTheDocument();

    // Filename should be "old.tsx"
    expect(screen.getAllByText("old.tsx").length).toBeGreaterThan(0);
  });

  it("extracts common root and renders folder segments in compact mode", () => {
    render(
      <PathDiffViewer
        source="C:/downloads/temp/file.txt"
        target="C:/downloads/archive/file.txt"
        compact={true}
      />
    );

    // Common root normalized should be C:/downloads/
    expect(screen.getAllByText("C:/downloads/").length).toBeGreaterThan(0);

    // Temp folder and Archive folder
    expect(screen.getByText("temp")).toBeInTheDocument();
    expect(screen.getByText("archive")).toBeInTheDocument();
  });

  it("highlights Review folder segments with warning styling in target folders", () => {
    render(
      <PathDiffViewer
        source="D:/data/inbox/item.png"
        target="D:/data/Review/item.png"
        compact={false}
      />
    );

    // Common root should be D:/data/
    expect(screen.getAllByText("D:/data/").length).toBeGreaterThan(0);

    // Target segment Review should be rendered
    const reviewSegment = screen.getByText("Review");
    expect(reviewSegment).toBeInTheDocument();
    expect(reviewSegment.className).toContain("text-warning");
  });

  it("uses explicit review metadata even when the target path has no Review segment", () => {
    render(
      <PathDiffViewer
        source="D:/data/inbox/item.png"
        target="D:/data/Pending/item.png"
        compact={false}
        targetKind="review"
      />
    );

    const fileNames = screen.getAllByText("item.png");
    expect(fileNames.some((node) => node.className.includes("text-warning"))).toBe(true);
  });

  it("handles empty or single-level paths without crashing", () => {
    render(
      <PathDiffViewer
        source="file.txt"
        target="new_file.txt"
        compact={true}
      />
    );

    // Filename should be visible
    expect(screen.getAllByText("new_file.txt").length).toBeGreaterThan(0);
  });
});
