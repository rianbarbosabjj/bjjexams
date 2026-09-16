"use strict";

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const crypto =
  require("node:crypto");

const {
  initializeApp
} =
  require("firebase-admin/app");

const {
  getFirestore
} =
  require("firebase-admin/firestore");

const {
  getAuth
} =
  require("firebase-admin/auth");

const {
  buildMigrationPlan
} =
  require("../src/migration/legacy-v1_2");

const {
  canonicalize,
  buildStagingPreparation
} =
  require("../src/migration/legacy-v1_2-staging-gate");

const {
  applyPlanToStaging
} =
  require("../src/migration/legacy-v1_2-staging-executor");

const STAGING_PROJECT =
  "bjj-exams-staging";

function argument(name) {
  const exact =
    `--${name}`;

  const prefix =
    `${exact}=`;

  for (
    let index = 2;
    index < process.argv.length;
    index++
  ) {
    const value =
      process.argv[index];

    if (value === exact) {
      return true;
    }

    if (
      value.startsWith(prefix)
    ) {
      return value.slice(
        prefix.length
      );
    }
  }

  return null;
}

async function readCollection(
  db,
  name
) {
  const snapshot =
    await db
      .collection(name)
      .get();

  return new Map(
    snapshot.docs.map(
      doc => [
        doc.id,
        doc.data() || {}
      ]
    )
  );
}

async function listAllAuthUsers(
  auth
) {
  const result =
    new Map();

  let pageToken;

  do {
    const page =
      await auth.listUsers(
        1000,
        pageToken
      );

    for (
      const user
      of page.users
    ) {
      result.set(
        user.uid,
        user
      );
    }

    pageToken =
      page.pageToken;

  } while (pageToken);

  return result;
}

async function readSnapshot(
  db,
  auth
) {
  const [
    usuarios,
    alunos,
    professores,
    admins,
    superAdmins,
    equipes,
    organizacoes,
    vinculos,
    users,
    organizations,
    organizationMemberships,
    authUsers
  ] =
    await Promise.all([
      readCollection(db, "usuarios"),
      readCollection(db, "alunos"),
      readCollection(db, "professores"),
      readCollection(db, "admins"),
      readCollection(db, "super_admins"),
      readCollection(db, "equipes"),
      readCollection(db, "organizacoes"),
      readCollection(db, "vinculos_organizacao"),
      readCollection(db, "users"),
      readCollection(db, "organizations"),
      readCollection(db, "organization_memberships"),
      listAllAuthUsers(auth)
    ]);

  return {
    usuarios,
    alunos,
    professores,
    admins,
    superAdmins,
    equipes,
    organizacoes,
    vinculos,
    users,
    organizations,
    organizationMemberships,
    authUsers
  };
}

function serializeMap(map) {
  return [...map.entries()]
    .sort(
      ([a], [b]) =>
        a.localeCompare(b)
    )
    .map(
      ([id, value]) => [
        id,
        canonicalize(value)
      ]
    );
}

function legacyFingerprint(
  snapshot
) {
  const payload = {
    usuarios:
      serializeMap(
        snapshot.usuarios
      ),

    alunos:
      serializeMap(
        snapshot.alunos
      ),

    professores:
      serializeMap(
        snapshot.professores
      ),

    admins:
      serializeMap(
        snapshot.admins
      ),

    superAdmins:
      serializeMap(
        snapshot.superAdmins
      ),

    equipes:
      serializeMap(
        snapshot.equipes
      ),

    organizacoes:
      serializeMap(
        snapshot.organizacoes
      ),

    vinculos:
      serializeMap(
        snapshot.vinculos
      )
  };

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(payload)
    )
    .digest("hex");
}

function countActions(
  plan,
  operation
) {
  return [
    ...plan.actions.users,
    ...plan.actions.organizations,
    ...plan.actions.memberships
  ].filter(
    action =>
      action.operation ===
      operation
  ).length;
}

async function main() {
  const apply =
    argument("apply") ===
    true;

  const projectId =
    argument("project");

  const approvalToken =
    argument(
      "approval-token"
    );

  const expectedPlanSha256 =
    argument(
      "expected-plan-sha256"
    );

  const expectedCreateCount =
    Number(
      argument(
        "expected-create-count"
      )
    );

  if (!apply) {
    throw new Error(
      "--apply is mandatory."
    );
  }

  if (
    projectId !==
    STAGING_PROJECT
  ) {
    throw new Error(
      "STAGING APPLY BLOCKED: only bjj-exams-staging is allowed."
    );
  }

  if (
    process.env
      .FIRESTORE_EMULATOR_HOST ||
    process.env
      .FIREBASE_AUTH_EMULATOR_HOST
  ) {
    throw new Error(
      "STAGING APPLY BLOCKED: emulator variables present."
    );
  }

  if (
    !approvalToken ||
    !expectedPlanSha256 ||
    !Number.isInteger(
      expectedCreateCount
    )
  ) {
    throw new Error(
      "STAGING APPLY BLOCKED: approval arguments missing."
    );
  }

  initializeApp({
    projectId
  });

  const db =
    getFirestore();

  const auth =
    getAuth();

  console.log(
    "MIGRATION_MODE=STAGING_APPLY"
  );

  console.log(
    `TARGET_PROJECT=${projectId}`
  );

  console.log(
    "PRODUCTION_ACCESS=False"
  );

  const before =
    await readSnapshot(
      db,
      auth
    );

  const legacyHashBefore =
    legacyFingerprint(
      before
    );

  const planBefore =
    buildMigrationPlan(
      before
    );

  const prepBefore =
    buildStagingPreparation({
      plan:
        planBefore,
      projectId
    });

  console.log(
    `PRE_APPLY_PLAN_SHA256=${prepBefore.planSha256}`
  );

  console.log(
    `PRE_APPLY_CREATE=${prepBefore.actions.create}`
  );

  console.log(
    `PRE_APPLY_USERS_CREATE=${prepBefore.actions.usersToCreate}`
  );

  console.log(
    `PRE_APPLY_ORGANIZATIONS_CREATE=${prepBefore.actions.organizationsToCreate}`
  );

  console.log(
    `PRE_APPLY_MEMBERSHIPS_CREATE=${prepBefore.actions.membershipsToCreate}`
  );

  // Leitura fresca imediatamente antes do commit.
  const fresh =
    await readSnapshot(
      db,
      auth
    );

  const freshPlan =
    buildMigrationPlan(
      fresh
    );

  const freshPrep =
    buildStagingPreparation({
      plan:
        freshPlan,
      projectId
    });

  if (
    freshPrep.planSha256 !==
    prepBefore.planSha256
  ) {
    throw new Error(
      "STAGING APPLY BLOCKED: plan changed between preflight reads."
    );
  }

  const rollbackRoot =
    path.join(
      process.env.LOCALAPPDATA ||
        os.tmpdir(),
      "BJJExamsMigration"
    );

  const timestamp =
    new Date()
      .toISOString()
      .replace(
        /[:.]/g,
        "-"
      );

  const rollbackPath =
    path.join(
      rollbackRoot,
      `legacy-v1_2-staging-${timestamp}-${freshPrep.planSha256.slice(0, 12)}.json`
    );

  const result =
    await applyPlanToStaging({
      db,
      plan:
        freshPlan,
      projectId,
      expectedPlanSha256,
      approvalToken,
      expectedCreateCount,
      rollbackReferencePath:
        rollbackPath
    });

  console.log(
    `FIRST_APPLY_CREATED=${result.createdCount}`
  );

  console.log(
    "ATOMIC_SINGLE_BATCH=True"
  );

  console.log(
    "ROLLBACK_REFERENCE_CREATED=True"
  );

  // ------------------------------------------------------------
  // VERIFICACAO POS-APPLY
  // ------------------------------------------------------------

  const after =
    await readSnapshot(
      db,
      auth
    );

  const legacyHashAfter =
    legacyFingerprint(
      after
    );

  if (
    legacyHashBefore !==
    legacyHashAfter
  ) {
    throw new Error(
      "POST_APPLY_VERIFICATION_FAILED: legacy sources changed."
    );
  }

  const planAfter =
    buildMigrationPlan(
      after
    );

  const prepAfter =
    buildStagingPreparation({
      plan:
        planAfter,
      projectId
    });

  const createsAfter =
    countActions(
      planAfter,
      "CREATE"
    );

  const noChangesAfter =
    countActions(
      planAfter,
      "NO_CHANGE"
    );

  if (createsAfter !== 0) {
    throw new Error(
      `POST_APPLY_VERIFICATION_FAILED: remaining creates=${createsAfter}`
    );
  }

  if (
    planAfter.inconsistencies.length !==
    0
  ) {
    throw new Error(
      "POST_APPLY_VERIFICATION_FAILED: inconsistencies detected."
    );
  }

  console.log(
    `POST_APPLY_CREATE=${createsAfter}`
  );

  console.log(
    `POST_APPLY_NO_CHANGE=${noChangesAfter}`
  );

  console.log(
    "LEGACY_SOURCE_MUTATIONS=0"
  );

  // ------------------------------------------------------------
  // SEGUNDA EXECUCAO: DEVE TER ZERO WRITES
  // ------------------------------------------------------------

  const rollbackSecond =
    path.join(
      rollbackRoot,
      `legacy-v1_2-staging-idempotency-${timestamp}-${prepAfter.planSha256.slice(0, 12)}.json`
    );

  const second =
    await applyPlanToStaging({
      db,
      plan:
        planAfter,
      projectId,
      expectedPlanSha256:
        prepAfter.planSha256,
      approvalToken:
        prepAfter.approvalToken,
      expectedCreateCount:
        0,
      rollbackReferencePath:
        rollbackSecond
    });

  if (
    second.createdCount !==
    0
  ) {
    throw new Error(
      "IDEMPOTENCY_VERIFICATION_FAILED."
    );
  }

  console.log(
    "SECOND_APPLY_CREATED=0"
  );

  console.log(
    "IDEMPOTENCY=APROVADA"
  );

  console.log(
    "PHYSICAL_DELETES=0"
  );

  console.log(
    "RAW_UIDS_PRINTED=False"
  );

  console.log(
    "RAW_EMAILS_PRINTED=False"
  );

  console.log(
    "STAGING_MIGRATION_APPLY=APROVADO"
  );
}

main().catch(error => {
  console.error(
    error.stack ||
    error.message ||
    error
  );

  process.exit(1);
});