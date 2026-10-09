"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createAdminContextHandler, createAdminContextFunctions
} = require("../functions/src/admin/admin-context-functions");
const {
  createRateLimitGuard, STAGING_PROJECT
} = require("../functions/src/security/rate-limit-core");

const adminRequest = (uid = "verified-admin-uid", claims = { support_admin: true }) => ({
  data: {},
  auth: { uid, token: claims }
});

async function rejected(promise, expectedCode, safeMessage) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, expectedCode);
    assert.ok(!JSON.stringify({
      message: error.message, details: error.details
    }).includes("private@example.invalid"));
    if (safeMessage) assert.match(error.message, safeMessage);
    return true;
  });
}

async function main() {
  // No policy attached remains backward compatible.
  const defaultHandler = createAdminContextHandler({ environment: "staging" });
  const legacy = await defaultHandler(adminRequest());
  assert.equal(legacy.ok, true);
  assert.equal(legacy.context.userId, "verified-admin-uid");
  assert.equal(legacy.context.environment, "staging");
  assert.deepEqual(Object.keys(legacy.context).sort(),
    ["userId","displayName","globalRoles","capabilities","surfaceAccess","environment","schemaVersion"].sort());

  let guardCalls = 0;
  const disabled = createRateLimitGuard({ enabled: false });
  const disabledHandler = createAdminContextHandler({
    environment: "staging", rateLimitGuard: disabled
  });
  assert.deepEqual(await disabled.check({ scope: "authenticated_read", identity: "verified-admin-uid" }),
    { allowed: true, enforced: false, status: "NOT_ENABLED" });
  assert.deepEqual(await disabledHandler(adminRequest()), legacy,
    "disabled wiring must preserve the exact admin context response schema");

  const verifiedIdentities = [];
  const authorisedHandler = createAdminContextHandler({
    environment: "staging",
    rateLimitGuard: { async check({ scope, identity }) {
      guardCalls++;
      verifiedIdentities.push(identity);
      assert.equal(scope, "authenticated_read");
      return { allowed: true, enforced: true, status: "ALLOW" };
    } }
  });
  const impersonated = await authorisedHandler({
    data: {},
    auth: { uid: "trusted-firebase-auth", token: {
      platform_admin: true,
      email: "private@example.invalid"
    } },
    rawRequest: { headers: {
      "x-forwarded-for": "203.0.113.1",
      "x-user-id": "spoofed-user"
    } }
  });
  assert.equal(impersonated.context.userId, "trusted-firebase-auth");
  assert.deepEqual(verifiedIdentities, ["trusted-firebase-auth"]);
  assert.equal(JSON.stringify(impersonated).includes("private@example.invalid"), false);

  // Security ordering: invalid payload, missing Firebase Auth and insufficient
  // RBAC are rejected without charging a counter or revealing a rate-limit status.
  await rejected(authorisedHandler({ data: {}, auth: null }), "unauthenticated");
  await rejected(authorisedHandler(adminRequest("regular-uid", { owner: true })), "permission-denied");
  await rejected(authorisedHandler({
    data: { identity: "spoofed", role: "super_admin" },
    auth: { uid: "trusted-uid", token: { super_admin: true } }
  }), "invalid-argument");
  assert.equal(guardCalls, 1, "unauthorized identities never consume quotas");

  const deniedHandler = createAdminContextHandler({
    environment: "staging",
    rateLimitGuard: { async check({ scope, identity }) {
      assert.equal(scope, "authenticated_read");
      assert.equal(identity, "verified-admin-uid");
      return { allowed: false, enforced: true, status: "RATE_LIMITED",
        retryAfterSeconds: 17, internalUser: "private@example.invalid" };
    } }
  });
  await rejected(deniedHandler(adminRequest()), "resource-exhausted", /Muitas solicitações/);

  // Fail-open only for authenticated reads; authorization is STILL mandatory.
  const secret = Buffer.from("synthetic-nonproduction-hmac-key-32-plus-characters");
  const readOpenGuard = createRateLimitGuard({
    enabled: true, projectId: STAGING_PROJECT, secret,
    store: { async consumeAtomic() { throw new Error("PRIVATE_COUNTER_DB_ERROR"); } },
    clock: () => 2000
  });
  const healthyDespiteCounterOutage = createAdminContextHandler({
    environment: "staging", rateLimitGuard: readOpenGuard
  });
  const degraded = await healthyDespiteCounterOutage(adminRequest());
  assert.deepEqual(degraded, legacy);
  await rejected(healthyDespiteCounterOutage(adminRequest("unauthorized", {
    owner: true
  })), "permission-denied");

  const unknownVerdict = createAdminContextHandler({
    environment: "staging",
    rateLimitGuard: { async check() { return undefined; } }
  });
  await rejected(unknownVerdict(adminRequest()), "resource-exhausted");
  assert.throws(() => createAdminContextHandler({
    environment: "staging", rateLimitGuard: {}
  }), /rate-limit guard/);
  assert.throws(() => createAdminContextHandler({
    environment: "staging", rateLimitGuard: "client-claims"
  }), /rate-limit guard/);

  const factory = createAdminContextFunctions({
    REGION: "southamerica-east1",
    environment: "staging",
    rateLimitGuard: disabled
  });
  assert.equal(typeof factory.obterContextoAdministrativoV12, "function");

  const root = path.resolve(__dirname, "..");
  const mainSource = fs.readFileSync(path.join(root, "functions/main.js"), "utf8");
  const adminSource = fs.readFileSync(path.join(root,
    "functions/src/admin/admin-context-functions.js"), "utf8");
  const policySource = fs.readFileSync(path.join(root,
    "functions/src/security/rate-limit-core.js"), "utf8");
  assert.ok(mainSource.includes("adminRuntimeAllowed"));
  assert.ok(mainSource.includes("createRateLimitGuard({ enabled: false })"));
  assert.ok(mainSource.includes("rateLimitGuard: adminContextReadRateLimitGuard"));
  assert.equal(mainSource.includes("createRateLimitGuard({ enabled: true"), false);
  assert.equal(mainSource.split("rateLimitGuard: adminContextReadRateLimitGuard").length - 1, 1,
    "only one opted-out exported read endpoint may receive this guard");
  assert.ok(adminSource.includes('scope: "authenticated_read"'));
  assert.ok(adminSource.includes("identity: actor.uid"));
  assert.equal(policySource.includes("defineSecret("), false,
    "no secret binding or new backend data writes in this gate");
  assert.ok(!adminSource.includes("request.rawRequest.ip"),
    "No untrusted client IP as identity for authenticated reads");
  const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
  assert.equal(Object.hasOwn(firebaseConfig, "hosting"), false);

  const workflow = fs.readFileSync(path.join(root,
    ".github/workflows/marco8-rc-regression.yml"), "utf8");
  assert.ok(workflow.includes("node tests/marco9-rate-limit-admin-context-v1_2.test.js"));
  assert.ok(workflow.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
  assert.ok(workflow.includes("  contents: read"));
  assert.ok(!workflow.includes("firebase deploy"));
  assert.ok(!workflow.includes("pull_request_target"));
  assert.ok(!workflow.includes("secrets."));

  console.log("MARCO9_2B2_AUTH_BEFORE_RATE_LIMIT=PASSED");
  console.log("MARCO9_2B2_TRUSTED_FIREBASE_AUTH_UID_ONLY=PASSED");
  console.log("MARCO9_2B2_RBAC_UNCHANGED=PASSED");
  console.log("MARCO9_2B2_DENIAL_SANITIZED_RESOURCE_EXHAUSTED=PASSED");
  console.log("MARCO9_2B2_COUNTER_OUTAGE_READ_DEGRADED=PASSED");
  console.log("MARCO9_2B2_DISABLED_RESPONSE_PARITY=PASSED");
  console.log("MARCO9_2B2_ONLY_ADMIN_CONTEXT_WIRED=PASSED");
  console.log("MARCO9_2B2_RATE_LIMIT_ENFORCEMENT=NOT_ENABLED");
  console.log("MARCO9_GATE_9_2B2_AUTH_READ_WIRING=PASSED");
  console.log("DEPLOY_EXECUTED=False");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
