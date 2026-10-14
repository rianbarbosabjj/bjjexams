"use strict";

// Offline-only contract. No Playwright dependency, Firebase calls, or credentials.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const runner = require("../tools/marco9-browser/runner.cjs");

assert.equal(runner.PROJECT, "bjj-exams-staging");
assert.equal(runner.HOST, "bjj-exams-staging.web.app");
assert.equal(runner.FUNCTIONS_HOST,
  "southamerica-east1-bjj-exams-staging.cloudfunctions.net");
assert.deepEqual(runner.TARGETS.map(t => t.name), [
  "obterContextoAdministrativoV12",
  "listarPessoasOperacionaisV12",
  "listarOrganizacoesOperacionaisV12",
  "listarCursosOperacionaisV12"
]);
assert.deepEqual(runner.TARGETS.map(t => t.route),
  [null, "people", "organizations", "courses"]);

for (const item of runner.TARGETS) {
  const url = "https://" + runner.FUNCTIONS_HOST + "/" + item.name;
  assert.equal(runner.targetName(url, "POST"), item.name);
  assert.equal(runner.targetName(url, "GET"), null);
  assert.equal(runner.targetName(url + "?data=hidden", "POST"), null);
  assert.equal(runner.targetName(url.replace("staging", "production"), "POST"), null);
}
assert.equal(runner.targetName("not-a-url", "POST"), null);
assert.equal(runner.targetName(
  "https://southamerica-east1-bjj-exams-staging.cloudfunctions.net/asaasWebhook",
  "POST"), null);

for (const url of [
  "https://bjj-exams.web.app/",
  "https://bjj-exams.firebaseapp.com/",
  "https://southamerica-east1-bjj-exams.cloudfunctions.net/obterContextoAdministrativoV12",
  "https://us-central1-other.cloudfunctions.net/function",
  "https://firestore.googleapis.com/v1/projects/bjj-exams/databases/(default)/documents"
]) assert.equal(runner.mustBlockNetwork(url), true, url);
for (const url of [
  "https://bjj-exams-staging.web.app/admin_shell_v1_2.html",
  "https://southamerica-east1-bjj-exams-staging.cloudfunctions.net/obterContextoAdministrativoV12",
  "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js",
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
  "https://firebaseappcheck.googleapis.com/v1/projects/bjj-exams-staging/apps/x:exchangeRecaptchaEnterpriseToken"
]) assert.equal(runner.mustBlockNetwork(url), false, url);

const observed = Object.fromEntries(runner.TARGETS.map(t => [t.name,
  [{ http: 200, appCheckHeader: true, authHeader: true, token: "must-never-appear" }]]));
const routes = { people: "route-ready", organizations: "route-empty",
  courses: "route-ready" };
const client = { sdkInitialized: true, tokenAvailable: true, token: "private" };

const report = runner.summarize(observed, routes, client);
assert.equal(report.result, "PASS");
assert.equal(report.functions.length, 4);
assert.ok(report.functions.every(x => x.result === "PASS"));
assert.equal(report.backendTokenRejectionTested, false);
assert.equal(report.appCheckBackendEnforcement, "NOT_TESTED");
assert.equal(report.deployedOrMerged, false);
assert.equal(report.marco9, "NO_GO");
assert.equal(JSON.stringify(report).includes("must-never-appear"), false);
assert.equal(JSON.stringify(report).includes("private"), false);

const missing = structuredClone(observed);
missing.listarCursosOperacionaisV12 = [];
assert.equal(runner.summarize(missing, routes, client).result, "REVIEW_REQUIRED");
const noApp = structuredClone(observed);
noApp.listarPessoasOperacionaisV12[0].appCheckHeader = false;
assert.equal(runner.summarize(noApp, routes, client).result, "REVIEW_REQUIRED");
const forbidden = structuredClone(observed);
forbidden.obterContextoAdministrativoV12[0].http = 403;
assert.equal(runner.summarize(forbidden, routes, client).result, "REVIEW_REQUIRED");
assert.equal(runner.summarize(observed, { ...routes, courses: "route-error" },
  client).result, "REVIEW_REQUIRED");
assert.equal(runner.summarize(observed, routes,
  { sdkInitialized: true, tokenAvailable: false }).result, "REVIEW_REQUIRED");

// Runner must not log bodies, headers, tokens, or create production writes.
const source = fs.readFileSync(
  path.join(__dirname, "..", "tools/marco9-browser/runner.cjs"), "utf8");
assert.ok(source.includes('launchPersistentContext(PROFILE_DIR'));
assert.ok(source.includes('channel: "chrome"'));
assert.ok(source.includes('context.route("**/*"'));
assert.ok(source.includes('await runtime.activate(routeId)'));
assert.ok(source.includes('request.headersArray()'));
assert.ok(source.includes('page.on("response"'));
assert.ok(!source.includes("request.postData("));
assert.ok(!source.includes("response.body("));
assert.ok(!source.includes("storageState("));
assert.ok(!source.includes("screenshot("));
assert.ok(!source.includes("firebase deploy"));
const pkg = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "tools/marco9-browser/package.json"), "utf8"));
assert.equal(pkg.dependencies["playwright-core"], "1.64.0");
const ignore = fs.readFileSync(
  path.join(__dirname, "..", "tools/marco9-browser/.gitignore"), "utf8");
assert.ok(ignore.includes("node_modules/"));
assert.ok(ignore.includes("package-lock.json"));

console.log("MARCO9_BROWSER_TARGET_ALLOWLIST=4/4");
console.log("MARCO9_BROWSER_PRODUCTION_NETWORK_GUARD=PASSED");
console.log("MARCO9_BROWSER_TOKEN_REPORT_SANITIZATION=PASSED");
console.log("MARCO9_BROWSER_OFFLINE_CONTRACT=PASS");
console.log("MARCO9_BROWSER_LIVE_HTTP=NOT_RUN");
console.log("MARCO9=NO_GO");
