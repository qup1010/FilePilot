import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionLauncher } from "./session-launcher";

const pushMock = vi.fn();
let pathnameMock = "/";
const createLaunchSessionMock = vi.fn();
const startFreshSessionMock = vi.fn();
const getSettingsMock = vi.fn();
const getHistoryMock = vi.fn();
const getCommonDirsMock = vi.fn();
const getTargetProfilesMock = vi.fn();
const createTargetProfileMock = vi.fn();
const selectDirMock = vi.fn();
const isTauriDesktopMock = vi.fn();
const inspectPathsWithTauriMock = vi.fn();
const pickDirectoryWithTauriMock = vi.fn();
const pickDirectoriesWithTauriMock = vi.fn();
const pickFilesWithTauriMock = vi.fn();
const listDirectoryEntriesResultWithTauriMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock,
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
    button: ({
      children,
      whileTap: _whileTap,
      ...props
    }: React.ComponentProps<"button"> & { whileTap?: unknown }) => <button {...props}>{children}</button>,
  },
}));

vi.mock("./launcher/launch-transition-overlay", () => ({
  LaunchTransitionOverlay: () => null,
}));

// jsdom 中滚动容器没有真实高度，虚拟滚动测得可视区为 0 而不渲染任何行；
// 测试里直接让 useVirtualizer 渲染全部行，保持原有 DOM 断言不变。
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    estimateSize,
  }: {
    count: number;
    estimateSize: (index: number) => number;
  }) => {
    let offset = 0;
    const items = Array.from({ length: count }, (_, index) => {
      const size = estimateSize?.(index) ?? 60;
      const item = { index, key: index, start: offset, end: offset + size, size, lane: 0 };
      offset += size;
      return item;
    });
    return {
      getTotalSize: () => offset,
      getVirtualItems: () => items,
      measureElement: () => {},
    };
  },
}));

vi.mock("@/lib/runtime", () => ({
  getApiBaseUrl: () => "http://127.0.0.1:8765",
  getApiToken: () => "",
  isTauriDesktop: () => isTauriDesktopMock(),
  inspectPathsWithTauri: (...args: unknown[]) => inspectPathsWithTauriMock(...args),
  pickDirectoryWithTauri: (...args: unknown[]) => pickDirectoryWithTauriMock(...args),
  pickDirectoriesWithTauri: (...args: unknown[]) => pickDirectoriesWithTauriMock(...args),
  pickFilesWithTauri: (...args: unknown[]) => pickFilesWithTauriMock(...args),
  listDirectoryEntriesWithTauri: async (...args: unknown[]) => (await listDirectoryEntriesResultWithTauriMock(...args)).items,
  listDirectoryEntriesResultWithTauri: (...args: unknown[]) => listDirectoryEntriesResultWithTauriMock(...args),
}));

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({
    getSettings: getSettingsMock,
    getHistory: getHistoryMock,
    getCommonDirs: getCommonDirsMock,
    getTargetProfiles: getTargetProfilesMock,
    createTargetProfile: createTargetProfileMock,
    selectDir: selectDirMock,
  }),
}));

vi.mock("@/lib/session-launcher-actions", () => ({
  createLaunchSession: (...args: unknown[]) => createLaunchSessionMock(...args),
  startFreshSession: (...args: unknown[]) => startFreshSessionMock(...args),
  firstSourcePath: (sources: Array<{ path: string }>) => sources[0]?.path || "",
}));

function openManualSourceInput() {
  if (screen.queryByPlaceholderText("输入完整绝对路径...")) {
    return;
  }
  const manualToggle = screen.queryByRole("button", { name: /手动输入路径|手填路径|收起手动输入/ });
  if (manualToggle) {
    fireEvent.click(manualToggle);
    return;
  }
  fireEvent.click(screen.getByRole("button", { name: /新建整理/ }));
  fireEvent.click(screen.getByRole("button", { name: /手动输入路径|手填路径|收起手动输入/ }));
}

function openLaunchFlow() {
  if (screen.queryByRole("button", { name: "下一步：选择整理方式" })) {
    return;
  }
  fireEvent.click(screen.getByRole("button", { name: /新建整理/ }));
}

function openManualTargetInput() {
  if (!screen.queryByRole("button", { name: /手填路径/ })) {
    fireEvent.click(screen.getByRole("button", { name: /新建整理/ }));
  }
  fireEvent.click(screen.getByRole("button", { name: /手填路径/ }));
}

function addSource(path: string, sourceType: "directory" | "file" = "directory") {
  openManualSourceInput();
  const selectorButtons = screen.getAllByRole("button", {
    name: sourceType === "file" ? "文件" : "文件夹",
  });
  fireEvent.click(selectorButtons[selectorButtons.length - 1]);
  fireEvent.change(screen.getByPlaceholderText("输入完整绝对路径..."), {
    target: { value: path },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
}

function createSnapshot(stage: string = "planning", sessionId = "session-old") {
  return {
    session_id: sessionId,
    target_dir: "D:/sorted",
    placement: undefined,
    stage,
    summary: "",
    strategy: {
      template_id: "general_downloads",
      template_label: "通用整理",
      task_type: "organize_full_directory",
      task_type_label: "整理整个目录",
      organize_mode: "initial",
      organize_mode_label: "生成新结构",
      organize_method: "categorize_into_new_structure",
      language: "zh",
      language_label: "中文",
      density: "normal",
      density_label: "标准",
      prefix_style: "none",
      prefix_style_label: "无前缀",
      caution_level: "balanced",
      caution_level_label: "平衡",
      destination_index_depth: 2,
      note: "",
    },
    assistant_message: null,
    scanner_progress: {},
    planner_progress: {},
    plan_snapshot: {},
    precheck_summary: null,
    execution_report: null,
    rollback_report: null,
    last_journal_id: null,
    integrity_flags: {},
    available_actions: [],
    messages: [],
    updated_at: "2026-04-25T00:00:00Z",
  } as any;
}

describe("SessionLauncher", () => {
  beforeEach(() => {
    window.localStorage.clear();
    pathnameMock = "/";
    pushMock.mockReset();
    createLaunchSessionMock.mockReset();
    startFreshSessionMock.mockReset();
    getSettingsMock.mockReset();
    getHistoryMock.mockReset();
    getCommonDirsMock.mockReset();
    getTargetProfilesMock.mockReset();
    createTargetProfileMock.mockReset();
    selectDirMock.mockReset();
    isTauriDesktopMock.mockReset();
    inspectPathsWithTauriMock.mockReset();
    pickDirectoryWithTauriMock.mockReset();
    pickDirectoriesWithTauriMock.mockReset();
    pickFilesWithTauriMock.mockReset();
    listDirectoryEntriesResultWithTauriMock.mockReset();
    isTauriDesktopMock.mockReturnValue(false);

    getSettingsMock.mockResolvedValue({
      global_config: {
        LAUNCH_REVIEW_FOLLOWS_NEW_ROOT: true,
      },
      status: {
        text_configured: true,
      },
    });
    getHistoryMock.mockResolvedValue([]);
    getCommonDirsMock.mockResolvedValue([]);
    getTargetProfilesMock.mockResolvedValue([
      {
        profile_id: "profile-1",
        name: "工作资料库",
        directories: [
          { path: "D:/archive/docs", label: "文档", description: "项目文档与合同" },
          { path: "D:/archive/media", label: "素材", description: "图片与视频素材" },
        ],
        created_at: "2026-04-20T10:00:00Z",
        updated_at: "2026-04-20T10:00:00Z",
      },
    ]);
    createTargetProfileMock.mockResolvedValue({
      profile_id: "profile-2",
      name: "新的配置",
      directories: [{ path: "D:/archive/docs", label: "文档", description: "" }],
      created_at: "2026-04-20T10:00:00Z",
      updated_at: "2026-04-20T10:00:00Z",
    });
    createLaunchSessionMock.mockResolvedValue({
      mode: "created",
      session_id: "session-1",
      restorable_session: null,
      session_snapshot: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("keeps the new-organize flow behind the launch workbench until requested", async () => {
    render(<SessionLauncher />);

    expect(await screen.findByText("继续手头任务，或开始一次新的整理")).toBeInTheDocument();
    expect(screen.getByText("本次整理对象")).not.toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /新建整理/ }));

    expect(screen.getByText("本次整理对象")).toBeVisible();
  });

  it("supports multiple file and directory sources and submits a full-categorize payload", async () => {
    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming");
    addSource("D:/incoming/readme.txt", "file");

    expect(screen.getByText("incoming")).toBeInTheDocument();
    expect(screen.getByText("readme.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "D:/sorted" },
    });
    fireEvent.click(screen.getByRole("button", { name: "读取目录并生成建议" }));

    await waitFor(() => {
      expect(createLaunchSessionMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sources: [
            { source_type: "directory", path: "D:/incoming", directory_mode: "atomic" },
            { source_type: "file", path: "D:/incoming/readme.txt" },
          ],
          organize_method: "categorize_into_new_structure",
          output_dir: "D:/sorted",
          strategy: expect.objectContaining({
            template_id: "general_downloads",
            organize_mode: "initial",
            task_type: "organize_full_directory",
            organize_method: "categorize_into_new_structure",
            output_dir: "D:/sorted",
          }),
        }),
      );
    });
  });

  it("restores the unfinished launcher draft after navigating back", async () => {
    window.localStorage.setItem(
      "file_pilot_launcher_draft",
      JSON.stringify({
        version: 1,
        step: 1,
        sources: [
          { source_type: "file", path: "D:/incoming/readme.txt" },
          { source_type: "directory", path: "D:/incoming/photos", directory_mode: "atomic" },
        ],
      }),
    );

    render(<SessionLauncher />);

    expect(await screen.findByText("文件夹 1 · 文件 1")).toBeInTheDocument();
    const folderName = screen.getByText("photos");
    const fileName = screen.getByText("readme.txt");
    expect(folderName.compareDocumentPosition(fileName) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("falls back to the source workspace when full categorize output_dir is not manually overridden", async () => {
    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并生成建议" }));

    await waitFor(() => {
        expect(createLaunchSessionMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            output_dir: "D:/",
          }),
        );
      });
  });

  it("starts directly from step one when launch skip prompt is enabled", async () => {
    getSettingsMock.mockResolvedValueOnce({
      global_config: {
        LAUNCH_SKIP_STRATEGY_PROMPT: true,
        LAUNCH_REVIEW_FOLLOWS_NEW_ROOT: true,
      },
      status: {
        text_configured: true,
      },
    });

    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming");

    fireEvent.click(screen.getByRole("button", { name: "按默认配置开始整理" }));

    await waitFor(() => {
      expect(createLaunchSessionMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sources: [{ source_type: "directory", path: "D:/incoming", directory_mode: "atomic" }],
          organize_method: "categorize_into_new_structure",
          output_dir: "D:/",
        }),
      );
    });
  });

  it("fills target directories from a profile and submits assign-existing payload", async () => {
    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/downloads");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: /归入现有目录/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));

    const profileSelect = screen.getByRole("combobox");
    fireEvent.change(profileSelect, { target: { value: "profile-1" } });

    expect(await screen.findByText("D:/archive/docs")).toBeInTheDocument();
    expect(screen.getByText("D:/archive/media")).toBeInTheDocument();

    openManualTargetInput();
    fireEvent.change(screen.getByPlaceholderText("手动输入目标目录完整绝对路径"), {
      target: { value: "D:/archive/misc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并开始规划" }));

    await waitFor(() => {
      expect(createLaunchSessionMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sources: [{ source_type: "directory", path: "D:/downloads", directory_mode: "atomic" }],
          organize_method: "assign_into_existing_categories",
          target_profile_id: "profile-1",
          target_directories: ["D:/archive/docs", "D:/archive/media", "D:/archive/misc"],
          strategy: expect.objectContaining({
            organize_mode: "incremental",
            task_type: "organize_into_existing",
            organize_method: "assign_into_existing_categories",
            target_profile_id: "profile-1",
          }),
        }),
      );
    });
  });

  it("submits atomic directory sources as single items and falls back to the parent workspace root", async () => {
    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming/project-bundle");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并生成建议" }));

    await waitFor(() => {
      expect(createLaunchSessionMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sources: [{ source_type: "directory", path: "D:/incoming/project-bundle", directory_mode: "atomic" }],
          organize_method: "categorize_into_new_structure",
          output_dir: "D:/incoming",
        }),
      );
    });
  });

  it("blocks assign-existing submission when no target profile or target directories are provided", async () => {
    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/downloads");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: /归入现有目录/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并开始规划" }));

    expect(await screen.findByText("归入现有目录时，至少需要选择一个目录配置或手动添加目标目录。")).toBeInTheDocument();
    expect(createLaunchSessionMock).not.toHaveBeenCalled();
  });

  it("blocks assign-existing submission when the saved target profile no longer exists", async () => {
    window.localStorage.setItem(
      "file_pilot_launcher_draft",
      JSON.stringify({
        version: 1,
        step: 3,
        sources: [{ source_type: "directory", path: "D:/downloads", directory_mode: "atomic" }],
        sourceImportGroups: [],
        sourceDraftType: "directory",
        sourceDraftPath: "",
        strategy: {
          template_id: "general_downloads",
          organize_mode: "incremental",
          task_type: "organize_into_existing",
          organize_method: "assign_into_existing_categories",
          language: "zh",
          density: "normal",
          prefix_style: "none",
          caution_level: "balanced",
          destination_index_depth: 2,
          note: "",
        },
        selectedTargetProfileId: "missing-profile",
        manualTargetDirectories: [],
      }),
    );

    render(<SessionLauncher />);

    await screen.findByText("填写必要信息");
    fireEvent.click(screen.getByRole("button", { name: "读取目录并开始规划" }));

    expect(await screen.findByText("当前选择的目录配置已不存在，请重新选择目录配置或手动添加目标目录。")).toBeInTheDocument();
    expect(createLaunchSessionMock).not.toHaveBeenCalled();
  });

  it("does not show the global error alert immediately, but displays a helpful inline hint instead after entering step three for assign-existing mode", async () => {
    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/downloads");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: /归入现有目录/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));

    expect(screen.queryByText("继续前请先补全当前信息")).not.toBeInTheDocument();
    expect(await screen.findByText(/需要目标目录：/)).toBeInTheDocument();
    expect(createLaunchSessionMock).not.toHaveBeenCalled();
  });

  it("can save the current target directory set as a reusable profile from the secondary section", async () => {
    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/downloads");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: /归入现有目录/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));

    openManualTargetInput();
    fireEvent.change(screen.getByPlaceholderText("手动输入目标目录完整绝对路径"), {
      target: { value: "D:/archive/docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.change(screen.getByPlaceholderText("配置名称（例：工作资料库）"), {
      target: { value: "新的配置" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => {
      expect(createTargetProfileMock).toHaveBeenCalledWith({
        name: "新的配置",
        directories: [{ path: "D:/archive/docs", label: undefined, description: undefined }],
      });
    });
  });

  it("clears all selected sources from the launcher in one action", async () => {
    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming");
    addSource("D:/incoming/readme.txt", "file");

    expect(screen.getByText("incoming")).toBeInTheDocument();
    expect(screen.getByText("readme.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /清空来源/ }));
    fireEvent.click(screen.getByRole("button", { name: /确认清空？/ }));

    expect(screen.queryByText("incoming")).not.toBeInTheDocument();
    expect(screen.queryByText("readme.txt")).not.toBeInTheDocument();
    expect(screen.getByText("请将想要整理的文件或文件夹拖放到此")).toBeVisible();
  });

  it("opens advanced settings in a dialog instead of expanding inline", async () => {
    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));

    fireEvent.click(screen.getByRole("button", { name: "更多高级参数..." }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("高级设置").length).toBeGreaterThan(0);
    expect(screen.getByText("分类归档策略")).toBeInTheDocument();
  });

  it("uses global placement defaults and lets review follow the new-directory root", async () => {
    getSettingsMock.mockResolvedValueOnce({
      global_config: {
        LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT: "D:/sorted-default",
        LAUNCH_REVIEW_FOLLOWS_NEW_ROOT: true,
      },
      status: {
        text_configured: true,
      },
    });

    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));

    expect(await screen.findByPlaceholderText("D:/sorted-default")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("D:/sorted-default/Review")).toBeInTheDocument();
  });

  it("shows a resume prompt when createSession returns resume_available", async () => {
    createLaunchSessionMock.mockResolvedValueOnce({
      mode: "resume_available",
      session_id: null,
      restorable_session: createSnapshot("planning", "session-old"),
      session_snapshot: createSnapshot("planning", "session-old"),
    });

    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并生成建议" }));

    expect(await screen.findByText("发现可继续的整理任务")).toBeInTheDocument();
    expect(screen.getByText(/还有一条未完成的任务/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续整理" })).toBeEnabled();
  });

  it("continues an unfinished resumable session without auto_scan", async () => {
    createLaunchSessionMock.mockResolvedValueOnce({
      mode: "resume_available",
      session_id: null,
      restorable_session: createSnapshot("planning", "session-old"),
      session_snapshot: createSnapshot("planning", "session-old"),
    });

    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并生成建议" }));
    fireEvent.click(await screen.findByRole("button", { name: "继续整理" }));

    expect(pushMock).toHaveBeenCalledWith("/workspace/progress?session_id=session-old&dir=D%3A%2F");
  });

  it("continues a draft resumable session with auto_scan", async () => {
    createLaunchSessionMock.mockResolvedValueOnce({
      mode: "resume_available",
      session_id: null,
      restorable_session: createSnapshot("draft", "session-draft"),
      session_snapshot: createSnapshot("draft", "session-draft"),
    });

    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并生成建议" }));
    fireEvent.click(await screen.findByRole("button", { name: "继续整理" }));

    expect(pushMock).toHaveBeenCalledWith("/workspace/progress?session_id=session-draft&dir=D%3A%2F&auto_scan=1");
    expect(window.localStorage.getItem("workspace_active_route")).toBe("/workspace/progress?session_id=session-draft&dir=D%3A%2F");
  });

  it("releases the launch transition if opening the workspace takes too long", async () => {
    createLaunchSessionMock.mockReturnValueOnce(new Promise(() => {}));

    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "读取目录并生成建议" }));
    expect(createLaunchSessionMock).toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
      await Promise.resolve();
    });

    expect(screen.getByText(/打开工作区等待时间过长/)).toBeInTheDocument();
  });

  it("starts fresh from a completed resumable session through startFreshSession", async () => {
    createLaunchSessionMock.mockResolvedValueOnce({
      mode: "resume_available",
      session_id: null,
      restorable_session: createSnapshot("completed", "session-done"),
      session_snapshot: createSnapshot("completed", "session-done"),
    });
    startFreshSessionMock.mockResolvedValueOnce({
      mode: "created",
      session_id: "session-fresh",
      restorable_session: null,
      session_snapshot: null,
    });

    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并生成建议" }));

    expect(await screen.findByText("发现之前的整理记录")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新开始" }));

    await waitFor(() => {
      expect(startFreshSessionMock).toHaveBeenCalledWith(
        expect.anything(),
        "session-done",
        "completed",
        expect.objectContaining({
          resume_if_exists: true,
          display_path: "D:/",
          sources: [{ source_type: "directory", path: "D:/incoming", directory_mode: "atomic" }],
        }),
      );
      expect(pushMock).toHaveBeenCalledWith("/workspace/progress?session_id=session-fresh&dir=D%3A%2F&auto_scan=1");
    });
  });

  it("opens an unfinished resumable session in readonly mode", async () => {
    createLaunchSessionMock.mockResolvedValueOnce({
      mode: "resume_available",
      session_id: null,
      restorable_session: createSnapshot("planning", "session-old"),
      session_snapshot: createSnapshot("planning", "session-old"),
    });

    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并生成建议" }));
    fireEvent.click(await screen.findByRole("button", { name: "只读打开" }));

    expect(pushMock).toHaveBeenCalledWith("/workspace/progress?session_id=session-old&dir=D%3A%2F&readonly=1");
  });

  it("uses the first mixed source path when opening a resumable session readonly", async () => {
    createLaunchSessionMock.mockResolvedValueOnce({
      mode: "resume_available",
      session_id: null,
      restorable_session: createSnapshot("planning", "session-old"),
      session_snapshot: createSnapshot("planning", "session-old"),
    });

    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming/readme.txt", "file");
    addSource("D:/incoming/project", "directory");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: /归入现有目录/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    openManualTargetInput();
    fireEvent.change(screen.getByPlaceholderText("手动输入目标目录完整绝对路径"), {
      target: { value: "D:/archive/docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并开始规划" }));
    fireEvent.click(await screen.findByRole("button", { name: "只读打开" }));

    expect(pushMock).toHaveBeenCalledWith("/workspace/progress?session_id=session-old&dir=D%3A%2Fincoming%2Freadme.txt&readonly=1");
  });

  it("uses firstSourcePath for mixed-source assign-existing workspace route params", async () => {
    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming/readme.txt", "file");
    addSource("D:/incoming/project", "directory");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: /归入现有目录/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    openManualTargetInput();
    fireEvent.change(screen.getByPlaceholderText("手动输入目标目录完整绝对路径"), {
      target: { value: "D:/archive/docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并开始规划" }));

    await waitFor(() => {
      expect(createLaunchSessionMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          display_path: "D:/incoming/readme.txt",
          sources: [
            { source_type: "file", path: "D:/incoming/readme.txt" },
            { source_type: "directory", path: "D:/incoming/project", directory_mode: "atomic" },
          ],
        }),
      );
      expect(pushMock).toHaveBeenCalledWith("/workspace/progress?session_id=session-1&dir=D%3A%2Fincoming%2Freadme.txt&auto_scan=1");
    });
  });

  it("does not advance to step two when there are no sources", async () => {
    render(<SessionLauncher />);

    await screen.findByText("继续手头任务，或开始一次新的整理");
    openLaunchFlow();
    expect(screen.getByRole("button", { name: "下一步：选择整理方式" })).toBeDisabled();
  });

  it("imports top-level items from a folder into a grouped preview and submits only real source items", async () => {
    isTauriDesktopMock.mockReturnValue(true);
    pickDirectoryWithTauriMock.mockResolvedValue("D:/Downloads");
    listDirectoryEntriesResultWithTauriMock.mockResolvedValue({ ok: true, items: [
      { path: "D:/Downloads/ProjectA", is_dir: true, is_file: false },
      { path: "D:/Downloads/ProjectB", is_dir: true, is_file: false },
      { path: "D:/Downloads/notes.txt", is_dir: false, is_file: true },
      { path: "D:/Downloads/cover.png", is_dir: false, is_file: true },
      { path: "D:/Downloads/invoice.pdf", is_dir: false, is_file: true },
      { path: "D:/Downloads/archive.zip", is_dir: false, is_file: true },
    ], ignored_count: 0, error_code: null, message: null });

    render(<SessionLauncher />);

    await screen.findByText("继续手头任务，或开始一次新的整理");
    openLaunchFlow();
    fireEvent.click(screen.getByRole("button", { name: "整理文件夹内容" }));

    expect(await screen.findByText("已导入“D:/Downloads”下的 6 个顶层项目。")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/已从 Downloads 导入 6 项/));
    expect(screen.getByText("archive.zip")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并生成建议" }));

    await waitFor(() => {
      expect(createLaunchSessionMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sources: [
            { source_type: "directory", path: "D:/Downloads/ProjectA", directory_mode: "atomic" },
            { source_type: "directory", path: "D:/Downloads/ProjectB", directory_mode: "atomic" },
            { source_type: "file", path: "D:/Downloads/notes.txt" },
            { source_type: "file", path: "D:/Downloads/cover.png" },
            { source_type: "file", path: "D:/Downloads/invoice.pdf" },
            { source_type: "file", path: "D:/Downloads/archive.zip" },
          ],
        }),
      );
    });
  });

  it("imports all top-level items when choosing a quick access directory", async () => {
    isTauriDesktopMock.mockReturnValue(true);
    getCommonDirsMock.mockResolvedValue([
      { label: "下载", path: "D:/Downloads" },
    ]);
    listDirectoryEntriesResultWithTauriMock.mockResolvedValue({ ok: true, items: [
      { path: "D:/Downloads/ProjectA", is_dir: true, is_file: false },
      { path: "D:/Downloads/notes.txt", is_dir: false, is_file: true },
    ], ignored_count: 0, error_code: null, message: null });

    render(<SessionLauncher />);

    await screen.findByText("继续手头任务，或开始一次新的整理");
    openLaunchFlow();
    fireEvent.click(await screen.findByRole("button", { name: /下载/ }));

    expect(await screen.findByText("已导入“D:/Downloads”下的 2 个顶层项目。")).toBeInTheDocument();
    expect(listDirectoryEntriesResultWithTauriMock).toHaveBeenCalledWith("D:/Downloads");

    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并生成建议" }));

    await waitFor(() => {
      expect(createLaunchSessionMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sources: [
            { source_type: "directory", path: "D:/Downloads/ProjectA", directory_mode: "atomic" },
            { source_type: "file", path: "D:/Downloads/notes.txt" },
          ],
        }),
      );
    });
  });

  it("replaces an atomic folder item with imported top-level items when switching modes", async () => {
    isTauriDesktopMock.mockReturnValue(true);
    listDirectoryEntriesResultWithTauriMock.mockResolvedValue({ ok: true, items: [
      { path: "D:/incoming/project-bundle/README.md", is_dir: false, is_file: true },
      { path: "D:/incoming/project-bundle/src", is_dir: true, is_file: false },
    ], ignored_count: 0, error_code: null, message: null });

    render(<SessionLauncher />);

    await screen.findByText("本次整理对象");
    addSource("D:/incoming/project-bundle");
    fireEvent.click(screen.getByRole("button", { name: "导入内部项" }));

    expect(await screen.findByText("已导入“D:/incoming/project-bundle”下的 2 个顶层项目。")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/已从 project-bundle 导入 2 项/));
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一步：选择整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写必要信息" }));
    fireEvent.click(screen.getByRole("button", { name: "读取目录并生成建议" }));

    await waitFor(() => {
      expect(createLaunchSessionMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sources: [
            { source_type: "file", path: "D:/incoming/project-bundle/README.md" },
            { source_type: "directory", path: "D:/incoming/project-bundle/src", directory_mode: "atomic" },
          ],
        }),
      );
    });
  });
});


