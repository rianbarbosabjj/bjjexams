"use strict";

// Input contains ONLY numeric request counts per synthetic/anonymous principal-window.
// Never accept identifiers, IPs, tokens, emails, request payloads or raw access logs.
const fs = require("node:fs");
const { POLICIES, STAGING_PROJECT } = require("../functions/src/security/rate-limit-core");
const MAX_BYTES = 256 * 1024;
const MAX_SAMPLES_PER_SCOPE = 10000;
const REQUIRED_SAMPLE_COUNT = 30;
const SCOPES = Object.freeze([
  "public_read", "authenticated_read", "exam_mutation",
  "checkout_mutation", "admin_mutation", "certificate_mutation"
]);

function exactKeys(value, allowed) {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key)) &&
    allowed.every(key => Object.hasOwn(value, key));
}
function percentile(sorted, fraction) {
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}
function summarizeBudgetCounts(input) {
  if (!exactKeys(input, ["schemaVersion", "projectId", "windowMs", "scopes"]) ||
      input.schemaVersion !== "1.2" ||
      input.projectId !== STAGING_PROJECT ||
      input.windowMs !== 60000 ||
      !Array.isArray(input.scopes) ||
      input.scopes.length < 1 || input.scopes.length > SCOPES.length) {
    throw new Error("RATE_LIMIT_SAMPLE_SCHEMA_INVALID");
  }
  const used = new Set();
  const summaries = [];
  for (const item of input.scopes) {
    if (!exactKeys(item, ["scope", "counts"]) ||
        !SCOPES.includes(item.scope) || used.has(item.scope) ||
        !Array.isArray(item.counts) ||
        item.counts.length < 1 || item.counts.length > MAX_SAMPLES_PER_SCOPE ||
        item.counts.some(n => !Number.isSafeInteger(n) || n < 0 || n > 100000)) {
      throw new Error("RATE_LIMIT_SAMPLE_SCOPE_INVALID");
    }
    used.add(item.scope);
    const counts = [...item.counts].sort((a, b) => a - b);
    const limit = POLICIES[item.scope].limit;
    const exceeding = counts.filter(n => n > limit).length;
    summaries.push(Object.freeze({
      scope: item.scope,
      sampleWindows: counts.length,
      currentCandidateLimit: limit,
      p50: percentile(counts, .5),
      p95: percentile(counts, .95),
      p99: percentile(counts, .99),
      max: counts[counts.length - 1],
      windowsAboveCandidate: exceeding,
      windowsAboveCandidatePercent: Number((exceeding * 100 / counts.length).toFixed(2)),
      sampleEvidence: counts.length >= REQUIRED_SAMPLE_COUNT
        ? "SAMPLE_SIZE_ONLY_MET" : "INSUFFICIENT_SAMPLE_SIZE"
    }));
  }
  summaries.sort((a, b) => a.scope.localeCompare(b.scope));
  return Object.freeze({
    project: STAGING_PROJECT,
    windowMs: 60000,
    sourceVerification: "UNVERIFIED_OFFLINE_NUMERIC_AGGREGATES",
    realStagingMetricsClaimed: false,
    calibrationDecision: "MANUAL_REVIEW_REQUIRED",
    rateLimitEnforcement: "DISABLED",
    productionAccess: "NOT_RUN",
    summaries
  });
}
function analyzeStdin(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] !== "--stdin") {
    throw new Error("RATE_LIMIT_USAGE_REQUIRES_STDIN");
  }
  const raw = fs.readFileSync(0, "utf8");
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error("RATE_LIMIT_INPUT_TOO_LARGE");
  let input;
  try { input = JSON.parse(raw); }
  catch (_) { throw new Error("RATE_LIMIT_INPUT_INVALID_JSON"); }
  return summarizeBudgetCounts(input);
}
if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(analyzeStdin(), null, 2) + "\n");
  } catch (_) {
    process.stderr.write("RATE_LIMIT_CALIBRATION=INVALID_AGGREGATED_INPUT\n");
    process.exitCode = 2;
  }
}
module.exports = Object.freeze({
  SCOPES, REQUIRED_SAMPLE_COUNT, MAX_SAMPLES_PER_SCOPE,
  summarizeBudgetCounts, analyzeStdin
});
