"use strict";

const {
  isDeepStrictEqual
} = require("node:util");

const {
  membershipRole,
  normalizeMembershipStatus
} = require("../auth/organization-membership");

function nonEmpty(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (
    typeof value === "string" &&
    !value.trim()
  ) {
    return null;
  }

  return value;
}

function pick(...values) {
  for (const value of values) {
    const normalized =
      nonEmpty(value);

    if (normalized !== null) {
      return normalized;
    }
  }

  return null;
}

function text(value) {
  const result =
    String(value || "")
      .trim();

  return result || null;
}

function lower(value) {
  const result =
    text(value);

  return result
    ? result.toLowerCase()
    : null;
}

function normalizeEmail(value) {
  return lower(value);
}

function compactObject(value) {
  const result = {};

  for (
    const [key, item]
    of Object.entries(value)
  ) {
    if (
      item !== undefined &&
      item !== null
    ) {
      result[key] = item;
    }
  }

  return result;
}

function normalizeAccountStatus(
  authUser,
  ...documents
) {
  if (authUser?.disabled === true) {
    return "suspended";
  }

  const tokens =
    documents
      .filter(Boolean)
      .flatMap(document => [
        lower(document.status),
        lower(document.status_conta),
        lower(document.accountStatus)
      ])
      .filter(Boolean);

  if (
    tokens.some(token =>
      [
        "archived",
        "arquivado",
        "arquivada"
      ].includes(token)
    )
  ) {
    return "archived";
  }

  if (
    tokens.some(token =>
      [
        "suspended",
        "suspenso",
        "suspensa",
        "blocked",
        "bloqueado",
        "bloqueada",
        "inactive",
        "inativo",
        "inativa"
      ].includes(token)
    )
  ) {
    return "suspended";
  }

  return "active";
}

function normalizeOrganizationStatus(value) {
  const token =
    lower(value);

  if (
    [
      "archived",
      "arquivado",
      "arquivada"
    ].includes(token)
  ) {
    return "archived";
  }

  if (
    [
      "suspended",
      "suspenso",
      "suspensa",
      "blocked",
      "bloqueado",
      "bloqueada",
      "inactive",
      "inativo",
      "inativa"
    ].includes(token)
  ) {
    return "suspended";
  }

  return "active";
}

function normalizeOrganizationType(
  value,
  source = null
) {
  const token =
    lower(value);

  if (
    token === "academia" ||
    token === "academy"
  ) {
    return "academy";
  }

  if (
    token === "team" ||
    token === "equipe"
  ) {
    return "team";
  }

  // A collection legada `equipes` nao armazenava necessariamente
  // um tipo explicito. No fluxo legado do BJJ Exams ela representa
  // a academia institucional e deve migrar como academy.
  if (
    !token &&
    source === "equipes"
  ) {
    return "academy";
  }

  return "team";
}

function mapCanonicalUser({
  usuario,
  aluno,
  professor,
  admin,
  superAdmin,
  authUser
} = {}) {
  const primary =
    usuario ||
    aluno ||
    {};

  const displayName =
    pick(
      primary.nome,
      primary.displayName,
      primary.name,
      aluno?.nome,
      authUser?.displayName
    );

  const email =
    normalizeEmail(
      pick(
        authUser?.email,
        primary.email,
        aluno?.email
      )
    );

  const phone =
    pick(
      primary.phone,
      primary.telefone,
      aluno?.telefone,
      authUser?.phoneNumber
    );

  const photoURL =
    pick(
      primary.photoURL,
      primary.foto_url,
      aluno?.photoURL,
      authUser?.photoURL
    );

  const createdAt =
    pick(
      primary.createdAt,
      primary.data_cadastro,
      primary.criado_em,
      aluno?.data_cadastro,
      professor?.criado_em,
      admin?.criado_em,
      superAdmin?.criado_em
    );

  return compactObject({
    displayName:
      displayName || "Usuário BJJ Exams",

    email,

    photoURL,

    phone,

    status:
      normalizeAccountStatus(
        authUser,
        usuario,
        aluno,
        professor,
        admin,
        superAdmin
      ),

    profileCompleted:
      Boolean(
        usuario ||
        aluno ||
        professor
      ),

    createdAt
  });
}

function mapCanonicalOrganization(
  id,
  data = {},
  source
) {
  const contact =
    compactObject({
      email:
        normalizeEmail(
          pick(
            data.contact?.email,
            data.email,
            data.email_contato
          )
        ),

      phone:
        pick(
          data.contact?.phone,
          data.telefone,
          data.phone
        )
    });

  const address =
    compactObject({
      city:
        pick(
          data.address?.city,
          data.cidade
        ),

      state:
        pick(
          data.address?.state,
          data.estado,
          data.uf
        ),

      country:
        pick(
          data.address?.country,
          data.pais,
          "BR"
        )
    });

  return compactObject({
    name:
      pick(
        data.name,
        data.nome,
        data.nome_equipe,
        "Academia"
      ),

    type:
      normalizeOrganizationType(
        pick(
          data.type,
          data.tipo
        ),
        source
      ),

    status:
      normalizeOrganizationStatus(
        data.status
      ),

    contact:
      Object.keys(contact).length
        ? contact
        : undefined,

    address:
      Object.keys(address).length
        ? address
        : undefined,

    legacySourceId:
      source === "equipes"
        ? id
        : pick(
            data.legacySourceId,
            data.legacy_source_id
          ),

    createdAt:
      pick(
        data.createdAt,
        data.criado_em
      ),

    createdBy:
      pick(
        data.createdBy,
        data.criado_por_uid
      )
  });
}

function mapTransitionalMembership(
  membership
) {
  const organizationId =
    pick(
      membership.organizationId,
      membership.organizacao_id
    );

  const userId =
    pick(
      membership.userId,
      membership.usuario_id
    );

  const role =
    membershipRole(
      membership
    );

  const status =
    normalizeMembershipStatus(
      membership.status
    );

  if (
    !organizationId ||
    !userId ||
    !role ||
    !status
  ) {
    return null;
  }

  return compactObject({
    organizationId,
    userId,
    role,
    status,

    isPrimary:
      typeof membership.isPrimary ===
      "boolean"
        ? membership.isPrimary
        : membership.principal === true,

    requestedBy:
      pick(
        membership.requestedBy,
        membership.solicitado_por_uid,
        membership.convidado_por_uid
      ),

    approvedBy:
      pick(
        membership.approvedBy,
        membership.aprovado_por_uid
      ),

    requestedAt:
      pick(
        membership.requestedAt,
        membership.solicitado_em,
        membership.convidado_em
      ),

    approvedAt:
      pick(
        membership.approvedAt,
        membership.aprovado_em
      ),

    endedAt:
      pick(
        membership.endedAt,
        membership.encerrado_em
      ),

    canApplyOfficialExam:
      (
        membership.canApplyOfficialExam ===
          true ||
        membership.pode_aplicar_exames ===
          true
      )
  });
}

function mapLegacyStudentMembership(
  uid,
  aluno = {}
) {
  const organizationId =
    pick(
      aluno.organizationId,
      aluno.organizacao_id,
      aluno.equipe_id
    );

  if (!organizationId) {
    return null;
  }

  const status =
    normalizeMembershipStatus(
      aluno.status_vinculo
    );

  if (!status) {
    return {
      invalid:
        "UNKNOWN_STATUS",
      organizationId,
      userId:
        uid
    };
  }

  return {
    organizationId,
    userId:
      uid,
    role:
      "student",
    status,
    isPrimary:
      true,
    canApplyOfficialExam:
      false
  };
}

function mapLegacyProfessorMembership(
  uid,
  professor = {}
) {
  const organizationId =
    pick(
      professor.organizationId,
      professor.organizacao_id,
      professor.equipe_id
    );

  if (!organizationId) {
    return null;
  }

  const status =
    normalizeMembershipStatus(
      professor.status_vinculo
    );

  if (!status) {
    return {
      invalid:
        "UNKNOWN_STATUS",
      organizationId,
      userId:
        uid
    };
  }

  const manager =
    professor.eh_responsavel ===
      true;

  return {
    organizationId,
    userId:
      uid,
    role:
      manager
        ? "manager"
        : "instructor",
    status,
    isPrimary:
      true,
    canApplyOfficialExam:
      Boolean(
        manager ||
        professor.pode_aprovar ===
          true ||
        professor.pode_aplicar_exames ===
          true
      )
  };
}

function desiredSubsetMatches(
  existing,
  desired
) {
  if (!existing) {
    return false;
  }

  for (
    const [key, value]
    of Object.entries(desired)
  ) {
    if (
      !Object.prototype
        .hasOwnProperty
        .call(
          existing,
          key
        )
    ) {
      return false;
    }

    if (
      !isDeepStrictEqual(
        existing[key],
        value
      )
    ) {
      return false;
    }
  }

  return true;
}

function classifyOperation(
  existing,
  desired
) {
  if (!existing) {
    return "CREATE";
  }

  if (
    desiredSubsetMatches(
      existing,
      desired
    )
  ) {
    return "NO_CHANGE";
  }

  return "CONFLICT";
}

function emptyMap(value) {
  return value instanceof Map
    ? value
    : new Map();
}

function buildMigrationPlan(
  snapshot = {}
) {
  const usuarios =
    emptyMap(snapshot.usuarios);

  const alunos =
    emptyMap(snapshot.alunos);

  const professores =
    emptyMap(snapshot.professores);

  const admins =
    emptyMap(snapshot.admins);

  const superAdmins =
    emptyMap(snapshot.superAdmins);

  const equipes =
    emptyMap(snapshot.equipes);

  const organizacoes =
    emptyMap(snapshot.organizacoes);

  const vinculos =
    emptyMap(snapshot.vinculos);

  const users =
    emptyMap(snapshot.users);

  const organizations =
    emptyMap(snapshot.organizations);

  const organizationMemberships =
    emptyMap(
      snapshot.organizationMemberships
    );

  const authUsers =
    emptyMap(snapshot.authUsers);

  const inconsistencies = [];

  const userActions = [];
  const organizationActions = [];
  const membershipActions = [];

  // ------------------------------------------------------------
  // USERS
  // ------------------------------------------------------------

  const identityUids =
    new Set([
      ...usuarios.keys(),
      ...alunos.keys(),
      ...professores.keys(),
      ...admins.keys(),
      ...superAdmins.keys()
    ]);

  for (
    const uid
    of [...identityUids].sort()
  ) {
    const desired =
      mapCanonicalUser({
        usuario:
          usuarios.get(uid),
        aluno:
          alunos.get(uid),
        professor:
          professores.get(uid),
        admin:
          admins.get(uid),
        superAdmin:
          superAdmins.get(uid),
        authUser:
          authUsers.get(uid)
      });

    userActions.push({
      kind:
        "user",
      id:
        uid,
      operation:
        classifyOperation(
          users.get(uid),
          desired
        ),
      desired
    });
  }

  // ------------------------------------------------------------
  // ORGANIZATIONS
  // Preferir organizacoes quando ambos existem.
  // ------------------------------------------------------------

  const organizationIds =
    new Set([
      ...equipes.keys(),
      ...organizacoes.keys()
    ]);

  for (
    const id
    of [...organizationIds].sort()
  ) {
    const transitional =
      organizacoes.get(id);

    const legacy =
      equipes.get(id);

    const source =
      transitional
        ? "organizacoes"
        : "equipes";

    const sourceData =
      transitional ||
      legacy;

    const desired =
      mapCanonicalOrganization(
        id,
        sourceData,
        source
      );

    organizationActions.push({
      kind:
        "organization",
      id,
      source,
      operation:
        classifyOperation(
          organizations.get(id),
          desired
        ),
      desired
    });
  }

  // ------------------------------------------------------------
  // MEMBERSHIPS TRANSITIONAIS
  // ------------------------------------------------------------

  const plannedMembershipKeys =
    new Set();

  for (
    const [
      sourceDocumentId,
      membership
    ]
    of vinculos
  ) {
    const desired =
      mapTransitionalMembership(
        membership
      );

    if (!desired) {
      inconsistencies.push({
        type:
          "TRANSITIONAL_MEMBERSHIP_INVALID",
        sourceDocumentId
      });

      continue;
    }

    const targetId =
      `${desired.organizationId}__${desired.userId}`;

    if (
      plannedMembershipKeys.has(
        targetId
      )
    ) {
      inconsistencies.push({
        type:
          "DUPLICATE_MEMBERSHIP_TARGET",
        targetId
      });

      continue;
    }

    if (
      !organizationIds.has(
        desired.organizationId
      )
    ) {
      inconsistencies.push({
        type:
          "MEMBERSHIP_ORGANIZATION_NOT_FOUND",
        targetId
      });

      continue;
    }

    if (
      !identityUids.has(
        desired.userId
      )
    ) {
      inconsistencies.push({
        type:
          "MEMBERSHIP_USER_NOT_FOUND",
        targetId
      });

      continue;
    }

    plannedMembershipKeys.add(
      targetId
    );

    membershipActions.push({
      kind:
        "membership",
      id:
        targetId,
      source:
        "vinculos_organizacao",
      operation:
        classifyOperation(
          organizationMemberships
            .get(targetId),
          desired
        ),
      desired
    });
  }

  // ------------------------------------------------------------
  // FALLBACK DE ALUNOS LEGADOS
  // ------------------------------------------------------------

  for (
    const [
      uid,
      aluno
    ]
    of alunos
  ) {
    const desired =
      mapLegacyStudentMembership(
        uid,
        aluno
      );

    if (!desired) {
      continue;
    }

    const targetId =
      `${desired.organizationId}__${uid}`;

    if (
      plannedMembershipKeys.has(
        targetId
      )
    ) {
      continue;
    }

    if (desired.invalid) {
      inconsistencies.push({
        type:
          "LEGACY_STUDENT_MEMBERSHIP_STATUS_UNKNOWN",
        targetId
      });

      continue;
    }

    if (
      !organizationIds.has(
        desired.organizationId
      )
    ) {
      inconsistencies.push({
        type:
          "MEMBERSHIP_ORGANIZATION_NOT_FOUND",
        targetId
      });

      continue;
    }

    plannedMembershipKeys.add(
      targetId
    );

    membershipActions.push({
      kind:
        "membership",
      id:
        targetId,
      source:
        "alunos",
      operation:
        classifyOperation(
          organizationMemberships
            .get(targetId),
          desired
        ),
      desired
    });
  }

  // ------------------------------------------------------------
  // FALLBACK DE PROFESSORES LEGADOS
  // ------------------------------------------------------------

  for (
    const [
      uid,
      professor
    ]
    of professores
  ) {
    const desired =
      mapLegacyProfessorMembership(
        uid,
        professor
      );

    if (!desired) {
      continue;
    }

    const targetId =
      `${desired.organizationId}__${uid}`;

    if (
      plannedMembershipKeys.has(
        targetId
      )
    ) {
      continue;
    }

    if (desired.invalid) {
      inconsistencies.push({
        type:
          "LEGACY_INSTRUCTOR_MEMBERSHIP_STATUS_UNKNOWN",
        targetId
      });

      continue;
    }

    if (
      !organizationIds.has(
        desired.organizationId
      )
    ) {
      inconsistencies.push({
        type:
          "MEMBERSHIP_ORGANIZATION_NOT_FOUND",
        targetId
      });

      continue;
    }

    plannedMembershipKeys.add(
      targetId
    );

    membershipActions.push({
      kind:
        "membership",
      id:
        targetId,
      source:
        "professores",
      operation:
        classifyOperation(
          organizationMemberships
            .get(targetId),
          desired
        ),
      desired
    });
  }

  function countOperations(actions) {
    return actions.reduce(
      (accumulator, action) => {
        accumulator[
          action.operation
        ] =
          (
            accumulator[
              action.operation
            ] ||
            0
          ) + 1;

        return accumulator;
      },
      {
        CREATE: 0,
        NO_CHANGE: 0,
        CONFLICT: 0
      }
    );
  }

  const userCounts =
    countOperations(
      userActions
    );

  const organizationCounts =
    countOperations(
      organizationActions
    );

  const membershipCounts =
    countOperations(
      membershipActions
    );

  return {
    actions: {
      users:
        userActions,
      organizations:
        organizationActions,
      memberships:
        membershipActions
    },

    inconsistencies,

    summary: {
      canonicalBefore: {
        users:
          users.size,
        organizations:
          organizations.size,
        organization_memberships:
          organizationMemberships.size
      },

      operations: {
        users:
          userCounts,
        organizations:
          organizationCounts,
        organization_memberships:
          membershipCounts
      },

      predictedAfter: {
        users:
          users.size +
          userCounts.CREATE,

        organizations:
          organizations.size +
          organizationCounts.CREATE,

        organization_memberships:
          organizationMemberships.size +
          membershipCounts.CREATE
      },

      inconsistencies:
        inconsistencies.length,

      physicalDeletes:
        0
    }
  };
}

module.exports = {
  mapCanonicalUser,
  mapCanonicalOrganization,
  mapTransitionalMembership,
  mapLegacyStudentMembership,
  mapLegacyProfessorMembership,
  classifyOperation,
  buildMigrationPlan
};