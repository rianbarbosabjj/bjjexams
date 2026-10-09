"use strict";
// Gate 9.5B2 — source-level log data minimization and error sanitizer contracts.
// No Cloud Logging read, retention change, API/network use or real PII.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {sanitizeOperationalError}=require("../functions/src/security/operational-error-sanitizer");
const {inventoryRepository}=require("../scripts/inventory-operational-logs-v1_2");
const ROOT=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
const source=read("functions/index.js");
const sync=source.slice(
  source.indexOf("async function finalizeResolvedProfile("),
  source.indexOf("\nfunction asaas()",source.indexOf("async function finalizeResolvedProfile("))
);
assert.ok(sync.startsWith("async function finalizeResolvedProfile("));
assert.match(sync,/logger\.info\('Global claims sincronizadas\.'\);/);
assert.match(sync,/logger\.error\('Falha ao sincronizar Global Claims\.',\s*sanitizeOperationalError\(error\)\);/);
assert.ok(!/logger\.(?:info|warn|error)\([^;]*(?:\buid\b|\bemail\b|\bfonte\b|\bpapel\b|\bmessage\b|\berror\?\.code)/s.test(sync));
assert.equal(sync.includes("String(error?.message"),false);
const relink=source.slice(
  source.indexOf("    await relinkLegacyProfile(preferred, uid);"),
  source.indexOf("  if (direct?.linkedOnly)",source.indexOf("    await relinkLegacyProfile(preferred, uid);"))
);
assert.ok(relink.includes("logger.info('Perfil legado relincado ao UID autenticado.');"));
assert.ok(relink.includes("logger.warn('Conflito de perfis legados por e-mail.', { quantidade: grouped.size });"));
assert.ok(!relink.includes("logger.warn('Conflito de perfis legados por e-mail.', { uid,"));
assert.ok(!relink.includes("logger.info('Perfil legado relincado ao UID autenticado.', {"));
assert.ok(source.includes("logger.error('Erro no webhook Asaas', sanitizeOperationalError(error));"));

const payload="synthetic-person@example.invalid token=SECRET_9999";
const errors=[
  new Error(payload),
  Object.assign(new Error(payload),{name:"Error",headers:{authorization:payload}}),
  {name:"BadName"+payload,message:payload,request:{body:payload}},
  {get name(){throw new Error(payload);},message:payload},
  null,
  Object.freeze({name:"FirebaseError",message:payload,code:payload})
];
for(const input of errors){
  const sanitized=sanitizeOperationalError(input);
  assert.deepEqual(Object.keys(sanitized),["name"]);
  assert.ok(["Error","FirebaseError"].includes(sanitized.name));
  assert.ok(!JSON.stringify(sanitized).includes(payload));
}
assert.deepEqual(sanitizeOperationalError({name:"CustomFinanceToken"+payload}),{name:"Error"});
const summary=inventoryRepository();
assert.equal(summary.scope,"STATIC_FUNCTION_SOURCE_ONLY");
assert.equal(summary.livePIIExposureProven,false);
assert.equal(summary.retentionDecision,"RETENTION_UNAPPROVED");
assert.equal(summary.actualCloudLoggingAccess,"NOT_RUN");
assert.ok(summary.sinkCandidates>=5);
const legacySinkCount=[...source.matchAll(/\blogger\.(?:info|warn|error)\s*\(/g)].length;
assert.ok(legacySinkCount>=5);
const workflow=read(".github/workflows/marco8-rc-regression.yml");
assert.ok(workflow.includes("node tests/marco9-legacy-auth-log-redaction-v1_2.test.js"));
assert.ok(workflow.includes("NPM_AUDIT_ZERO_REPORTED_FINDINGS=PASSED"));
assert.ok(!workflow.includes("firebase deploy"));
assert.ok(!workflow.includes("secrets."));
const doc=read("docs/architecture/MARCO_9_4C5_9_5B2_ISOLATION_PRIVACY.md");
for(const marker of ["9.5B2","LGPD","RETENTION_UNAPPROVED",
  "NO_GO","NO_DEPLOY","Cloud Logging","UID"])
  assert.ok(doc.includes(marker),"missing doc marker "+marker);
console.log("MARCO9_5B2_LEGACY_LOG_IDENTIFIERS=REMOVED");
console.log("MARCO9_5B2_CLAIMS_SYNC_ERROR_CLASS=SANITIZED");
console.log("MARCO9_5B2_LEGACY_PROFILE_RELINK_IDENTIFIERS=REMOVED");
console.log("MARCO9_5B2_CLOUD_LOGGING_HISTORICAL_AUDIT=NOT_RUN");
console.log("MARCO9_5B2_LGPD_RETENTION=UNAPPROVED");
console.log("MARCO9_GATE_9_5B2_LOG_MINIMIZATION=PASSED");
