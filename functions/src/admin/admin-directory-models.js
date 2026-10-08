"use strict";

const {
  normalizeOrganizationRole,
  toCanonicalMembershipView
} = require(
  "../auth/organization-membership"
);

const PERSON_VIEW_FIELDS =
  Object.freeze([
    "personId",
    "displayName",
    "email",
    "profileType",
    "operationalStatus",
    "memberships",
    "createdAt",
    "updatedAt"
  ]);

const ORGANIZATION_VIEW_FIELDS =
  Object.freeze([
    "organizationId",
    "name",
    "status",
    "membershipCounts",
    "responsibleSummary",
    "createdAt",
    "updatedAt"
  ]);

function cleanText(
  value,
  maxLength = 200
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    String(value)
      .trim()
      .slice(
        0,
        maxLength
      );

  return normalized || null;
}

function normalizeProfileType(
  profile = {}
) {
  const token =
    String(
      profile.tipo_usuario ||
      profile.tipoUsuario ||
      profile.papel_principal ||
      profile.profileType ||
      ""
    )
      .trim()
      .toLowerCase();

  if (
    [
      "professor",
      "instrutor",
      "instructor"
    ].includes(token)
  ) {
    return "instructor";
  }

  if (
    [
      "aluno",
      "student"
    ].includes(token)
  ) {
    return "student";
  }

  return null;
}

function normalizeOperationalStatus(
  value
) {
  const token =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    [
      "active",
      "ativo",
      "ativa",
      "enabled"
    ].includes(token)
  ) {
    return "active";
  }

  if (
    [
      "pending",
      "pendente"
    ].includes(token)
  ) {
    return "pending";
  }

  if (
    [
      "suspended",
      "suspenso",
      "suspensa",
      "blocked",
      "bloqueado",
      "bloqueada"
    ].includes(token)
  ) {
    return "suspended";
  }

  if (
    [
      "inactive",
      "inativo",
      "inativa",
      "disabled",
      "desativado",
      "desativada",
      "archived",
      "arquivado",
      "arquivada"
    ].includes(token)
  ) {
    return "inactive";
  }

  return "unknown";
}

function toIsoTimestamp(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(
      value.getTime()
    )
      ? null
      : value.toISOString();
  }

  if (
    typeof value === "string"
  ) {
    return (
      value.trim() ||
      null
    );
  }

  try {
    if (
      typeof value.toDate ===
      "function"
    ) {
      const date =
        value.toDate();

      return (
        date instanceof Date &&
        !Number.isNaN(
          date.getTime()
        )
      )
        ? date.toISOString()
        : null;
    }

    if (
      typeof value.toMillis ===
      "function"
    ) {
      const millis =
        Number(
          value.toMillis()
        );

      if (
        Number.isFinite(
          millis
        )
      ) {
        return new Date(
          millis
        ).toISOString();
      }
    }

    const seconds =
      Number(
        value.seconds ??
        value._seconds
      );

    if (
      Number.isFinite(
        seconds
      )
    ) {
      return new Date(
        seconds * 1000
      ).toISOString();
    }
  }
  catch (_) {
    return null;
  }

  return null;
}

function buildOperationalMembershipView(
  membership
) {
  if (
    !membership ||
    typeof membership !== "object" ||
    Array.isArray(membership)
  ) {
    return null;
  }

  const canonical =
    toCanonicalMembershipView(
      membership
    );

  if (
    !canonical.organizationId ||
    !canonical.role ||
    !canonical.status
  ) {
    return null;
  }

  return Object.freeze({
    organizationId:
      String(
        canonical.organizationId
      ),

    role:
      canonical.role,

    status:
      canonical.status,

    isPrimary:
      canonical.isPrimary === true,

    canApplyOfficialExam:
      canonical
        .canApplyOfficialExam ===
      true
  });
}

function buildMembershipViews(
  memberships = []
) {
  if (
    !Array.isArray(
      memberships
    )
  ) {
    return Object.freeze([]);
  }

  const result =
    memberships
      .map(
        buildOperationalMembershipView
      )
      .filter(Boolean)
      .sort(
        (
          left,
          right
        ) => {
          const leftKey =
            `${left.organizationId}|${left.role}`;

          const rightKey =
            `${right.organizationId}|${right.role}`;

          return leftKey.localeCompare(
            rightKey
          );
        }
      );

  return Object.freeze(
    result
  );
}

function buildOperationalPersonView(
  input = {}
) {
  const personId =
    cleanText(
      input.personId,
      128
    );

  if (!personId) {
    throw new Error(
      "ADMIN_DIRECTORY_PERSON_ID_REQUIRED"
    );
  }

  const profile =
    input.profile &&
    typeof input.profile === "object" &&
    !Array.isArray(
      input.profile
    )
      ? input.profile
      : {};

  const memberships =
    buildMembershipViews(
      input.memberships
    );

  const displayName =
    cleanText(
      profile.displayName ||
      profile.nome ||
      profile.name ||
      profile.nome_completo,
      180
    );

  const email =
    cleanText(
      profile.email,
      254
    );

  const operationalStatus =
    normalizeOperationalStatus(
      profile.status_conta ||
      profile.accountStatus ||
      profile.operationalStatus ||
      profile.status ||
      profile.status_vinculo
    );

  return Object.freeze({
    personId,

    displayName,

    email:
      email
        ? email.toLowerCase()
        : null,

    profileType:
      normalizeProfileType(
        profile
      ),

    operationalStatus,

    memberships,

    createdAt:
      toIsoTimestamp(
        profile.createdAt ||
        profile.criado_em ||
        profile.data_cadastro ||
        profile.cadastrado_em
      ),

    updatedAt:
      toIsoTimestamp(
        profile.updatedAt ||
        profile.atualizado_em ||
        profile.data_atualizacao ||
        profile.modificado_em
      )
  });
}

function buildMembershipCounts(
  memberships = []
) {
  const views =
    buildMembershipViews(
      memberships
    );

  const counts = {
    total: views.length,

    active: 0,
    pending: 0,
    rejected: 0,
    suspended: 0,
    ended: 0,

    owners: 0,
    managers: 0,
    instructors: 0,
    students: 0
  };

  for (
    const membership of
    views
  ) {
    if (
      Object.prototype
        .hasOwnProperty.call(
          counts,
          membership.status
        )
    ) {
      counts[
        membership.status
      ] += 1;
    }

    if (
      membership.role ===
      "owner"
    ) {
      counts.owners += 1;
    }

    if (
      membership.role ===
      "manager"
    ) {
      counts.managers += 1;
    }

    if (
      membership.role ===
      "instructor"
    ) {
      counts.instructors += 1;
    }

    if (
      membership.role ===
      "student"
    ) {
      counts.students += 1;
    }
  }

  return Object.freeze(
    counts
  );
}

function sanitizeResponsibleSummary(
  value
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const personId =
    cleanText(
      value.personId ||
      value.userId ||
      value.uid,
      128
    );

  const displayName =
    cleanText(
      value.displayName ||
      value.nome ||
      value.name,
      180
    );

  const email =
    cleanText(
      value.email,
      254
    );

  const role =
    normalizeOrganizationRole(
      value.role ||
      value.papel
    );

  if (
    !personId &&
    !displayName &&
    !email
  ) {
    return null;
  }

  return Object.freeze({
    personId,

    displayName,

    email:
      email
        ? email.toLowerCase()
        : null,

    role
  });
}

function buildOperationalOrganizationView(
  input = {}
) {
  const organizationId =
    cleanText(
      input.organizationId,
      128
    );

  if (!organizationId) {
    throw new Error(
      "ADMIN_DIRECTORY_ORGANIZATION_ID_REQUIRED"
    );
  }

  const organization =
    input.organization &&
    typeof input.organization === "object" &&
    !Array.isArray(
      input.organization
    )
      ? input.organization
      : {};

  return Object.freeze({
    organizationId,

    name:
      cleanText(
        organization.name ||
        organization.nome ||
        organization.nome_equipe,
        180
      ),

    status:
      normalizeOperationalStatus(
        organization.status
      ),

    membershipCounts:
      buildMembershipCounts(
        input.memberships
      ),

    responsibleSummary:
      sanitizeResponsibleSummary(
        input.responsibleSummary
      ),

    createdAt:
      toIsoTimestamp(
        organization.createdAt ||
        organization.criado_em
      ),

    updatedAt:
      toIsoTimestamp(
        organization.updatedAt ||
        organization.atualizado_em
      )
  });
}

module.exports = {
  PERSON_VIEW_FIELDS,
  ORGANIZATION_VIEW_FIELDS,

  cleanText,
  normalizeProfileType,
  normalizeOperationalStatus,
  toIsoTimestamp,

  buildOperationalMembershipView,
  buildMembershipViews,
  buildMembershipCounts,
  sanitizeResponsibleSummary,

  buildOperationalPersonView,
  buildOperationalOrganizationView
};
