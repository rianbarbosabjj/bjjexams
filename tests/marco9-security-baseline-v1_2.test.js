"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = p => fs.readFileSync(path.join(root, p), "utf8");
const plan = source("docs/architecture/MARCO_9_SECURITY_PLAN.md");
const main = source("functions/main.js");
const firebase = JSON.parse(source("firebase.json"));
const stagingHosting = JSON.parse(source("firebase.staging-hosting.json"));
const ci = source(".github/workflows/marco8-rc-regression.yml");

function contains(content, token) {
  assert.ok(content.includes(token), `Contrato ausente: ${token}`);
}

for (const gate of [
  "Gate 9.0A", "Gate 9.1", "Gate 9.2", "Gate 9.3",
  "Gate 9.4", "Gate 9.5", "Gate 9.6", "Gate 9.7", "Gate 9.8"
]) contains(plan, gate);

for (const boundary of [
  "PRODUCTION_ACCESS=FORBIDDEN",
  "STAGING_PROJECT=bjj-exams-staging",
  "Asaas Sandbox",
  "PLAN_ONLY",
  "não",
  "Gate 8.9B"
]) contains(plan, boundary);

for (const topic of [
  "App Check", "Rate limiting", "CSP", "Threat model",
  "Dependências e CI", "Auditoria, observabilidade e LGPD",
  "Backup e restore", "Carga e falhas", "Release e rollback"
]) contains(plan, topic);

assert.ok(!Object.hasOwn(firebase, "hosting"), "Hosting de produção não pode ser ativado");
assert.equal(stagingHosting.hosting.site, "bjj-exams-staging");
assert.equal(stagingHosting.hosting.public, ".firebase-hosting-staging");
contains(main, 'const STAGING_PROJECT_ID = "bjj-exams-staging";');
contains(main, "const adminRuntimeAllowed =");
contains(main, "firebaseProjectId === STAGING_PROJECT_ID");

contains(ci, "pull_request:");
contains(ci, "      - develop-v1.2");
contains(ci, "  contents: read");
contains(ci, "RC_CONSOLIDATED_REGRESSION=133/133");
contains(ci, "node tests/marco9-security-baseline-v1_2.test.js");
assert.ok(!ci.includes("firebase deploy"), "CI não pode fazer deploy");
assert.ok(!ci.includes("pull_request_target"), "CI não deve usar pull_request_target");
assert.ok(!/\$\{\{\s*secrets\./.test(ci), "CI não deve referenciar secrets");
assert.ok(!/permissions:\s*\n\s*contents:\s*write/.test(ci), "CI não deve ter contents: write");
assert.ok(!ci.includes("github.head_ref == 'feature/marco8-ops-console'"), "CI não pode filtrar outros PRs");

console.log("MARCO9_SECURITY_AREAS=9/9");
console.log("MARCO9_PRODUCTION_BOUNDARIES=PASSED");
console.log("MARCO9_CI_NON_DEPLOY_BOUNDARY=PASSED");
console.log("MARCO9_GATE_9_0A_SECURITY_CONTRACT=PASSED");
console.log("PRODUCTION_ACCESS=NOT_RUN");
console.log("DEPLOY_EXECUTED=False");
