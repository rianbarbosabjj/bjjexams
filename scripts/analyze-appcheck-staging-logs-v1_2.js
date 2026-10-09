"use strict";

// Gate 9.1C1: analyze EXPORTED staging verification logs offline.
// No Firebase/Google/Asaas client, no authentication, no network or mutation.
const fs = require("node:fs");

const STAGING_PROJECT = "bjj-exams-staging";
const REGION = "southamerica-east1";
const VERIFICATION_LABEL = "callable-request-verification";
const STATUSES = Object.freeze(["VALID", "MISSING", "INVALID", "UNKNOWN"]);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EVENTS = 25000;

function parseExport(source) {
  if (typeof source !== "string" || !source.trim()) return [];
  let result;
  try { result = JSON.parse(source); } catch (_) {
    try { result = source.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
    catch (__) { throw new Error("APP_CHECK_EXPORT_INVALID_JSON"); }
  }
  const entries = Array.isArray(result) ? result : result?.entries;
  if (!Array.isArray(entries)) throw new Error("APP_CHECK_EXPORT_ENTRIES_REQUIRED");
  if (entries.length > MAX_EVENTS) throw new Error("APP_CHECK_EXPORT_TOO_MANY_ENTRIES");
  return entries;
}

function classify(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const resource = entry.resource || {};
  const resourceLabels = resource.labels || {};
  const logLabels = entry.labels || entry["logging.googleapis.com/labels"] || {};
  if (logLabels["firebase-log-type"] !== VERIFICATION_LABEL) return null;
  if (resourceLabels.project_id !== STAGING_PROJECT) return null;
  if (resourceLabels.location !== REGION && resourceLabels.region !== REGION) return null;
  if (resource.type !== "cloud_function" && resource.type !== "cloud_run_revision") return null;
  const name = resource.type === "cloud_function"
    ? resourceLabels.function_name : resourceLabels.service_name;
  if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(name)) return null;
  const verifications = entry.jsonPayload?.verifications;
  const appCheck = verifications?.appCheck;
  const app = verifications?.app;
  const value = (typeof appCheck === "string" && typeof app === "string" && appCheck !== app)
    ? "UNKNOWN" : (appCheck ?? app);
  const status = STATUSES.includes(value) ? value : "UNKNOWN";
  return { name, status };
}

function analyzeEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError("APP_CHECK_ENTRIES_ARRAY_REQUIRED");
  if (entries.length > MAX_EVENTS) throw new Error("APP_CHECK_EXPORT_TOO_MANY_ENTRIES");
  const totals = Object.fromEntries(STATUSES.map(status => [status, 0]));
  const perFunction = new Map();
  let excluded = 0;
  for (const entry of entries) {
    const item = classify(entry);
    if (!item) { excluded += 1; continue; }
    totals[item.status] += 1;
    if (!perFunction.has(item.name)) {
      if (perFunction.size >= 150) throw new Error("APP_CHECK_TOO_MANY_FUNCTION_NAMES");
      perFunction.set(item.name, Object.fromEntries(STATUSES.map(s => [s, 0])));
    }
    perFunction.get(item.name)[item.status] += 1;
  }
  const verified = STATUSES.reduce((sum, s) => sum + totals[s], 0);
  const functions = Object.fromEntries([...perFunction.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return {
    project: STAGING_PROJECT, region: REGION,
    eligibleEvents: verified, excludedEvents: excluded,
    totals, functions,
    evidenceStatus: verified ? "STAGING_LOGS_OBSERVED" : "NO_VERIFIABLE_STAGING_EVENTS",
    enforcementDecision: "BLOCKED_REQUIRES_MANUAL_GATE_9_1D",
    liveValidationClaimed: false,
    source: "OFFLINE_EXPORTED_LOGS_ONLY"
  };
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !argv[0] || argv[0].startsWith("--")) {
    throw new Error("APP_CHECK_USAGE: node scripts/analyze-appcheck-staging-logs-v1_2.js <export.json>");
  }
  const stat = fs.statSync(argv[0]);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("APP_CHECK_EXPORT_FILE_INVALID_OR_TOO_LARGE");
  const result = analyzeEntries(parseExport(fs.readFileSync(argv[0], "utf8")));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.eligibleEvents) process.exitCode = 2;
  return result;
}

if (require.main === module) {
  try { main(); } catch (_) {
    // No raw error text or input data can reach stdout/stderr.
    process.stderr.write("APP_CHECK_OBSERVABILITY=INVALID_EXPORT_OR_INPUT\n");
    process.exitCode = 2;
  }
}

module.exports = Object.freeze({ STAGING_PROJECT, REGION, VERIFICATION_LABEL, STATUSES, parseExport, classify, analyzeEntries, main });
