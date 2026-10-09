"use strict";

// Gate 9.8A: repository-only RC readiness check. A GREEN CI validates NO_GO;
// it does not mean staging acceptance, production launch, or deploy approval.
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const STAGING = "bjj-exams-staging";
const PRODUCTION = "bjj-exams";
const EXPECTED_CODE_GATES = Object.freeze([
  "9.0A","9.1A","9.1B1","9.1B2","9.1C1","9.1C2A",
  "9.2A","9.2B1","9.2B2","9.2B3",
  "9.3A","9.3B","9.4A","9.4B","9.5A","9.6A","9.7A"
]);
const EXPECTED_BLOCKERS = Object.freeze([
  "9.1C2B","9.1D","9.2B4","9.3C","9.3D",
  "9.4C","9.5B","9.6B","9.7B","9.8B"
]);
const EXPECTED_FLAGS = Object.freeze([
  "liveAppCheckValidated","appCheckEnforcementEnabled",
  "rateLimitEnforcementEnabled","realHmacProvisioned",
  "firestoreTtlApplied","cspHeaderDeployed","cspEnforcementEnabled",
  "liveSupplyChainAuditCompleted","logRetentionApproved",
  "managedBackupRestoreVerified","rpoRtoApproved","stagingLoadAccepted",
  "finalRiskSignoff","productionGoLiveApproved"
]);
function fail(label) { throw new Error("MARCO9_RC_" + label); }
function exactKeys(value, names) {
  return !!value && typeof value === "object" &&
    !Array.isArray(value) && Object.keys(value).length === names.length &&
    names.every(name => Object.hasOwn(value,name));
}
function safeFile(relative) {
  if(typeof relative !== "string" ||
     !/^(?:tests\/[\w.-]+\.test\.js|docs\/architecture\/[\w.-]+\.md)$/.test(relative))
    fail("EVIDENCE_PATH_INVALID");
  const file = path.resolve(ROOT,relative);
  if (!file.startsWith(ROOT+path.sep)) fail("EVIDENCE_OUTSIDE_REPOSITORY");
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("EVIDENCE_NOT_REGULAR_FILE");
  return file;
}
function inspectReleaseReadiness({registry,rateManifest,hosting,primaryFirebase,mainSource,workflow}={}) {
  if (!registry || registry.schemaVersion !== "9.8A" ||
      registry.release !== "bjj-exams-v1.2" ||
      registry.project !== STAGING ||
      registry.productionProject !== PRODUCTION ||
      registry.branch !== "develop-v1.2" ||
      registry.basisMergeCommit !== "3a21df188c55eb353bb3ff48c39a819e28bcdffd" ||
      registry.dataClass !== "REPOSITORY_ONLY_SYNTHETIC_NO_PII" ||
      registry.preparedFor !== "MARCO_9_RC_PRECHECK_ONLY" ||
      registry.releaseDecision !== "NO_GO_UNTIL_OPERATIONAL_EVIDENCE_APPROVED" ||
      registry.gitMergeIsNotDeployment !== true ||
      registry.stagingDeploymentExecutedByThisGate !== false ||
      registry.productionAccess !== "FORBIDDEN") fail("RELEASE_BOUNDARY_INVALID");
  if (!Array.isArray(registry.codeGates) ||
      registry.codeGates.length !== EXPECTED_CODE_GATES.length ||
      !Array.isArray(registry.operationalBlockers) ||
      registry.operationalBlockers.length !== EXPECTED_BLOCKERS.length) fail("EVIDENCE_MANIFEST_COUNT_INVALID");
  if (!exactKeys(registry.flags,EXPECTED_FLAGS) ||
      EXPECTED_FLAGS.some(k => registry.flags[k] !== false)) fail("UNVERIFIED_ACTIVATION_OR_ACCEPTANCE_CLAIM");

  const registeredGates = registry.codeGates.map(x => x.gate);
  if (registeredGates.join("|") !== EXPECTED_CODE_GATES.join("|"))
    fail("CODE_EVIDENCE_GATE_DRIFT");
  for (const gate of registry.codeGates) {
    if (!exactKeys(gate,["gate","pr","evidence","scope","status"]) ||
        !Number.isSafeInteger(gate.pr) || gate.pr < 22 || gate.pr > 35 ||
        typeof gate.scope !== "string" || !gate.scope.trim() ||
        gate.status !== "CODE_EVIDENCE_ONLY" ||
        typeof gate.evidence !== "string" ||
        !/^tests\/[\w.-]+\.test\.js$/.test(gate.evidence)) fail("CODE_GATE_INVALID");
    safeFile(gate.evidence);
    if (typeof workflow !== "string" ||
        !workflow.includes("node " + gate.evidence)) fail("EVIDENCE_NOT_IN_CI");
  }
  const blockerGates = registry.operationalBlockers.map(x => x.gate);
  if (blockerGates.join("|") !== EXPECTED_BLOCKERS.join("|"))
    fail("REQUIRED_OPERATIONAL_BLOCKER_REMOVED");
  for (const blocker of registry.operationalBlockers) {
    if(!exactKeys(blocker,["gate","requirement","evidenceType","plan","status"]) ||
       typeof blocker.requirement !== "string" || blocker.requirement.length < 15 ||
       typeof blocker.evidenceType !== "string" || blocker.evidenceType.length < 5 ||
       blocker.status !== "NO_REAL_STAGING_ACCEPTANCE_EVIDENCE") fail("OPERATIONAL_BLOCKER_INVALID");
    safeFile(blocker.plan);
  }
  if (!rateManifest || rateManifest.targetProjectId !== STAGING ||
      rateManifest.hmac?.provisioned !== false ||
      rateManifest.hmac?.boundToFunctions !== false ||
      rateManifest.ttl?.activation !== "NOT_APPLIED" ||
      rateManifest.rateLimitEnforcement !== false ||
      rateManifest.appCheckEnforcement !== false ||
      rateManifest.calibration?.realStagingSamplesCollected !== false) fail("RATE_LIMIT_GUARD_VIOLATED");
  if (!hosting || hosting.hosting?.site !== STAGING ||
      hosting.hosting?.public !== ".firebase-hosting-staging" ||
      !Array.isArray(hosting.hosting.headers) ||
      !primaryFirebase || Object.hasOwn(primaryFirebase,"hosting")) fail("HOSTING_PROJECT_BOUNDARY_VIOLATED");
  const headers=hosting.hosting.headers.flatMap(x=>x.headers||[]);
  if (headers.some(x=>/^content-security-policy$/i.test(x.key)) ||
      headers.filter(x=>/^content-security-policy-report-only$/i.test(x.key)).length !== 2 ||
      headers.some(x=>/^(?:report-to|reporting-endpoints)$/i.test(x.key)))
    fail("CSP_STAGING_ONLY_REPORT_ONLY_REQUIRED");
  if (typeof mainSource !== "string" ||
      !mainSource.includes("createRateLimitGuard({ enabled: false })") ||
      mainSource.includes("createRateLimitGuard({ enabled: true") ||
      !mainSource.includes('const STAGING_PROJECT_ID = "bjj-exams-staging"'))
    fail("BACKEND_QUOTA_INVARIANT_FAILED");
  if (!workflow.includes("  contents: read") ||
      !workflow.includes("RC_CONSOLIDATED_REGRESSION=133/133") ||
      !workflow.includes("node tests/marco9-recovery-demo-emulator-v1_2.test.js") ||
      !workflow.includes("node tests/marco9-bounded-load-demo-emulator-v1_2.test.js") ||
      !workflow.includes("node tests/marco9-rc-readiness-v1_2.test.js") ||
      workflow.includes("pull_request_target") ||
      workflow.includes("firebase deploy") ||
      workflow.includes("contents: write") ||
      workflow.includes("secrets."))
    fail("CI_BOUNDARY_INVALID");

  return Object.freeze({
    project:STAGING,branch:"develop-v1.2",
    repoCodeEvidence:EXPECTED_CODE_GATES.length,
    operationalBlockers:EXPECTED_BLOCKERS.length,
    codeEvidenceLevel:"REPOSITORY_TEST_REFERENCES_ONLY",
    approvalEvidenceLevel:"REAL_STAGING_AND_HUMAN_REVIEW_MISSING",
    rcDecision:"NO_GO",marco9Complete:false,
    marco10ProductionAuthorized:false,
    appCheck:"REAL_STAGING_VALIDATION_PENDING",
    rateLimit:"DISABLED_HMAC_TTL_NOT_CONFIGURED",
    csp:"REPORT_ONLY_VERSIONED_NOT_DEPLOYED",
    backup:"SYNTHETIC_EMULATOR_ONLY",
    load:"BOUNDED_EMULATOR_ONLY",
    privacy:"RETENTION_UNAPPROVED",
    liveVulnerabilityAudit:"NOT_RUN",
    deployExecuted:false,productionAccess:"FORBIDDEN",
    nextGate:"9.8B_MANUAL_STAGING_ACCEPTANCE_AND_SIGNOFF"
  });
}
function inspectRepository() {
  const read = file => fs.readFileSync(path.join(ROOT,file),"utf8");
  return inspectReleaseReadiness({
    registry:JSON.parse(read("config/marco9-rc-evidence-v1_2.json")),
    rateManifest:JSON.parse(read("config/rate-limit-staging-readiness-v1_2.json")),
    hosting:JSON.parse(read("firebase.staging-hosting.json")),
    primaryFirebase:JSON.parse(read("firebase.json")),
    mainSource:read("functions/main.js"),
    workflow:read(".github/workflows/marco8-rc-regression.yml")
  });
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(inspectRepository(),null,2)+"\n"); }
  catch (_) {
    process.stderr.write("MARCO9_8A_RC_READINESS=PREFLIGHT_BLOCKED\n");
    process.exitCode=2;
  }
}
module.exports=Object.freeze({
  ROOT,EXPECTED_CODE_GATES,EXPECTED_BLOCKERS,EXPECTED_FLAGS,
  inspectReleaseReadiness,inspectRepository
});
