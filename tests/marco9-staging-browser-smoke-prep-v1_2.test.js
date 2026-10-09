"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const { ROOT,ALLOWED_FILES }=require("../scripts/build-staging-hosting-v1_2");
const { PUBLIC_PAGES,BOOTSTRAP_TAG }=
  require("../scripts/prepare-staging-appcheck-sitekey-v1_2");
const { STAGING_ORIGINS,PATHS,assertStagingOrigin,loadStagingPolicy,
  probeHeaders,main }=require("../scripts/probe-staging-http-security-v1_2");
const read=rel=>fs.readFileSync(path.join(ROOT,rel),"utf8");

function responseFor({status=200,csp=loadStagingPolicy(),enforcing=null,
  reporting=null,cache="no-store, max-age=0"}={}) {
  let canceled=0;
  const values=new Map([
    ["content-security-policy-report-only",csp],
    ["content-security-policy",enforcing],
    ["report-to",reporting],
    ["cache-control",cache]
  ]);
  return {
    status,headers:{get(key){return values.get(String(key).toLowerCase())??null;}},
    body:{async cancel(){canceled++;}},
    get cancelled(){return canceled;}
  };
}
function mockHttp(behavior=()=>({})) {
  const calls=[],responses=[];
  const fetchImpl=async(url,options)=>{
    const pathname=new URL(url).pathname;
    calls.push({url,options});
    const instruction=behavior(pathname,calls.length);
    if(instruction==="NETWORK_ERROR")throw Error("authorization=SUPER_SECRET_TOKEN");
    const reply=responseFor(instruction);
    responses.push(reply);
    return reply;
  };
  return {calls,responses,fetchImpl};
}
async function run(){
  assert.equal(ALLOWED_FILES.length,52);
  assert.equal(PUBLIC_PAGES.length,7);
  assert.equal(PATHS.length,7);
  assert.deepEqual(STAGING_ORIGINS,[
    "https://bjj-exams-staging.web.app",
    "https://bjj-exams-staging.firebaseapp.com"
  ]);
  for(const forbidden of [
    "https://bjj-exams.web.app","https://bjj-exams.firebaseapp.com",
    "https://bjj-exams-staging.web.app.evil.invalid",
    "http://bjj-exams-staging.web.app",
    "https://bjj-exams-staging.web.app:444",
    "https://bjj-exams-staging.web.app/@private",
    "https://bjj-exams-staging.web.app?token=SECRET",
    "https://user:pass@bjj-exams-staging.web.app",
    "https://bjj-exams-staging.web.app#secret",
    "https://bjj-exams-staging.web.app/"
  ]) assert.throws(()=>assertStagingOrigin(forbidden),
    /STAGING_PROBE_ORIGIN_NOT_ALLOWLISTED/);
  assert.equal(assertStagingOrigin(STAGING_ORIGINS[0]),STAGING_ORIGINS[0]);
  assert.equal(assertStagingOrigin(STAGING_ORIGINS[1]),STAGING_ORIGINS[1]);
  assert.ok(loadStagingPolicy().includes("script-src 'self'"));
  assert.ok(!loadStagingPolicy().includes("'unsafe-inline'"));
  for(const page of PUBLIC_PAGES) {
    const html=read(page);
    assert.ok(html.includes(BOOTSTRAP_TAG),"runtime missing: "+page);
    assert.ok(html.includes("initializeStagingAppCheck"),
      "SDK bootstrap missing: "+page);
    assert.ok(!html.includes("__BJJ_EXAMS_APP_CHECK_SITE_KEY__"),
      "site key must be inserted into generated artifact only");
  }
  const policy=loadStagingPolicy();
  const mock=mockHttp();
  const success=await probeHeaders({
    origin:STAGING_ORIGINS[0],fetchImpl:mock.fetchImpl,policy
  });
  assert.equal(success.headersMatched,7);
  assert.equal(success.total,7);
  assert.equal(success.releaseDecision,"NO_GO");
  assert.equal(success.realAppCheckTokenValidation,"PENDING");
  assert.equal(success.manualBrowserValidation,"PENDING");
  assert.equal(success.deployExecuted,false);
  assert.equal(success.productionAccess,"FORBIDDEN");
  assert.deepEqual(success.results.map(x=>x.path),PATHS);
  assert.ok(success.results.every(x=>x.result==="HEADERS_MATCH_VERSIONED_POLICY"));
  assert.equal(mock.calls.length,7);
  assert.ok(mock.responses.every(x=>x.cancelled===1));
  for(let i=0;i<7;i++){
    const c=mock.calls[i];
    assert.equal(c.url,STAGING_ORIGINS[0]+PATHS[i]);
    assert.equal(c.options.method,"GET");
    assert.equal(c.options.redirect,"manual");
    assert.equal(c.options.credentials,"omit");
    assert.deepEqual(c.options.headers,{Accept:"text/html"});
    assert.ok(c.options.signal instanceof AbortSignal);
    assert.equal(JSON.stringify(c.options).includes("Authorization"),false);
  }

  const scenarios=[
    [{status:302},"REDIRECT_BLOCKED"],
    [{status:404},"HTTP_UNEXPECTED"],
    [{csp:"default-src 'self'"},"MISSING_OR_MISMATCHED_REPORT_ONLY"],
    [{csp:null},"MISSING_OR_MISMATCHED_REPORT_ONLY"],
    [{enforcing:"default-src 'none'"},"ENFORCEMENT_UNEXPECTED"],
    [{reporting:"https://evil.invalid/collect"},"REPORT_RECEIVER_UNEXPECTED"],
    [{cache:"public, max-age=3600"},"CACHE_MISMATCH"]
  ];
  for(const [bad,expected] of scenarios){
    const test=mockHttp(pathname=>pathname==="/login.html"?bad:{});
    const result=await probeHeaders({
      origin:STAGING_ORIGINS[1],fetchImpl:test.fetchImpl,policy
    });
    assert.equal(result.headersMatched,6);
    assert.deepEqual(result.results[1],{path:"/login.html",result:expected});
    assert.equal(result.releaseDecision,"NO_GO");
    assert.ok(!JSON.stringify(result).includes("evil.invalid"));
  }
  const outage=mockHttp(pathname=>pathname==="/exame.html"?"NETWORK_ERROR":{});
  const outageResult=await probeHeaders({
    origin:STAGING_ORIGINS[0],fetchImpl:outage.fetchImpl,policy
  });
  assert.equal(outageResult.headersMatched,6);
  assert.equal(outageResult.results[5].result,"NETWORK_ERROR");
  assert.ok(!JSON.stringify(outageResult).includes("SUPER_SECRET_TOKEN"));
  assert.throws(()=>probeHeaders({
    origin:"https://bjj-exams.web.app",fetchImpl:mock.fetchImpl,policy
  }),/STAGING_PROBE_ORIGIN_NOT_ALLOWLISTED/);
  await assert.rejects(probeHeaders({
    origin:STAGING_ORIGINS[0],fetchImpl:mock.fetchImpl,policy,paths:["/api/call"]
  }),/STAGING_PROBE_UNEXPECTED_PATHS/);
  await assert.rejects(probeHeaders({
    origin:STAGING_ORIGINS[0],policy
  }),/STAGING_PROBE_FETCH_REQUIRED/);

  // Real HTTP is NEVER attempted by the CI. No external site key is required.
  await assert.rejects(main([]),/EXPLICIT_OPERATOR_APPROVAL_REQUIRED/);
  await assert.rejects(main([
    "--probe-staging","https://bjj-exams.web.app","--ack-staging-authorization"
  ]),/ORIGIN_NOT_ALLOWLISTED|EXPLICIT_OPERATOR_APPROVAL_REQUIRED/);

  const plan=read("docs/architecture/MARCO_9_1C2B_9_3C_SMOKE_PREP.md");
  for(const required of [
    "App Check","CSP","9.1C2B","9.3C","reCAPTCHA Enterprise",
    "NO_DEPLOY","NO_ENFORCEMENT","Asaas Sandbox","NO_GO",
    "DevTools","rollback","bjj-exams-staging","site key"
  ])assert.ok(plan.includes(required),"missing smoke runbook: "+required);
  const workflow=read(".github/workflows/marco8-rc-regression.yml");
  assert.ok(workflow.includes("node tests/marco9-staging-browser-smoke-prep-v1_2.test.js"));
  assert.ok(workflow.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
  assert.ok(!workflow.includes("firebase deploy"));
  assert.ok(!workflow.includes("secrets."));
  assert.ok(!workflow.includes("contents: write"));
  assert.ok(!read("functions/main.js").includes("enforceAppCheck: true"));

  console.log("MARCO9_STAGING_HOSTNAME_BOUNDARIES=PASSED");
  console.log("MARCO9_STAGING_CSP_HEADER_MOCKS=7/7");
  console.log("MARCO9_STAGING_NETWORK_FAILURES_SANITIZED=PASSED");
  console.log("MARCO9_STAGING_APPCHECK_BOOTSTRAP=7/7");
  console.log("MARCO9_GATE_9_1C2B_9_3C_SMOKE_TOOLKIT=PASSED");
  console.log("MARCO9_STAGING_REAL_HTTP_PROBE=NOT_RUN");
  console.log("MARCO9_STAGING_FIREBASE_DEPLOY=NOT_RUN");
  console.log("MARCO9_OPERATIONAL_ACCEPTANCE=NO_GO");
}
run().catch(error=>{console.error(error);process.exitCode=1;});
