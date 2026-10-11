import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "@/i18n/instance";
import { ExecutionProgressView } from "./execution-progress-view";

describe("ExecutionProgressView localization", () => {
  it("renders English progress and safety copy", async () => {
    await i18n.changeLanguage("en");

    render(<ExecutionProgressView mode="executing" />);

    expect(screen.getByRole("heading", { name: "Organizing files" })).toBeInTheDocument();
    expect(screen.getByText("Writing files to target folders")).toBeInTheDocument();
  });
});
