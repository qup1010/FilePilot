import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/lib/api";
import type { SettingsSnapshot, SettingsTestResult } from "@/types/settings";

import SettingsPage from "./page";

const getSettings = vi.fn<() => Promise<SettingsSnapshot>>();
const createSettingsPreset = vi.fn();
const updateSettings = vi.fn();
const testSettings = vi.fn();
const listSettingsModels = vi.fn();
const getTargetProfiles = vi.fn();
const createTargetProfile = vi.fn();
const updateTargetProfile = vi.fn();
const deleteTargetProfile = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
    button: ({ children, whileTap: _whileTap, ...props }: React.ComponentProps<"button"> & { whileTap?: unknown }) => (
      <button {...props}>{children}</button>
    ),
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/lib/runtime", () => ({
  getApiBaseUrl: () => "http://127.0.0.1:8765",
  getApiToken: () => "",
  isTauriDesktop: () => false,
  invokeTauriCommand: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  createApiClient: () =>
    ({
      getSettings,
      createSettingsPreset,
      getSettingsRuntime: vi.fn(),
      updateSettings,
      activateSettingsPreset: vi.fn(),
      deleteSettingsPreset: vi.fn(),
      testSettings,
      listSettingsModels,
      getTargetProfiles,
      createTargetProfile,
      updateTargetProfile,
      deleteTargetProfile,
    }) satisfies Partial<ApiClient>,
}));

function createSnapshot(): SettingsSnapshot {
  return {
    global_config: {
      IMAGE_ANALYSIS_ENABLED: true,
      LAUNCH_DEFAULT_TEMPLATE_ID: "general_downloads",
      LAUNCH_DEFAULT_LANGUAGE: "zh",
      LAUNCH_DEFAULT_DENSITY: "normal",
      LAUNCH_DEFAULT_PREFIX_STYLE: "none",
      DEBUG_MODE: false,
    },
    families: {
      text: {
        family: "text",
        configured: false,
        active_preset_id: "",
        active_preset: {
          id: "default",
          name: "默认文本模型",
          OPENAI_BASE_URL: "https://api.openai.com/v1",
          OPENAI_MODEL: "gpt-5.4",
          OPENAI_API_KEY: "",
          secret_state: "empty",
        },
        presets: [],
      },
      vision: {
        family: "vision",
        enabled: true,
        mode: "shared_text",
        configured: false,
        active_preset_id: "",
        active_preset: {
          id: "default",
          name: "默认图片理解",
          IMAGE_ANALYSIS_NAME: "默认图片理解",
          IMAGE_ANALYSIS_BASE_URL: "https://host.example/v1",
          IMAGE_ANALYSIS_MODEL: "gpt-4o-mini",
          IMAGE_ANALYSIS_API_KEY: "",
          secret_state: "empty",
        },
        presets: [],
      },
      icon_image: {
        family: "icon_image",
        configured: false,
        active_preset_id: "",
        active_preset: {
          id: "default",
          name: "默认图标生图",
          image_model: {
            base_url: "https://host.example/v1",
            model: "gpt-image-1",
            secret_state: "empty",
          },
          image_size: "1024x1024",
          analysis_concurrency_limit: 1,
          image_concurrency_limit: 1,
          save_mode: "in_folder",
          text_model: {
            base_url: "https://api.openai.com/v1",
            model: "gpt-5.4",
            secret_state: "empty",
          },
        },
        presets: [],
      },
      bg_removal: {
        family: "bg_removal",
        configured: false,
        mode: "preset",
        preset_id: "builtin-1",
        active_preset: {
          name: "抠图默认",
          model_id: "space-id",
          api_type: "gradio_space",
          payload_template: "{}",
          hf_api_token: "",
          secret_state: "empty",
        },
        builtin_presets: [
          {
            id: "builtin-1",
            name: "默认抠图",
            model_id: "space-id",
            api_type: "gradio_space",
            payload_template: "{}",
          },
        ],
        custom: {
          name: "",
          model_id: "",
          api_type: "gradio_space",
          payload_template: "{}",
          hf_api_token: "",
          secret_state: "empty",
        },
      },
    },
    status: {
      text_configured: false,
      vision_configured: false,
      icon_image_configured: false,
      bg_removal_configured: false,
    },
    runtime: {
      log_paths: {
        runtime_log: "D:/code/projects/active/FilePilot/logs/backend/runtime.log",
        debug_log: "D:/code/projects/active/FilePilot/logs/backend/debug.jsonl",
      },
    },
  };
}

function createSnapshotWithEditableVisionPreset(): SettingsSnapshot {
  const snapshot = createSnapshot();
  const activePreset = {
    ...snapshot.families.vision.active_preset,
    id: "vision-1",
    name: "图片理解预设",
  };
  snapshot.families.vision = {
    ...snapshot.families.vision,
    mode: "separate",
    configured: true,
    active_preset_id: activePreset.id,
    active_preset: activePreset,
    presets: [activePreset],
  };
  snapshot.status = {
    ...snapshot.status,
    vision_configured: true,
  };
  return snapshot;
}

function createSnapshotWithEditableTextPreset(): SettingsSnapshot {
  const snapshot = createSnapshot();
  const activePreset = {
    ...snapshot.families.text.active_preset,
    id: "text-1",
    name: "文本预设",
  };
  snapshot.families.text = {
    ...snapshot.families.text,
    configured: true,
    active_preset_id: activePreset.id,
    active_preset: activePreset,
    presets: [activePreset],
  };
  snapshot.status = {
    ...snapshot.status,
    text_configured: true,
  };
  return snapshot;
}

async function waitForSettingsHydrated() {
  await waitFor(() => {
    expect(screen.queryByText("正在读取统一设置快照")).not.toBeInTheDocument();
  });
}

async function clickSettingsCategory(label: string) {
  const labelNode = (await screen.findAllByText(label)).find((node) => node.closest("button")) ?? null;
  const tabButton = labelNode?.closest("button") ?? null;
  expect(tabButton).not.toBeNull();
  fireEvent.click(tabButton!);
}

describe("SettingsPage preset flow", () => {
  beforeEach(() => {
    currentSearchParams = new URLSearchParams();
    getSettings.mockReset();
    createSettingsPreset.mockReset();
    updateSettings.mockReset();
    testSettings.mockReset();
    listSettingsModels.mockReset();
    getTargetProfiles.mockReset();
    createTargetProfile.mockReset();
    updateTargetProfile.mockReset();
    deleteTargetProfile.mockReset();
    getSettings.mockResolvedValue(createSnapshot());
    getTargetProfiles.mockResolvedValue([]);
    createTargetProfile.mockResolvedValue({
      profile_id: "profile-new",
      name: "常用目标目录",
      directories: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    updateTargetProfile.mockResolvedValue({
      profile_id: "profile-1",
      name: "工作资料库",
      directories: [{ path: "D:/archive/docs", label: "文档", description: "项目文档" }],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    deleteTargetProfile.mockResolvedValue({ status: "deleted", profile_id: "profile-1" });
    updateSettings.mockImplementation(async (payload) => ({
      ...createSnapshot(),
      global_config: {
        ...createSnapshot().global_config,
        ...(payload?.global_config || {}),
      },
    }));
    testSettings.mockResolvedValue({
      status: "ok",
      family: "vision",
      code: "ok",
      message: '已验证模型能够识别测试图中的 "VISION TEST 42"。',
      details: {
        verification_type: "vision_text",
        expected: "VISION TEST 42",
        actual: "VISION TEST 42",
      },
    });
    listSettingsModels.mockResolvedValue({
      status: "ok",
      family: "text",
      models: [
        { id: "gpt-4.1" },
        { id: "gpt-4.1-mini" },
      ],
    });
  });

  it("allows first-run editing without creating a preset first", async () => {
    render(<SettingsPage />);

    await waitForSettingsHydrated();
    expect(screen.queryByText("请先点击 + 创建一个预设")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("gpt-5.4")).toBeInTheDocument();
    expect(screen.getByText(/最小配置路径/i)).toBeInTheDocument();
    expect(screen.getByText(/首次保存时会自动创建可编辑预设/i)).toBeInTheDocument();
  });

  it("does not show a cross-page reminder banner inside settings", async () => {
    render(<SettingsPage />);

    await waitForSettingsHydrated();
    expect(screen.queryByText("当前还没有可用的文本模型")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /去配置文本模型/i })).not.toBeInTheDocument();
  });

  it("shows icon dual-model dependency and advanced options", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitForSettingsHydrated();
    await clickSettingsCategory("生图模型配置");

    expect(await screen.findByText("双模型依赖")).toBeInTheDocument();
    expect(screen.getByText("文本模型（分析）")).toBeInTheDocument();
    expect(screen.getByText("生图模型（预览）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /去配置整理模型/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /高级选项/i }));
    expect(screen.getByText("图片尺寸")).toBeInTheDocument();
    expect(screen.getByText(/默认 1024x1024/i)).toBeInTheDocument();
  });

  it("opens the create preset dialog from the add button", async () => {
    const user = userEvent.setup();

    render(<SettingsPage />);

    const createButtons = await screen.findAllByRole("button", { name: /新建文本预设|新建预设/i });
    await user.click(createButtons[0]);

    expect(screen.getByText("新建文本预设")).toBeInTheDocument();
    expect(screen.getByDisplayValue("新的文本预设")).toBeInTheDocument();
  });

  it("does not render the duplicate preset name field in the text form", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByDisplayValue("默认文本模型")).not.toBeInTheDocument();
    });
  });

  it("creates a text preset without sending duplicate internal preset name", async () => {
    const user = userEvent.setup();

    createSettingsPreset.mockResolvedValue(undefined);
    getSettings.mockResolvedValue(createSnapshot());

    render(<SettingsPage />);

    const createButtons = await screen.findAllByRole("button", { name: /新建文本预设|新建预设/i });
    await user.click(createButtons[0]);
    const presetNameInput = screen.getByPlaceholderText("请输入预设名称");
    await user.clear(presetNameInput);
    await user.type(presetNameInput, "我的文本预设");
    await user.click(screen.getByRole("button", { name: /创建并切换|确认/i }));

    await waitFor(() => {
      expect(createSettingsPreset).toHaveBeenCalledWith(
        "text",
        expect.objectContaining({
          name: "我的文本预设",
          preset: {
            OPENAI_BASE_URL: "https://api.openai.com/v1",
            OPENAI_MODEL: "gpt-5.4",
          },
        }),
      );
    });
  });

  it("fetches models from the current text endpoint and fills the selected model id", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue(createSnapshotWithEditableTextPreset());

    render(<SettingsPage />);

    await waitForSettingsHydrated();
    await user.click(await screen.findByRole("button", { name: /获取/i }));

    expect(await screen.findByRole("button", { name: "gpt-4.1" })).toBeInTheDocument();
    expect(listSettingsModels).toHaveBeenCalledWith(
      expect.objectContaining({
        family: "text",
        preset: expect.objectContaining({
          OPENAI_BASE_URL: "https://api.openai.com/v1",
          OPENAI_MODEL: "gpt-5.4",
        }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "gpt-4.1" }));
    expect(screen.getByDisplayValue("gpt-4.1")).toBeInTheDocument();
  });

  it("creates a vision preset without reusing the stale internal image name", async () => {
    const user = userEvent.setup();

    createSettingsPreset.mockResolvedValue(undefined);
    getSettings.mockResolvedValue(createSnapshot());

    render(<SettingsPage />);

    await waitForSettingsHydrated();
    await screen.findByText("图片理解能力");
    await user.click(await screen.findByRole("button", { name: /单独图片模型/i }));
    const createButtons = await screen.findAllByRole("button", { name: /新建图片理解预设|新建预设/i });
    await user.click(createButtons[0]);
    const presetNameInput = screen.getByPlaceholderText("请输入预设名称");
    await user.clear(presetNameInput);
    await user.type(presetNameInput, "我的图片预设");
    await user.click(screen.getByRole("button", { name: /创建并切换|确认/i }));

    await waitFor(() => {
      expect(createSettingsPreset).toHaveBeenCalled();
    });

    const [family, payload] = createSettingsPreset.mock.calls[0];
    expect(family).toBe("vision");
    expect(payload.name).toBe("我的图片预设");
    expect(payload.preset).toEqual({
      IMAGE_ANALYSIS_BASE_URL: "https://host.example/v1",
      IMAGE_ANALYSIS_MODEL: "gpt-4o-mini",
    });
    expect(payload.preset).not.toHaveProperty("IMAGE_ANALYSIS_NAME");
  });

  it("shows launch placement default controls in the launch settings tab", async () => {
    render(<SettingsPage />);

    await clickSettingsCategory("整理策略配置");
    await clickSettingsCategory("放置规则");

    expect(await screen.findByText("默认放置规则")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例如：D:/archive/sorted")).toBeInTheDocument();
    expect(screen.getByText("待确认区跟随新目录位置")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("新目录生成位置/Review")).toBeDisabled();
  });

  it("keeps general organize as the selected default template and applies template suggestions", async () => {
    const user = userEvent.setup();

    render(<SettingsPage />);

    await clickSettingsCategory("整理策略配置");
    expect(await screen.findByRole("button", { name: /通用整理/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /项目资料/ }));
    await user.click(await screen.findByRole("button", { name: "保存当前修改" }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          global_config: expect.objectContaining({
            LAUNCH_DEFAULT_TEMPLATE_ID: "project_workspace",
            LAUNCH_DEFAULT_LANGUAGE: "en",
            LAUNCH_DEFAULT_DENSITY: "normal",
            LAUNCH_DEFAULT_PREFIX_STYLE: "none",
            LAUNCH_DEFAULT_CAUTION_LEVEL: "balanced",
          }),
        }),
      );
    });
  });

  it("manages explicit target directory profiles in the launch settings tab", async () => {
    const user = userEvent.setup();
    getTargetProfiles.mockResolvedValue([
      {
        profile_id: "profile-1",
        name: "工作资料库",
        directories: [{ path: "D:/archive/docs", label: "文档", description: "项目文档" }],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    render(<SettingsPage />);

    await clickSettingsCategory("整理策略配置");
    await clickSettingsCategory("目标目录");

    expect(await screen.findByText("目标目录配置")).toBeInTheDocument();
    expect(screen.getByDisplayValue("工作资料库")).toBeInTheDocument();
    expect(screen.getByText("D:/archive/docs")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("目标目录完整路径"), "D:/archive/media");
    const labelInputs = screen.getAllByPlaceholderText("标签（可选）");
    await user.type(labelInputs[labelInputs.length - 1], "媒体");
    await user.click(screen.getByRole("button", { name: "添加目录" }));
    await user.click(await screen.findByRole("button", { name: "保存当前修改" }));

    await waitFor(() => {
      expect(updateTargetProfile).toHaveBeenCalledWith(
        "profile-1",
        expect.objectContaining({
          name: "工作资料库",
          directories: [
            { path: "D:/archive/docs", label: "文档", description: "项目文档" },
            { path: "D:/archive/media", label: "媒体", description: undefined },
          ],
        }),
      );
    });
  });

  it("shows vision verification result details after running the test", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue(createSnapshotWithEditableVisionPreset());

    render(<SettingsPage />);

    await waitForSettingsHydrated();
    await screen.findByText("图片理解能力");
    await user.click(await screen.findByRole("button", { name: /测试图片理解能力/i }));

    expect(await screen.findByText("图片能力已验证")).toBeInTheDocument();
    expect(screen.getByText('期望结果：VISION TEST 42')).toBeInTheDocument();
    expect(screen.getByText('实际返回：VISION TEST 42')).toBeInTheDocument();
  });

  it("shows vision-specific loading copy while verifying image capability", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue(createSnapshotWithEditableVisionPreset());
    const deferred: { resolve?: (value: SettingsTestResult) => void } = {};
    testSettings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deferred.resolve = resolve;
        }),
    );

    render(<SettingsPage />);

    await waitForSettingsHydrated();
    await screen.findByText("图片理解能力");
    await user.click(await screen.findByRole("button", { name: /测试图片理解能力/i }));

    expect(await screen.findByText("正在验证图片理解能力...")).toBeInTheDocument();
    expect(screen.getByText("图片能力验证")).toBeInTheDocument();

    if (deferred.resolve) {
      deferred.resolve({
        status: "ok",
        family: "vision",
        code: "ok",
        message: '已验证模型能够识别测试图中的 "VISION TEST 42"。',
        details: {
          verification_type: "vision_text",
          expected: "VISION TEST 42",
          actual: "VISION TEST 42",
        },
      });
    }

    await waitFor(() => {
      expect(screen.queryByText("正在验证图片理解能力...")).not.toBeInTheDocument();
    });
  });

  it("keeps connection test failures inside the related test panel", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue(createSnapshotWithEditableVisionPreset());
    testSettings.mockRejectedValueOnce(new Error("HTTP 504 Gateway Timeout"));

    render(<SettingsPage />);

    await waitForSettingsHydrated();
    await screen.findByText("图片理解能力");
    await user.click(await screen.findByRole("button", { name: /测试图片理解能力/i }));

    expect(await screen.findByText("图片能力验证失败")).toBeInTheDocument();
    expect(screen.getByText("HTTP 504 Gateway Timeout")).toBeInTheDocument();
    expect(screen.getByText(/远端服务响应超时/)).toBeInTheDocument();
    expect(screen.queryByText("操作执行失败")).not.toBeInTheDocument();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the requested settings tab from the query string", async () => {
    currentSearchParams = new URLSearchParams("tab=icon_image");

    render(<SettingsPage />);

    await waitForSettingsHydrated();
    expect(await screen.findByText("双模型依赖")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /新建图标生图预设|新建预设/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /新建文本预设/i })).not.toBeInTheDocument();
  });

  it("maps the legacy vision tab query to the merged text settings page", async () => {
    currentSearchParams = new URLSearchParams("tab=vision");

    render(<SettingsPage />);

    expect(await screen.findByText("图片理解能力")).toBeInTheDocument();
    expect(screen.getByText("当前来源")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试图片理解能力" })).toBeInTheDocument();
  });
});
