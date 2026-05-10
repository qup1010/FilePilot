import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invokeTauriCommand, isTauriDesktop } from "@/lib/runtime";
import IconWorkbenchV2 from "./icon-workbench-v2";

const iconApiMock = {
  getConfig: vi.fn(),
  getSession: vi.fn(),
  updateTargets: vi.fn(),
  createSession: vi.fn(),
  analyzeFolders: vi.fn(),
  applyTemplate: vi.fn(),
  generatePreviews: vi.fn(),
  selectVersion: vi.fn(),
  reportClientAction: vi.fn(),
  scanSession: vi.fn(),
  prepareApplyReady: vi.fn(),
  removeTarget: vi.fn(),
  deleteVersion: vi.fn(),
  listSessions: vi.fn(),
  deleteSession: vi.fn(),
};

const templateHookState = {
  templates: [],
  templatesLoading: false,
  templatesInitialized: true,
  selectedTemplateId: "",
  setSelectedTemplateId: vi.fn(),
  selectedTemplate: null as null | { name: string },
  templateActionLoading: false,
  templateNameDraft: "",
  setTemplateNameDraft: vi.fn(),
  templateDescriptionDraft: "",
  setTemplateDescriptionDraft: vi.fn(),
  templatePromptDraft: "",
  setTemplatePromptDraft: vi.fn(),
  reloadTemplates: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
};

const backgroundHookState = {
  processingBgVersionIds: new Set<string>(),
  isRemovingBgBatch: false,
  batchProgress: null as null | {
    total: number;
    completed: number;
    success: number;
    failed: number;
    activeFolderNames: string[];
  },
  handleRemoveBg: vi.fn(),
  handleRemoveBgBatch: vi.fn(),
};

let latestStreamOptions: null | {
  onEvent: (event: any) => void;
  onError?: (error: Event) => void;
} = null;

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
    button: ({ children, whileTap: _whileTap, ...props }: React.ComponentProps<"button"> & { whileTap?: unknown }) => (
      <button {...props}>{children}</button>
    ),
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/runtime", () => ({
  getApiBaseUrl: () => "http://127.0.0.1:8765",
  getApiToken: () => "",
  isTauriDesktop: vi.fn(() => false),
  inspectPathsWithTauri: vi.fn(),
  invokeTauriCommand: vi.fn(),
  openDirectoryWithTauri: vi.fn(),
  pickDirectoriesWithTauri: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({
    selectDir: vi.fn(),
  }),
}));

vi.mock("@/lib/icon-workbench-api", () => ({
  createIconWorkbenchApiClient: () => iconApiMock,
}));

vi.mock("@/lib/icon-workbench-sse", () => ({
  createIconWorkbenchEventStream: (options: any) => {
    latestStreamOptions = options;
    return { close: vi.fn() };
  },
}));

vi.mock("./use-icon-templates", () => ({
  useIconTemplates: () => templateHookState,
}));

vi.mock("./use-background-removal", () => ({
  useBackgroundRemoval: () => backgroundHookState,
}));

vi.mock("./icon-workbench-toolbar", () => ({
  IconWorkbenchToolbar: ({ onOpenHistory }: any) => (
    <div data-testid="toolbar">
      toolbar
      <button onClick={onOpenHistory}>历史工作区</button>
    </div>
  ),
}));

vi.mock("./icon-workbench-style-panel", () => ({
  IconWorkbenchStylePanel: () => null,
}));

vi.mock("./icon-workbench-template-drawer", () => ({
  IconWorkbenchTemplateDrawer: () => null,
}));

vi.mock("./icon-workbench-history-drawer", () => ({
  IconWorkbenchHistoryDrawer: ({
    open,
    items,
    activeSessionId,
    onOpenSession,
    onDeleteSession,
  }: any) => open ? (
    <div data-testid="history-drawer">
      <div>active:{activeSessionId || "none"}</div>
      {items.map((item: any) => (
        <div key={item.session_id}>
          <span>{item.updated_at}</span>
          <button onClick={() => onOpenSession(item.session_id)}>打开 {item.session_id}</button>
          <button onClick={() => onDeleteSession(item.session_id)}>删除 {item.session_id}</button>
        </div>
      ))}
    </div>
  ) : null,
}));

vi.mock("./icon-workbench-folder-list", () => ({
  IconWorkbenchFolderList: ({
    folders,
    onZoom,
    onApplyVersion,
    onRestore,
    onTargetDrop,
    onTargetDragOver,
    onTargetDragLeave,
    isTargetDropActive,
  }: {
    folders: any[];
    onZoom: (version: any) => void;
    onApplyVersion: (folderId: string, version: any) => void;
    onRestore: (folderId: string) => void;
    onTargetDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    onTargetDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
    onTargetDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void;
    isTargetDropActive?: boolean;
  }) => {
    const folder = folders[0];
    const applied = folder?.versions.find((version: any) => version.version_id === folder.applied_version_id);
    const current = folder?.versions.find((version: any) => version.version_id === folder.current_version_id);
    return (
      <div>
        <div data-testid="folder-count">{folders.length}</div>
        <div
          data-testid="icon-target-dropzone"
          onDrop={onTargetDrop}
          onDragOver={onTargetDragOver}
          onDragLeave={onTargetDragLeave}
        >
          dropzone:{String(isTargetDropActive)}
        </div>
        {applied ? <button onClick={() => onZoom(applied)}>预览已应用版本</button> : null}
        {current ? <button onClick={() => onZoom(current)}>预览当前版本</button> : null}
        {current ? <button onClick={() => onApplyVersion(folder.folder_id, current)}>应用当前版本</button> : null}
        {folder ? <button onClick={() => onRestore(folder.folder_id)}>恢复当前文件夹</button> : null}
      </div>
    );
  },
}));

vi.mock("./icon-workbench-footer-bar", () => ({
  IconWorkbenchFooterBar: ({ canApplyBatch, canRemoveBgBatch, removeBgBatchProgress, onApplyBatch, onGenerate, targetCount }: any) => (
    <div data-testid="footer-bar">
      footer|apply:{String(canApplyBatch)}|remove:{String(canRemoveBgBatch)}|progress:
      {removeBgBatchProgress ? `${removeBgBatchProgress.completed}/${removeBgBatchProgress.total}` : "none"}
      <button onClick={onGenerate}>生成 {targetCount} 个预览</button>
      <button onClick={onApplyBatch}>执行批量应用</button>
    </div>
  ),
}));

vi.mock("./icon-workbench-preview-modal", () => ({
  IconWorkbenchPreviewModal: ({ isApplied, isCurrentVersion }: any) => (
    <div data-testid="preview-modal">
      applied:{String(isApplied)}|current:{String(isCurrentVersion)}
    </div>
  ),
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({ open, title, onConfirm, onClose }: any) => open ? (
    <div data-testid="confirm-dialog">
      <div>{title}</div>
      <button onClick={onConfirm}>确认</button>
      <button onClick={onClose}>取消</button>
    </div>
  ) : null,
}));

vi.mock("@/components/ui/error-alert", () => ({
  ErrorAlert: ({ message }: { message: string }) => <div>{message}</div>,
}));

function createSession() {
  return {
    session_id: "icon-session-1",
    target_paths: ["D:/Icons"],
    folders: [
      {
        folder_id: "folder-1",
        folder_path: "D:/Icons/Alpha",
        folder_name: "Alpha",
        analysis_status: "ready",
        analysis: null,
        current_prompt: "prompt",
        prompt_customized: true,
        versions: [
          {
            version_id: "version-applied",
            version_number: 1,
            prompt: "prompt-a",
            image_path: "D:/preview-a.png",
            image_url: "/api/icon-a",
            status: "ready",
            created_at: "2026-01-01T00:00:00+00:00",
          },
          {
            version_id: "version-current",
            version_number: 2,
            prompt: "prompt-b",
            image_path: "D:/preview-b.png",
            image_url: "/api/icon-b",
            status: "ready",
            created_at: "2026-01-01T00:01:00+00:00",
          },
        ],
        current_version_id: "version-current",
        applied_version_id: "version-applied",
        applied_at: "2026-01-01T00:02:00+00:00",
        last_error: null,
        updated_at: "2026-01-01T00:02:00+00:00",
      },
    ],
    last_client_action: null,
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:02:00+00:00",
    folder_count: 1,
    ready_count: 1,
  };
}

function createEmptySession() {
  return {
    session_id: "icon-session-empty",
    target_paths: [],
    folders: [],
    last_client_action: null,
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
    folder_count: 0,
    ready_count: 0,
  };
}

function createDirectoryDropData(path: string) {
  return {
    dataTransfer: {
      items: [
        {
          kind: "file",
          getAsFile: () => ({ path }),
          webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }),
        },
      ],
      files: [{ path }],
    },
  };
}

describe("IconWorkbenchV2", () => {
  beforeEach(() => {
    latestStreamOptions = null;
    localStorage.clear();
    Object.values(iconApiMock).forEach((mockFn) => mockFn.mockReset());
    vi.mocked(isTauriDesktop).mockReturnValue(false);
    vi.mocked(invokeTauriCommand).mockReset();
    iconApiMock.getConfig.mockResolvedValue({
      config: {
        text_model: { base_url: "https://text.example/v1", model: "gpt-text", configured: true },
        image_model: { base_url: "https://image.example/v1", model: "gpt-image", configured: true },
        image_size: "1024x1024",
        analysis_concurrency_limit: 1,
        image_concurrency_limit: 1,
        save_mode: "centralized",
      },
    });
    iconApiMock.getSession.mockResolvedValue(createSession());
    iconApiMock.createSession.mockResolvedValue(createSession());
    iconApiMock.updateTargets.mockResolvedValue(createSession());
    iconApiMock.selectVersion.mockResolvedValue(createSession());
    iconApiMock.reportClientAction.mockResolvedValue(createSession());
    iconApiMock.scanSession.mockResolvedValue(createSession());
    iconApiMock.prepareApplyReady.mockResolvedValue({
      session_id: "icon-session-1",
      total: 1,
      ready_count: 1,
      skipped_count: 0,
      tasks: [],
      skipped_items: [],
    });
    iconApiMock.listSessions.mockResolvedValue([
      {
        session_id: "history-session-1",
        created_at: "2026-01-01T00:00:00+00:00",
        updated_at: "2026-01-02T08:30:00+00:00",
        target_count: 1,
        folder_count: 1,
        ready_count: 1,
        applied_count: 0,
        error_count: 0,
        target_paths: ["D:/Icons/Alpha"],
        last_action_type: null,
        last_action_message: null,
        last_action_at: null,
      },
    ]);
    iconApiMock.deleteSession.mockResolvedValue({ status: "deleted", session_id: "history-session-1" });
    templateHookState.selectedTemplateId = "";
    templateHookState.selectedTemplate = null;
    backgroundHookState.isRemovingBgBatch = false;
    backgroundHookState.batchProgress = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("keeps batch footer visible for restored ready sessions even without a selected template", async () => {
    vi.mocked(isTauriDesktop).mockReturnValue(true);
    localStorage.setItem("icons_workspace_state", JSON.stringify({
      sessionId: "icon-session-1",
      selectedTemplateId: "",
      expandedFolderId: null,
    }));

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByTestId("footer-bar")).toBeInTheDocument();
    });

    expect(screen.getByTestId("footer-bar")).toHaveTextContent("apply:true");
    expect(screen.getByTestId("footer-bar")).toHaveTextContent("remove:true");
    expect(screen.getByText("已恢复上次图标工作区，目标列表和展开状态已还原。")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("已恢复上次图标工作区，目标列表和展开状态已还原。")).not.toBeInTheDocument();
    }, { timeout: 4500 });
  });

  it("does not show the restored-workspace notice when the restored session has no folders", async () => {
    iconApiMock.getSession.mockResolvedValueOnce(createEmptySession());
    localStorage.setItem("icons_workspace_state", JSON.stringify({
      sessionId: "icon-session-empty",
      selectedTemplateId: "",
      expandedFolderId: null,
    }));

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByTestId("folder-count")).toHaveTextContent("0");
    });

    expect(screen.queryByText("已恢复上次图标工作区，目标列表和展开状态已还原。")).not.toBeInTheDocument();
  });

  it("opens a historical workspace from the history drawer", async () => {
    const user = userEvent.setup();
    const historySession = {
      ...createSession(),
      session_id: "history-session-1",
      target_paths: ["D:/Icons/History"],
    };
    iconApiMock.getSession.mockResolvedValueOnce(historySession);

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "历史工作区" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "历史工作区" }));

    await waitFor(() => {
      expect(iconApiMock.listSessions).toHaveBeenCalled();
    });
    expect(screen.getByTestId("history-drawer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开 history-session-1" }));

    await waitFor(() => {
      expect(iconApiMock.getSession).toHaveBeenCalledWith("history-session-1");
    });
    expect(screen.queryByTestId("history-drawer")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("icons_workspace_state") || "{}").sessionId).toBe("history-session-1");
    });
  });

  it("deleting the current historical workspace clears the workbench state", async () => {
    const user = userEvent.setup();
    localStorage.setItem("icons_workspace_state", JSON.stringify({
      sessionId: "icon-session-1",
      selectedTemplateId: "",
      expandedFolderId: null,
    }));
    iconApiMock.listSessions.mockResolvedValueOnce([
      {
        session_id: "icon-session-1",
        created_at: "2026-01-01T00:00:00+00:00",
        updated_at: "2026-01-02T08:30:00+00:00",
        target_count: 1,
        folder_count: 1,
        ready_count: 1,
        applied_count: 0,
        error_count: 0,
        target_paths: ["D:/Icons/Alpha"],
        last_action_type: null,
        last_action_message: null,
        last_action_at: null,
      },
    ]);
    iconApiMock.deleteSession.mockResolvedValueOnce({ status: "deleted", session_id: "icon-session-1" });

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByTestId("folder-count")).toHaveTextContent("1");
    });

    await user.click(screen.getByRole("button", { name: "历史工作区" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "删除 icon-session-1" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "删除 icon-session-1" }));
    expect(screen.getByTestId("confirm-dialog")).toHaveTextContent("删除历史工作区？");
    expect(iconApiMock.deleteSession).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(iconApiMock.deleteSession).toHaveBeenCalledWith("icon-session-1");
    });
    expect(screen.getByTestId("folder-count")).toHaveTextContent("0");
    expect(localStorage.getItem("icons_workspace_state")).toBeNull();
  });

  it("creates a new session when folders are dropped into an empty workspace", async () => {
    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByTestId("folder-count")).toHaveTextContent("0");
    });

    fireEvent.drop(screen.getByTestId("icon-target-dropzone"), createDirectoryDropData("D:/Icons/Beta"));

    await waitFor(() => {
      expect(iconApiMock.createSession).toHaveBeenCalledWith(["D:/Icons/Beta"]);
    });
    expect(screen.getByTestId("folder-count")).toHaveTextContent("1");
    expect(screen.getByTestId("footer-bar")).toBeInTheDocument();
  });

  it("appends dropped folders to the current session", async () => {
    localStorage.setItem("icons_workspace_state", JSON.stringify({
      sessionId: "icon-session-1",
      selectedTemplateId: "",
      expandedFolderId: null,
    }));

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByTestId("folder-count")).toHaveTextContent("1");
    });

    fireEvent.drop(screen.getByTestId("icon-target-dropzone"), createDirectoryDropData("D:/Icons/Beta"));

    await waitFor(() => {
      expect(iconApiMock.updateTargets).toHaveBeenCalledWith("icon-session-1", {
        target_paths: ["D:/Icons/Beta"],
        mode: "append",
      });
    });
    expect(screen.getByTestId("folder-count")).toHaveTextContent("1");
  });

  it("derives preview applied state from applied_version_id instead of current_version_id", async () => {
    const user = userEvent.setup();
    localStorage.setItem("icons_workspace_state", JSON.stringify({
      sessionId: "icon-session-1",
      selectedTemplateId: "",
      expandedFolderId: null,
    }));

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "预览已应用版本" })).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: "预览已应用版本" })[0]);
    expect(screen.getByTestId("preview-modal")).toHaveTextContent("applied:true|current:false");

    await user.click(screen.getAllByRole("button", { name: "预览当前版本" })[0]);
    expect(screen.getByTestId("preview-modal")).toHaveTextContent("applied:false|current:true");
  });

  it("shows an offline warning when the event stream disconnects", async () => {
    localStorage.setItem("icons_workspace_state", JSON.stringify({
      sessionId: "icon-session-1",
      selectedTemplateId: "",
      expandedFolderId: null,
    }));

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(latestStreamOptions).not.toBeNull();
    }, { timeout: 2000 });

    vi.useFakeTimers();
    act(() => {
      latestStreamOptions?.onEvent({
        event_type: "icon.session.snapshot",
        session_id: "icon-session-1",
        session_snapshot: createSession(),
      });
      latestStreamOptions?.onError?.(new Event("error"));
      vi.advanceTimersByTime(5001);
    });

    expect(screen.getByText("图标工坊实时连接已断开，当前进度可能不是最新状态。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重新连接/i })).toBeInTheDocument();
  });

  it("shows the image-model banner when only the image model is missing", async () => {
    iconApiMock.getConfig.mockResolvedValueOnce({
      config: {
        text_model: { base_url: "https://text.example/v1", model: "gpt-text", configured: true },
        image_model: { base_url: "", model: "", configured: false },
        image_size: "1024x1024",
        analysis_concurrency_limit: 1,
        image_concurrency_limit: 1,
        save_mode: "centralized",
      },
    });

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByText("AI 生图模型尚未配置")).toBeInTheDocument();
    });

    expect(screen.getByText("去配置图标生图")).toBeInTheDocument();
    expect(screen.queryByText("AI 文本模型尚未配置")).not.toBeInTheDocument();
  });

  it("rescans the session after a successful desktop apply if report sync fails", async () => {
    const user = userEvent.setup();
    vi.mocked(isTauriDesktop).mockReturnValue(true);
    vi.mocked(invokeTauriCommand).mockResolvedValue("已将图标应用到文件夹");
    iconApiMock.selectVersion.mockRejectedValueOnce(new Error("select failed"));
    iconApiMock.reportClientAction.mockRejectedValueOnce(new Error("report failed"));
    iconApiMock.scanSession.mockResolvedValue(createSession());
    localStorage.setItem("icons_workspace_state", JSON.stringify({
      sessionId: "icon-session-1",
      selectedTemplateId: "",
      expandedFolderId: null,
    }));

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "应用当前版本" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "应用当前版本" }));

    await waitFor(() => {
      expect(iconApiMock.scanSession).toHaveBeenCalledWith("icon-session-1");
    });
    expect(vi.mocked(invokeTauriCommand)).toHaveBeenCalledWith("apply_folder_icon", {
      folderPath: "D:/Icons/Alpha",
      imagePath: "D:/preview-b.png",
    });
    expect(screen.getByText("「Alpha」图标已应用，工作区状态已重新同步。")).toBeInTheDocument();
  });

  it("reports skipped batch items and surfaces the merged summary", async () => {
    const user = userEvent.setup();
    vi.mocked(isTauriDesktop).mockReturnValue(true);
    vi.mocked(invokeTauriCommand).mockResolvedValue([
      {
        folder_id: "folder-1",
        folder_name: "Alpha",
        folder_path: "D:/Icons/Alpha",
        status: "applied",
        message: "已应用图标: D:/Icons/Alpha",
      },
    ]);
    iconApiMock.prepareApplyReady.mockResolvedValue({
      session_id: "icon-session-1",
      total: 2,
      ready_count: 1,
      skipped_count: 1,
      tasks: [
        {
          folder_id: "folder-1",
          folder_name: "Alpha",
          folder_path: "D:/Icons/Alpha",
          version_id: "version-current",
          image_path: "D:/preview-b.png",
          save_mode: "centralized",
        },
      ],
      skipped_items: [
        {
          folder_id: "folder-2",
          folder_name: "Beta",
          status: "skipped",
          message: "当前版本未就绪",
        },
      ],
    });
    iconApiMock.reportClientAction.mockResolvedValue({
      ...createSession(),
      last_client_action: {
        action_type: "apply_icons",
        summary: {
          success_count: 1,
          failed_count: 0,
          skipped_count: 1,
          message: "应用图标已完成：成功 1，失败 0，跳过 1。",
        },
        results: [],
        updated_at: "2026-01-01T00:03:00+00:00",
      },
    });
    localStorage.setItem("icons_workspace_state", JSON.stringify({
      sessionId: "icon-session-1",
      selectedTemplateId: "",
      expandedFolderId: null,
    }));

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "执行批量应用" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "执行批量应用" }));

    await waitFor(() => {
      expect(iconApiMock.reportClientAction).toHaveBeenCalled();
    });
    expect(iconApiMock.reportClientAction).toHaveBeenCalledWith("icon-session-1", {
      action_type: "apply_icons",
      results: [
        {
          folder_id: "folder-1",
          folder_name: "Alpha",
          folder_path: "D:/Icons/Alpha",
          status: "applied",
          message: "已应用图标: D:/Icons/Alpha",
          version_id: "version-current",
        },
      ],
      skipped_items: [
        {
          folder_id: "folder-2",
          folder_name: "Beta",
          status: "skipped",
          message: "当前版本未就绪",
        },
      ],
    });
    await waitFor(() => {
      expect(screen.getByText("应用图标已完成：成功 1，失败 0，跳过 1。")).toBeInTheDocument();
    });
  });

  it("restores the previous icon state instead of clearing to default", async () => {
    const user = userEvent.setup();
    vi.mocked(isTauriDesktop).mockReturnValue(true);
    vi.mocked(invokeTauriCommand).mockResolvedValue("已恢复最近一次图标状态");
    iconApiMock.reportClientAction.mockRejectedValueOnce(new Error("report failed"));
    iconApiMock.scanSession.mockResolvedValue(createSession());
    localStorage.setItem("icons_workspace_state", JSON.stringify({
      sessionId: "icon-session-1",
      selectedTemplateId: "",
      expandedFolderId: null,
    }));

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "恢复当前文件夹" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "恢复当前文件夹" }));
    expect(screen.getByText("恢复上一次图标状态？")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(vi.mocked(invokeTauriCommand)).toHaveBeenCalledWith("restore_last_folder_icon", {
        folderPath: "D:/Icons/Alpha",
      });
    });
    expect(screen.getByText("「Alpha」已恢复上一次图标状态，工作区状态已重新同步。")).toBeInTheDocument();
  });

  it("shows accurate generation summary counts after the flow completes", async () => {
    const user = userEvent.setup();
    const generatedSession = {
      ...createSession(),
      folders: [
        {
          ...createSession().folders[0],
          versions: [
            ...createSession().folders[0].versions,
            {
              version_id: "version-generated",
              version_number: 3,
              prompt: "prompt-c",
              image_path: "D:/preview-c.png",
              image_url: "/api/icon-c",
              status: "error",
              error_message: "mock failed",
              created_at: "2026-01-01T00:03:00+00:00",
            },
          ],
          current_version_id: "version-generated",
        },
      ],
    };
    templateHookState.selectedTemplateId = "template-1";
    templateHookState.selectedTemplate = { name: "极简线稿" };
    iconApiMock.applyTemplate.mockResolvedValue(createSession());
    iconApiMock.generatePreviews.mockResolvedValue(generatedSession);
    localStorage.setItem("icons_workspace_state", JSON.stringify({
      sessionId: "icon-session-1",
      selectedTemplateId: "template-1",
      expandedFolderId: null,
    }));

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成 1 个预览" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "生成 1 个预览" }));

    await waitFor(() => {
      expect(iconApiMock.generatePreviews).toHaveBeenCalledWith("icon-session-1", ["folder-1"]);
    });
    expect(screen.getByText("图标生成已完成：成功 0，失败 1，跳过 0。")).toBeInTheDocument();
    expect(screen.getByText("生成失败：「Alpha」。")).toBeInTheDocument();
  });

  it("skips the analyzing step in the progress rail when the folder is already analyzed", async () => {
    const user = userEvent.setup();
    let resolveApplyTemplate: ((value: ReturnType<typeof createSession>) => void) | undefined;
    templateHookState.selectedTemplateId = "template-1";
    templateHookState.selectedTemplate = { name: "极简线稿" };
    iconApiMock.applyTemplate.mockImplementationOnce(() => new Promise((resolve) => {
      resolveApplyTemplate = resolve;
    }));
    localStorage.setItem("icons_workspace_state", JSON.stringify({
      sessionId: "icon-session-1",
      selectedTemplateId: "template-1",
      expandedFolderId: null,
    }));

    render(<IconWorkbenchV2 />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成 1 个预览" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "生成 1 个预览" }));

    await waitFor(() => {
      expect(iconApiMock.applyTemplate).toHaveBeenCalledWith("icon-session-1", "template-1", ["folder-1"]);
    });

    expect(iconApiMock.analyzeFolders).not.toHaveBeenCalled();
    expect(screen.getByText("正在更新当前风格并准备生成")).toBeInTheDocument();
    expect(screen.getByText("套用风格")).toBeInTheDocument();
    expect(screen.getByText("生成预览")).toBeInTheDocument();
    expect(screen.queryByText("分析目录")).not.toBeInTheDocument();

    resolveApplyTemplate?.(createSession());
  });
});
