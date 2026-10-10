import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/i18n/instance";
import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog localization", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("zh-CN");
  });

  it("translates default actions and the verification prompt", async () => {
    await i18n.changeLanguage("en");

    render(
      <ConfirmDialog
        open
        title="Delete item?"
        description="This action cannot be undone."
        verificationText="DELETE"
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Type DELETE")).toBeInTheDocument();
    expect(screen.getByText(/To confirm this action, type/)).toBeInTheDocument();
  });
});
