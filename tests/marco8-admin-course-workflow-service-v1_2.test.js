"use strict";

const assert =
  require("assert");

const {
  AdminCourseWorkflowDomainError,
  AdminCourseWorkflowServiceError,
  createAdminCourseWorkflowService
} = require(
  "../functions/src/admin/admin-course-workflow-service"
);

function clone(
  value
) {
  return value === undefined
    ? undefined
    : JSON.parse(
        JSON.stringify(
          value
        )
      );
}

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
      "original-published-at",

    moderation: {
      status:
        "approved",

      privateProviderField:
        "must-not-enter-audit"
    },

    ...overrides
  };
}

function createFakeFirestore(
  initialCourses = {}
) {
  const courses =
    new Map(
      Object.entries(
        initialCourses
      ).map(
        ([id, data]) => [
          id,
          clone(data)
        ]
      )
    );

  const audits =
    new Map();

  const events =
    [];

  let auditSequence =
    0;

  function doc(
    path
  ) {
    const [
      collection,
      id
    ] =
      path.split("/");

    return {
      path,
      id,

      async get() {
        if (
          collection !==
            "courses"
        ) {
          throw new Error(
            `Unexpected get: ${path}`
          );
        }

        return {
          exists:
            courses.has(id),

          data() {
            return clone(
              courses.get(id)
            );
          }
        };
      }
    };
  }

  const db = {
    courses,
    audits,
    events,

    doc,

    collection(
      name
    ) {
      if (
        name !==
        "audit_logs"
      ) {
        throw new Error(
          `Unexpected collection: ${name}`
        );
      }

      return {
        doc() {
          auditSequence += 1;

          return {
            id:
              `audit-${auditSequence}`,

            path:
              `audit_logs/audit-${auditSequence}`
          };
        }
      };
    },

    async runTransaction(
      callback
    ) {
      const pendingUpdates =
        [];

      const pendingCreates =
        [];

      const transaction = {
        async get(
          ref
        ) {
          const [
            collection,
            id
          ] =
            ref.path.split("/");

          if (
            collection !==
              "courses"
          ) {
            throw new Error(
              `Unexpected transaction get: ${ref.path}`
            );
          }

          events.push({
            type:
              "get",

            path:
              ref.path
          });

          return {
            exists:
              courses.has(id),

            data() {
              return clone(
                courses.get(id)
              );
            }
          };
        },

        update(
          ref,
          data
        ) {
          events.push({
            type:
              "update",

            path:
              ref.path,

            data:
              clone(data)
          });

          pendingUpdates.push({
            ref,
            data:
              clone(data)
          });
        },

        create(
          ref,
          data
        ) {
          events.push({
            type:
              "create",

            path:
              ref.path,

            data:
              clone(data)
          });

          pendingCreates.push({
            ref,
            data:
              clone(data)
          });
        }
      };

      const result =
        await callback(
          transaction
        );

      for (
        const operation
        of pendingUpdates
      ) {
        const [
          collection,
          id
        ] =
          operation
            .ref
            .path
            .split("/");

        if (
          collection !==
            "courses"
        ) {
          throw new Error(
            "Unexpected update."
          );
        }

        courses.set(
          id,
          {
            ...courses.get(id),
            ...clone(
              operation.data
            )
          }
        );
      }

      for (
        const operation
        of pendingCreates
      ) {
        audits.set(
          operation.ref.id,
          clone(
            operation.data
          )
        );
      }

      return result;
    }
  };

  return db;
}

async function expectError(
  operation,
  ErrorType,
  code
) {
  let received = null;

  try {
    await operation();
  }
  catch (error) {
    received =
      error;
  }

  assert.ok(
    received,
    `Expected ${code}`
  );

  assert.ok(
    received instanceof
      ErrorType
  );

  assert.strictEqual(
    received.code,
    code
  );

  return received;
}

async function main() {
  assert.throws(
    () =>
      createAdminCourseWorkflowService({
        db: {}
      }),
    TypeError
  );

  const db =
    createFakeFirestore({
      "course-published":
        publishedCourse(),

      "course-suspended":
        publishedCourse({
          status:
            "suspended"
        }),

      "course-review":
        publishedCourse({
          status:
            "review"
        })
    });

  let timestampSequence =
    0;

  const service =
    createAdminCourseWorkflowService({
      db,

      serverTimestamp:
        () => {
          timestampSequence += 1;

          return `server-time-${timestampSequence}`;
        }
    });

  const suspension =
    await service
      .mutateCourseWorkflow({
        courseId:
          "course-published",

        targetStatus:
          "suspended",

        actorId:
          "content-admin-1",

        actorRole:
          "content_admin",

        requestId:
          "request-suspend"
      });

  assert.deepStrictEqual(
    suspension,
    {
      changed:
        true,

      idempotent:
        false,

      courseId:
        "course-published",

      status:
        "suspended",

      auditId:
        "audit-1"
    }
  );

  const suspendedCourse =
    db.courses.get(
      "course-published"
    );

  assert.strictEqual(
    suspendedCourse.status,
    "suspended"
  );

  assert.strictEqual(
    suspendedCourse.updatedAt,
    "server-time-1"
  );

  assert.strictEqual(
    suspendedCourse.publishedAt,
    "original-published-at"
  );

  assert.strictEqual(
    suspendedCourse.moderation
      .status,
    "approved"
  );

  const suspensionAudit =
    db.audits.get(
      "audit-1"
    );

  assert.strictEqual(
    suspensionAudit.action,
    "admin.course.suspended"
  );

  assert.deepStrictEqual(
    suspensionAudit.before,
    {
      status:
        "published"
    }
  );

  assert.deepStrictEqual(
    suspensionAudit.after,
    {
      status:
        "suspended"
    }
  );

  assert.strictEqual(
    JSON.stringify(
      suspensionAudit
    ).includes(
      "must-not-enter-audit"
    ),
    false
  );

  const eventsAfterSuspension =
    db.events.length;

  const replay =
    await service
      .mutateCourseWorkflow({
        courseId:
          "course-published",

        targetStatus:
          "suspended",

        actorId:
          "content-admin-1",

        actorRole:
          "content_admin",

        requestId:
          "request-replay"
      });

  assert.deepStrictEqual(
    replay,
    {
      changed:
        false,

      idempotent:
        true,

      courseId:
        "course-published",

      status:
        "suspended",

      auditId:
        null
    }
  );

  const replayWrites =
    db.events
      .slice(
        eventsAfterSuspension
      )
      .filter(
        event =>
          [
            "update",
            "create"
          ].includes(
            event.type
          )
      );

  assert.strictEqual(
    replayWrites.length,
    0
  );

  const reactivation =
    await service
      .mutateCourseWorkflow({
        courseId:
          "course-suspended",

        targetStatus:
          "published",

        actorId:
          "platform-admin-1",

        actorRole:
          "platform_admin",

        requestId:
          "request-reactivate"
      });

  assert.strictEqual(
    reactivation.changed,
    true
  );

  assert.strictEqual(
    reactivation.status,
    "published"
  );

  const reactivated =
    db.courses.get(
      "course-suspended"
    );

  assert.strictEqual(
    reactivated.status,
    "published"
  );

  // Existing publication timestamp is preserved.
  assert.strictEqual(
    reactivated.publishedAt,
    "original-published-at"
  );

  // Reactivation does not overwrite moderation.
  assert.strictEqual(
    reactivated.moderation.status,
    "approved"
  );

  const missingPublishedAtDb =
    createFakeFirestore({
      "course-no-published-at":
        publishedCourse({
          status:
            "suspended",

          publishedAt:
            null
        })
    });

  const missingPublishedAtService =
    createAdminCourseWorkflowService({
      db:
        missingPublishedAtDb,

      serverTimestamp:
        () =>
          "new-publication-time"
    });

  await missingPublishedAtService
    .mutateCourseWorkflow({
      courseId:
        "course-no-published-at",

      targetStatus:
        "published",

      actorId:
        "super-admin-1",

      actorRole:
        "super_admin",

      requestId:
        "request-new-published-at"
    });

  assert.strictEqual(
    missingPublishedAtDb
      .courses
      .get(
        "course-no-published-at"
      )
      .publishedAt,
    "new-publication-time"
  );

  await expectError(
    () =>
      service
        .mutateCourseWorkflow({
          courseId:
            "course-review",

          targetStatus:
            "published",

          actorId:
            "content-admin-1",

          actorRole:
            "content_admin",

          requestId:
            "request-review-publish"
        }),
    AdminCourseWorkflowDomainError,
    "ADMIN_COURSE_WORKFLOW_TRANSITION_INVALID"
  );

  const reviewWrites =
    db.events.filter(
      event =>
        (
          event.type ===
            "update" ||
          event.type ===
            "create"
        ) &&
        (
          event.path ===
            "courses/course-review"
        )
    );

  assert.strictEqual(
    reviewWrites.length,
    0
  );

  await expectError(
    () =>
      service
        .mutateCourseWorkflow({
          courseId:
            "missing-course",

          targetStatus:
            "suspended",

          actorId:
            "admin-1",

          actorRole:
            "content_admin",

          requestId:
            "request-missing"
        }),
    AdminCourseWorkflowServiceError,
    "ADMIN_COURSE_WORKFLOW_TARGET_NOT_FOUND"
  );

  await expectError(
    () =>
      service
        .mutateCourseWorkflow({
          courseId:
            "bad/id",

          targetStatus:
            "suspended",

          actorId:
            "admin-1",

          actorRole:
            "content_admin",

          requestId:
            "request-invalid"
        }),
    AdminCourseWorkflowDomainError,
    "ADMIN_COURSE_WORKFLOW_INPUT_INVALID"
  );

  const mutationEvents =
    db.events.filter(
      event =>
        [
          "update",
          "create"
        ].includes(
          event.type
        )
    );

  assert.ok(
    mutationEvents.length >= 4
  );

  assert.strictEqual(
    db.audits.size,
    2
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_SERVICE_COLLECTION=courses"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_AUDIT_COLLECTION=audit_logs"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_TRANSACTIONAL=True"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_SUSPEND=PASSED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_REACTIVATE=PASSED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_REVIEW_PUBLISH=BLOCKED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_MODERATION_PRESERVED=True"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_PUBLISHED_AT_PRESERVED=True"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_IDEMPOTENT_REPLAY_NO_WRITE=True"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_ATOMIC_AUDIT=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_COURSE_WORKFLOW_SERVICE=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
