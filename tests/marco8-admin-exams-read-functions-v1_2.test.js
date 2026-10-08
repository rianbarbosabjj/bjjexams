"use strict";

const assert =
  require("assert");

const {
  AdminExamModelError
} = require(
  "../functions/src/admin/admin-exam-models"
);

const {
  AdminExamsReadError
} = require(
  "../functions/src/admin/admin-exams-read-service"
);

const {
  EXAMS_READ_CAPABILITY,
  assertOnlyFields,
  requireExamsReadActor,
  mapExamsReadError,
  createListExamsHandler,
  createGetExamHandler
} = require(
  "../functions/src/admin/admin-exams-read-functions"
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
    EXAMS_READ_CAPABILITY,
    "ops.exams.read"
  );

  assert.deepStrictEqual(
    assertOnlyFields(
      {
        limit:
          10,

        cursor:
          "cursor-1",

        status:
          "ready",

        organizationId:
          "org-1",

        targetBelt:
          "Azul"
      },
      [
        "limit",
        "cursor",
        "status",
        "organizationId",
        "targetBelt"
      ],
      "Exam listing"
    ),
    {
      limit:
        10,

      cursor:
        "cursor-1",

      status:
        "ready",

      organizationId:
        "org-1",

      targetBelt:
        "Azul"
    }
  );

  assert.throws(
    () =>
      assertOnlyFields(
        {
          capability:
            "ops.exams.manage"
        },
        [
          "limit"
        ],
        "Exam listing"
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
      requireExamsReadActor({
        auth
      });

    assert.strictEqual(
      actor.uid,
      auth.uid
    );
  }

  assert.throws(
    () =>
      requireExamsReadActor({
        auth:
          null
      }),
    error =>
      error?.code ===
        "unauthenticated"
  );

  assert.throws(
    () =>
      requireExamsReadActor({
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
      requireExamsReadActor({
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
      requireExamsReadActor({
        auth: {
          uid:
            "client-capability",

          token: {
            capability:
              "ops.exams.read"
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
    async listExams(
      input
    ) {
      listCalls += 1;

      assert.deepStrictEqual(
        input,
        {
          limit:
            10,

          cursor:
            "cursor-a",

          status:
            "ready",

          organizationId:
            "org-1",

          targetBelt:
            "Azul"
        }
      );

      return {
        limit:
          10,

        items: [
          {
            sessionId:
              "session-a",

            status:
              "ready"
          }
        ],

        nextCursor:
          "cursor-b"
      };
    },

    async getExam(
      input
    ) {
      getCalls += 1;

      assert.deepStrictEqual(
        input,
        {
          sessionId:
            "session-a"
        }
      );

      return {
        exam: {
          sessionId:
            "session-a",

          status:
            "ready"
        }
      };
    }
  };

  const listHandler =
    createListExamsHandler({
      service
    });

  const getHandler =
    createGetExamHandler({
      service
    });

  const listResult =
    await listHandler({
      auth:
        supportAuth(),

      data: {
        limit:
          10,

        cursor:
          "cursor-a",

        status:
          "ready",

        organizationId:
          "org-1",

        targetBelt:
          "Azul"
      }
    });

  assert.deepStrictEqual(
    listResult,
    {
      ok:
        true,

      limit:
        10,

      items: [
        {
          sessionId:
            "session-a",

          status:
            "ready"
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
        sessionId:
          "session-a"
      }
    });

  assert.deepStrictEqual(
    detailResult,
    {
      ok:
        true,

      exam: {
        sessionId:
          "session-a",

        status:
          "ready"
      }
    }
  );

  assert.strictEqual(
    getCalls,
    1
  );

  // Authentication/authorization must happen before payload validation.
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
            "exam_sessions"
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
            "ops.exams.manage"
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
          sessionId:
            "session-a",

          collection:
            "exam_sessions"
        }
      }),
    "invalid-argument"
  );

  assert.strictEqual(
    getCalls,
    1
  );

  for (
    const code
    of [
      "ADMIN_EXAMS_IDENTIFIER_INVALID",
      "ADMIN_EXAMS_LIMIT_INVALID",
      "ADMIN_EXAMS_FILTER_INVALID",
      "ADMIN_EXAMS_CURSOR_INVALID"
    ]
  ) {
    const mapped =
      await expectHttpsError(
        async () =>
          mapExamsReadError(
            new AdminExamsReadError(
              code,
              "invalid client input"
            )
          ),
        "invalid-argument"
      );

    assert.strictEqual(
      mapped
        .details
        .domainCode,
      code
    );
  }

  const notFound =
    await expectHttpsError(
      async () =>
        mapExamsReadError(
          new AdminExamsReadError(
            "ADMIN_EXAM_NOT_FOUND",
            "not found"
          )
        ),
      "not-found"
    );

  assert.strictEqual(
    notFound
      .details
      .domainCode,
    "ADMIN_EXAM_NOT_FOUND"
  );

  for (
    const code
    of [
      "ADMIN_EXAMS_BATCH_UNAVAILABLE",
      "ADMIN_EXAMS_AGGREGATE_INVALID",
      "ADMIN_EXAMS_AGGREGATE_UNAVAILABLE"
    ]
  ) {
    const mapped =
      await expectHttpsError(
        async () =>
          mapExamsReadError(
            new AdminExamsReadError(
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

  const modelError =
    await expectHttpsError(
      async () =>
        mapExamsReadError(
          new AdminExamModelError(
            "ADMIN_EXAM_COUNT_INCONSISTENT",
            "canonical count mismatch"
          )
        ),
      "failed-precondition"
    );

  assert.strictEqual(
    modelError
      .details
      .domainCode,
    "ADMIN_EXAM_COUNT_INCONSISTENT"
  );

  const unknownDomain =
    await expectHttpsError(
      async () =>
        mapExamsReadError(
          new AdminExamsReadError(
            "ADMIN_EXAMS_UNKNOWN_SAFE_FAILURE",
            "safe domain failure"
          )
        ),
      "unavailable"
    );

  assert.strictEqual(
    unknownDomain
      .details
      .domainCode,
    "ADMIN_EXAMS_UNKNOWN_SAFE_FAILURE"
  );

  const internalError =
    await expectHttpsError(
      async () =>
        mapExamsReadError(
          new Error(
            "raw Firestore internals"
          )
        ),
      "internal"
    );

  assert.strictEqual(
    internalError.message.includes(
      "raw Firestore internals"
    ),
    false
  );

  assert.throws(
    () =>
      createListExamsHandler({
        service: {}
      }),
    TypeError
  );

  assert.throws(
    () =>
      createGetExamHandler({
        service: {}
      }),
    TypeError
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_CAPABILITY=ops.exams.read"
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_AUTH=PASSED"
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_AUTH_BEFORE_PAYLOAD=True"
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_SUPPORT_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_CONTENT_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_PLATFORM_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_SUPER_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_FINANCE_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_ORG_ROLE_ESCALATION=BLOCKED"
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_CLIENT_CAPABILITY_INPUT=BLOCKED"
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_LIST_FIELDS=5/5"
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_DETAIL_FIELDS=1/1"
  );

  console.log(
    "MARCO8_EXAMS_CALLABLE_ERROR_MAPPING=PASSED"
  );

  console.log(
    "MARCO8_EXAMS_READ_CALLABLES=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});