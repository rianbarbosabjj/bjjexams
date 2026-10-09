"use strict";

// Gate 9.3C readiness: OPTIONAL READ-ONLY HTTP header probe, not browser validation.
// Never run from CI. No secrets, auth, cookies, POST, redirect following or deploy.
const fs=require("node:fs");
const path=require("node:path");
const ROOT=path.resolve(__dirname,"..");
const STAGING_ORIGINS=Object.freeze([
  "https://bjj-exams-staging.web.app",
  "https://bjj-exams-staging.firebaseapp.com"
]);
const PATHS=Object.freeze([
  "/", "/login.html", "/catalogo.html", "/cursos.html",
  "/painel_aluno.html", "/exame.html", "/admin_shell_v1_2.html"
]);

function assertStagingOrigin(origin) {
  if (typeof origin!=="string" || !STAGING_ORIGINS.includes(origin))
    throw new Error("STAGING_PROBE_ORIGIN_NOT_ALLOWLISTED");
  const u=new URL(origin);
  if (u.protocol!=="https:" || u.username || u.password || u.port ||
      u.search || u.hash || u.pathname!=="/")
    throw new Error("STAGING_PROBE_INVALID_ORIGIN");
  return u.origin;
}
function loadStagingPolicy() {
  const primary=JSON.parse(fs.readFileSync(path.join(ROOT,"firebase.json"),"utf8"));
  const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,"firebase.staging-hosting.json"),"utf8"));
  if (Object.hasOwn(primary,"hosting") ||
      cfg.hosting?.site!=="bjj-exams-staging" ||
      cfg.hosting?.public!==".firebase-hosting-staging")
    throw new Error("STAGING_PROBE_HOSTING_BOUNDARY_INVALID");
  const html=cfg.hosting.headers.find(x=>x.source==="**/*.html");
  const root=cfg.hosting.headers.find(x=>x.source==="/");
  const policy=html?.headers?.find(x=>x.key==="Content-Security-Policy-Report-Only")?.value;
  if (typeof policy!=="string" || !policy.startsWith("default-src 'self'") ||
      policy.length>4096 ||
      root?.headers?.find(x=>x.key==="Content-Security-Policy-Report-Only")?.value!==policy ||
      cfg.hosting.headers.some(x=>x.headers?.some(h=>
        /^content-security-policy$/i.test(h.key) ||
        /^reporting-endpoints$|^report-to$/i.test(h.key))))
    throw new Error("STAGING_PROBE_EXPECTED_DIAGNOSTIC_CSP_INVALID");
  return policy;
}
async function probeHeaders({origin,fetchImpl,policy,paths=PATHS}={}) {
  const base=assertStagingOrigin(origin);
  if (typeof fetchImpl!=="function")throw new TypeError("STAGING_PROBE_FETCH_REQUIRED");
  if (typeof policy!=="string" || policy.length<20 || policy.length>4096)
    throw new Error("STAGING_PROBE_POLICY_INVALID");
  if (!Array.isArray(paths) || paths.length!==PATHS.length ||
      paths.some((v,i)=>v!==PATHS[i]))
    throw new Error("STAGING_PROBE_UNEXPECTED_PATHS");
  const rows=[];
  for(const pathname of PATHS) {
    let result="NETWORK_ERROR";
    let response;
    try {
      const url=base+pathname;
      // HTTPS and paths are constant after explicit, exact allowlist checks.
      response=await fetchImpl(url,{
        method:"GET",redirect:"manual",credentials:"omit",
        headers:{Accept:"text/html"},
        signal:AbortSignal.timeout(8000)
      });
      if(!response || !Number.isSafeInteger(response.status) ||
         typeof response.headers?.get!=="function") {
        result="INVALID_RESPONSE";
      } else if(response.status>=300 && response.status<400) {
        result="REDIRECT_BLOCKED";
      } else if(response.status!==200) {
        result="HTTP_UNEXPECTED";
      } else if(response.headers.get("Content-Security-Policy")) {
        result="ENFORCEMENT_UNEXPECTED";
      } else if(response.headers.get("Report-To") ||
                response.headers.get("Reporting-Endpoints")) {
        result="REPORT_RECEIVER_UNEXPECTED";
      } else if(response.headers.get("Content-Security-Policy-Report-Only")!==policy) {
        result="MISSING_OR_MISMATCHED_REPORT_ONLY";
      } else if(pathname!=="/" &&
                response.headers.get("Cache-Control")!=="no-store, max-age=0") {
        result="CACHE_MISMATCH";
      } else {
        result="HEADERS_MATCH_VERSIONED_POLICY";
      }
    } catch (_) {
      // Never log exception messages, URLs with parameters or headers.
      result="NETWORK_ERROR";
    } finally {
      try { await response?.body?.cancel?.(); } catch (_) { /* nothing sensitive */ }
    }
    rows.push({path:pathname,result});
  }
  return Object.freeze({
    project:"bjj-exams-staging",
    origin:base,
    requestMethod:"GET_ONLY_PUBLIC_HTML",
    credentials:"OMITTED",
    redirects:"BLOCKED",
    results:rows,
    headersMatched:rows.filter(x=>x.result==="HEADERS_MATCH_VERSIONED_POLICY").length,
    total:PATHS.length,
    manualBrowserValidation:"PENDING",
    realAppCheckTokenValidation:"PENDING",
    enforcement:"NOT_AUTHORIZED",
    releaseDecision:"NO_GO",
    deployExecuted:false,
    productionAccess:"FORBIDDEN"
  });
}
async function main(args=process.argv.slice(2)) {
  if(args.length!==3 || args[0]!=="--probe-staging" ||
     args[2]!=="--ack-staging-authorization" ||
     process.env.CI==="true") {
    throw new Error("STAGING_PROBE_EXPLICIT_OPERATOR_APPROVAL_REQUIRED");
  }
  const origin=assertStagingOrigin(args[1]);
  return probeHeaders({origin,fetchImpl:fetch,policy:loadStagingPolicy()});
}
if (require.main===module) {
  main().then(report=>{
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
    if(report.headersMatched!==report.total)process.exitCode=2;
  }).catch(_=>{
    process.stderr.write("STAGING_HEADER_PROBE=BLOCKED_OR_FAILED\n");
    process.exitCode=2;
  });
}
module.exports=Object.freeze({
  STAGING_ORIGINS,PATHS,assertStagingOrigin,loadStagingPolicy,probeHeaders,main
});
