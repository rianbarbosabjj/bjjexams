"use strict";

const assert =
  require("node:assert/strict");

const {
  buildMigrationPlan
} =
  require("../src/migration/legacy-v1_2");

let passed = 0;

function map(entries = []) {
  return new Map(entries);
}

function snapshot(overrides = {}) {
  return {
    usuarios: map(),
    alunos: map(),
    professores: map(),
    admins: map(),
    superAdmins: map(),
    equipes: map(),
    organizacoes: map(),
    vinculos: map(),
    users: map(),
    organizations: map(),
    organizationMemberships: map(),
    authUsers: map(),
    ...overrides
  };
}

function test(name, fn) {
  try {
    fn();

    passed++;

    console.log(
      `PASS | ${name}`
    );
  } catch (error) {
    console.error(
      `FAIL | ${name}`
    );

    throw error;
  }
}

test(
  "Usuario legado gera users canonico",
  () => {
    const plan =
      buildMigrationPlan(
        snapshot({
          usuarios:
            map([
              [
                "u1",
                {
                  nome:
                    "Aluno Teste",
                  email:
                    "Aluno@Example.com"
                }
              ]
            ]),

          authUsers:
            map([
              [
                "u1",
                {
                  uid:
                    "u1",
                  email:
                    "aluno@example.com",
                  disabled:
                    false
                }
              ]
            ])
        })
      );

    assert.equal(
      plan.actions.users.length,
      1
    );

    assert.equal(
      plan.actions.users[0]
        .operation,
      "CREATE"
    );

    assert.equal(
      plan.actions.users[0]
        .desired.email,
      "aluno@example.com"
    );

    assert.equal(
      plan.actions.users[0]
        .desired.status,
      "active"
    );
  }
);

test(
  "Auth desabilitado gera usuario suspended",
  () => {
    const plan =
      buildMigrationPlan(
        snapshot({
          usuarios:
            map([
              [
                "u1",
                {
                  nome:
                    "Teste"
                }
              ]
            ]),

          authUsers:
            map([
              [
                "u1",
                {
                  disabled:
                    true
                }
              ]
            ])
        })
      );

    assert.equal(
      plan.actions.users[0]
        .desired.status,
      "suspended"
    );
  }
);

test(
  "Canonical identico resulta NO_CHANGE",
  () => {
    const legacy = {
      nome:
        "Aluno Teste",
      email:
        "aluno@example.com"
    };

    const first =
      buildMigrationPlan(
        snapshot({
          usuarios:
            map([
              ["u1", legacy]
            ])
        })
      );

    const desired =
      first.actions.users[0]
        .desired;

    const second =
      buildMigrationPlan(
        snapshot({
          usuarios:
            map([
              ["u1", legacy]
            ]),

          users:
            map([
              ["u1", desired]
            ])
        })
      );

    assert.equal(
      second.actions.users[0]
        .operation,
      "NO_CHANGE"
    );
  }
);

test(
  "Canonical divergente resulta CONFLICT",
  () => {
    const plan =
      buildMigrationPlan(
        snapshot({
          usuarios:
            map([
              [
                "u1",
                {
                  nome:
                    "Aluno"
                }
              ]
            ]),

          users:
            map([
              [
                "u1",
                {
                  displayName:
                    "Outro Nome",
                  status:
                    "active",
                  profileCompleted:
                    true
                }
              ]
            ])
        })
      );

    assert.equal(
      plan.actions.users[0]
        .operation,
      "CONFLICT"
    );
  }
);

test(
  "Equipe legada gera organizations canonico",
  () => {
    const plan =
      buildMigrationPlan(
        snapshot({
          equipes:
            map([
              [
                "org1",
                {
                  nome_equipe:
                    "Academia Teste",
                  status:
                    "ativa"
                }
              ]
            ])
        })
      );

    const action =
      plan.actions
        .organizations[0];

    assert.equal(
      action.operation,
      "CREATE"
    );

    assert.equal(
      action.desired.type,
      "academy"
    );

    assert.equal(
      action.desired.status,
      "active"
    );

    assert.equal(
      action.desired.legacySourceId,
      "org1"
    );
  }
);

test(
  "Vinculo transitional normaliza aluno ativo",
  () => {
    const plan =
      buildMigrationPlan(
        snapshot({
          usuarios:
            map([
              ["u1", { nome: "Aluno" }]
            ]),

          equipes:
            map([
              [
                "org1",
                {
                  nome:
                    "Academia"
                }
              ]
            ]),

          vinculos:
            map([
              [
                "legacy-id",
                {
                  usuario_id:
                    "u1",
                  organizacao_id:
                    "org1",
                  papel:
                    "aluno",
                  status:
                    "ativo",
                  principal:
                    true
                }
              ]
            ])
        })
      );

    const action =
      plan.actions
        .memberships[0];

    assert.equal(
      action.id,
      "org1__u1"
    );

    assert.equal(
      action.desired.role,
      "student"
    );

    assert.equal(
      action.desired.status,
      "active"
    );
  }
);

test(
  "Aluno legado gera fallback membership",
  () => {
    const plan =
      buildMigrationPlan(
        snapshot({
          alunos:
            map([
              [
                "u1",
                {
                  nome:
                    "Aluno",
                  equipe_id:
                    "org1",
                  status_vinculo:
                    "ativo"
                }
              ]
            ]),

          equipes:
            map([
              [
                "org1",
                {
                  nome:
                    "Academia"
                }
              ]
            ])
        })
      );

    assert.equal(
      plan.actions
        .memberships.length,
      1
    );

    assert.equal(
      plan.actions
        .memberships[0]
        .source,
      "alunos"
    );
  }
);

test(
  "Vinculo transitional prevalece sobre fallback legado",
  () => {
    const plan =
      buildMigrationPlan(
        snapshot({
          alunos:
            map([
              [
                "u1",
                {
                  nome:
                    "Aluno",
                  equipe_id:
                    "org1",
                  status_vinculo:
                    "ativo"
                }
              ]
            ]),

          equipes:
            map([
              [
                "org1",
                {
                  nome:
                    "Academia"
                }
              ]
            ]),

          vinculos:
            map([
              [
                "org1__u1",
                {
                  usuario_id:
                    "u1",
                  organizacao_id:
                    "org1",
                  papel:
                    "aluno",
                  status:
                    "pendente"
                }
              ]
            ])
        })
      );

    assert.equal(
      plan.actions
        .memberships.length,
      1
    );

    assert.equal(
      plan.actions
        .memberships[0]
        .source,
      "vinculos_organizacao"
    );

    assert.equal(
      plan.actions
        .memberships[0]
        .desired.status,
      "pending"
    );
  }
);

test(
  "Professor responsavel vira manager",
  () => {
    const plan =
      buildMigrationPlan(
        snapshot({
          professores:
            map([
              [
                "p1",
                {
                  equipe_id:
                    "org1",
                  status_vinculo:
                    "ativo",
                  eh_responsavel:
                    true,
                  pode_aprovar:
                    true
                }
              ]
            ]),

          equipes:
            map([
              [
                "org1",
                {
                  nome:
                    "Academia"
                }
              ]
            ])
        })
      );

    const membership =
      plan.actions
        .memberships[0]
        .desired;

    assert.equal(
      membership.role,
      "manager"
    );

    assert.equal(
      membership.canApplyOfficialExam,
      true
    );
  }
);

test(
  "Membership invalido vira inconsistencia e nao write plan",
  () => {
    const plan =
      buildMigrationPlan(
        snapshot({
          usuarios:
            map([
              ["u1", { nome: "Aluno" }]
            ]),

          equipes:
            map([
              [
                "org1",
                {
                  nome:
                    "Academia"
                }
              ]
            ]),

          vinculos:
            map([
              [
                "x",
                {
                  usuario_id:
                    "u1",
                  organizacao_id:
                    "org1",
                  papel:
                    "papel-invalido",
                  status:
                    "ativo"
                }
              ]
            ])
        })
      );

    assert.equal(
      plan.actions
        .memberships.length,
      0
    );

    assert.equal(
      plan.inconsistencies.length,
      1
    );
  }
);

test(
  "Planejamento nunca inclui delete fisico",
  () => {
    const plan =
      buildMigrationPlan(
        snapshot({
          usuarios:
            map([
              ["u1", { nome: "Teste" }]
            ])
        })
      );

    assert.equal(
      plan.summary.physicalDeletes,
      0
    );

    assert.equal(
      plan.summary
        .predictedAfter
        .users,
      1
    );
  }
);

console.log("");
console.log(
  `RESULTADO_LEGACY_MIGRATION_PLAN=${passed}/11`
);

if (passed !== 11) {
  process.exit(1);
}