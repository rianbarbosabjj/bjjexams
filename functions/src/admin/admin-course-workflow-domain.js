"use strict";

const {
  COURSE_STATUSES,
  CourseDomainError,
  validateCourseForStatus,
  assertCourseStatusTransition
} = require(
  "../courses/course-domain"
);

const ADMIN_COURSE_WORKFLOW_SCHEMA_VERSION =
  1;

const ADMIN_COURSE_WORKFLOW_TARGET_STATUSES =
  Object.freeze([
    "suspended",
    "published"
  ]);

const ADMIN_COURSE_WORKFLOW_ACTIONS =
  Object.freeze({
    suspended:
      "admin.course.suspended",

    published:
      "admin.course.reactivated"
  });

class AdminCourseWorkflowDomainError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminCourseWorkflowDomainError";

    this.code =
      code;
  }
}

function requiredWorkflowText(
  value,
  field,
  maxLength = 200
) {
  if (
    typeof value !==
      "string"
  ) {
    throw new AdminCourseWorkflowDomainError(
      "ADMIN_COURSE_WORKFLOW_INPUT_INVALID",
      `${field} is required.`
    );
  }

  const normalized =
    value.trim();

  if (
    !normalized ||
    normalized.length >
      maxLength
  ) {
    throw new AdminCourseWorkflowDomainError(
      "ADMIN_COURSE_WORKFLOW_INPUT_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function requiredWorkflowIdentifier(
  value,
  field
) {
  const normalized =
    requiredWorkflowText(
      value,
      field,
      128
    );

  if (
    normalized.includes("/")
  ) {
    throw new AdminCourseWorkflowDomainError(
      "ADMIN_COURSE_WORKFLOW_INPUT_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function normalizeWorkflowStatus(
  value,
  field = "status"
) {
  const normalized =
    requiredWorkflowText(
      value,
      field,
      40
    )
      .toLowerCase();

  if (
    !COURSE_STATUSES.includes(
      normalized
    )
  ) {
    throw new AdminCourseWorkflowDomainError(
      "ADMIN_COURSE_WORKFLOW_STATUS_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function normalizeWorkflowTargetStatus(
  value
) {
  const normalized =
    normalizeWorkflowStatus(
      value,
      "targetStatus"
    );

  if (
    !ADMIN_COURSE_WORKFLOW_TARGET_STATUSES
      .includes(
        normalized
      )
  ) {
    throw new AdminCourseWorkflowDomainError(
      "ADMIN_COURSE_WORKFLOW_TARGET_INVALID",
      "Administrative course workflow target is invalid."
    );
  }

  return normalized;
}

function workflowAction(
  targetStatus
) {
  const target =
    normalizeWorkflowTargetStatus(
      targetStatus
    );

  return ADMIN_COURSE_WORKFLOW_ACTIONS[
    target
  ];
}

function safeCourseObject(
  value
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    throw new AdminCourseWorkflowDomainError(
      "ADMIN_COURSE_WORKFLOW_COURSE_INVALID",
      "Course state is required."
    );
  }

  return value;
}

function validateCanonicalTransition(
  course,
  currentStatus,
  targetStatus
) {
  try {
    assertCourseStatusTransition(
      currentStatus,
      targetStatus
    );

    validateCourseForStatus(
      {
        ...course,
        status:
          targetStatus
      },
      targetStatus
    );
  }
  catch (error) {
    if (
      error instanceof
      CourseDomainError
    ) {
      throw new AdminCourseWorkflowDomainError(
        "ADMIN_COURSE_WORKFLOW_TRANSITION_INVALID",
        "Administrative course workflow transition is not allowed."
      );
    }

    throw error;
  }
}

function resolveAdminCourseWorkflowTransition(
  input = {}
) {
  const course =
    safeCourseObject(
      input.course
    );

  const currentStatus =
    normalizeWorkflowStatus(
      course.status,
      "currentStatus"
    );

  const targetStatus =
    normalizeWorkflowTargetStatus(
      input.targetStatus
    );

  const action =
    workflowAction(
      targetStatus
    );

  if (
    currentStatus ===
      targetStatus
  ) {
    return Object.freeze({
      currentStatus,
      targetStatus,
      action,

      idempotent:
        true
    });
  }

  const allowedOperationalPair =
    (
      currentStatus ===
        "published" &&
      targetStatus ===
        "suspended"
    ) ||
    (
      currentStatus ===
        "suspended" &&
      targetStatus ===
        "published"
    );

  if (!allowedOperationalPair) {
    throw new AdminCourseWorkflowDomainError(
      "ADMIN_COURSE_WORKFLOW_TRANSITION_INVALID",
      `Administrative transition from ${currentStatus} to ${targetStatus} is not allowed.`
    );
  }

  validateCanonicalTransition(
    course,
    currentStatus,
    targetStatus
  );

  return Object.freeze({
    currentStatus,
    targetStatus,
    action,

    idempotent:
      false
  });
}

function buildAdminCourseWorkflowAuditEvent(
  input = {}
) {
  const actorId =
    requiredWorkflowIdentifier(
      input.actorId,
      "actorId"
    );

  const actorRole =
    requiredWorkflowText(
      input.actorRole,
      "actorRole",
      80
    );

  const requestId =
    requiredWorkflowIdentifier(
      input.requestId,
      "requestId"
    );

  const courseId =
    requiredWorkflowIdentifier(
      input.courseId,
      "courseId"
    );

  const transition =
    input.transition;

  if (
    !transition ||
    typeof transition !==
      "object" ||
    Array.isArray(
      transition
    )
  ) {
    throw new AdminCourseWorkflowDomainError(
      "ADMIN_COURSE_WORKFLOW_AUDIT_INVALID",
      "Course workflow transition is required for audit."
    );
  }

  const currentStatus =
    normalizeWorkflowStatus(
      transition.currentStatus,
      "currentStatus"
    );

  const targetStatus =
    normalizeWorkflowTargetStatus(
      transition.targetStatus
    );

  const expectedAction =
    workflowAction(
      targetStatus
    );

  if (
    transition.action !==
      expectedAction
  ) {
    throw new AdminCourseWorkflowDomainError(
      "ADMIN_COURSE_WORKFLOW_AUDIT_INVALID",
      "Course workflow audit action does not match transition."
    );
  }

  if (
    transition.idempotent ===
      true
  ) {
    throw new AdminCourseWorkflowDomainError(
      "ADMIN_COURSE_WORKFLOW_AUDIT_IDEMPOTENT",
      "Idempotent workflow replay must not create an audit event."
    );
  }

  if (
    input.createdAt ===
      undefined ||
    input.createdAt ===
      null
  ) {
    throw new AdminCourseWorkflowDomainError(
      "ADMIN_COURSE_WORKFLOW_AUDIT_INVALID",
      "Audit createdAt is required."
    );
  }

  return Object.freeze({
    actorId,
    actorRole,

    action:
      expectedAction,

    entityType:
      "course",

    entityId:
      courseId,

    before:
      Object.freeze({
        status:
          currentStatus
      }),

    after:
      Object.freeze({
        status:
          targetStatus
      }),

    source:
      "function",

    requestId,

    createdAt:
      input.createdAt,

    metadata:
      Object.freeze({
        schemaVersion:
          ADMIN_COURSE_WORKFLOW_SCHEMA_VERSION
      })
  });
}

module.exports = {
  ADMIN_COURSE_WORKFLOW_SCHEMA_VERSION,
  ADMIN_COURSE_WORKFLOW_TARGET_STATUSES,
  ADMIN_COURSE_WORKFLOW_ACTIONS,

  AdminCourseWorkflowDomainError,

  requiredWorkflowText,
  requiredWorkflowIdentifier,

  normalizeWorkflowStatus,
  normalizeWorkflowTargetStatus,

  workflowAction,
  resolveAdminCourseWorkflowTransition,
  buildAdminCourseWorkflowAuditEvent
};
