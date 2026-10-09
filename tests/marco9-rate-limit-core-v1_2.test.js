"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  STAGING_PROJECT, COUNTER_COLLECTION, POLICIES, EXTERNAL_INGRESSES_NOT_COVERED,
  makeCounterId, createFirestoreAtomicCounterStore, createRateLimitGuard
} = require("../functions/src/security/rate-limit-core");

function fakeFirestore() {
  const data = new Map();
  let tail = Promise.resolve();
  let writes = 0;
  const db = {
    collection(name) {
      assert.equal(name, COUNTER_COLLECTION);
      return { doc(id) { return { id }; } };
    },
    runTransaction(work) {
      const job = tail.then(async () => {
        const changes = [];
        const result = await work({
          async get(ref) {
            return {
              exists: data.has(ref.id),
              data() { return data.get(ref.id); }
            };
          },
          set(ref, value) { changes.push([ref.id, value]); }
        });
        for (const [key, value] of changes) {
          writes++;
          data.set(key, value);
        }
        return result;
      });
      tail = job.then(() => undefined, () => undefined);
      return job;
    }
  };
  return { db, data, getWrites: () => writes };
}

async function run() {
  assert.equal(STAGING_PROJECT, "bjj-exams-staging");
  assert.deepEqual([...EXTERNAL_INGRESSES_NOT_COVERED],
    ["asaasWebhook", "webhookAsaasPagamentosV12"]);
  assert.ok(!Object.hasOwn(POLICIES, "webhook_ingress"));
  const secret = Buffer.from("unit-test-hmac-key-which-is-more-than-32-bytes");
  assert.throws(() => makeCounterId({ projectId: STAGING_PROJECT,
    scope: "checkout_mutation", identity: "user-1", secret: Buffer.from("short"),
    windowIndex: 0 }), /HMAC_SECRET_REQUIRED/);
  const id = makeCounterId({ projectId: STAGING_PROJECT,
    scope: "checkout_mutation", identity: "email:test@example.invalid", secret,
    windowIndex: 1 });
  assert.match(id, /^[a-f0-9]{64}_1$/);
  assert.equal(id.includes("test@example.invalid"), false);
  assert.notEqual(id, makeCounterId({ projectId: STAGING_PROJECT,
    scope: "exam_mutation", identity: "email:test@example.invalid", secret,
    windowIndex: 1 }));
  assert.notEqual(id, makeCounterId({ projectId: STAGING_PROJECT,
    scope: "checkout_mutation", identity: "email:test@example.invalid", secret,
    windowIndex: 2 }));
  assert.throws(() => makeCounterId({ projectId: STAGING_PROJECT,
    scope: "checkout_mutation", identity: "foo\r\nbar", secret,
    windowIndex: 1 }), /TRUSTED_PRINCIPAL_REQUIRED/);
  assert.throws(() => createRateLimitGuard({
    enabled: true, projectId: "bjj-exams", secret,
    store: { consumeAtomic() {} }
  }), /PRODUCTION_FORBIDDEN/);
  assert.throws(() => createRateLimitGuard({
    enabled: true, projectId: STAGING_PROJECT, secret
  }), /ATOMIC_STORE_REQUIRED/);

  let touched = 0;
  const disabled = createRateLimitGuard({ enabled: false,
    store: { async consumeAtomic() { touched++; throw new Error("no"); } } });
  assert.deepEqual(await disabled.check({ scope: "checkout_mutation", identity: "user" }),
    { allowed: true, enforced: false, status: "NOT_ENABLED" });
  assert.equal(touched, 0);

  let now = 12_000;
  const { db, data, getWrites } = fakeFirestore();
  const store = createFirestoreAtomicCounterStore({ db });
  const guard = createRateLimitGuard({
    enabled: true, projectId: STAGING_PROJECT, secret, store,
    clock: () => now
  });
  assert.deepEqual(await guard.check({ scope: "not_known", identity: "user-1" }),
    { allowed: false, enforced: true, status: "UNKNOWN_SCOPE" });
  const checks = await Promise.all(Array.from({ length: 12 }, () =>
    guard.check({ scope: "checkout_mutation", identity: "user-1" })));
  assert.equal(checks.filter(x => x.allowed).length, POLICIES.checkout_mutation.limit);
  assert.equal(checks.filter(x => !x.allowed).length, 7);
  assert.ok(checks.slice(5).every(x => x.status === "RATE_LIMITED" &&
    x.retryAfterSeconds === 48));
  assert.equal(getWrites(), 5, "denied requests do not write");
  assert.equal(data.size, 1, "all concurrent calls use single atomic bucket");
  const record = [...data.values()][0];
  assert.equal(record.count, 5);
  assert.ok(record.expiresAt instanceof Date);
  assert.equal(JSON.stringify(record).includes("user-1"), false);

  assert.equal((await guard.check({ scope: "checkout_mutation", identity: "user-2" })).allowed,
    true, "other principal has distinct counter");
  assert.equal((await guard.check({ scope: "exam_mutation", identity: "user-1" })).allowed,
    true, "other scope has distinct counter");
  now = 61_001;
  assert.equal((await guard.check({ scope: "checkout_mutation", identity: "user-1" })).allowed,
    true, "next minute resets bucket");

  const errorStore = { async consumeAtomic() { throw new Error(
    "SENSITIVE_INTERNAL_FAILURE_WITH_SECRET"); } };
  const degraded = createRateLimitGuard({
    enabled: true, projectId: STAGING_PROJECT, secret, store: errorStore, clock: () => 0
  });
  assert.deepEqual(await degraded.check({ scope: "public_read", identity: "browser" }),
    { allowed: true, enforced: true, status: "DEGRADED_READ_ONLY", retryAfterSeconds: 0 });
  assert.deepEqual(await degraded.check({ scope: "checkout_mutation", identity: "user" }),
    { allowed: false, enforced: true, status: "GUARD_UNAVAILABLE", retryAfterSeconds: 5 });
  assert.deepEqual(await degraded.check({ scope: "admin_mutation", identity: "user" }),
    { allowed: false, enforced: true, status: "GUARD_UNAVAILABLE", retryAfterSeconds: 5 });
  assert.equal((await guard.check({ scope: "checkout_mutation", identity: "" })).allowed,
    false, "sensitive commands fail closed without a trusted principal");
  const source = fs.readFileSync(path.join(__dirname,
    "../functions/src/security/rate-limit-core.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "../functions/main.js"), "utf8");
  assert.equal(main.includes("createRateLimitGuard"), false,
    "rate limiter must NOT be wired to exported Functions in gate 9.2A");
  assert.equal(source.includes("defineSecret("), false);
  assert.equal(source.includes("firebase deploy"), false);

  const docs = fs.readFileSync(path.join(__dirname,
    "../docs/architecture/MARCO_9_2_RATE_LIMITING.md"), "utf8");
  for (const word of ["Gate 9.2A", "Gate 9.2B", "bjj-exams-staging",
    "NO_ENFORCEMENT", "NO_DEPLOY", "Asaas Sandbox", "webhook", "atomic",
    "HMAC", "TTL", "checkout_mutation"]) {
    assert.ok(docs.includes(word), "Missing planning contract: " + word);
  }
  const ci = fs.readFileSync(path.join(__dirname,
    "../.github/workflows/marco8-rc-regression.yml"), "utf8");
  assert.ok(ci.includes("node tests/marco9-rate-limit-core-v1_2.test.js"));
  assert.ok(!ci.includes("firebase deploy"));
  assert.ok(!ci.includes("secrets."));
  assert.ok(ci.includes("  contents: read"));

  console.log("MARCO9_2A_ATOMIC_CHECKOUT_CONCURRENCY=5/12");
  console.log("MARCO9_2A_IDENTITY_HMAC=PASSED");
  console.log("MARCO9_2A_SENSITIVE_FAIL_CLOSED=PASSED");
  console.log("MARCO9_2A_PUBLIC_READ_DEGRADED=PASSED");
  console.log("MARCO9_2A_LEGACY_WEBHOOK_EXCLUDED=PASSED");
  console.log("MARCO9_2A_BACKEND_ENFORCEMENT=NOT_ENABLED");
  console.log("MARCO9_GATE_9_2A_RATE_LIMIT_CORE=PASSED");
  console.log("DEPLOY_EXECUTED=False");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
