"use strict";

// Gate 9.7A: bounded emulator-only synthetic contention and fault injection.
// This does NOT load-test real Cloud Functions, checkout, Asaas or Firebase.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  STAGING_PROJECT, COUNTER_COLLECTION, POLICIES,
  makeCounterId, createFirestoreAtomicCounterStore, createRateLimitGuard
} = require("../functions/src/security/rate-limit-core");
const {
  DEMO_PROJECT, assertEmulatorOnly, runWithDemoFirestore
} = require("./helpers/marco9-demo-emulator-boundary-v1_2");

const SECRET = Buffer.from("FAKE-test-only-key-9-7A-not-for-use-with-real-data");
const ACTORS = Object.freeze(["fake-a","fake-b","fake-c","fake-d"]);
const MAX_PARALLEL = 4;
const PER_ACTOR = 6;
const MAX_TASKS = ACTORS.length * PER_ACTOR;

function percentile(values, part) {
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.ceil(sorted.length*part)-1];
}
async function runBounded(tasks, limit) {
  if (!Array.isArray(tasks) || tasks.length>24 || tasks.length===0 ||
      !Number.isInteger(limit) || limit<1 || limit>MAX_PARALLEL ||
      tasks.some(t=>typeof t!=="function")) {
    throw new Error("MARCO9_LOAD_BUDGET_EXCEEDED");
  }
  let index=0, running=0, peak=0;
  const results=new Array(tasks.length);
  await Promise.all(Array.from({length:Math.min(tasks.length,limit)},async()=>{
    for(;;) {
      const position=index++;
      if(position>=tasks.length)return;
      running++;
      peak=Math.max(peak,running);
      try { results[position]=await tasks[position](); }
      finally { running--; }
    }
  }));
  return {results,peak};
}

async function main() {
  assertEmulatorOnly();
  const project=DEMO_PROJECT;
  assert.equal(project,"demo-bjj-exams-resilience");
  assert.equal(POLICIES.checkout_mutation.limit,5);
  assert.equal(STAGING_PROJECT,"bjj-exams-staging");
  assert.throws(()=>runBounded([],4),/LOAD_BUDGET_EXCEEDED/);
  assert.throws(()=>runBounded(Array.from({length:25},()=>Promise.resolve()),4),
    /LOAD_BUDGET_EXCEEDED/);
  const root=path.resolve(__dirname,"..");
  const composition=fs.readFileSync(path.join(root,"functions/main.js"),"utf8");
  assert.ok(composition.includes("createRateLimitGuard({ enabled: false })"));
  assert.ok(!composition.includes("createRateLimitGuard({ enabled: true"));

  await runWithDemoFirestore("bounded-load",async({db})=>{
    const store=createFirestoreAtomicCounterStore({db});
    const now=12_000,scope="checkout_mutation";
    const keys=ACTORS.map(identity=>makeCounterId({
      projectId:STAGING_PROJECT,scope,identity,secret:SECRET,windowIndex:0
    }));
    for(const key of keys)assert.equal((await db.collection(COUNTER_COLLECTION).doc(key).get()).exists,false);
    try {
      const guard=createRateLimitGuard({
        enabled:true,projectId:STAGING_PROJECT,secret:SECRET,store,clock:()=>now
      });
      const tasks=[];
      for(let iteration=0;iteration<PER_ACTOR;iteration++) {
        for(const identity of ACTORS)tasks.push(async()=>{
          const t=process.hrtime.bigint();
          const verdict=await guard.check({scope,identity});
          const elapsedMs=Number(process.hrtime.bigint()-t)/1e6;
          return {identity,verdict,elapsedMs};
        });
      }
      assert.equal(tasks.length,MAX_TASKS);
      const {results,peak}=await runBounded(tasks,MAX_PARALLEL);
      assert.ok(peak<=MAX_PARALLEL);
      assert.equal(results.length,24);
      assert.ok(results.every(r=>Number.isFinite(r.elapsedMs)&&r.elapsedMs>=0));
      assert.equal(results.filter(r=>r.verdict.allowed).length,20);
      assert.equal(results.filter(r=>!r.verdict.allowed).length,4);
      assert.ok(results.every(r=>r.verdict.status==="ALLOW"||r.verdict.status==="RATE_LIMITED"),
        "No infrastructure degradation allowed in healthy demo emulator");
      for(const identity of ACTORS){
        const resultsFor=results.filter(r=>r.identity===identity);
        assert.equal(resultsFor.length,6);
        assert.equal(resultsFor.filter(r=>r.verdict.allowed).length,5);
        assert.equal(resultsFor.filter(r=>!r.verdict.allowed).length,1);
      }
      const docs=await Promise.all(keys.map(id=>db.collection(COUNTER_COLLECTION).doc(id).get()));
      assert.ok(docs.every(s=>s.exists&&s.data().count===5));
      assert.ok(keys.every(key=>!ACTORS.some(id=>key.includes(id))));

      const durations=results.map(r=>r.elapsedMs);
      const p50=percentile(durations,0.5),p95=percentile(durations,0.95);
      assert.ok(p95>=p50&&p95<Infinity);
      // Diagnostics only: these are emulator measurements, never cloud SLOs.
      console.log("MARCO9_7A_EMULATOR_REQUESTS=24");
      console.log("MARCO9_7A_CONCURRENT_WORKERS="+peak+"/4");
      console.log("MARCO9_7A_QUOTA_RESULTS=20_ALLOWED_4_LIMITED");
      console.log("MARCO9_7A_EMULATOR_P50_MS="+p50.toFixed(1));
      console.log("MARCO9_7A_EMULATOR_P95_MS="+p95.toFixed(1));

      const outage=createRateLimitGuard({
        enabled:true,projectId:STAGING_PROJECT,secret:SECRET,
        store:{async consumeAtomic(){throw Error("SYNTHETIC_PRIVATE_TOKEN_999");}},
        clock:()=>now
      });
      const mutation=await outage.check({scope:"checkout_mutation",identity:"fake-e"});
      const read=await outage.check({scope:"public_read",identity:"fake-e"});
      assert.deepEqual(mutation,{allowed:false,enforced:true,status:"GUARD_UNAVAILABLE",retryAfterSeconds:5});
      assert.deepEqual(read,{allowed:true,enforced:true,status:"DEGRADED_READ_ONLY",retryAfterSeconds:0});
      assert.equal(JSON.stringify([mutation,read]).includes("SYNTHETIC_PRIVATE_TOKEN"),false);
      console.log("MARCO9_7A_FAULT_INJECTION=PASSED");
    }finally {
      const cleanup=db.batch();
      for(const key of keys)cleanup.delete(db.collection(COUNTER_COLLECTION).doc(key));
      await cleanup.commit();
      const remaining=await Promise.all(keys.map(k=>db.collection(COUNTER_COLLECTION).doc(k).get()));
      assert.ok(remaining.every(s=>!s.exists));
      console.log("MARCO9_7A_EMULATOR_CLEANUP=4/4_ABSENT");
    }
  });
  console.log("MARCO9_7A_CLOUD_FUNCTION_LOAD=NOT_TESTED");
  console.log("MARCO9_7A_REAL_PAYMENTS=NOT_RUN");
  console.log("MARCO9_7A_STAGING_LOAD=NOT_RUN");
  console.log("MARCO9_7A_RATE_LIMIT_ENFORCEMENT=NOT_ENABLED");
  console.log("MARCO9_GATE_9_7A_BOUNDED_DEMO_LOAD=PASSED");
}
main().catch(error=>{
  console.error("MARCO9_7A_LOAD_DEMO=FAILED",error?.code||"ASSERTION_FAILED");
  process.exitCode=1;
});
