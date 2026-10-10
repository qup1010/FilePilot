import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

import i18n from "@/i18n/instance";

afterEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", {
    value: () => {},
    writable: true,
  });
}
