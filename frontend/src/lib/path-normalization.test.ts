import { describe, expect, it } from "vitest";

import { deriveWorkspaceRoot, getPathParent, normalizeFilesystemPath } from "./path-normalization";

describe("path-normalization", () => {
  it("normalizes Windows drive roots without returning drive-relative paths", () => {
    expect(normalizeFilesystemPath("D:")).toBe("D:/");
    expect(getPathParent("D:/incoming")).toBe("D:/");
    expect(getPathParent("D:/incoming/file.txt")).toBe("D:/incoming");
  });

  it("keeps UNC parents at the share boundary", () => {
    expect(getPathParent("\\\\server\\share\\a")).toBe("\\\\server\\share");
    expect(getPathParent("\\\\server\\share")).toBe("\\\\server\\share");
  });

  it("derives workspace roots for mixed source selections", () => {
    expect(
      deriveWorkspaceRoot([
        { source_type: "directory", path: "D:/incoming", directory_mode: "atomic" },
        { source_type: "file", path: "D:/incoming/file.txt" },
      ]),
    ).toBe("D:/");

    expect(
      deriveWorkspaceRoot([
        { source_type: "directory", path: "D:/incoming", directory_mode: "contents" },
      ]),
    ).toBe("D:/incoming");
  });
});

