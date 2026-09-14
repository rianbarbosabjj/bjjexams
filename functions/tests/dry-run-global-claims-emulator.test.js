"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  initializeApp,
  deleteApp
} = require("firebase-admin/app");

const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

function assertLocalEmulator(name, value) {
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  const pattern = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;

  if (!pattern.test(value)) {
    throw new Error(`${name} is not local: ${value}`);
  }
}

assertLocalEmulator(
  "FIRESTORE_EMULATOR_HOST",
  process.env.FIRESTORE_EMULATOR_HOST
);

assertLocalEmulator(
  "FIREBASE_AUTH_EMULATOR_HOST",
  process.env.FIREBASE_AUTH_EMULATOR_HOST
);

const projectId = "demo-bjj-exams";

const app = initializeApp(
  { projectId },
  `dry-run-inventory-${process.pid}-${Date.now()}`
);

const db = getFirestore(app);
const auth = getAuth(app);

const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createdUids = [];
const createdDocs = [];

function uid(suffix) {
  return `dryrun_${runId}_${suffix}`;
}

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex")
    .slice(0, 12);
}

async function createAuthUser(userId, claims = {}) {
  await auth.createUser({ uid: userId });
  createdUids.push(userId);

  if (Object.keys(claims).length > 0) {
    await auth.setCustomUserClaims(userId, claims);
  }
}

async function createDoc(docPath, data) {
  await db.doc(docPath).set(data);
  createdDocs.push(docPath);
}

async function getClaims(userId) {
  const user = await auth.getUser(userId);
  return user.customClaims || {};
}

async function cleanup() {
  await Promise.allSettled(
    createdDocs.map((docPath) => db.doc(docPath).delete())
  );

  await Promise.allSettled(
    createdUids.map((userId) => auth.deleteUser(userId))
  );

  await deleteApp(app);
}

function parseInventoryOutput(stdout) {
  const candidates = [];
  let summary = null;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith("CANDIDATE=")) {
      candidates.push(
        JSON.parse(line.slice("CANDIDATE=".length))
      );
    }

    if (line.startsWith("SUMMARY=")) {
      summary = JSON.parse(line.slice("SUMMARY=".length));
    }
  }

  if (!summary) {
    throw new Error("SUMMARY not found in inventory output.");
  }

  return { candidates, summary };
}

async function main() {
  console.log(`AUTH_EMULATOR=${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
  console.log(`FIRESTORE_EMULATOR=${process.env.FIRESTORE_EMULATOR_HOST}`);

  const addUid = uid("add");
  const replaceUid = uid("replace");
  const removeUid = uid("remove");
  const noChangeUid = uid("nochange");
  const missingUid = uid("missing");
  const regularUid = uid("regular");

  await createAuthUser(addUid);
  await createDoc(`admins/${addUid}`, { ativo: true });
  await createDoc(`usuarios/${addUid}`, { tipo_usuario: "aluno" });

  await createAuthUser(replaceUid, {
    platform_admin: true,
    finance_admin: true
  });
  await createDoc(`super_admins/${replaceUid}`, { ativo: true });
  await createDoc(`admins/${replaceUid}`, { ativo: true });
  await createDoc(`usuarios/${replaceUid}`, { tipo_usuario: "admin" });

  await createAuthUser(removeUid, {
    platform_admin: true,
    support_admin: true
  });
  await createDoc(`usuarios/${removeUid}`, { tipo_usuario: "aluno" });

  await createAuthUser(noChangeUid, {
    platform_admin: true,
    support_admin: true
  });
  await createDoc(`admins/${noChangeUid}`, { ativo: true });

  await createDoc(`admins/${missingUid}`, { ativo: true });

  await createAuthUser(regularUid);
  await createDoc(`usuarios/${regularUid}`, { tipo_usuario: "aluno" });

  const before = {
    add: await getClaims(addUid),
    replace: await getClaims(replaceUid),
    remove: await getClaims(removeUid),
    noChange: await getClaims(noChangeUid),
    regular: await getClaims(regularUid)
  };

  const inventoryScript = path.resolve(
    __dirname,
    "../scripts/dry-run-global-claims.js"
  );

  const run = spawnSync(
    process.execPath,
    [inventoryScript, `--project=${projectId}`],
    {
      env: process.env,
      encoding: "utf8"
    }
  );

  if (run.stdout) {
    process.stdout.write(run.stdout);
  }

  if (run.stderr) {
    process.stderr.write(run.stderr);
  }

  assert.equal(run.status, 0);

  const { candidates, summary } =
    parseInventoryOutput(run.stdout);

  assert.equal(summary.candidateCount, 5);
  assert.equal(summary.wouldChange, 3);
  assert.equal(summary.noChange, 1);
  assert.equal(summary.authMissing, 1);

  assert.equal(summary.actions.WOULD_ADD, 1);
  assert.equal(summary.actions.WOULD_REPLACE, 1);
  assert.equal(summary.actions.WOULD_REMOVE, 1);
  assert.equal(summary.actions.NO_CHANGE, 1);
  assert.equal(summary.actions.AUTH_USER_MISSING, 1);

  const byFingerprint = new Map(
    candidates.map((item) => [item.fingerprint, item])
  );

  assert.equal(
    byFingerprint.get(fingerprint(addUid)).action,
    "WOULD_ADD"
  );

  assert.equal(
    byFingerprint.get(fingerprint(replaceUid)).action,
    "WOULD_REPLACE"
  );

  assert.equal(
    byFingerprint.get(fingerprint(removeUid)).action,
    "WOULD_REMOVE"
  );

  assert.equal(
    byFingerprint.get(fingerprint(noChangeUid)).action,
    "NO_CHANGE"
  );

  assert.equal(
    byFingerprint.get(fingerprint(missingUid)).action,
    "AUTH_USER_MISSING"
  );

  assert.equal(
    byFingerprint.has(fingerprint(regularUid)),
    false
  );

  const after = {
    add: await getClaims(addUid),
    replace: await getClaims(replaceUid),
    remove: await getClaims(removeUid),
    noChange: await getClaims(noChangeUid),
    regular: await getClaims(regularUid)
  };

  assert.deepEqual(after, before);

  console.log("CLAIMS_UNCHANGED_AFTER_DRY_RUN=True");
  console.log("REGULAR_USER_EXCLUDED=True");
  console.log("RESULTADO_DRY_RUN_GLOBAL_CLAIMS_EMULATOR=5/5");
}

main()
  .then(cleanup)
  .catch(async (error) => {
    console.error(error);

    try {
      await cleanup();
    } catch (_) {
      // Emulator sera descartado.
    }

    process.exit(1);
  });
