"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");


const {
  QUESTIONS_READ_CAPABILITY,
  QUESTIONS_MANAGE_CAPABILITY,
  QUESTION_CALLABLE_NAMES,

  createQuestionRequestId,
  mapQuestionCallableError,

  createListQuestionsHandler,
  createGetQuestionHandler,
  createGetQuestionForAuthoringHandler,
  createCreateQuestionHandler,
  createUpdateQuestionHandler,
  createModerateQuestionHandler,
  createArchiveQuestionHandler,
  createImportQuestionsHandler
} = require(
  "../functions/src/admin/admin-question-functions"
);

const {
  AdminQuestionsReadError
} = require(
  "../functions/src/admin/admin-questions-read-service"
);

const {
  AdminQuestionWriteDomainError
} = require(
  "../functions/src/admin/admin-question-write-domain"
);

const {
  AdminQuestionWriteServiceError
} = require(
  "../functions/src/admin/admin-question-write-service"
);

function requestFor(
  role,
  data = {}
) {
  return {
    auth: {
      uid:
        `uid-${role}`,

      token: {
        [role]:
          true
      }
    },

    data
  };
}

async function expectHttpsError(
  operation,
  expectedCode
) {
  let captured = null;

  try {
    await operation();
  }
  catch (error) {
    captured =
      error;
  }

  assert.ok(
    captured,
    "Expected HTTPS-style error."
  );

  assert.strictEqual(
    typeof captured.code,
    "string"
  );

  assert.strictEqual(
    captured.code,
    expectedCode
  );

  return captured;
}

function makeServices() {
  const calls = [];

  const readService = {
    async listQuestions(
      input
    ) {
      calls.push({
        operation:
          "list",
        input
      });

      return {
        items:
          [],
        nextCursor:
          null
      };
    },

    async getQuestion(
      input
    ) {
      calls.push({
        operation:
          "get",
        input
      });

      return {
        questionId:
          input.questionId,
        statement:
          "Question"
      };
    },

    async getQuestionForAuthoring(
      input
    ) {
      calls.push({
        operation:
          "authoring",
        input
      });

      return {
        questionId:
          input.questionId,
        statement:
          "Question",
        correctAnswer:
          "A",
        revision:
          1
      };
    }
  };

  function mutationResult(
    input
  ) {
    return {
      changed:
        true,
      idempotent:
        false,
      questionId:
        input.questionId ||
        "generated-question",
      lifecycleStatus:
        "draft",
      revision:
        1,
      auditId:
        "audit-1"
    };
  }

  const writeService = {
    async createQuestion(
      input
    ) {
      calls.push({
        operation:
          "create",
        input
      });

      return mutationResult(
        input
      );
    },

    async updateQuestion(
      input
    ) {
      calls.push({
        operation:
          "update",
        input
      });

      return mutationResult(
        input
      );
    },

    async moderateQuestion(
      input
    ) {
      calls.push({
        operation:
          "moderate",
        input
      });

      return {
        ...mutationResult(
          input
        ),
        lifecycleStatus:
          input.decision ===
            "approve"
            ? "approved"
            : "changes_requested"
      };
    },

    async archiveQuestion(
      input
    ) {
      calls.push({
        operation:
          "archive",
        input
      });

      return {
        ...mutationResult(
          input
        ),
        lifecycleStatus:
          "archived"
      };
    },

    async importQuestions(
      input
    ) {
      calls.push({
        operation:
          "import",
        input
      });

      return {
        total:
          input.items.length,
        created:
          input.items.length,
        failed:
          0,
        items:
          [],
        errors:
          []
      };
    }
  };

  return {
    calls,
    readService,
    writeService
  };
}

async function main() {
  assert.strictEqual(
    QUESTIONS_READ_CAPABILITY,
    "ops.questions.read"
  );

  assert.strictEqual(
    QUESTIONS_MANAGE_CAPABILITY,
    "ops.questions.manage"
  );

  assert.deepStrictEqual(
    QUESTION_CALLABLE_NAMES,
    [
      "listarQuestoesOperacionaisV12",
      "obterQuestaoOperacionalV12",
      "obterQuestaoEdicaoOperacionalV12",
      "criarQuestaoOperacionalV12",
      "atualizarQuestaoOperacionalV12",
      "moderarQuestaoOperacionalV12",
      "arquivarQuestaoOperacionalV12",
      "importarQuestoesOperacionaisV12"
    ]
  );

  const {
    calls,
    readService,
    writeService
  } =
    makeServices();

  const requestIdFactory =
    () =>
      "server-request-id";

  const listHandler =
    createListQuestionsHandler({
      readService
    });

  const detailHandler =
    createGetQuestionHandler({
      readService
    });

  const authoringHandler =
    createGetQuestionForAuthoringHandler({
      readService
    });

  const createHandler =
    createCreateQuestionHandler({
      writeService,
      requestIdFactory
    });

  const updateHandler =
    createUpdateQuestionHandler({
      writeService,
      requestIdFactory
    });

  const moderateHandler =
    createModerateQuestionHandler({
      writeService,
      requestIdFactory
    });

  const archiveHandler =
    createArchiveQuestionHandler({
      writeService,
      requestIdFactory
    });

  const importHandler =
    createImportQuestionsHandler({
      writeService,
      requestIdFactory
    });

  /*
   * Authentication happens before payload validation.
   */
  await expectHttpsError(
    () =>
      listHandler({
        data: {
          forbidden:
            true
        }
      }),
    "unauthenticated"
  );

  assert.strictEqual(
    calls.length,
    0
  );

  await expectHttpsError(
    () =>
      createHandler({
        data: {
          actorRole:
            "super_admin",

          capability:
            "ops.questions.manage"
        }
      }),
    "unauthenticated"
  );

  assert.strictEqual(
    calls.length,
    0
  );

  /*
   * Read access: support/content/platform/super allowed; finance blocked.
   */
  for (
    const role
    of [
      "support_admin",
      "content_admin",
      "platform_admin",
      "super_admin"
    ]
  ) {
    const result =
      await listHandler(
        requestFor(
          role,
          {
            limit:
              10,
            lifecycleStatus:
              "approved",
            difficulty:
              3,
            category:
              "Fundamentos"
          }
        )
      );

    assert.strictEqual(
      result.ok,
      true
    );
  }

  await expectHttpsError(
    () =>
      listHandler(
        requestFor(
          "finance_admin",
          {}
        )
      ),
    "permission-denied"
  );

  /*
   * Organization roles never escalate into global admin capabilities.
   */
  await expectHttpsError(
    () =>
      listHandler({
        auth: {
          uid:
            "org-owner-1",

          token: {
            organization_role:
              "owner"
          }
        },

        data: {}
      }),
    "permission-denied"
  );

  /*
   * Detail read keeps answer key outside the read surface.
   */
  const detail =
    await detailHandler(
      requestFor(
        "support_admin",
        {
          questionId:
            "question-1"
        }
      )
    );

  assert.strictEqual(
    detail.ok,
    true
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        detail.question,
        "correctAnswer"
      ),
    false
  );

  /*
   * Authoring read requires manage capability.
   */
  await expectHttpsError(
    () =>
      authoringHandler(
        requestFor(
          "support_admin",
          {
            questionId:
              "question-1"
          }
        )
      ),
    "permission-denied"
  );

  const authoring =
    await authoringHandler(
      requestFor(
        "content_admin",
        {
          questionId:
            "question-1"
        }
      )
    );

  assert.strictEqual(
    authoring.ok,
    true
  );

  assert.strictEqual(
    authoring.question
      .correctAnswer,
    "A"
  );

  /*
   * Manage access: content/platform/super allowed; support/finance blocked.
   */
  for (
    const role
    of [
      "content_admin",
      "platform_admin",
      "super_admin"
    ]
  ) {
    const createResult =
      await createHandler(
        requestFor(
          role,
          {
            content: {
              statement:
                "Question",
              options: {
                A:
                  "A",
                B:
                  "B"
              },
              correctAnswer:
                "A",
              difficulty:
                2,
              category:
                "Fundamentos"
            }
          }
        )
      );

    assert.strictEqual(
      createResult.ok,
      true
    );
  }

  for (
    const role
    of [
      "support_admin",
      "finance_admin"
    ]
  ) {
    await expectHttpsError(
      () =>
        createHandler(
          requestFor(
            role,
            {
              content: {}
            }
          )
        ),
      "permission-denied"
    );
  }

  /*
   * Client escalation fields are rejected.
   */
  for (
    const forbiddenPayload
    of [
      {
        content: {},
        actorRole:
          "super_admin"
      },
      {
        content: {},
        actorId:
          "spoofed"
      },
      {
        content: {},
        requestId:
          "client-request"
      },
      {
        content: {},
        capability:
          "ops.questions.manage"
      },
      {
        content: {},
        collection:
          "other_collection"
      },
      {
        content: {},
        lifecycleStatus:
          "approved"
      }
    ]
  ) {
    await expectHttpsError(
      () =>
        createHandler(
          requestFor(
            "content_admin",
            forbiddenPayload
          )
        ),
      "invalid-argument"
    );
  }

  /*
   * All mutation payloads pass actor and requestId from server-derived data.
   */
  await updateHandler(
    requestFor(
      "content_admin",
      {
        questionId:
          "question-1",
        expectedRevision:
          1,
        patch: {
          statement:
            "Updated"
        },
        submitForReview:
          true
      }
    )
  );

  await moderateHandler(
    requestFor(
      "platform_admin",
      {
        questionId:
          "question-1",
        expectedRevision:
          2,
        decision:
          "approve",
        reason:
          "Ready."
      }
    )
  );

  await archiveHandler(
    requestFor(
      "super_admin",
      {
        questionId:
          "question-1",
        expectedRevision:
          3
      }
    )
  );

  await importHandler(
    requestFor(
      "content_admin",
      {
        items: [
          {
            statement:
              "Imported",
            options: {
              A:
                "A",
              B:
                "B"
            },
            correctAnswer:
              "A",
            difficulty:
              2,
            category:
              "Fundamentos"
          }
        ]
      }
    )
  );

  const mutationCalls =
    calls.filter(
      call =>
        [
          "create",
          "update",
          "moderate",
          "archive",
          "import"
        ].includes(
          call.operation
        )
    );

  assert.ok(
    mutationCalls.length >=
      7
  );

  for (
    const call
    of mutationCalls
  ) {
    assert.ok(
      String(
        call.input.actorId ||
        ""
      ).startsWith(
        "uid-"
      )
    );

    assert.ok(
      [
        "content_admin",
        "platform_admin",
        "super_admin"
      ].includes(
        call.input.actorRole
      )
    );

    assert.strictEqual(
      call.input.requestId,
      "server-request-id"
    );

    assert.strictEqual(
      Object.prototype
        .hasOwnProperty.call(
          call.input,
          "collection"
        ),
      false
    );
  }

  /*
   * requestId is generated server-side and validated.
   */
  assert.strictEqual(
    createQuestionRequestId(
      () =>
        "request-123"
    ),
    "request-123"
  );

  assert.throws(
    () =>
      createQuestionRequestId(
        () =>
          "bad/request"
      ),
    error =>
      error?.code ===
        "internal"
  );

  /*
   * Error mapping remains sanitized.
   */
  await expectHttpsError(
    () =>
      Promise.resolve()
        .then(
          () =>
            mapQuestionCallableError(
              new AdminQuestionsReadError(
                "ADMIN_QUESTION_NOT_FOUND",
                "Question was not found."
              )
            )
        ),
    "not-found"
  );

  await expectHttpsError(
    () =>
      Promise.resolve()
        .then(
          () =>
            mapQuestionCallableError(
              new AdminQuestionWriteDomainError(
                "ADMIN_QUESTION_WRITE_REVISION_CONFLICT",
                "Conflict."
              )
            )
        ),
    "failed-precondition"
  );

  await expectHttpsError(
    () =>
      Promise.resolve()
        .then(
          () =>
            mapQuestionCallableError(
              new AdminQuestionWriteServiceError(
                "ADMIN_QUESTION_WRITE_NOT_FOUND",
                "Question was not found."
              )
            )
        ),
    "not-found"
  );

  /*
   * Static boundaries.
   */
  const ROOT =
    path.resolve(
      __dirname,
      ".."
    );

  const source =
    fs.readFileSync(
      path.join(
        ROOT,
        "functions/src/admin/admin-question-functions.js"
      ),
      "utf8"
    );

  for (
    const forbidden
    of [
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "GEMINI_COURSE_MODERATION_API_KEY",
      "defineSecret",
      "exam_templates/",
      "questoes_exames"
    ]
  ) {
    assert.strictEqual(
      source.includes(
        forbidden
      ),
      false,
      `Question callables must not depend on ${forbidden}`
    );
  }

  assert.strictEqual(
    source.includes(
      "request.data.actorRole"
    ),
    false
  );

  assert.strictEqual(
    source.includes(
      "request.data.requestId"
    ),
    false
  );

  assert.strictEqual(
    source.includes(
      "request.data.capability"
    ),
    false
  );

  console.log(
    "MARCO8_QUESTION_CALLABLES=8/8"
  );

  console.log(
    "MARCO8_QUESTION_READ_CAPABILITY=ops.questions.read"
  );

  console.log(
    "MARCO8_QUESTION_MANAGE_CAPABILITY=ops.questions.manage"
  );

  console.log(
    "MARCO8_QUESTION_READ_SUPPORT_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_QUESTION_AUTHORING_SUPPORT_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_QUESTION_MANAGE_CONTENT_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_QUESTION_MANAGE_PLATFORM_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_QUESTION_MANAGE_SUPER_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_QUESTION_MANAGE_SUPPORT_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_QUESTION_FINANCE_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_QUESTION_ORG_ROLE_ESCALATION=BLOCKED_BY_GLOBAL_CAPABILITY_POLICY"
  );

  console.log(
    "MARCO8_QUESTION_AUTH_BEFORE_PAYLOAD=True"
  );

  console.log(
    "MARCO8_QUESTION_ACTOR_ID_SOURCE=request.auth.uid"
  );

  console.log(
    "MARCO8_QUESTION_ACTOR_ROLE_SOURCE=signed_global_claims"
  );

  console.log(
    "MARCO8_QUESTION_REQUEST_ID_SOURCE=server"
  );

  console.log(
    "MARCO8_QUESTION_CLIENT_ROLE_INPUT=BLOCKED"
  );

  console.log(
    "MARCO8_QUESTION_CLIENT_CAPABILITY_INPUT=BLOCKED"
  );

  console.log(
    "MARCO8_QUESTION_CLIENT_REQUEST_ID_INPUT=BLOCKED"
  );

  console.log(
    "MARCO8_QUESTION_ARBITRARY_COLLECTION_INPUT=BLOCKED"
  );

  console.log(
    "MARCO8_QUESTION_AUTHORING_ANSWER_KEY=MANAGE_ONLY"
  );

  console.log(
    "MARCO8_QUESTION_FUNCTION_ERROR_MAPPING=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_QUESTION_FUNCTIONS=PASSED"
  );
}

main().catch(
  error => {
    console.error(error);
    process.exitCode = 1;
  }
);