"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseExport, classify, analyzeEntries, STAGING_PROJECT, REGION } =
  require("../scripts/analyze-appcheck-staging-logs-v1_2");

function event(status, options = {}) {
  const type = options.type || "cloud_function";
  return {
    resource: { type, labels: {
      project_id: options.project || "bjj-exams-staging",
      ...(type === "cloud_function"
        ? { function_name: options.name || "listarCatalogoCursosV12", region: options.region || REGION }
        : { service_name: options.name || "obterCursoPublicoV12", location: options.region || REGION })
    } },
    labels: { "firebase-log-type": options.label || "callable-request-verification" },
    jsonPayload: {
      verifications: options.verifications || { appCheck: status },
      rawToken: "SENSITIVE_APP_CHECK_TOKEN_MUST_NEVER_LEAK",
      email: "person@example.invalid",
      customerCpf: "00000000000"
    },
    httpRequest: { requestUrl: "https://example.invalid/private?id=secret" }
  };
}

const input = [
  event("VALID"),
  event("MISSING"),
  event("INVALID", { type: "cloud_run_revision" }),
  event("VALID", { type: "cloud_run_revision", verifications: { app: "VALID" } }),
  event("VALID", { verifications: { app: "INVALID", appCheck: "VALID" } }),
  event("INVALID", { verifications: { appCheck: "not_a_status" } }),
  event("VALID", { project: "bjj-exams" }),
  event("VALID", { project: "other-project" }),
  event("VALID", { region: "us-central1" }),
  event("VALID", { label: "normal-log" }),
  event("VALID", { name: "user@example.invalid" }),
  event("VALID", { type: "unknown_resource" })
];

assert.equal(STAGING_PROJECT, "bjj-exams-staging");
assert.equal(REGION, "southamerica-east1");
const result = analyzeEntries(input);
assert.equal(result.project, STAGING_PROJECT);
assert.equal(result.region, REGION);
assert.equal(result.eligibleEvents, 6);
assert.equal(result.excludedEvents, 6);
assert.deepEqual(result.totals, { VALID: 2, MISSING: 1, INVALID: 1, UNKNOWN: 2 });
assert.deepEqual(Object.keys(result.functions).sort(),
  ["listarCatalogoCursosV12", "obterCursoPublicoV12"].sort());
assert.deepEqual(result.functions.listarCatalogoCursosV12,
  { VALID: 1, MISSING: 1, INVALID: 0, UNKNOWN: 2 });
assert.deepEqual(result.functions.obterCursoPublicoV12,
  { VALID: 1, MISSING: 0, INVALID: 1, UNKNOWN: 0 });
assert.equal(result.evidenceStatus, "STAGING_LOGS_OBSERVED");
assert.equal(result.enforcementDecision, "BLOCKED_REQUIRES_MANUAL_GATE_9_1D");
assert.equal(result.liveValidationClaimed, false);

const serialized = JSON.stringify(result);
for (const secret of ["SENSITIVE_APP_CHECK_TOKEN", "person@example.invalid",
  "00000000000", "secret", "rawToken", "customerCpf"]) {
  assert.equal(serialized.includes(secret), false, `Unexpected raw field leakage: ${secret}`);
}
assert.deepEqual(analyzeEntries([event("VALID", { project: "bjj-exams" })]).totals,
  { VALID: 0, MISSING: 0, INVALID: 0, UNKNOWN: 0 });
const empty = analyzeEntries([]);
assert.equal(empty.evidenceStatus, "NO_VERIFIABLE_STAGING_EVENTS");
assert.equal(empty.enforcementDecision, "BLOCKED_REQUIRES_MANUAL_GATE_9_1D");
assert.equal(classify(null), null);
assert.equal(classify(event("VALID", { label: "other" })), null);
assert.deepEqual(analyzeEntries(parseExport(JSON.stringify(input))).totals, result.totals);
assert.deepEqual(analyzeEntries(parseExport(input.map(x => JSON.stringify(x)).join("\n"))).totals, result.totals);
assert.deepEqual(analyzeEntries(parseExport(JSON.stringify({ entries: input }))).totals, result.totals);
assert.throws(() => parseExport("{malformed"), /APP_CHECK_EXPORT_INVALID_JSON/);
assert.throws(() => parseExport(JSON.stringify({ unexpected: [] })), /APP_CHECK_EXPORT_ENTRIES_REQUIRED/);

const doc = fs.readFileSync(path.join(__dirname, "..", "docs/architecture/MARCO_9_1C_OBSERVABILITY.md"), "utf8");
for (const word of ["9.1C1", "9.1C2", "bjj-exams-staging", "southamerica-east1",
  "VALID", "MISSING", "INVALID", "NO_ENFORCEMENT", "NO_DEPLOY",
  "callable-request-verification", "BLOCKED_REQUIRES_MANUAL_GATE_9_1D"]) {
  assert.ok(doc.includes(word), `Missing document contract: ${word}`);
}
const workflow = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/marco8-rc-regression.yml"), "utf8");
assert.ok(workflow.includes("node tests/marco9-app-check-observability-v1_2.test.js"));
assert.ok(workflow.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
assert.ok(workflow.includes("  contents: read"));
assert.ok(!workflow.includes("firebase deploy"));
assert.ok(!workflow.includes("pull_request_target"));
assert.ok(!workflow.includes("secrets."));
const hosting = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "firebase.staging-hosting.json"), "utf8"));
assert.equal(hosting.hosting.site, "bjj-exams-staging");

console.log("MARCO9_1C1_LOG_STATUSES=VALID_MISSING_INVALID_UNKNOWN");
console.log("MARCO9_1C1_ONLY_STAGING_LOGS=PASSED");
console.log("MARCO9_1C1_SENSITIVE_FIELDS_REDACTED=PASSED");
console.log("MARCO9_1C1_NO_LIVE_METRICS_CLAIM=PASSED");
console.log("MARCO9_GATE_9_1C1_OBSERVABILITY=PASSED");
console.log("APP_CHECK_ENFORCEMENT=NOT_ENABLED");
console.log("DEPLOY_EXECUTED=False");
