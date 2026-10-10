import { describe, expect, it } from "vitest";

import { formatHistoryTimestamp, formatListSummary, formatLocalizedDate } from "./formatters";

describe("localized display formatters", () => {
  it("formats names and overflow in the active locale", () => {
    expect(formatListSummary(["one", "two", "three", "four"], "en", (names, count) => `${names}, plus ${count} more`))
      .toBe("one, two, and three, plus 1 more");
    expect(formatListSummary(["甲", "乙", "丙", "丁"], "zh-CN", (names, count) => `${names}等 ${count} 项`))
      .toBe("甲、乙和丙等 1 项");
  });

  it("returns an empty string for empty input and preserves a short list", () => {
    const formatRemaining = (names: string, count: number) => `${names}, plus ${count} more`;
    expect(formatListSummary([], "en", formatRemaining)).toBe("");
    expect(formatListSummary(["one", "two"], "en", formatRemaining)).toBe("one and two");
  });

  it("formats dates using the requested locale and preserves invalid values", () => {
    const date = new Date("2026-04-21T08:30:00");
    const english = formatHistoryTimestamp(date, "en");
    const chinese = formatHistoryTimestamp(date, "zh-CN");
    expect(english).toContain("2026");
    expect(chinese).toContain("2026");
    expect(english).not.toBe(chinese);
    expect(formatLocalizedDate("not-a-date", "en")).toBe("not-a-date");
  });
});
