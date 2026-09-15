"use strict";

const ORGANIZATION_ROLES = Object.freeze([
  "owner",
  "manager",
  "instructor",
  "student"
]);

const MEMBERSHIP_STATUSES = Object.freeze([
  "pending",
  "active",
  "rejected",
  "suspended",
  "ended"
]);

const ROLE_ALIASES = Object.freeze({
  owner: "owner",
  proprietario: "owner",
  "proprietário": "owner",

  manager: "manager",
  gestor: "manager",

  instructor: "instructor",
  instrutor: "instructor",
  professor: "instructor",

  student: "student",
  aluno: "student"
});

const STATUS_ALIASES = Object.freeze({
  pending: "pending",
  pendente: "pending",

  active: "active",
  ativo: "active",
  ativa: "active",

  rejected: "rejected",
  rejeitado: "rejected",
  rejeitada: "rejected",

  suspended: "suspended",
  suspenso: "suspended",
  suspensa: "suspended",

  ended: "ended",
  encerrado: "ended",
  encerrada: "ended"
});

function normalizeToken(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeOrganizationRole(value) {
  const token = normalizeToken(value);
  return ROLE_ALIASES[token] || null;
}

function normalizeMembershipStatus(value) {
  const token = normalizeToken(value);
  return STATUS_ALIASES[token] || null;
}

function membershipRole(membership = {}) {
  return normalizeOrganizationRole(
    membership.role || membership.papel
  );
}

function membershipStatus(membership = {}) {
  return normalizeMembershipStatus(
    membership.status
  );
}

function isActiveMembership(membership = {}) {
  return (
    membershipStatus(membership) === "active" &&
    membershipRole(membership) !== null
  );
}

function canManageOrganization(membership = {}) {
  if (!isActiveMembership(membership)) {
    return false;
  }

  const role = membershipRole(membership);

  return role === "owner" || role === "manager";
}

function explicitExamPermission(membership = {}) {
  return (
    membership.canApplyOfficialExam === true ||
    membership.pode_aplicar_exames === true
  );
}

function canApplyOfficialExam(membership = {}) {
  if (!isActiveMembership(membership)) {
    return false;
  }

  const role = membershipRole(membership);

  if (role === "owner" || role === "manager") {
    return true;
  }

  if (role === "instructor") {
    return explicitExamPermission(membership);
  }

  return false;
}

function toCanonicalMembershipView(membership = {}) {
  const isPrimary =
    typeof membership.isPrimary === "boolean"
      ? membership.isPrimary
      : membership.principal === true;

  return {
    organizationId:
      membership.organizationId ||
      membership.organizacao_id ||
      null,

    userId:
      membership.userId ||
      membership.usuario_id ||
      null,

    role: membershipRole(membership),
    status: membershipStatus(membership),
    isPrimary,
    canApplyOfficialExam:
      canApplyOfficialExam(membership)
  };
}

module.exports = {
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
};