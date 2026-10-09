"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {
  ROOT,EXPECTED_CODE_GATES,EXPECTED_BLOCKERS,EXPECTED_FLAGS,
  inspectReleaseReadiness,inspectRepository
}=require("../scripts/preflight-marco9-rc-v1_2");
const read=name=>fs.readFileSync(path.join(ROOT,name),"utf8");
function inputs() {
  return {
    registry:JSON.parse(read("config/marco9-rc-evidence-v1_2.json")),
    rateManifest:JSON.parse(read("config/rate-limit-staging-readiness-v1_2.json")),
    hosting:JSON.parse(read("firebase.staging-hosting.json")),
    primaryFirebase:JSON.parse(read("firebase.json")),
    mainSource:read("functions/main.js"),
    workflow:read(".github/workflows/marco8-rc-regression.yml")
  };
}
const baseline=inputs();
const report=inspectRepository();
assert.deepEqual(report,inspectReleaseReadiness(baseline));
assert.equal(report.project,"bjj-exams-staging");
assert.equal(report.repoCodeEvidence,17);
assert.equal(report.operationalBlockers,10);
assert.equal(report.rcDecision,"NO_GO");
assert.equal(report.marco9Complete,false);
assert.equal(report.marco10ProductionAuthorized,false);
assert.equal(report.deployExecuted,false);
assert.equal(report.productionAccess,"FORBIDDEN");
assert.equal(report.appCheck,"REAL_STAGING_VALIDATION_PENDING");
assert.equal(report.rateLimit,"DISABLED_HMAC_TTL_NOT_CONFIGURED");
assert.equal(report.csp,"REPORT_ONLY_VERSIONED_NOT_DEPLOYED");
assert.equal(report.backup,"SYNTHETIC_EMULATOR_ONLY");
assert.equal(report.load,"BOUNDED_EMULATOR_ONLY");
assert.equal(report.privacy,"RETENTION_UNAPPROVED");
assert.equal(report.liveVulnerabilityAudit,"NOT_RUN");
assert.equal(report.approvalEvidenceLevel,"REAL_STAGING_AND_HUMAN_REVIEW_MISSING");
assert.equal(report.nextGate,"9.8B_MANUAL_STAGING_ACCEPTANCE_AND_SIGNOFF");
assert.deepEqual(baseline.registry.codeGates.map(x=>x.gate),[...EXPECTED_CODE_GATES]);
assert.deepEqual(baseline.registry.operationalBlockers.map(x=>x.gate),[...EXPECTED_BLOCKERS]);
assert.deepEqual(Object.keys(baseline.registry.flags),[...EXPECTED_FLAGS]);
assert.ok(Object.values(baseline.registry.flags).every(v=>v===false));

function rejectWith(mutator,error) {
  const copy=structuredClone(baseline);
  mutator(copy);
  assert.throws(()=>inspectReleaseReadiness(copy),error);
}
rejectWith(x=>{x.registry.project="bjj-exams";},/RELEASE_BOUNDARY_INVALID/);
rejectWith(x=>{x.registry.branch="main";},/RELEASE_BOUNDARY_INVALID/);
rejectWith(x=>{x.registry.releaseDecision="READY_FOR_PRODUCTION";},/RELEASE_BOUNDARY_INVALID/);
rejectWith(x=>{x.registry.productionAccess="ALLOWED";},/RELEASE_BOUNDARY_INVALID/);
rejectWith(x=>{x.registry.stagingDeploymentExecutedByThisGate=true;},/RELEASE_BOUNDARY_INVALID/);
rejectWith(x=>{x.registry.flags.liveAppCheckValidated=true;},/UNVERIFIED_ACTIVATION_OR_ACCEPTANCE_CLAIM/);
rejectWith(x=>{x.registry.flags.productionGoLiveApproved=true;},/UNVERIFIED_ACTIVATION_OR_ACCEPTANCE_CLAIM/);
rejectWith(x=>{x.registry.flags.rpoRtoApproved=true;},/UNVERIFIED_ACTIVATION_OR_ACCEPTANCE_CLAIM/);
rejectWith(x=>{x.registry.flags.extraUnknownFlag=false;},/UNVERIFIED_ACTIVATION_OR_ACCEPTANCE_CLAIM/);
rejectWith(x=>{x.registry.codeGates.pop();},/EVIDENCE_MANIFEST_COUNT_INVALID/);
rejectWith(x=>{x.registry.codeGates[0].status="DEPLOYED";},/CODE_GATE_INVALID/);
rejectWith(x=>{x.registry.codeGates[0].evidence="tests/does-not-exist.test.js";},
  /EVIDENCE_NOT_REGULAR_FILE|ENOENT/);
rejectWith(x=>{x.registry.codeGates[0].evidence="../../secrets.json";},/CODE_GATE_INVALID/);
rejectWith(x=>{x.registry.operationalBlockers.pop();},/EVIDENCE_MANIFEST_COUNT_INVALID/);
rejectWith(x=>{x.registry.operationalBlockers[0].gate="9.0A";},/REQUIRED_OPERATIONAL_BLOCKER_REMOVED/);
rejectWith(x=>{x.registry.operationalBlockers[0].status="APPROVED";},/OPERATIONAL_BLOCKER_INVALID/);
rejectWith(x=>{x.rateManifest.hmac.provisioned=true;},/RATE_LIMIT_GUARD_VIOLATED/);
rejectWith(x=>{x.rateManifest.ttl.activation="ENABLED";},/RATE_LIMIT_GUARD_VIOLATED/);
rejectWith(x=>{x.rateManifest.calibration.realStagingSamplesCollected=true;},/RATE_LIMIT_GUARD_VIOLATED/);
rejectWith(x=>{x.hosting.hosting.site="bjj-exams";},/HOSTING_PROJECT_BOUNDARY_VIOLATED/);
rejectWith(x=>{x.primaryFirebase.hosting={public:"public"};},/HOSTING_PROJECT_BOUNDARY_VIOLATED/);
rejectWith(x=>{x.hosting.hosting.headers[0].headers.push({
  key:"Content-Security-Policy",value:"default-src 'none'"
});},/CSP_STAGING_ONLY_REPORT_ONLY_REQUIRED/);
rejectWith(x=>{x.mainSource=x.mainSource.replace(
  "createRateLimitGuard({ enabled: false })",
  "createRateLimitGuard({ enabled: true })");
},/BACKEND_QUOTA_INVARIANT_FAILED/);
rejectWith(x=>{x.workflow += "\npermissions: contents: write\n";},/CI_BOUNDARY_INVALID/);
rejectWith(x=>{x.workflow += "\nfirebase deploy --only functions\n";},/CI_BOUNDARY_INVALID/);

const docs=read("docs/architecture/MARCO_9_8_RC_PREFLIGHT.md");
for(const marker of [
  "Gate 9.8A","Gate 9.8B","NO_GO","17","10",
  "bjj-exams-staging","App Check","CSP","HMAC","TTL","RPO/RTO",
  "Asaas Sandbox","LGPD","NO_DEPLOY","NO_ENFORCEMENT","Marco 10",
  "GitHub Actions","rollback","staging"
]) assert.ok(docs.includes(marker),"Missing release planning contract: "+marker);
const workflow=read(".github/workflows/marco8-rc-regression.yml");
assert.ok(workflow.includes("node scripts/preflight-marco9-rc-v1_2.js"));
assert.ok(workflow.includes("node tests/marco9-rc-readiness-v1_2.test.js"));
assert.ok(workflow.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
assert.ok(workflow.includes("  contents: read"));
assert.ok(!workflow.includes("pull_request_target"));
assert.ok(!workflow.includes("firebase deploy"));
assert.ok(!workflow.includes("secrets."));
assert.ok(!workflow.includes("contents: write"));

const serialized=JSON.stringify(report);
for(const privateValue of [
  "Authorization","Bearer","private@example.invalid",
  "accountNumber","sessionToken","secretValue"
])assert.equal(serialized.includes(privateValue),false);
console.log("MARCO9_8A_CODE_EVIDENCE_GATES=17/17");
console.log("MARCO9_8A_UNVERIFIED_OPERATIONAL_BLOCKERS=10/10");
console.log("MARCO9_8A_GUARDS_NO_GO=PASSED");
console.log("MARCO9_8A_DEPLOY=NOT_RUN");
console.log("MARCO9_8A_PRODUCTION_ACCESS=FORBIDDEN");
console.log("MARCO9_8A_FINAL_RELEASE_DECISION=NO_GO");
console.log("MARCO9_GATE_9_8A_RC_PREFLIGHT=PASSED");
