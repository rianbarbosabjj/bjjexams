"use strict";

// Real Firestore Emulator integration. NEVER run against a live Firebase project.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const {
  STAGING_PROJECT, COUNTER_COLLECTION, POLICIES,
  makeCounterId, createFirestoreAtomicCounterStore, createRateLimitGuard
} = require("../functions/src/security/rate-limit-core");

const DEMO_PROJECT = "demo-bjj-exams-rate-limit";
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const TEST_HMAC_SECRET = Buffer.from("emulator-test-only-hmac-secret-32-bytes-minimum-2026");

function verifyEmulatorBoundary() {
  if (!/^(127\.0\.0\.1|localhost):8080$/.test(EMULATOR_HOST)) {
    throw new Error("RATE_LIMIT_TEST_REQUIRES_LOOPBACK_FIRESTORE_EMULATOR_8080");
  }
  for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "FIREBASE_PROJECT_ID"]) {
    const value = process.env[key];
    if (value && value !== DEMO_PROJECT) {
      throw new Error("RATE_LIMIT_TEST_REQUIRES_DEMO_PROJECT");
    }
  }
  const main = fs.readFileSync(path.join(__dirname, "..", "functions/main.js"), "utf8");
  assert.ok(!main.includes("createRateLimitGuard"),
    "Gate 9.2B must not wire enforcement to real Cloud Functions");
  assert.equal(STAGING_PROJECT, "bjj-exams-staging");
  assert.equal(DEMO_PROJECT.startsWith("demo-"), true);
  assert.notEqual(DEMO_PROJECT, STAGING_PROJECT);
  assert.notEqual(DEMO_PROJECT, "bjj-exams");
}

async function main() {
  verifyEmulatorBoundary();
  const requireFromFunctions = createRequire(path.join(__dirname, "../functions/package.json"));
  const { initializeApp, deleteApp } = requireFromFunctions("firebase-admin/app");
  const { getFirestore } = requireFromFunctions("firebase-admin/firestore");
  const app = initializeApp({ projectId: DEMO_PROJECT }, "marco9-rate-limit-emulator");
  try {
    const db = getFirestore(app);
    assert.equal(app.options.projectId, DEMO_PROJECT);
    const store = createFirestoreAtomicCounterStore({ db });
    let now = 12_000;
    const guard = createRateLimitGuard({
      enabled: true,
      projectId: STAGING_PROJECT, // policy contract; storage stays in the isolated demo emulator
      secret: TEST_HMAC_SECRET,
      store,
      clock: () => now
    });
    const checkout = "checkout_mutation";
    const identity = "synthetic-user-1";
    const windowIndex = Math.floor(now / POLICIES.checkout_mutation.windowMs);
    const key = makeCounterId({
      projectId: STAGING_PROJECT,
      scope: checkout,
      identity,
      secret: TEST_HMAC_SECRET,
      windowIndex
    });
    assert.match(key, /^[a-f0-9]{64}_0$/);
    assert.equal(key.includes(identity), false);
    const requests = await Promise.all(
      Array.from({ length: 12 }, () => guard.check({ scope: checkout, identity }))
    );
    const allowed = requests.filter(item => item.allowed);
    const denied = requests.filter(item => !item.allowed);
    assert.equal(allowed.length, 5, "Only 5 of 12 concurrent checkout attempts can pass");
    assert.equal(denied.length, 7);
    assert.ok(allowed.every(item => item.status === "ALLOW"));
    assert.ok(denied.every(item => item.status === "RATE_LIMITED"),
      "A healthy emulator should return rate-limit denials, not store outages");
    assert.ok(denied.every(item => item.retryAfterSeconds === 48));

    const bucket = await db.collection(COUNTER_COLLECTION).doc(key).get();
    assert.equal(bucket.exists, true);
    assert.equal(bucket.data().count, 5);
    assert.ok(bucket.data().expiresAt.toMillis() > now);
    assert.deepEqual(Object.keys(bucket.data()).sort(), ["count", "expiresAt"]);
    assert.equal(JSON.stringify(bucket.data()).includes(identity), false);

    const otherPerson = await guard.check({ scope: checkout, identity: "synthetic-user-2" });
    assert.equal(otherPerson.status, "ALLOW");
    const exam = await guard.check({ scope: "exam_mutation", identity });
    assert.equal(exam.status, "ALLOW");
    now = 60_001;
    const nextWindow = await guard.check({ scope: checkout, identity });
    assert.equal(nextWindow.status, "ALLOW");

    // A corrupt Firestore counter must fail CLOSED for financial mutations.
    const corruptId = makeCounterId({
      projectId: STAGING_PROJECT, scope: checkout,
      identity: "synthetic-corrupt", secret: TEST_HMAC_SECRET,
      windowIndex: Math.floor(now / POLICIES.checkout_mutation.windowMs)
    });
    await db.collection(COUNTER_COLLECTION).doc(corruptId).set({
      count: "corrupt", expiresAt: new Date(120_000)
    });
    const corrupt = await guard.check({
      scope: checkout, identity: "synthetic-corrupt"
    });
    assert.deepEqual(corrupt, {
      allowed: false, enforced: true,
      status: "GUARD_UNAVAILABLE", retryAfterSeconds: 5
    });

    // Disabled by default means zero writes, even with a real Firestore instance.
    const countBeforeDisabled = (await db.collection(COUNTER_COLLECTION).get()).size;
    const disabled = createRateLimitGuard({ enabled: false, store });
    assert.deepEqual(await disabled.check({ scope: checkout, identity: "synthetic-disabled" }),
      { allowed: true, enforced: false, status: "NOT_ENABLED" });
    const countAfterDisabled = (await db.collection(COUNTER_COLLECTION).get()).size;
    assert.equal(countAfterDisabled, countBeforeDisabled);
    assert.equal((await guard.check({ scope: "webhook_ingress", identity })).allowed,
      false, "No browser-rate-limit policy may target external Asaas webhook ingress");

    console.log("MARCO9_2B_FIRESTORE_EMULATOR_PROJECT=DEMO_ONLY");
    console.log("MARCO9_2B_REAL_FIRESTORE_TRANSACTIONS=PASSED");
    console.log("MARCO9_2B_CONCURRENT_CHECKOUT=5_ALLOWED_7_DENIED");
    console.log("MARCO9_2B_SCOPE_AND_WINDOW_ISOLATION=PASSED");
    console.log("MARCO9_2B_CORRUPT_COUNTER_FAIL_CLOSED=PASSED");
    console.log("MARCO9_2B_DISABLED_MODE_ZERO_WRITES=PASSED");
    console.log("MARCO9_2B_CLOUD_PROJECT_ACCESS=NOT_RUN");
    console.log("RATE_LIMIT_ENFORCEMENT=NOT_WIRED");
    console.log("STAGING_DEPLOY=NOT_RUN");
    console.log("PRODUCTION_ACCESS=NOT_RUN");
  } finally {
    await deleteApp(app);
  }
}

main().catch(error => {
  console.error("MARCO9_2B_EMULATOR_TEST_FAILED", error?.message || "unknown");
  process.exitCode = 1;
});
