"use strict";

const {
  cleanText
} = require(
  "./admin-directory-models"
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

const COURSE_VIEW_FIELDS =
  Object.freeze([
    "courseId",
    "title",
    "ownerType",
    "ownerSummary",
    "visibility",
    "workflowStatus",
    "moderationStatus",
    "enrollmentSummary"
  ]);

const COURSE_OWNER_SUMMARY_FIELDS =
  Object.freeze([
    "ownerId",
    "displayName"
  ]);

const COURSE_ENROLLMENT_SUMMARY_FIELDS =
  Object.freeze([
    "total",
    "active",
    "completed",
    "cancelled",
    "refunded",
    "chargeback"
  ]);

function safeObject(
  value
) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
}

function normalizeCanonicalToken(
  value,
  allowed
) {
  const token =
    cleanText(
      value,
      80
    );

  if (!token) {
    return null;
  }

  const normalized =
    token.toLowerCase();

  return allowed.includes(
    normalized
  )
    ? normalized
    : null;
}

function buildCourseOwnerSummary(
  input = {}
) {
  const course =
    safeObject(
      input.course
    );

  const ownerSummary =
    safeObject(
      input.ownerSummary
    );

  const ownerType =
    normalizeCanonicalToken(
      course.ownerType,
      COURSE_OWNER_TYPES
    );

  if (
    !ownerType ||
    ownerType === "platform"
  ) {
    return null;
  }

  const ownerId =
    cleanText(
      course.ownerId ||
      ownerSummary.ownerId ||
      ownerSummary.userId ||
      ownerSummary.organizationId,
      128
    );

  const displayName =
    cleanText(
      ownerSummary.displayName ||
      ownerSummary.name ||
      ownerSummary.nome ||
      ownerSummary.organizationName ||
      ownerSummary.nome_equipe,
      180
    );

  if (
    !ownerId &&
    !displayName
  ) {
    return null;
  }

  return Object.freeze({
    ownerId,
    displayName
  });
}

function normalizeCourseModerationStatus(
  courseInput
) {
  const course =
    safeObject(
      courseInput
    );

  const pending =
    safeObject(
      course.moderationPending
    );

  const pendingState =
    cleanText(
      pending.state,
      80
    );

  if (
    pendingState &&
    pendingState
      .toLowerCase() ===
      "processing"
  ) {
    return "processing";
  }

  const moderation =
    safeObject(
      course.moderation
    );

  return normalizeCanonicalToken(
    moderation.status,
    MODERATION_DECISIONS
  );
}

function buildCourseEnrollmentSummary(
  enrollments = []
) {
  const records =
    Array.isArray(
      enrollments
    )
      ? enrollments.filter(
          value =>
            value &&
            typeof value ===
              "object" &&
            !Array.isArray(value)
        )
      : [];

  const counts = {
    total:
      records.length,

    active:
      0,

    completed:
      0,

    cancelled:
      0,

    refunded:
      0,

    chargeback:
      0
  };

  for (
    const enrollment
    of records
  ) {
    const status =
      normalizeCanonicalToken(
        enrollment.status,
        ENROLLMENT_STATUSES
      );

    if (
      status &&
      Object.prototype
        .hasOwnProperty.call(
          counts,
          status
        )
    ) {
      counts[
        status
      ] += 1;
    }
  }

  return Object.freeze(
    counts
  );
}

function normalizeEnrollmentSummaryCount(
  value,
  field
) {
  const parsed =
    Number(
      value ?? 0
    );

  if (
    !Number.isSafeInteger(
      parsed
    ) ||
    parsed < 0
  ) {
    throw new Error(
      `ADMIN_COURSE_ENROLLMENT_SUMMARY_INVALID:${field}`
    );
  }

  return parsed;
}

function buildCourseEnrollmentSummaryFromCounts(
  input = {}
) {
  const source =
    safeObject(
      input
    );

  const counts = {
    total:
      normalizeEnrollmentSummaryCount(
        source.total,
        "total"
      ),

    active:
      normalizeEnrollmentSummaryCount(
        source.active,
        "active"
      ),

    completed:
      normalizeEnrollmentSummaryCount(
        source.completed,
        "completed"
      ),

    cancelled:
      normalizeEnrollmentSummaryCount(
        source.cancelled,
        "cancelled"
      ),

    refunded:
      normalizeEnrollmentSummaryCount(
        source.refunded,
        "refunded"
      ),

    chargeback:
      normalizeEnrollmentSummaryCount(
        source.chargeback,
        "chargeback"
      )
  };

  const canonicalCount =
    counts.active +
    counts.completed +
    counts.cancelled +
    counts.refunded +
    counts.chargeback;

  if (
    canonicalCount >
    counts.total
  ) {
    throw new Error(
      "ADMIN_COURSE_ENROLLMENT_SUMMARY_INVALID:total"
    );
  }

  return Object.freeze(
    counts
  );
}

function buildOperationalCourseView(
  input = {}
) {
  const courseId =
    cleanText(
      input.courseId,
      128
    );

  if (!courseId) {
    throw new Error(
      "ADMIN_COURSE_ID_REQUIRED"
    );
  }

  const course =
    safeObject(
      input.course
    );

  const ownerType =
    normalizeCanonicalToken(
      course.ownerType,
      COURSE_OWNER_TYPES
    );

  return Object.freeze({
    courseId,

    title:
      cleanText(
        course.title,
        160
      ),

    ownerType,

    ownerSummary:
      buildCourseOwnerSummary({
        course,
        ownerSummary:
          input.ownerSummary
      }),

    visibility:
      normalizeCanonicalToken(
        course.visibility,
        COURSE_VISIBILITIES
      ),

    workflowStatus:
      normalizeCanonicalToken(
        course.status,
        COURSE_STATUSES
      ),

    moderationStatus:
      normalizeCourseModerationStatus(
        course
      ),

    enrollmentSummary:
      Object.prototype
        .hasOwnProperty.call(
          input,
          "enrollmentSummary"
        )
        ? buildCourseEnrollmentSummaryFromCounts(
            input.enrollmentSummary
          )
        : buildCourseEnrollmentSummary(
            input.enrollments
          )
  });
}

module.exports = {
  COURSE_VIEW_FIELDS,
  COURSE_OWNER_SUMMARY_FIELDS,
  COURSE_ENROLLMENT_SUMMARY_FIELDS,

  safeObject,
  normalizeCanonicalToken,

  buildCourseOwnerSummary,
  normalizeCourseModerationStatus,
  buildCourseEnrollmentSummary,
  normalizeEnrollmentSummaryCount,
  buildCourseEnrollmentSummaryFromCounts,
  buildOperationalCourseView
};
