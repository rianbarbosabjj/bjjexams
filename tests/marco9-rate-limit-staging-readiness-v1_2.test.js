"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  assessStagingReadiness, inspectRepository, SECRET_NAME
} = require("../scripts/preflight-rate-limit-staging-v1_2");
const {
  summarizeBudgetCounts, SCOPES, REQUIRED_SAMPLE_COUNT
} = require("../scripts/analyze-rate-limit-calibration-v1_2");

const ROOT = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const parse = p => JSON.parse(read(p));

function expectConfigError(input, expression) {
  assert.throws(() => assessStagingReadiness(input), expression);
}
function fixtures() {
  return {
    manifest: parse("config/rate-limit-staging-readiness-v1_2.json"),
    indexes: parse("firestore.indexes.json"),
    mainSource: read("functions/main.js"),
    firestoreRules: read("firestore.rules")
  };
}
function withManifest(base, mutate) {
  const manifest = structuredClone(base.manifest);
  mutate(manifest);
  return { ...base, manifest };
}

const base = fixtures();
const report = inspectRepository();
assert.deepEqual(report, assessStagingReadiness(base));
assert.equal(report.project, "bjj-exams-staging");
assert.equal(report.collection, "_bjj_exams_rate_limits_v12");
assert.equal(report.ttlField, "expiresAt");
assert.equal(report.ttlPolicy, "PLANNED_NOT_APPLIED");
assert.equal(report.secret, "NOT_PROVISIONED_OR_VERIFIED");
assert.equal(report.backendQuota, "DISABLED");
assert.equal(report.appCheck, "REAL_STAGING_HOMOLOGATION_PENDING");
assert.equal(report.calibration, "REAL_STAGING_SAMPLES_NOT_COLLECTED");
assert.equal(report.activationDecision, "BLOCKED_REQUIRES_SEPARATE_STAGING_APPROVAL");
assert.equal(report.cloudAccess, "NOT_RUN");
assert.equal(report.deployExecuted, false);
assert.equal(SECRET_NAME, "BJJ_EXAMS_RATE_LIMIT_HMAC_V12");
assert.ok(!Object.hasOwn(base.manifest.hmac, "value"), "No key material in manifest");

const fakeSecret = Buffer.from("synthetic-unit-test-hmac-secret-more-than-32-bytes");
const formatOnly = assessStagingReadiness({ ...base, testSecret: fakeSecret });
assert.equal(formatOnly.testKeyFormat, "SYNTHETIC_FORMAT_VALID");
assert.equal(formatOnly.secret, "NOT_PROVISIONED_OR_VERIFIED");
assert.equal(JSON.stringify(formatOnly).includes(fakeSecret.toString()), false);
expectConfigError({ ...base, testSecret: Buffer.from("short") }, /TEST_SECRET_FORMAT_INVALID/);
expectConfigError({ ...base, testSecret: "accidentally-passed-string" }, /TEST_SECRET_MUST_BE_BUFFER/);

expectConfigError(withManifest(base, m => { m.targetProjectId = "bjj-exams"; }),
  /STAGING_BOUNDARY_INVALID/);
expectConfigError(withManifest(base, m => { m.targetDatabase = "production"; }),
  /STAGING_BOUNDARY_INVALID/);
expectConfigError(withManifest(base, m => { m.ttl.fieldPath = "payment_transactions"; }),
  /TTL_CONTRACT_INVALID/);
expectConfigError(withManifest(base, m => { m.ttl.activation = "ENABLED"; }),
  /TTL_CONTRACT_INVALID/);
expectConfigError(withManifest(base, m => { m.hmac.provisioned = true; }),
  /SECRET_CONTRACT_INVALID/);
expectConfigError(withManifest(base, m => { m.hmac.boundToFunctions = true; }),
  /SECRET_CONTRACT_INVALID/);
expectConfigError(withManifest(base, m => { m.rateLimitEnforcement = true; }),
  /ACTIVATION_MUST_REMAIN_BLOCKED/);
expectConfigError(withManifest(base, m => { m.calibration.realStagingSamplesCollected = true; }),
  /ACTIVATION_MUST_REMAIN_BLOCKED/);
expectConfigError({ ...base, indexes: {
  ...base.indexes, fieldOverrides: [{
    collectionGroup: "_bjj_exams_rate_limits_v12",
    fieldPath: "expiresAt", ttl: true, indexes: []
  }]
} }, /TTL_MUST_NOT_BE_IN_DEFAULT_INDEXES/);
expectConfigError({ ...base, mainSource: base.mainSource.replace(
  "createRateLimitGuard({ enabled: false })",
  "createRateLimitGuard({ enabled: true })"
) }, /RUNTIME_ACTIVATION_UNEXPECTED/);

assert.deepEqual(base.indexes.fieldOverrides, [], "Global indexes remain unchanged");
assert.ok(!read("functions/main.js").includes('defineSecret("' + SECRET_NAME + '")'));
assert.ok(!read("functions/main.js").includes("createRateLimitGuard({ enabled: true"));
assert.ok(read("firestore.rules").includes("match /{document=**}"));
assert.ok(read("firestore.rules").includes("allow read, write: if false;"));

const counts = [...Array.from({ length: 35 }, () => 4), ...Array.from({ length: 5 }, () => 130)];
const input = {
  schemaVersion: "1.2",
  projectId: "bjj-exams-staging",
  windowMs: 60000,
  scopes: [{ scope: "authenticated_read", counts }]
};
const calibration = summarizeBudgetCounts(input);
assert.equal(calibration.sourceVerification, "UNVERIFIED_OFFLINE_NUMERIC_AGGREGATES");
assert.equal(calibration.realStagingMetricsClaimed, false);
assert.equal(calibration.calibrationDecision, "MANUAL_REVIEW_REQUIRED");
assert.equal(calibration.rateLimitEnforcement, "DISABLED");
assert.deepEqual(calibration.summaries.map(x => x.scope), ["authenticated_read"]);
const one = calibration.summaries[0];
assert.equal(one.sampleWindows, 40);
assert.equal(one.currentCandidateLimit, 120);
assert.equal(one.p50, 4);
assert.equal(one.p95, 130);
assert.equal(one.p99, 130);
assert.equal(one.max, 130);
assert.equal(one.windowsAboveCandidate, 5);
assert.equal(one.windowsAboveCandidatePercent, 12.5);
assert.equal(one.sampleEvidence, "SAMPLE_SIZE_ONLY_MET");
assert.equal(REQUIRED_SAMPLE_COUNT, 30);
assert.equal(SCOPES.length, 6);
assert.equal(summarizeBudgetCounts({
  ...input, scopes: [{ scope: "checkout_mutation", counts: [1, 5, 6] }]
}).summaries[0].sampleEvidence, "INSUFFICIENT_SAMPLE_SIZE");
assert.throws(() => summarizeBudgetCounts({ ...input, projectId: "bjj-exams" }), /SAMPLE_SCHEMA_INVALID/);
assert.throws(() => summarizeBudgetCounts({
  ...input, scopes: [{ scope: "authenticated_read", counts, userId: "private-uid" }]
}), /SAMPLE_SCOPE_INVALID/);
assert.throws(() => summarizeBudgetCounts({
  ...input, scopes: [{ scope: "authenticated_read", counts: [1, "2", 3] }]
}), /SAMPLE_SCOPE_INVALID/);
assert.throws(() => summarizeBudgetCounts({
  ...input, scopes: [{ scope: "authenticated_read", counts: [-1] }]
}), /SAMPLE_SCOPE_INVALID/);
assert.throws(() => summarizeBudgetCounts({
  ...input, scopes: [
    { scope: "authenticated_read", counts: [1] },
    { scope: "authenticated_read", counts: [2] }
  ]
}), /SAMPLE_SCOPE_INVALID/);
assert.throws(() => summarizeBudgetCounts({
  ...input, scopes: [{ scope: "webhook_ingress", counts: [1] }]
}), /SAMPLE_SCOPE_INVALID/);
assert.throws(() => summarizeBudgetCounts({ ...input, ip: "203.0.113.1" }),
  /SAMPLE_SCHEMA_INVALID/);

for (const token of ["private-uid", "203.0.113.1", "person@example.invalid",
  fakeSecret.toString()]) {
  assert.equal(JSON.stringify(report).includes(token), false);
  assert.equal(JSON.stringify(calibration).includes(token), false);
}

const documentation = read("docs/architecture/MARCO_9_2B3_STAGING_READINESS.md");
for (const item of [
  "Gate 9.2B3", "bjj-exams-staging", "_bjj_exams_rate_limits_v12",
  "expiresAt", "BJJ_EXAMS_RATE_LIMIT_HMAC_V12", "TTL",
  "NO_DEPLOY", "NO_ENFORCEMENT", "MANUAL_REVIEW_REQUIRED",
  "NOT_APPLIED", "Gate 9.1C2B"
]) {
  assert.ok(documentation.includes(item), "Missing runbook contract " + item);
}
const workflow = read(".github/workflows/marco8-rc-regression.yml");
assert.ok(workflow.includes("node tests/marco9-rate-limit-staging-readiness-v1_2.test.js"));
assert.ok(workflow.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
assert.ok(workflow.includes("  contents: read"));
assert.ok(!workflow.includes("firebase deploy"));
assert.ok(!workflow.includes("pull_request_target"));
assert.ok(!workflow.includes("secrets."));

console.log("MARCO9_2B3_HMAC_TEST_KEY_FORMAT=PASSED");
console.log("MARCO9_2B3_TTL_CONTRACT_STAGING_ONLY=PASSED");
console.log("MARCO9_2B3_DEFAULT_INDEXES_UNCHANGED=PASSED");
console.log("MARCO9_2B3_CALIBRATION_SANITIZATION=PASSED");
console.log("MARCO9_2B3_ENFORCEMENT=NOT_ENABLED");
console.log("MARCO9_2B3_REAL_STAGING_CONFIGURATION=NOT_APPLIED");
console.log("MARCO9_GATE_9_2B3_STAGING_READINESS=PASSED");
console.log("PRODUCTION_ACCESS=NOT_RUN");
console.log("DEPLOY_EXECUTED=False");
