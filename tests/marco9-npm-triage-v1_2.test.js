"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {inspectAudit}=require("../scripts/triage-npm-advisories-v1_2");
const ROOT=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
const sample={
 auditReportVersion:2,
 metadata:{vulnerabilities:{info:0,low:0,moderate:1,high:1,critical:1,total:3}},
 vulnerabilities:{
  "firebase-admin":{severity:"high",isDirect:true,fixAvailable:{name:"firebase-admin",version:"14.5.0",isSemVerMajor:false},via:["fake private token"]},
  "a-transitive":{severity:"critical",isDirect:false,fixAvailable:{name:"firebase-admin",version:"15.0.0",isSemVerMajor:true},via:[{title:"email secret@example.invalid"}]},
  "no-auto-fix":{severity:"moderate",isDirect:false,fixAvailable:false,via:["Bearer private"]}
 }
};
const result=inspectAudit(JSON.stringify(sample));
assert.equal(result.count,3);
assert.equal(result.decision,"MANUAL_REMEDIATION_REVIEW_REQUIRED");
assert.equal(result.marco9Release,"NO_GO");
assert.equal(result.deployExecuted,false);
assert.deepEqual(result.packages.map(v=>v.package),["a-transitive","firebase-admin","no-auto-fix"]);
assert.deepEqual(result.packages.map(v=>v.fix),[
  "MAJOR_VERSION_REVIEW_REQUIRED","VERSION_REVIEW_REQUIRED","NO_KNOWN_AUTO_FIX"
]);
assert.equal(result.packages[0].fixPackage,"firebase-admin");
assert.equal(result.packages[0].fixVersion,"15.0.0");
const serialized=JSON.stringify(result);
for(const secret of ["private token","secret@example.invalid","Bearer private"])assert.ok(!serialized.includes(secret));
const invalid=structuredClone(sample);
invalid.vulnerabilities["unexpected?path"]={severity:"high",isDirect:false,fixAvailable:false};
assert.throws(()=>inspectAudit(JSON.stringify(invalid)),/NPM_TRIAGE_PACKAGE_INVALID/);
const mismatch=structuredClone(sample);
mismatch.metadata.vulnerabilities.total=99;
assert.throws(()=>inspectAudit(JSON.stringify(mismatch)),/NPM_TRIAGE_COUNT_MISMATCH/);
const invalidFix=structuredClone(sample);
invalidFix.vulnerabilities["firebase-admin"].fixAvailable={name:"firebase-admin",version:"invalid",isSemVerMajor:true};
assert.throws(()=>inspectAudit(JSON.stringify(invalidFix)),/NPM_TRIAGE_FIX_METADATA_INVALID/);
assert.throws(()=>inspectAudit("{bad json"),/NPM_TRIAGE_JSON_INVALID/);
assert.throws(()=>inspectAudit(JSON.stringify({error:{code:"OFFLINE"}})),/NPM_TRIAGE_AUDIT_REPORT_INVALID/);
const flow=read(".github/workflows/marco8-rc-regression.yml");
assert.ok(flow.includes("node scripts/triage-npm-advisories-v1_2.js --stdin"));
assert.ok(flow.includes("node tests/marco9-npm-triage-v1_2.test.js"));
assert.ok(flow.includes("npm audit --prefix functions --omit=dev --json"));
assert.ok(flow.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
assert.ok(flow.includes("  contents: read"));
assert.ok(!flow.includes("firebase deploy")&&!flow.includes("contents: write")&&!flow.includes("secrets."));
console.log("MARCO9_4C2_SAFE_VULNERABILITY_PACKAGE_TRIAGE=PASSED");
console.log("MARCO9_4C2_REMediation_SCOPE=PRODUCTION_DEPENDENCY_LOCK_ONLY");
console.log("MARCO9_4C2_REAL_AUDIT_TRIAGE=PENDING_CURRENT_CI");
console.log("MARCO9_4C2_DEPLOY=NOT_RUN");
