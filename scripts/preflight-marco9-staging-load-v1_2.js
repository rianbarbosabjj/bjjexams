"use strict";
// Gate 9.7B1: offline load/operational handoff readiness. Does not perform
// HTTP requests, configure Firebase, access Asaas, or authorize deployment.
const fs=require("node:fs");
const path=require("node:path");
const ROOT=path.resolve(__dirname,"..");
const EXPECTED_SCOPES=Object.freeze([
 "public_read","authenticated_read","organization_membership",
 "exam_lifecycle","certificates","course_entitlement",
 "checkout_asaas_sandbox_only","webhook_reprocess_sandbox_only"
]);
const PENDING=Object.freeze([
 "cloudFunctionsDeploymentVerified","stagingFirebaseAccess",
 "realLoadExecuted","asaasSandboxAccess","realPaymentRequests",
 "monitoringAndAlertsVerified","rollbackValidated","cloudCostLimitApproved",
 "loadProfileApproved","privacyReviewApproved",
 "crossOrganizationAccountsProvisioned","humanSignoff","deployExecuted"
]);
const UNSET_LIMITS=Object.freeze([
 "maxRequests","maxConcurrency","durationSeconds","maxCostBrl",
 "errorRateLimitBps","p95LatencyMs","p99LatencyMs","maxColdStartMs"
]);
const FIXED=Object.freeze({
 schemaVersion:"9.7B1",
 targetProject:"bjj-exams-staging",
 forbiddenProductionProject:"bjj-exams",
 executionMode:"OFFLINE_SYNTHETIC_ONLY",
 authorization:"NOT_GRANTED",
 releaseDecision:"NO_GO",
 productionAccess:"FORBIDDEN"
});
function inspectReadiness(m){
 const keys=[...Object.keys(FIXED),...PENDING,...UNSET_LIMITS,
   "allowedEndpoints","scopeMatrix"];
 if(!m||typeof m!=="object"||Array.isArray(m)||
    Object.keys(m).length!==keys.length||
    keys.some(k=>!Object.hasOwn(m,k))||
    Object.entries(FIXED).some(([k,v])=>m[k]!==v)||
    PENDING.some(k=>m[k]!==false)||
    UNSET_LIMITS.some(k=>m[k]!==null)||
    !Array.isArray(m.allowedEndpoints)||m.allowedEndpoints.length!==0||
    !Array.isArray(m.scopeMatrix)||
    m.scopeMatrix.length!==EXPECTED_SCOPES.length||
    m.scopeMatrix.some((s,i)=>s!==EXPECTED_SCOPES[i]))
   throw Error("MARCO9_7B1_UNAUTHORIZED_LOAD_APPROVAL_OR_SCOPE");
 return Object.freeze({
   gate:"9.7B1",project:"bjj-exams-staging",
   scenarios:EXPECTED_SCOPES.length,
   realStagingLoad:"NOT_RUN",
   financialSandbox:"NOT_ACCESSED",
   operatorAuthorization:"NOT_GRANTED",
   demandAndCostBudget:"UNAPPROVED",
   latencyAndErrorSlo:"UNAPPROVED",
   rollbackAndMonitoring:"NOT_VERIFIED",
   noAuthorizedEndpoints:true,
   deployExecuted:false,
   releaseDecision:"NO_GO"
 });
}
function safeInt(n,max){
 return Number.isSafeInteger(n)&&n>=0&&n<=max;
}
// Test-only abstract execution model. All resource units below are SYNTHETIC,
// not real cloud prices/SLOs; no URL, UID, payload or network input.
function evaluateSyntheticSamples(samples,limits){
 if(!Array.isArray(samples)||samples.length===0||samples.length>24||
    !limits||typeof limits!=="object"||
    !safeInt(limits.maxRequests,24)||limits.maxRequests===0||
    !safeInt(limits.maxConcurrency,4)||limits.maxConcurrency===0||
    !safeInt(limits.maxCostUnits,1000)||
    !safeInt(limits.maxP95Units,10000)||limits.maxP95Units===0||
    !safeInt(limits.maxErrorBps,10000)||
    samples.some(s=>!s||typeof s!=="object"||
      Object.keys(s).sort().join("|")!=="costUnits|durationUnits|failed|workers"||
      !safeInt(s.costUnits,1000)||!safeInt(s.durationUnits,10000)||
      !safeInt(s.workers,4)||s.workers===0||
      typeof s.failed!=="boolean"))
    throw Error("MARCO9_7B1_SYNTHETIC_BUDGET_INVALID");
 let totalCost=0,failed=0,peak=0;
 const durations=[];
 let stopReason="NONE";
 for(let i=0;i<samples.length;i++){
   const item=samples[i];
   // Check hard request/parallel limits BEFORE considering an event.
   if(i>=limits.maxRequests){stopReason="REQUEST_CEILING";break;}
   if(item.workers>limits.maxConcurrency){stopReason="WORKER_CEILING";break;}
   if(totalCost+item.costUnits>limits.maxCostUnits){
     stopReason="COST_CEILING";break;
   }
   totalCost+=item.costUnits;
   failed+=Number(item.failed);
   durations.push(item.durationUnits);
   peak=Math.max(peak,item.workers);
   const errorBps=Math.ceil(10000*failed/durations.length);
   const sorted=[...durations].sort((a,b)=>a-b);
   const p95=sorted[Math.ceil(sorted.length*0.95)-1];
   if(errorBps>limits.maxErrorBps){stopReason="ERROR_CEILING";break;}
   if(p95>limits.maxP95Units){stopReason="LATENCY_CEILING";break;}
 }
 return Object.freeze({
   mode:"SYNTHETIC_MODEL_ONLY",
   observed:durations.length,
   peakWorkers:peak,
   syntheticCostUnits:totalCost,
   failed,
   stopReason,
   acceptedForRealStaging:false,
   deployment:"NOT_RUN",
   releaseDecision:"NO_GO"
 });
}
function inspectRepository(){
 const read=(name)=>fs.readFileSync(path.join(ROOT,name),"utf8");
 const m=JSON.parse(read("config/marco9-staging-load-readiness-v1_2.json"));
 const backup=JSON.parse(read("config/marco9-managed-backup-readiness-v1_2.json"));
 const rc=JSON.parse(read("config/marco9-rc-evidence-v1_2.json"));
 const workflow=read(".github/workflows/marco8-rc-regression.yml");
 const main=read("functions/main.js");
 const outcome=inspectReadiness(m);
 if(backup.targetProject!=="bjj-exams-staging"||
    backup.rpoRtoApproved!==false||
    backup.managedBackupInventoryVerified!==false||
    rc.project!=="bjj-exams-staging"||
    rc.releaseDecision!=="NO_GO_UNTIL_OPERATIONAL_EVIDENCE_APPROVED"||
    rc.flags?.stagingLoadAccepted!==false||
    rc.flags?.finalRiskSignoff!==false||
    rc.flags?.productionGoLiveApproved!==false||
    rc.operationalBlockers?.find(b=>b.gate==="9.7B")?.status!==
      "NO_REAL_STAGING_ACCEPTANCE_EVIDENCE"||
    !workflow.includes("node tests/marco9-staging-load-readiness-v1_2.test.js")||
    !workflow.includes("node scripts/preflight-marco9-staging-load-v1_2.js")||
    !workflow.includes("RC_CONSOLIDATED_REGRESSION=133/133")||
    !workflow.includes("NPM_AUDIT_ZERO_REPORTED_FINDINGS=PASSED")||
    workflow.includes("firebase deploy")||
    workflow.includes("secrets.")||
    workflow.includes("contents: write")||
    !main.includes("createRateLimitGuard({ enabled: false })"))
    throw Error("MARCO9_7B1_REPOSITORY_RELEASE_BOUNDARY_FAILED");
 return outcome;
}
if(require.main===module){
 try{
   if(process.argv.length!==2)throw Error("MARCO9_7B1_ARGS_FORBIDDEN");
   process.stdout.write(JSON.stringify(inspectRepository(),null,2)+"\n");
 }catch(_){
   process.stderr.write("MARCO9_7B1_PREFLIGHT=BLOCKED\n");
   process.exitCode=2;
 }
}
module.exports=Object.freeze({
 EXPECTED_SCOPES,PENDING,UNSET_LIMITS,FIXED,
 inspectReadiness,evaluateSyntheticSamples,inspectRepository
});
