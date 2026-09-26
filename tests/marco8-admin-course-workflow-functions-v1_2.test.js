"use strict";

const assert =
  require("assert");

const {
  AdminCourseWorkflowDomainError
} = require(
  "../functions/src/admin/admin-course-workflow-domain"
);

const {
  AdminCourseWorkflowServiceError
} = require(
  "../functions/src/admin/admin-course-workflow-service"
);

const {
  COURSES_MANAGE_CAPABILITY,
  COURSE_WORKFLOW_COMMANDS,

  assertOnlyCourseWorkflowFields,
  resolveCourseWorkflowActorRole,
  requireCourseWorkflowActor,
  createCourseWorkflowRequestId,
  mapCourseWorkflowCommandError,

  createCourseWorkflowCommandHandler
} = require(
  "../functions/src/admin/admin-course-workflow-functions"
);

function superAuth() {
  return {
    uid:
      "super-1",

    token: {
      super_admin:
        true
    }
  };
}

function platformAuth() {
  return {
    uid:
      "platform-1",

    token: {
      platform_admin:
        true
    }
  };
}

function contentAuth() {
  return {
    uid:
      "content-1",

    token: {
      content_admin:
        true
    }
  };
}

async function expectHttpsError(
  operation,
  expectedCode
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
    `Expected ${expectedCode}`
  );

  assert.strictEqual(
    received.code,
    expectedCode
  );

  return received;
}

async function main() {
  assert.strictEqual(
    COURSES_MANAGE_CAPABILITY,
    "ops.courses.manage"
  );

  assert.deepStrictEqual(
    COURSE_WORKFLOW_COMMANDS
      .suspenderCursoOperacionalV12,
    {
      capability:
        "ops.courses.manage",

      targetStatus:
        "suspended",

      operation:
        "Suspend operational course"
    }
  );

  assert.deepStrictEqual(
    COURSE_WORKFLOW_COMMANDS
      .reativarCursoOperacionalV12,
    {
      capability:
        "ops.courses.manage",

      targetStatus:
        "published",

      operation:
        "Reactivate operational course"
    }
  );

  assert.deepStrictEqual(
    assertOnlyCourseWorkflowFields(
      {
        courseId:
          "course-1"
      },
      "Course workflow"
    ),
    {
      courseId:
        "course-1"
    }
  );

  for (
    const forbiddenField
    of [
      "status",
      "targetStatus",
      "actorId",
      "actorRole",
      "requestId",
      "capability",
      "ownerId",
      "visibility",
      "moderation"
    ]
  ) {
    assert.throws(
      () =>
        assertOnlyCourseWorkflowFields(
          {
            courseId:
              "course-1",

            [forbiddenField]:
              "client-value"
          },
          "Course workflow"
        ),
      error =>
        error?.code ===
          "invalid-argument"
    );
  }

  assert.strictEqual(
    resolveCourseWorkflowActorRole(
      superAuth().token,
      COURSES_MANAGE_CAPABILITY
    ),
    "super_admin"
  );

  assert.strictEqual(
    resolveCourseWorkflowActorRole(
      platformAuth().token,
      COURSES_MANAGE_CAPABILITY
    ),
    "platform_admin"
  );

  assert.strictEqual(
    resolveCourseWorkflowActorRole(
      contentAuth().token,
      COURSES_MANAGE_CAPABILITY
    ),
    "content_admin"
  );

  for (
    const auth
    of [
      superAuth(),
      platformAuth(),
      contentAuth()
    ]
  ) {
    const actor =
      requireCourseWorkflowActor(
        {
          auth
        }
      );

    assert.strictEqual(
      actor.uid,
      auth.uid
    );

    assert.ok(
      [
        "super_admin",
        "platform_admin",
        "content_admin"
      ].includes(
        actor.actorRole
      )
    );
  }

  assert.throws(
    () =>
      requireCourseWorkflowActor({
        auth:
          null
      }),
    error =>
      error?.code ===
        "unauthenticated"
  );

  for (
    const auth
    of [
      {
        uid:
          "support-1",

        token: {
          support_admin:
            true
        }
      },

      {
        uid:
          "finance-1",

        token: {
          finance_admin:
            true
        }
      },

      {
        uid:
          "org-owner",

        token: {
          organization_role:
            "owner"
        }
      },

      {
        uid:
          "client-capability",

        token: {
          capability:
            "ops.courses.manage"
        }
      }
    ]
  ) {
    assert.throws(
      () =>
        requireCourseWorkflowActor({
          auth
        }),
      error =>
        error?.code ===
          "ADMIN_CAPABILITY_REQUIRED"
    );
  }

  assert.strictEqual(
    createCourseWorkflowRequestId(
      () =>
        " request-1 "
    ),
    "request-1"
  );

  assert.throws(
    () =>
      createCourseWorkflowRequestId(
        () =>
          "bad/request"
      ),
    error =>
      error?.code ===
        "internal"
  );

  let suspendCalls = 0;

  const suspendService = {
    async mutateCourseWorkflow(
      input
    ) {
      suspendCalls += 1;

      assert.deepStrictEqual(
        input,
        {
          courseId:
            "course-1",

          targetStatus:
            "suspended",

          actorId:
            "content-1",

          actorRole:
            "content_admin",

          requestId:
            "server-request-suspend"
        }
      );

      return {
        changed:
          true,

        idempotent:
          false,

        courseId:
          "course-1",

        status:
          "suspended",

        auditId:
          "audit-1"
      };
    }
  };

  const suspendHandler =
    createCourseWorkflowCommandHandler({
      service:
        suspendService,

      command:
        COURSE_WORKFLOW_COMMANDS
          .suspenderCursoOperacionalV12,

      requestIdFactory:
        () =>
          "server-request-suspend"
    });

  const suspendResult =
    await suspendHandler({
      auth:
        contentAuth(),

      data: {
        courseId:
          "course-1"
      }
    });

  assert.deepStrictEqual(
    suspendResult,
    {
      ok:
        true,

      changed:
        true,

      idempotent:
        false,

      courseId:
        "course-1",

      status:
        "suspended",

      auditId:
        "audit-1"
    }
  );

  assert.strictEqual(
    suspendCalls,
    1
  );

  let reactivateCalls = 0;

  const reactivateService = {
    async mutateCourseWorkflow(
      input
    ) {
      reactivateCalls += 1;

      assert.deepStrictEqual(
        input,
        {
          courseId:
            "course-2",

          targetStatus:
            "published",

          actorId:
            "platform-1",

          actorRole:
            "platform_admin",

          requestId:
            "server-request-reactivate"
        }
      );

      return {
        changed:
          true,

        idempotent:
          false,

        courseId:
          "course-2",

        status:
          "published",

        auditId:
          "audit-2"
      };
    }
  };

  const reactivateHandler =
    createCourseWorkflowCommandHandler({
      service:
        reactivateService,

      command:
        COURSE_WORKFLOW_COMMANDS
          .reativarCursoOperacionalV12,

      requestIdFactory:
        () =>
          "server-request-reactivate"
    });

  const reactivateResult =
    await reactivateHandler({
      auth:
        platformAuth(),

      data: {
        courseId:
          "course-2"
      }
    });

  assert.strictEqual(
    reactivateResult.ok,
    true
  );

  assert.strictEqual(
    reactivateResult.status,
    "published"
  );

  assert.strictEqual(
    reactivateCalls,
    1
  );

  // Authentication must happen before payload inspection.
  await expectHttpsError(
    () =>
      suspendHandler({
        auth:
          null,

        data: {
          targetStatus:
            "published"
        }
      }),
    "unauthenticated"
  );

  assert.strictEqual(
    suspendCalls,
    1
  );

  // Authorization must happen before payload inspection.
  await expectHttpsError(
    () =>
      suspendHandler({
        auth: {
          uid:
            "support-1",

          token: {
            support_admin:
              true
          }
        },

        data: {
          targetStatus:
            "published"
        }
      }),
    "permission-denied"
  );

  assert.strictEqual(
    suspendCalls,
    1
  );

  // Authorized clients still cannot choose status.
  await expectHttpsError(
    () =>
      suspendHandler({
        auth:
          contentAuth(),

        data: {
          courseId:
            "course-1",

          targetStatus:
            "published"
        }
      }),
    "invalid-argument"
  );

  assert.strictEqual(
    suspendCalls,
    1
  );

  const invalidInput =
    await expectHttpsError(
      async () =>
        mapCourseWorkflowCommandError(
          new AdminCourseWorkflowDomainError(
            "ADMIN_COURSE_WORKFLOW_INPUT_INVALID",
            "invalid input"
          )
        ),
      "invalid-argument"
    );

  assert.strictEqual(
    invalidInput
      .details
      .domainCode,
    "ADMIN_COURSE_WORKFLOW_INPUT_INVALID"
  );

  for (
    const domainCode
    of [
      "ADMIN_COURSE_WORKFLOW_STATUS_INVALID",
      "ADMIN_COURSE_WORKFLOW_COURSE_INVALID",
      "ADMIN_COURSE_WORKFLOW_TRANSITION_INVALID"
    ]
  ) {
    const mapped =
      await expectHttpsError(
        async () =>
          mapCourseWorkflowCommandError(
            new AdminCourseWorkflowDomainError(
              domainCode,
              "workflow precondition"
            )
          ),
        "failed-precondition"
      );

    assert.strictEqual(
      mapped
        .details
        .domainCode,
      domainCode
    );
  }

  const notFound =
    await expectHttpsError(
      async () =>
        mapCourseWorkflowCommandError(
          new AdminCourseWorkflowServiceError(
            "ADMIN_COURSE_WORKFLOW_TARGET_NOT_FOUND",
            "not found"
          )
        ),
      "not-found"
    );

  assert.strictEqual(
    notFound
      .details
      .domainCode,
    "ADMIN_COURSE_WORKFLOW_TARGET_NOT_FOUND"
  );

  const internal =
    await expectHttpsError(
      async () =>
        mapCourseWorkflowCommandError(
          new Error(
            "raw database internals"
          )
        ),
      "internal"
    );

  assert.strictEqual(
    internal.message.includes(
      "raw database internals"
    ),
    false
  );

  assert.throws(
    () =>
      createCourseWorkflowCommandHandler({
        service: {}
      }),
    TypeError
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_CAPABILITY=ops.courses.manage"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_CALLABLES=2/2"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_SUPER_ADMIN_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_PLATFORM_ADMIN_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_CONTENT_ADMIN_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_SUPPORT_ADMIN_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_FINANCE_ADMIN_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_ORG_ROLE_ESCALATION=BLOCKED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_CLIENT_CAPABILITY_ESCALATION=BLOCKED"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_AUTH_BEFORE_PAYLOAD=True"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_TARGET_STATUS_SERVER_FIXED=True"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_REQUEST_ID_SERVER_SIDE=True"
  );

  console.log(
    "MARCO8_COURSE_WORKFLOW_ERROR_MAPPING=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_COURSE_WORKFLOW_FUNCTIONS=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
