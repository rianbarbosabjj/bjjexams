"use strict";

// Gate 9.1C2C/9.3C1: LOCAL-ONLY staging artifact acceptance and rollback proof.
// No Firebase SDK, CLI, cloud credentials, network, payments, or deployments.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  ROOT, OUT_DIR, ALLOWED_FILES
} = require("./build-staging-hosting-v1_2");
const {
  PROJECT_ID, PUBLIC_PAGES, BOOTSTRAP_TAG, validatePublicSiteKey
} = require("./prepare-staging-appcheck-sitekey-v1_2");

function ensureRegularFile(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink())
    throw Error("STAGING_ARTIFACT_UNSAFE_FILE");
}
function walkFiles(root) {
  const names = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir,{withFileTypes:true})) {
      const abs = path.join(dir,item.name);
      if (item.isSymbolicLink())
        throw Error("STAGING_ARTIFACT_SYMLINK_BLOCKED");
      if (item.isDirectory()) walk(abs);
      else if (item.isFile()) names.push(path.relative(root,abs).split(path.sep).join("/"));
      else throw Error("STAGING_ARTIFACT_UNSUPPORTED_ITEM");
    }
  }
  walk(root);
  return names.sort();
}
function validateStagingHostingConfig() {
  const production = JSON.parse(fs.readFileSync(path.join(ROOT,"firebase.json"),"utf8"));
  const stage = JSON.parse(fs.readFileSync(path.join(ROOT,"firebase.staging-hosting.json"),"utf8"));
  if (Object.hasOwn(production,"hosting") ||
      stage.hosting?.site !== PROJECT_ID ||
      stage.hosting?.public !== ".firebase-hosting-staging" ||
      !Array.isArray(stage.hosting?.headers))
    throw Error("STAGING_ARTIFACT_CLOUD_PROJECT_GUARD");
  const policies=[];
  for(const rule of stage.hosting.headers) {
    if(!Array.isArray(rule.headers))throw Error("STAGING_ARTIFACT_INVALID_HEADERS");
    for(const h of rule.headers) {
      const name=String(h.key||"").toLowerCase();
      if(name==="content-security-policy" ||
         name==="report-to" || name==="reporting-endpoints")
        throw Error("STAGING_ARTIFACT_ENFORCEMENT_FORBIDDEN");
      if(name==="content-security-policy-report-only")
        policies.push({source:rule.source,policy:h.value});
    }
  }
  if(policies.length!==2 ||
     policies[0].source!=="**/*.html" ||
     policies[1].source!=="/" ||
     policies[0].policy!==policies[1].policy ||
     typeof policies[0].policy!=="string" ||
     !policies[0].policy.includes("https://firebaseappcheck.googleapis.com") ||
     !policies[0].policy.includes("https://recaptcha.google.com") ||
     !policies[0].policy.includes("https://southamerica-east1-bjj-exams-staging.cloudfunctions.net") ||
     policies[0].policy.includes("'unsafe-inline'") ||
     policies[0].policy.includes("'unsafe-eval'") ||
     policies[0].policy.includes("https://southamerica-east1-bjj-exams.cloudfunctions.net"))
    throw Error("STAGING_ARTIFACT_CSP_REPORT_ONLY_GUARD");
  return policies[0].policy;
}
function inspectStagingArtifact({siteKey=null}={}) {
  if (siteKey!==null)validatePublicSiteKey(siteKey);
  validateStagingHostingConfig();
  const expected=ALLOWED_FILES.slice().sort();
  if(expected.length!==52 || new Set(expected).size!==52 ||
     PUBLIC_PAGES.length!==7 ||
     PUBLIC_PAGES.some(p=>!expected.includes(p)))
    throw Error("STAGING_ARTIFACT_ALLOWLIST_DRIFT");
  const rootStat=fs.lstatSync(OUT_DIR);
  if(!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw Error("STAGING_ARTIFACT_DIRECTORY_UNSAFE");
  const names=walkFiles(OUT_DIR);
  if(names.length!==52 || names.some((p,i)=>p!==expected[i]))
    throw Error("STAGING_ARTIFACT_ROGUE_OR_MISSING_FILE");
  const hash=crypto.createHash("sha256");
  let injectionCount=0;
  for(const rel of expected) {
    const src=path.join(ROOT,rel);
    const dest=path.join(OUT_DIR,rel);
    ensureRegularFile(src);
    ensureRegularFile(dest);
    const source=fs.readFileSync(src);
    const artifact=fs.readFileSync(dest);
    const isPage=PUBLIC_PAGES.includes(rel);
    let compare=source;
    if(isPage && siteKey!==null) {
      const html=source.toString("utf8");
      if(html.split(BOOTSTRAP_TAG).length!==2 ||
         html.includes(siteKey) ||
         html.includes("__BJJ_EXAMS_APP_CHECK_SITE_KEY__"))
        throw Error("STAGING_ARTIFACT_BOOTSTRAP_INVALID");
      const inline='<script>window.__BJJ_EXAMS_APP_CHECK_SITE_KEY__ = '+
        JSON.stringify(siteKey)+';</script>\n'+BOOTSTRAP_TAG;
      compare=Buffer.from(html.replace(BOOTSTRAP_TAG,inline),"utf8");
      injectionCount++;
    }
    if(!artifact.equals(compare))
      throw Error("STAGING_ARTIFACT_CONTENT_MISMATCH");
    hash.update(rel,"utf8");
    hash.update("\0","utf8");
    hash.update(source);
    hash.update("\0","utf8");
  }
  return Object.freeze({
    project:PROJECT_ID,
    hostingFiles:expected.length,
    appCheckPages:siteKey!==null?injectionCount:0,
    mode:siteKey!==null?"SYNTHETIC_KEY_LOCAL_ONLY":"PRISTINE_LOCAL_ONLY",
    canonicalArtifactSha256:hash.digest("hex"),
    sourceFilesUntouched:true,
    csp:"VERSIONED_REPORT_ONLY_NOT_DEPLOYED",
    realSiteKeyRegistered:false,
    actualStagingHosting:false,
    browserSmoke:"NOT_RUN",
    rollback:"VERIFIABLE_BY_REBUILD",
    deployment:"NOT_RUN",
    releaseDecision:"NO_GO"
  });
}
if(require.main===module) {
  try {
    if(process.argv.length!==3 ||
       process.argv[2]!=="--verify-pristine")
      throw Error("STAGING_ARTIFACT_CLI_MODE_INVALID");
    // Operator must build the artifact first; this program never writes files.
    process.stdout.write(JSON.stringify(inspectStagingArtifact(),null,2)+"\n");
  }catch(_){
    process.stderr.write("STAGING_HOSTING_ACCEPTANCE=BLOCKED\n");
    process.exitCode=2;
  }
}
module.exports=Object.freeze({
  validateStagingHostingConfig,walkFiles,inspectStagingArtifact
});
