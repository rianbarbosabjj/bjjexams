"use strict";

// Marco 9.2B3 — OFFLINE ONLY. Never connects to Firebase or manages secrets.
const fs = require("node:fs");
const path = require("node:path");
const { makeCounterId, STAGING_PROJECT, COUNTER_COLLECTION } =
  require("../functions/src/security/rate-limit-core");

const ROOT = path.resolve(__dirname, "..");
const SECRET_NAME = "BJJ_EXAMS_RATE_LIMIT_HMAC_V12";
const EXPECTED_TTL_FIELD = "expiresAt";

function readText(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}
function assert(condition, label) {
  if (!condition) throw new Error(label);
}
function assessStagingReadiness({
  manifest,
  indexes,
  mainSource,
  firestoreRules,
  testSecret = null
} = {}) {
  assert(manifest && typeof manifest === "object", "RATE_LIMIT_MANIFEST_INVALID");
  assert(manifest.purpose === "RATE_LIMIT_STAGING_PREFLIGHT_ONLY" &&
    manifest.targetProjectId === STAGING_PROJECT &&
    manifest.targetDatabase === "(default)" &&
    manifest.collectionGroup === COUNTER_COLLECTION,
    "RATE_LIMIT_STAGING_BOUNDARY_INVALID");
  assert(manifest.ttl?.fieldPath === EXPECTED_TTL_FIELD &&
    manifest.ttl?.valueType === "Firestore Timestamp" &&
    manifest.ttl?.singleFieldIndexExempt === true &&
    manifest.ttl?.activation === "NOT_APPLIED", "RATE_LIMIT_TTL_CONTRACT_INVALID");
  assert(manifest.hmac?.secretName === SECRET_NAME &&
    manifest.hmac?.minimumDecodedBytes === 32 &&
    manifest.hmac?.provisioned === false &&
    manifest.hmac?.boundToFunctions === false, "RATE_LIMIT_SECRET_CONTRACT_INVALID");
  assert(manifest.calibration?.windowMs === 60_000 &&
    manifest.calibration?.minPrincipalWindowsPerScope >= 30 &&
    manifest.calibration?.realStagingSamplesCollected === false &&
    manifest.rateLimitEnforcement === false &&
    manifest.appCheckEnforcement === false &&
    manifest.manualApprovalRequired === true,
    "RATE_LIMIT_ACTIVATION_MUST_REMAIN_BLOCKED");
  assert(Array.isArray(indexes?.indexes) && Array.isArray(indexes?.fieldOverrides),
    "RATE_LIMIT_DEFAULT_INDEXES_INVALID");
  assert(!indexes.fieldOverrides.some(field =>
    field.collectionGroup === COUNTER_COLLECTION),
    "RATE_LIMIT_TTL_MUST_NOT_BE_IN_DEFAULT_INDEXES");
  assert(typeof mainSource === "string" &&
    mainSource.includes("const adminContextReadRateLimitGuard = adminRuntimeAllowed") &&
    mainSource.includes("createRateLimitGuard({ enabled: false })") &&
    !mainSource.includes("createRateLimitGuard({ enabled: true") &&
    !mainSource.includes('defineSecret("' + SECRET_NAME + '")'),
    "RATE_LIMIT_RUNTIME_ACTIVATION_UNEXPECTED");
  assert(typeof firestoreRules === "string" &&
    firestoreRules.includes("match /{document=**}") &&
    firestoreRules.includes("allow read, write: if false;") &&
    !firestoreRules.includes("match /" + COUNTER_COLLECTION + "/"),
    "RATE_LIMIT_FIRESTORE_RULES_REQUIRE_REVIEW");

  let testKeyFormat = "NOT_TESTED";
  if (testSecret !== null) {
    assert(Buffer.isBuffer(testSecret), "RATE_LIMIT_TEST_SECRET_MUST_BE_BUFFER");
    try {
      const identifier = makeCounterId({
        projectId: STAGING_PROJECT,
        scope: "authenticated_read",
        identity: "synthetic-uid-never-real",
        secret: testSecret,
        windowIndex: 1
      });
      assert(/^[a-f0-9]{64}_1$/.test(identifier),
        "RATE_LIMIT_HMAC_TEST_VECTOR_INVALID");
      testKeyFormat = "SYNTHETIC_FORMAT_VALID";
    } catch (_) {
      throw new Error("RATE_LIMIT_TEST_SECRET_FORMAT_INVALID");
    }
  }
  return Object.freeze({
    project: STAGING_PROJECT,
    collection: COUNTER_COLLECTION,
    ttlField: EXPECTED_TTL_FIELD,
    ttlPolicy: "PLANNED_NOT_APPLIED",
    secret: "NOT_PROVISIONED_OR_VERIFIED",
    testKeyFormat,
    calibration: "REAL_STAGING_SAMPLES_NOT_COLLECTED",
    backendQuota: "DISABLED",
    appCheck: "REAL_STAGING_HOMOLOGATION_PENDING",
    activationDecision: "BLOCKED_REQUIRES_SEPARATE_STAGING_APPROVAL",
    productionAccess: "NOT_RUN",
    cloudAccess: "NOT_RUN",
    deployExecuted: false
  });
}
function inspectRepository() {
  return assessStagingReadiness({
    manifest: JSON.parse(readText("config/rate-limit-staging-readiness-v1_2.json")),
    indexes: JSON.parse(readText("firestore.indexes.json")),
    mainSource: readText("functions/main.js"),
    firestoreRules: readText("firestore.rules")
  });
}
if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(inspectRepository(), null, 2) + "\n");
  } catch (_) {
    // Do not echo incoming configuration or any value resembling a secret.
    process.stderr.write("RATE_LIMIT_STAGING_PREFLIGHT=BLOCKED\n");
    process.exitCode = 2;
  }
}
module.exports = Object.freeze({
  ROOT, SECRET_NAME, EXPECTED_TTL_FIELD,
  assessStagingReadiness, inspectRepository
});
