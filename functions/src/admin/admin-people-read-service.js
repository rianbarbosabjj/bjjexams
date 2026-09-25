"use strict";

const {
  FieldPath
} = require(
  "firebase-admin/firestore"
);

const {
  buildOperationalPersonView
} = require(
  "./admin-directory-models"
);

const DEFAULT_PEOPLE_LIMIT = 20;
const MAX_PEOPLE_LIMIT = 25;
const PERSON_CURSOR_VERSION = 1;

const PEOPLE_PROFILE_FILTERS =
  Object.freeze([
    "student",
    "instructor"
  ]);

const PEOPLE_STATUS_FILTERS =
  Object.freeze([
    "active",
    "pending",
    "suspended",
    "inactive",
    "unknown"
  ]);

class AdminPeopleReadError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminPeopleReadError";

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
    throw new AdminPeopleReadError(
      "ADMIN_PEOPLE_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }

  return identifier;
}

function readPeopleLimit(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return DEFAULT_PEOPLE_LIMIT;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(
      parsed
    ) ||
    parsed < 1 ||
    parsed > MAX_PEOPLE_LIMIT
  ) {
    throw new AdminPeopleReadError(
      "ADMIN_PEOPLE_LIMIT_INVALID",
      `limit must be an integer between 1 and ${MAX_PEOPLE_LIMIT}.`
    );
  }

  return parsed;
}

function optionalPeopleFilter(
  value,
  allowedValues,
  field
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
    throw new AdminPeopleReadError(
      "ADMIN_PEOPLE_FILTER_INVALID",
      `${field} filter is invalid.`
    );
  }

  const normalized =
    value
      .trim()
      .toLowerCase();

  if (
    !allowedValues.includes(
      normalized
    )
  ) {
    throw new AdminPeopleReadError(
      "ADMIN_PEOPLE_FILTER_INVALID",
      `${field} filter is invalid.`
    );
  }

  return normalized;
}

function normalizePeopleFilters(
  input = {}
) {
  const profileType =
    optionalPeopleFilter(
      input.profileType,
      PEOPLE_PROFILE_FILTERS,
      "profileType"
    );

  const operationalStatus =
    optionalPeopleFilter(
      input.operationalStatus,
      PEOPLE_STATUS_FILTERS,
      "operationalStatus"
    );

  return Object.freeze({
    profileType,
    operationalStatus
  });
}

function matchesPeopleFilters(
  person,
  filters = {}
) {
  if (
    filters.profileType &&
    person?.profileType !==
      filters.profileType
  ) {
    return false;
  }

  if (
    filters.operationalStatus &&
    person?.operationalStatus !==
      filters.operationalStatus
  ) {
    return false;
  }

  return true;
}

function encodePersonCursor(
  personId
) {
  const normalized =
    requiredIdentifier(
      personId,
      "personId"
    );

  const payload =
    JSON.stringify({
      v:
        PERSON_CURSOR_VERSION,

      lastPersonId:
        normalized
    });

  return Buffer
    .from(
      payload,
      "utf8"
    )
    .toString(
      "base64url"
    );
}

function decodePersonCursor(
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
    throw new AdminPeopleReadError(
      "ADMIN_PEOPLE_CURSOR_INVALID",
      "People cursor is invalid."
    );
  }

  try {
    const decoded =
      Buffer
        .from(
          value,
          "base64url"
        )
        .toString(
          "utf8"
        );

    const parsed =
      JSON.parse(
        decoded
      );

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.v !==
        PERSON_CURSOR_VERSION
    ) {
      throw new Error(
        "invalid cursor payload"
      );
    }

    return requiredIdentifier(
      parsed.lastPersonId,
      "cursor.lastPersonId"
    );
  }
  catch (error) {
    if (
      error instanceof
      AdminPeopleReadError
    ) {
      throw error;
    }

    throw new AdminPeopleReadError(
      "ADMIN_PEOPLE_CURSOR_INVALID",
      "People cursor is invalid."
    );
  }
}

function membershipUserId(
  membership = {}
) {
  return text(
    membership.userId ||
    membership.usuario_id,
    128
  );
}

function createAdminPeopleReadService(
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
      "Admin people read service requires Firestore."
    );
  }

  async function loadMembershipsForPeople(
    personIds
  ) {
    if (
      !Array.isArray(
        personIds
      ) ||
      personIds.length === 0
    ) {
      return new Map();
    }

    if (
      personIds.length >
      MAX_PEOPLE_LIMIT
    ) {
      throw new AdminPeopleReadError(
        "ADMIN_PEOPLE_BATCH_INVALID",
        "People membership batch is too large."
      );
    }

    const allowedIds =
      new Set(
        personIds
      );

    const snapshot =
      await db
        .collection(
          "vinculos_organizacao"
        )
        .where(
          "usuario_id",
          "in",
          personIds
        )
        .get();

    const result =
      new Map(
        personIds.map(
          personId => [
            personId,
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

      const userId =
        membershipUserId(
          membership
        );

      if (
        !userId ||
        !allowedIds.has(
          userId
        )
      ) {
        throw new AdminPeopleReadError(
          "ADMIN_PEOPLE_CANONICAL_STATE_INVALID",
          "Membership query returned an unexpected person."
        );
      }

      result
        .get(userId)
        .push(
          membership
        );
    }

    return result;
  }

  async function loadMembershipsForPerson(
    personId
  ) {
    const snapshot =
      await db
        .collection(
          "vinculos_organizacao"
        )
        .where(
          "usuario_id",
          "==",
          personId
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

  async function listPeople(
    input = {}
  ) {
    const limit =
      readPeopleLimit(
        input.limit
      );

    const filters =
      normalizePeopleFilters(
        input
      );

    const afterPersonId =
      decodePersonCursor(
        input.cursor
      );

    let query =
      db
        .collection(
          "usuarios"
        )
        .orderBy(
          documentIdField
        );

    if (afterPersonId) {
      query =
        query.startAfter(
          afterPersonId
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

    const personIds =
      selectedDocs.map(
        document =>
          document.id
      );

    const membershipsByPerson =
      await loadMembershipsForPeople(
        personIds
      );

    const mappedItems =
      selectedDocs.map(
        document =>
          buildOperationalPersonView({
            personId:
              document.id,

            profile:
              document.data() ||
              {},

            memberships:
              membershipsByPerson
                .get(
                  document.id
                ) ||
              []
          })
      );

    const items =
      mappedItems.filter(
        person =>
          matchesPeopleFilters(
            person,
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
        ? encodePersonCursor(
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

  async function getPerson(
    input = {}
  ) {
    const personId =
      requiredIdentifier(
        input.personId,
        "personId"
      );

    const [
      profileSnapshot,
      memberships
    ] =
      await Promise.all([
        db
          .doc(
            `usuarios/${personId}`
          )
          .get(),

        loadMembershipsForPerson(
          personId
        )
      ]);

    if (
      !profileSnapshot.exists
    ) {
      throw new AdminPeopleReadError(
        "ADMIN_PERSON_NOT_FOUND",
        "Operational person was not found."
      );
    }

    return Object.freeze({
      person:
        buildOperationalPersonView({
          personId,

          profile:
            profileSnapshot
              .data() ||
            {},

          memberships
        })
    });
  }

  return Object.freeze({
    listPeople,
    getPerson
  });
}

module.exports = {
  DEFAULT_PEOPLE_LIMIT,
  MAX_PEOPLE_LIMIT,
  PERSON_CURSOR_VERSION,
  PEOPLE_PROFILE_FILTERS,
  PEOPLE_STATUS_FILTERS,

  AdminPeopleReadError,

  text,
  requiredIdentifier,
  readPeopleLimit,
  optionalPeopleFilter,
  normalizePeopleFilters,
  matchesPeopleFilters,
  encodePersonCursor,
  decodePersonCursor,
  membershipUserId,

  createAdminPeopleReadService
};
