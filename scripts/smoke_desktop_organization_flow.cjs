const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");

const requireFrontend = createRequire(path.join(__dirname, "..", "frontend", "package.json"));
const WebSocket = requireFrontend("ws");
const debugPort = Number(process.argv[2]);
const testRoot = path.resolve(process.argv[3] || "");
const runnerTemp = path.resolve(process.env.RUNNER_TEMP || "");
const modelCalls = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertWithin(child, parent, label) {
  const relative = path.relative(parent, child);
  assert(relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`),
    `${label} must be a new child of its isolated parent.`);
}

function chatCompletion(toolName, args, content) {
  const nonce = `${Date.now()}-${modelCalls.length}`;
  return {
    id: `chatcmpl-filepilot-smoke-${nonce}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "filepilot-installed-smoke",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content,
        tool_calls: [{
          id: `call-filepilot-smoke-${nonce}`,
          type: "function",
          function: { name: toolName, arguments: JSON.stringify(args) },
        }],
      },
      finish_reason: "tool_calls",
    }],
  };
}

function parsePromptCatalog(messages, planning) {
  const system = String(messages?.find((message) => message.role === "system")?.content || "");
  const rowPattern = planning
    ? /^([A-Z]\d{3})\s*\|\s*(file|dir)\s*\|\s*([^|]+)\s*\|/gm
    : /^([A-Z]\d{3})\s*\|\s*([^|]+)\s*\|\s*(file|dir)\s*$/gm;
  const entries = [];
  for (const match of system.matchAll(rowPattern)) {
    entries.push(planning
      ? { item_id: match[1], entry_type: match[2], display_name: match[3].trim() }
      : { entry_id: match[1], display_name: match[2].trim(), entry_type: match[3] });
  }
  return { system, entries };
}

const mockModel = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end("not found");
    return;
  }

  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    modelCalls.push(payload);
    const toolNames = (payload.tools || []).map((tool) => tool.function?.name);
    const planning = toolNames.includes("submit_plan_diff");
    const { system, entries } = parsePromptCatalog(payload.messages, planning);
    assert(entries.length > 0, "The installed app sent a prompt without catalog entries.");

    let result;
    if (planning) {
      const english = system.includes("Write all user-facing natural-language replies in English");
      result = chatCompletion("submit_plan_diff", {
        directory_renames: [],
        move_updates: entries.map((entry) => ({
          item_id: entry.item_id,
          target_dir: entry.display_name === "Blocked.txt" ? "BlockedTarget" : (english ? "Documents" : "文档"),
        })),
        unresolved_adds: [],
        unresolved_removals: [],
      }, english ? "I grouped the scanned files into Documents." : "我已将扫描文件归入文档。");
    } else if (toolNames.includes("submit_analysis_result")) {
      const english = system.includes("Write all generated suggested_purpose values and summaries in English.");
      result = chatCompletion("submit_analysis_result", {
        items: entries.map((entry) => ({
          entry_id: entry.entry_id,
          entry_type: entry.entry_type,
          suggested_purpose: english ? "Reference documents" : "参考资料",
          summary: english ? "A file identified from its supplied filename." : "根据文件名识别的文件。",
        })),
      }, english ? "I summarized the scanned entries." : "我已总结扫描条目。");
    } else {
      throw new Error(`Unexpected model tools: ${toolNames.join(", ")}`);
    }

    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error.message }));
  }
});

function cdpCommand(socketUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out waiting for ${method}.`));
    }, 15000);
    socket.on("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    socket.on("error", reject);
  });
}

async function cdpEvaluate(socketUrl, expression) {
  const result = await cdpCommand(socketUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitForRuntime() {
  const deadline = Date.now() + 60000;
  let targets = [];
  let lastProbe = "No matching WebView2 page target was found.";
  let lastCommandProbe = 0;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (!response.ok) throw new Error(`WebView2 DevTools returned HTTP ${response.status}.`);
      targets = await response.json();
      const page = targets.find((target) => {
        if (target.type !== "page") return false;
        try {
          return new URL(target.url).hostname === "tauri.localhost";
        } catch {
          return false;
        }
      });
      if (page) {
        const injected = await cdpEvaluate(page.webSocketDebuggerUrl,
          "JSON.stringify(window.__FILE_PILOT_RUNTIME__?.base_url ? window.__FILE_PILOT_RUNTIME__ : null)");
        if (injected && injected !== "null") {
          return { page, runtime: JSON.parse(injected), source: "window injection" };
        }

        if (Date.now() - lastCommandProbe >= 1000) {
          lastCommandProbe = Date.now();
          const commandResult = await cdpEvaluate(page.webSocketDebuggerUrl,
            "JSON.stringify(await (async () => { try { const runtime = await window.__TAURI_INTERNALS__?.invoke?.('get_runtime_config'); return runtime?.base_url ? { available: true, runtime } : { available: false, reason: 'Tauri command returned no runtime config' }; } catch (error) { return { available: false, reason: String(error) }; } })())");
          const probe = JSON.parse(commandResult || "null");
          if (probe?.available) {
            return { page, runtime: probe.runtime, source: "Tauri get_runtime_config command" };
          }
          lastProbe = probe?.reason || "Neither runtime injection nor the Tauri runtime command is available yet.";
        }
      }
    } catch (error) {
      lastProbe = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const targetSummary = targets
    .map((target) => `${target.type}: ${target.url || target.title || "<no URL>"}`)
    .join("; ") || "<none>";
  throw new Error(`The installed app did not expose its backend runtime to the WebView. Last probe: ${lastProbe}. DevTools targets: ${targetSummary}`);
}

async function api(runtime, route, options = {}) {
  const response = await fetch(`${runtime.base_url}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${runtime.api_token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : null; } catch { result = text; }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${route} returned ${response.status}: ${JSON.stringify(result).slice(0, 1000)}`);
  }
  return result;
}

async function post(runtime, route, payload = {}) {
  return api(runtime, route, { method: "POST", body: JSON.stringify(payload) });
}

async function waitForPlan(runtime, sessionId, expectedCount, locale) {
  const deadline = Date.now() + 120000;
  let lastSnapshot;
  while (Date.now() < deadline) {
    const result = await api(runtime, `/api/sessions/${encodeURIComponent(sessionId)}`);
    lastSnapshot = result.session_snapshot;
    if (lastSnapshot.plan_snapshot?.items?.length === expectedCount && lastSnapshot.plan_snapshot?.readiness?.can_precheck) {
      return lastSnapshot;
    }
    if (["failed", "abandoned", "interrupted"].includes(lastSnapshot.stage)) {
      throw new Error(`${locale} scan/planning ended in ${lastSnapshot.stage}: ${JSON.stringify(lastSnapshot.last_error_code || "")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${locale} plan timed out with ${lastSnapshot?.plan_snapshot?.items?.length || 0} items.`);
}

function createLongFilename(output, targetDir) {
  const targetParent = path.join(output, targetDir);
  const componentLength = Math.min(220, 232 - targetParent.length - 1);
  assert(componentLength >= 32 && componentLength <= 255,
    "RUNNER_TEMP leaves too little room for the long-path smoke fixture.");
  const name = `${"L".repeat(componentLength - 4)}.txt`;
  const targetPath = path.join(targetParent, name);
  assert(targetPath.length >= 200 && targetPath.length < 260,
    `Long-path fixture must stay below MAX_PATH while exceeding 200 characters (got ${targetPath.length}).`);
  return name;
}

async function createSession(runtime, { locale, source, output, expectedCount }) {
  const strategy = {
    template_id: "general_downloads",
    organize_mode: "initial",
    task_type: "organize_full_directory",
    organize_method: "categorize_into_new_structure",
    destination_index_depth: 1,
    language: locale === "en" ? "en" : "zh",
    density: "normal",
    prefix_style: "none",
    caution_level: "balanced",
    output_dir: output,
    new_directory_root: output,
    note: "",
  };
  const created = await post(runtime, "/api/sessions", {
    sources: [{ source_type: "directory", path: source, directory_mode: "contents" }],
    content_locale: locale,
    organize_method: "categorize_into_new_structure",
    output_dir: output,
    new_directory_root: output,
    strategy,
  });
  assert(created.session_id, `Could not create a ${locale} organization session.`);
  await post(runtime, `/api/sessions/${encodeURIComponent(created.session_id)}/scan`);
  await waitForPlan(runtime, created.session_id, expectedCount, locale);
  return created.session_id;
}

async function prepareFixture(source, output, locale) {
  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  const targetDir = locale === "en" ? "Documents" : "文档";
  const entries = new Map([
    ["Agreement.txt", "Local disposable fixture: agreement sample.\n"],
    ["合同.txt", "本地临时测试文件：合同样例。\n"],
    [createLongFilename(output, targetDir), "Local disposable fixture for a long path.\n"],
  ]);
  for (const [name, contents] of entries) await fs.writeFile(path.join(source, name), contents, "utf8");
  return { entries, targetDir };
}

async function executeAndRollback(runtime, sessionId, source, output, { entries, targetDir }) {
  const prechecked = await post(runtime, `/api/sessions/${encodeURIComponent(sessionId)}/precheck`);
  assert(prechecked.session_snapshot?.stage === "ready_to_execute" && prechecked.session_snapshot?.precheck_summary?.can_execute,
    `Precheck did not permit execution: ${JSON.stringify(prechecked.session_snapshot?.precheck_summary).slice(0, 1000)}`);

  const executed = await post(runtime, `/api/sessions/${encodeURIComponent(sessionId)}/execute`, { confirm: true });
  assert(executed.session_snapshot?.stage === "completed", `Execution ended in ${executed.session_snapshot?.stage}.`);
  for (const [name, contents] of entries) {
    assert(!(await fs.stat(path.join(source, name)).catch(() => null)), `Source still exists after move: ${name}`);
    assert(await fs.readFile(path.join(output, targetDir, name), "utf8") === contents, `Moved content changed: ${name}`);
  }

  const rollbackPreview = await post(runtime, `/api/sessions/${encodeURIComponent(sessionId)}/rollback`, { confirm: false });
  assert(rollbackPreview.rollback_precheck?.can_execute, "Rollback precheck did not allow restoration.");
  const rollback = await post(runtime, `/api/sessions/${encodeURIComponent(sessionId)}/rollback`, { confirm: true });
  assert(rollback.session_snapshot?.rollback_report?.failure_count === 0, "Rollback reported a failure.");
  for (const [name, contents] of entries) {
    assert(await fs.readFile(path.join(source, name), "utf8") === contents, `Rollback did not restore ${name}.`);
    assert(!(await fs.stat(path.join(output, targetDir, name)).catch(() => null)), `Rollback left ${name} in the target.`);
  }
  return { movedAndRestored: entries.size };
}

async function runLocaleScenario(runtime, testRoot, locale) {
  const source = path.join(testRoot, `${locale}-source`);
  const output = path.join(testRoot, `${locale}-output`);
  const fixture = await prepareFixture(source, output, locale);
  const sessionId = await createSession(runtime, { locale, source, output, expectedCount: fixture.entries.size });
  const result = await executeAndRollback(runtime, sessionId, source, output, fixture);
  return { locale, ...result };
}

async function runTargetConflictScenario(runtime, testRoot) {
  const locale = "en";
  const source = path.join(testRoot, "target-conflict-source");
  const output = path.join(testRoot, "target-conflict-output");
  await fs.mkdir(source, { recursive: true });
  const targetDir = "Documents";
  const entries = new Map([
    ["Agreement.txt", "Incoming agreement.\n"],
    ["合同.txt", "Incoming contract.\n"],
  ]);
  for (const [name, contents] of entries) await fs.writeFile(path.join(source, name), contents, "utf8");
  const existingTargetContents = "Pre-existing target must not be overwritten.\n";
  await fs.mkdir(path.join(output, targetDir), { recursive: true });
  await fs.writeFile(path.join(output, targetDir, "Agreement.txt"), existingTargetContents, "utf8");

  const sessionId = await createSession(runtime, { locale, source, output, expectedCount: entries.size });
  const prechecked = await post(runtime, `/api/sessions/${encodeURIComponent(sessionId)}/precheck`);
  const summary = prechecked.session_snapshot?.precheck_summary;
  assert(summary?.can_execute, "A single occupied target blocked unrelated safe moves.");
  assert(summary.item_skips?.some((item) => item.reason === "target_exists" && item.display_name === "Agreement.txt"),
    "Precheck did not identify the existing same-name target.");

  const executed = await post(runtime, `/api/sessions/${encodeURIComponent(sessionId)}/execute`, { confirm: true });
  assert(executed.session_snapshot?.stage === "completed", "Execution did not complete with a target-name conflict.");
  assert(executed.session_snapshot?.execution_report?.success_count >= 1, "The unblocked file was not moved.");
  assert(executed.session_snapshot?.execution_report?.skipped_count === 1, "The conflicting file was not safely skipped.");
  assert(await fs.readFile(path.join(output, targetDir, "Agreement.txt"), "utf8") === existingTargetContents,
    "The existing same-name target was overwritten.");
  assert(await fs.readFile(path.join(source, "Agreement.txt"), "utf8") === entries.get("Agreement.txt"),
    "The conflicting source file did not remain in place.");
  assert(await fs.readFile(path.join(output, targetDir, "合同.txt"), "utf8") === entries.get("合同.txt"),
    "The unrelated safe file was not moved.");

  const rollbackPreview = await post(runtime, `/api/sessions/${encodeURIComponent(sessionId)}/rollback`, { confirm: false });
  assert(rollbackPreview.rollback_precheck?.can_execute, "Conflict-scenario rollback precheck did not allow restoration.");
  const rollback = await post(runtime, `/api/sessions/${encodeURIComponent(sessionId)}/rollback`, { confirm: true });
  assert(rollback.session_snapshot?.rollback_report?.failure_count === 0, "Conflict-scenario rollback reported a failure.");
  assert(await fs.readFile(path.join(source, "合同.txt"), "utf8") === entries.get("合同.txt"), "Rollback did not restore the moved file.");
  assert(!(await fs.stat(path.join(output, targetDir, "合同.txt")).catch(() => null)), "Rollback left the moved file in the output.");
  assert(await fs.readFile(path.join(output, targetDir, "Agreement.txt"), "utf8") === existingTargetContents,
    "Rollback changed the pre-existing target.");
  return { targetConflict: "preserved", unrelatedMove: "completed", rollback: "passed" };
}

async function runPartialFailureScenario(runtime, testRoot) {
  const locale = "en";
  const source = path.join(testRoot, "partial-failure-source");
  const output = path.join(testRoot, "partial-failure-output");
  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  const entries = new Map([
    ["Blocked.txt", "This file targets an invalid directory path.\n"],
    ["Movable.txt", "This file should still move successfully.\n"],
  ]);
  for (const [name, contents] of entries) await fs.writeFile(path.join(source, name), contents, "utf8");
  const blockerContents = "A file occupies the planned directory path.\n";
  await fs.writeFile(path.join(output, "BlockedTarget"), blockerContents, "utf8");
  const sessionId = await createSession(runtime, { locale, source, output, expectedCount: entries.size });
  const prechecked = await post(runtime, `/api/sessions/${encodeURIComponent(sessionId)}/precheck`);
  assert(prechecked.session_snapshot?.precheck_summary?.can_execute, "Partial-failure precheck did not allow the valid plan.");

  const executed = await post(runtime, `/api/sessions/${encodeURIComponent(sessionId)}/execute`, { confirm: true });
  const report = executed.session_snapshot?.execution_report;
  assert(executed.session_snapshot?.stage === "completed", "Partial-failure execution did not finish its journal.");
  assert(report?.status === "partial_failure" && report.failure_count >= 1 && report.success_count >= 1,
    `Expected one failed move and at least one success: ${JSON.stringify(report)}`);
  assert(await fs.readFile(path.join(source, "Blocked.txt"), "utf8") === entries.get("Blocked.txt"),
    "The failed source file was not preserved.");
  assert(await fs.readFile(path.join(output, "Documents", "Movable.txt"), "utf8") === entries.get("Movable.txt"),
    "The independent successful move was lost after a partial failure.");
  assert(await fs.readFile(path.join(output, "BlockedTarget"), "utf8") === blockerContents,
    "The blocking path was overwritten during the failed move.");

  const rollbackPreview = await post(runtime, `/api/sessions/${encodeURIComponent(sessionId)}/rollback`, { confirm: false });
  assert(rollbackPreview.rollback_precheck?.can_execute, "Partial-failure rollback precheck did not allow restoration.");
  const rollback = await post(runtime, `/api/sessions/${encodeURIComponent(sessionId)}/rollback`, { confirm: true });
  assert(rollback.session_snapshot?.rollback_report?.failure_count === 0, "Partial-failure rollback reported a failure.");
  for (const [name, contents] of entries) {
    assert(await fs.readFile(path.join(source, name), "utf8") === contents, `Partial-failure rollback did not preserve ${name}.`);
  }
  assert(!(await fs.stat(path.join(output, "Documents", "Movable.txt")).catch(() => null)),
    "Partial-failure rollback left the successful move in the destination.");
  assert(await fs.readFile(path.join(output, "BlockedTarget"), "utf8") === blockerContents,
    "Rollback changed the blocking path.");
  return { failedMove: "source preserved", successfulMove: "rolled back", rollback: "passed" };
}

async function main() {
  assert(process.env.CI === "true", "Installed organization flow smoke is restricted to CI or an isolated test runner.");
  assert(Number.isInteger(debugPort) && debugPort > 0 && debugPort < 65536, "A valid WebView2 debug port is required.");
  assert(runnerTemp && path.isAbsolute(testRoot), "RUNNER_TEMP and an absolute test directory are required.");
  assertWithin(testRoot, runnerTemp, "Organization-flow test directory");
  assert(!(await fs.stat(testRoot).catch(() => null)), "Refusing to reuse an existing organization-flow test directory.");

  let mockIsListening = false;
  try {
    await fs.mkdir(testRoot, { recursive: false });
    await new Promise((resolve, reject) => mockModel.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
    mockIsListening = true;
    const mockAddress = mockModel.address();
    const { runtime, source } = await waitForRuntime();
    process.stdout.write(`Installed app runtime reached through ${source}.\n`);
    await api(runtime, "/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ families: { text: {
        preset: {
          OPENAI_BASE_URL: `http://127.0.0.1:${mockAddress.port}/v1`,
          OPENAI_MODEL: "filepilot-installed-smoke",
        },
        secret: { action: "replace", value: "local-only-smoke-key" },
      } } }),
    });

    const results = [
      await runLocaleScenario(runtime, testRoot, "en"),
      await runLocaleScenario(runtime, testRoot, "zh-CN"),
      await runTargetConflictScenario(runtime, testRoot),
      await runPartialFailureScenario(runtime, testRoot),
    ];
    assert(modelCalls.length >= 8, `Expected model analysis/planning calls for all scenarios; got ${modelCalls.length}.`);
    assert(modelCalls.some((call) => String(call.messages?.find((message) => message.role === "system")?.content || "")
      .includes("Write all generated suggested_purpose values and summaries in English.")),
    "The installed English analysis prompt was not exercised.");
    assert(modelCalls.some((call) => String(call.messages?.find((message) => message.role === "system")?.content || "")
      .includes("Write all user-facing natural-language replies in English")),
    "The installed English organization prompt was not exercised.");
    assert(modelCalls.some((call) => String(call.messages?.find((message) => message.role === "system")?.content || "")
      .includes("你是一个文件分析专家")),
    "The installed Simplified Chinese analysis prompt was not exercised.");
    assert(modelCalls.some((call) => String(call.messages?.find((message) => message.role === "system")?.content || "")
      .includes("你是一位“系统文件整理”专家")),
    "The installed Simplified Chinese organization prompt was not exercised.");
    process.stdout.write(`${JSON.stringify({ results, localModelRequests: modelCalls.length })}\n`);
  } finally {
    if (mockIsListening) {
      await new Promise((resolve) => {
        mockModel.closeAllConnections?.();
        mockModel.close(resolve);
      });
    }
    await fs.rm(testRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
