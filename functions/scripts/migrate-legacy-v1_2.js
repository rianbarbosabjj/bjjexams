"use strict";

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

    if (value.startsWith(prefix)) {
      return value.slice(
        prefix.length
      );
    }
  }

  return null;
}

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex")
    .slice(0, 12);
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

async function listAllAuthUsers(auth) {
  const users =
    new Map();

  let pageToken;

  do {
    const page =
      await auth.listUsers(
        1000,
        pageToken
      );

    for (const user of page.users) {
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

function operationCounts(actions) {
  return actions.reduce(
    (result, action) => {
      result[
        action.operation
      ] =
        (
          result[
            action.operation
          ] ||
          0
        ) + 1;

      return result;
    },
    {
      CREATE: 0,
      NO_CHANGE: 0,
      CONFLICT: 0
    }
  );
}

async function main() {
  const dryRun =
    argument("dry-run") ===
    true;

  const apply =
    argument("apply") ===
    true;

  const projectId =
    argument("project");

  if (apply) {
    throw new Error(
      "APPLY is intentionally disabled in this version."
    );
  }

  if (!dryRun) {
    throw new Error(
      "--dry-run is mandatory."
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
      "Emulator variables are not allowed in staging dry-run."
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
    "MIGRATION_MODE=DRY_RUN"
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

  console.log(
    "PHYSICAL_DELETE_CAPABILITY=False"
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

  const sourceSummary = {
    usuarios:
      usuarios.size,
    alunos:
      alunos.size,
    professores:
      professores.size,
    admins:
      admins.size,
    super_admins:
      superAdmins.size,
    equipes:
      equipes.size,
    organizacoes:
      organizacoes.size,
    vinculos_organizacao:
      vinculos.size,
    auth_users:
      authUsers.size
  };

  const report = {
    source:
      sourceSummary,

    canonicalBefore:
      plan.summary
        .canonicalBefore,

    operations: {
      users:
        operationCounts(
          plan.actions.users
        ),

      organizations:
        operationCounts(
          plan.actions.organizations
        ),

      organization_memberships:
        operationCounts(
          plan.actions.memberships
        )
    },

    predictedAfter:
      plan.summary
        .predictedAfter,

    inconsistencies:
      plan.inconsistencies
        .length,

    physicalDeletes:
      0
  };

  console.log(
    `DRY_RUN_SUMMARY=${JSON.stringify(report)}`
  );

  for (
    const action
    of [
      ...plan.actions.users,
      ...plan.actions.organizations,
      ...plan.actions.memberships
    ]
  ) {
    console.log(
      "ACTION=" +
      JSON.stringify({
        kind:
          action.kind,

        operation:
          action.operation,

        targetFingerprint:
          fingerprint(
            `${action.kind}:${action.id}`
          )
      })
    );
  }

  for (
    const issue
    of plan.inconsistencies
  ) {
    console.log(
      "INCONSISTENCY=" +
      JSON.stringify({
        type:
          issue.type,

        fingerprint:
          fingerprint(
            JSON.stringify(issue)
          )
      })
    );
  }

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
    "MIGRATION_DRY_RUN_V1_2=APROVADO"
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