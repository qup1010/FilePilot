import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OneClickPanel } from "./one-click-panel";
import type { TargetProfile } from "@/types/session";

const pushMock = vi.fn();
const getTargetProfilesMock = vi.fn();
const createSessionMock = vi.fn();
const selectDirMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({
    getTargetProfiles: getTargetProfilesMock,
    createSession: createSessionMock,
    selectDir: selectDirMock,
  }),
}));

vi.mock("@/lib/runtime", () => ({
  getApiBaseUrl: () => "http://localhost:8765",
  getApiToken: () => "",
}));

function profileWith(descriptions: string[]): TargetProfile {
  return {
    profile_id: "p1",
    name: "常用目录",
    directories: descriptions.map((description, index) => ({
      path: `D:/archive/dir${index}`,
      label: `目录${index}`,
      description,
    })),
    created_at: "2026-07-26T00:00:00+00:00",
    updated_at: "2026-07-26T00:00:00+00:00",
  };
}

describe("OneClickPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("guides to rules page when no profile exists", async () => {
    getTargetProfilesMock.mockResolvedValue([]);

    render(<OneClickPanel />);

    expect(await screen.findByText("先建立你的目录规则，就能一键整理")).toBeInTheDocument();
    expect(screen.getByText("去写规则")).toBeInTheDocument();
  });

  it("guides to rules page when rules are incomplete", async () => {
    getTargetProfilesMock.mockResolvedValue([profileWith(["PDF 手册", ""])]);

    render(<OneClickPanel />);

    expect(await screen.findByText("补全目录规则后即可一键整理")).toBeInTheDocument();
  });

  it("launches an unattended session for a rule-complete profile", async () => {
    getTargetProfilesMock.mockResolvedValue([profileWith(["PDF 手册", "安装包"])]);
    selectDirMock.mockResolvedValue({ path: "D:/Downloads" });
    createSessionMock.mockResolvedValue({ mode: "created", session_id: "s1" });

    render(<OneClickPanel />);

    fireEvent.click(await screen.findByText("选择目录"));
    await waitFor(() => expect(screen.getByText("Downloads")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "一键整理" }));

    await waitFor(() => expect(createSessionMock).toHaveBeenCalled());
    const payload = createSessionMock.mock.calls[0][0];
    expect(payload.unattended).toBe(true);
    expect(payload.organize_method).toBe("assign_into_existing_categories");
    expect(payload.target_profile_id).toBe("p1");
    expect(payload.sources[0].path).toBe("D:/Downloads");
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(String(pushMock.mock.calls[0][0])).toContain("/workspace/progress");
  });

  it("shows rules guidance when backend blocks empty rules", async () => {
    getTargetProfilesMock.mockResolvedValue([profileWith(["PDF 手册"])]);
    selectDirMock.mockResolvedValue({ path: "D:/Downloads" });
    createSessionMock.mockRejectedValue(new Error("TARGET_RULES_INCOMPLETE"));

    render(<OneClickPanel />);

    fireEvent.click(await screen.findByText("选择目录"));
    await waitFor(() => expect(screen.getByText("Downloads")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "一键整理" }));

    expect(await screen.findByText("这组目录还有规则没写完，请先到「分类规则」补全。")).toBeInTheDocument();
  });
});
