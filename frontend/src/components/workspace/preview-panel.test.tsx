import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { optionDirectoryForTarget, optionIdentityForTarget, PreviewPanel } from "./preview-panel";

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: React.ComponentProps<"button">) => <button {...props}>{children}</button>,
    span: ({ children, ...props }: React.ComponentProps<"span">) => <span {...props}>{children}</span>,
  },
}));

vi.mock("./markdown-prose", () => ({
  MarkdownProse: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogClose: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
}));

describe("PreviewPanel", () => {
  afterEach(() => {
    cleanup();
  });

  const createPlan = () => ({
    summary: "",
    items: [],
    groups: [],
    target_slots: [],
    mappings: [],
    display_plan: null,
    unresolved_items: [],
    review_items: [],
    invalidated_items: [],
    change_highlights: [],
    stats: {
      directory_count: 0,
      move_count: 0,
      unresolved_count: 0,
    },
    readiness: {
      can_precheck: false,
    },
  });

  it("shows previous-plan sync hint while a new plan is running", () => {
    render(
      <PreviewPanel
        plan={{ ...createPlan(), summary: "旧方案摘要" }}
        stage="planning"
        isBusy={false}
        isPlanSyncing
        plannerStatus={{
          isRunning: true,
          preservingPreviousPlan: true,
        }}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    expect(screen.getByText("正在基于你的最新要求重算方案")).toBeInTheDocument();
    expect(screen.getByText("当前显示的是上一版方案，新方案完成后会自动替换")).toBeInTheDocument();
  });

  it("allows collapsing the pending queue to free space for the tree", () => {
    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          summary: "方案摘要",
          items: [
            {
              item_id: "item-review-1",
              display_name: "important_invoice_301.exe",
              source_relpath: "incoming/important_invoice_301.exe",
              target_slot_id: "Review",
              status: "review",
              mapping_status: "review",
              suggested_purpose: "Review",
              content_summary: "待人工核对",
              reason: "用途不够稳定",
              confidence: 0.62,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 1,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: true,
          },
        }}
        stage="ready_for_precheck"
        isBusy={false}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    expect(screen.getByText("待确认队列")).toBeInTheDocument();
    expect(screen.getAllByText("important_invoice_301.exe").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "收起" }));

    expect(screen.getByRole("button", { name: "展开列表" })).toBeInTheDocument();
    expect(screen.getByText("待确认队列")).toBeInTheDocument();
    expect(screen.getAllByText("暂放待确认 1").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "展开列表" }));

    expect(screen.getAllByText("important_invoice_301.exe").length).toBeGreaterThan(0);
  });

  it("shows pending-review state instead of syncing when review items still need checking", () => {
    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          summary: "方案摘要",
          items: [
            {
              item_id: "item-review-1",
              display_name: "important_invoice_301.exe",
              source_relpath: "incoming/important_invoice_301.exe",
              target_slot_id: "Review",
              status: "review",
              mapping_status: "review",
              suggested_purpose: "Review",
              content_summary: "待人工核对",
              reason: "用途不够稳定",
              confidence: 0.62,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 1,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: false,
          },
        }}
        stage="planning"
        isBusy={false}
        plannerStatus={{
          isRunning: false,
          preservingPreviousPlan: false,
        }}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    expect(screen.getAllByText("待确认 1").length).toBeGreaterThan(0);
    expect(screen.getByText("仍有 1 项暂放待确认。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "去处理待确认项（1）" })).toBeInTheDocument();
    expect(screen.queryByText("同步中")).not.toBeInTheDocument();
  });

  it("allows dismissing review items from the pending queue for later review", () => {
    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          items: [
            {
              item_id: "item-review-1",
              display_name: "important_invoice_301.exe",
              source_relpath: "incoming/important_invoice_301.exe",
              target_slot_id: "Review",
              status: "review",
              mapping_status: "review",
              suggested_purpose: "Review",
              content_summary: "待人工核对",
              reason: "用途不够稳定",
              confidence: 0.62,
            },
          ],
          readiness: {
            can_precheck: false,
          },
        }}
        stage="planning"
        isBusy={false}
        plannerStatus={{
          isRunning: false,
          preservingPreviousPlan: false,
        }}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "全部保留在待确认区" }));

    expect(screen.queryByText("待确认队列")).not.toBeInTheDocument();
    expect(screen.getByText("已保留")).toBeInTheDocument();
    expect(screen.queryAllByText("暂放待确认").length).toBe(0);
  });

  it("keeps the last review-only queue item without starting precheck automatically", () => {
    const onRunPrecheck = vi.fn();

    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          items: [
            {
              item_id: "item-review-1",
              display_name: "important_invoice_301.exe",
              source_relpath: "incoming/important_invoice_301.exe",
              target_slot_id: "Review",
              status: "review",
              mapping_status: "review",
              suggested_purpose: "Review",
              content_summary: "待人工核对",
              reason: "用途不够稳定",
              confidence: 0.62,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 1,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: true,
          },
        }}
        stage="ready_for_precheck"
        isBusy={false}
        plannerStatus={{
          isRunning: false,
          preservingPreviousPlan: false,
        }}
        onRunPrecheck={onRunPrecheck}
        onUpdateItem={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "全部保留在待确认区" }));

    expect(onRunPrecheck).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "检查移动风险" })).toBeEnabled();
  });

  it("allows direct precheck from planning stage once readiness is satisfied", () => {
    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          items: [
            {
              item_id: "item-review-1",
              display_name: "important_invoice_301.exe",
              source_relpath: "incoming/important_invoice_301.exe",
              target_slot_id: "Review",
              status: "review",
              mapping_status: "review",
              suggested_purpose: "Review",
              content_summary: "待人工核对",
              reason: "用途不够稳定",
              confidence: 0.62,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 1,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: true,
          },
        }}
        stage="planning"
        isBusy={false}
        plannerStatus={{
          isRunning: false,
          preservingPreviousPlan: false,
        }}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "全部保留在待确认区" })).toBeInTheDocument();
    // 有待确认项时主按钮不再是死的，而是带用户去处理队列。
    expect(screen.getByRole("button", { name: "去处理待确认项（1）" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "全部保留在待确认区" }));

    expect(screen.getByRole("button", { name: "检查移动风险" })).toBeEnabled();
  });

  it("lets users click the footer notice to jump back to the pending queue", () => {
    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          items: [
            {
              item_id: "item-review-1",
              display_name: "important_invoice_301.exe",
              source_relpath: "incoming/important_invoice_301.exe",
              target_slot_id: "Review",
              status: "review",
              mapping_status: "review",
              suggested_purpose: "Review",
              content_summary: "待人工核对",
              reason: "用途不够稳定",
              confidence: 0.62,
            },
          ],
          readiness: {
            can_precheck: false,
          },
        }}
        stage="planning"
        isBusy={false}
        plannerStatus={{
          isRunning: false,
          preservingPreviousPlan: false,
        }}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.getByRole("button", { name: "展开列表" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "仍有 1 项暂放待确认。 点击查看" }));
    expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument();
  });

  it("shows the before tree by default while planning is running", () => {
    render(
      <PreviewPanel
        plan={createPlan()}
        stage="planning"
        isBusy={false}
        plannerStatus={{
          isRunning: true,
          preservingPreviousPlan: false,
        }}
        plannerRunKey="run-1"
        sourceTreeEntries={[
          { source_relpath: "照片", display_name: "照片", entry_type: "directory" },
          { source_relpath: "照片/cat.png", display_name: "cat.png", entry_type: "file" },
        ]}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    expect(screen.getByText("照片")).toBeInTheDocument();
    expect(screen.getByText("cat.png")).toBeInTheDocument();
    expect(screen.queryByText("整理后结构尚在生成")).not.toBeInTheDocument();
  });

  it("renders atomic folders as single leaf items instead of expandable directories", () => {
    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          items: [
            {
              item_id: "F001",
              display_name: "第四版",
              source_relpath: "第四版",
              target_slot_id: "D001",
              entry_type: "directory",
              status: "planned",
              mapping_status: "assigned",
              suggested_purpose: "项目归档",
              content_summary: "完整项目目录，按整体保留结构",
              reason: "作为单个项目包移动",
              confidence: 0.92,
            },
            {
              item_id: "F002",
              display_name: "client",
              source_relpath: "第四版/client",
              target_slot_id: "D001",
              entry_type: "directory",
              status: "planned",
              mapping_status: "assigned",
              suggested_purpose: "子目录",
              content_summary: "不应单独显示",
              reason: "",
              confidence: 0.5,
            },
          ],
          target_slots: [
            {
              slot_id: "D001",
              display_name: "项目与代码",
              relpath: "项目与代码",
              depth: 0,
              is_new: false,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 1,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: true,
          },
        }}
        stage="ready_for_precheck"
        isBusy={false}
        sourceTreeEntries={[
          { source_relpath: "第四版", display_name: "第四版", entry_type: "directory", source_mode: "atomic" },
          { source_relpath: "第四版/client", display_name: "client", entry_type: "directory" },
        ]}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    expect(screen.getAllByText("第四版").length).toBeGreaterThan(0);
    expect(screen.queryByText("client")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "建议" })[0]);

    expect(screen.getAllByText("第四版").length).toBeGreaterThan(0);
    expect(screen.queryByText("client")).not.toBeInTheDocument();
  });

  it("treats raw directory entries without visible descendants as leaf items", () => {
    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          items: [
            {
              item_id: "F001",
              display_name: "飞机大战源码",
              source_relpath: "飞机大战源码",
              target_slot_id: "D001",
              entry_type: "directory",
              status: "planned",
              mapping_status: "assigned",
              suggested_purpose: "项目资料",
              content_summary: "完整游戏开发项目目录",
              reason: "整体作为项目资料归档",
              confidence: 0.95,
            },
          ],
          target_slots: [
            {
              slot_id: "D001",
              display_name: "项目资料",
              relpath: "项目资料",
              depth: 0,
              is_new: false,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 1,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: true,
          },
        }}
        stage="ready_for_precheck"
        isBusy={false}
        sourceTreeEntries={[
          { source_relpath: "飞机大战源码", display_name: "飞机大战源码", entry_type: "directory" },
        ]}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    expect(screen.getAllByText("飞机大战源码").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows after-tree empty state when the plan is still generating", () => {
    render(
      <PreviewPanel
        plan={createPlan()}
        stage="planning"
        isBusy={false}
        plannerStatus={{
          isRunning: true,
          preservingPreviousPlan: false,
        }}
        plannerRunKey="run-1"
        sourceTreeEntries={[
          { source_relpath: "照片", display_name: "照片", entry_type: "directory" },
          { source_relpath: "照片/cat.png", display_name: "cat.png", entry_type: "file" },
        ]}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "建议" })[0]);

    expect(screen.getByText("整理后结构尚在生成")).toBeInTheDocument();
    expect(screen.getByText("先切回“前”查看原始目录，方案稳定后这里会自动出现整理后结构。")).toBeInTheDocument();
  });

  it("keeps review items under a logical Review branch instead of expanding absolute placement paths", () => {
    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          placement: {
            new_directory_root: "D:/download/incoming-copy",
            review_root: "D:/download/incoming-copy/Review",
          },
          items: [
            {
              item_id: "F011",
              display_name: "important_invoice_301.exe",
              source_relpath: "important_invoice_301.exe",
              target_slot_id: "Review",
              status: "review",
              mapping_status: "review",
              suggested_purpose: "待判断",
              content_summary: "扩展名与用途描述不符",
              reason: "先进入 Review",
              confidence: 0.4,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 1,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: false,
          },
        }}
        stage="planning"
        isBusy={false}
        plannerStatus={{
          isRunning: false,
          preservingPreviousPlan: false,
        }}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "建议" })[0]);

    expect(screen.getAllByText("待确认区").length).toBeGreaterThan(0);
    expect(screen.queryByText("D:")).not.toBeInTheDocument();
    expect(screen.queryByText("download")).not.toBeInTheDocument();
  });

  it("uses explicit review target slot metadata without exposing it as a normal target", async () => {
    const onUpdateItem = vi.fn();

    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          items: [
            {
              item_id: "F011",
              display_name: "important_invoice_301.exe",
              source_relpath: "important_invoice_301.exe",
              target_slot_id: "D999",
              status: "planned",
              mapping_status: "assigned",
              suggested_purpose: "待判断",
              content_summary: "扩展名与用途描述不符",
              reason: "先进入 Review",
              confidence: 0.4,
            },
            {
              item_id: "F012",
              display_name: "suspicious.bin",
              source_relpath: "suspicious.bin",
              target_slot_id: "D999",
              status: "review",
              mapping_status: "review",
              suggested_purpose: "待判断",
              content_summary: "需要人工核对",
              reason: "先进入 Review",
              confidence: 0.4,
            },
          ],
          target_slots: [
            {
              slot_id: "D001",
              display_name: "文档",
              relpath: "Docs",
              depth: 0,
              is_new: false,
            },
            {
              slot_id: "D999",
              display_name: "待确认区",
              relpath: "Inbox/Pending",
              depth: 0,
              is_new: false,
              kind: "review",
              is_review: true,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 2,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: true,
          },
        }}
        stage="ready_for_precheck"
        isBusy={false}
        onRunPrecheck={() => {}}
        onUpdateItem={onUpdateItem}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "建议" })[0]);

    expect(screen.getAllByText("待确认区").length).toBeGreaterThan(0);
    expect(screen.queryByText("Inbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();

    const reviewQueueButton = screen
      .getAllByRole("button", { name: /suspicious\.bin/ })
      .find((button) => (button.textContent || "").includes("待确认"));
    expect(reviewQueueButton).toBeDefined();
    fireEvent.click(reviewQueueButton!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Docs" })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "待确认区" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inbox/Pending" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "待确认区" }));
    expect(onUpdateItem).toHaveBeenCalledWith("F012", { move_to_review: true });
  });

  it("keeps the footer outside the scrollable middle region", () => {
    render(
      <PreviewPanel
        plan={createPlan()}
        stage="planning"
        isBusy={false}
        plannerStatus={{
          isRunning: true,
          preservingPreviousPlan: false,
        }}
        plannerRunKey="run-1"
        sourceTreeEntries={[
          { source_relpath: "照片", display_name: "照片", entry_type: "directory" },
          { source_relpath: "照片/cat.png", display_name: "cat.png", entry_type: "file" },
        ]}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    const scrollRegion = screen.getByTestId("preview-scroll-region");
    const footer = screen.getByTestId("preview-footer");

    expect(scrollRegion.contains(footer)).toBe(false);
    expect(screen.getByRole("button", { name: "等待方案准备好" })).toBeInTheDocument();
  });

  it("shows and applies target conflict suggestions from failed precheck", () => {
    const onApplyTargetConflictSuggestions = vi.fn();

    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          items: [
            {
              item_id: "F001",
              display_name: "report.pdf",
              source_relpath: "alpha/report.pdf",
              target_slot_id: "D001",
              status: "planned",
              mapping_status: "assigned",
              suggested_purpose: "报告",
              content_summary: "alpha report",
            },
            {
              item_id: "F002",
              display_name: "report.pdf",
              source_relpath: "beta/report.pdf",
              target_slot_id: "D001",
              status: "planned",
              mapping_status: "assigned",
              suggested_purpose: "报告",
              content_summary: "beta report",
            },
          ],
          target_slots: [
            {
              slot_id: "D001",
              display_name: "Docs",
              relpath: "Docs",
              depth: 0,
              is_new: false,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 2,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: false,
          },
        }}
        stage="planning"
        isBusy={false}
        onRunPrecheck={() => {}}
        onApplyTargetConflictSuggestions={onApplyTargetConflictSuggestions}
        onUpdateItem={() => {}}
        precheckSummary={{
          mkdir_preview: [],
          target_conflict_suggestions: [
            {
              type: "target_name_conflict",
              target: "Docs/report.pdf",
              items: [
                {
                  item_id: "F001",
                  display_name: "report.pdf",
                  source: "alpha/report.pdf",
                  current_target: "Docs/report.pdf",
                  suggested_target: "Docs/report.pdf",
                },
                {
                  item_id: "F002",
                  display_name: "report.pdf",
                  source: "beta/report.pdf",
                  current_target: "Docs/report.pdf",
                  suggested_target: "Docs/report (2).pdf",
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("检测到 2 个同名目标，可应用建议后重新检查。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用冲突建议" }));

    expect(onApplyTargetConflictSuggestions).toHaveBeenCalledTimes(1);
  });

  it("shows incremental mapping rows before the structure reference", () => {
    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          items: [
            {
              item_id: "F001",
              display_name: "contract.pdf",
              source_relpath: "contract.pdf",
              target_slot_id: "D001",
              status: "planned",
              mapping_status: "assigned",
              suggested_purpose: "财务合同",
              content_summary: "付款协议",
              reason: "归入合同目录",
              confidence: 0.9,
            },
          ],
          target_slots: [
            {
              slot_id: "D001",
              display_name: "合同",
              relpath: "Finance/合同",
              depth: 1,
              is_new: false,
            },
          ],
          mappings: [
            {
              item_id: "F001",
              source_ref_id: "F001",
              target_slot_id: "D001",
              status: "assigned",
              reason: "归入合同目录",
              confidence: 0.9,
              user_overridden: false,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 1,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: true,
          },
        }}
        stage="ready_for_precheck"
        organizeMode="incremental"
        isBusy={false}
        incrementalSelection={{
          required: true,
          status: "ready",
          destination_index_depth: 2,
          root_directory_options: ["Finance", "Inbox"],
          target_directories: ["Finance"],
          target_directory_tree: [],
          pending_items_count: 1,
          source_scan_completed: true,
        }}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    expect(screen.getByText("归属映射清单")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /contract\.pdf.*Finance\/合同/ })).toBeInTheDocument();
    expect(screen.getByText("结构参考")).toBeInTheDocument();
  });

  it("builds the after-tree from target slots without target_relpath", () => {
    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          items: [
            {
              item_id: "F001",
              display_name: "contract.pdf",
              source_relpath: "contract.pdf",
              target_slot_id: "D001",
              status: "planned",
              mapping_status: "assigned",
              suggested_purpose: "财务合同",
              content_summary: "付款协议",
              reason: "归入合同目录",
              confidence: 0.9,
            },
          ],
          target_slots: [
            {
              slot_id: "D001",
              display_name: "合同",
              relpath: "Finance/合同",
              depth: 1,
              is_new: false,
            },
          ],
          mappings: [
            {
              item_id: "F001",
              source_ref_id: "F001",
              target_slot_id: "D001",
              status: "assigned",
              reason: "归入合同目录",
              confidence: 0.9,
              user_overridden: false,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 1,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: true,
          },
        }}
        stage="ready_for_precheck"
        organizeMode="incremental"
        isBusy={false}
        incrementalSelection={{
          required: true,
          status: "ready",
          destination_index_depth: 2,
          root_directory_options: ["Finance", "Inbox"],
          target_directories: ["Finance"],
          target_directory_tree: [],
          pending_items_count: 1,
          source_scan_completed: true,
        }}
        onRunPrecheck={() => {}}
        onUpdateItem={() => {}}
      />,
    );

    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("合同")).toBeInTheDocument();
    expect(screen.getAllByText("contract.pdf").length).toBeGreaterThan(0);
    expect(screen.queryByText("D001")).not.toBeInTheDocument();
    expect(screen.queryByText("F001")).not.toBeInTheDocument();
  });

  it("blocks Windows drive-relative manual target paths", async () => {
    const onUpdateItem = vi.fn();

    render(
      <PreviewPanel
        plan={{
          ...createPlan(),
          items: [
            {
              item_id: "F001",
              display_name: "contract.pdf",
              source_relpath: "contract.pdf",
              target_slot_id: "D001",
              status: "review",
              mapping_status: "review",
              suggested_purpose: "财务合同",
              content_summary: "付款协议",
              reason: "归入合同目录",
              confidence: 0.9,
            },
          ],
          target_slots: [
            {
              slot_id: "D001",
              display_name: "合同",
              relpath: "Finance/合同",
              depth: 1,
              is_new: false,
            },
          ],
          stats: {
            directory_count: 1,
            move_count: 1,
            unresolved_count: 0,
          },
          readiness: {
            can_precheck: true,
          },
        }}
        stage="ready_for_precheck"
        organizeMode="incremental"
        isBusy={false}
        onRunPrecheck={() => {}}
        onUpdateItem={onUpdateItem}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /contract\.pdf.*保留在原地/ })[0]);
    const editButton = screen
      .getAllByRole("button")
      .find((button) => (button.textContent || "").trim() === "");
    expect(editButton).toBeDefined();
    fireEvent.click(editButton!);
    await waitFor(() => {
      expect(screen.getByText("调整文件去向")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/\+ 手动指定其他路径/).closest("button")!);
    fireEvent.change(screen.getByPlaceholderText("如: 新专题/归档"), {
      target: { value: "D:" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用此路径" }));

    expect(onUpdateItem).not.toHaveBeenCalled();
  });

  it("normalizes incremental absolute target paths back to the same display directory", () => {
    const placement = {
      new_directory_root: "D:/download",
      review_root: "D:/download/Review",
    };

    expect(optionDirectoryForTarget("D:/download/Codex-win-x64-26.506.21252", placement)).toBe("Codex-win-x64-26.506.21252");
    expect(optionIdentityForTarget("Codex-win-x64-26.506.21252", placement, "D:/download/Codex-win-x64-26.506.21252")).toBe(
      optionIdentityForTarget("D:/download/Codex-win-x64-26.506.21252", placement),
    );
  });
});
