"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, inventory, INGRESS_EXCEPTIONS, CLIENT_FILES } = require("../scripts/inventory-app-check-v1_2");

function read(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }

const plan = read("docs/architecture/MARCO_9_1_APP_CHECK_ROLLOUT.md");
const main = read("functions/main.js");
const legacy = read("functions/index.js");
const webhook = read("functions/src/finance/financial-webhook-functions.js");
const runtime = read("js/firebase-runtime-v1_2.js");
const firebase = JSON.parse(read("firebase.json"));
const stagingHosting = JSON.parse(read("firebase.staging-hosting.json"));
const ci = read(".github/workflows/marco8-rc-regression.yml");

for (const term of ["9.1A", "9.1B", "9.1C", "9.1D", "NO_ENFORCEMENT",
  "NO_DEPLOY", "X-Firebase-AppCheck", "Asaas", "VALID", "MISSING", "INVALID"]) {
  assert.ok(plan.includes(term), `Plano incompleto: ${term}`);
}

const result = inventory();
assert.ok(result.filesScanned >= 15, "Fontes Functions inesperadamente ausentes");
assert.ok(result.callables >= 15, "Callables inesperadamente ausentes");
assert.ok(result.httpIngresses >= 2, "HTTP ingress sem inventário mínimo");
assert.ok(result.candidates.some(x => x.file === "functions/index.js" && x.transport === "onCall"));
assert.ok(result.candidates.some(x => x.file === "functions/index.js" && x.transport === "onRequest"));
assert.ok(result.candidates.some(x => x.file === "functions/src/finance/financial-webhook-functions.js" && x.transport === "onRequest"));
assert.ok(result.candidates.some(x => x.file === "functions/src/courses/course-public-functions.js" && x.transport === "onCall"));
assert.ok(result.candidates.some(x => x.file === "functions/src/exams/exam-attempt-functions.js" && x.transport === "onCall"));
assert.ok(result.candidates.some(x => x.file === "functions/src/admin/admin-context-functions.js" && x.transport === "onCall"));
assert.ok(result.candidates.every(x => x.authClassification === "requires-manual-verification"));
assert.equal(INGRESS_EXCEPTIONS.length, 2);
for (const entry of INGRESS_EXCEPTIONS) {
  assert.ok(result.candidates.some(x => x.file === entry.file && x.transport === "onRequest"));
}

assert.match(legacy, /exports\.asaasWebhook\s*=\s*onRequest\s*\(/);
assert.match(webhook, /webhookAsaasPagamentosV12\s*:\s*onRequest\s*\(/);
assert.ok(webhook.includes("webhookTokenResolver"), "Asaas must retain separate ingress token");
assert.equal(CLIENT_FILES.length, 4);
assert.ok(result.clients.every(x => x.rawHttpCallable), "Raw HTTP caller must be recognized");
assert.ok(result.clients.every(x => !x.appCheckHeaderPresent), "Client onboarding is a later gate");
assert.ok(runtime.includes("bjj-exams-staging"), "Staging config boundary missing");
assert.ok(main.includes('const STAGING_PROJECT_ID = "bjj-exams-staging";'));
assert.ok(main.includes("const adminRuntimeAllowed ="));
assert.ok(!Object.hasOwn(firebase, "hosting"));
assert.equal(stagingHosting.hosting.site, "bjj-exams-staging");

for (const item of result.candidates) {
  const content = read(item.file);
  assert.equal(/enforceAppCheck\s*:\s*true/.test(content), false,
    `Unexpected App Check enforcement in ${item.file}`);
}

assert.ok(ci.includes("node tests/marco9-app-check-inventory-v1_2.test.js"));
assert.ok(ci.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
assert.ok(ci.includes("  contents: read"));
assert.ok(!ci.includes("firebase deploy"));
assert.ok(!ci.includes("pull_request_target"));
assert.ok(!ci.includes("secrets."));

console.log(`APP_CHECK_CANDIDATES=${result.callables}+${result.httpIngresses}`);
console.log("APP_CHECK_HTTP_EXTERNAL_INGRESS_EXCEPTIONS=2/2");
console.log("APP_CHECK_RAW_HTTP_CLIENTS_REQUIRING_MIGRATION=4/4");
console.log("APP_CHECK_AUTH_CLASSIFICATION=MANUAL_REVIEW_REQUIRED");
console.log("APP_CHECK_ENFORCEMENT=NOT_ENABLED");
console.log("MARCO9_GATE_9_1A_INVENTORY_CONTRACT=PASSED");
console.log("PRODUCTION_ACCESS=NOT_RUN");
console.log("DEPLOY_EXECUTED=False");
