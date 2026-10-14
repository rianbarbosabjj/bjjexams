"use strict";

// Offline source-level gate only. No Firebase requests and no deploy.
// Real VALID/MISSING/INVALID behavior must be proved after an explicitly
// authorized, selective STAGING deployment with synthetic test accounts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const source = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

const TARGETS = Object.freeze([
  {
    path: "functions/src/admin/admin-context-functions.js",
    enabled: "obterContextoAdministrativoV12",
    untouched: []
  },
  {
    path: "functions/src/admin/admin-people-read-functions.js",
    enabled: "listarPessoasOperacionaisV12",
    untouched: ["obterPessoaOperacionalV12"]
  },
  {
    path: "functions/src/admin/admin-organizations-read-functions.js",
    enabled: "listarOrganizacoesOperacionaisV12",
    untouched: ["obterOrganizacaoOperacionalV12"]
  },
  {
    path: "functions/src/admin/admin-courses-read-functions.js",
    enabled: "listarCursosOperacionaisV12",
    untouched: ["obterCursoOperacionalV12"]
  }
]);

function callableOptions(text, functionName) {
  // The registration is intentionally simple: no computed options or
  // spread objects that could silently override enforceAppCheck.
  const pattern = new RegExp(
    "const\\s+" + functionName +
    "\\s*=\\s*onCall\\s*\\(\\s*\\{([^}]*)\\}\\s*,",
    "g"
  );
  const matches = [...text.matchAll(pattern)];
  assert.equal(matches.length, 1, functionName + ": expected one registration");
  return matches[0][1];
}

for (const target of TARGETS) {
  const text = source(target.path);
  const registration = callableOptions(text, target.enabled);
  assert.match(registration, /\bregion\s*:\s*REGION\b/);
  assert.match(registration, /\benforceAppCheck\s*:\s*true\b/);
  assert.doesNotMatch(registration, /\.\.\.|consumeAppCheckToken|\bfalse\b/);
  assert.equal((text.match(/\benforceAppCheck\s*:\s*true\b/g) || []).length, 1,
    target.path + ": source allowlist must contain exactly one enabled callable");

  for (const name of target.untouched) {
    const detailRegistration = callableOptions(text, name);
    assert.doesNotMatch(detailRegistration, /\benforceAppCheck\b/,
      name + ": detail endpoints must remain outside the initial allowlist");
  }
}

const main = source("functions/main.js");
assert.ok(main.includes('const STAGING_PROJECT_ID = "bjj-exams-staging";'));
assert.ok(main.includes("firebaseProjectId === STAGING_PROJECT_ID"));
assert.ok(main.includes("const adminRuntimeAllowed ="));
for (const factory of [
  "createAdminContextFunctions",
  "createAdminPeopleReadFunctions",
  "createAdminOrganizationsReadFunctions",
  "createAdminCoursesReadFunctions"
]) {
  assert.ok(main.includes(factory), factory + ": composition missing");
}
const legacyAsaas = source("functions/index.js");
const canonicalAsaas = source("functions/src/finance/financial-webhook-functions.js");
assert.doesNotMatch(canonicalAsaas, /enforceAppCheck\s*:\s*true/);
assert.doesNotMatch(legacyAsaas, /enforceAppCheck\s*:\s*true/);
for (const clientPath of [
  "js/admin-shell-api-v1_2.js",
  "js/admin-shell-route-api-v1_2.js"
]) {
  const client = source(clientPath);
  assert.ok(client.includes("getAppCheckHeaders"), clientPath + ": App Check bridge missing");
  assert.ok(client.includes("...appCheckHeaders"), clientPath + ": App Check header forwarding missing");
}

console.log("APP_CHECK_ADMIN_CALLABLE_ALLOWLIST=4/4");
console.log("APP_CHECK_ADMIN_DETAIL_ENDPOINTS_OUTSIDE_ALLOWLIST=3/3");
console.log("APP_CHECK_ADMIN_CLIENT_TOKEN_BRIDGE=2/2");
console.log("APP_CHECK_ASAAS_EXTERNAL_INGRESS=UNTOUCHED");
console.log("APP_CHECK_ADMIN_SOURCE_CONTRACT=PASSED");
console.log("APP_CHECK_VALID_MISSING_INVALID_LIVE_TESTS=PENDING");
console.log("APP_CHECK_STAGING_ENFORCEMENT=NOT_DEPLOYED");
console.log("PRODUCTION_ACCESS=NOT_RUN");
console.log("MARCO9_RC_DECISION=NO_GO");
