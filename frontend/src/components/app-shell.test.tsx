import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n/instance";
import { AppShell, isSuccessfulModuleStatus } from "./app-shell";

const searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/rules",
  useSearchParams: () => searchParams,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("motion/react", () => ({
  motion: {
    span: ({ children, ...props }: React.ComponentProps<"span">) => <span {...props}>{children}</span>,
  },
}));

vi.mock("@/components/page-transition", () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/global-task-indicator", () => ({
  GlobalTaskIndicator: () => null,
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ mode: "light", setMode: vi.fn() }),
}));

describe("AppShell localization", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("zh-CN");
  });

  it("updates navigation, module labels, and theme controls when the active language changes", async () => {
    await i18n.changeLanguage("zh-CN");

    render(<AppShell><div>Page body</div></AppShell>);
    expect(await screen.findByRole("link", { name: "分类规则" })).toBeInTheDocument();
    await i18n.changeLanguage("en");

    await waitFor(() => expect(screen.getAllByText("Organization rules")).toHaveLength(2));
    expect(screen.getByRole("link", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTitle("Current: Light. Click to switch.")).toBeInTheDocument());
  });

  it("uses the stage code rather than translated status copy for success styling", () => {
    expect(isSuccessfulModuleStatus("Safety check passed", "ready_to_execute")).toBe(true);
    expect(isSuccessfulModuleStatus("Safety check passed", "planning")).toBe(false);
    expect(isSuccessfulModuleStatus("检查已通过")).toBe(true);
  });
});
