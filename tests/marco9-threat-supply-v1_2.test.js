"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { inspectSupplyChain, inspectRepository } =
  require("../scripts/preflight-supply-chain-v1_2");

const ROOT = path.resolve(__dirname,"..");
const read = p => fs.readFileSync(path.join(ROOT,p),"utf8");
const threat = JSON.parse(read("docs/security/marco9-threat-model-v1_2.json"));
assert.equal(threat.schemaVersion,"9.4A");
assert.equal(threat.project,"bjj-exams-staging");
assert.equal(threat.livePentestPerformed,false);
assert.equal(threat.evidenceLevel,"REPOSITORY_REVIEW_AND_EXISTING_TEST_REFERENCES_ONLY");
assert.equal(threat.acceptance,"BLOCKED_PENDING_STAGING_VALIDATION_AND_HUMAN_REVIEW");
assert.equal(threat.scenarios.length,12);
assert.equal(new Set(threat.scenarios.map(x => x.id)).size,12);
assert.deepEqual([...new Set(threat.scenarios.map(x => x.stride))].sort(),
  [...threat.categories].sort());
const expectedFields = [
 "id","stride","flow","trustBoundary","entrypoint","threat","impact",
 "existingControl","evidenceTest","residualGap","negativeTest","status"
].sort();
for(const scenario of threat.scenarios){
  assert.deepEqual(Object.keys(scenario).sort(),expectedFields);
  for(const field of expectedFields){
    assert.equal(typeof scenario[field],"string");
    assert.ok(scenario[field].trim().length >= (field === "id" ? 3 : 4),
      "threat field missing "+field);
  }
  assert.equal(scenario.status,"REQUIRES_MANUAL_STAGING_REVIEW");
  assert.ok(scenario.entrypoint.startsWith("functions/") ||
    scenario.entrypoint.startsWith("js/") ||
    scenario.entrypoint==="firebase.staging-hosting.json");
  assert.ok(scenario.evidenceTest.startsWith("tests/"));
  assert.ok(fs.statSync(path.join(ROOT,scenario.entrypoint)).isFile(),
    "missing reviewed source "+scenario.entrypoint);
  assert.ok(fs.statSync(path.join(ROOT,scenario.evidenceTest)).isFile(),
    "missing linked test "+scenario.evidenceTest);
  assert.ok(!/production.*enabled|production.*approved/i.test(scenario.status));
}
assert.ok(threat.scenarios.some(x => /reprocessamento/i.test(x.flow)));
assert.ok(threat.scenarios.some(x => /certificados/i.test(x.flow)));
assert.ok(threat.scenarios.some(x => /exame/i.test(x.flow)));
assert.ok(threat.scenarios.some(x => /checkout/i.test(x.flow)));
assert.ok(threat.scenarios.some(x => /organiza/i.test(x.flow)));
assert.ok(threat.scenarios.some(x => /webhook/i.test(x.flow)));
assert.ok(threat.scenarios.every(x => x.residualGap && x.negativeTest));
assert.ok(!read("firebase.json").includes('"hosting"'));

const pkg = JSON.parse(read("functions/package.json"));
const lock = JSON.parse(read("functions/package-lock.json"));
const workflow = read(".github/workflows/marco8-rc-regression.yml");
const report = inspectRepository();
assert.deepEqual(report, inspectSupplyChain({pkg,lock,workflow}));
assert.equal(report.nodeCi,"22.23.2");
assert.equal(report.directDependencyCount,4);
assert.ok(report.lockedPackageCount>=10);
assert.ok(report.registryIntegrityEntries>=10);
assert.equal(report.minimumPermissions,"CONTENTS_READ_ONLY");
assert.equal(report.installationScripts,"DISABLED_IN_CI");
assert.equal(report.actionReferences,"TAG_BASED_NOT_COMMIT_SHA_PINNED");
assert.equal(report.liveVulnerabilityAuditPerformed,false);
assert.equal(report.realRegistryVerificationPerformed,false);
assert.equal(report.productionAccess,"NOT_RUN");

const mutate = fn => {const p=structuredClone(pkg),l=structuredClone(lock);
  fn(p,l);return {pkg:p,lock:l,workflow};};
assert.throws(() => inspectSupplyChain(mutate((p,l) => {
  p.dependencies.axios="^1.20.0";
})), /DEPENDENCY_DRIFT_REVIEW_REQUIRED/);
assert.throws(() => inspectSupplyChain(mutate((p,l) => {
  l.packages["node_modules/axios"].integrity="sha512-not-valid?";
})), /REGISTRY_OR_INTEGRITY_INVALID/);
assert.throws(() => inspectSupplyChain(mutate((p,l) => {
  l.packages["node_modules/axios"].resolved="https://example.invalid/axios.tgz";
})), /REGISTRY_OR_INTEGRITY_INVALID/);
assert.throws(() => inspectSupplyChain({...mutate(()=>{}),
  workflow: workflow+"permissions:\n  contents: write\n"}), /CI_BOUNDARY_INVALID/);
assert.throws(() => inspectSupplyChain({...mutate(()=>{}),
  workflow: workflow+"pull_request_target\n"}), /CI_BOUNDARY_INVALID/);
assert.throws(() => inspectSupplyChain({...mutate(()=>{}),
  workflow: workflow+"firebase deploy\n"}), /CI_BOUNDARY_INVALID/);
const doc=read("docs/architecture/MARCO_9_4_THREAT_SUPPLY_CHAIN.md");
for(const marker of [
 "9.4A","9.4B","STRIDE","bjj-exams-staging","Asaas Sandbox",
 "npm audit","TAG_BASED_NOT_COMMIT_SHA_PINNED","MANUAL_REVIEW",
 "NO_DEPLOY","NO_ENFORCEMENT"
])assert.ok(doc.includes(marker), "missing 9.4 doc: "+marker);
assert.ok(workflow.includes("node tests/marco9-threat-supply-v1_2.test.js"));
assert.ok(workflow.includes("RC_CONSOLID_REGRESSION") ||
          workflow.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
console.log("MARCO9_4A_STRIDE_CATEGORIES=6/6");
console.log("MARCO9_4A_THREATS=12/12");
console.log("MARCO9_4B_DIRECT_DEPENDENCIES=4/4");
console.log("MARCO9_4B_LOCKFILE_INTEGRITY=PASSED");
console.log("MARCO9_4B_LIVE_NPM_AUDIT=NOT_RUN");
console.log("MARCO9_4A_4B_CONTRACT=PASSED");
