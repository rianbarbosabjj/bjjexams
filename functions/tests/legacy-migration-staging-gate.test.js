"use strict";

const assert =
  require("node:assert/strict");

const {
  assertStagingEnvironment,
  planSha256,
  buildStagingPreparation
} =
  require("../src/migration/legacy-v1_2-staging-gate");

let passed =
  0;

function pass(name) {
  passed++;

  console.log(
    `PASS | ${name}`
  );
}

function cleanPlan() {
  return {
    actions: {
      users: [
        {
          kind:
            "user",
          id:
            "u1",
          operation:
            "CREATE",
          desired: {
            status:
              "active",
            displayName:
              "Teste"
          }
        }
      ],

      organizations:
        [],

      memberships:
        []
    },

    inconsistencies:
      []
  };
}

assert.equal(
  assertStagingEnvironment({
    projectId:
      "bjj-exams-staging",
    firestoreHost:
      null,
    authHost:
      null
  }),
  true
);

pass(
  "Gate aceita somente staging sem emulator"
);

assert.throws(
  () =>
    assertStagingEnvironment({
      projectId:
        "bjj-exams",
      firestoreHost:
        null,
      authHost:
        null
    }),
  /STAGING_GATE_BLOCKED/
);

pass(
  "Gate bloqueia producao"
);

assert.throws(
  () =>
    assertStagingEnvironment({
      projectId:
        "bjj-exams-staging",
      firestoreHost:
        "127.0.0.1:8080",
      authHost:
        null
    }),
  /STAGING_GATE_BLOCKED/
);

pass(
  "Gate bloqueia variaveis de emulator"
);

{
  const plan =
    cleanPlan();

  plan.actions.users[0]
    .operation =
      "CONFLICT";

  assert.throws(
    () =>
      buildStagingPreparation({
        plan,
        projectId:
          "bjj-exams-staging"
      }),
    /conflicts=1/
  );
}

pass(
  "Gate bloqueia conflito canonico"
);

{
  const plan =
    cleanPlan();

  plan.inconsistencies.push({
    type:
      "TEST"
  });

  assert.throws(
    () =>
      buildStagingPreparation({
        plan,
        projectId:
          "bjj-exams-staging"
      }),
    /inconsistencies=1/
  );
}

pass(
  "Gate bloqueia inconsistencias"
);

{
  const one = {
    actions: {
      users: [
        {
          kind:
            "user",
          id:
            "u1",
          operation:
            "CREATE",
          desired: {
            displayName:
              "Teste",
            status:
              "active"
          }
        }
      ],

      organizations:
        [
          {
            kind:
              "organization",
            id:
              "o1",
            operation:
              "CREATE",
            desired: {
              name:
                "Academia",
              type:
                "academy"
            }
          }
        ],

      memberships:
        []
    },

    inconsistencies:
      []
  };

  const two = {
    actions: {
      users: [
        {
          kind:
            "user",
          id:
            "u1",
          operation:
            "CREATE",
          desired: {
            status:
              "active",
            displayName:
              "Teste"
          }
        }
      ],

      organizations:
        [
          {
            kind:
              "organization",
            id:
              "o1",
            operation:
              "CREATE",
            desired: {
              type:
                "academy",
              name:
                "Academia"
            }
          }
        ],

      memberships:
        []
    },

    inconsistencies:
      []
  };

  assert.equal(
    planSha256(one),
    planSha256(two)
  );
}

pass(
  "Hash e deterministico apesar da ordem das propriedades"
);

{
  const preparation =
    buildStagingPreparation({
      plan:
        cleanPlan(),
      projectId:
        "bjj-exams-staging"
    });

  assert.equal(
    preparation.actions.create,
    1
  );

  assert.equal(
    preparation.actions.usersToCreate,
    1
  );

  assert.equal(
    preparation.physicalDeletesPlanned,
    0
  );

  assert.equal(
    preparation.stagingWritesAttempted,
    false
  );

  assert.equal(
    preparation.applyCapability,
    false
  );
}

pass(
  "Preparacao registra contagens e zero capacidade de escrita"
);

{
  const preparation =
    buildStagingPreparation({
      plan:
        cleanPlan(),
      projectId:
        "bjj-exams-staging"
    });

  const serialized =
    JSON.stringify(
      preparation
    );

  assert.equal(
    serialized.includes(
      '"u1"'
    ),
    false
  );

  assert.match(
    preparation.planSha256,
    /^[a-f0-9]{64}$/
  );

  assert.match(
    preparation.approvalToken,
    /^APPLY_STAGING_LEGACY_V1_2_[A-F0-9]{16}$/
  );
}

pass(
  "Manifesto nao expoe IDs e gera token vinculado ao plano"
);

console.log("");
console.log(
  `RESULTADO_STAGING_MIGRATION_GATE=${passed}/8`
);

if (passed !== 8) {
  process.exit(1);
}