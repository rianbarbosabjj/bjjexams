"use strict";

const {
  FieldPath
} = require(
  "firebase-admin/firestore"
);

const {
  AdminAuditModelError,
  requiredAuditIdentifier,
  normalizeAuditTargetIdentifier,
  auditTimestampMillis,
  normalizeAuditToken,
  normalizeCanonicalAuditEvent,
  buildOperationalAuditView
} = require(
  "./admin-audit-models"
);

const AUDIT_LOGS_COLLECTION =
  "audit_logs";

const DEFAULT_AUDIT_LIMIT =
  20;

const MAX_AUDIT_LIMIT =
  25;

const AUDIT_CURSOR_VERSION =
  1;

const AUDIT_SCAN_BATCH_SIZE =
  MAX_AUDIT_LIMIT + 1;

const AUDIT_MAX_SCAN_DOCS =
  AUDIT_SCAN_BATCH_SIZE * 10;

class AdminAuditReadError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminAuditReadError";

    this.code =
      code;
  }
}

function readAuditLimit(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return DEFAULT_AUDIT_LIMIT;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(
      parsed
    ) ||
    parsed < 1 ||
    parsed >
      MAX_AUDIT_LIMIT
  ) {
    throw new AdminAuditReadError(
      "ADMIN_AUDIT_LIMIT_INVALID",
      `limit must be an integer between 1 and ${MAX_AUDIT_LIMIT}.`
    );
  }

  return parsed;
}

function optionalAuditEventTypeFilter(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  try {
    return normalizeAuditToken(
      value,
      "eventType",
      {
        maxLength:
          160,
        lowercase:
          true
      }
    );
  }
  catch (
    error
  ) {
    throw new AdminAuditReadError(
      "ADMIN_AUDIT_FILTER_INVALID",
      "eventType filter is invalid."
    );
  }
}

function optionalAuditTargetTypeFilter(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  try {
    return normalizeAuditToken(
      value,
      "targetType",
      {
        maxLength:
          120,
        lowercase:
          true
      }
    );
  }
  catch (
    error
  ) {
    throw new AdminAuditReadError(
      "ADMIN_AUDIT_FILTER_INVALID",
      "targetType filter is invalid."
    );
  }
}

function optionalAuditIdentifierFilter(
  value,
  field
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  try {
    return requiredAuditIdentifier(
      value,
      field
    );
  }
  catch (
    error
  ) {
    throw new AdminAuditReadError(
      "ADMIN_AUDIT_FILTER_INVALID",
      `${field} filter is invalid.`
    );
  }
}

function optionalAuditTargetIdFilter(
  value,
  targetType
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  try {
    return normalizeAuditTargetIdentifier(
      value,
      targetType,
      "targetId"
    );
  }
  catch (
    error
  ) {
    throw new AdminAuditReadError(
      "ADMIN_AUDIT_FILTER_INVALID",
      "targetId filter is invalid."
    );
  }
}

function normalizeAuditFilters(
  input = {}
) {
  const targetType =
    optionalAuditTargetTypeFilter(
      input.targetType
    );

  return Object.freeze({
    eventType:
      optionalAuditEventTypeFilter(
        input.eventType
      ),

    actorUid:
      optionalAuditIdentifierFilter(
        input.actorUid,
        "actorUid"
      ),

    targetType,

    targetId:
      optionalAuditTargetIdFilter(
        input.targetId,
        targetType
      ),

    organizationId:
      optionalAuditIdentifierFilter(
        input.organizationId,
        "organizationId"
      )
  });
}

function matchesAuditFilters(
  normalized,
  filters = {}
) {
  if (
    filters.eventType &&
    normalized.eventType !==
      filters.eventType
  ) {
    return false;
  }

  if (
    filters.actorUid &&
    normalized.actorUid !==
      filters.actorUid
  ) {
    return false;
  }

  if (
    filters.targetType &&
    normalized.targetType !==
      filters.targetType
  ) {
    return false;
  }

  if (
    filters.targetId &&
    normalized.targetId !==
      filters.targetId
  ) {
    return false;
  }

  if (
    filters.organizationId &&
    normalized.organizationId !==
      filters.organizationId
  ) {
    return false;
  }

  return true;
}

function encodeAuditCursor(
  input = {}
) {
  let auditId;

  try {
    auditId =
      requiredAuditIdentifier(
        input.auditId,
        "auditId"
      );
  }
  catch (
    error
  ) {
    throw new AdminAuditReadError(
      "ADMIN_AUDIT_CURSOR_INVALID",
      "cursor is invalid."
    );
  }

  let createdAtMillis;

  try {
    createdAtMillis =
      auditTimestampMillis(
        input.createdAt,
        "createdAt"
      );
  }
  catch (
    error
  ) {
    throw new AdminAuditReadError(
      "ADMIN_AUDIT_CURSOR_INVALID",
      "cursor is invalid."
    );
  }

  return Buffer
    .from(
      JSON.stringify({
        v:
          AUDIT_CURSOR_VERSION,

        createdAtMillis,
        auditId
      }),
      "utf8"
    )
    .toString(
      "base64url"
    );
}

function decodeAuditCursor(
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
    typeof value !==
      "string" ||
    value.length >
      768
  ) {
    throw new AdminAuditReadError(
      "ADMIN_AUDIT_CURSOR_INVALID",
      "cursor is invalid."
    );
  }

  try {
    const decoded =
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
      decoded?.v !==
        AUDIT_CURSOR_VERSION ||
      !Number.isSafeInteger(
        decoded.createdAtMillis
      ) ||
      decoded.createdAtMillis < 0
    ) {
      throw new Error(
        "cursor"
      );
    }

    const auditId =
      requiredAuditIdentifier(
        decoded.auditId,
        "auditId"
      );

    return Object.freeze({
      createdAtMillis:
        decoded.createdAtMillis,

      auditId
    });
  }
  catch (
    error
  ) {
    throw new AdminAuditReadError(
      "ADMIN_AUDIT_CURSOR_INVALID",
      "cursor is invalid."
    );
  }
}

function canonicalAuditStateError(
  auditId,
  detail
) {
  return new AdminAuditReadError(
    "ADMIN_AUDIT_CANONICAL_STATE_INVALID",
    `Audit ${auditId} has inconsistent canonical state${detail ? `: ${detail}` : "."}`
  );
}

function normalizeAuditDocument(
  document
) {
  let auditId;

  try {
    auditId =
      requiredAuditIdentifier(
        document?.id,
        "auditId"
      );
  }
  catch (
    error
  ) {
    throw new AdminAuditReadError(
      "ADMIN_AUDIT_CANONICAL_STATE_INVALID",
      "Audit document identifier is invalid."
    );
  }

  try {
    return normalizeCanonicalAuditEvent({
      auditId,

      audit:
        document?.data?.() ||
        {}
    });
  }
  catch (
    error
  ) {
    if (
      error instanceof
      AdminAuditModelError
    ) {
      throw canonicalAuditStateError(
        auditId,
        error.code
      );
    }

    throw error;
  }
}

function buildAuditView(
  normalized
) {
  try {
    return buildOperationalAuditView({
      auditId:
        normalized.auditId,

      audit: {
        eventType:
          normalized.eventType,

        actorUid:
          normalized.actorUid,

        actorRole:
          normalized.actorRole,

        targetType:
          normalized.targetType,

        targetId:
          normalized.targetId,

        organizationId:
          normalized.organizationId,

        source:
          normalized.source,

        requestId:
          normalized.requestId,

        createdAt:
          normalized.createdAt,

        metadata:
          normalized.metadata
      }
    });
  }
  catch (
    error
  ) {
    if (
      error instanceof
      AdminAuditModelError
    ) {
      throw canonicalAuditStateError(
        normalized.auditId,
        error.code
      );
    }

    throw error;
  }
}

function createAdminAuditReadService(
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
      "function"
  ) {
    throw new TypeError(
      "Admin audit read service requires Firestore."
    );
  }

  async function listAuditEvents(
    input = {}
  ) {
    const limit =
      readAuditLimit(
        input.limit
      );

    const filters =
      normalizeAuditFilters(
        input
      );

    const cursor =
      decodeAuditCursor(
        input.cursor
      );

    const matched = [];

    let scanAfter =
      cursor;

    let resumeAfter =
      cursor;

    let scannedDocs =
      0;

    let sourceExhausted =
      false;

    let hasMoreMatches =
      false;

    while (
      !sourceExhausted &&
      !hasMoreMatches &&
      scannedDocs <
        AUDIT_MAX_SCAN_DOCS
    ) {
      const remainingBudget =
        AUDIT_MAX_SCAN_DOCS -
        scannedDocs;

      const batchLimit =
        Math.min(
          AUDIT_SCAN_BATCH_SIZE,
          remainingBudget
        );

      let query =
        db
          .collection(
            AUDIT_LOGS_COLLECTION
          )
          .orderBy(
            "createdAt",
            "desc"
          )
          .orderBy(
            documentIdField,
            "desc"
          );

      if (
        scanAfter
      ) {
        query =
          query.startAfter(
            new Date(
              scanAfter
                .createdAtMillis
            ),
            scanAfter.auditId
          );
      }

      const snapshot =
        await query
          .limit(
            batchLimit
          )
          .get();

      const documents =
        Array.isArray(
          snapshot?.docs
        )
          ? snapshot.docs
          : [];

      if (
        documents.length ===
        0
      ) {
        sourceExhausted =
          true;

        break;
      }

      scannedDocs +=
        documents.length;

      for (
        const document
        of documents
      ) {
        const normalized =
          normalizeAuditDocument(
            document
          );

        const matches =
          matchesAuditFilters(
            normalized,
            filters
          );

        if (
          matches &&
          matched.length >=
            limit
        ) {
          hasMoreMatches =
            true;

          break;
        }

        if (
          matches
        ) {
          matched.push(
            normalized
          );
        }

        resumeAfter =
          Object.freeze({
            createdAtMillis:
              normalized
                .createdAtMillis,

            auditId:
              normalized.auditId
          });
      }

      if (
        hasMoreMatches
      ) {
        break;
      }

      if (
        documents.length <
          batchLimit
      ) {
        sourceExhausted =
          true;

        break;
      }

      scanAfter =
        resumeAfter;
    }

    const scanLimitReached =
      !sourceExhausted &&
      !hasMoreMatches &&
      scannedDocs >=
        AUDIT_MAX_SCAN_DOCS;

    const shouldContinue =
      hasMoreMatches ||
      scanLimitReached;

    const items =
      Object.freeze(
        matched.map(
          buildAuditView
        )
      );

    return Object.freeze({
      limit,
      items,

      nextCursor:
        shouldContinue &&
        resumeAfter
          ? encodeAuditCursor({
              auditId:
                resumeAfter
                  .auditId,

              createdAt:
                new Date(
                  resumeAfter
                    .createdAtMillis
                )
            })
          : null
    });
  }

  return Object.freeze({
    listAuditEvents
  });
}

module.exports = {
  AUDIT_LOGS_COLLECTION,

  DEFAULT_AUDIT_LIMIT,
  MAX_AUDIT_LIMIT,
  AUDIT_CURSOR_VERSION,
  AUDIT_SCAN_BATCH_SIZE,
  AUDIT_MAX_SCAN_DOCS,

  AdminAuditReadError,

  readAuditLimit,
  optionalAuditEventTypeFilter,
  optionalAuditTargetTypeFilter,
  optionalAuditIdentifierFilter,
  optionalAuditTargetIdFilter,
  normalizeAuditFilters,
  matchesAuditFilters,

  encodeAuditCursor,
  decodeAuditCursor,

  canonicalAuditStateError,
  normalizeAuditDocument,
  buildAuditView,

  createAdminAuditReadService
};
