"use strict";

// Gate 9.4C1: parsing already-exported npm audit JSON only.
// No network, no registry access, no raw advisories, filenames, URLs or tokens emitted.
const fs=require("node:fs");
const LIMIT=5*1024*1024;
const LEVELS=Object.freeze(["info","low","moderate","high","critical","total"]);
function classifyAuditJson(source) {
  if(typeof source!=="string" || Buffer.byteLength(source)>LIMIT || !source.trim())
    throw new Error("NPM_AUDIT_INPUT_INVALID");
  let parsed;
  try{parsed=JSON.parse(source);}catch(_){throw new Error("NPM_AUDIT_INVALID_JSON");}
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed) ||
     parsed.auditReportVersion!==2 ||
     parsed.error ||
     !parsed.metadata || !parsed.metadata.vulnerabilities)
    throw new Error("NPM_AUDIT_UNVERIFIED_REPORT");
  const raw=parsed.metadata.vulnerabilities;
  if(!LEVELS.every(k=>Number.isSafeInteger(raw[k]) && raw[k]>=0))
    throw new Error("NPM_AUDIT_COUNTS_INVALID");
  if(LEVELS.slice(0,5).reduce((n,k)=>n+raw[k],0)!==raw.total)
    throw new Error("NPM_AUDIT_COUNTS_INCONSISTENT");
  const counts=Object.fromEntries(LEVELS.map(k=>[k,raw[k]]));
  return Object.freeze({
    scanner:"npm audit",schemaVersion:2,
    scope:"functions production dependencies only (omit dev)",
    vulnerabilityCounts:counts,
    assessment:raw.total===0?"NO_REPORTED_FINDINGS_AT_SCAN_TIME":
      "FINDINGS_REQUIRE_MANUAL_SECURITY_REVIEW",
    gate9_4COperationalAcceptance:"PENDING",
    releaseDecision:"NO_GO",
    productionAccess:"NOT_RUN",
    firebaseAccess:"NOT_RUN",
    deployExecuted:false
  });
}
if(require.main===module){
  try{
    if(process.argv.length!==3||process.argv[2]!=="--stdin")
      throw new Error("NPM_AUDIT_STDIN_REQUIRED");
    const src=fs.readFileSync(0,"utf8");
    process.stdout.write(JSON.stringify(classifyAuditJson(src),null,2)+"\n");
  }catch(_){
    process.stderr.write("MARCO9_NPM_AUDIT=INVALID_OR_UNAVAILABLE\n");
    process.exitCode=2;
  }
}
module.exports=Object.freeze({LIMIT,LEVELS,classifyAuditJson});
