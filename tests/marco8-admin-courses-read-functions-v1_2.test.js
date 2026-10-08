"use strict";

const assert =
  require("assert");

const {
  AdminCoursesReadError
} = require(
  "../functions/src/admin/admin-courses-read-service"
);

const {
  COURSES_READ_CAPABILITY,
  assertOnlyFields,
  requireCoursesReadActor,
  mapCoursesReadError,
  createListCoursesHandler,
  createGetCourseHandler
} = require(
  "../functions/src/admin/admin-courses-read-functions"
);

function supportAuth() {
  return {
    uid:
      "support-1",

    token: {
      support_admin:
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
    COURSES_READ_CAPABILITY,
    "ops.courses.read"
  );

  assert.deepStrictEqual(
    assertOnlyFields(
      {
        limit: 10,
        cursor:
          "cursor-1",

        workflowStatus:
          "published",

        ownerType:
          "user",

        visibility:
          "private",

        moderationStatus:
          "approved"
      },
      [
        "limit",
        "cursor",
        "workflowStatus",
        "ownerType",
        "visibility",
        "moderationStatus"
      ],
      "Course listing"
    ),
    {
      limit: 10,
      cursor:
        "cursor-1",

      workflowStatus:
        "published",

      ownerType:
        "user",

      visibility:
        "private",

      moderationStatus:
        "approved"
    }
  );

  assert.throws(
    () =>
      assertOnlyFields(
        {
          capability:
            "ops.courses.manage"
        },
        [
          "limit"
        ],
        "Course listing"
      ),
    error =>
      error?.code ===
        "invalid-argument"
  );

  for (
    const auth
    of [
      supportAuth(),
      contentAuth(),
      {
        uid:
          "platform-1",

        token: {
          platform_admin:
            true
        }
      },
      {
        uid:
          "super-1",

        token: {
          super_admin:
            true
        }
      }
    ]
  ) {
    const actor =
      requireCoursesReadActor({
        auth
      });

    assert.strictEqual(
      actor.uid,
      auth.uid
    );
  }

  assert.throws(
    () =>
      requireCoursesReadActor({
        auth: null
      }),
    error =>
      error?.code ===
        "unauthenticated"
  );

  assert.throws(
    () =>
      requireCoursesReadActor({
        auth: {
          uid:
            "finance-1",

          token: {
            finance_admin:
              true
          }
        }
      }),
    error =>
      error?.code ===
        "ADMIN_CAPABILITY_REQUIRED"
  );

  assert.throws(
    () =>
      requireCoursesReadActor({
        auth: {
          uid:
            "org-owner",

          token: {
            organization_role:
              "owner"
          }
        }
      }),
    error =>
      error?.code ===
        "ADMIN_CAPABILITY_REQUIRED"
  );

  assert.throws(
    () =>
      requireCoursesReadActor({
        auth: {
          uid:
            "client-capability",

          token: {
            capability:
              "ops.courses.read"
          }
        }
      }),
    error =>
      error?.code ===
        "ADMIN_CAPABILITY_REQUIRED"
  );

  let listCalls = 0;
  let getCalls = 0;

  const service = {
    async listCourses(
      input
    ) {
      listCalls += 1;

      assert.deepStrictEqual(
        input,
        {
          limit: 10,
          cursor:
            "cursor-a",

          workflowStatus:
            "review",

          ownerType:
            "organization",

          visibility:
            "organization",

          moderationStatus:
            "processing"
        }
      );

      return {
        limit: 10,

        items: [
          {
            courseId:
              "course-a",

            title:
              "Curso A"
          }
        ],

        nextCursor:
          "cursor-b"
      };
    },

    async getCourse(
      input
    ) {
      getCalls += 1;

      assert.deepStrictEqual(
        input,
        {
          courseId:
            "course-a"
        }
      );

      return {
        course: {
          courseId:
            "course-a",

          title:
            "Curso A"
        }
      };
    }
  };

  const listHandler =
    createListCoursesHandler({
      service
    });

  const getHandler =
    createGetCourseHandler({
      service
    });

  const listResult =
    await listHandler({
      auth:
        supportAuth(),

      data: {
        limit: 10,
        cursor:
          "cursor-a",

        workflowStatus:
          "review",

        ownerType:
          "organization",

        visibility:
          "organization",

        moderationStatus:
          "processing"
      }
    });

  assert.deepStrictEqual(
    listResult,
    {
      ok: true,
      limit: 10,

      items: [
        {
          courseId:
            "course-a",

          title:
            "Curso A"
        }
      ],

      nextCursor:
        "cursor-b"
    }
  );

  assert.strictEqual(
    listCalls,
    1
  );

  const detailResult =
    await getHandler({
      auth:
        contentAuth(),

      data: {
        courseId:
          "course-a"
      }
    });

  assert.deepStrictEqual(
    detailResult,
    {
      ok: true,

      course: {
        courseId:
          "course-a",

        title:
          "Curso A"
      }
    }
  );

  assert.strictEqual(
    getCalls,
    1
  );

  // Auth happens before payload validation.
  await expectHttpsError(
    () =>
      listHandler({
        auth:
          null,

        data: {
          arbitraryCollection:
            "usuarios"
        }
      }),
    "unauthenticated"
  );

  assert.strictEqual(
    listCalls,
    1
  );

  await expectHttpsError(
    () =>
      listHandler({
        auth: {
          uid:
            "finance-1",

          token: {
            finance_admin:
              true
          }
        },

        data: {
          arbitraryCollection:
            "usuarios"
        }
      }),
    "permission-denied"
  );

  assert.strictEqual(
    listCalls,
    1
  );

  await expectHttpsError(
    () =>
      listHandler({
        auth:
          supportAuth(),

        data: {
          capability:
            "ops.courses.manage"
        }
      }),
    "invalid-argument"
  );

  assert.strictEqual(
    listCalls,
    1
  );

  await expectHttpsError(
    () =>
      getHandler({
        auth:
          supportAuth(),

        data: {
          courseId:
            "course-a",

          collection:
            "courses"
        }
      }),
    "invalid-argument"
  );

  assert.strictEqual(
    getCalls,
    1
  );

  const invalidError =
    await expectHttpsError(
      async () =>
        mapCoursesReadError(
          new AdminCoursesReadError(
            "ADMIN_COURSES_CURSOR_INVALID",
            "invalid cursor"
          )
        ),
      "invalid-argument"
    );

  assert.strictEqual(
    invalidError
      .details
      .domainCode,
    "ADMIN_COURSES_CURSOR_INVALID"
  );

  const notFoundError =
    await expectHttpsError(
      async () =>
        mapCoursesReadError(
          new AdminCoursesReadError(
            "ADMIN_COURSE_NOT_FOUND",
            "not found"
          )
        ),
      "not-found"
    );

  assert.strictEqual(
    notFoundError
      .details
      .domainCode,
    "ADMIN_COURSE_NOT_FOUND"
  );

  for (
    const code
    of [
      "ADMIN_COURSES_BATCH_INVALID",
      "ADMIN_COURSES_CANONICAL_STATE_INVALID",
      "ADMIN_COURSES_AGGREGATE_INVALID",
      "ADMIN_COURSES_AGGREGATE_UNAVAILABLE"
    ]
  ) {
    const mapped =
      await expectHttpsError(
        async () =>
          mapCoursesReadError(
            new AdminCoursesReadError(
              code,
              "safe operational failure"
            )
          ),
        "failed-precondition"
      );

    assert.strictEqual(
      mapped
        .details
        .domainCode,
      code
    );
  }

  const internalError =
    await expectHttpsError(
      async () =>
        mapCoursesReadError(
          new Error(
            "raw database internals"
          )
        ),
      "internal"
    );

  assert.strictEqual(
    internalError.message.includes(
      "raw database internals"
    ),
    false
  );

  assert.throws(
    () =>
      createListCoursesHandler({
        service: {}
      }),
    TypeError
  );

  assert.throws(
    () =>
      createGetCourseHandler({
        service: {}
      }),
    TypeError
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_CAPABILITY=ops.courses.read"
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_AUTH=PASSED"
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_AUTH_BEFORE_PAYLOAD=True"
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_SUPPORT_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_CONTENT_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_PLATFORM_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_SUPER_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_FINANCE_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_ORG_ROLE_ESCALATION=BLOCKED"
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_CLIENT_CAPABILITY_INPUT=BLOCKED"
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_LIST_FIELDS=6/6"
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_DETAIL_FIELDS=1/1"
  );

  console.log(
    "MARCO8_COURSES_CALLABLE_ERROR_MAPPING=PASSED"
  );

  console.log(
    "MARCO8_COURSES_READ_CALLABLES=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
