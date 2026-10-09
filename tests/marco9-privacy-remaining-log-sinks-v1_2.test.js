"use strict";
// Gate 9.5B3: offline source-level regression against sensitive log arguments.
// No cloud reads, credential access, Firebase, or deployment.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const { sanitizeOperationalError } = require(
  "../functions/src/security/operational-error-sanitizer"
);

const compat = read("functions/src/compatibility/legacy-index.v1_1.js");
const modern = read("functions/index.js");
const moderation = read("functions/src/courses/course-moderation-submission-functions.js");
const webhook = read("functions/src/finance/financial-webhook-functions.js");

for (const source of [compat, modern]) {
  assert.ok(source.includes("logger.error('Erro no webhook Asaas', sanitizeOperationalError(error));"));
  assert.ok(!source.includes("logger.error('Erro no webhook Asaas', error);"));
}
assert.ok(webhook.includes("sanitizeOperationalError(error)"));

const legacyRelinkStart = compat.indexOf("exports.resolverPerfilUsuario = onCall(");
const legacyRelink = compat.slice(legacyRelinkStart);
assert.ok(legacyRelinkStart >= 0);
assert.ok(legacyRelink.includes("logger.info('Perfil legado relincado ao UID autenticado.');"));
assert.ok(legacyRelink.includes("logger.warn('Conflito de perfis legados por e-mail.', { quantidade: grouped.size });"));
assert.ok(!legacyRelink.includes("logger.info('Perfil legado relincado ao UID autenticado.', {"));
assert.ok(!legacyRelink.includes("logger.warn('Conflito de perfis legados por e-mail.', { uid,"));

const logStart = moderation.indexOf("console.error('COURSE_MODERATION_PROVIDER_ERROR', {");
const logEnd = moderation.indexOf("\n      });", logStart);
assert.ok(logStart > 0 && logEnd > logStart);
const providerLog = moderation.slice(logStart, logEnd);
assert.ok(providerLog.includes("errorClass: sanitizeOperationalError(error)"));
assert.ok(!/\bdiagnostic\b/i.test(providerLog));
assert.ok(!providerLog.includes("error?.message"));
assert.ok(moderation.includes("const diagnostic = error?.safeDiagnostic || fallbackDiagnostic(error);"));
assert.ok(moderation.includes("providerDiagnostic: diagnostic"));
assert.ok(moderation.includes("status: 'manual_review'"));

const secret = "private-person@example.invalid Authorization: Bearer FAKE_SECRET";
for (const input of [
  new Error(secret),
  { name: "FirebaseError", message: secret, response: { data: secret } },
  { name: secret, code: secret },
  { get name() { throw new Error(secret); } }
]) {
  const value = sanitizeOperationalError(input);
  assert.deepEqual(Object.keys(value), ["name"]);
  assert.equal(JSON.stringify(value).includes(secret), false);
}

const ci = read(".github/workflows/marco8-rc-regression.yml");
assert.ok(ci.includes("node tests/marco9-privacy-remaining-log-sinks-v1_2.test.js"));
assert.ok(!ci.includes("firebase deploy"));
assert.ok(!ci.includes("secrets."));

console.log("MARCO9_5B3_LEGACY_WEBHOOK_SANITIZER=PASS");
console.log("MARCO9_5B3_LEGACY_PROFILE_IDENTIFIERS_REMOVED=PASS");
console.log("MARCO9_5B3_MODERATION_PROVIDER_LOG_CLASS_ONLY=PASS");
console.log("MARCO9_5B3_RETENTION_APPROVAL=PENDING");
console.log("MARCO9_5B3_CLOUD_LOGGING_REVIEW=PENDING");
console.log("MARCO9_5B3_RELEASE_DECISION=NO_GO");
