"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const {
  initializeApp,
  deleteApp
} =
  require("firebase-admin/app");

const {
  getFirestore
} =
  require("firebase-admin/firestore");

const {
  buildMigrationPlan
} =
  require("../src/migration/legacy-v1_2");

const {
  assertEmulatorWriteSafety,
  applyMigrationPlanToEmulator
} =
  require("../src/migration/legacy-v1_2-executor");

const projectId =
  "demo-bjj-exams";

function assertLocal(
  name,
  value
) {
  if (
    !value ||
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/
      .test(value)
  ) {
    throw new Error(
      `${name} nao e local: ${value || "<EMPTY>"}`
    );
  }
}

assertLocal(
  "FIRESTORE_EMULATOR_HOST",
  process.env.FIRESTORE_EMULATOR_HOST
);

const app =
  initializeApp(
    {
      projectId
    },
    `legacy-migration-${process.pid}-${Date.now()}`
  );

const db =
  getFirestore(app);

const runId =
  `${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;

const uid =
  `migration_user_${runId}`;

const orgId =
  `migration_org_${runId}`;

const conflictUid =
  `migration_conflict_${runId}`;

const pathsToDelete =
  new Set();

let passed =
  0;

function testPass(name) {
  passed++;

  console.log(
    `PASS | ${name}`
  );
}

async function setDoc(
  documentPath,
  data
) {
  await db.doc(
    documentPath
  ).set(data);

  pathsToDelete.add(
    documentPath
  );
}

async function readMap(
  collectionName
) {
  const snap =
    await db
      .collection(
        collectionName
      )
      .get();

  return new Map(
    snap.docs.map(
      doc => [
        doc.id,
        doc.data() || {}
      ]
    )
  );
}

async function snapshot() {
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
    organizationMemberships
  ] =
    await Promise.all([
      readMap("usuarios"),
      readMap("alunos"),
      readMap("professores"),
      readMap("admins"),
      readMap("super_admins"),
      readMap("equipes"),
      readMap("organizacoes"),
      readMap("vinculos_organizacao"),
      readMap("users"),
      readMap("organizations"),
      readMap("organization_memberships")
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
    authUsers:
      new Map()
  };
}

async function cleanup() {
  const paths =
    [...pathsToDelete];

  for (
    let offset = 0;
    offset < paths.length;
    offset += 400
  ) {
    const batch =
      db.batch();

    for (
      const documentPath
      of paths.slice(
        offset,
        offset + 400
      )
    ) {
      batch.delete(
        db.doc(
          documentPath
        )
      );
    }

    await batch.commit();
  }

  await deleteApp(app);
}

async function main() {
  const rollbackOne =
    path.join(
      os.tmpdir(),
      `bjjexams-rollback-${runId}-1.json`
    );

  const rollbackTwo =
    path.join(
      os.tmpdir(),
      `bjjexams-rollback-${runId}-2.json`
    );

  const rollbackConflict =
    path.join(
      os.tmpdir(),
      `bjjexams-rollback-${runId}-conflict.json`
    );

  try {
    // ----------------------------------------------------------
    // 1. SAFETY GATE
    // ----------------------------------------------------------

    assert.throws(
      () =>
        assertEmulatorWriteSafety({
          projectId:
            "bjj-exams-staging",
          firestoreHost:
            "127.0.0.1:8080"
        }),
      /EMULATOR_WRITE_BLOCKED/
    );

    testPass(
      "Executor bloqueia projeto real mesmo com host local"
    );

    // ----------------------------------------------------------
    // 2. LEGADO SINTETICO
    // ----------------------------------------------------------

    const legacyUser = {
      nome:
        "MIGRATION TEST USER",
      email:
        `${uid}@example.test`,
      tipo_usuario:
        "aluno",
      status_conta:
        "ativo"
    };

    const legacyOrg = {
      nome_equipe:
        "ACADEMIA MIGRATION TEST",
      status:
        "ativa"
    };

    const legacyMembership = {
      usuario_id:
        uid,
      organizacao_id:
        orgId,
      papel:
        "aluno",
      status:
        "ativo",
      principal:
        true
    };

    await setDoc(
      `usuarios/${uid}`,
      legacyUser
    );

    await setDoc(
      `equipes/${orgId}`,
      legacyOrg
    );

    await setDoc(
      `vinculos_organizacao/${orgId}__${uid}`,
      legacyMembership
    );

    const before =
      await snapshot();

    const planOne =
      buildMigrationPlan(
        before
      );

    assert.equal(
      planOne.summary
        .operations
        .users
        .CREATE,
      1
    );

    assert.equal(
      planOne.summary
        .operations
        .organizations
        .CREATE,
      1
    );

    assert.equal(
      planOne.summary
        .operations
        .organization_memberships
        .CREATE,
      1
    );

    assert.equal(
      planOne.inconsistencies.length,
      0
    );

    // ----------------------------------------------------------
    // 3. PRIMEIRO APPLY EMULATOR
    // ----------------------------------------------------------

    const first =
      await applyMigrationPlanToEmulator({
        db,
        plan:
          planOne,
        projectId,
        rollbackReferencePath:
          rollbackOne
      });

    assert.equal(
      first.createdCount,
      3
    );

    assert.equal(
      first.rollbackReference
        .physicalDeletesPerformed,
      false
    );

    assert.equal(
      first.rollbackReference
        .entries.length,
      3
    );

    assert.equal(
      first.rollbackReference
        .status,
      "completed"
    );

    assert.equal(
      fs.existsSync(
        rollbackOne
      ),
      true
    );

    pathsToDelete.add(
      `users/${uid}`
    );

    pathsToDelete.add(
      `organizations/${orgId}`
    );

    pathsToDelete.add(
      `organization_memberships/${orgId}__${uid}`
    );

    const canonicalUser =
      await db.doc(
        `users/${uid}`
      ).get();

    const canonicalOrg =
      await db.doc(
        `organizations/${orgId}`
      ).get();

    const canonicalMembership =
      await db.doc(
        `organization_memberships/${orgId}__${uid}`
      ).get();

    assert.equal(
      canonicalUser.exists,
      true
    );

    assert.equal(
      canonicalOrg.exists,
      true
    );

    assert.equal(
      canonicalOrg.data().type,
      "academy"
    );

    assert.equal(
      canonicalMembership.exists,
      true
    );

    assert.equal(
      canonicalMembership.data().role,
      "student"
    );

    assert.equal(
      canonicalMembership.data().status,
      "active"
    );

    testPass(
      "Primeiro apply cria user organization e membership canonicos"
    );

    // ----------------------------------------------------------
    // 4. FONTES LEGADAS NAO SAO ALTERADAS
    // ----------------------------------------------------------

    const legacyUserAfter =
      await db.doc(
        `usuarios/${uid}`
      ).get();

    const legacyOrgAfter =
      await db.doc(
        `equipes/${orgId}`
      ).get();

    const legacyMembershipAfter =
      await db.doc(
        `vinculos_organizacao/${orgId}__${uid}`
      ).get();

    assert.deepEqual(
      legacyUserAfter.data(),
      legacyUser
    );

    assert.deepEqual(
      legacyOrgAfter.data(),
      legacyOrg
    );

    assert.deepEqual(
      legacyMembershipAfter.data(),
      legacyMembership
    );

    testPass(
      "Apply preserva integralmente as fontes legadas"
    );

    // ----------------------------------------------------------
    // 5. SEGUNDA EXECUCAO = IDEMPOTENTE
    // ----------------------------------------------------------

    const afterFirst =
      await snapshot();

    const planTwo =
      buildMigrationPlan(
        afterFirst
      );

    assert.equal(
      planTwo.summary
        .operations
        .users
        .CREATE,
      0
    );

    assert.equal(
      planTwo.summary
        .operations
        .users
        .NO_CHANGE,
      1
    );

    assert.equal(
      planTwo.summary
        .operations
        .organizations
        .CREATE,
      0
    );

    assert.equal(
      planTwo.summary
        .operations
        .organizations
        .NO_CHANGE,
      1
    );

    assert.equal(
      planTwo.summary
        .operations
        .organization_memberships
        .CREATE,
      0
    );

    assert.equal(
      planTwo.summary
        .operations
        .organization_memberships
        .NO_CHANGE,
      1
    );

    const second =
      await applyMigrationPlanToEmulator({
        db,
        plan:
          planTwo,
        projectId,
        rollbackReferencePath:
          rollbackTwo
      });

    assert.equal(
      second.createdCount,
      0
    );

    assert.equal(
      second.noChangeCount,
      3
    );

    assert.equal(
      second.rollbackReference
        .entries.length,
      0
    );

    testPass(
      "Segunda execucao e idempotente e realiza zero writes"
    );

    // ----------------------------------------------------------
    // 6. CONFLITOS BLOQUEIAM APPLY
    // ----------------------------------------------------------

    await setDoc(
      `usuarios/${conflictUid}`,
      {
        nome:
          "LEGACY CONFLICT",
        email:
          `${conflictUid}@example.test`
      }
    );

    await setDoc(
      `users/${conflictUid}`,
      {
        displayName:
          "CANONICAL DIFFERENT",
        status:
          "active",
        profileCompleted:
          true
      }
    );

    const conflictSnapshot =
      await snapshot();

    const conflictPlan =
      buildMigrationPlan(
        conflictSnapshot
      );

    assert.ok(
      conflictPlan.summary
        .operations
        .users
        .CONFLICT >= 1
    );

    await assert.rejects(
      () =>
        applyMigrationPlanToEmulator({
          db,
          plan:
            conflictPlan,
          projectId,
          rollbackReferencePath:
            rollbackConflict
        }),
      /MIGRATION_PLAN_BLOCKED/
    );

    testPass(
      "Conflito canonico bloqueia toda a execucao"
    );

    // ----------------------------------------------------------
    // 7. REFERENCIA DE ROLLBACK E SOMENTE REFERENCIA
    // ----------------------------------------------------------

    const reference =
      JSON.parse(
        fs.readFileSync(
          rollbackOne,
          "utf8"
        )
      );

    assert.equal(
      reference.automaticRollback,
      false
    );

    assert.equal(
      reference.physicalDeletesPerformed,
      false
    );

    assert.equal(
      reference.entries.every(
        item =>
          item.previousExists ===
          false
      ),
      true
    );

    testPass(
      "Referencia de rollback nao executa deletes automaticamente"
    );

    console.log("");
    console.log(
      `RESULTADO_LEGACY_MIGRATION_APPLY_EMULATOR=${passed}/6`
    );

    console.log(
      "FIRST_APPLY_CREATED=3"
    );

    console.log(
      "SECOND_APPLY_CREATED=0"
    );

    console.log(
      "IDEMPOTENCY=APROVADA"
    );

    console.log(
      "LEGACY_SOURCE_MUTATIONS=0"
    );

    console.log(
      "PHYSICAL_DELETES_BY_MIGRATION=0"
    );

    console.log(
      "ROLLBACK_REFERENCE=APROVADA"
    );

    console.log(
      "REMOTE_STAGING_WRITES=0"
    );

    console.log(
      "PRODUCTION_ACCESS=0"
    );
  }
  finally {
    for (
      const filePath
      of [
        rollbackOne,
        rollbackTwo,
        rollbackConflict
      ]
    ) {
      try {
        fs.rmSync(
          filePath,
          {
            force: true
          }
        );
      } catch (_) {}
    }

    await cleanup();
  }
}

main()
  .then(() => {
    if (passed !== 6) {
      process.exit(1);
    }
  })
  .catch(error => {
    console.error(
      error.stack ||
      error.message ||
      error
    );

    process.exit(1);
  });