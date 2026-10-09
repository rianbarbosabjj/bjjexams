"use strict";

// Marco 9.2A: opt-in, staging-only core. Not bound to any exported Function.
const crypto = require("node:crypto");
const STAGING_PROJECT = "bjj-exams-staging";
const COUNTER_COLLECTION = "_bjj_exams_rate_limits_v12";
const WINDOW_MS = 60_000;
const POLICIES = Object.freeze({
  public_read: Object.freeze({ limit: 90, windowMs: WINDOW_MS, failMode: "open" }),
  authenticated_read: Object.freeze({ limit: 120, windowMs: WINDOW_MS, failMode: "open" }),
  exam_mutation: Object.freeze({ limit: 12, windowMs: WINDOW_MS, failMode: "closed" }),
  checkout_mutation: Object.freeze({ limit: 5, windowMs: WINDOW_MS, failMode: "closed" }),
  admin_mutation: Object.freeze({ limit: 10, windowMs: WINDOW_MS, failMode: "closed" }),
  certificate_mutation: Object.freeze({ limit: 8, windowMs: WINDOW_MS, failMode: "closed" })
});
const EXTERNAL_INGRESSES_NOT_COVERED = Object.freeze([
  "asaasWebhook", "webhookAsaasPagamentosV12"
]);

function assertSecret(secret) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) {
    throw new TypeError("RATE_LIMIT_HMAC_SECRET_REQUIRED");
  }
}

function makeCounterId({ projectId, scope, identity, secret, windowIndex }) {
  assertSecret(secret);
  if (projectId !== STAGING_PROJECT || !Object.hasOwn(POLICIES, scope)) {
    throw new Error("RATE_LIMIT_UNSAFE_SCOPE_OR_PROJECT");
  }
  if (typeof identity !== "string" || !identity.trim() ||
      identity.length > 256 || /[\r\n]/.test(identity)) {
    throw new Error("RATE_LIMIT_TRUSTED_PRINCIPAL_REQUIRED");
  }
  if (!Number.isSafeInteger(windowIndex) || windowIndex < 0) {
    throw new Error("RATE_LIMIT_WINDOW_INVALID");
  }
  const digest = crypto.createHmac("sha256", secret)
    .update(projectId).update("\x00").update(scope).update("\x00")
    .update(identity).digest("hex");
  return digest + "_" + windowIndex;
}

function createFirestoreAtomicCounterStore({ db } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new TypeError("RATE_LIMIT_FIRESTORE_TRANSACTION_REQUIRED");
  }
  return Object.freeze({
    async consumeAtomic({ documentId, limit, expiresAtMs }) {
      if (!/^[a-f0-9]{64}_[0-9]+$/.test(documentId) ||
          !Number.isSafeInteger(limit) || limit < 1 ||
          !Number.isSafeInteger(expiresAtMs) || expiresAtMs < 1) {
        throw new Error("RATE_LIMIT_ATOMIC_INPUT_INVALID");
      }
      const ref = db.collection(COUNTER_COLLECTION).doc(documentId);
      return db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        const previous = snap.exists ? snap.data()?.count : 0;
        if (!Number.isSafeInteger(previous) || previous < 0) {
          throw new Error("RATE_LIMIT_COUNTER_INVALID");
        }
        if (previous >= limit) {
          return { allowed: false, count: previous };
        }
        const count = previous + 1;
        transaction.set(ref, { count, expiresAt: new Date(expiresAtMs) });
        return { allowed: true, count };
      });
    }
  });
}

function createRateLimitGuard({ enabled = false, projectId, secret, store, clock = Date.now } = {}) {
  if (typeof enabled !== "boolean") throw new TypeError("RATE_LIMIT_MODE_INVALID");
  if (enabled) {
    if (projectId !== STAGING_PROJECT) throw new Error("RATE_LIMIT_PRODUCTION_FORBIDDEN");
    assertSecret(secret);
    if (!store || typeof store.consumeAtomic !== "function") {
      throw new TypeError("RATE_LIMIT_ATOMIC_STORE_REQUIRED");
    }
    if (typeof clock !== "function") throw new TypeError("RATE_LIMIT_CLOCK_REQUIRED");
  }
  return Object.freeze({
    async check({ scope, identity } = {}) {
      if (!enabled) return { allowed: true, enforced: false, status: "NOT_ENABLED" };
      const policy = POLICIES[scope];
      if (!Object.hasOwn(POLICIES, scope) || !policy) {
        return { allowed: false, enforced: true, status: "UNKNOWN_SCOPE" };
      }
      let now;
      try {
        now = clock();
        if (!Number.isSafeInteger(now) || now < 0) throw new Error("CLOCK_INVALID");
        const windowIndex = Math.floor(now / policy.windowMs);
        const documentId = makeCounterId({ projectId, scope, identity, secret, windowIndex });
        const result = await store.consumeAtomic({
          documentId,
          limit: policy.limit,
          expiresAtMs: (windowIndex + 2) * policy.windowMs
        });
        if (!result || typeof result.allowed !== "boolean" ||
            !Number.isSafeInteger(result.count) || result.count < 0) {
          throw new Error("STORE_RESPONSE_INVALID");
        }
        const retryAfterSeconds = result.allowed
          ? 0 : Math.ceil(((windowIndex + 1) * policy.windowMs - now) / 1000);
        return {
          allowed: result.allowed,
          enforced: true,
          status: result.allowed ? "ALLOW" : "RATE_LIMITED",
          retryAfterSeconds
        };
      } catch (_) {
        return {
          allowed: policy.failMode === "open",
          enforced: true,
          status: policy.failMode === "open" ? "DEGRADED_READ_ONLY" : "GUARD_UNAVAILABLE",
          retryAfterSeconds: policy.failMode === "open" ? 0 : 5
        };
      }
    }
  });
}

module.exports = Object.freeze({
  STAGING_PROJECT, COUNTER_COLLECTION, POLICIES, EXTERNAL_INGRESSES_NOT_COVERED,
  makeCounterId, createFirestoreAtomicCounterStore, createRateLimitGuard
});
