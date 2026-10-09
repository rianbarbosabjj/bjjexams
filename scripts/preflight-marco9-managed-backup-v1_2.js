"use strict";

// Gate 9.6B1: fail-closed, OFFLINE evidence preflight.
// Never calls Firebase, gcloud, storage, Asaas or any network/API.
const fs=require("node:fs");
const path=require("node:path");
const ROOT=path.resolve(__dirname,"..");
const EXPECTED_DOMAINS=Object.freeze([
  "firestore_profiles_and_organizations",
  "firestore_exams_and_questions",
  "firestore_certificates",
  "firestore_courses_and_entitlements",
  "firestore_orders_and_ledger",
  "firestore_webhooks_and_idempotency",
  "firestore_audit_logs",
  "auth_users_and_claims",
  "cloud_storage",
  "firestore_rules_indexes_ttl",
  "secrets_configuration",
  "asaas_external_reconciliation"
]);
const FALSE_FIELDS=Object.freeze([
  "managedBackupInventoryVerified","restoreDestinationIsolationVerified",
  "rpoRtoApproved","backupRetentionApproved","backupIamReviewed",
  "restoreTriggerSafetyApproved","sourceDataExported",
  "stagingCloudAccess","productionCloudAccess",
  "asaasSandboxContact","cleanupInRealStaging","deployExecuted"
]);
const VALUES=Object.freeze({
  schemaVersion:"9.6B1",
  scope:"FIRESTORE_MANAGED_BACKUP_READINESS_ONLY",
  targetProject:"bjj-exams-staging",
  forbiddenProductionProject:"bjj-exams",
  executionEnvironment:"OFFLINE_MANIFEST_AND_DEMO_EMULATOR",
  managedBackupStatus:"NOT_CONFIGURED_OR_VERIFIED",
  restoreDestination:"NOT_PROVISIONED",
  operatorAuthorization:"NOT_GRANTED",
  humanRiskSignoff:"PENDING",
  unsupportedClaim:"DEMO_RESTORE_DOES_NOT_VERIFY_MANAGED_BACKUP",
  stageReleaseDecision:"NO_GO"
});
function inspectEvidence(manifest){
  if(!manifest||typeof manifest!=="object"||Array.isArray(manifest)||
     Object.keys(manifest).length!==
       Object.keys(VALUES).length+FALSE_FIELDS.length+3 ||
     Object.entries(VALUES).some(([key,value])=>manifest[key]!==value)||
     FALSE_FIELDS.some(key=>manifest[key]!==false)||
     manifest.rpoMinutes!==null||manifest.rtoMinutes!==null||
     !Array.isArray(manifest.dataDependencyDomains)||
     manifest.dataDependencyDomains.length!==EXPECTED_DOMAINS.length||
     manifest.dataDependencyDomains.some((s,i)=>s!==EXPECTED_DOMAINS[i]))
     throw Error("MARCO9_6B1_EVIDENCE_NOT_AUTHORIZED");
  return Object.freeze({
    gate:"9.6B1",
    project:"bjj-exams-staging",
    inventoryDomains:EXPECTED_DOMAINS.length,
    backupStatus:"MANAGED_BACKUP_NOT_VERIFIED",
    restoreStatus:"REAL_ISOLATED_RESTORE_NOT_PERFORMED",
    rpoRto:"NOT_DEFINED_OR_APPROVED",
    iam:"NOT_REVIEWED",
    retention:"NOT_APPROVED",
    triggerAndPaymentSafety:"NOT_APPROVED",
    operatorApproval:"NOT_GRANTED",
    emulatorDrill:"CODE_TEST_ONLY",
    stagingCloudAccess:false,
    productionCloudAccess:false,
    releaseDecision:"NO_GO"
  });
}
function inspectRepository(){
  const manifest=JSON.parse(fs.readFileSync(
    path.join(ROOT,"config/marco9-managed-backup-readiness-v1_2.json"),"utf8"));
  const result=inspectEvidence(manifest);
  const workflow=fs.readFileSync(
    path.join(ROOT,".github/workflows/marco8-rc-regression.yml"),"utf8");
  const main=fs.readFileSync(path.join(ROOT,"functions/main.js"),"utf8");
  if(!workflow.includes("node scripts/preflight-marco9-managed-backup-v1_2.js")||
     !workflow.includes("node tests/marco9-recovery-adversarial-demo-emulator-v1_2.test.js")||
     !workflow.includes("demo-bjj-exams-resilience")||
     !workflow.includes("RC_CONSOLIDATED_REGRESSION=133/133")||
     !workflow.includes("NPM_AUDIT_ZERO_REPORTED_FINDINGS=PASSED")||
     workflow.includes("firebase deploy")||
     workflow.includes("secrets.")||
     workflow.includes("contents: write")||
     !main.includes("createRateLimitGuard({ enabled: false })"))
    throw Error("MARCO9_6B1_CI_SAFETY_BOUNDARY_FAILED");
  return result;
}
if(require.main===module){
  try{
    if(process.argv.length!==2)throw Error("MARCO9_6B1_PARAMETERS_FORBIDDEN");
    process.stdout.write(JSON.stringify(inspectRepository(),null,2)+"\n");
  }catch(_){
    process.stderr.write("MARCO9_6B1_PREFLIGHT=BLOCKED\n");
    process.exitCode=2;
  }
}
module.exports=Object.freeze({
  EXPECTED_DOMAINS,FALSE_FIELDS,VALUES,inspectEvidence,inspectRepository
});
