import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/lib/api";
import i18n from "@/i18n/instance";
import { FileHistorySearch } from "./file-history-search";

describe("FileHistorySearch localization", () => {
  it("renders the English search prompt", async () => {
    await i18n.changeLanguage("en");
    const api = {
      searchFileHistory: vi.fn(),
      openDir: vi.fn(),
    } as unknown as Pick<ApiClient, "searchFileHistory" | "openDir">;

    render(<FileHistorySearch api={api} onSelectExecution={vi.fn()} />);

    expect(screen.getByPlaceholderText("Find a file: enter part of its name to see where it is now...")).toBeInTheDocument();
  });
});
