import { describe, expect, it } from "vitest";

import { deriveScannerProgressViewModel } from "./scanner-progress-view";

describe("scanner-progress-view", () => {
  it("labels the directory discovery phase distinctly", () => {
    const view = deriveScannerProgressViewModel(
      { status: "running", processed_count: 0, total_count: 0, recent_analysis_items: [] },
      0,
      "discovering",
    );

    expect(view.phase).toBe("discovering");
    expect(view.title).toBe("正在读取目录结构");
    expect(view.steps.map((step) => step.state)).toEqual(["active", "pending", "pending"]);
  });

  it("labels content analysis when entries are known", () => {
    const view = deriveScannerProgressViewModel(
      { status: "running", processed_count: 3, total_count: 10, recent_analysis_items: [] },
      30,
      "analyzing",
    );

    expect(view.phase).toBe("analyzing");
    expect(view.title).toBe("正在分析文件内容");
    expect(view.steps.map((step) => step.state)).toEqual(["done", "active", "pending"]);
  });

  it("labels initial auto planning as generating a plan instead of scanning", () => {
    const view = deriveScannerProgressViewModel(
      { status: "completed", processed_count: 10, total_count: 10, recent_analysis_items: [] },
      100,
      "planning",
    );

    expect(view.phase).toBe("planning");
    expect(view.title).toBe("正在生成第一版整理方案");
    expect(view.description).toContain("可执行建议");
    expect(view.steps.map((step) => step.state)).toEqual(["done", "done", "active"]);
  });

  it("surfaces stranded initial planning as an actionable state", () => {
    const view = deriveScannerProgressViewModel(
      { status: "completed", processed_count: 10, total_count: 10, recent_analysis_items: [] },
      100,
      "stranded",
    );

    expect(view.phase).toBe("stranded");
    expect(view.title).toBe("目录读取已完成");
    expect(view.description).toContain("自动方案没有继续生成");
    expect(view.steps.map((step) => step.state)).toEqual(["done", "done", "aborted"]);
  });

  it("marks the pipeline complete when the workspace is ready", () => {
    const view = deriveScannerProgressViewModel(
      { status: "completed", processed_count: 10, total_count: 10, recent_analysis_items: [] },
      100,
      "ready",
    );

    expect(view.phase).toBe("ready");
    expect(view.steps.map((step) => step.state)).toEqual(["done", "done", "done"]);
  });
});
