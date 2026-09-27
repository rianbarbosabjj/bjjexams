"use strict";

const {
  FieldPath
} = require(
  "firebase-admin/firestore"
);

const {
  OFFICIAL_BELTS,
  EXAM_SESSION_STATUSES,
  normalizeBelt
} = require(
  "../exams/exam-session-domain"
);

const {
  EXAM_REGISTRATION_STATUSES
} = require(
  "../exams/exam-registration-domain"
);

const {
  EXAM_ATTEMPT_STATUSES
} = require(
  "../exams/exam-attempt-domain"
);

const {
  EXAM_RESULT_OUTCOMES
} = require(
  "../exams/exam-result-domain"
);

const {
  EXAM_CERTIFICATE_STATUSES
} = require(
  "../exams/exam-certificate-domain"
);

const {
  buildOperationalExamView
} = require(
  "./admin-exam-models"
);

const DEFAULT_EXAMS_LIMIT = 10;
const MAX_EXAMS_LIMIT = 10;
const EXAM_CURSOR_VERSION = 1;

class AdminExamsReadError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminExamsReadError";

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
    throw new AdminExamsReadError(
      "ADMIN_EXAMS_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }

  return identifier;
}

function readExamsLimit(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return DEFAULT_EXAMS_LIMIT;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(
      parsed
    ) ||
    parsed < 1 ||
    parsed > MAX_EXAMS_LIMIT
  ) {
    throw new AdminExamsReadError(
      "ADMIN_EXAMS_LIMIT_INVALID",
      `limit must be an integer between 1 and ${MAX_EXAMS_LIMIT}.`
    );
  }

  return parsed;
}

function optionalIdentifierFilter(
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

  return requiredIdentifier(
    value,
    field
  );
}

function optionalStatusFilter(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const normalized =
    text(
      value,
      40
    )
      ?.toLowerCase();

  if (
    !normalized ||
    !EXAM_SESSION_STATUSES.includes(
      normalized
    )
  ) {
    throw new AdminExamsReadError(
      "ADMIN_EXAMS_FILTER_INVALID",
      "status filter is invalid."
    );
  }

  return normalized;
}

function optionalTargetBeltFilter(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const normalized =
    normalizeBelt(
      value
    );

  if (!normalized) {
    throw new AdminExamsReadError(
      "ADMIN_EXAMS_FILTER_INVALID",
      "targetBelt filter is invalid."
    );
  }

  return normalized;
}

function normalizeExamFilters(
  input = {}
) {
  return Object.freeze({
    status:
      optionalStatusFilter(
        input.status
      ),

    organizationId:
      optionalIdentifierFilter(
        input.organizationId,
        "organizationId"
      ),

    targetBelt:
      optionalTargetBeltFilter(
        input.targetBelt
      )
  });
}

function matchesExamFilters(
  session,
  filters = {}
) {
  const safe =
    session &&
    typeof session ===
      "object" &&
    !Array.isArray(session)
      ? session
      : {};

  if (
    filters.status &&
    text(
      safe.status,
      40
    )?.toLowerCase() !==
      filters.status
  ) {
    return false;
  }

  if (
    filters.organizationId &&
    text(
      safe.organizationId,
      128
    ) !==
      filters.organizationId
  ) {
    return false;
  }

  if (
    filters.targetBelt &&
    normalizeBelt(
      safe.targetBelt
    ) !==
      filters.targetBelt
  ) {
    return false;
  }

  return true;
}

function encodeExamCursor(
  sessionId
) {
  const normalized =
    requiredIdentifier(
      sessionId,
      "sessionId"
    );

  return Buffer
    .from(
      JSON.stringify({
        v:
          EXAM_CURSOR_VERSION,

        lastSessionId:
          normalized
      }),
      "utf8"
    )
    .toString(
      "base64url"
    );
}

function decodeExamCursor(
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
    value.length > 512
  ) {
    throw new AdminExamsReadError(
      "ADMIN_EXAMS_CURSOR_INVALID",
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
        EXAM_CURSOR_VERSION
    ) {
      throw new Error(
        "version"
      );
    }

    return requiredIdentifier(
      decoded.lastSessionId,
      "lastSessionId"
    );
  }
  catch (_) {
    throw new AdminExamsReadError(
      "ADMIN_EXAMS_CURSOR_INVALID",
      "cursor is invalid."
    );
  }
}

function aggregateCountValue(
  snapshot,
  field
) {
  const raw =
    snapshot &&
    typeof snapshot.data ===
      "function"
      ? snapshot.data()?.count
      : undefined;

  const count =
    Number(raw);

  if (
    !Number.isSafeInteger(
      count
    ) ||
    count < 0
  ) {
    throw new AdminExamsReadError(
      "ADMIN_EXAMS_AGGREGATE_INVALID",
      `${field} aggregate is invalid.`
    );
  }

  return count;
}

async function countQuery(
  query,
  field
) {
  if (
    !query ||
    typeof query.count !==
      "function"
  ) {
    throw new AdminExamsReadError(
      "ADMIN_EXAMS_AGGREGATE_UNAVAILABLE",
      `${field} aggregate is unavailable.`
    );
  }

  const aggregate =
    await query
      .count()
      .get();

  return aggregateCountValue(
    aggregate,
    field
  );
}

function sessionQuery(
  db,
  collectionName,
  sessionId
) {
  return db
    .collection(
      collectionName
    )
    .where(
      "sessionId",
      "==",
      sessionId
    );
}

async function totalCountsForSession(
  db,
  sessionId
) {
  const [
    registrations,
    attempts,
    results,
    certificates
  ] =
    await Promise.all([
      countQuery(
        sessionQuery(
          db,
          "exam_registrations",
          sessionId
        ),
        "registrations.total"
      ),

      countQuery(
        sessionQuery(
          db,
          "exam_attempts",
          sessionId
        ),
        "attempts.total"
      ),

      countQuery(
        sessionQuery(
          db,
          "exam_results",
          sessionId
        ),
        "results.total"
      ),

      countQuery(
        sessionQuery(
          db,
          "exam_certificates",
          sessionId
        ),
        "certificates.total"
      )
    ]);

  return Object.freeze({
    registrationCounts: {
      total:
        registrations
    },

    attemptCounts: {
      total:
        attempts
    },

    resultCounts: {
      total:
        results
    },

    certificateCounts: {
      total:
        certificates
    }
  });
}

async function countByValues(
  db,
  collectionName,
  sessionId,
  field,
  values
) {
  const queries =
    [
      countQuery(
        sessionQuery(
          db,
          collectionName,
          sessionId
        ),
        `${collectionName}.total`
      ),

      ...values.map(
        value =>
          countQuery(
            sessionQuery(
              db,
              collectionName,
              sessionId
            )
              .where(
                field,
                "==",
                value
              ),
            `${collectionName}.${value}`
          )
      )
    ];

  const counts =
    await Promise.all(
      queries
    );

  const result = {
    total:
      counts[0]
  };

  values.forEach(
    (
      value,
      index
    ) => {
      result[value] =
        counts[
          index + 1
        ];
    }
  );

  return result;
}

async function detailedCountsForSession(
  db,
  sessionId
) {
  const [
    registrationCounts,
    attemptCounts,
    resultCounts,
    certificateCounts
  ] =
    await Promise.all([
      countByValues(
        db,
        "exam_registrations",
        sessionId,
        "status",
        EXAM_REGISTRATION_STATUSES
      ),

      countByValues(
        db,
        "exam_attempts",
        sessionId,
        "status",
        EXAM_ATTEMPT_STATUSES
      ),

      countByValues(
        db,
        "exam_results",
        sessionId,
        "outcome",
        EXAM_RESULT_OUTCOMES
      ),

      countByValues(
        db,
        "exam_certificates",
        sessionId,
        "status",
        EXAM_CERTIFICATE_STATUSES
      )
    ]);

  return Object.freeze({
    registrationCounts,
    attemptCounts,
    resultCounts,
    certificateCounts
  });
}

async function loadOrganizationMap(
  db,
  organizationIds
) {
  const ids =
    Array.from(
      new Set(
        organizationIds
          .filter(Boolean)
      )
    );

  const result =
    new Map();

  if (ids.length === 0) {
    return result;
  }

  if (
    typeof db.getAll !==
      "function"
  ) {
    throw new AdminExamsReadError(
      "ADMIN_EXAMS_BATCH_UNAVAILABLE",
      "Firestore batch read is unavailable."
    );
  }

  const refs =
    ids.map(
      id =>
        db.doc(
          `organizacoes/${id}`
        )
    );

  const snapshots =
    await db.getAll(
      ...refs
    );

  snapshots.forEach(
    snapshot => {
      const id =
        snapshot?.id ||
        snapshot?.ref?.id;

      if (!id) {
        return;
      }

      result.set(
        id,
        snapshot.exists ===
          true
          ? (
              snapshot.data() ||
              {}
            )
          : {}
      );
    }
  );

  return result;
}

function createAdminExamsReadService(
  dependencies = {}
) {
  const {
    db
  } = dependencies;

  if (
    !db ||
    typeof db.collection !==
      "function" ||
    typeof db.doc !==
      "function"
  ) {
    throw new TypeError(
      "Admin exams read service requires Firestore."
    );
  }

  async function listExams(
    input = {}
  ) {
    const limit =
      readExamsLimit(
        input.limit
      );

    const cursor =
      decodeExamCursor(
        input.cursor
      );

    const filters =
      normalizeExamFilters(
        input
      );

    let query =
      db
        .collection(
          "exam_sessions"
        )
        .orderBy(
          FieldPath.documentId()
        );

    if (cursor) {
      query =
        query.startAfter(
          cursor
        );
    }

    query =
      query.limit(
        limit + 1
      );

    const snapshot =
      await query.get();

    const rawDocuments =
      Array.isArray(
        snapshot?.docs
      )
        ? snapshot.docs
        : [];

    const scanned =
      rawDocuments.slice(
        0,
        limit
      );

    const hasMore =
      rawDocuments.length >
        limit;

    const selected =
      scanned.filter(
        document =>
          matchesExamFilters(
            document.data() ||
              {},
            filters
          )
      );

    const organizationIds =
      selected.map(
        document =>
          text(
            document.data()
              ?.organizationId,
            128
          )
      );

    const organizations =
      await loadOrganizationMap(
        db,
        organizationIds
      );

    const items =
      await Promise.all(
        selected.map(
          async document => {
            const session =
              document.data() ||
              {};

            const counts =
              await totalCountsForSession(
                db,
                document.id
              );

            return buildOperationalExamView({
              sessionId:
                document.id,

              session,

              organization:
                organizations.get(
                  session.organizationId
                ) ||
                {},

              summaryMode:
                "total",

              ...counts
            });
          }
        )
      );

    const lastScanned =
      scanned.length > 0
        ? scanned[
            scanned.length - 1
          ].id
        : null;

    return Object.freeze({
      limit,

      items,

      nextCursor:
        hasMore &&
        lastScanned
          ? encodeExamCursor(
              lastScanned
            )
          : null
    });
  }

  async function getExam(
    input = {}
  ) {
    const sessionId =
      requiredIdentifier(
        input.sessionId,
        "sessionId"
      );

    const sessionRef =
      db.doc(
        `exam_sessions/${sessionId}`
      );

    const sessionSnapshot =
      await sessionRef.get();

    if (
      !sessionSnapshot ||
      sessionSnapshot.exists !==
        true
    ) {
      throw new AdminExamsReadError(
        "ADMIN_EXAM_NOT_FOUND",
        "Operational exam session was not found."
      );
    }

    const session =
      sessionSnapshot.data() ||
      {};

    const organizationId =
      requiredIdentifier(
        session.organizationId,
        "organizationId"
      );

    const organizationMap =
      await loadOrganizationMap(
        db,
        [
          organizationId
        ]
      );

    const counts =
      await detailedCountsForSession(
        db,
        sessionId
      );

    return Object.freeze({
      exam:
        buildOperationalExamView({
          sessionId,
          session,

          organization:
            organizationMap.get(
              organizationId
            ) ||
            {},

          summaryMode:
            "full",

          ...counts
        })
    });
  }

  return Object.freeze({
    listExams,
    getExam
  });
}

module.exports = {
  DEFAULT_EXAMS_LIMIT,
  MAX_EXAMS_LIMIT,
  EXAM_CURSOR_VERSION,

  OFFICIAL_BELTS,

  AdminExamsReadError,

  text,
  requiredIdentifier,
  readExamsLimit,

  normalizeExamFilters,
  matchesExamFilters,

  encodeExamCursor,
  decodeExamCursor,

  aggregateCountValue,
  countQuery,
  totalCountsForSession,
  countByValues,
  detailedCountsForSession,
  loadOrganizationMap,

  createAdminExamsReadService
};
