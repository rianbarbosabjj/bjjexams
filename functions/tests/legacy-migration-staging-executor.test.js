"use strict";

const assert =
  require("node:assert/strict");

const {
  buildStagingPreparation
} =
  require("../src/migration/legacy-v1_2-staging-gate");

const {
  validateStagingApply,
  createRollbackReference
} =
  require("../src/migration/legacy-v1_2-staging-executor");

let passed =
  0;

function pass(name) {
  passed++;

  console.log(
    `PASS | ${name}`
  );
}

function plan(
  count = 1
) {
  return {
    actions: {
      users:
        Array.from(
          {
            length: count
          },
          (_, index) => ({
            kind:
              "user",
            id:
              `u${index}`,
            operation:
              "CREATE",
            desired: {
              displayName:
                `Teste ${index}`,
              status:
                "active",
              profileCompleted:
                true
            }
          })
        ),

      organizations:
        [],

      memberships:
        []
    },

    inconsistencies:
      []
  };
}

const clean =
  plan(1);

const preparation =
  buildStagingPreparation({
    plan:
      clean,
    projectId:
      "bjj-exams-staging"
  });

{
  const result =
    validateStagingApply({
      plan:
        clean,
      projectId:
        "bjj-exams-staging",
      expectedPlanSha256:
        preparation.planSha256,
      approvalToken:
        preparation.approvalToken,
      expectedCreateCount:
        1
    });

  assert.equal(
    result.actions.create,
    1
  );
}

pass(
  "Executor aceita plano autorizado de staging"
);

assert.throws(
  () =>
    validateStagingApply({
      plan:
        clean,
      projectId:
        "bjj-exams",
      expectedPlanSha256:
        preparation.planSha256,
      approvalToken:
        preparation.approvalToken,
      expectedCreateCount:
        1
    }),
  /STAGING_APPLY_BLOCKED/
);

pass(
  "Executor bloqueia producao"
);

assert.throws(
  () =>
    validateStagingApply({
      plan:
        clean,
      projectId:
        "bjj-exams-staging",
      expectedPlanSha256:
        "0".repeat(64),
      approvalToken:
        preparation.approvalToken,
      expectedCreateCount:
        1
    }),
  /plan hash changed/
);

pass(
  "Executor bloqueia hash divergente"
);

assert.throws(
  () =>
    validateStagingApply({
      plan:
        clean,
      projectId:
        "bjj-exams-staging",
      expectedPlanSha256:
        preparation.planSha256,
      approvalToken:
        "TOKEN_INVALIDO",
      expectedCreateCount:
        1
    }),
  /approval token invalid/
);

pass(
  "Executor bloqueia token divergente"
);

assert.throws(
  () =>
    validateStagingApply({
      plan:
        clean,
      projectId:
        "bjj-exams-staging",
      expectedPlanSha256:
        preparation.planSha256,
      approvalToken:
        preparation.approvalToken,
      expectedCreateCount:
        2
    }),
  /createCount=1/
);

pass(
  "Executor bloqueia contagem divergente"
);

{
  const conflict =
    plan(1);

  conflict.actions.users[0]
    .operation =
      "CONFLICT";

  assert.throws(
    () => {
      const prep =
        buildStagingPreparation({
          plan:
            conflict,
          projectId:
            "bjj-exams-staging"
        });

      validateStagingApply({
        plan:
          conflict,
        projectId:
          "bjj-exams-staging",
        expectedPlanSha256:
          prep.planSha256,
        approvalToken:
          prep.approvalToken,
        expectedCreateCount:
          0
      });
    },
    /STAGING_GATE_BLOCKED/
  );
}

pass(
  "Executor herda bloqueio de conflitos"
);

{
  const huge =
    plan(401);

  const prep =
    buildStagingPreparation({
      plan:
        huge,
      projectId:
        "bjj-exams-staging"
    });

  assert.throws(
    () =>
      validateStagingApply({
        plan:
          huge,
        projectId:
          "bjj-exams-staging",
        expectedPlanSha256:
          prep.planSha256,
        approvalToken:
          prep.approvalToken,
        expectedCreateCount:
          401
      }),
    /more than 400/
  );
}

pass(
  "Executor bloqueia migracao acima de um batch atomico"
);

{
  const reference =
    createRollbackReference({
      projectId:
        "bjj-exams-staging",
      planSha256:
        preparation.planSha256,
      actions:
        clean.actions.users
    });

  assert.equal(
    reference.automaticRollback,
    false
  );

  assert.equal(
    reference.physicalDeletesPerformed,
    false
  );

  assert.equal(
    reference.atomicSingleBatch,
    true
  );

  assert.equal(
    reference.entries.length,
    1
  );
}

pass(
  "Referencia de rollback nao executa delete automatico"
);

console.log("");
console.log(
  `RESULTADO_STAGING_EXECUTOR=${passed}/8`
);

if (passed !== 8) {
  process.exit(1);
}