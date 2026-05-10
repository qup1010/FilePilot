import React, { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IconWorkbenchFooterBar } from "./icon-workbench-footer-bar";
import { IconWorkbenchFolderCard } from "./icon-workbench-folder-card";
import { IconWorkbenchPreviewModal } from "./icon-workbench-preview-modal";
import { IconWorkbenchTemplateDrawer } from "./icon-workbench-template-drawer";
import { IconWorkbenchVersionThumb } from "./icon-workbench-version-thumb";

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
  },
}));

vi.mock("@/lib/runtime", () => ({
  isTauriDesktop: () => false,
  saveFileAsTauri: vi.fn(),
}));

describe("Icon workbench primitives", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows accurate applied wording in preview modal", () => {
    const { rerender } = render(
      <IconWorkbenchPreviewModal
        src="http://example.com/icon.png"
        folderName="Alpha"
        folderPath="D:/Alpha"
        onClose={() => {}}
        onApply={() => {}}
        isApplied={false}
        isCurrentVersion={true}
      />,
    );

    expect(screen.getByText("未应用")).toBeInTheDocument();
    expect(screen.getByText("这是当前版本，但当前版本不等于已应用。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /应用到文件夹/i })).toBeInTheDocument();

    rerender(
      <IconWorkbenchPreviewModal
        src="http://example.com/icon.png"
        folderName="Alpha"
        folderPath="D:/Alpha"
        onClose={() => {}}
        onApply={() => {}}
        isApplied={true}
        isCurrentVersion={false}
        onOpenFolder={() => {}}
      />,
    );

    expect(screen.getByText("已应用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开文件夹查看/i })).toBeInTheDocument();
  });

  it("shows real placeholder variables and allows inserting them in template drawer", async () => {
    const user = userEvent.setup();

    function Wrapper() {
      const [prompt, setPrompt] = useState("");
      return (
        <IconWorkbenchTemplateDrawer
          open
          onClose={() => {}}
          templates={[]}
          templatesLoading={false}
          selectedTemplate={{
            template_id: "builtin-1",
            name: "内置模板",
            description: "",
            prompt_template: "",
            is_builtin: true,
            created_at: "2026-01-01T00:00:00+00:00",
            updated_at: "2026-01-01T00:00:00+00:00",
          }}
          templateNameDraft="内置模板"
          templateDescriptionDraft=""
          templatePromptDraft={prompt}
          templateActionLoading={false}
          onSelectTemplate={() => {}}
          onTemplateNameChange={() => {}}
          onTemplateDescriptionChange={() => {}}
          onTemplatePromptChange={setPrompt}
          onReloadTemplates={() => {}}
          onCreateTemplate={() => {}}
          onUpdateTemplate={() => {}}
          onDeleteTemplate={() => {}}
        />
      );
    }

    render(<Wrapper />);

    expect(screen.getByText(/{{subject}}/i)).toBeInTheDocument();
    expect(screen.getByText(/{{folder_name}}/i)).toBeInTheDocument();
    expect(screen.getByText(/{{category}}/i)).toBeInTheDocument();
    expect(screen.getByText("系统模板可选用，但不能直接覆盖保存。请先复制为自定义模板后再修改。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /插入 主题/i }));

    const textboxes = screen.getAllByRole("textbox");
    expect(textboxes.at(-1)).toHaveValue("{{subject}}");
  });

  it("shows batch background removal progress in footer", () => {
    render(
      <IconWorkbenchFooterBar
        targetCount={6}
        isGenerating={false}
        isApplying={false}
        onGenerate={() => {}}
        onApplyBatch={() => {}}
        canApplyBatch={true}
        onRemoveBgBatch={() => {}}
        canRemoveBgBatch={true}
        isRemovingBgBatch={true}
        removeBgBatchProgress={{
          total: 6,
          completed: 3,
          success: 3,
          failed: 0,
          activeFolderNames: ["网页存档", "灵感板"],
        }}
        selectedTemplateName={null}
        generateBlockedReason="先选择一个风格模板"
      />,
    );

    expect(screen.getByText("正在同时为 「网页存档」、「灵感板」 去除背景，已完成 3/6。")).toBeInTheDocument();
  });

  it("distinguishes current version from applied version in the version card", () => {
    const version = {
      version_id: "version-1",
      version_number: 2,
      prompt: "prompt",
      image_path: "D:/preview.png",
      image_url: "/api/icon.png",
      status: "ready" as const,
      created_at: "2026-01-01T00:00:00+00:00",
    };

    const { rerender } = render(
      <IconWorkbenchVersionThumb
        version={version}
        isSelected={true}
        isApplied={false}
        onSelect={() => {}}
        onZoom={() => {}}
        onApply={() => {}}
        onRemoveBg={() => {}}
        onDelete={() => {}}
        baseUrl="http://127.0.0.1:8765"
        apiToken=""
      />,
    );

    expect(screen.getByText("当前版本")).toBeInTheDocument();
    expect(screen.queryByText("当前有效")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新应用" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用到系统" })).toBeInTheDocument();

    rerender(
      <IconWorkbenchVersionThumb
        version={version}
        isSelected={true}
        isApplied={true}
        onSelect={() => {}}
        onZoom={() => {}}
        onApply={() => {}}
        onRemoveBg={() => {}}
        onDelete={() => {}}
        baseUrl="http://127.0.0.1:8765"
        apiToken=""
      />,
    );

    expect(screen.getByText("已应用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新应用" })).toBeInTheDocument();
  });

  it("uses per-thumb hover scope and compact wrapping for version history", () => {
    render(
      <IconWorkbenchFolderCard
        folder={{
          folder_id: "folder-1",
          folder_name: "媒体素材",
          folder_path: "D:/DOWNLOAD/媒体素材",
          analysis_status: "ready",
          versions: [
            {
              version_id: "version-1",
              version_number: 1,
              prompt: "prompt-1",
              image_path: "D:/preview-1.png",
              image_url: "/api/icon-1.png",
              status: "ready",
              created_at: "2026-01-01T00:00:00+00:00",
            },
            {
              version_id: "version-2",
              version_number: 2,
              prompt: "prompt-2",
              image_path: "D:/preview-2.png",
              image_url: "/api/icon-2.png",
              status: "ready",
              created_at: "2026-01-02T00:00:00+00:00",
            },
          ],
          current_prompt: "prompt-2",
          prompt_customized: false,
          current_version_id: "version-2",
          applied_version_id: "version-2",
          applied_at: "2026-01-02T00:00:00+00:00",
          last_error: null,
          updated_at: "2026-01-02T00:00:00+00:00",
          analysis: {
            visual_subject: "image file with a colorful thumbnail",
            category: "AI生成的图片素材",
            summary: "folder summary",
            suggested_prompt: "prompt summary",
            analyzed_at: "2026-01-01T00:00:00+00:00",
          },
        }}
        isExpanded={true}
        onToggleExpand={() => {}}
        onSelectVersion={() => {}}
        onZoom={() => {}}
        onApplyVersion={() => {}}
        onRegenerate={() => {}}
        onRestore={() => {}}
        onRemoveTarget={() => {}}
        onRemoveBg={() => {}}
        onDeleteVersion={() => {}}
        processingBgVersionIds={new Set()}
        baseUrl="http://127.0.0.1:8765"
        apiToken=""
        desktopReady={true}
        hasSelectedStyle={true}
      />,
    );

    const versionList = screen.getByTestId("version-list-folder-1");
    expect(versionList.className).toContain("flex");
    expect(versionList.className).toContain("flex-wrap");
    expect(versionList.className).not.toContain("grid-cols");

    const versionCards = versionList.querySelectorAll("div.group\\/version");
    expect(versionCards).toHaveLength(2);
    expect(versionCards[0]?.className).toContain("group/version");

    const toolbars = Array.from(versionList.querySelectorAll("div")).filter((node) =>
      node.className.includes("group-hover/version:translate-y-0"),
    );
    expect(toolbars).toHaveLength(2);
  });
});
