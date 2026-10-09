"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {ROOT,classifySource,inventorySources,loadRepositorySources,inventoryRepository}=
  require("../scripts/inventory-operational-logs-v1_2");
function read(name){return fs.readFileSync(path.join(ROOT,name),"utf8");}
const fake=[
 {path:"functions/src/security/fake-one.js",content:
   'console.error("fake-person@example.invalid", error);\n' +
   'logger.warn("literal password FAKE-123", sanitizeOperationalError(error));\n' +
   'logger.info("synthetic stable event");\n'},
 {path:"functions/src/finance/fake-two.js",content:
   'console.error("fake", {headers: req.headers});\n'}
];
const report=inventorySources(fake);
assert.equal(report.schemaVersion,"9.5B1");
assert.equal(report.sourceFiles,2);
assert.equal(report.sinkCandidates,4);
assert.equal(report.categories.POSSIBLE_SENSITIVE_ARGUMENT_REVIEW_REQUIRED,2);
assert.equal(report.categories.SANITIZER_PRESENT_REVIEW_REQUIRED,1);
assert.equal(report.categories.MANUAL_REVIEW_REQUIRED,1);
assert.equal(report.livePIIExposureProven,false);
assert.equal(report.actualCloudLoggingAccess,"NOT_RUN");
assert.equal(report.cloudRetentionAndIAM,"NOT_INSPECTED");
assert.equal(report.retentionDecision,"RETENTION_UNAPPROVED");
assert.equal(report.releaseDecision,"NO_GO");
const safe=JSON.stringify(report);
assert.equal(safe.includes("fake-person@example.invalid"),false);
assert.equal(safe.includes("FAKE-123"),false);
assert.equal(safe.includes("password"),false);
assert.equal(safe.includes("req.headers"),false);
assert.deepEqual(classifySource('console.info("status ok")'),[
 {line:1,sink:"console.info",status:"MANUAL_REVIEW_REQUIRED"}
]);
assert.throws(()=>inventorySources([{path:"../../secret.js",content:"console.log(token)"}]),
  /LOG_INVENTORY_INPUT_INVALID/);
assert.throws(()=>inventorySources([]),/LOG_INVENTORY_INPUT_INVALID/);
const actual=inventoryRepository();
const loaded=loadRepositorySources();
assert.deepEqual(actual,inventorySources(loaded));
assert.ok(actual.sourceFiles>=15,"expected multi-module backend inventory");
assert.ok(actual.sinkCandidates>=2,"webhook operational logs must be indexed");
assert.equal(actual.sinkCandidates,Object.values(actual.categories).reduce((x,y)=>x+y,0));
assert.equal(actual.actualCloudLoggingAccess,"NOT_RUN");
assert.equal(actual.livePIIExposureProven,false);
assert.equal(actual.retentionDecision,"RETENTION_UNAPPROVED");
assert.ok(loaded.some(x=>x.path==="functions/src/finance/financial-webhook-functions.js"));
assert.ok(loaded.some(x=>x.path==="functions/index.js"));
assert.ok(JSON.stringify(actual).length<1250);
const ci=read(".github/workflows/marco8-rc-regression.yml");
assert.ok(ci.includes("node scripts/inventory-operational-logs-v1_2.js"));
assert.ok(ci.includes("node tests/marco9-log-inventory-v1_2.test.js"));
assert.ok(ci.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
assert.ok(ci.includes("  contents: read"));
assert.ok(!ci.includes("firebase deploy"));
assert.ok(!ci.includes("secrets."));
assert.ok(!ci.includes("contents: write"));
const doc=read("docs/architecture/MARCO_9_4C4_9_5B1_SECURITY_REVIEW.md");
for(const marker of ["9.4C4","9.5B1","RETENTION_UNAPPROVED","NO_DEPLOY",
  "Cloud Logging","LGPD","NO_GO","T10","MANUAL_REVIEW_REQUIRED"])
 assert.ok(doc.includes(marker),"missing document "+marker);
console.log("MARCO9_5B1_LOG_SOURCE_FILES="+actual.sourceFiles);
console.log("MARCO9_5B1_SOURCE_SINK_CANDIDATES="+actual.sinkCandidates);
console.log("MARCO9_5B1_SOURCE_INVENTORY_REDACTION=PASSED");
console.log("MARCO9_5B1_CLOUD_IAM_RETENTION=NOT_INSPECTED");
console.log("MARCO9_5B1_LGPD_RETENTION=UNAPPROVED");
console.log("MARCO9_GATE_9_5B1_LOG_INVENTORY=PASSED");
