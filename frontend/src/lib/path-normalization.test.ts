import { describe, expect, it } from "vitest";

import { deriveWorkspaceRoot, getPathBasename, getPathParent, normalizeFilesystemPath } from "./path-normalization";

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

  describe("getPathBasename", () => {
    it("keeps Windows drive roots as drive labels", () => {
      expect(getPathBasename("C:\\")).toBe("C:\\");
      expect(getPathBasename("c:/")).toBe("C:\\");
      expect(getPathBasename("D:")).toBe("D:\\");
    });

    it("decodes URL-encoded paths before extracting the last segment", () => {
      expect(getPathBasename("D%3A%2Fincoming%2F%E6%96%87%E6%A1%A3")).toBe("文档");
      expect(getPathBasename("D:/incoming/my%20folder")).toBe("my folder");
    });

    it("strips trailing separators", () => {
      expect(getPathBasename("D:/incoming/photos/")).toBe("photos");
      expect(getPathBasename("D:\\incoming\\photos\\\\")).toBe("photos");
    });

    it("returns the fallback for empty or blank input", () => {
      expect(getPathBasename("")).toBe("");
      expect(getPathBasename(null, "当前任务")).toBe("当前任务");
      expect(getPathBasename(undefined, "未知条目")).toBe("未知条目");
      expect(getPathBasename("   ", "未命名记录")).toBe("未命名记录");
    });

    it("handles mixed separators and root slashes", () => {
      expect(getPathBasename("D:\\incoming/nested\\deep")).toBe("deep");
      expect(getPathBasename("/")).toBe("/");
      expect(getPathBasename("\\")).toBe("/");
      expect(getPathBasename("/var/data/reports")).toBe("reports");
    });

    it("falls back to the raw segment when decoding fails", () => {
      expect(getPathBasename("D:/incoming/100%")).toBe("100%");
    });
  });
});

