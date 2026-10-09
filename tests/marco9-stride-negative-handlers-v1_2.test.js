"use strict";
// Gate 9.4C4: real handler contracts with synthetic data. No Firebase app,
// no HTTP server, no payment processor, no real account or secrets.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createAdminContextHandler } =
  require("../functions/src/admin/admin-context-functions");
const { createReprocessWebhookHandler } =
  require("../functions/src/admin/admin-webhooks-reprocess-functions");
const { createWebhookIngressHandler } =
  require("../functions/src/finance/financial-webhook-functions");
const { FinancialWebhookPersistenceError } =
  require("../functions/src/finance/financial-webhook-persistence");
const { WEBHOOK_AUTH_HEADER } =
  require("../functions/src/finance/financial-webhook-domain");
const ROOT = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT,p),"utf8");
const FAKE_TOKEN = "synthetic-webhook-token-no-real-secret-1234";
const SENSITIVE = "synthetic-secret-PII-never-print-1234";
function fakeResponse() {
  return {statusCode:null,headers:{},body:null,
    status(code){this.statusCode=code;return this;},
    set(name,value){this.headers[name.toLowerCase()]=value;return this;},
    send(body){this.body=JSON.parse(body);return this;}
  };
}
async function httpsDenied(promise,code){
  await assert.rejects(promise,e=>{
    assert.equal(e.code,code);
    const response=JSON.stringify({message:e.message,details:e.details});
    assert.equal(response.includes(SENSITIVE),false);
    assert.equal(response.includes(FAKE_TOKEN),false);
    return true;
  });
}
async function main(){
  const requests=[];
  let registered=0;
  const ingress=createWebhookIngressHandler({
    persistence:{async registerWebhookEvent({payload}){
      registered++;
      requests.push(payload.id);
      return {duplicate:false,status:"received"};
    }},
    webhookTokenResolver:()=>FAKE_TOKEN
  });
  const req=(method,token,body)=>({
    method,headers:token===undefined?{}:{[WEBHOOK_AUTH_HEADER]:token},
    body
  });
  const fakePayload={id:"synthetic-event-001",event:"PAYMENT_RECEIVED",
    payment:{id:"synthetic-pay-1",value:1}};
  const checks=[
    [req("GET",FAKE_TOKEN,fakePayload),405,"METHOD_NOT_ALLOWED"],
    [req("POST",undefined,fakePayload),401,"WEBHOOK_AUTH_REQUIRED"],
    [req("POST","wrong-but-same-length-private-xx",fakePayload),403,"WEBHOOK_AUTH_INVALID"],
    [req("POST",FAKE_TOKEN,[]),400,"INVALID_WEBHOOK_BODY"]
  ];
  for(const [request,code,error] of checks){
    const res=fakeResponse();
    await ingress(request,res);
    assert.equal(res.statusCode,code);
    assert.equal(res.body.error,error);
    assert.equal(JSON.stringify(res.body).includes(FAKE_TOKEN),false);
  }
  assert.equal(registered,0,"unauthenticated events must not persist");
  const res=fakeResponse();
  await ingress(req("POST",FAKE_TOKEN,fakePayload),res);
  assert.equal(res.statusCode,202);
  assert.deepEqual(requests,["synthetic-event-001"]);
  assert.deepEqual(Object.keys(res.body).sort(),
    ["ok","accepted","duplicate","status"].sort());

  let mismatchCalls=0;
  const mismatch=createWebhookIngressHandler({
    persistence:{async registerWebhookEvent(){
      mismatchCalls++;
      throw new FinancialWebhookPersistenceError(
        "WEBHOOK_EVENT_REDELIVERY_MISMATCH",SENSITIVE);
    }},
    webhookTokenResolver:()=>FAKE_TOKEN
  });
  const mismatchRes=fakeResponse();
  await mismatch(req("POST",FAKE_TOKEN,fakePayload),mismatchRes);
  assert.equal(mismatchCalls,1);
  assert.equal(mismatchRes.statusCode,409);
  assert.equal(mismatchRes.body.error,"WEBHOOK_EVENT_REDELIVERY_MISMATCH");
  assert.equal(JSON.stringify(mismatchRes.body).includes(SENSITIVE),false);

  const savedConsole=console.error;
  const captured=[];
  try {
    console.error=(...args)=>captured.push(args);
    const outage=createWebhookIngressHandler({
      persistence:{async registerWebhookEvent(){
        const e=new Error(SENSITIVE);
        e.name="FinanceSecretError_"+FAKE_TOKEN;
        e.headers={authorization:FAKE_TOKEN};
        throw e;
      }},
      webhookTokenResolver:()=>FAKE_TOKEN
    });
    const outageRes=fakeResponse();
    await outage(req("POST",FAKE_TOKEN,fakePayload),outageRes);
    assert.equal(outageRes.statusCode,500);
    assert.equal(outageRes.body.error,"WEBHOOK_PERSISTENCE_FAILED");
  }finally{console.error=savedConsole;}
  assert.equal(captured.length,1);
  assert.deepEqual(captured[0],["financial-webhook-ingress-error",{name:"Error"}]);
  assert.ok(!JSON.stringify(captured).includes(SENSITIVE));
  assert.ok(!JSON.stringify(captured).includes(FAKE_TOKEN));

  let reprocessCount=0;
  let forwarded=null;
  const reprocess=createReprocessWebhookHandler({
    service:{async reprocessWebhook(input){
      reprocessCount++;
      forwarded=input;
      return {accepted:true,status:"processed"};
    }}
  });
  const spoof={data:{eventId:"synthetic-event-001",requestId:"synthetic-request-1",
    role:"super_admin"},rawRequest:{headers:{"x-user-id":"spoofed"}}};
  await httpsDenied(reprocess(spoof),"unauthenticated");
  await httpsDenied(reprocess({...spoof,auth:{uid:"fake-regular",token:{owner:true}}}),
    "permission-denied");
  await httpsDenied(reprocess({...spoof,auth:{uid:"fake-admin",
    token:{platform_admin:true}}}),"permission-denied");
  assert.equal(reprocessCount,0);
  await httpsDenied(reprocess({data:spoof.data,auth:{
    uid:"fake-finance",token:{finance_admin:true}
  }}),"invalid-argument");
  assert.equal(reprocessCount,0);
  const ok=await reprocess({
    data:{eventId:"synthetic-event-001",requestId:"synthetic-request-1"},
    auth:{uid:"verified-finance-uid",token:{finance_admin:true}},
    rawRequest:{headers:{"x-user-id":"spoofed-client","x-role":"super_admin"}}
  });
  assert.equal(ok.ok,true);
  assert.deepEqual(forwarded,{
    eventId:"synthetic-event-001",requestId:"synthetic-request-1",
    actorUid:"verified-finance-uid",actorRole:"finance_admin"
  });
  assert.equal(reprocessCount,1);

  let guardCalls=0;
  const context=createAdminContextHandler({environment:"staging",
    rateLimitGuard:{async check(){
      guardCalls++;return {allowed:true};
    }}
  });
  await httpsDenied(context({data:{},auth:null}),"unauthenticated");
  await httpsDenied(context({data:{},auth:{uid:"fake-owner",token:{owner:true}},
    rawRequest:{headers:{"x-user-id":"super-admin"}}}),"permission-denied");
  await httpsDenied(context({data:{super_admin:true},
    auth:{uid:"fake-admin",token:{support_admin:true}}}),"invalid-argument");
  assert.equal(guardCalls,0);
  const admin=await context({data:{},auth:{
    uid:"trusted-support",token:{support_admin:true,email:SENSITIVE}
  },rawRequest:{headers:{"x-user-id":"imposter"}}});
  assert.equal(admin.context.userId,"trusted-support");
  assert.equal(admin.context.globalRoles.includes("super_admin"),false);
  assert.equal(guardCalls,1);
  assert.ok(!JSON.stringify(admin).includes(SENSITIVE));

  const ci=read(".github/workflows/marco8-rc-regression.yml");
  assert.ok(ci.includes("node tests/marco9-stride-negative-handlers-v1_2.test.js"));
  assert.ok(!ci.includes("firebase deploy")&&!ci.includes("secrets."));
  assert.ok(read("functions/main.js").includes("createRateLimitGuard({ enabled: false })"));
  const doc=read("docs/architecture/MARCO_9_4C4_9_5B1_SECURITY_REVIEW.md");
  for(const value of ["9.4C4","9.5B1","T01","T04","T05","T06",
    "RETENTION_UNAPPROVED","NO_GO","NO_DEPLOY","STRIDE"])
    assert.ok(doc.includes(value),"review doc marker missing: "+value);
  console.log("MARCO9_4C4_NEGATIVE_WEBHOOK_AUTH=4/4");
  console.log("MARCO9_4C4_NEGATIVE_REPLAY_MISMATCH=409");
  console.log("MARCO9_4C4_WEBHOOK_RAW_ERROR_REDACTION=PASSED");
  console.log("MARCO9_4C4_AUTH_BEFORE_REPROCESS=PASSED");
  console.log("MARCO9_4C4_ADMIN_AUTH_BEFORE_QUOTA=PASSED");
  console.log("MARCO9_4C4_STAGING_PENTEST=NOT_RUN");
  console.log("MARCO9_GATE_9_4C4_NEGATIVE_CONTRACTS=PASSED");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
