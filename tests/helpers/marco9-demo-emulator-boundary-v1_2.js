"use strict";

// Test-only Firestore boundary. No production/staging SDK initialization.
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const DEMO_PROJECT = "demo-bjj-exams-resilience";
const ALLOWED_EMULATOR_HOSTS = new Set(["127.0.0.1:8080", "localhost:8080"]);

function assertEmulatorOnly() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!ALLOWED_EMULATOR_HOSTS.has(host)) {
    throw new Error("MARCO9_DEMO_FIRESTORE_EMULATOR_LOOPBACK_REQUIRED");
  }
  for (const name of ["GCLOUD_PROJECT","GOOGLE_CLOUD_PROJECT","FIREBASE_PROJECT_ID"]) {
    if (process.env[name] !== DEMO_PROJECT) {
      throw new Error("MARCO9_DEMO_PROJECT_ENV_REQUIRED");
    }
  }
  // No service account should be needed or used in this test.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_TOKEN) {
    throw new Error("MARCO9_DEMO_CREDENTIALS_FORBIDDEN");
  }
}

async function runWithDemoFirestore(label, callback) {
  assertEmulatorOnly(); // Must execute before loading Admin SDK.
  assert.match(label, /^[a-z0-9_-]{3,50}$/);
  const requireFromFunctions = createRequire(path.resolve(__dirname,"../../functions/package.json"));
  const { initializeApp, deleteApp } = requireFromFunctions("firebase-admin/app");
  const { getFirestore } = requireFromFunctions("firebase-admin/firestore");
  const app = initializeApp({ projectId: DEMO_PROJECT }, "marco9-" + label);
  try {
    assert.equal(app.options.projectId, DEMO_PROJECT);
    const db = getFirestore(app);
    return await callback({ db, projectId: DEMO_PROJECT });
  } finally {
    await deleteApp(app);
  }
}
module.exports = Object.freeze({ DEMO_PROJECT, assertEmulatorOnly, runWithDemoFirestore });
