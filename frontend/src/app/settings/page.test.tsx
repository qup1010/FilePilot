import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/lib/api";
import type { SettingsSnapshot } from "@/types/settings";

import SettingsPage from "./page";

const getSettings = vi.fn<() => Promise<SettingsSnapshot>>();
const createSettingsPreset = vi.fn();

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
    button: ({ children, whileTap: _whileTap, ...props }: React.ComponentProps<"button"> & { whileTap?: unknown }) => (
      <button {...props}>{children}</button>
    ),
  },
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
      updateSettings: vi.fn(),
      activateSettingsPreset: vi.fn(),
      deleteSettingsPreset: vi.fn(),
      testSettings: vi.fn(),
    }) satisfies Partial<ApiClient>,
}));

function createSnapshot(): SettingsSnapshot {
  return {
    global_config: {
      IMAGE_ANALYSIS_ENABLED: true,
      LAUNCH_DEFAULT_TEMPLATE_ID: "general_downloads",
      DEBUG_MODE: false,
    },
    families: {
      text: {
        family: "text",
        configured: false,
        active_preset_id: "default",
        active_preset: {
          id: "default",
          name: "默认文本模型",
          OPENAI_BASE_URL: "https://api.openai.com/v1",
          OPENAI_MODEL: "gpt-5.4",
          secret_state: "empty",
        },
        presets: [
          {
            id: "default",
            name: "默认文本模型",
            OPENAI_BASE_URL: "https://api.openai.com/v1",
            OPENAI_MODEL: "gpt-5.4",
            secret_state: "empty",
          },
        ],
      },
      vision: {
        family: "vision",
        enabled: true,
        configured: false,
        active_preset_id: "default",
        active_preset: {
          id: "default",
          name: "默认图片理解",
          IMAGE_ANALYSIS_NAME: "默认图片理解",
          IMAGE_ANALYSIS_BASE_URL: "https://host.example/v1",
          IMAGE_ANALYSIS_MODEL: "gpt-4o-mini",
          secret_state: "empty",
        },
        presets: [
          {
            id: "default",
            name: "默认图片理解",
            IMAGE_ANALYSIS_NAME: "默认图片理解",
            IMAGE_ANALYSIS_BASE_URL: "https://host.example/v1",
            IMAGE_ANALYSIS_MODEL: "gpt-4o-mini",
            secret_state: "empty",
          },
        ],
      },
      icon_image: {
        family: "icon_image",
        configured: false,
        active_preset_id: "default",
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
        presets: [
          {
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
          },
        ],
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
  };
}

describe("SettingsPage preset flow", () => {
  beforeEach(() => {
    getSettings.mockReset();
    createSettingsPreset.mockReset();
    getSettings.mockResolvedValue(createSnapshot());
  });

  it("shows an empty-state prompt instead of editing the default text preset", async () => {
    render(<SettingsPage />);

    expect(await screen.findByText("请先点击 + 创建一个预设")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("gpt-5.4")).not.toBeInTheDocument();
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
    const presetNameInput = screen.getByRole("textbox");
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
});
