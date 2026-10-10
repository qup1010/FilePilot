import { describe, expect, it } from "vitest";

import { validateLocalePair } from "../../scripts/check-translations.mjs";

describe("translation resource validation", () => {
  it("accepts locale-specific English and Chinese plural categories", () => {
    const errors = validateLocalePair(
      {
        fileCount_zero: "No files",
        fileCount_one: "{{count}} file",
        fileCount_other: "{{count}} files",
      },
      {
        fileCount_zero: "没有文件",
        fileCount_other: "{{count}} 个文件",
      },
    );

    expect(errors).toEqual([]);
  });

  it("reports missing keys, invalid Chinese plural categories, and parameter mismatches", () => {
    const errors = validateLocalePair(
      {
        fileCount_one: "{{count}} file",
        fileCount_other: "{{count}} files",
        ready: "Ready",
      },
      {
        fileCount_one: "{{total}} 个文件",
        fileCount_other: "{{total}} 个文件",
      },
    );

    expect(errors).toContain('zh-CN: fileCount uses unsupported plural category "one"');
    expect(errors).toContain("fileCount (one): interpolation parameters differ between en and zh-CN");
    expect(errors).toContain("fileCount (other): interpolation parameters differ between en and zh-CN");
    expect(errors).toContain("en: ready has no Simplified Chinese translation");
  });
});
