"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ALLOWED_ERROR_CLASSES, sanitizeOperationalError
} = require("../functions/src/security/operational-error-sanitizer");
const ROOT = path.resolve(__dirname,"..");
const read = p => fs.readFileSync(path.join(ROOT,p),"utf8");

for(const value of [
  new Error("private@example.invalid token=SECRET-123"),
  new TypeError("CPF 000.000.000-00"),
  { name: "FirebaseError", message: "Bearer VERY_PRIVATE" },
  { name: "HttpsError", request: { body: "SENSITIVE_FINANCIAL_BODY" } }
]) {
  const result = sanitizeOperationalError(value);
  assert.deepEqual(Object.keys(result),["name"]);
  assert.ok(ALLOWED_ERROR_CLASSES.includes(result.name));
  const json = JSON.stringify(result);
  for(const forbidden of ["private@example.invalid","SECRET-123",
    "000.000.000-00","VERY_PRIVATE","SENSITIVE_FINANCIAL_BODY"])
    assert.equal(json.includes(forbidden),false);
}
for(const bad of [
  null, undefined, {}, {name:"Bearer_SECRET-123"}, {name:"Error\nAuthorization: SECRET"},
  {name:"malicious@example.invalid"}, {name:100}, {name:"PaymentTokenError"}
])assert.deepEqual(sanitizeOperationalError(bad),{name:"Error"});
assert.deepEqual(sanitizeOperationalError(new Error("secret")),{name:"Error"});
assert.deepEqual(sanitizeOperationalError(new TypeError("sensitive")),{name:"TypeError"});
assert.deepEqual(sanitizeOperationalError({
  get name(){throw new Error("TOKEN_LEAK");}
}),{name:"Error"});
assert.deepEqual(sanitizeOperationalError({
  name:"Error",toJSON(){throw Error("sensitive");},
  toString(){throw Error("sensitive");}
}),{name:"Error"});

const legacy = read("functions/index.js");
const modern = read("functions/src/finance/financial-webhook-functions.js");
assert.ok(legacy.includes("sanitizeOperationalError(error)"));
assert.ok(modern.includes("sanitizeOperationalError(error)"));
assert.equal(legacy.includes("logger.error('Erro no webhook Asaas', error);"),false);
assert.equal(modern.includes("name: error?.name || 'Error'"),false);
assert.ok(legacy.includes("exports.asaasWebhook = onRequest("));
assert.ok(legacy.includes("return res.status(500).send('Webhook processing failed')"));
assert.ok(modern.includes("WEBHOOK_PERSISTENCE_FAILED"));
assert.ok(modern.includes("verifyWebhookAuthToken(receivedToken, expectedToken)"));
assert.ok(!read("functions/main.js").includes("createRateLimitGuard({ enabled: true"));
const plan=read("docs/architecture/MARCO_9_5_AUDIT_PRIVACY.md");
for(const marker of [
  "Gate 9.5A", "Asaas Sandbox", "LGPD", "dados pessoais",
  "RETENTION_UNAPPROVED", "NO_DEPLOY", "NO_ENFORCEMENT",
  "webhook", "reprocessamento", "gabarito", "CPF"
])assert.ok(plan.includes(marker),"missing privacy doc: "+marker);
const ci=read(".github/workflows/marco8-rc-regression.yml");
assert.ok(ci.includes("node tests/marco9-privacy-logging-v1_2.test.js"));
assert.ok(ci.includes("  contents: read"));
assert.ok(!ci.includes("firebase deploy"));
assert.ok(!ci.includes("pull_request_target"));
assert.ok(!ci.includes("secrets."));
console.log("MARCO9_5A_WEBHOOK_ERROR_LOG_SANITIZATION=2/2");
console.log("MARCO9_5A_PII_AND_TOKEN_REDACTION=PASSED");
console.log("MARCO9_5A_LOG_RETENTION=UNAPPROVED");
console.log("MARCO9_5A_LIVE_LOG_AUDIT=NOT_RUN");
console.log("MARCO9_5A_PRIVACY_LOGGING=PASSED");
console.log("PRODUCTION_ACCESS=NOT_RUN");
console.log("DEPLOY_EXECUTED=False");
