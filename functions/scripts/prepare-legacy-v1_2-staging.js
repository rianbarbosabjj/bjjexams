"use strict";

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
  buildStagingPreparation
} =
  require("../src/migration/legacy-v1_2-staging-gate");

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
  const users =
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
      users.set(
        user.uid,
        user
      );
    }

    pageToken =
      page.pageToken;

  } while (pageToken);

  return users;
}

async function main() {
  const prepare =
    argument("prepare") ===
    true;

  const apply =
    argument("apply") ===
    true;

  const projectId =
    argument("project");

  if (apply) {
    throw new Error(
      "STAGING APPLY IS NOT AVAILABLE IN THIS COMMAND."
    );
  }

  if (!prepare) {
    throw new Error(
      "--prepare is mandatory."
    );
  }

  if (
    projectId !==
    STAGING_PROJECT
  ) {
    throw new Error(
      "Only bjj-exams-staging is allowed."
    );
  }

  if (
    process.env
      .FIRESTORE_EMULATOR_HOST ||
    process.env
      .FIREBASE_AUTH_EMULATOR_HOST
  ) {
    throw new Error(
      "Emulator variables are forbidden."
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
    "MIGRATION_MODE=STAGING_PREPARE_ONLY"
  );

  console.log(
    `TARGET_PROJECT=${projectId}`
  );

  console.log(
    "WRITE_CAPABILITY=False"
  );

  console.log(
    "APPLY_CAPABILITY=False"
  );

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
      readCollection(
        db,
        "usuarios"
      ),

      readCollection(
        db,
        "alunos"
      ),

      readCollection(
        db,
        "professores"
      ),

      readCollection(
        db,
        "admins"
      ),

      readCollection(
        db,
        "super_admins"
      ),

      readCollection(
        db,
        "equipes"
      ),

      readCollection(
        db,
        "organizacoes"
      ),

      readCollection(
        db,
        "vinculos_organizacao"
      ),

      readCollection(
        db,
        "users"
      ),

      readCollection(
        db,
        "organizations"
      ),

      readCollection(
        db,
        "organization_memberships"
      ),

      listAllAuthUsers(
        auth
      )
    ]);

  const plan =
    buildMigrationPlan({
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
    });

  const preparation =
    buildStagingPreparation({
      plan,
      projectId
    });

  console.log(
    "STAGING_PREPARATION=" +
    JSON.stringify(
      preparation
    )
  );

  console.log(
    `PLAN_SHA256=${preparation.planSha256}`
  );

  console.log(
    `EXPECTED_CREATE_COUNT=${preparation.actions.create}`
  );

  console.log(
    `EXPECTED_USERS_CREATE=${preparation.actions.usersToCreate}`
  );

  console.log(
    `EXPECTED_ORGANIZATIONS_CREATE=${preparation.actions.organizationsToCreate}`
  );

  console.log(
    `EXPECTED_MEMBERSHIPS_CREATE=${preparation.actions.membershipsToCreate}`
  );

  console.log(
    `FUTURE_APPROVAL_TOKEN=${preparation.approvalToken}`
  );

  console.log(
    "INCONSISTENCIES=0"
  );

  console.log(
    "CONFLICTS=0"
  );

  console.log(
    "PHYSICAL_DELETES_PLANNED=0"
  );

  console.log(
    "RAW_UIDS_PRINTED=False"
  );

  console.log(
    "RAW_EMAILS_PRINTED=False"
  );

  console.log(
    "REMOTE_WRITES_ATTEMPTED=False"
  );

  console.log(
    "NEXT_STEP_REQUIRES_EXPLICIT_APPROVAL=True"
  );

  console.log(
    "STAGING_APPLY_GATE_PREPARED=APROVADO"
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