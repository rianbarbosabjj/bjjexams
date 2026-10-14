"use strict";

// BJJ Exams Marco 9: staging-only browser smoke, never deploys or changes data.
// Auth remains in a dedicated LOCAL Chrome profile, outside the repository.
// No cookies, tokens, request bodies, page text, screenshots or HAR are saved.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");

const PROJECT = "bjj-exams-staging";
const HOST = "bjj-exams-staging.web.app";
const SITE = "https://" + HOST;
const SHELL = SITE + "/admin_shell_v1_2.html";
const LOGIN = SITE + "/login.html";
const FUNCTIONS_HOST = "southamerica-east1-" + PROJECT + ".cloudfunctions.net";
const API_ORIGIN = "https://" + FUNCTIONS_HOST;
const LOCAL = process.env.LOCALAPPDATA ||
  path.join(os.homedir(), "AppData", "Local");
const PRIVATE_DIR = path.join(LOCAL, "BJJExams", "marco9-browser");
const PROFILE_DIR = path.join(PRIVATE_DIR, "chrome-profile");
const REPORT_DIR = path.join(PRIVATE_DIR, "reports");

const TARGETS = Object.freeze([
  Object.freeze({ name: "obterContextoAdministrativoV12", route: null }),
  Object.freeze({ name: "listarPessoasOperacionaisV12", route: "people" }),
  Object.freeze({ name: "listarOrganizacoesOperacionaisV12", route: "organizations" }),
  Object.freeze({ name: "listarCursosOperacionaisV12", route: "courses" })
]);

const SAFE_ROUTE_STATES = new Set(["route-ready", "route-empty"]);
const BLOCKED_HOSTS = new Set([
  "bjj-exams.web.app",
  "bjj-exams.firebaseapp.com",
  "bjj-exams-staging.firebaseapp.com.invalid"
]);

function targetName(url, method) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== API_ORIGIN || method !== "POST" ||
        parsed.search || parsed.hash) return null;
    const name = parsed.pathname.slice(1);
    return TARGETS.some(item => item.name === name) ? name : null;
  } catch (_) {
    return null;
  }
}

function mustBlockNetwork(url) {
  let u;
  try { u = new URL(url); } catch (_) { return true; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".cloudfunctions.net") && host !== FUNCTIONS_HOST) return true;
  if (host === "firestore.googleapis.com" &&
      /(?:^|\/)projects\/bjj-exams(?:\/|$)/.test(u.pathname)) return true;
  return false;
}

function summarize(observed, routes, client) {
  const results = TARGETS.map(({ name, route }) => {
    const samples = (observed[name] || []);
    const sample = samples.length ? samples[samples.length - 1] : null;
    const routeState = route ? (routes[route] || "NOT_EXECUTED") : "NOT_APPLICABLE";
    const ok = Boolean(sample && sample.http === 200 &&
      sample.appCheckHeader && sample.authHeader &&
      (!route || SAFE_ROUTE_STATES.has(routeState)));
    return Object.freeze({
      function: name,
      http: sample ? sample.http : "NOT_OBSERVED",
      appCheckHeaderPresent: sample ? sample.appCheckHeader : false,
      authHeaderPresent: sample ? sample.authHeader : false,
      routeState,
      result: ok ? "PASS" : "REVIEW_REQUIRED"
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    environment: PROJECT,
    mode: "STAGING_BROWSER_READ_ONLY",
    sdkInitialized: Boolean(client.sdkInitialized),
    appCheckTokenAvailable: Boolean(client.tokenAvailable),
    backendTokenRejectionTested: false,
    productionRequestsBlocked: true,
    functions: results,
    result: client.sdkInitialized && client.tokenAvailable &&
      results.every(row => row.result === "PASS") ? "PASS" : "REVIEW_REQUIRED",
    appCheckBackendEnforcement: "NOT_TESTED",
    deployedOrMerged: false,
    marco9: "NO_GO"
  });
}

function ensurePrivateLocation() {
  const base = path.resolve(PRIVATE_DIR).toLowerCase();
  const repo = path.resolve(__dirname, "..", "..").toLowerCase();
  if (base === repo || base.startsWith(repo + path.sep) ||
      repo.startsWith(base + path.sep)) {
    throw new Error("UNSAFE_PROFILE_LOCATION");
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(REPORT_DIR, { recursive: true, mode: 0o700 });
}

function saveReport(report) {
  ensurePrivateLocation();
  const saved = Object.assign({ timestamp: new Date().toISOString() }, report);
  const filename = path.join(REPORT_DIR, "last-report.json");
  fs.writeFileSync(filename, JSON.stringify(saved, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 });
}

function attachSanitizedObserver(page, observed) {
  const captures = new Set();
  page.on("response", response => {
    const request = response.request();
    const name = targetName(request.url(), request.method());
    if (!name) return;
    const job = (async () => {
      // Header VALUES are never read into output or persisted to disk.
      const names = new Set((await request.headersArray())
        .map(header => header.name.toLowerCase()));
      observed[name].push({
        http: response.status(),
        appCheckHeader: names.has("x-firebase-appcheck"),
        authHeader: names.has("authorization")
      });
    })().catch(() => {
      observed[name].push({
        http: "OBSERVATION_ERROR",
        appCheckHeader: false,
        authHeader: false
      });
    });
    captures.add(job);
    void job.finally(() => captures.delete(job));
  });
  page.on("requestfailed", request => {
    const name = targetName(request.url(), request.method());
    if (name) observed[name].push({
      http: "NETWORK_ERROR",
      appCheckHeader: false,
      authHeader: false
    });
  });
  return async function flush() {
    await Promise.all([...captures]);
  };
}

async function waitForSample(observed, name, flush, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await flush();
    if (observed[name].length) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

async function evaluateClient(page) {
  return page.evaluate(async () => {
    const runtime = window.BjjExamsFirebaseRuntime;
    if (!runtime ||
        typeof runtime.initializeStagingAppCheckFromConfig !== "function" ||
        typeof runtime.getAppCheckHeaders !== "function") {
      return { sdkInitialized: false, tokenAvailable: false };
    }
    const init = await runtime.initializeStagingAppCheckFromConfig();
    if (init?.status !== "sdk_initialized") {
      return { sdkInitialized: false, tokenAvailable: false };
    }
    const headers = await runtime.getAppCheckHeaders();
    // Only a BOOLEAN crosses the boundary from the browser to Node.
    return {
      sdkInitialized: true,
      tokenAvailable: typeof headers["X-Firebase-AppCheck"] === "string" &&
        headers["X-Firebase-AppCheck"].length > 0
    };
  });
}

async function runReadOnly(page) {
  const observed = Object.fromEntries(TARGETS.map(t => [t.name, []]));
  const routes = {};
  const flush = attachSanitizedObserver(page, observed);

  await page.goto(SHELL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => {
    const state = document.querySelector("[data-admin-shell-root]")?.dataset?.state;
    return state === "ready" || state === "denied" || state === "error";
  }, null, { timeout: 45000 });

  const ready = await page.evaluate(() =>
    document.querySelector("[data-admin-shell-root]")?.dataset?.state === "ready"
  );
  if (!ready) throw new Error("ADMIN_SESSION_NOT_READY");

  const client = await evaluateClient(page);
  await waitForSample(observed, TARGETS[0].name, flush);

  for (const target of TARGETS.filter(t => t.route)) {
    const state = await page.evaluate(async routeId => {
      const runtime = window.__bjjAdminShellRouteRuntimeV12;
      if (!runtime || typeof runtime.activate !== "function") return "NOT_AVAILABLE";
      const result = await runtime.activate(routeId);
      return typeof result?.state === "string" &&
        ["route-ready", "route-empty", "route-error", "route-not-integrated"].includes(result.state)
        ? result.state : "UNKNOWN";
    }, target.route);
    routes[target.route] = state;
    await waitForSample(observed, target.name, flush);
  }

  await flush();
  return summarize(observed, routes, client);
}

async function main() {
  const mode = process.argv[2];
  if (!["--login", "--run"].includes(mode) || process.argv.length !== 3) {
    console.log("USAGE=node tools/marco9-browser/runner.cjs --login|--run");
    process.exitCode = 2;
    return;
  }

  ensurePrivateLocation();
  // Lazy dependency: offline contract tests need no browser or installed package.
  const { chromium } = require("playwright-core");
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    acceptDownloads: false,
    viewport: { width: 1365, height: 900 }
  });

  try {
    await context.route("**/*", route =>
      mustBlockNetwork(route.request().url()) ? route.abort() : route.continue()
    );
    const page = context.pages()[0] || await context.newPage();

    if (mode === "--login") {
      await page.goto(LOGIN, { waitUntil: "domcontentloaded", timeout: 45000 });
      console.log("STAGING_LOGIN=MANUAL_ONLY");
      console.log("CREDENTIALS_CAPTURED=NO");
      console.log("Use somente sua conta temporaria do staging nesta janela Chrome.");
      console.log("Depois de concluir o login, pressione ENTER neste terminal.");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try { await rl.question("LOGIN_CONCLUIDO? [ENTER] "); }
      finally { rl.close(); }
      await page.goto(SHELL, { waitUntil: "domcontentloaded", timeout: 45000 });
      try {
        await page.waitForSelector('[data-admin-shell-root][data-state="ready"]',
          { timeout: 45000 });
        console.log("STAGING_ADMIN_SESSION=READY");
      } catch (_) {
        console.log("STAGING_ADMIN_SESSION=REVIEW_REQUIRED");
        process.exitCode = 2;
      }
      console.log("SESSION_PROFILE=LOCAL_PRIVATE_DIRECTORY");
      console.log("DEPLOY=NONE");
      return;
    }

    const report = await runReadOnly(page);
    saveReport(report);
    for (const row of report.functions) {
      console.log("FUNCTION=" + row.function +
        " HTTP=" + row.http +
        " APPCHECK_HEADER=" + row.appCheckHeaderPresent +
        " AUTH_HEADER=" + row.authHeaderPresent +
        " ROUTE=" + row.routeState +
        " RESULT=" + row.result);
    }
    console.log("APP_CHECK_CLIENT_SDK=" + (report.sdkInitialized ? "READY" : "NOT_READY"));
    console.log("APP_CHECK_CLIENT_TOKEN=" + (report.appCheckTokenAvailable ? "AVAILABLE" : "NOT_AVAILABLE"));
    console.log("AUTOMATED_STAGING_SMOKE=" + report.result);
    console.log("REPORT=LOCAL_PRIVATE_DIRECTORY");
    console.log("BACKEND_VALID_MISSING_INVALID=NOT_TESTED");
    console.log("DEPLOY=NONE MERGE=NONE MARCO9=NO_GO");
    if (report.result !== "PASS") process.exitCode = 2;
  } finally {
    await context.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    const known = new Set(["ADMIN_SESSION_NOT_READY", "UNSAFE_PROFILE_LOCATION"]);
    console.error("AUTOMATED_STAGING_SMOKE=REVIEW_REQUIRED");
    console.error("ERROR_CODE=" + (known.has(error?.message) ? error.message : "BROWSER_EXECUTION_FAILED"));
    console.error("SENSITIVE_OUTPUT=NONE");
    console.error("DEPLOY=NONE MARCO9=NO_GO");
    process.exitCode = 2;
  });
}

module.exports = Object.freeze({
  PROJECT, HOST, FUNCTIONS_HOST, TARGETS,
  targetName, mustBlockNetwork, summarize, ensurePrivateLocation
});
