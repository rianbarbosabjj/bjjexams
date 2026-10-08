"use strict";

const {
  FieldPath
} = require(
  "firebase-admin/firestore"
);

const {
  COURSE_OWNER_TYPES,
  COURSE_VISIBILITIES,
  COURSE_STATUSES
} = require(
  "../courses/course-domain"
);

const {
  ENROLLMENT_STATUSES
} = require(
  "../courses/course-enrollment-domain"
);

const {
  MODERATION_DECISIONS
} = require(
  "../courses/course-moderation-policy"
);

const {
  cleanText
} = require(
  "./admin-directory-models"
);

const {
  normalizeCanonicalToken,
  normalizeCourseModerationStatus,
  buildCourseEnrollmentSummaryFromCounts,
  buildOperationalCourseView
} = require(
  "./admin-course-models"
);

const DEFAULT_COURSES_LIMIT = 10;
const MAX_COURSES_LIMIT = 10;
const COURSE_CURSOR_VERSION = 1;

const COURSE_MODERATION_FILTERS =
  Object.freeze([
    "processing",
    ...MODERATION_DECISIONS
  ]);

class AdminCoursesReadError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminCoursesReadError";

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
    throw new AdminCoursesReadError(
      "ADMIN_COURSES_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }

  return identifier;
}

function readCoursesLimit(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return DEFAULT_COURSES_LIMIT;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(
      parsed
    ) ||
    parsed < 1 ||
    parsed > MAX_COURSES_LIMIT
  ) {
    throw new AdminCoursesReadError(
      "ADMIN_COURSES_LIMIT_INVALID",
      `limit must be an integer between 1 and ${MAX_COURSES_LIMIT}.`
    );
  }

  return parsed;
}

function optionalCourseFilter(
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
    typeof value !==
    "string"
  ) {
    throw new AdminCoursesReadError(
      "ADMIN_COURSES_FILTER_INVALID",
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
    throw new AdminCoursesReadError(
      "ADMIN_COURSES_FILTER_INVALID",
      `${field} filter is invalid.`
    );
  }

  return normalized;
}

function normalizeCourseFilters(
  input = {}
) {
  return Object.freeze({
    workflowStatus:
      optionalCourseFilter(
        input.workflowStatus,
        COURSE_STATUSES,
        "workflowStatus"
      ),

    ownerType:
      optionalCourseFilter(
        input.ownerType,
        COURSE_OWNER_TYPES,
        "ownerType"
      ),

    visibility:
      optionalCourseFilter(
        input.visibility,
        COURSE_VISIBILITIES,
        "visibility"
      ),

    moderationStatus:
      optionalCourseFilter(
        input.moderationStatus,
        COURSE_MODERATION_FILTERS,
        "moderationStatus"
      )
  });
}

function matchesCourseFilters(
  course,
  filters = {}
) {
  const safeCourse =
    course &&
    typeof course ===
      "object" &&
    !Array.isArray(course)
      ? course
      : {};

  if (
    filters.workflowStatus &&
    normalizeCanonicalToken(
      safeCourse.status,
      COURSE_STATUSES
    ) !==
      filters.workflowStatus
  ) {
    return false;
  }

  if (
    filters.ownerType &&
    normalizeCanonicalToken(
      safeCourse.ownerType,
      COURSE_OWNER_TYPES
    ) !==
      filters.ownerType
  ) {
    return false;
  }

  if (
    filters.visibility &&
    normalizeCanonicalToken(
      safeCourse.visibility,
      COURSE_VISIBILITIES
    ) !==
      filters.visibility
  ) {
    return false;
  }

  if (
    filters.moderationStatus &&
    normalizeCourseModerationStatus(
      safeCourse
    ) !==
      filters.moderationStatus
  ) {
    return false;
  }

  return true;
}

function encodeCourseCursor(
  courseId
) {
  const normalized =
    requiredIdentifier(
      courseId,
      "courseId"
    );

  return Buffer
    .from(
      JSON.stringify({
        v:
          COURSE_CURSOR_VERSION,

        lastCourseId:
          normalized
      }),
      "utf8"
    )
    .toString(
      "base64url"
    );
}

function decodeCourseCursor(
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
    throw new AdminCoursesReadError(
      "ADMIN_COURSES_CURSOR_INVALID",
      "Course cursor is invalid."
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
      typeof parsed !==
        "object" ||
      Array.isArray(parsed) ||
      parsed.v !==
        COURSE_CURSOR_VERSION
    ) {
      throw new Error(
        "invalid cursor"
      );
    }

    return requiredIdentifier(
      parsed.lastCourseId,
      "cursor.lastCourseId"
    );
  }
  catch (error) {
    if (
      error instanceof
      AdminCoursesReadError
    ) {
      throw error;
    }

    throw new AdminCoursesReadError(
      "ADMIN_COURSES_CURSOR_INVALID",
      "Course cursor is invalid."
    );
  }
}

function ownerDescriptor(
  course = {}
) {
  const ownerType =
    normalizeCanonicalToken(
      course.ownerType,
      COURSE_OWNER_TYPES
    );

  if (
    !ownerType ||
    ownerType ===
      "platform"
  ) {
    return null;
  }

  const ownerId =
    cleanText(
      course.ownerId,
      128
    );

  if (
    !ownerId ||
    ownerId.includes("/")
  ) {
    return null;
  }

  const collection =
    ownerType === "user"
      ? "usuarios"
      : "organizacoes";

  return Object.freeze({
    ownerType,
    ownerId,

    key:
      `${ownerType}:${ownerId}`,

    path:
      `${collection}/${ownerId}`
  });
}

function ownerDisplayName(
  ownerType,
  data = {}
) {
  const safeData =
    data &&
    typeof data ===
      "object" &&
    !Array.isArray(data)
      ? data
      : {};

  if (
    ownerType === "user"
  ) {
    return cleanText(
      safeData.displayName ||
      safeData.nome ||
      safeData.name ||
      safeData.nome_completo,
      180
    );
  }

  if (
    ownerType ===
    "organization"
  ) {
    return cleanText(
      safeData.name ||
      safeData.nome ||
      safeData.nome_equipe ||
      safeData.nome_fantasia,
      180
    );
  }

  return null;
}

function readAggregateCount(
  snapshot,
  field
) {
  const data =
    snapshot &&
    typeof snapshot.data ===
      "function"
      ? snapshot.data()
      : null;

  const count =
    Number(
      data?.count
    );

  if (
    !Number.isSafeInteger(
      count
    ) ||
    count < 0
  ) {
    throw new AdminCoursesReadError(
      "ADMIN_COURSES_AGGREGATE_INVALID",
      `${field} aggregate is invalid.`
    );
  }

  return count;
}

function createAdminCoursesReadService(
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
      "function" ||
    typeof db.getAll !==
      "function"
  ) {
    throw new TypeError(
      "Admin courses read service requires Firestore."
    );
  }

  async function loadOwnerSummaries(
    courses
  ) {
    if (
      !Array.isArray(courses) ||
      courses.length === 0
    ) {
      return new Map();
    }

    const descriptorMap =
      new Map();

    for (
      const course
      of courses
    ) {
      const descriptor =
        ownerDescriptor(
          course
        );

      if (descriptor) {
        descriptorMap.set(
          descriptor.key,
          descriptor
        );
      }
    }

    const descriptors =
      Array.from(
        descriptorMap.values()
      );

    if (
      descriptors.length === 0
    ) {
      return new Map();
    }

    if (
      descriptors.length >
      MAX_COURSES_LIMIT
    ) {
      throw new AdminCoursesReadError(
        "ADMIN_COURSES_BATCH_INVALID",
        "Course owner batch is too large."
      );
    }

    const refs =
      descriptors.map(
        descriptor =>
          db.doc(
            descriptor.path
          )
      );

    const snapshots =
      await db.getAll(
        ...refs
      );

    if (
      !Array.isArray(snapshots) ||
      snapshots.length !==
        descriptors.length
    ) {
      throw new AdminCoursesReadError(
        "ADMIN_COURSES_CANONICAL_STATE_INVALID",
        "Course owner batch returned an unexpected result."
      );
    }

    const result =
      new Map();

    for (
      let index = 0;
      index <
      descriptors.length;
      index += 1
    ) {
      const descriptor =
        descriptors[index];

      const snapshot =
        snapshots[index];

      const data =
        snapshot?.exists === true
          ? snapshot.data() ||
            {}
          : {};

      result.set(
        descriptor.key,
        Object.freeze({
          ownerId:
            descriptor.ownerId,

          displayName:
            ownerDisplayName(
              descriptor.ownerType,
              data
            )
        })
      );
    }

    return result;
  }

  function resolveOwnerSummary(
    course,
    ownerSummaries
  ) {
    const descriptor =
      ownerDescriptor(
        course
      );

    if (!descriptor) {
      return null;
    }

    return (
      ownerSummaries.get(
        descriptor.key
      ) ||
      Object.freeze({
        ownerId:
          descriptor.ownerId,

        displayName:
          null
      })
    );
  }

  async function loadEnrollmentSummary(
    courseId
  ) {
    const normalizedCourseId =
      requiredIdentifier(
        courseId,
        "courseId"
      );

    const baseQuery =
      db
        .collection(
          "enrollments"
        )
        .where(
          "courseId",
          "==",
          normalizedCourseId
        );

    if (
      typeof baseQuery.count !==
        "function"
    ) {
      throw new AdminCoursesReadError(
        "ADMIN_COURSES_AGGREGATE_UNAVAILABLE",
        "Enrollment aggregate query is unavailable."
      );
    }

    const queries = [
      {
        field:
          "total",

        query:
          baseQuery
      },

      ...ENROLLMENT_STATUSES
        .map(
          status => ({
            field:
              status,

            query:
              baseQuery.where(
                "status",
                "==",
                status
              )
          })
        )
    ];

    const snapshots =
      await Promise.all(
        queries.map(
          item =>
            item
              .query
              .count()
              .get()
        )
      );

    const counts = {};

    for (
      let index = 0;
      index <
      queries.length;
      index += 1
    ) {
      const field =
        queries[index]
          .field;

      counts[field] =
        readAggregateCount(
          snapshots[index],
          field
        );
    }

    try {
      return (
        buildCourseEnrollmentSummaryFromCounts(
          counts
        )
      );
    }
    catch (_) {
      throw new AdminCoursesReadError(
        "ADMIN_COURSES_AGGREGATE_INVALID",
        "Enrollment aggregates are inconsistent."
      );
    }
  }

  async function listCourses(
    input = {}
  ) {
    const limit =
      readCoursesLimit(
        input.limit
      );

    const filters =
      normalizeCourseFilters(
        input
      );

    const afterCourseId =
      decodeCourseCursor(
        input.cursor
      );

    let query =
      db
        .collection(
          "courses"
        )
        .orderBy(
          documentIdField
        );

    if (afterCourseId) {
      query =
        query.startAfter(
          afterCourseId
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

    const filteredDocs =
      selectedDocs.filter(
        document =>
          matchesCourseFilters(
            document.data() ||
            {},
            filters
          )
      );

    const courseData =
      filteredDocs.map(
        document =>
          document.data() ||
          {}
      );

    const [
      ownerSummaries,
      enrollmentSummaries
    ] =
      await Promise.all([
        loadOwnerSummaries(
          courseData
        ),

        Promise.all(
          filteredDocs.map(
            document =>
              loadEnrollmentSummary(
                document.id
              )
          )
        )
      ]);

    const items =
      filteredDocs.map(
        (
          document,
          index
        ) => {
          const course =
            document.data() ||
            {};

          return buildOperationalCourseView({
            courseId:
              document.id,

            course,

            ownerSummary:
              resolveOwnerSummary(
                course,
                ownerSummaries
              ),

            enrollmentSummary:
              enrollmentSummaries[
                index
              ]
          });
        }
      );

    const lastScanned =
      selectedDocs[
        selectedDocs.length - 1
      ];

    const nextCursor =
      hasMore &&
      lastScanned
        ? encodeCourseCursor(
            lastScanned.id
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

  async function getCourse(
    input = {}
  ) {
    const courseId =
      requiredIdentifier(
        input.courseId,
        "courseId"
      );

    const snapshot =
      await db
        .doc(
          `courses/${courseId}`
        )
        .get();

    if (
      !snapshot ||
      snapshot.exists !== true
    ) {
      throw new AdminCoursesReadError(
        "ADMIN_COURSE_NOT_FOUND",
        "Operational course was not found."
      );
    }

    const course =
      snapshot.data() ||
      {};

    const [
      ownerSummaries,
      enrollmentSummary
    ] =
      await Promise.all([
        loadOwnerSummaries([
          course
        ]),

        loadEnrollmentSummary(
          courseId
        )
      ]);

    return Object.freeze({
      course:
        buildOperationalCourseView({
          courseId,
          course,

          ownerSummary:
            resolveOwnerSummary(
              course,
              ownerSummaries
            ),

          enrollmentSummary
        })
    });
  }

  return Object.freeze({
    listCourses,
    getCourse
  });
}

module.exports = {
  DEFAULT_COURSES_LIMIT,
  MAX_COURSES_LIMIT,
  COURSE_CURSOR_VERSION,
  COURSE_MODERATION_FILTERS,

  AdminCoursesReadError,

  text,
  requiredIdentifier,
  readCoursesLimit,
  optionalCourseFilter,
  normalizeCourseFilters,
  matchesCourseFilters,

  encodeCourseCursor,
  decodeCourseCursor,

  ownerDescriptor,
  ownerDisplayName,
  readAggregateCount,

  createAdminCoursesReadService
};
