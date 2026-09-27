"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  ADMIN_QUESTION_WRITE_SCHEMA_VERSION,
  ADMIN_QUESTION_IMPORT_MAX_ITEMS,
  ADMIN_QUESTION_MODERATION_DECISIONS,
  ADMIN_QUESTION_AUDIT_ACTIONS,

  AdminQuestionWriteDomainError,

  normalizeStrictQuestionContent,
  normalizeWriteActor,
  buildQuestionCreateDocument,
  buildQuestionUpdatePlan,
  buildQuestionModerationPlan,
  buildQuestionArchivePlan,
  buildQuestionAuditEvent,
  validateQuestionImportItems
} = require(
  "../functions/src/admin/admin-question-write-domain"
);

function sampleContent(
  overrides = {}
) {
  return {
    statement:
      "Qual e o objetivo da guarda fechada?",

    options: {
      A:
        "Controlar o adversario entre as pernas.",

      B:
        "Ficar obrigatoriamente em pe."
    },

    correctAnswer:
      "A",

    difficulty:
      2,

    category:
      "Fundamentos",

    media: {
      imageUrl:
        null,

      videoUrl:
        null
    },

    ...overrides
  };
}

function sampleQuestion(
  lifecycleStatus = "draft",
  overrides = {}
) {
  const moderated =
    [
      "approved",
      "changes_requested"
    ].includes(
      lifecycleStatus
    );

  const archived =
    lifecycleStatus ===
      "archived";

  return {
    questionVersion:
      1,

    ...sampleContent(),

    lifecycleStatus,

    authorId:
      "author-1",

    createdAt:
      "2026-09-27T10:00:00.000Z",

    updatedAt:
      "2026-09-27T10:00:00.000Z",

    revision:
      3,

    moderatedAt:
      moderated
        ? "2026-09-27T10:10:00.000Z"
        : null,

    moderatedBy:
      moderated
        ? "moderator-1"
        : null,

    moderationReason:
      lifecycleStatus ===
        "changes_requested"
        ? "Ajustar a formulacao."
        : moderated
          ? "Revisada."
          : null,

    archivedAt:
      archived
        ? "2026-09-27T10:20:00.000Z"
        : null,

    archivedBy:
      archived
        ? "moderator-1"
        : null,

    ...overrides
  };
}

function expectDomainError(
  operation,
  expectedCode
) {
  let caught = null;

  try {
    operation();
  }
  catch (error) {
    caught =
      error;
  }

  assert.ok(
    caught,
    `Expected ${expectedCode}`
  );

  assert.ok(
    caught instanceof
      AdminQuestionWriteDomainError
  );

  assert.strictEqual(
    caught.code,
    expectedCode
  );
}

function main() {
  assert.strictEqual(
    ADMIN_QUESTION_WRITE_SCHEMA_VERSION,
    1
  );

  assert.strictEqual(
    ADMIN_QUESTION_IMPORT_MAX_ITEMS,
    25
  );

  assert.deepStrictEqual(
    ADMIN_QUESTION_MODERATION_DECISIONS,
    {
      approve:
        "approved",

      request_changes:
        "changes_requested"
    }
  );

  assert.strictEqual(
    ADMIN_QUESTION_AUDIT_ACTIONS.create,
    "admin.question.created"
  );

  const actor =
    normalizeWriteActor({
      actorId:
        "admin-1",

      actorRole:
        "content_admin",

      requestId:
        "request-1"
    });

  assert.deepStrictEqual(
    actor,
    {
      actorId:
        "admin-1",

      actorRole:
        "content_admin",

      requestId:
        "request-1"
    }
  );

  const created =
    buildQuestionCreateDocument({
      content:
        sampleContent(),

      actorId:
        "admin-1",

      timestamp:
        "2026-09-27T11:00:00.000Z"
    });

  assert.strictEqual(
    created.lifecycleStatus,
    "draft"
  );

  assert.strictEqual(
    created.revision,
    1
  );

  assert.strictEqual(
    created.authorId,
    "admin-1"
  );

  assert.strictEqual(
    created.createdAt,
    "2026-09-27T11:00:00.000Z"
  );

  assert.strictEqual(
    created.updatedAt,
    "2026-09-27T11:00:00.000Z"
  );

  expectDomainError(
    () =>
      buildQuestionCreateDocument({
        content: {
          ...sampleContent(),

          lifecycleStatus:
            "approved"
        },

        actorId:
          "admin-1",

        timestamp:
          "time"
      }),
    "ADMIN_QUESTION_WRITE_UNSUPPORTED_FIELDS"
  );

  expectDomainError(
    () =>
      buildQuestionCreateDocument({
        content:
          sampleContent({
            statement:
              "x".repeat(4001)
          }),

        actorId:
          "admin-1",

        timestamp:
          "time"
      }),
    "ADMIN_QUESTION_WRITE_INPUT_INVALID"
  );

  expectDomainError(
    () =>
      normalizeStrictQuestionContent(
        sampleContent({
          options: {
            A:
              "x".repeat(1201),

            B:
              "ok"
          }
        })
      ),
    "ADMIN_QUESTION_WRITE_INPUT_INVALID"
  );

  expectDomainError(
    () =>
      normalizeStrictQuestionContent(
        sampleContent({
          media: {
            imageUrl:
              `https://example.com/${"x".repeat(2000)}`,

            videoUrl:
              null
          }
        })
      ),
    "ADMIN_QUESTION_WRITE_INPUT_INVALID"
  );

  const draftUpdate =
    buildQuestionUpdatePlan({
      currentQuestion:
        sampleQuestion(
          "draft"
        ),

      expectedRevision:
        3,

      patch: {
        statement:
          "Pergunta revisada"
      },

      timestamp:
        "2026-09-27T11:10:00.000Z"
    });

  assert.strictEqual(
    draftUpdate.changed,
    true
  );

  assert.strictEqual(
    draftUpdate.nextDocument
      .lifecycleStatus,
    "draft"
  );

  assert.strictEqual(
    draftUpdate.nextDocument
      .revision,
    4
  );

  assert.strictEqual(
    draftUpdate.nextDocument
      .statement,
    "Pergunta revisada"
  );

  const submitted =
    buildQuestionUpdatePlan({
      currentQuestion:
        sampleQuestion(
          "draft"
        ),

      expectedRevision:
        3,

      submitForReview:
        true,

      timestamp:
        "2026-09-27T11:20:00.000Z"
    });

  assert.strictEqual(
    submitted.operation,
    "submit"
  );

  assert.strictEqual(
    submitted.nextDocument
      .lifecycleStatus,
    "pending_review"
  );

  assert.strictEqual(
    submitted.nextDocument
      .revision,
    4
  );

  const pendingReplay =
    buildQuestionUpdatePlan({
      currentQuestion:
        sampleQuestion(
          "pending_review"
        ),

      expectedRevision:
        3,

      submitForReview:
        true,

      timestamp:
        "2026-09-27T11:30:00.000Z"
    });

  assert.strictEqual(
    pendingReplay.changed,
    false
  );

  assert.strictEqual(
    pendingReplay.idempotent,
    true
  );

  assert.strictEqual(
    pendingReplay.nextDocument
      .revision,
    3
  );

  const approvedEdit =
    buildQuestionUpdatePlan({
      currentQuestion:
        sampleQuestion(
          "approved"
        ),

      expectedRevision:
        3,

      patch: {
        category:
          "Fundamentos revisados"
      },

      timestamp:
        "2026-09-27T11:40:00.000Z"
    });

  assert.strictEqual(
    approvedEdit.nextDocument
      .lifecycleStatus,
    "pending_review"
  );

  assert.strictEqual(
    approvedEdit.nextDocument
      .moderatedAt,
    null
  );

  assert.strictEqual(
    approvedEdit.nextDocument
      .moderatedBy,
    null
  );

  assert.strictEqual(
    approvedEdit.nextDocument
      .moderationReason,
    null
  );

  const requestedChangesResubmission =
    buildQuestionUpdatePlan({
      currentQuestion:
        sampleQuestion(
          "changes_requested"
        ),

      expectedRevision:
        3,

      patch: {
        statement:
          "Pergunta ajustada"
      },

      submitForReview:
        true,

      timestamp:
        "2026-09-27T11:50:00.000Z"
    });

  assert.strictEqual(
    requestedChangesResubmission
      .nextDocument.lifecycleStatus,
    "pending_review"
  );

  assert.strictEqual(
    requestedChangesResubmission
      .nextDocument.moderationReason,
    null
  );

  expectDomainError(
    () =>
      buildQuestionUpdatePlan({
        currentQuestion:
          sampleQuestion(
            "archived"
          ),

        expectedRevision:
          3,

        patch: {
          statement:
            "Nao pode editar"
        },

        timestamp:
          "time"
      }),
    "ADMIN_QUESTION_WRITE_CONTENT_EDIT_ARCHIVED"
  );

  expectDomainError(
    () =>
      buildQuestionUpdatePlan({
        currentQuestion:
          sampleQuestion(
            "draft"
          ),

        expectedRevision:
          2,

        patch: {
          statement:
            "Conflito"
        },

        timestamp:
          "time"
      }),
    "ADMIN_QUESTION_WRITE_REVISION_CONFLICT"
  );

  const pending =
    sampleQuestion(
      "pending_review"
    );

  const approved =
    buildQuestionModerationPlan({
      currentQuestion:
        pending,

      expectedRevision:
        3,

      decision:
        "approve",

      reason:
        "Revisada e aprovada.",

      actorId:
        "moderator-2",

      timestamp:
        "2026-09-27T12:00:00.000Z"
    });

  assert.strictEqual(
    approved.nextDocument
      .lifecycleStatus,
    "approved"
  );

  assert.strictEqual(
    approved.nextDocument
      .revision,
    4
  );

  assert.strictEqual(
    approved.nextDocument
      .moderatedBy,
    "moderator-2"
  );

  const changesRequested =
    buildQuestionModerationPlan({
      currentQuestion:
        pending,

      expectedRevision:
        3,

      decision:
        "request_changes",

      reason:
        "Rever alternativa B.",

      actorId:
        "moderator-2",

      timestamp:
        "2026-09-27T12:10:00.000Z"
    });

  assert.strictEqual(
    changesRequested.nextDocument
      .lifecycleStatus,
    "changes_requested"
  );

  expectDomainError(
    () =>
      buildQuestionModerationPlan({
        currentQuestion:
          pending,

        expectedRevision:
          3,

        decision:
          "request_changes",

        actorId:
          "moderator-2",

        timestamp:
          "time"
      }),
    "ADMIN_QUESTION_WRITE_MODERATION_REASON_REQUIRED"
  );

  expectDomainError(
    () =>
      buildQuestionModerationPlan({
        currentQuestion:
          sampleQuestion(
            "draft"
          ),

        expectedRevision:
          3,

        decision:
          "approve",

        actorId:
          "moderator-2",

        timestamp:
          "time"
      }),
    "ADMIN_QUESTION_WRITE_TRANSITION_INVALID"
  );

  const archived =
    buildQuestionArchivePlan({
      currentQuestion:
        sampleQuestion(
          "approved"
        ),

      expectedRevision:
        3,

      actorId:
        "admin-1",

      timestamp:
        "2026-09-27T12:20:00.000Z"
    });

  assert.strictEqual(
    archived.nextDocument
      .lifecycleStatus,
    "archived"
  );

  assert.strictEqual(
    archived.nextDocument
      .archivedBy,
    "admin-1"
  );

  assert.strictEqual(
    archived.nextDocument
      .revision,
    4
  );

  const archivedReplay =
    buildQuestionArchivePlan({
      currentQuestion:
        sampleQuestion(
          "archived"
        ),

      expectedRevision:
        3,

      actorId:
        "admin-1",

      timestamp:
        "time"
    });

  assert.strictEqual(
    archivedReplay.idempotent,
    true
  );

  assert.strictEqual(
    archivedReplay.changed,
    false
  );

  const createAudit =
    buildQuestionAuditEvent({
      actorId:
        "admin-1",

      actorRole:
        "content_admin",

      requestId:
        "request-2",

      questionId:
        "question-1",

      operation:
        "create",

      before:
        null,

      after:
        created,

      changedFields:
        [
          "statement",
          "correctAnswer"
        ],

      createdAt:
        "2026-09-27T12:30:00.000Z"
    });

  assert.strictEqual(
    createAudit.action,
    "admin.question.created"
  );

  assert.strictEqual(
    createAudit.before,
    null
  );

  assert.deepStrictEqual(
    createAudit.after,
    {
      lifecycleStatus:
        "draft",

      revision:
        1
    }
  );

  const auditJson =
    JSON.stringify(
      createAudit
    );

  assert.strictEqual(
    auditJson.includes(
      "Controlar o adversario"
    ),
    false
  );

  assert.strictEqual(
    auditJson.includes(
      '"correctAnswer":"A"'
    ),
    false
  );

  const importPlan =
    validateQuestionImportItems({
      actorId:
        "admin-1",

      timestamp:
        "2026-09-27T12:40:00.000Z",

      items: [
        sampleContent({
          statement:
            "Questao valida"
        }),

        {
          ...sampleContent({
            statement:
              "Tentativa de bypass"
          }),

          lifecycleStatus:
            "approved"
        },

        {
          ...sampleContent({
            statement:
              "Tentativa de collection"
          }),

          collection:
            "questoes"
        }
      ]
    });

  assert.strictEqual(
    importPlan.total,
    3
  );

  assert.strictEqual(
    importPlan.validItems.length,
    1
  );

  assert.strictEqual(
    importPlan.errors.length,
    2
  );

  assert.strictEqual(
    importPlan.validItems[0]
      .document.lifecycleStatus,
    "draft"
  );

  assert.strictEqual(
    importPlan.errors[0]
      .ok,
    false
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        importPlan.errors[0],
        "message"
      ),
    false
  );

  expectDomainError(
    () =>
      validateQuestionImportItems({
        actorId:
          "admin-1",

        timestamp:
          "time",

        items:
          Array.from(
            {
              length:
                26
            },
            () =>
              sampleContent()
          )
      }),
    "ADMIN_QUESTION_IMPORT_SIZE_INVALID"
  );

  const ROOT =
    path.resolve(
      __dirname,
      ".."
    );

  const source =
    fs.readFileSync(
      path.join(
        ROOT,
        "functions/src/admin/admin-question-write-domain.js"
      ),
      "utf8"
    );

  for (
    const forbidden
    of [
      "firebase-admin",
      "firebase-functions",
      ".collection(",
      ".doc(",
      "runTransaction",
      "onCall(",
      "defineSecret",
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "GEMINI_COURSE_MODERATION_API_KEY"
    ]
  ) {
    assert.strictEqual(
      source.includes(
        forbidden
      ),
      false,
      `Write domain must remain runtime-free: ${forbidden}`
    );
  }

  console.log(
    "MARCO8_QUESTION_WRITE_SCHEMA_VERSION=1"
  );

  console.log(
    "MARCO8_QUESTION_IMPORT_MAX_ITEMS=25"
  );

  console.log(
    "MARCO8_QUESTION_CREATE_DEFAULT_STATUS=draft"
  );

  console.log(
    "MARCO8_QUESTION_STRICT_INPUT_LENGTHS=PASSED"
  );

  console.log(
    "MARCO8_QUESTION_UNKNOWN_FIELDS=BLOCKED"
  );

  console.log(
    "MARCO8_QUESTION_REVISION_CONFLICT=BLOCKED"
  );

  console.log(
    "MARCO8_QUESTION_SUBMIT_FOR_REVIEW=PASSED"
  );

  console.log(
    "MARCO8_QUESTION_APPROVED_EDIT=pending_review"
  );

  console.log(
    "MARCO8_QUESTION_ARCHIVED_EDIT=BLOCKED"
  );

  console.log(
    "MARCO8_QUESTION_MODERATION=PASSED"
  );

  console.log(
    "MARCO8_QUESTION_ARCHIVE_IDEMPOTENCY=PASSED"
  );

  console.log(
    "MARCO8_QUESTION_AUDIT_ANSWER_KEY_EXPOSURE=False"
  );

  console.log(
    "MARCO8_QUESTION_IMPORT_AUTO_APPROVAL=False"
  );

  console.log(
    "MARCO8_QUESTION_IMPORT_ARBITRARY_COLLECTION=False"
  );

  console.log(
    "MARCO8_QUESTION_IMPORT_ITEM_ERRORS=SANITIZED"
  );

  console.log(
    "MARCO8_QUESTION_WRITE_DOMAIN_RUNTIME=False"
  );

  console.log(
    "MARCO8_ADMIN_QUESTION_WRITE_DOMAIN=PASSED"
  );
}

main();