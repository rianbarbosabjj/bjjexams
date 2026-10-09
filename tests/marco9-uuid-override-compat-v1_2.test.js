"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createRequire}=require("node:module");
const ROOT=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
const pkg=JSON.parse(read("functions/package.json"));
const lock=JSON.parse(read("functions/package-lock.json"));
const direct={axios:"1.20.0","firebase-admin":"14.4.0",
  "firebase-functions":"7.3.2","form-data":"4.0.6"};
assert.deepEqual(pkg.dependencies,direct);
assert.deepEqual(lock.packages[""].dependencies,direct);
assert.deepEqual(pkg.overrides,{uuid:"11.1.1"});
assert.equal(lock.lockfileVersion,3);
assert.equal(lock.packages["node_modules/uuid"].version,"11.1.1");
assert.ok(lock.packages["node_modules/uuid"].resolved===
  "https://registry.npmjs.org/uuid/-/uuid-11.1.1.tgz");
assert.match(lock.packages["node_modules/uuid"].integrity,/^sha512-[a-zA-Z0-9+/=]+$/);
const installed=Object.entries(lock.packages).filter(([p])=>
  p==="node_modules/uuid"||p.endsWith("/node_modules/uuid"));
assert.equal(installed.length,1,"only installed uuid should be affected by override");
for(const [name,version] of Object.entries({
  "@grpc/grpc-js":"1.14.6","brace-expansion":"2.1.7","proxy-addr":"2.0.8"
}))assert.equal(lock.packages["node_modules/"+name].version,version);

const req=createRequire(path.join(ROOT,"functions/package.json"));
const gaxios=req("gaxios");
const uuid=req("uuid");
assert.equal(typeof gaxios.request,"function");
assert.equal(typeof uuid.v4,"function");
assert.equal(typeof uuid.v3,"function");
assert.equal(typeof uuid.v5,"function");
const value=uuid.v4();
assert.match(value,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
assert.throws(()=>uuid.v3("fake",uuid.v3.DNS,new Uint8Array(4),0),RangeError);
assert.throws(()=>uuid.v5("fake",uuid.v5.DNS,new Uint8Array(4),0),RangeError);
// Parse/load public modules only; no initializeApp, network, auth or data mutation.
assert.equal(typeof req("firebase-admin/app").initializeApp,"function");
assert.equal(typeof req("firebase-admin/firestore").getFirestore,"function");

const workflow=read(".github/workflows/marco8-rc-regression.yml");
assert.ok(workflow.includes("node tests/marco9-uuid-override-compat-v1_2.test.js"));
assert.ok(workflow.includes("NPM_AUDIT_ZERO_REPORTED_FINDINGS=PASSED"));
assert.ok(workflow.includes("npm audit --prefix functions --omit=dev --json"));
assert.ok(workflow.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
assert.ok(workflow.includes("  contents: read"));
assert.ok(!workflow.includes("npm audit fix --force"));
assert.ok(!workflow.includes("UUID_PATCH_NOT_COMMITTED"));
assert.ok(!workflow.includes("firebase deploy"));
assert.ok(!workflow.includes("secrets."));
const doc=read("docs/architecture/MARCO_9_4C3_UUID_REMEDIATION.md");
for(const key of ["9.4C3","uuid","gaxios","11.1.1","0 vulnerabilities",
  "NO_GO","NO_DEPLOY","Asaas Sandbox","STRIDE","RPO/RTO"])
  assert.ok(doc.includes(key),"missing documentation marker "+key);

console.log("MARCO9_4C3_SINGLE_SCOPED_RUNTIME_UUID=11.1.1");
console.log("MARCO9_4C3_GAXIOS_CJS_IMPORT=PASSED");
console.log("MARCO9_4C3_UUID_V3_V5_BOUNDS_CHECKS=PASSED");
console.log("MARCO9_4C3_FIREBASE_MODULE_IMPORTS=PASSED");
console.log("MARCO9_4C3_DIRECT_DEPENDENCIES_UNCHANGED=4/4");
console.log("MARCO9_4C3_LIVE_AUDIT=REQUIRED_AS_SEPARATE_CI_GATE");
console.log("MARCO9_4C3_CLOUD_DEPLOY=NOT_RUN");
console.log("MARCO9_GATE_9_4C3_UUID_COMPAT=PASSED");
