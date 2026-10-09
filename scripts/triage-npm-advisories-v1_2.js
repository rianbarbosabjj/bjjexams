"use strict";

// Gate 9.4C2: sanitized dependency triage from current npm audit JSON.
// Public npm package names, severity and fix metadata ONLY. Never raw advisories.
const fs=require("node:fs");
const NAME=/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i;
const VERSION=/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i;
const SEVERITIES=new Set(["low","moderate","high","critical"]);
function inspectAudit(source){
  if(typeof source!=="string" || Buffer.byteLength(source)>5*1024*1024)
    throw Error("NPM_TRIAGE_INPUT_INVALID");
  let data;
  try{data=JSON.parse(source);}catch(_){throw Error("NPM_TRIAGE_JSON_INVALID");}
  if(data?.auditReportVersion!==2 || data?.error || !data?.metadata?.vulnerabilities ||
      !data.vulnerabilities || typeof data.vulnerabilities!=="object" ||
      Array.isArray(data.vulnerabilities))throw Error("NPM_TRIAGE_AUDIT_REPORT_INVALID");
  const entries=[];
  for(const [name,v] of Object.entries(data.vulnerabilities)){
    if(!NAME.test(name) || name.length>150 ||
       !v || typeof v!=="object" || !SEVERITIES.has(v.severity) ||
       typeof v.isDirect!=="boolean")throw Error("NPM_TRIAGE_PACKAGE_INVALID");
    let suggestion="NO_KNOWN_AUTO_FIX",fixVersion=null;
    if(v.fixAvailable===true)suggestion="SEMVER_COMPATIBLE_FIX_AVAILABLE";
    else if(v.fixAvailable && typeof v.fixAvailable==="object" &&
      v.fixAvailable.isSemVerMajor===true && VERSION.test(v.fixAvailable.version) &&
      v.fixAvailable.name===name){
      suggestion="MAJOR_VERSION_REVIEW_REQUIRED";fixVersion=v.fixAvailable.version;
    }else if(v.fixAvailable && typeof v.fixAvailable==="object" &&
      v.fixAvailable.isSemVerMajor===false && VERSION.test(v.fixAvailable.version) &&
      v.fixAvailable.name===name){
      suggestion="VERSION_REVIEW_REQUIRED";fixVersion=v.fixAvailable.version;
    }else if(v.fixAvailable!==false)throw Error("NPM_TRIAGE_FIX_METADATA_INVALID");
    entries.push({package:name,severity:v.severity,direct:v.isDirect,fix:suggestion,fixVersion});
  }
  entries.sort((a,b)=>a.package.localeCompare(b.package));
  const counts=data.metadata.vulnerabilities;
  const total=Number(counts.total);
  if(!Number.isSafeInteger(total) || total<0 ||
     !["low","moderate","high","critical","info"].every(k=>Number.isSafeInteger(counts[k])&&counts[k]>=0) ||
     entries.length!==total)throw Error("NPM_TRIAGE_COUNT_MISMATCH");
  return Object.freeze({
    scope:"NPM_PRODUCTION_DEPENDENCIES_ONLY",
    packages:entries,
    count:entries.length,
    decision:"MANUAL_REMEDIATION_REVIEW_REQUIRED",
    stagingChange:"NONE",
    productionChange:"NONE",
    deployExecuted:false,
    marco9Release:"NO_GO"
  });
}
if(require.main===module){
  try{
    if(process.argv.slice(2).join(" ")!=="--stdin")throw Error("NPM_TRIAGE_STDIN_REQUIRED");
    const report=inspectAudit(fs.readFileSync(0,"utf8"));
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
  }catch(_){
    process.stderr.write("MARCO9_NPM_TRIAGE=INVALID_OR_UNAVAILABLE\n");
    process.exitCode=2;
  }
}
module.exports=Object.freeze({inspectAudit});
