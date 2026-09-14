"use strict";

const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const {
  deriveGlobalClaims,
  mergeSynchronizedGlobalClaims,
  SYNCHRONIZED_GLOBAL_CLAIMS
} = require("../src/auth/global-claims");

const STAGING_PROJECT = "bjj-exams-staging";

function argValue(name) {
  const exact = `--${name}`;
  const inline = `${exact}=`;

  for (let i = 2; i < process.argv.length; i += 1) {
    const current = process.argv[i];

    if (current === exact) {
      return process.argv[i + 1] || null;
    }

    if (current.startsWith(inline)) {
      return current.slice(inline.length) || null;
    }
  }

  return null;
}

function projectFromFirebaseConfig() {
  try {
    const raw = process.env.FIREBASE_CONFIG || "";

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return parsed.projectId || null;
  } catch {
    return null;
  }
}

function resolveProjectId() {
  return argValue("project") ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    projectFromFirebaseConfig() ||
    null;
}

function isLoopbackHost(host) {
  const value = String(host || "").trim().toLowerCase();

  return value.startsWith("127.0.0.1:") ||
    value.startsWith("localhost:") ||
    value.startsWith("[::1]:");
}

function isLocalEmulatorMode() {
  return isLoopbackHost(process.env.FIRESTORE_EMULATOR_HOST) &&
    isLoopbackHost(process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

function assertSafeTarget(projectId) {
  if (!projectId) {
    throw new Error("Project ID is required.");
  }

  if (isLocalEmulatorMode()) {
    return "emulator";
  }

  if (projectId !== STAGING_PROJECT) {
    throw new Error("Only bjj-exams-staging is allowed.");
  }

  return "staging";
}

function ensureApp(projectId) {
  if (getApps().length === 0) {
    initializeApp({ projectId });
  }
}

function normalizeUserType(data = {}) {
  return String(
    data.tipo_usuario ||
    data.tipoUsuario ||
    data.papel_principal ||
    ""
  ).trim().toLowerCase() || null;
}

function isAdministrativeUserType(userType) {
  return userType === "admin" || userType === "administrador";
}

function fingerprint(uid) {
  return crypto
    .createHash("sha256")
    .update(String(uid))
    .digest("hex")
    .slice(0, 12);
}

function synchronizedClaimView(claims = {}) {
  const result = {};

  for (const key of SYNCHRONIZED_GLOBAL_CLAIMS) {
    if (claims[key] === true) {
      result[key] = true;
    }
  }

  return result;
}

function classifyAction(existingClaims, desiredClaims, mergedClaims) {
  if (isDeepStrictEqual(existingClaims, mergedClaims)) {
    return "NO_CHANGE";
  }

  const current = synchronizedClaimView(existingClaims);
  const desired = synchronizedClaimView(desiredClaims);

  const currentKeys = Object.keys(current);
  const desiredKeys = Object.keys(desired);

  if (currentKeys.length === 0 && desiredKeys.length > 0) {
    return "WOULD_ADD";
  }

  if (currentKeys.length > 0 && desiredKeys.length === 0) {
    return "WOULD_REMOVE";
  }

  if (currentKeys.length > 0 && desiredKeys.length > 0) {
    return "WOULD_REPLACE";
  }

  return "WOULD_CLEAN_STALE_VALUES";
}

async function readCollection(db, name) {
  const snapshot = await db.collection(name).get();
  const result = new Map();

  for (const doc of snapshot.docs) {
    result.set(doc.id, doc.data() || {});
  }

  return result;
}

async function listAllAuthUsers(auth) {
  const users = new Map();
  let pageToken;

  do {
    const page = await auth.listUsers(1000, pageToken);

    for (const user of page.users) {
      users.set(user.uid, user);
    }

    pageToken = page.pageToken;
  } while (pageToken);

  return users;
}

function buildCandidateUids({
  superAdmins,
  admins,
  usuarios,
  authUsers
}) {
  const candidates = new Set();

  for (const uid of superAdmins.keys()) {
    candidates.add(uid);
  }

  for (const uid of admins.keys()) {
    candidates.add(uid);
  }

  for (const [uid, data] of usuarios.entries()) {
    if (isAdministrativeUserType(normalizeUserType(data))) {
      candidates.add(uid);
    }
  }

  for (const [uid, user] of authUsers.entries()) {
    const claims = user.customClaims || {};

    if (
      claims.super_admin === true ||
      claims.platform_admin === true ||
      Object.prototype.hasOwnProperty.call(claims, "super_admin") ||
      Object.prototype.hasOwnProperty.call(claims, "platform_admin")
    ) {
      candidates.add(uid);
    }
  }

  return [...candidates].sort();
}

function inspectCandidate(uid, sources) {
  const {
    superAdmins,
    admins,
    usuarios,
    authUsers
  } = sources;

  const userData = usuarios.get(uid) || {};
  const userType = normalizeUserType(userData);
  const authUser = authUsers.get(uid) || null;

  const authoritativeSources = {
    hasSuperAdminMarker: superAdmins.has(uid),
    hasAdminMarker: admins.has(uid),
    userType
  };

  const desiredClaims = deriveGlobalClaims(authoritativeSources);

  if (!authUser) {
    return {
      fingerprint: fingerprint(uid),
      authExists: false,
      sources: authoritativeSources,
      current: {},
      desired: synchronizedClaimView(desiredClaims),
      preservedClaimCount: 0,
      action: "AUTH_USER_MISSING"
    };
  }

  const existingClaims = authUser.customClaims || {};

  const mergedClaims = mergeSynchronizedGlobalClaims(
    existingClaims,
    desiredClaims
  );

  const preservedClaimCount = Object.keys(existingClaims)
    .filter((key) => !SYNCHRONIZED_GLOBAL_CLAIMS.includes(key))
    .length;

  return {
    fingerprint: fingerprint(uid),
    authExists: true,
    sources: authoritativeSources,
    current: synchronizedClaimView(existingClaims),
    desired: synchronizedClaimView(desiredClaims),
    preservedClaimCount,
    action: classifyAction(
      existingClaims,
      desiredClaims,
      mergedClaims
    )
  };
}

function summarize(results, sourceCounts) {
  const actions = {};

  for (const result of results) {
    actions[result.action] = (actions[result.action] || 0) + 1;
  }

  return {
    ...sourceCounts,
    candidateCount: results.length,
    wouldChange: results.filter(
      (item) => item.action.startsWith("WOULD_")
    ).length,
    noChange: results.filter(
      (item) => item.action === "NO_CHANGE"
    ).length,
    authMissing: results.filter(
      (item) => item.action === "AUTH_USER_MISSING"
    ).length,
    actions
  };
}

async function main() {
  const projectId = resolveProjectId();
  const mode = assertSafeTarget(projectId);

  ensureApp(projectId);

  const db = getFirestore();
  const auth = getAuth();

  console.log("MODE=READ_ONLY");
  console.log(`TARGET_PROJECT=${projectId}`);
  console.log(`EXECUTION_MODE=${mode}`);
  console.log("WRITE_CAPABILITY=False");
  console.log("INVENTORY_START=True");

  const [superAdmins, admins, usuarios, authUsers] =
    await Promise.all([
      readCollection(db, "super_admins"),
      readCollection(db, "admins"),
      readCollection(db, "usuarios"),
      listAllAuthUsers(auth)
    ]);

  const candidates = buildCandidateUids({
    superAdmins,
    admins,
    usuarios,
    authUsers
  });

  const results = candidates.map((uid) =>
    inspectCandidate(uid, {
      superAdmins,
      admins,
      usuarios,
      authUsers
    })
  );

  for (const result of results) {
    console.log(`CANDIDATE=${JSON.stringify(result)}`);
  }

  const summary = summarize(results, {
    superAdminMarkers: superAdmins.size,
    adminMarkers: admins.size,
    usuariosScanned: usuarios.size,
    authUsersScanned: authUsers.size
  });

  console.log(`SUMMARY=${JSON.stringify(summary)}`);
  console.log("WRITE_CAPABILITY=False");
  console.log("DRY_RUN_GLOBAL_CLAIMS_INVENTORY=APROVADO");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
