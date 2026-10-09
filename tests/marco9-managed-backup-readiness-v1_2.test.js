"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {
 EXPECTED_DOMAINS,FALSE_FIELDS,inspectEvidence,inspectRepository
}=require("../scripts/preflight-marco9-managed-backup-v1_2");
const ROOT=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
const manifest=JSON.parse(read("config/marco9-managed-backup-readiness-v1_2.json"));
const good=inspectEvidence(manifest);
assert.equal(good.releaseDecision,"NO_GO");
assert.equal(good.inventoryDomains,12);
assert.equal(good.project,"bjj-exams-staging");
assert.equal(good.backupStatus,"MANAGED_BACKUP_NOT_VERIFIED");
assert.equal(good.rpoRto,"NOT_DEFINED_OR_APPROVED");
assert.equal(good.operatorApproval,"NOT_GRANTED");
assert.deepEqual(inspectRepository(),good);
assert.deepEqual(manifest.dataDependencyDomains,EXPECTED_DOMAINS);
const alters=[
  ["operatorAuthorization","GRANTED"],
  ["managedBackupStatus","CONFIGURED"],
  ["restoreDestination","bjj-exams"],
  ["targetProject","bjj-exams"],
  ["stageReleaseDecision","GO"],
  ["rpoMinutes",60],
  ["rtoMinutes",120],
  ["humanRiskSignoff","APPROVED"]
];
for(const [field,value] of alters){
 const fake=structuredClone(manifest);
 fake[field]=value;
 assert.throws(()=>inspectEvidence(fake),/EVIDENCE_NOT_AUTHORIZED/);
}
for(const field of FALSE_FIELDS){
 const fake=structuredClone(manifest);
 fake[field]=true;
 assert.throws(()=>inspectEvidence(fake),/EVIDENCE_NOT_AUTHORIZED/);
}
for(const corrupt of [
 {...manifest,dataDependencyDomains:[...EXPECTED_DOMAINS].reverse()},
 {...manifest,dataDependencyDomains:[...EXPECTED_DOMAINS,"new-secret"]},
 {...manifest,extraCloudPath:"gs://real-production-backups"}
])assert.throws(()=>inspectEvidence(corrupt),/EVIDENCE_NOT_AUTHORIZED/);
assert.throws(()=>inspectEvidence(null),/EVIDENCE_NOT_AUTHORIZED/);
const workflow=read(".github/workflows/marco8-rc-regression.yml");
assert.ok(workflow.includes("node tests/marco9-managed-backup-readiness-v1_2.test.js"));
assert.ok(workflow.includes("node tests/marco9-recovery-adversarial-demo-emulator-v1_2.test.js"));
assert.ok(workflow.includes("demo-bjj-exams-resilience"));
assert.ok(workflow.includes("NPM_AUDIT_ZERO_REPORTED_FINDINGS=PASSED"));
assert.ok(!workflow.includes("firebase deploy"));
assert.ok(!workflow.includes("secrets."));
const doc=read("docs/architecture/MARCO_9_6B1_MANAGED_BACKUP_READINESS.md");
for(const marker of [
 "9.6B1","NO_GO","NO_DEPLOY","RPO","RTO","Asaas Sandbox",
 "retention","IAM","Auth","TTL","Firestore Emulator","Cloud Storage",
 "NOT_CONFIGURED_OR_VERIFIED"
])assert.ok(doc.includes(marker),"missing doc marker: "+marker);
console.log("MARCO9_6B1_DATA_DEPENDENCIES=12/12");
console.log("MARCO9_6B1_UNAUTHORIZED_CLOUD_STATUS=REJECTED");
console.log("MARCO9_6B1_RPO_RTO=UNAPPROVED");
console.log("MARCO9_6B1_MANAGED_BACKUP=NOT_VERIFIED");
console.log("MARCO9_GATE_9_6B1_OFFLINE_PREFLIGHT=PASSED");
