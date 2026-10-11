import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "./resources/en/common.json";
import zhCNCommon from "./resources/zh-CN/common.json";

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { common: zhCNCommon },
    en: { common: enCommon },
  },
  lng: "zh-CN",
  fallbackLng: "zh-CN",
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
  returnEmptyString: false,
});

export default i18n;
