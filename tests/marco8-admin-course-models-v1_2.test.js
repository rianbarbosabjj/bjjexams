"use strict";

const assert =
  require("assert");

const {
  COURSE_VIEW_FIELDS,
  COURSE_OWNER_SUMMARY_FIELDS,
  COURSE_ENROLLMENT_SUMMARY_FIELDS,
  normalizeCanonicalToken,
  buildCourseOwnerSummary,
  normalizeCourseModerationStatus,
  buildCourseEnrollmentSummary,
  buildOperationalCourseView
} = require(
  "../functions/src/admin/admin-course-models"
);

const {
  COURSE_OWNER_TYPES,
  COURSE_VISIBILITIES,
  COURSE_STATUSES
} = require(
  "../functions/src/courses/course-domain"
);

const {
  ENROLLMENT_STATUSES
} = require(
  "../functions/src/courses/course-enrollment-domain"
);

const {
  MODERATION_DECISIONS
} = require(
  "../functions/src/courses/course-moderation-policy"
);

function main() {
  assert.deepStrictEqual(
    COURSE_VIEW_FIELDS,
    [
      "courseId",
      "title",
      "ownerType",
      "ownerSummary",
      "visibility",
      "workflowStatus",
      "moderationStatus",
      "enrollmentSummary"
    ]
  );

  assert.strictEqual(
    COURSE_VIEW_FIELDS.length,
    8
  );

  assert.deepStrictEqual(
    COURSE_OWNER_SUMMARY_FIELDS,
    [
      "ownerId",
      "displayName"
    ]
  );

  assert.deepStrictEqual(
    COURSE_ENROLLMENT_SUMMARY_FIELDS,
    [
      "total",
      "active",
      "completed",
      "cancelled",
      "refunded",
      "chargeback"
    ]
  );

  // Canonical enums are reused, not duplicated.

  assert.strictEqual(
    normalizeCanonicalToken(
      " PLATFORM ",
      COURSE_OWNER_TYPES
    ),
    "platform"
  );

  assert.strictEqual(
    normalizeCanonicalToken(
      "organization",
      COURSE_VISIBILITIES
    ),
    "organization"
  );

  assert.strictEqual(
    normalizeCanonicalToken(
      "PUBLISHED",
      COURSE_STATUSES
    ),
    "published"
  );

  assert.strictEqual(
    normalizeCanonicalToken(
      "unsupported",
      COURSE_STATUSES
    ),
    null
  );

  // Platform course has no separate owner entity summary.

  const platformView =
    buildOperationalCourseView({
      courseId:
        "course-platform",

      course: {
        title:
          "Fundamentos de Jiu-Jitsu",

        ownerType:
          "platform",

        ownerId:
          null,

        visibility:
          "platform",

        status:
          "published",

        moderation: {
          status:
            "approved",

          summary:
            "must-not-leak",

          provider:
            "must-not-leak",

          model:
            "must-not-leak"
        },

        description:
          "must-not-leak",

        instructorIds: [
          "private-instructor"
        ],

        priceCents:
          19900,

        financialRuleId:
          "financial-secret-reference"
      },

      ownerSummary: {
        email:
          "must-not-leak@example.com"
      },

      enrollments: [
        {
          status:
            "active",

          userId:
            "student-a",

          orderId:
            "order-private-a"
        },
        {
          status:
            "completed"
        },
        {
          status:
            "cancelled"
        },
        {
          status:
            "refunded"
        },
        {
          status:
            "chargeback"
        }
      ]
    });

  assert.deepStrictEqual(
    platformView,
    {
      courseId:
        "course-platform",

      title:
        "Fundamentos de Jiu-Jitsu",

      ownerType:
        "platform",

      ownerSummary:
        null,

      visibility:
        "platform",

      workflowStatus:
        "published",

      moderationStatus:
        "approved",

      enrollmentSummary: {
        total:
          5,

        active:
          1,

        completed:
          1,

        cancelled:
          1,

        refunded:
          1,

        chargeback:
          1
      }
    }
  );

  // User owner summary remains minimal and sanitized.

  const userOwner =
    buildCourseOwnerSummary({
      course: {
        ownerType:
          "user",

        ownerId:
          "user-1"
      },

      ownerSummary: {
        displayName:
          "Instrutor Um",

        email:
          "private@example.com",

        cpf:
          "00000000000",

        customClaims: {
          super_admin:
            true
        }
      }
    });

  assert.deepStrictEqual(
    userOwner,
    {
      ownerId:
        "user-1",

      displayName:
        "Instrutor Um"
    }
  );

  // Organization owner uses the same stable summary shape.

  const organizationView =
    buildOperationalCourseView({
      courseId:
        "course-org",

      course: {
        title:
          "Curso Institucional",

        ownerType:
          "organization",

        ownerId:
          "org-1",

        visibility:
          "organization",

        organizationId:
          "org-1",

        status:
          "review",

        moderation: {
          status:
            "approved"
        },

        moderationPending: {
          state:
            "processing",

          submissionId:
            "must-not-leak"
        }
      },

      ownerSummary: {
        organizationId:
          "org-1",

        organizationName:
          "Academia Um",

        asaas_wallet_id:
          "must-not-leak"
      },

      enrollments: [
        {
          status:
            "active"
        },
        {
          status:
            "active"
        },
        {
          status:
            "completed"
        },
        {
          status:
            "chargeback"
        },
        {
          status:
            "legacy-invalid-status"
        },
        null
      ]
    });

  assert.deepStrictEqual(
    organizationView.ownerSummary,
    {
      ownerId:
        "org-1",

      displayName:
        "Academia Um"
    }
  );

  // Active moderation submission takes precedence over an older result.

  assert.strictEqual(
    organizationView
      .moderationStatus,
    "processing"
  );

  assert.deepStrictEqual(
    organizationView
      .enrollmentSummary,
    {
      total:
        5,

      active:
        2,

      completed:
        1,

      cancelled:
        0,

      refunded:
        0,

      chargeback:
        1
    }
  );

  // Unknown persisted tokens are not promoted into new canonical enums.

  const malformed =
    buildOperationalCourseView({
      courseId:
        "course-malformed",

      course: {
        title:
          "Curso com estado legado",

        ownerType:
          "unexpected-owner",

        visibility:
          "internet",

        status:
          "deleted",

        moderation: {
          status:
            "provider_custom_status"
        }
      }
    });

  assert.strictEqual(
    malformed.ownerType,
    null
  );

  assert.strictEqual(
    malformed.ownerSummary,
    null
  );

  assert.strictEqual(
    malformed.visibility,
    null
  );

  assert.strictEqual(
    malformed.workflowStatus,
    null
  );

  assert.strictEqual(
    malformed.moderationStatus,
    null
  );

  // Enrollment summary reuses all current canonical statuses.

  const summary =
    buildCourseEnrollmentSummary(
      ENROLLMENT_STATUSES.map(
        status => ({
          status
        })
      )
    );

  assert.deepStrictEqual(
    summary,
    {
      total:
        5,

      active:
        1,

      completed:
        1,

      cancelled:
        1,

      refunded:
        1,

      chargeback:
        1
    }
  );

  // Every canonical moderation decision remains representable.

  for (
    const decision
    of MODERATION_DECISIONS
  ) {
    assert.strictEqual(
      normalizeCourseModerationStatus({
        moderation: {
          status:
            decision
        }
      }),
      decision
    );
  }

  assert.strictEqual(
    normalizeCourseModerationStatus({
      moderationPending: {
        state:
          "processing"
      },

      moderation: {
        status:
          "approved"
      }
    }),
    "processing"
  );

  assert.throws(
    () =>
      buildOperationalCourseView({
        course: {}
      }),
    error =>
      error?.message ===
        "ADMIN_COURSE_ID_REQUIRED"
  );

  // Only the contracted eight top-level fields may leave this mapper.

  assert.deepStrictEqual(
    Object.keys(
      organizationView
    ).sort(),
    [...COURSE_VIEW_FIELDS]
      .sort()
  );

  const serialized =
    JSON.stringify({
      platformView,
      organizationView,
      userOwner
    });

  for (
    const forbidden of [
      "must-not-leak",
      "private@example.com",
      "00000000000",
      "financial-secret-reference",
      "private-instructor",
      "order-private-a",
      "asaas_wallet_id",
      "customClaims",
      "priceCents",
      "description",
      "instructorIds"
    ]
  ) {
    assert.strictEqual(
      serialized.includes(
        forbidden
      ),
      false,
      `OperationalCourseView leaked ${forbidden}`
    );
  }

  console.log(
    "MARCO8_COURSE_VIEW_FIELDS=8/8"
  );

  console.log(
    "MARCO8_COURSE_OWNER_TYPES=CANONICAL"
  );

  console.log(
    "MARCO8_COURSE_VISIBILITIES=CANONICAL"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_STATUSES=CANONICAL"
  );

  console.log(
    "MARCO8_COURSE_MODERATION_DECISIONS=CANONICAL"
  );

  console.log(
    "MARCO8_COURSE_MODERATION_PROCESSING=PERSISTED_STATE"
  );

  console.log(
    "MARCO8_COURSE_OWNER_SUMMARY_FIELDS=2/2"
  );

  console.log(
    "MARCO8_COURSE_ENROLLMENT_SUMMARY_FIELDS=6/6"
  );

  console.log(
    "MARCO8_COURSE_CHARGEBACK_SUMMARY=PASSED"
  );

  console.log(
    "MARCO8_COURSE_SANITIZATION=PASSED"
  );

  console.log(
    "MARCO8_OPERATIONAL_COURSE_MODEL=PASSED"
  );
}

main();
