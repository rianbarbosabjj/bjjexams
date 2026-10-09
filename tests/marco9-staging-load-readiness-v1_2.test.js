"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {
 EXPECTED_SCOPES,PENDING,UNSET_LIMITS,
 inspectReadiness,evaluateSyntheticSamples,inspectRepository
}=require("../scripts/preflight-marco9-staging-load-v1_2");
const ROOT=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
const manifest=JSON.parse(read("config/marco9-staging-load-readiness-v1_2.json"));
const result=inspectRepository();
assert.deepEqual(result,inspectReadiness(manifest));
assert.equal(result.scenarios,8);
assert.equal(result.releaseDecision,"NO_GO");
assert.equal(result.noAuthorizedEndpoints,true);
assert.equal(result.realStagingLoad,"NOT_RUN");
assert.equal(result.operatorAuthorization,"NOT_GRANTED");
assert.equal(result.financialSandbox,"NOT_ACCESSED");
assert.deepEqual(manifest.scopeMatrix,EXPECTED_SCOPES);
const bad=[
 ["targetProject","bjj-exams"],["forbiddenProductionProject","other"],
 ["executionMode","REAL_STAGING"],["authorization","GRANTED"],
 ["releaseDecision","GO"],["productionAccess","ALLOWED"],
 ["maxRequests",24],["maxCostBrl",10],["maxConcurrency",2],
 ["p95LatencyMs",500],["p99LatencyMs",1000],
 ["errorRateLimitBps",100],["durationSeconds",30],
 ["allowedEndpoints",["https://bjj-exams-staging.web.app"]]
];
for(const [k,v] of bad){
 const altered=structuredClone(manifest);
 altered[k]=v;
 assert.throws(()=>inspectReadiness(altered),
   /MARCO9_7B1_UNAUTHORIZED_LOAD_APPROVAL_OR_SCOPE/);
}
for(const key of PENDING){
 const altered=structuredClone(manifest);
 altered[key]=true;
 assert.throws(()=>inspectReadiness(altered),
   /MARCO9_7B1_UNAUTHORIZED_LOAD_APPROVAL_OR_SCOPE/);
}
for(const key of UNSET_LIMITS){
 const altered=structuredClone(manifest);
 altered[key]=0;
 assert.throws(()=>inspectReadiness(altered),
   /MARCO9_7B1_UNAUTHORIZED_LOAD_APPROVAL_OR_SCOPE/);
}
for(const badScopes of [
 [...EXPECTED_SCOPES].reverse(),
 [...EXPECTED_SCOPES,"real_payment"],
 EXPECTED_SCOPES.slice(0,4)
]){
 const altered=structuredClone(manifest);
 altered.scopeMatrix=badScopes;
 assert.throws(()=>inspectReadiness(altered),
   /MARCO9_7B1_UNAUTHORIZED_LOAD_APPROVAL_OR_SCOPE/);
}
const sample=(costUnits=1,durationUnits=10,failed=false,workers=1)=>({
 costUnits,durationUnits,failed,workers
});
const limits={maxRequests:4,maxConcurrency:2,
 maxCostUnits:6,maxP95Units:100,maxErrorBps:5000};
const good=evaluateSyntheticSamples([sample(),sample(2,20)],limits);
assert.equal(good.mode,"SYNTHETIC_MODEL_ONLY");
assert.equal(good.observed,2);
assert.equal(good.peakWorkers,1);
assert.equal(good.stopReason,"NONE");
assert.equal(good.acceptedForRealStaging,false);
assert.equal(good.releaseDecision,"NO_GO");
const overRequests=evaluateSyntheticSamples(Array.from({length:5},()=>sample()),limits);
assert.equal(overRequests.stopReason,"REQUEST_CEILING");
assert.equal(overRequests.observed,4);
const overWorkers=evaluateSyntheticSamples([sample(1,10,false,3)],limits);
assert.equal(overWorkers.stopReason,"WORKER_CEILING");
assert.equal(overWorkers.observed,0);
const overCost=evaluateSyntheticSamples([sample(5),sample(2)],limits);
assert.equal(overCost.stopReason,"COST_CEILING");
assert.equal(overCost.observed,1);
assert.equal(overCost.syntheticCostUnits,5);
const overError=evaluateSyntheticSamples([sample(1,10,true)],limits);
assert.equal(overError.stopReason,"ERROR_CEILING");
assert.equal(overError.failed,1);
const overLatency=evaluateSyntheticSamples([sample(1,200,false)],limits);
assert.equal(overLatency.stopReason,"LATENCY_CEILING");
assert.equal(overLatency.observed,1);
for(const samples of [
 [],[sample(1,10,false,0)],[sample(1,10,false,5)],
 [sample(-1)],[sample(1,-1)],[{...sample(),identity:"secret"}],
 Array.from({length:25},()=>sample())
]){
 assert.throws(()=>evaluateSyntheticSamples(samples,limits),
 /MARCO9_7B1_SYNTHETIC_BUDGET_INVALID/);
}
for(const invalid of [{...limits,maxRequests:0},{...limits,maxConcurrency:5},
 {...limits,maxCostUnits:-1},{...limits,maxP95Units:0},
 {...limits,maxErrorBps:10001}]){
 assert.throws(()=>evaluateSyntheticSamples([sample()],invalid),
 /MARCO9_7B1_SYNTHETIC_BUDGET_INVALID/);
}
const doc=read("docs/architecture/MARCO_9_7B1_STAGING_LOAD_HANDOFF.md");
for(const word of [
 "9.7B1","NO_GO","NO_DEPLOY","NO_ENFORCEMENT",
 "Asaas Sandbox","bjj-exams-staging","RPO/RTO",
 "p95","p99","cold starts","Cloud Logging","LGPD",
 "rollback","9.8B","8 cenários","orçamento"
])assert.ok(doc.includes(word),"missing runbook term "+word);
const ci=read(".github/workflows/marco8-rc-regression.yml");
assert.ok(ci.includes("node scripts/preflight-marco9-staging-load-v1_2.js"));
assert.ok(ci.includes("node tests/marco9-staging-load-readiness-v1_2.test.js"));
assert.ok(ci.includes("NPM_AUDIT_ZERO_REPORTED_FINDINGS=PASSED"));
assert.ok(ci.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
assert.ok(!ci.includes("firebase deploy"));
assert.ok(!ci.includes("secrets."));
console.log("MARCO9_7B1_OFFLINE_SCENARIOS=8/8");
console.log("MARCO9_7B1_SYNTHETIC_STOP_CONDITIONS=5/5");
console.log("MARCO9_7B1_FORGED_AUTHORIZATION_AND_SLO=REJECTED");
console.log("MARCO9_7B1_STAGING_CLOUD_LOAD=NOT_RUN");
console.log("MARCO9_7B1_SANDBOX_PAYMENT_REQUESTS=NOT_RUN");
console.log("MARCO9_7B1_REAL_COST_RPO_RTO=UNAPPROVED");
console.log("MARCO9_GATE_9_7B1_LOAD_READINESS=PASSED");
