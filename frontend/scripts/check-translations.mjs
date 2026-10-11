import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/u;
const PLACEHOLDER = /\{\{\s*-?\s*([\w.-]+)(?:\s*,\s*[^{}]*)?\s*\}\}/gu;
const SUPPORTED_CATEGORIES = {
  en: new Set(["zero", "one", "other"]),
  "zh-CN": new Set(["zero", "other"]),
};
const REQUIRED_CATEGORIES = {
  en: new Set(["one", "other"]),
  "zh-CN": new Set(["other"]),
};

const DIAGNOSTIC_MAPS = [
  { file: "src/lib/user-facing-copy.ts", name: "REQUEST_ERROR_COPY_KEYS", prefix: "diagnostics.http." },
  { file: "src/lib/user-facing-copy.ts", name: "NATIVE_COMMAND_COPY_KEYS", prefix: "" },
  { file: "src/lib/user-facing-copy.ts", name: "codeKeys", prefix: "diagnostics.sessionErrors." },
  { file: "src/lib/user-facing-copy.ts", name: "stageKeys", prefix: "diagnostics.sessionErrors." },
  { file: "src/lib/scanner-progress-view.ts", name: "messageKeys", prefix: "" },
  { file: "src/components/workspace/completion-view.tsx", name: "codeKeys", prefix: "" },
  { file: "src/i18n/diagnostics.ts", name: "SETTINGS_TEST_ERROR_KEYS", prefix: "diagnostics.settingsTests.errors." },
  { file: "src/i18n/diagnostics.ts", name: "SETTINGS_TEST_ISSUE_KEYS", prefix: "diagnostics.settingsTests.issues." },
];

const DYNAMIC_DIAGNOSTIC_KEYS = [
  "diagnostics.settingsTests.success.text",
  "diagnostics.settingsTests.success.vision",
  "diagnostics.settingsTests.success.icon_image",
  "diagnostics.settingsTests.errors.incompleteTextConfig",
  "diagnostics.settingsTests.errors.incompleteVisionConfig",
  "diagnostics.settingsTests.errors.incompleteIconConfig",
  "diagnostics.settingsTests.errors.requestFailed",
  "diagnostics.settingsTests.issues.default",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flattenResource(value, prefix = "", entries = [], errors = [], locale = "resource") {
  if (typeof value === "string") {
    if (!prefix) errors.push(`${locale}: translation keys cannot be empty`);
    else entries.push([prefix, value]);
    return { entries, errors };
  }

  if (!isRecord(value)) {
    errors.push(`${locale}: ${prefix || "<root>"} must contain a string or an object`);
    return { entries, errors };
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    flattenResource(child, childPath, entries, errors, locale);
  }
  return { entries, errors };
}

function groupResourceEntries(entries) {
  const groups = new Map();
  for (const [fullKey, value] of entries) {
    const parts = fullKey.split(".");
    const leaf = parts.at(-1);
    const suffix = leaf.match(PLURAL_SUFFIX);
    const category = suffix?.[1] ?? "base";
    if (suffix) parts[parts.length - 1] = leaf.slice(0, -suffix[0].length);
    const key = parts.join(".");
    const group = groups.get(key) ?? [];
    group.push({ category, fullKey, value });
    groups.set(key, group);
  }
  return groups;
}

function placeholderNames(value) {
  return [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validatePluralGroup(key, englishEntries, chineseEntries, errors) {
  const categoriesByLocale = new Map();
  for (const [locale, entries] of [["en", englishEntries], ["zh-CN", chineseEntries]]) {
    const categories = entries.map((entry) => entry.category);
    const hasSuffix = categories.some((category) => category !== "base");
    if (hasSuffix && categories.includes("base")) {
      errors.push(`${locale}: ${key} mixes a base key with plural-suffixed keys`);
    }
    if (new Set(categories).size !== categories.length) {
      errors.push(`${locale}: ${key} contains duplicate plural categories`);
    }

    const effectiveCategories = new Set(categories.map((category) => category === "base" ? "other" : category));
    for (const category of effectiveCategories) {
      if (!SUPPORTED_CATEGORIES[locale].has(category)) {
        errors.push(`${locale}: ${key} uses unsupported plural category "${category}"`);
      }
    }
    for (const required of REQUIRED_CATEGORIES[locale]) {
      if (!effectiveCategories.has(required)) {
        errors.push(`${locale}: ${key} is missing required plural category "${required}"`);
      }
    }
    categoriesByLocale.set(locale, effectiveCategories);
  }

  const englishCategories = categoriesByLocale.get("en");
  const chineseCategories = categoriesByLocale.get("zh-CN");
  if (englishCategories.has("zero") !== chineseCategories.has("zero")) {
    errors.push(`${key}: the optional zero category must be present in both languages or neither`);
  }

  for (const englishEntry of englishEntries) {
    const chineseEntry = chineseEntries.find((entry) => entry.category === englishEntry.category)
      ?? (englishEntry.category === "zero"
        ? undefined
        : chineseEntries.find((entry) => entry.category === "base" || entry.category === "other"));
    if (!chineseEntry) continue;
    if (!sameValues(placeholderNames(englishEntry.value), placeholderNames(chineseEntry.value))) {
      errors.push(`${key} (${englishEntry.category}): interpolation parameters differ between en and zh-CN`);
    }
  }

  for (const chineseEntry of chineseEntries) {
    if (chineseEntry.category !== "zero") continue;
    const englishZero = englishEntries.find((entry) => entry.category === "zero");
    if (englishZero && !sameValues(placeholderNames(chineseEntry.value), placeholderNames(englishZero.value))) {
      errors.push(`${key} (zero): interpolation parameters differ between zh-CN and en`);
    }
  }
}

export function validateLocalePair(english, chinese) {
  const errors = [];
  const flattened = {
    en: flattenResource(english, "", [], errors, "en"),
    "zh-CN": flattenResource(chinese, "", [], errors, "zh-CN"),
  };
  const groups = {
    en: groupResourceEntries(flattened.en.entries),
    "zh-CN": groupResourceEntries(flattened["zh-CN"].entries),
  };
  const allKeys = new Set([...groups.en.keys(), ...groups["zh-CN"].keys()]);

  for (const key of allKeys) {
    const englishEntries = groups.en.get(key);
    const chineseEntries = groups["zh-CN"].get(key);
    if (!englishEntries) {
      errors.push(`zh-CN: ${key} has no English translation`);
      continue;
    }
    if (!chineseEntries) {
      errors.push(`en: ${key} has no Simplified Chinese translation`);
      continue;
    }

    const pluralized = [...englishEntries, ...chineseEntries].some((entry) => entry.category !== "base");
    if (pluralized) {
      validatePluralGroup(key, englishEntries, chineseEntries, errors);
      continue;
    }

    if (englishEntries.length !== 1 || chineseEntries.length !== 1) {
      errors.push(`${key}: duplicate base translation entries`);
      continue;
    }
    if (!sameValues(placeholderNames(englishEntries[0].value), placeholderNames(chineseEntries[0].value))) {
      errors.push(`${key}: interpolation parameters differ between en and zh-CN`);
    }
  }

  return errors;
}

function readLocaleFile(locale) {
  const file = path.join(FRONTEND_DIRECTORY, "src", "i18n", "resources", locale, "common.json");
  const buffer = fs.readFileSync(file);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    throw new Error(`${path.relative(FRONTEND_DIRECTORY, file)} has a UTF-8 BOM`);
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${path.relative(FRONTEND_DIRECTORY, file)} is not valid UTF-8`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path.relative(FRONTEND_DIRECTORY, file)} is not valid JSON: ${error.message}`);
  }
}

function readStringMap(file, name) {
  const source = fs.readFileSync(path.join(FRONTEND_DIRECTORY, file), "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (!declaration || !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) {
    throw new Error(`${file}: could not find a static object map named ${name}`);
  }

  const values = [];
  for (const property of declaration.initializer.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) {
      throw new Error(`${file}: ${name} must contain only static string values`);
    }
    values.push(property.initializer.text);
  }
  return values;
}

function validateDiagnosticMappings(groups, errors) {
  const translationKeys = new Set([...groups.en.keys(), ...groups["zh-CN"].keys()]);
  for (const mapping of DIAGNOSTIC_MAPS) {
    let values;
    try {
      values = readStringMap(mapping.file, mapping.name);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    for (const value of values) {
      const key = `${mapping.prefix}${value}`;
      if (!translationKeys.has(key)) {
        errors.push(`${mapping.file}: diagnostic mapping ${mapping.name} references missing translation key ${key}`);
      }
    }
  }

  for (const key of DYNAMIC_DIAGNOSTIC_KEYS) {
    if (!translationKeys.has(key)) errors.push(`diagnostic code path references missing translation key ${key}`);
  }
}

export function checkTranslations() {
  const errors = [];
  let english;
  let chinese;
  try {
    english = readLocaleFile("en");
    chinese = readLocaleFile("zh-CN");
  } catch (error) {
    return [error.message];
  }

  const resourceErrors = validateLocalePair(english, chinese);
  errors.push(...resourceErrors);
  const groups = {
    en: groupResourceEntries(flattenResource(english).entries),
    "zh-CN": groupResourceEntries(flattenResource(chinese).entries),
  };
  validateDiagnosticMappings(groups, errors);
  return errors;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const errors = checkTranslations();
  if (errors.length) {
    console.error(`Translation resource check failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Translation resources passed: keys, plural categories, interpolation parameters, diagnostic mappings, and UTF-8 encoding are valid.");
  }
}
