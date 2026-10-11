const path = require("node:path");
const { createRequire } = require("node:module");

const requireFrontend = createRequire(path.join(__dirname, "..", "frontend", "package.json"));
const WebSocket = requireFrontend("ws");

function connectCommand(port, method, params = {}) {
  return getPageTarget(port).then((target) => new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const commandId = 1;
    let finished = false;
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for WebView2 command ${method}.`)), 10000);

    function finish(error, result) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.close();
      if (error) reject(error);
      else resolve(result);
    }

    socket.on("open", () => socket.send(JSON.stringify({ id: commandId, method, params })));
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (error) {
        finish(error);
        return;
      }
      if (message.id !== commandId) return;
      if (message.error) finish(new Error(message.error.message));
      else finish(null, message.result);
    });
    socket.on("error", (error) => finish(error));
  }));
}

async function getPageTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`WebView2 DevTools returned HTTP ${response.status}.`);
  }
  const targets = await response.json();
  const target = targets.find((item) => item.type === "page" && item.url.startsWith("http://tauri.localhost/"));
  if (!target) {
    throw new Error("The installed FilePilot WebView2 page target was not found.");
  }
  return target;
}

async function evaluate(port, expression) {
  const result = await connectCommand(port, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function getUiPreference(port) {
  const result = await evaluate(port, "(async () => { const runtime = window.__FILE_PILOT_RUNTIME__; const response = await fetch(runtime.base_url + '/api/settings', { headers: { Authorization: 'Bearer ' + runtime.api_token } }); const settings = await response.json(); return JSON.stringify({ status: response.status, preference: settings.global_config?.UI_LANGUAGE ?? null }); })()");
  const settings = JSON.parse(result);
  if (settings.status !== 200) {
    throw new Error(`Could not read the installed app UI preference (HTTP ${settings.status}).`);
  }
  return settings.preference || "system";
}

async function setUiPreference(port, preference) {
  const expression = `(async () => { const runtime = window.__FILE_PILOT_RUNTIME__; const response = await fetch(runtime.base_url + '/api/settings', { method: 'PATCH', headers: { Authorization: 'Bearer ' + runtime.api_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ global_config: { UI_LANGUAGE: ${JSON.stringify(preference)} } }) }); return response.status; })()`;
  const status = await evaluate(port, expression);
  if (status !== 200) {
    throw new Error(`Could not set the installed app UI preference (HTTP ${status}).`);
  }
}

async function navigate(port, route) {
  const result = await connectCommand(port, "Page.navigate", { url: `http://tauri.localhost${route}` });
  if (result.errorText) {
    throw new Error(`Could not navigate the installed app to ${route}: ${result.errorText}`);
  }
}

async function waitForLocalizedText(port, route, language, requiredText) {
  const deadline = Date.now() + 30000;
  const expression = "JSON.stringify({ title: document.title, url: location.href, lang: document.documentElement.lang, text: document.body?.innerText ?? '' })";
  let lastError;
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(await evaluate(port, expression));
      const actualRoute = new URL(state.url).pathname.replace(/\/$/, "") || "/";
      const expectedRoute = route.replace(/\/$/, "") || "/";
      if (actualRoute === expectedRoute && state.lang === language && state.text.includes(requiredText)) {
        return state;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const detail = lastError ? ` Last WebView2 response: ${lastError.message}` : "";
  throw new Error(`Installed UI did not render the expected ${language} text at the requested route.${detail}`);
}

async function waitForInitialPage(port) {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(await evaluate(port, "JSON.stringify({ lang: document.documentElement.lang, text: document.body?.innerText ?? '' })"));
      if (state.lang && state.text.trim()) return state;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const detail = lastError ? ` Last WebView2 response: ${lastError.message}` : "";
  throw new Error(`The installed desktop UI did not finish its initial render.${detail}`);
}

async function verifyPage(port, route, language, requiredText, label) {
  await navigate(port, route);
  await waitForLocalizedText(port, route, language, requiredText);
  console.log(`Installed UI check passed: ${label} (${language}).`);
}

async function main() {
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("A valid WebView2 DevTools port is required.");
  }

  const initialState = await waitForInitialPage(port);
  const initialPreference = await getUiPreference(port);
  let testFailure;
  try {
    for (const testCase of [
      {
        preference: "en",
        locale: "en",
        pages: [
          { route: "/", text: "Settings", label: "home" },
          { route: "/rules", text: "Organization rules", label: "rules" },
          { route: "/history", text: "History", label: "history" },
          { route: "/icons", text: "Icon Studio", label: "icons" },
          { route: "/settings", text: "Settings categories", label: "settings" },
        ],
      },
      {
        preference: "zh-CN",
        locale: "zh-CN",
        pages: [
          { route: "/", text: "设置", label: "home" },
          { route: "/rules", text: "分类规则", label: "rules" },
          { route: "/history", text: "整理历史", label: "history" },
          { route: "/icons", text: "图标工坊", label: "icons" },
          { route: "/settings", text: "设置选项", label: "settings" },
        ],
      },
    ]) {
      await setUiPreference(port, testCase.preference);
      for (const page of testCase.pages) {
        await verifyPage(port, page.route, testCase.locale, page.text, page.label);
      }
    }
  } catch (error) {
    testFailure = error;
  }

  try {
    await setUiPreference(port, initialPreference);
    await navigate(port, "/");
    await waitForLocalizedText(port, "/", initialState.lang, initialState.lang === "en" ? "Settings" : "设置");
    console.log(`Installed UI preference restored: ${initialPreference}.`);
  } catch (error) {
    if (!testFailure) testFailure = error;
    else console.error(`Could not restore the isolated UI preference: ${error.message}`);
  }

  if (testFailure) throw testFailure;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
