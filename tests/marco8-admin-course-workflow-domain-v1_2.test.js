"use strict";

const assert =
  require("assert");

const {
  ADMIN_COURSE_WORKFLOW_SCHEMA_VERSION,
  ADMIN_COURSE_WORKFLOW_TARGET_STATUSES,
  ADMIN_COURSE_WORKFLOW_ACTIONS,
  AdminCourseWorkflowDomainError,
  requiredWorkflowIdentifier,
  normalizeWorkflowTargetStatus,
  workflowAction,
  resolveAdminCourseWorkflowTransition,
  buildAdminCourseWorkflowAuditEvent
} = require(
  "../functions/src/admin/admin-course-workflow-domain"
);

function publishedCourse(
  overrides = {}
) {
  return {
    title:
      "Curso operacional",

    description:
      "Descricao suficientemente longa para publicacao.",

    ownerType:
      "platform",

    ownerId:
      null,

    instructorIds: [
      "instructor-1"
    ],

    visibility:
      "platform",

    organizationId:
      null,

    status:
      "published",

    isPaid:
      false,

    priceCents:
      0,

    currency:
      "BRL",

    financialRuleId:
      null,

    publishedAt:
      "existing-published-at",

    ...overrides
  };
}

function main() {
  assert.strictEqual(
    ADMIN_COURSE_WORKFLOW_SCHEMA_VERSION,
    1
  );

  assert.deepStrictEqual(
    ADMIN_COURSE_WORKFLOW_TARGET_STATUSES,
    [
      "suspended",
      "published"
    ]
  );

  assert.deepStrictEqual(
    ADMIN_COURSE_WORKFLOW_ACTIONS,
    {
      suspended:
        "admin.course.suspended",

      published:
        "admin.course.reactivated"
    }
  );

  assert.strictEqual(
    requiredWorkflowIdentifier(
      " course-1 ",
      "courseId"
    ),
    "course-1"
  );

  assert.throws(
    () =>
      requiredWorkflowIdentifier(
        "courses/course-1",
        "courseId"
      ),
    error =>
      error instanceof
        AdminCourseWorkflowDomainError &&
      error.code ===
        "ADMIN_COURSE_WORKFLOW_INPUT_INVALID"
  );

  assert.strictEqual(
    normalizeWorkflowTargetStatus(
      " SUSPENDED "
    ),
    "suspended"
  );

  assert.throws(
    () =>
      normalizeWorkflowTargetStatus(
        "review"
      ),
    error =>
      error instanceof
        AdminCourseWorkflowDomainError &&
      error.code ===
        "ADMIN_COURSE_WORKFLOW_TARGET_INVALID"
  );

  assert.strictEqual(
    workflowAction(
      "suspended"
    ),
    "admin.course.suspended"
  );

  assert.strictEqual(
    workflowAction(
      "published"
    ),
    "admin.course.reactivated"
  );

  const suspension =
    resolveAdminCourseWorkflowTransition({
      course:
        publishedCourse(),

      targetStatus:
        "suspended"
    });

  assert.deepStrictEqual(
    suspension,
    {
      currentStatus:
        "published",

      targetStatus:
        "suspended",

      action:
        "admin.course.suspended",

      idempotent:
        false
    }
  );

  const reactivation =
    resolveAdminCourseWorkflowTransition({
      course:
        publishedCourse({
          status:
            "suspended"
        }),

      targetStatus:
        "published"
    });

  assert.deepStrictEqual(
    reactivation,
    {
      currentStatus:
        "suspended",

      targetStatus:
        "published",

      action:
        "admin.course.reactivated",

      idempotent:
        false
    }
  );

  const suspensionReplay =
    resolveAdminCourseWorkflowTransition({
      course:
        publishedCourse({
          status:
            "suspended"
        }),

      targetStatus:
        "suspended"
    });

  assert.strictEqual(
    suspensionReplay.idempotent,
    true
  );

  const reactivationReplay =
    resolveAdminCourseWorkflowTransition({
      course:
        publishedCourse(),

      targetStatus:
        "published"
    });

  assert.strictEqual(
    reactivationReplay.idempotent,
    true
  );

  // Review -> published belongs to the moderation decision path.
  assert.throws(
    () =>
      resolveAdminCourseWorkflowTransition({
        course:
          publishedCourse({
            status:
              "review"
          }),

        targetStatus:
          "published"
      }),
    error =>
      error instanceof
        AdminCourseWorkflowDomainError &&
      error.code ===
        "ADMIN_COURSE_WORKFLOW_TRANSITION_INVALID"
  );

  // Draft cannot be suspended by the operational command.
  assert.throws(
    () =>
      resolveAdminCourseWorkflowTransition({
        course:
          publishedCourse({
            status:
              "draft"
          }),

        targetStatus:
          "suspended"
      }),
    error =>
      error instanceof
        AdminCourseWorkflowDomainError &&
      error.code ===
        "ADMIN_COURSE_WORKFLOW_TRANSITION_INVALID"
  );

  // Archived remains terminal.
  assert.throws(
    () =>
      resolveAdminCourseWorkflowTransition({
        course:
          publishedCourse({
            status:
              "archived"
          }),

        targetStatus:
          "published"
      }),
    error =>
      error instanceof
        AdminCourseWorkflowDomainError &&
      error.code ===
        "ADMIN_COURSE_WORKFLOW_TRANSITION_INVALID"
  );

  // Reactivation still obeys canonical published-course validation.
  assert.throws(
    () =>
      resolveAdminCourseWorkflowTransition({
        course:
          publishedCourse({
            status:
              "suspended",

            description:
              "curta"
          }),

        targetStatus:
          "published"
      }),
    error =>
      error instanceof
        AdminCourseWorkflowDomainError &&
      error.code ===
        "ADMIN_COURSE_WORKFLOW_TRANSITION_INVALID"
  );

  const audit =
    buildAdminCourseWorkflowAuditEvent({
      actorId:
        "admin-1",

      actorRole:
        "content_admin",

      requestId:
        "request-1",

      courseId:
        "course-1",

      transition:
        suspension,

      createdAt:
        "server-time"
    });

  assert.deepStrictEqual(
    audit,
    {
      actorId:
        "admin-1",

      actorRole:
        "content_admin",

      action:
        "admin.course.suspended",

      entityType:
        "course",

      entityId:
        "course-1",

      before: {
        status:
          "published"
      },

      after: {
        status:
          "suspended"
      },

      source:
        "function",

      requestId:
        "request-1",

      createdAt:
        "server-time",

      metadata: {
        schemaVersion:
          1
      }
    }
  );

  assert.strictEqual(
    JSON.stringify(audit)
      .includes(
        "description"
      ),
    false
  );

  assert.throws(
    () =>
      buildAdminCourseWorkflowAuditEvent({
        actorId:
          "admin-1",

        actorRole:
          "content_admin",

        requestId:
          "request-1",

        courseId:
          "course-1",

        transition:
          suspensionReplay,

        createdAt:
          "server-time"
      }),
    error =>
      error instanceof
        AdminCourseWorkflowDomainError &&
      error.code ===
        "ADMIN_COURSE_WORKFLOW_AUDIT_IDEMPOTENT"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_SCHEMA_VERSION=1"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_TARGETS=2/2"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_PUBLISHED_TO_SUSPENDED=PASSED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_SUSPENDED_TO_PUBLISHED=PASSED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_REVIEW_TO_PUBLISHED=BLOCKED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_ARCHIVED_REACTIVATION=BLOCKED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_CANONICAL_VALIDATION=PASSED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_IDEMPOTENCY=PASSED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_AUDIT_SANITIZATION=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_COURSE_WORKFLOW_DOMAIN=PASSED"
  );
}

main();
