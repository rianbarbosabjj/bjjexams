"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {classifyAuditJson,LEVELS}=require("../scripts/summarize-npm-audit-v1_2");
const ROOT=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
const baseline={auditReportVersion:2,metadata:{vulnerabilities:{
 info:0,low:0,moderate:0,high:0,critical:0,total:0
}}};
const clean=classifyAuditJson(JSON.stringify(baseline));
assert.equal(clean.assessment,"NO_REPORTED_FINDINGS_AT_SCAN_TIME");
assert.equal(clean.releaseDecision,"NO_GO");
assert.equal(clean.gate9_4COperationalAcceptance,"PENDING");
assert.equal(clean.firebaseAccess,"NOT_RUN");
assert.equal(clean.deployExecuted,false);
assert.deepEqual(Object.keys(clean.vulnerabilityCounts),[...LEVELS]);
const input=structuredClone(baseline);
input.metadata.vulnerabilities.high=2;
input.metadata.vulnerabilities.moderate=1;
input.metadata.vulnerabilities.total=3;
input.vulnerabilities={
  "very-private-package": { via:["Bearer FAKE_PRIVATE_TOKEN"],range:"*",
   fixAvailable:false,effects:["mail-private@example.invalid"] }
};
const findings=classifyAuditJson(JSON.stringify(input));
assert.equal(findings.assessment,"FINDINGS_REQUIRE_MANUAL_SECURITY_REVIEW");
assert.equal(findings.vulnerabilityCounts.high,2);
assert.equal(findings.vulnerabilityCounts.moderate,1);
assert.equal(findings.vulnerabilityCounts.total,3);
const output=JSON.stringify(findings);
for(const secret of ["FAKE_PRIVATE_TOKEN","very-private-package",
  "mail-private@example.invalid","Bearer"])
  assert.equal(output.includes(secret),false);
const invalid=[
  "", "{not-json}", JSON.stringify({error:{code:"ENOAUDIT"}}),
  JSON.stringify({...baseline,auditReportVersion:1}),
  JSON.stringify({...baseline,metadata:{}}),
  JSON.stringify({...baseline,metadata:{vulnerabilities:{
    ...baseline.metadata.vulnerabilities,critical:-2
  }}}),
  JSON.stringify({...baseline,metadata:{vulnerabilities:{
    ...baseline.metadata.vulnerabilities,total:2
  }}}),
  JSON.stringify({...baseline,metadata:{vulnerabilities:{
    ...baseline.metadata.vulnerabilities,low:"1"
  }}})
];
for(const bad of invalid)assert.throws(()=>classifyAuditJson(bad),/NPM_AUDIT_/);
assert.throws(()=>classifyAuditJson("x".repeat(5*1024*1024+1)),/NPM_AUDIT_INPUT_INVALID/);

const ci=read(".github/workflows/marco8-rc-regression.yml");
const pins={
  "actions/checkout":"11bd71901bbe5b1630ceea73d27597364c9af683",
  "actions/setup-node":"49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/setup-java":"c5195efecf7bdfc987ee8bae7a71cb8b11521c00"
};
const actual=[...ci.matchAll(/^\s*uses:\s*(actions\/[\w-]+)@([a-f0-9]{40})\s*(?:#.*)?$/gm)]
  .map(m=>[m[1],m[2]]);
assert.equal(actual.length,3);
for(const [name,sha] of actual)assert.equal(pins[name],sha);
assert.ok(!/^\s*uses:\s*[^#\n]+@v\d+/m.test(ci));
assert.ok(ci.includes("node scripts/summarize-npm-audit-v1_2.js --stdin"));
assert.ok(ci.includes("npm audit --prefix functions --omit=dev --json"));
assert.ok(ci.includes("npm ci --prefix functions --ignore-scripts --no-audit --no-fund"));
assert.ok(ci.includes("node tests/marco9-npm-audit-ci-pins-v1_2.test.js"));
assert.ok(ci.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
assert.ok(ci.includes("  contents: read"));
assert.ok(!ci.includes("firebase deploy"));
assert.ok(!ci.includes("secrets."));
assert.ok(!ci.includes("contents: write"));
assert.ok(!ci.includes("pull_request_target"));

const plan=read("docs/architecture/MARCO_9_4C1_CI_ADVISORY_SCAN.md");
for(const item of ["9.4C1","9.4C","NO_GO","NO_DEPLOY","npm audit",
"GitHub Actions","SHA","bjj-exams-staging","NODE20","Asaas Sandbox",
"FINDINGS_REQUIRE_MANUAL_SECURITY_REVIEW","STRIDE"])
assert.ok(plan.includes(item),"Missing 9.4C1 document marker "+item);
console.log("MARCO9_4C1_NPM_AUDIT_REPORT_REDACTION=PASSED");
console.log("MARCO9_4C1_ACTION_SHAS_PINNED=3/3");
console.log("MARCO9_4C1_CI_STRICT_SOURCE_GATES=PASSED");
console.log("MARCO9_4C1_OPERATIONAL_ACCEPTANCE=PENDING");
console.log("MARCO9_GATE_9_4C1_CI_DEPENDENCY_SCANNER=PASSED");
