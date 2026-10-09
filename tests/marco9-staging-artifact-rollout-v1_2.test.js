"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {ROOT,OUT_DIR,ALLOWED_FILES,build}=
  require("../scripts/build-staging-hosting-v1_2");
const {PUBLIC_PAGES,prepareStagingAppCheckArtifact}=
  require("../scripts/prepare-staging-appcheck-sitekey-v1_2");
const {
 validateStagingHostingConfig,inspectStagingArtifact
}=require("../scripts/verify-staging-hosting-artifact-v1_2");
const fakeKey="6Le_FAKE_STAGING_ONLY_ARTIFACT_ATTESTATION_2026";
const read=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
const snapshot=new Map(ALLOWED_FILES.map(p=>[
  p,fs.readFileSync(path.join(ROOT,p))
]));
const manualChanges=[];
function restoreArtifact(){
  build();
  for(const [name,bytes] of snapshot){
    assert.ok(fs.readFileSync(path.join(ROOT,name)).equals(bytes),
      "repository source unchanged: "+name);
  }
}
function mustReject(operation,reason){
  assert.throws(operation,new RegExp(reason));
}
async function main(){
  assert.ok(validateStagingHostingConfig().includes("firebaseappcheck.googleapis.com"));
  assert.equal(ALLOWED_FILES.length,52);
  assert.equal(PUBLIC_PAGES.length,7);
  try {
    build();
    const pristine=inspectStagingArtifact();
    assert.equal(pristine.mode,"PRISTINE_LOCAL_ONLY");
    assert.equal(pristine.hostingFiles,52);
    assert.equal(pristine.appCheckPages,0);
    assert.equal(pristine.project,"bjj-exams-staging");
    assert.match(pristine.canonicalArtifactSha256,/^[a-f0-9]{64}$/);
    assert.equal(pristine.deployment,"NOT_RUN");
    assert.equal(pristine.releaseDecision,"NO_GO");

    // No key supplied: artifact must be pristine; malformed key rejected.
    mustReject(()=>inspectStagingArtifact({siteKey:"<script>bad</script>"}),
      "APP_CHECK_SITE_KEY_MISSING_OR_INVALID");
    prepareStagingAppCheckArtifact({siteKey:fakeKey});
    const staged=inspectStagingArtifact({siteKey:fakeKey});
    assert.equal(staged.mode,"SYNTHETIC_KEY_LOCAL_ONLY");
    assert.equal(staged.appCheckPages,7);
    assert.equal(staged.hostingFiles,52);
    assert.equal(staged.canonicalArtifactSha256,pristine.canonicalArtifactSha256,
      "normalized digest must be independent from public key injection");
    assert.equal(staged.csp,"VERSIONED_REPORT_ONLY_NOT_DEPLOYED");
    assert.equal(staged.rollback,"VERIFIABLE_BY_REBUILD");
    assert.equal(staged.browserSmoke,"NOT_RUN");
    assert.equal(staged.actualStagingHosting,false);
    assert.equal(staged.realSiteKeyRegistered,false);
    assert.equal(JSON.stringify(staged).includes(fakeKey),false);
    mustReject(()=>inspectStagingArtifact(),"STAGING_ARTIFACT_CONTENT_MISMATCH");

    // Modifying injected page, even with a valid-looking key, must fail.
    const target=path.join(OUT_DIR,"login.html");
    fs.appendFileSync(target,"\n<!-- synthetic tamper -->","utf8");
    mustReject(()=>inspectStagingArtifact({siteKey:fakeKey}),
      "STAGING_ARTIFACT_CONTENT_MISMATCH");
    build();

    // Non-key assets must remain byte-identical.
    const js=path.join(OUT_DIR,"js/firebase-runtime-v1_2.js");
    fs.appendFileSync(js,"\n// simulated corruption","utf8");
    mustReject(()=>inspectStagingArtifact(),"STAGING_ARTIFACT_CONTENT_MISMATCH");
    build();

    // Unexpected file and symlink are forbidden; not silently ignored.
    const rogue=path.join(OUT_DIR,"extra-artifact.js");
    fs.writeFileSync(rogue,"synthetic rogue file","utf8");
    mustReject(()=>inspectStagingArtifact(),"STAGING_ARTIFACT_ROGUE_OR_MISSING_FILE");
    build();
    const link=path.join(OUT_DIR,"unexpected-link.html");
    fs.symlinkSync(path.join(ROOT,"login.html"),link);
    mustReject(()=>inspectStagingArtifact(),"STAGING_ARTIFACT_SYMLINK_BLOCKED");
    build();

    // Incomplete generated artifact must not be accepted.
    fs.unlinkSync(path.join(OUT_DIR,"login.html"));
    mustReject(()=>inspectStagingArtifact(),"STAGING_ARTIFACT_ROGUE_OR_MISSING_FILE");
    build();

    // Rebuild is a reproducible local rollback, never a Hosting rollback.
    const restored=inspectStagingArtifact();
    assert.equal(restored.canonicalArtifactSha256,pristine.canonicalArtifactSha256);
    for(const page of PUBLIC_PAGES){
      const generated=fs.readFileSync(path.join(OUT_DIR,page),"utf8");
      assert.equal(generated.includes(fakeKey),false);
    }
    const ci=read(".github/workflows/marco8-rc-regression.yml");
    assert.ok(ci.includes("node tests/marco9-staging-artifact-rollout-v1_2.test.js"));
    assert.ok(ci.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
    assert.ok(!ci.includes("firebase deploy"));
    assert.ok(!ci.includes("secrets."));
    assert.ok(!ci.includes("contents: write"));
    assert.ok(read("functions/main.js").includes("createRateLimitGuard({ enabled: false })"));
    const doc=read("docs/architecture/MARCO_9_1C2C_9_3C1_ARTIFACT_ACCEPTANCE.md");
    for(const marker of [
      "9.1C2C","9.3C1","NO_GO","NO_DEPLOY",
      "NO_ENFORCEMENT","52","7","rollback","App Check","CSP",
      "bjj-exams-staging","reCAPTCHA Enterprise","DevTools","Asaas Sandbox"
    ]) assert.ok(doc.includes(marker),"missing runbook marker: "+marker);
    console.log("MARCO9_1C2C_HOSTING_ALLOWLIST=52/52");
    console.log("MARCO9_1C2C_SYNTHETIC_APPCHECK_BOOTSTRAPS=7/7");
    console.log("MARCO9_3C1_REPORT_ONLY_POLICY=VERSIONED_NOT_DEPLOYED");
    console.log("MARCO9_3C1_CORRUPTION_ROGUE_SYMLINK_REJECTED=PASSED");
    console.log("MARCO9_3C1_LOCAL_ROLLBACK_DIGEST=IDENTICAL");
    console.log("MARCO9_1C2C_REAL_BROWSER_SMOKE=NOT_RUN");
    console.log("MARCO9_1C2C_RELEASE_DECISION=NO_GO");
    console.log("MARCO9_GATE_9_1C2C_9_3C1_ARTIFACT_ROLLBACK=PASSED");
  }finally{
    restoreArtifact();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
