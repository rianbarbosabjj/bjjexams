"use strict";

const assert = require("assert");

const {
  ORGANIZATION_ROLES,
  MEMBERSHIP_STATUSES,
  normalizeOrganizationRole,
  normalizeMembershipStatus,
  membershipRole,
  membershipStatus,
  isActiveMembership,
  canManageOrganization,
  canApplyOfficialExam,
  toCanonicalMembershipView
} = require("../src/auth/organization-membership");

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

/* ============================================================
 * Contrato canonico
 * ============================================================ */

test("Lista de papeis canonicos permanece explicita", () => {
  assert.deepStrictEqual(
    [...ORGANIZATION_ROLES],
    [
      "owner",
      "manager",
      "instructor",
      "student"
    ]
  );
});

test("Lista de status canonicos permanece explicita", () => {
  assert.deepStrictEqual(
    [...MEMBERSHIP_STATUSES],
    [
      "pending",
      "active",
      "rejected",
      "suspended",
      "ended"
    ]
  );
});

/* ============================================================
 * Normalizacao de papeis
 * ============================================================ */

test("owner permanece owner", () => {
  assert.strictEqual(
    normalizeOrganizationRole("owner"),
    "owner"
  );
});

test("gestor legado normaliza para manager", () => {
  assert.strictEqual(
    normalizeOrganizationRole("gestor"),
    "manager"
  );
});

test("manager permanece manager", () => {
  assert.strictEqual(
    normalizeOrganizationRole("manager"),
    "manager"
  );
});

test("professor legado normaliza para instructor", () => {
  assert.strictEqual(
    normalizeOrganizationRole("professor"),
    "instructor"
  );
});

test("instrutor legado normaliza para instructor", () => {
  assert.strictEqual(
    normalizeOrganizationRole("instrutor"),
    "instructor"
  );
});

test("aluno legado normaliza para student", () => {
  assert.strictEqual(
    normalizeOrganizationRole("aluno"),
    "student"
  );
});

test("papel desconhecido retorna null", () => {
  assert.strictEqual(
    normalizeOrganizationRole("qualquer"),
    null
  );
});

test("papel vazio retorna null", () => {
  assert.strictEqual(
    normalizeOrganizationRole(""),
    null
  );
});

/* ============================================================
 * Normalizacao de status
 * ============================================================ */

test("ativo legado normaliza para active", () => {
  assert.strictEqual(
    normalizeMembershipStatus("ativo"),
    "active"
  );
});

test("pendente legado normaliza para pending", () => {
  assert.strictEqual(
    normalizeMembershipStatus("pendente"),
    "pending"
  );
});

test("rejeitado legado normaliza para rejected", () => {
  assert.strictEqual(
    normalizeMembershipStatus("rejeitado"),
    "rejected"
  );
});

test("suspenso legado normaliza para suspended", () => {
  assert.strictEqual(
    normalizeMembershipStatus("suspenso"),
    "suspended"
  );
});

test("encerrado legado normaliza para ended", () => {
  assert.strictEqual(
    normalizeMembershipStatus("encerrado"),
    "ended"
  );
});

test("status desconhecido retorna null", () => {
  assert.strictEqual(
    normalizeMembershipStatus("qualquer"),
    null
  );
});

/* ============================================================
 * Compatibilidade de campos
 * ============================================================ */

test("membershipRole aceita campo legado papel", () => {
  assert.strictEqual(
    membershipRole({
      papel: "professor"
    }),
    "instructor"
  );
});

test("membershipRole prefere campo canonico role", () => {
  assert.strictEqual(
    membershipRole({
      role: "manager",
      papel: "aluno"
    }),
    "manager"
  );
});

test("membershipStatus normaliza status legado", () => {
  assert.strictEqual(
    membershipStatus({
      status: "ativo"
    }),
    "active"
  );
});

/* ============================================================
 * Vínculo ativo
 * ============================================================ */

test("manager ativo e um vinculo ativo valido", () => {
  assert.strictEqual(
    isActiveMembership({
      papel: "gestor",
      status: "ativo"
    }),
    true
  );
});

test("papel desconhecido nao forma vinculo ativo", () => {
  assert.strictEqual(
    isActiveMembership({
      papel: "desconhecido",
      status: "ativo"
    }),
    false
  );
});

test("vinculo pendente nao e ativo", () => {
  assert.strictEqual(
    isActiveMembership({
      papel: "gestor",
      status: "pendente"
    }),
    false
  );
});

test("vinculo suspenso nao e ativo", () => {
  assert.strictEqual(
    isActiveMembership({
      papel: "gestor",
      status: "suspenso"
    }),
    false
  );
});

/* ============================================================
 * Gestao de organizacao
 * ============================================================ */

test("owner ativo pode gerenciar organizacao", () => {
  assert.strictEqual(
    canManageOrganization({
      role: "owner",
      status: "active"
    }),
    true
  );
});

test("gestor ativo pode gerenciar organizacao", () => {
  assert.strictEqual(
    canManageOrganization({
      papel: "gestor",
      status: "ativo"
    }),
    true
  );
});

test("instrutor ativo nao pode gerenciar por papel", () => {
  assert.strictEqual(
    canManageOrganization({
      papel: "professor",
      status: "ativo"
    }),
    false
  );
});

test("aluno ativo nao pode gerenciar organizacao", () => {
  assert.strictEqual(
    canManageOrganization({
      papel: "aluno",
      status: "ativo"
    }),
    false
  );
});

test("manager pendente nao pode gerenciar organizacao", () => {
  assert.strictEqual(
    canManageOrganization({
      role: "manager",
      status: "pending"
    }),
    false
  );
});

/* ============================================================
 * Permissao de exame oficial
 * ============================================================ */

test("owner ativo pode aplicar exame oficial", () => {
  assert.strictEqual(
    canApplyOfficialExam({
      role: "owner",
      status: "active"
    }),
    true
  );
});

test("gestor ativo pode aplicar exame oficial", () => {
  assert.strictEqual(
    canApplyOfficialExam({
      papel: "gestor",
      status: "ativo"
    }),
    true
  );
});

test("instrutor ativo autorizado no legado pode aplicar exame", () => {
  assert.strictEqual(
    canApplyOfficialExam({
      papel: "professor",
      status: "ativo",
      pode_aplicar_exames: true
    }),
    true
  );
});

test("instrutor ativo autorizado no modelo canonico pode aplicar exame", () => {
  assert.strictEqual(
    canApplyOfficialExam({
      role: "instructor",
      status: "active",
      canApplyOfficialExam: true
    }),
    true
  );
});

test("instrutor ativo sem autorizacao nao pode aplicar exame", () => {
  assert.strictEqual(
    canApplyOfficialExam({
      papel: "professor",
      status: "ativo",
      pode_aplicar_exames: false
    }),
    false
  );
});

test("instrutor pendente nao aplica exame mesmo com flag", () => {
  assert.strictEqual(
    canApplyOfficialExam({
      papel: "professor",
      status: "pendente",
      pode_aplicar_exames: true
    }),
    false
  );
});

test("aluno nunca aplica exame mesmo com flag legado", () => {
  assert.strictEqual(
    canApplyOfficialExam({
      papel: "aluno",
      status: "ativo",
      pode_aplicar_exames: true
    }),
    false
  );
});

test("vinculo suspenso nao aplica exame", () => {
  assert.strictEqual(
    canApplyOfficialExam({
      papel: "gestor",
      status: "suspenso"
    }),
    false
  );
});

/* ============================================================
 * View canonica
 * ============================================================ */

test("View canonica converte campos legados", () => {
  assert.deepStrictEqual(
    toCanonicalMembershipView({
      organizacao_id: "org-1",
      usuario_id: "user-1",
      papel: "professor",
      status: "ativo",
      principal: true,
      pode_aplicar_exames: true
    }),
    {
      organizationId: "org-1",
      userId: "user-1",
      role: "instructor",
      status: "active",
      isPrimary: true,
      canApplyOfficialExam: true
    }
  );
});

test("View canonica preserva campos canonicos", () => {
  assert.deepStrictEqual(
    toCanonicalMembershipView({
      organizationId: "org-2",
      userId: "user-2",
      role: "student",
      status: "active",
      isPrimary: false
    }),
    {
      organizationId: "org-2",
      userId: "user-2",
      role: "student",
      status: "active",
      isPrimary: false,
      canApplyOfficialExam: false
    }
  );
});

test("View canonica prefere IDs canonicos aos legados", () => {
  const result = toCanonicalMembershipView({
    organizationId: "canonical-org",
    organizacao_id: "legacy-org",
    userId: "canonical-user",
    usuario_id: "legacy-user",
    role: "manager",
    papel: "aluno",
    status: "active",
    isPrimary: false,
    principal: true
  });

  assert.strictEqual(
    result.organizationId,
    "canonical-org"
  );

  assert.strictEqual(
    result.userId,
    "canonical-user"
  );

  assert.strictEqual(
    result.role,
    "manager"
  );

  assert.strictEqual(
    result.isPrimary,
    false
  );
});

test("Objeto vazio gera view segura sem privilegios", () => {
  assert.deepStrictEqual(
    toCanonicalMembershipView({}),
    {
      organizationId: null,
      userId: null,
      role: null,
      status: null,
      isPrimary: false,
      canApplyOfficialExam: false
    }
  );
});

console.log("");
console.log(`RESULTADO_ORG_RBAC=${passed}/40`);