"use strict";

const {
  FieldPath
} = require(
  "firebase-admin/firestore"
);

const {
  toCanonicalMembershipView
} = require(
  "../auth/organization-membership"
);

const {
  buildOperationalOrganizationView
} = require(
  "./admin-directory-models"
);

const DEFAULT_ORGANIZATIONS_LIMIT = 20;
const MAX_ORGANIZATIONS_LIMIT = 25;
const ORGANIZATION_CURSOR_VERSION = 1;

const ORGANIZATION_STATUS_FILTERS =
  Object.freeze([
    "active",
    "pending",
    "suspended",
    "inactive",
    "unknown"
  ]);

class AdminOrganizationsReadError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminOrganizationsReadError";

    this.code =
      code;
  }
}

function text(
  value,
  maxLength = 200
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value)
      .trim();

  return normalized
    ? normalized.slice(
        0,
        maxLength
      )
    : null;
}

function requiredIdentifier(
  value,
  field
) {
  const identifier =
    text(
      value,
      128
    );

  if (
    !identifier ||
    identifier.includes("/")
  ) {
    throw new AdminOrganizationsReadError(
      "ADMIN_ORGANIZATION_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }

  return identifier;
}

function readOrganizationsLimit(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return DEFAULT_ORGANIZATIONS_LIMIT;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(
      parsed
    ) ||
    parsed < 1 ||
    parsed > MAX_ORGANIZATIONS_LIMIT
  ) {
    throw new AdminOrganizationsReadError(
      "ADMIN_ORGANIZATIONS_LIMIT_INVALID",
      `limit must be an integer between 1 and ${MAX_ORGANIZATIONS_LIMIT}.`
    );
  }

  return parsed;
}

function normalizeOrganizationStatusFilter(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value !== "string"
  ) {
    throw new AdminOrganizationsReadError(
      "ADMIN_ORGANIZATIONS_FILTER_INVALID",
      "status filter is invalid."
    );
  }

  const normalized =
    value
      .trim()
      .toLowerCase();

  if (
    !ORGANIZATION_STATUS_FILTERS
      .includes(
        normalized
      )
  ) {
    throw new AdminOrganizationsReadError(
      "ADMIN_ORGANIZATIONS_FILTER_INVALID",
      "status filter is invalid."
    );
  }

  return normalized;
}

function normalizeOrganizationNameQuery(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value !== "string"
  ) {
    throw new AdminOrganizationsReadError(
      "ADMIN_ORGANIZATIONS_FILTER_INVALID",
      "nameQuery filter is invalid."
    );
  }

  const normalized =
    value
      .trim()
      .toLowerCase();

  if (
    normalized.length >
    80
  ) {
    throw new AdminOrganizationsReadError(
      "ADMIN_ORGANIZATIONS_FILTER_INVALID",
      "nameQuery filter is too long."
    );
  }

  return normalized || null;
}

function normalizeOrganizationFilters(
  input = {}
) {
  return Object.freeze({
    status:
      normalizeOrganizationStatusFilter(
        input.status
      ),

    nameQuery:
      normalizeOrganizationNameQuery(
        input.nameQuery
      )
  });
}

function matchesOrganizationFilters(
  organization,
  filters = {}
) {
  if (
    filters.status &&
    organization?.status !==
      filters.status
  ) {
    return false;
  }

  if (
    filters.nameQuery
  ) {
    const name =
      String(
        organization?.name ||
        ""
      )
        .trim()
        .toLowerCase();

    if (
      !name.includes(
        filters.nameQuery
      )
    ) {
      return false;
    }
  }

  return true;
}

function encodeOrganizationCursor(
  organizationId
) {
  const normalized =
    requiredIdentifier(
      organizationId,
      "organizationId"
    );

  return Buffer
    .from(
      JSON.stringify({
        v:
          ORGANIZATION_CURSOR_VERSION,

        lastOrganizationId:
          normalized
      }),
      "utf8"
    )
    .toString(
      "base64url"
    );
}

function decodeOrganizationCursor(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value !== "string" ||
    value.length > 512
  ) {
    throw new AdminOrganizationsReadError(
      "ADMIN_ORGANIZATIONS_CURSOR_INVALID",
      "Organization cursor is invalid."
    );
  }

  try {
    const parsed =
      JSON.parse(
        Buffer
          .from(
            value,
            "base64url"
          )
          .toString(
            "utf8"
          )
      );

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.v !==
        ORGANIZATION_CURSOR_VERSION
    ) {
      throw new Error(
        "invalid cursor"
      );
    }

    return requiredIdentifier(
      parsed.lastOrganizationId,
      "cursor.lastOrganizationId"
    );
  }
  catch (error) {
    if (
      error instanceof
      AdminOrganizationsReadError
    ) {
      throw error;
    }

    throw new AdminOrganizationsReadError(
      "ADMIN_ORGANIZATIONS_CURSOR_INVALID",
      "Organization cursor is invalid."
    );
  }
}

function organizationMembershipCandidate(
  membership,
  organizationId
) {
  const canonical =
    toCanonicalMembershipView(
      membership
    );

  if (
    !canonical.organizationId ||
    String(
      canonical.organizationId
    ) !==
      String(
        organizationId
      ) ||
    !canonical.userId ||
    canonical.status !==
      "active" ||
    ![
      "owner",
      "manager"
    ].includes(
      canonical.role
    )
  ) {
    return null;
  }

  return Object.freeze({
    personId:
      String(
        canonical.userId
      ),

    role:
      canonical.role,

    isPrimary:
      canonical.isPrimary ===
      true
  });
}

function selectResponsibleMembership(
  memberships,
  organizationId
) {
  if (
    !Array.isArray(
      memberships
    )
  ) {
    return null;
  }

  const candidates =
    memberships
      .map(
        membership =>
          organizationMembershipCandidate(
            membership,
            organizationId
          )
      )
      .filter(Boolean)
      .sort(
        (
          left,
          right
        ) => {
          const leftRole =
            left.role ===
            "owner"
              ? 0
              : 1;

          const rightRole =
            right.role ===
            "owner"
              ? 0
              : 1;

          if (
            leftRole !==
            rightRole
          ) {
            return (
              leftRole -
              rightRole
            );
          }

          if (
            left.isPrimary !==
            right.isPrimary
          ) {
            return left.isPrimary
              ? -1
              : 1;
          }

          return left.personId
            .localeCompare(
              right.personId
            );
        }
      );

  return candidates[0] ||
    null;
}

function buildResponsibleSummary(
  membership,
  profile
) {
  if (!membership) {
    return null;
  }

  const safeProfile =
    profile &&
    typeof profile ===
      "object" &&
    !Array.isArray(profile)
      ? profile
      : {};

  return {
    personId:
      membership.personId,

    displayName:
      text(
        safeProfile.displayName ||
        safeProfile.nome ||
        safeProfile.name ||
        safeProfile.nome_completo,
        180
      ),

    email:
      text(
        safeProfile.email,
        254
      ),

    role:
      membership.role
  };
}

function createAdminOrganizationsReadService(
  dependencies = {}
) {
  const {
    db,

    documentIdField =
      FieldPath.documentId()
  } = dependencies;

  if (
    !db ||
    typeof db.collection !==
      "function" ||
    typeof db.doc !==
      "function"
  ) {
    throw new TypeError(
      "Admin organizations read service requires Firestore."
    );
  }

  async function loadMembershipsForOrganizations(
    organizationIds
  ) {
    if (
      !Array.isArray(
        organizationIds
      ) ||
      organizationIds.length ===
        0
    ) {
      return new Map();
    }

    if (
      organizationIds.length >
      MAX_ORGANIZATIONS_LIMIT
    ) {
      throw new AdminOrganizationsReadError(
        "ADMIN_ORGANIZATIONS_BATCH_INVALID",
        "Organization membership batch is too large."
      );
    }

    const allowedIds =
      new Set(
        organizationIds
      );

    const snapshot =
      await db
        .collection(
          "vinculos_organizacao"
        )
        .where(
          "organizacao_id",
          "in",
          organizationIds
        )
        .get();

    const result =
      new Map(
        organizationIds.map(
          organizationId => [
            organizationId,
            []
          ]
        )
      );

    for (
      const document
      of snapshot.docs
    ) {
      const membership = {
        id:
          document.id,

        ...(
          document.data() ||
          {}
        )
      };

      const canonical =
        toCanonicalMembershipView(
          membership
        );

      const organizationId =
        canonical.organizationId
          ? String(
              canonical.organizationId
            )
          : null;

      if (
        !organizationId ||
        !allowedIds.has(
          organizationId
        )
      ) {
        throw new AdminOrganizationsReadError(
          "ADMIN_ORGANIZATIONS_CANONICAL_STATE_INVALID",
          "Membership query returned an unexpected organization."
        );
      }

      result
        .get(
          organizationId
        )
        .push(
          membership
        );
    }

    return result;
  }

  async function loadMembershipsForOrganization(
    organizationId
  ) {
    const snapshot =
      await db
        .collection(
          "vinculos_organizacao"
        )
        .where(
          "organizacao_id",
          "==",
          organizationId
        )
        .get();

    return snapshot.docs.map(
      document => ({
        id:
          document.id,

        ...(
          document.data() ||
          {}
        )
      })
    );
  }

  async function loadResponsibleProfiles(
    responsibleMemberships
  ) {
    const personIds =
      Array.from(
        new Set(
          responsibleMemberships
            .filter(Boolean)
            .map(
              membership =>
                membership.personId
            )
        )
      );

    if (
      personIds.length ===
      0
    ) {
      return new Map();
    }

    if (
      personIds.length >
      MAX_ORGANIZATIONS_LIMIT
    ) {
      throw new AdminOrganizationsReadError(
        "ADMIN_ORGANIZATIONS_BATCH_INVALID",
        "Responsible profile batch is too large."
      );
    }

    const snapshot =
      await db
        .collection(
          "usuarios"
        )
        .where(
          documentIdField,
          "in",
          personIds
        )
        .get();

    const result =
      new Map();

    for (
      const document
      of snapshot.docs
    ) {
      if (
        personIds.includes(
          document.id
        )
      ) {
        result.set(
          document.id,
          document.data() ||
          {}
        );
      }
    }

    return result;
  }

  async function listOrganizations(
    input = {}
  ) {
    const limit =
      readOrganizationsLimit(
        input.limit
      );

    const filters =
      normalizeOrganizationFilters(
        input
      );

    const afterOrganizationId =
      decodeOrganizationCursor(
        input.cursor
      );

    let query =
      db
        .collection(
          "organizacoes"
        )
        .orderBy(
          documentIdField
        );

    if (
      afterOrganizationId
    ) {
      query =
        query.startAfter(
          afterOrganizationId
        );
    }

    const snapshot =
      await query
        .limit(
          limit + 1
        )
        .get();

    const hasMore =
      snapshot.docs.length >
      limit;

    const selectedDocs =
      snapshot.docs.slice(
        0,
        limit
      );

    const organizationIds =
      selectedDocs.map(
        document =>
          document.id
      );

    const membershipsByOrganization =
      await loadMembershipsForOrganizations(
        organizationIds
      );

    const responsibleMemberships =
      selectedDocs.map(
        document =>
          selectResponsibleMembership(
            membershipsByOrganization
              .get(
                document.id
              ) ||
            [],
            document.id
          )
      );

    const profiles =
      await loadResponsibleProfiles(
        responsibleMemberships
      );

    const mappedItems =
      selectedDocs.map(
        (
          document,
          index
        ) => {
          const memberships =
            membershipsByOrganization
              .get(
                document.id
              ) ||
            [];

          const responsible =
            responsibleMemberships[
              index
            ];

          const profile =
            responsible
              ? profiles.get(
                  responsible.personId
                )
              : null;

          return buildOperationalOrganizationView({
            organizationId:
              document.id,

            organization:
              document.data() ||
              {},

            memberships,

            responsibleSummary:
              buildResponsibleSummary(
                responsible,
                profile
              )
          });
        }
      );

    const items =
      mappedItems.filter(
        organization =>
          matchesOrganizationFilters(
            organization,
            filters
          )
      );

    const lastItem =
      selectedDocs[
        selectedDocs.length - 1
      ];

    const nextCursor =
      hasMore &&
      lastItem
        ? encodeOrganizationCursor(
            lastItem.id
          )
        : null;

    return Object.freeze({
      limit,

      items:
        Object.freeze(
          items
        ),

      nextCursor
    });
  }

  async function getOrganization(
    input = {}
  ) {
    const organizationId =
      requiredIdentifier(
        input.organizationId,
        "organizationId"
      );

    const [
      organizationSnapshot,
      memberships
    ] =
      await Promise.all([
        db
          .doc(
            `organizacoes/${organizationId}`
          )
          .get(),

        loadMembershipsForOrganization(
          organizationId
        )
      ]);

    if (
      !organizationSnapshot.exists
    ) {
      throw new AdminOrganizationsReadError(
        "ADMIN_ORGANIZATION_NOT_FOUND",
        "Operational organization was not found."
      );
    }

    const responsible =
      selectResponsibleMembership(
        memberships,
        organizationId
      );

    let profile = null;

    if (responsible) {
      const profileSnapshot =
        await db
          .doc(
            `usuarios/${responsible.personId}`
          )
          .get();

      if (
        profileSnapshot.exists
      ) {
        profile =
          profileSnapshot.data() ||
          {};
      }
    }

    return Object.freeze({
      organization:
        buildOperationalOrganizationView({
          organizationId,

          organization:
            organizationSnapshot
              .data() ||
            {},

          memberships,

          responsibleSummary:
            buildResponsibleSummary(
              responsible,
              profile
            )
        })
    });
  }

  return Object.freeze({
    listOrganizations,
    getOrganization
  });
}

module.exports = {
  DEFAULT_ORGANIZATIONS_LIMIT,
  MAX_ORGANIZATIONS_LIMIT,
  ORGANIZATION_CURSOR_VERSION,
  ORGANIZATION_STATUS_FILTERS,

  AdminOrganizationsReadError,

  text,
  requiredIdentifier,
  readOrganizationsLimit,

  normalizeOrganizationStatusFilter,
  normalizeOrganizationNameQuery,
  normalizeOrganizationFilters,
  matchesOrganizationFilters,

  encodeOrganizationCursor,
  decodeOrganizationCursor,

  organizationMembershipCandidate,
  selectResponsibleMembership,
  buildResponsibleSummary,

  createAdminOrganizationsReadService
};
