import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/i18n/instance";
import { ErrorAlert } from "./error-alert";

describe("ErrorAlert localization", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("zh-CN");
  });

  it("translates its default title and dismiss label", async () => {
    await i18n.changeLanguage("en");
    render(<ErrorAlert message="Request failed" onClose={() => {}} />);

    expect(screen.getByText("The operation was interrupted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});
