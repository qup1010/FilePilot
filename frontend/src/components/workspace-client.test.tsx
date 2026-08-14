import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTIVE_WORKSPACE_ROUTE_KEY } from "@/lib/app-context-store";
import { getSessionStageView } from "@/lib/session-view-model";
import type { SessionSnapshot, SessionStage } from "@/types/session";

import WorkspaceClient from "./workspace-client";

const pushMock = vi.fn();
const replaceMock = vi.fn();
const getSettingsMock = vi.fn();
// 真实 next/navigation 的 useRouter 返回稳定引用；组件的路由记忆 effect 依赖 router，
// 若每次渲染返回新对象会导致 effect 反复执行、覆盖 localStorage。
const routerMock = { push: pushMock, replace: replaceMock };
let searchParamsString = "session_id=s1&dir=D%3A%2Fdemo";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParamsString),
  useRouter: () => routerMock,
}));

vi.mock("motion/react", () => {
  const cache = new Map<string, unknown>();
  const createPassthrough = (tag: string) => {
    const Passthrough = (props: Record<string, unknown>) => {
      const {
        children,
        initial: _initial,
        animate: _animate,
        exit: _exit,
        transition: _transition,
        variants: _variants,
        whileTap: _whileTap,
        whileHover: _whileHover,
        whileInView: _whileInView,
        layout: _layout,
        layoutId: _layoutId,
        ...rest
      } = props;
      const Tag = tag as unknown as React.ElementType;
      return <Tag {...rest}>{children as React.ReactNode}</Tag>;
    };
    return Passthrough;
  };
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (typeof prop !== "string") {
            return undefined;
          }
          if (!cache.has(prop)) {
            cache.set(prop, createPassthrough(prop));
          }
          return cache.get(prop);
        },
      },
    ),
  };
});

vi.mock("@/lib/runtime", () => ({
  getApiBaseUrl: () => "http://127.0.0.1:8765",
  getApiToken: () => "",
  isTauriDesktop: () => false,
}));

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({
    getSettings: getSettingsMock,
  }),
}));

vi.mock("@/lib/workspace-notifications", () => ({
  requestWorkspaceNotificationPermission: vi.fn(async () => "granted"),
  notifyWorkspaceWhenAway: vi.fn(),
}));

vi.mock("./workspace/minimal-scanning-view", () => ({
  MinimalScanningView: (props: { phase: string; scanner: { status: string } }) => (
    <div data-testid="minimal-scanning-view" data-phase={props.phase} data-scanner-status={props.scanner.status} />
  ),
}));

vi.mock("./workspace/precheck-view", () => ({
  PrecheckView: (props: {
    readOnly: boolean;
    onRequestExecute: () => void;
    onBack: () => void;
  }) => (
    <div data-testid="precheck-view" data-readonly={String(props.readOnly)}>
      <button type="button" data-testid="stub-request-execute" onClick={props.onRequestExecute}>
        stub-request-execute
      </button>
      <button type="button" data-testid="stub-precheck-back" onClick={props.onBack}>
        stub-precheck-back
      </button>
    </div>
  ),
}));

vi.mock("./workspace/completion-view", () => ({
  CompletionView: (props: {
    journal: unknown;
    loadError: string | null;
    readOnly: boolean;
    onRetryLoad: () => void;
    onGoHome: () => void;
    onRollback: () => void;
    onCleanupDirs: () => void;
  }) => (
    <div
      data-testid="completion-view"
      data-has-journal={String(Boolean(props.journal))}
      data-load-error={props.loadError ?? ""}
      data-readonly={String(props.readOnly)}
    >
      <button type="button" data-testid="stub-retry-load" onClick={props.onRetryLoad}>
        stub-retry-load
      </button>
      <button type="button" data-testid="stub-go-home" onClick={props.onGoHome}>
        stub-go-home
      </button>
      <button type="button" data-testid="stub-rollback" onClick={props.onRollback}>
        stub-rollback
      </button>
      <button type="button" data-testid="stub-cleanup" onClick={props.onCleanupDirs}>
        stub-cleanup
      </button>
    </div>
  ),
}));

vi.mock("./workspace/conversation-panel", () => ({
  ConversationPanel: (props: { composerMode: string }) => (
    <div data-testid="conversation-panel" data-composer-mode={props.composerMode} />
  ),
}));

vi.mock("./workspace/incremental-selection-view", () => ({
  IncrementalSelectionView: (props: { onConfirm: (dirs: string[]) => void; onExit: () => void }) => (
    <div data-testid="incremental-selection-view">
      <button type="button" data-testid="stub-confirm-targets" onClick={() => props.onConfirm(["D:/archive"])}>
        stub-confirm-targets
      </button>
    </div>
  ),
}));

vi.mock("./workspace/preview-panel", () => ({
  PreviewPanel: (props: { readOnly: boolean; onRunPrecheck: () => void }) => (
    <div data-testid="preview-panel" data-readonly={String(props.readOnly)}>
      <button type="button" data-testid="stub-run-precheck" onClick={props.onRunPrecheck}>
        stub-run-precheck
      </button>
    </div>
  ),
}));

vi.mock("./workspace/rollback-preview-dialog", () => ({
  RollbackPreviewDialog: (props: { open: boolean }) =>
    props.open ? <div data-testid="rollback-preview-dialog" /> : null,
}));

// overrides 保持宽松：测试夹具只需要组件真正读取的字段，完整快照类型由 makeSnapshot 基础值兜底。
function makeSnapshot(overrides: Record<string, unknown> = {}): SessionSnapshot {
  return {
    session_id: "s1",
    session_title: "demo 整理",
    target_dir: "D:/demo",
    stage: "planning",
    summary: "",
    assistant_message: null,
    scanner_progress: {
      status: "idle",
      processed_count: 0,
      total_count: 0,
      current_item: null,
      recent_analysis_items: [],
    },
    planner_progress: { status: "idle" },
    plan_snapshot: {
      summary: "",
      placement: { new_directory_root: "D:/demo/_Organized", review_root: "D:/demo/_Review" },
      items: [],
      groups: [],
      target_slots: [],
      mappings: [],
      unresolved_items: [],
      review_items: [],
      invalidated_items: [],
      change_highlights: [],
      stats: { directory_count: 0, move_count: 0, unresolved_count: 0 },
      readiness: { can_precheck: false },
    },
    precheck_summary: null,
    incremental_selection: null,
    source_tree_entries: [],
    execution_report: null,
    rollback_report: null,
    integrity_flags: {},
    strategy: {
      organize_mode: "initial",
      organize_method: "categorize_into_new_structure",
    },
    last_error: null,
    last_journal_id: null,
    available_actions: [],
    messages: [],
    updated_at: "2026-07-26T00:00:00Z",
    ...overrides,
  } as unknown as SessionSnapshot;
}

const IDLE_PLANNER_STATUS = {
  status: "idle",
  phase: null,
  label: "",
  detail: null,
  attempt: 1,
  elapsedLabel: null,
  reassureText: null,
  preservingPreviousPlan: false,
  isRunning: false,
};

type SessionMock = Record<string, unknown> & {
  snapshot: SessionSnapshot | null;
  stage: SessionStage;
  execute: ReturnType<typeof vi.fn>;
  runPrecheck: ReturnType<typeof vi.fn>;
  returnToPlanning: ReturnType<typeof vi.fn>;
  loadJournal: ReturnType<typeof vi.fn>;
  prepareRollback: ReturnType<typeof vi.fn>;
  cleanupEmptyDirs: ReturnType<typeof vi.fn>;
  confirmTargetDirectories: ReturnType<typeof vi.fn>;
};

function makeSession(overrides: Record<string, unknown> = {}): SessionMock {
  const snapshot = ("snapshot" in overrides ? overrides.snapshot : makeSnapshot()) as SessionSnapshot | null;
  const stage = (overrides.stage as SessionStage) || snapshot?.stage || "idle";
  const base = {
    snapshot,
    stage,
    journal: null,
    journalLoading: false,
    journalError: null,
    loading: false,
    chatMessages: [],
    assistantDraft: "",
    assistantRuntime: null,
    plannerProgress: { status: "idle" },
    plannerStatus: IDLE_PLANNER_STATUS,
    composerStatus: null,
    chatError: null,
    chatErrorCode: null,
    streamStatus: "connected",
    composerMode: getSessionStageView(stage).composerMode,
    isComposerLocked: false,
    refreshSnapshot: vi.fn(async () => {}),
    retryStream: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    scan: vi.fn(async () => {}),
    refreshPlan: vi.fn(async () => {}),
    confirmTargetDirectories: vi.fn(async () => {}),
    runPrecheck: vi.fn(async () => {}),
    applyTargetConflictSuggestions: vi.fn(async () => {}),
    returnToPlanning: vi.fn(async () => {}),
    execute: vi.fn(async () => {}),
    prepareRollback: vi.fn(async () => null),
    confirmRollback: vi.fn(async () => true),
    rollback: vi.fn(async () => {}),
    cleanupEmptyDirs: vi.fn(async () => {}),
    abandonSession: vi.fn(async () => true),
    openExplorer: vi.fn(async () => {}),
    loadJournal: vi.fn(async () => {}),
    updateItem: vi.fn(async () => {}),
    restoreAiSuggestion: vi.fn(async () => {}),
  };
  return { ...base, ...overrides, snapshot, stage } as SessionMock;
}

let currentSession: SessionMock;

vi.mock("@/lib/use-session", () => ({
  useSession: () => currentSession,
}));

function setWorkspaceQuery(query: string) {
  searchParamsString = query;
  window.history.replaceState({}, "", query ? `/workspace/test?${query}` : "/workspace/test");
}

const JOURNAL_FIXTURE = {
  journal_id: "j1",
  moved_count: 3,
  failed_count: 0,
  entries: [],
} as unknown as NonNullable<unknown>;

describe("WorkspaceClient", () => {
  beforeEach(() => {
    window.localStorage.clear();
    pushMock.mockReset();
    replaceMock.mockReset();
    getSettingsMock.mockReset();
    getSettingsMock.mockResolvedValue({ status: { text_configured: true } });
    setWorkspaceQuery("session_id=s1&dir=D%3A%2Fdemo");
    currentSession = makeSession();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders the scanning view while the session is scanning", async () => {
    currentSession = makeSession({
      snapshot: makeSnapshot({
        stage: "scanning",
        scanner_progress: {
          status: "running",
          processed_count: 2,
          total_count: 10,
          current_item: "a.txt",
          recent_analysis_items: [],
        },
      }),
    });

    render(<WorkspaceClient view="progress" />);

    const scanning = await screen.findByTestId("minimal-scanning-view");
    expect(scanning).toHaveAttribute("data-phase", "analyzing");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("renders the precheck view for ready_to_execute and wires onBack to returnToPlanning", async () => {
    currentSession = makeSession({
      snapshot: makeSnapshot({ stage: "ready_to_execute" }),
    });

    render(<WorkspaceClient view="review" />);

    const precheckView = await screen.findByTestId("precheck-view");
    expect(precheckView).toHaveAttribute("data-readonly", "false");

    fireEvent.click(screen.getByTestId("stub-precheck-back"));
    expect(currentSession.returnToPlanning).toHaveBeenCalledTimes(1);
  });

  it("renders the completion view with the journal and does not auto reload it", async () => {
    currentSession = makeSession({
      snapshot: makeSnapshot({ stage: "completed" }),
      journal: JOURNAL_FIXTURE,
    });

    render(<WorkspaceClient view="result" />);

    const completion = await screen.findByTestId("completion-view");
    expect(completion).toHaveAttribute("data-has-journal", "true");
    expect(currentSession.loadJournal).not.toHaveBeenCalled();
  });

  it("blocks journal auto-retry on load error and lets the user retry manually", async () => {
    currentSession = makeSession({
      snapshot: makeSnapshot({ stage: "completed" }),
      journal: null,
      journalError: "读取整理结果失败",
    });

    render(<WorkspaceClient view="result" />);

    const completion = await screen.findByTestId("completion-view");
    expect(completion).toHaveAttribute("data-load-error", "读取整理结果失败");
    // journalError 必须挡住自动重试，避免读取失败后无限循环请求。
    expect(currentSession.loadJournal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("stub-retry-load"));
    expect(currentSession.loadJournal).toHaveBeenCalledTimes(1);
  });

  it("shows the executing state while files are being moved", async () => {
    currentSession = makeSession({
      snapshot: makeSnapshot({ stage: "executing" }),
    });

    render(<WorkspaceClient view="review" />);

    expect(await screen.findByText("正在执行整理")).toBeInTheDocument();
    expect(screen.queryByTestId("precheck-view")).not.toBeInTheDocument();
  });

  it("renders the incremental selection screen for the target-selection stage on the progress view", async () => {
    currentSession = makeSession({
      snapshot: makeSnapshot({
        stage: "selecting_incremental_scope",
        incremental_selection: { root_directory_options: [{ path: "D:/archive", label: "档案" }] },
      }),
    });

    // 非 progress 视图：阶段与视图不一致，先显示切换过渡页并把路由纠正到 progress。
    render(<WorkspaceClient view="review" />);
    expect(await screen.findByText("正在切换工作区")).toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith("/workspace/progress?session_id=s1&dir=D%3A%2Fdemo");
    expect(screen.queryByTestId("incremental-selection-view")).not.toBeInTheDocument();
    cleanup();

    // progress 视图：目标选择阶段必须渲染目录选择界面，而不是扫描进度。
    render(<WorkspaceClient view="progress" />);
    expect(await screen.findByTestId("incremental-selection-view")).toBeInTheDocument();
    expect(screen.queryByTestId("minimal-scanning-view")).not.toBeInTheDocument();
  });

  it("remembers the active workspace route for an active non-readonly session", async () => {
    currentSession = makeSession({
      snapshot: makeSnapshot({
        stage: "scanning",
        scanner_progress: { status: "running", processed_count: 1, total_count: 5, current_item: null, recent_analysis_items: [] },
      }),
    });

    render(<WorkspaceClient view="progress" />);

    await waitFor(() => {
      expect(window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY)).toBe(
        "/workspace/progress?session_id=s1&dir=D%3A%2Fdemo",
      );
    });
  });

  it("clears the stored route for completed or readonly sessions but keeps other sessions' routes", async () => {
    // 已完成会话：清掉属于本会话的入口记录。
    window.localStorage.setItem(ACTIVE_WORKSPACE_ROUTE_KEY, "/workspace/progress?session_id=s1");
    currentSession = makeSession({
      snapshot: makeSnapshot({ stage: "completed" }),
      journal: JOURNAL_FIXTURE,
    });
    render(<WorkspaceClient view="result" />);
    await waitFor(() => {
      expect(window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY)).toBeNull();
    });
    cleanup();

    // 只读会话：同样清掉本会话的入口记录。
    window.localStorage.setItem(ACTIVE_WORKSPACE_ROUTE_KEY, "/workspace/progress?session_id=s1");
    setWorkspaceQuery("session_id=s1&dir=D%3A%2Fdemo&readonly=1");
    currentSession = makeSession({ snapshot: makeSnapshot({ stage: "planning" }) });
    render(<WorkspaceClient view="progress" />);
    await waitFor(() => {
      expect(window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY)).toBeNull();
    });
    cleanup();

    // 别的会话的入口记录不能被误删。
    window.localStorage.setItem(ACTIVE_WORKSPACE_ROUTE_KEY, "/workspace/plan?session_id=other");
    currentSession = makeSession({
      snapshot: makeSnapshot({ stage: "completed" }),
      journal: JOURNAL_FIXTURE,
    });
    setWorkspaceQuery("session_id=s1&dir=D%3A%2Fdemo");
    render(<WorkspaceClient view="result" />);
    await screen.findByTestId("completion-view");
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY)).toBe("/workspace/plan?session_id=other");
  });

  it("shows the global error banner in single-pane views when chatError is set", async () => {
    currentSession = makeSession({
      snapshot: makeSnapshot({ stage: "completed" }),
      journal: JOURNAL_FIXTURE,
      chatError: "回退失败：目标目录被占用",
    });

    render(<WorkspaceClient view="result" />);

    expect(await screen.findByText("操作失败")).toBeInTheDocument();
    expect(screen.getByText("回退失败：目标目录被占用")).toBeInTheDocument();
  });

  it("navigates home and forgets the stored route when the session is not found", async () => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_ROUTE_KEY, "/workspace/progress?session_id=s1");
    currentSession = makeSession({ snapshot: null, stage: "idle" });

    const { rerender } = render(<WorkspaceClient view="progress" />);
    expect(pushMock).not.toHaveBeenCalled();

    currentSession = {
      ...currentSession,
      chatError: "会话不存在或已被清理",
      chatErrorCode: "SESSION_NOT_FOUND",
    };
    rerender(<WorkspaceClient view="progress" />);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/");
    });
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY)).toBeNull();
  });

  it("opens the execute confirm dialog, keeps it open until execute resolves and blocks closing while loading", async () => {
    const snapshot = makeSnapshot({
      stage: "ready_to_execute",
      precheck_summary: {
        move_preview: [{ item_id: "i1", source: "D:/demo/a.txt", target: "D:/sorted/Docs/a.txt" }],
        mkdir_preview: [],
        warnings: [],
      },
    });
    let resolveExecute: (() => void) | undefined;
    currentSession = makeSession({ snapshot });
    currentSession.execute.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveExecute = resolve;
        }),
    );

    const { rerender } = render(<WorkspaceClient view="review" />);

    fireEvent.click(await screen.findByTestId("stub-request-execute"));
    expect(await screen.findByText("确认开始移动文件？")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始移动" }));
    expect(currentSession.execute).toHaveBeenCalledTimes(1);
    // execute 未完成前对话框保持打开。
    expect(screen.getByText("确认开始移动文件？")).toBeInTheDocument();

    // loading 期间不可关闭：取消按钮禁用，Escape 也不生效。
    currentSession = { ...currentSession, loading: true };
    rerender(<WorkspaceClient view="review" />);
    expect(screen.getByRole("button", { name: "再看看" })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByText("确认开始移动文件？")).toBeInTheDocument();

    currentSession = { ...currentSession, loading: false };
    rerender(<WorkspaceClient view="review" />);
    await act(async () => {
      resolveExecute?.();
    });
    await waitFor(() => {
      expect(screen.queryByText("确认开始移动文件？")).not.toBeInTheDocument();
    });
  });

  it("exits directly to home from a completed session without an exit confirm dialog", async () => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_ROUTE_KEY, "/workspace/progress?session_id=s1");
    currentSession = makeSession({
      snapshot: makeSnapshot({ stage: "completed" }),
      journal: JOURNAL_FIXTURE,
    });

    render(<WorkspaceClient view="result" />);

    fireEvent.click(await screen.findByTestId("stub-go-home"));

    expect(pushMock).toHaveBeenCalledWith("/");
    expect(screen.queryByText("结束本次整理？")).not.toBeInTheDocument();
    expect(screen.queryByText("暂存并退出当前任务？")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY)).toBeNull();
  });

  it("asks for confirmation before exiting an active session, then navigates home", async () => {
    currentSession = makeSession({
      snapshot: makeSnapshot({ stage: "planning", assistant_message: "初版方案已生成" }),
    });

    render(<WorkspaceClient view="plan" />);

    fireEvent.click(await screen.findByRole("button", { name: "退出" }));
    expect(await screen.findByText("暂存并退出当前任务？")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "暂存并退出" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/");
    });
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY)).toBeNull();
  });

  it("ignores execute and precheck triggers in readonly mode", async () => {
    setWorkspaceQuery("session_id=s1&dir=D%3A%2Fdemo&readonly=1");
    currentSession = makeSession({
      snapshot: makeSnapshot({ stage: "ready_to_execute" }),
    });

    render(<WorkspaceClient view="review" />);

    const precheckView = await screen.findByTestId("precheck-view");
    expect(precheckView).toHaveAttribute("data-readonly", "true");
    fireEvent.click(screen.getByTestId("stub-request-execute"));
    expect(screen.queryByText("确认开始移动文件？")).not.toBeInTheDocument();
    cleanup();

    currentSession = makeSession({
      snapshot: makeSnapshot({ stage: "planning", assistant_message: "初版方案已生成" }),
    });
    render(<WorkspaceClient view="plan" />);
    fireEvent.click(await screen.findByTestId("stub-run-precheck"));
    expect(currentSession.runPrecheck).not.toHaveBeenCalled();
  });

  it("ignores rollback and cleanup triggers in readonly completed sessions", async () => {
    setWorkspaceQuery("session_id=s1&dir=D%3A%2Fdemo&readonly=1");
    currentSession = makeSession({
      snapshot: makeSnapshot({ stage: "completed" }),
      journal: JOURNAL_FIXTURE,
    });

    render(<WorkspaceClient view="result" />);

    const completion = await screen.findByTestId("completion-view");
    expect(completion).toHaveAttribute("data-readonly", "true");
    fireEvent.click(screen.getByTestId("stub-rollback"));
    fireEvent.click(screen.getByTestId("stub-cleanup"));
    expect(currentSession.prepareRollback).not.toHaveBeenCalled();
    expect(currentSession.cleanupEmptyDirs).not.toHaveBeenCalled();
  });
});
