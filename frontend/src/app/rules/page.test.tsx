import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n/instance";
import RulesPage from "./page";

const getTargetProfilesMock = vi.fn();
const getSettingsMock = vi.fn();

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({
    getTargetProfiles: getTargetProfilesMock,
    getSettings: getSettingsMock,
  }),
}));

vi.mock("@/lib/runtime", () => ({
  getApiBaseUrl: () => "http://127.0.0.1:8765",
  getApiToken: () => "",
  isTauriDesktop: () => false,
}));

vi.mock("@/lib/tauri-drag-drop", () => ({
  findDropZoneForPosition: () => null,
  isTauriDragDropPayload: () => false,
  isTauriDragLeavePayload: () => false,
  isTauriDragOverPayload: () => false,
  listenToTauriDragDrop: () => Promise.resolve(() => {}),
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }: React.ComponentProps<"div"> & Record<string, unknown>) => <div {...props}>{children}</div>,
  },
}));

describe("organization rules localization", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    getTargetProfilesMock.mockResolvedValue([
      {
        profile_id: "profile-1",
        name: "Work library",
        directories: [{ path: "D:/Archive/Documents", label: "Documents", description: "" }],
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      },
    ]);
    getSettingsMock.mockResolvedValue({ global_config: { LAUNCH_DEFAULT_TARGET_PROFILE_ID: "profile-1" } });
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("zh-CN");
  });

  it("localizes rule management while preserving the selected rule text across language changes", async () => {
    render(<RulesPage />);

    expect(await screen.findByRole("heading", { name: "Organization rules" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add folder" })).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText(/Describe the files that belong here/);
    fireEvent.click(screen.getByRole("button", { name: "+ Documents" }));
    await waitFor(() => expect(textarea).toHaveValue("Office documents, PDFs, reports, and other text or data files."));

    await i18n.changeLanguage("zh-CN");

    expect(await screen.findByRole("heading", { name: "分类规则" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加目录" })).toBeInTheDocument();
    expect(textarea).toHaveValue("Office documents, PDFs, reports, and other text or data files.");
  });
});
