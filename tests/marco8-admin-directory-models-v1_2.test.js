"use strict";

const assert =
  require("assert");

const {
  PERSON_VIEW_FIELDS,
  ORGANIZATION_VIEW_FIELDS,
  normalizeProfileType,
  normalizeOperationalStatus,
  toIsoTimestamp,
  buildOperationalMembershipView,
  buildMembershipCounts,
  sanitizeResponsibleSummary,
  buildOperationalPersonView,
  buildOperationalOrganizationView
} = require(
  "../functions/src/admin/admin-directory-models"
);

assert.deepStrictEqual(
  PERSON_VIEW_FIELDS,
  [
    "personId",
    "displayName",
    "email",
    "profileType",
    "operationalStatus",
    "memberships",
    "createdAt",
    "updatedAt"
  ]
);

assert.deepStrictEqual(
  ORGANIZATION_VIEW_FIELDS,
  [
    "organizationId",
    "name",
    "status",
    "membershipCounts",
    "responsibleSummary",
    "createdAt",
    "updatedAt"
  ]
);

assert.strictEqual(
  normalizeProfileType({
    tipo_usuario:
      "professor"
  }),
  "instructor"
);

assert.strictEqual(
  normalizeProfileType({
    papel_principal:
      "instrutor"
  }),
  "instructor"
);

assert.strictEqual(
  normalizeProfileType({
    tipoUsuario:
      "aluno"
  }),
  "student"
);

assert.strictEqual(
  normalizeProfileType({
    tipo_usuario:
      "unknown"
  }),
  null
);

assert.strictEqual(
  normalizeOperationalStatus(
    "ativo"
  ),
  "active"
);

assert.strictEqual(
  normalizeOperationalStatus(
    "pendente"
  ),
  "pending"
);

assert.strictEqual(
  normalizeOperationalStatus(
    "bloqueada"
  ),
  "suspended"
);

assert.strictEqual(
  normalizeOperationalStatus(
    "arquivada"
  ),
  "inactive"
);

assert.strictEqual(
  normalizeOperationalStatus(
    "unexpected"
  ),
  "unknown"
);

assert.strictEqual(
  toIsoTimestamp(
    new Date(
      "2026-09-25T12:00:00.000Z"
    )
  ),
  "2026-09-25T12:00:00.000Z"
);

assert.strictEqual(
  toIsoTimestamp({
    seconds: 0
  }),
  "1970-01-01T00:00:00.000Z"
);

assert.strictEqual(
  toIsoTimestamp({
    toDate() {
      return new Date(
        "2026-09-24T10:00:00.000Z"
      );
    }
  }),
  "2026-09-24T10:00:00.000Z"
);

const managerMembership =
  buildOperationalMembershipView({
    organizacao_id:
      "org-b",

    usuario_id:
      "person-1",

    papel:
      "gestor",

    status:
      "ativo",

    principal:
      true,

    secret:
      "must-not-pass"
  });

assert.deepStrictEqual(
  managerMembership,
  {
    organizationId:
      "org-b",

    role:
      "manager",

    status:
      "active",

    isPrimary:
      true,

    canApplyOfficialExam:
      true
  }
);

const personView =
  buildOperationalPersonView({
    personId:
      "person-1",

    profile: {
      nome:
        "  Maria Silva  ",

      email:
        "MARIA@EXAMPLE.COM",

      tipo_usuario:
        "aluno",

      status_conta:
        "ativo",

      data_cadastro: {
        seconds:
          100
      },

      atualizado_em: {
        seconds:
          200
      },

      cpf:
        "12345678901",

      telefone:
        "21999999999",

      logradouro:
        "Rua Privada",

      asaas_wallet_id:
        "wallet-secret",

      customClaims: {
        super_admin:
          true
      }
    },

    memberships: [
      {
        organizacao_id:
          "org-b",

        papel:
          "aluno",

        status:
          "ativo",

        principal:
          true
      },

      {
        organizacao_id:
          "org-a",

        papel:
          "aluno",

        status:
          "pendente"
      },

      {
        papel:
          "aluno",

        status:
          "ativo"
      }
    ]
  });

assert.deepStrictEqual(
  Object.keys(
    personView
  ),
  PERSON_VIEW_FIELDS
);

assert.strictEqual(
  personView.personId,
  "person-1"
);

assert.strictEqual(
  personView.displayName,
  "Maria Silva"
);

assert.strictEqual(
  personView.email,
  "maria@example.com"
);

assert.strictEqual(
  personView.profileType,
  "student"
);

assert.strictEqual(
  personView.operationalStatus,
  "active"
);

assert.strictEqual(
  personView.memberships.length,
  2
);

assert.strictEqual(
  personView
    .memberships[0]
    .organizationId,
  "org-a"
);

assert.strictEqual(
  personView
    .memberships[1]
    .organizationId,
  "org-b"
);

for (
  const forbidden of [
    "cpf",
    "telefone",
    "logradouro",
    "asaas_wallet_id",
    "customClaims",
    "secret",
    "password",
    "senha"
  ]
) {
  assert.strictEqual(
    JSON.stringify(
      personView
    ).includes(
      forbidden
    ),
    false,
    `Person view leaked ${forbidden}`
  );
}

const counts =
  buildMembershipCounts([
    {
      organizationId:
        "org-a",

      role:
        "owner",

      status:
        "active"
    },

    {
      organizationId:
        "org-a",

      role:
        "manager",

      status:
        "active"
    },

    {
      organizationId:
        "org-a",

      role:
        "instructor",

      status:
        "suspended"
    },

    {
      organizationId:
        "org-a",

      role:
        "student",

      status:
        "pending"
    },

    {
      organizationId:
        "org-a",

      role:
        "student",

      status:
        "ended"
    },

    {
      organizationId:
        "org-a",

      role:
        "student",

      status:
        "rejected"
    }
  ]);

assert.deepStrictEqual(
  counts,
  {
    total: 6,

    active: 2,
    pending: 1,
    rejected: 1,
    suspended: 1,
    ended: 1,

    owners: 1,
    managers: 1,
    instructors: 1,
    students: 3
  }
);

const responsible =
  sanitizeResponsibleSummary({
    uid:
      "owner-1",

    nome:
      "Responsavel",

    email:
      "OWNER@EXAMPLE.COM",

    papel:
      "proprietario",

    cpf:
      "must-not-pass"
  });

assert.deepStrictEqual(
  responsible,
  {
    personId:
      "owner-1",

    displayName:
      "Responsavel",

    email:
      "owner@example.com",

    role:
      "owner"
  }
);

const organizationView =
  buildOperationalOrganizationView({
    organizationId:
      "org-a",

    organization: {
      nome_equipe:
        "Academia Alfa",

      status:
        "ativa",

      criado_em: {
        seconds:
          300
      },

      atualizado_em: {
        seconds:
          400
      },

      asaas_wallet_id:
        "wallet-private",

      webhook_token:
        "secret"
    },

    memberships: [
      {
        organizacao_id:
          "org-a",

        papel:
          "gestor",

        status:
          "ativo"
      },

      {
        organizacao_id:
          "org-a",

        papel:
          "professor",

        status:
          "ativo"
      },

      {
        organizacao_id:
          "org-a",

        papel:
          "aluno",

        status:
          "pendente"
      }
    ],

    responsibleSummary:
      responsible
  });

assert.deepStrictEqual(
  Object.keys(
    organizationView
  ),
  ORGANIZATION_VIEW_FIELDS
);

assert.strictEqual(
  organizationView
    .organizationId,
  "org-a"
);

assert.strictEqual(
  organizationView.name,
  "Academia Alfa"
);

assert.strictEqual(
  organizationView.status,
  "active"
);

assert.strictEqual(
  organizationView
    .membershipCounts
    .total,
  3
);

assert.strictEqual(
  organizationView
    .membershipCounts
    .managers,
  1
);

assert.strictEqual(
  organizationView
    .membershipCounts
    .instructors,
  1
);

assert.strictEqual(
  organizationView
    .membershipCounts
    .students,
  1
);

assert.strictEqual(
  organizationView
    .responsibleSummary
    .personId,
  "owner-1"
);

for (
  const forbidden of [
    "asaas_wallet_id",
    "webhook_token",
    "cpf",
    "password",
    "senha"
  ]
) {
  assert.strictEqual(
    JSON.stringify(
      organizationView
    ).includes(
      forbidden
    ),
    false,
    `Organization view leaked ${forbidden}`
  );
}

assert.throws(
  () =>
    buildOperationalPersonView({
      profile: {}
    }),
  error =>
    error.message ===
      "ADMIN_DIRECTORY_PERSON_ID_REQUIRED"
);

assert.throws(
  () =>
    buildOperationalOrganizationView({
      organization: {}
    }),
  error =>
    error.message ===
      "ADMIN_DIRECTORY_ORGANIZATION_ID_REQUIRED"
);

console.log(
  "MARCO8_DIRECTORY_PERSON_FIELDS=8/8"
);

console.log(
  "MARCO8_DIRECTORY_ORGANIZATION_FIELDS=7/7"
);

console.log(
  "MARCO8_DIRECTORY_PROFILE_ALIASES=PASSED"
);

console.log(
  "MARCO8_DIRECTORY_STATUS_NORMALIZATION=PASSED"
);

console.log(
  "MARCO8_DIRECTORY_MEMBERSHIP_CANONICALIZATION=PASSED"
);

console.log(
  "MARCO8_DIRECTORY_MEMBERSHIP_COUNTS=PASSED"
);

console.log(
  "MARCO8_DIRECTORY_RESPONSIBLE_SANITIZATION=PASSED"
);

console.log(
  "MARCO8_DIRECTORY_PERSON_SANITIZATION=PASSED"
);

console.log(
  "MARCO8_DIRECTORY_ORGANIZATION_SANITIZATION=PASSED"
);

console.log(
  "MARCO8_ADMIN_DIRECTORY_MODELS=PASSED"
);
