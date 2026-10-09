"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runtime = require("../js/firebase-runtime-v1_2.js");
const publicApi = require("../js/course-public-api-v1_2.js");
const purchaseApi = require("../js/course-purchase-api-v1_2.js");
const beltApi = require("../js/belt-exam-api-v1_2.js");
const shellApi = require("../js/admin-shell-api-v1_2.js");
const routeApi = require("../js/admin-shell-route-api-v1_2.js");

function response() {
  const body = { result: { ok: true, courses: [], items: [] } };
  return {
    ok: true, status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function requestLog() {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response();
  } };
}

async function invokeAll(log) {
  const common = { hostname: "localhost", fetchImpl: log.fetchImpl };
  await publicApi.callCallable("listarCatalogoCursosV12", {}, common);
  await purchaseApi.callPrivateCallable("obterStatusCompraCursoV12", {}, { ...common, idToken: "firebase-user-token" });
  await beltApi.callPrivateCallable("listarMeusExamesFaixaV12", {}, { ...common, idToken: "firebase-user-token" });
  await shellApi.callAuthenticated("obterContextoAdministrativoV12", {}, { ...common, idToken: "firebase-user-token" });
  await routeApi.callRouteAuthenticated("listarWebhooksOperacionaisV12", {}, { ...common, idToken: "firebase-user-token" });
  await routeApi.callActionAuthenticated("reprocessarWebhookOperacionalV12", {}, { ...common, idToken: "firebase-user-token" });
  assert.equal(log.calls.length, 6);
  assert.ok(log.calls.every(c => c.url.startsWith("https://southamerica-east1-bjj-exams-staging.cloudfunctions.net/")));
  assert.ok(log.calls.every(c => JSON.parse(c.options.body) && c.options.method === "POST"));
}

async function main() {
  runtime.registerStagingAppCheckTokenProvider(null, { hostname: "localhost" });
  assert.deepEqual(await runtime.getAppCheckHeaders({ hostname: "localhost" }), {});
  assert.throws(() => runtime.registerStagingAppCheckTokenProvider(() => "x", { hostname: "bjj-exams.web.app" }), /produção bloqueada/);
  assert.throws(() => runtime.registerStagingAppCheckTokenProvider("not-a-provider", { hostname: "localhost" }), TypeError);

  const disabled = requestLog();
  await invokeAll(disabled);
  for (const c of disabled.calls) {
    assert.equal(c.options.headers["X-Firebase-AppCheck"], undefined);
    assert.equal(Object.hasOwn(c.options.headers, "X-Firebase-AppCheck"), false);
  }
  assert.equal(disabled.calls[0].options.headers.Authorization, undefined, "public listing remains anonymous");
  assert.ok(disabled.calls.slice(1).every(c => c.options.headers.Authorization === "Bearer firebase-user-token"));

  runtime.registerStagingAppCheckTokenProvider(async () => ({ token: "staging-app-check-token" }), { hostname: "localhost" });
  assert.deepEqual(await runtime.getAppCheckHeaders({ hostname: "localhost" }), { "X-Firebase-AppCheck": "staging-app-check-token" });
  const ready = requestLog();
  await invokeAll(ready);
  for (const c of ready.calls) {
    assert.equal(c.options.headers["X-Firebase-AppCheck"], "staging-app-check-token");
    assert.equal(JSON.stringify(JSON.parse(c.options.body)).includes("staging-app-check-token"), false);
  }
  assert.ok(ready.calls.slice(1).every(c => c.options.headers.Authorization === "Bearer firebase-user-token"));
  assert.equal(ready.calls[0].options.headers.Authorization, undefined);

  let providerCalls = 0;
  const noProd = await runtime.getAppCheckHeaders({ hostname: "bjj-exams.web.app",
    getAppCheckToken: () => { providerCalls++; return "should-not-run"; } });
  assert.deepEqual(noProd, {});
  assert.equal(providerCalls, 0, "production never requests staging token");
  assert.deepEqual(await runtime.getAppCheckHeaders({ hostname: "localhost",
    getAppCheckToken: async () => "line1\r\nline2" }), {}, "CRLF token rejected");
  assert.deepEqual(await runtime.getAppCheckHeaders({ hostname: "localhost",
    getAppCheckToken: async () => ({ token: "" }) }), {}, "empty token omitted");
  assert.deepEqual(await runtime.getAppCheckHeaders({ hostname: "localhost",
    getAppCheckToken: async () => { throw new Error("provider unavailable with private string"); } }), {},
    "provider error never blocks an existing callable");
  const unavailable = requestLog();
  runtime.registerStagingAppCheckTokenProvider(async () => { throw new Error("transient"); }, { hostname: "localhost" });
  await invokeAll(unavailable);
  assert.ok(unavailable.calls.every(c => !Object.hasOwn(c.options.headers, "X-Firebase-AppCheck")));

  // Legacy auth, URL allowlists and production protections must remain enforced.
  await assert.rejects(() => purchaseApi.callPrivateCallable("obterStatusCompraCursoV12", {},
    { hostname: "localhost", fetchImpl: async () => response() }), /Sessão autenticada/);
  assert.throws(() => beltApi.functionUrl("listarMeusExamesFaixaV12",
    { hostname: "bjj-exams.web.app" }), /somente em staging/);
  assert.throws(() => shellApi.functionUrl("obterContextoAdministrativoV12",
    { hostname: "bjj-exams.web.app" }), /production|Production|PRODUCTION|bloquead|blocked/);

  const main = fs.readFileSync(path.join(__dirname, "..", "functions", "main.js"), "utf8");
  const webhook = fs.readFileSync(path.join(__dirname, "..", "functions", "src", "finance", "financial-webhook-functions.js"), "utf8");
  assert.ok(!main.includes("enforceAppCheck: true"), "enforcement not activated");
  assert.ok(webhook.includes("webhookTokenResolver"), "Asaas ingress unchanged");
  assert.ok(!webhook.includes("enforceAppCheck: true"), "external webhook excluded");
  runtime.registerStagingAppCheckTokenProvider(null, { hostname: "localhost" });
  console.log("MARCO9_1B_CLIENT_ADAPTERS=5/5");
  console.log("MARCO9_1B_CALLABLE_SURFACES=6/6");
  console.log("MARCO9_1B_APP_CHECK_TOKEN_OPTIONAL=PASSED");
  console.log("MARCO9_1B_AUTH_AND_STAGING_BOUNDARIES=PASSED");
  console.log("MARCO9_1B_APP_CHECK_ENFORCEMENT=NOT_ENABLED");
  console.log("MARCO9_GATE_9_1B_CLIENT_BRIDGE=PASSED");
  console.log("PRODUCTION_ACCESS=NOT_RUN");
  console.log("DEPLOY_EXECUTED=False");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
