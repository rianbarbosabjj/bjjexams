"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ROOT=path.resolve(__dirname,"..");
const lock=JSON.parse(fs.readFileSync(path.join(ROOT,"functions/package-lock.json"),"utf8"));
const pkg=JSON.parse(fs.readFileSync(path.join(ROOT,"functions/package.json"),"utf8"));
const expected={
 "@grpc/grpc-js":"1.14.6",
 "brace-expansion":"2.1.7",
 "proxy-addr":"2.0.8"
};
const direct={
 axios:"1.20.0","firebase-admin":"14.4.0",
 "firebase-functions":"7.3.2","form-data":"4.0.6"
};
assert.deepEqual(pkg.dependencies,direct);
assert.deepEqual(lock.packages[""].dependencies,direct);
assert.equal(lock.lockfileVersion,3);
for(const [name,version] of Object.entries(expected)){
  const p=lock.packages["node_modules/"+name];
  assert.ok(p,"Missing patched transitive dependency "+name);
  assert.equal(p.version,version);
  assert.ok(p.resolved.startsWith("https://registry.npmjs.org/"));
  assert.match(p.integrity,/^sha512-[A-Za-z0-9+/=]+$/);
}
const remaining=["gaxios","uuid"];
for(const name of remaining){
  assert.ok(Object.keys(lock.packages).some(k=>
    k==="node_modules/"+name||k.endsWith("/node_modules/"+name)));
}
const flow=fs.readFileSync(path.join(ROOT,".github/workflows/marco8-rc-regression.yml"),"utf8");
assert.ok(flow.includes("node tests/marco9-npm-lock-fixes-v1_2.test.js"));
assert.ok(flow.includes("npm audit --prefix functions --omit=dev --json"));
assert.ok(flow.includes("node scripts/triage-npm-advisories-v1_2.js --stdin"));
assert.ok(!flow.includes("npm audit fix --"));
assert.ok(flow.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
assert.ok(flow.includes("  contents: read"));
assert.ok(!flow.includes("firebase deploy"));
assert.ok(!flow.includes("contents: write"));
const doc=fs.readFileSync(path.join(ROOT,"docs/architecture/MARCO_9_4C2_NPM_REMEDIATION.md"),"utf8");
for(const item of ["@grpc/grpc-js","brace-expansion","proxy-addr","gaxios","uuid",
"2 moderate","NO_GO","NO_DEPLOY","9.4C2"])
  assert.ok(doc.includes(item),"missing remediation note "+item);
console.log("MARCO9_4C2_PATCHED_TRANSITIVE_LOCK_DEPENDENCIES=3/3");
console.log("MARCO9_4C2_HIGH_CRITICAL_FIXED_BY_UPDATED_LOCK=CI_AUDIT_REQUIRED");
console.log("MARCO9_4C2_MODERATE_RISKS_REMAIN_OPEN=2");
console.log("MARCO9_4C2_STAGING_PRODUCTION_DEPLOY=NOT_RUN");
console.log("MARCO9_GATE_9_4C2_LOCK_PATCH_TEST=PASSED");
