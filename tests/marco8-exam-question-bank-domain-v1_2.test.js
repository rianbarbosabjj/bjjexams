"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  EXAM_QUESTION_BANK_COLLECTION,
  EXAM_QUESTION_BANK_VERSION,

  EXAM_QUESTION_BANK_LIFECYCLE_STATUSES,
  EXAM_QUESTION_BANK_CONTENT_FIELDS,
  EXAM_QUESTION_BANK_TRANSITIONS,

  ExamQuestionBankDomainError,

  normalizeQuestionBankRevision,
  nextQuestionBankRevision,
  normalizeQuestionBankDifficulty,
  normalizeQuestionBankLifecycleStatus,

  validateQuestionBankDocument,
  buildNewQuestionBankDocument,

  resolveQuestionBankLifecycleTransition,
  resolveQuestionBankStatusAfterContentEdit
} = require(
  "../functions/src/exams/exam-question-bank-domain"
);

function expectDomainError(
  operation,
  expectedCode
) {
  let received = null;

  try {
    operation();
  }
  catch (error) {
    received =
      error;
  }

  assert.ok(
    received,
    `Expected ${expectedCode}`
  );

  assert.ok(
    received instanceof
      ExamQuestionBankDomainError
  );

  assert.strictEqual(
    received.code,
    expectedCode
  );

  return received;
}

function sampleDocument(
  overrides = {}
) {
  return {
    questionVersion:
      1,

    statement:
      "Qual e a finalidade principal da guarda fechada?",

    options: {
      A:
        "Controlar o adversario entre as pernas.",

      B:
        "Aplicar uma queda obrigatoriamente.",

      C:
        "Encerrar a luta sem controle."
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

    lifecycleStatus:
      "draft",

    authorId:
      "author-1",

    createdAt:
      "timestamp-1",

    updatedAt:
      "timestamp-1",

    revision:
      1,

    moderatedAt:
      null,

    moderatedBy:
      null,

    moderationReason:
      null,

    archivedAt:
      null,

    archivedBy:
      null,

    ...overrides
  };
}

function assertTransition(
  currentStatus,
  targetStatus,
  expectedIdempotent
) {
  const transition =
    resolveQuestionBankLifecycleTransition({
      currentStatus,
      targetStatus
    });

  assert.deepStrictEqual(
    transition,
    {
      currentStatus,
      targetStatus,
      idempotent:
        expectedIdempotent
    }
  );
}

function main() {
  assert.strictEqual(
    EXAM_QUESTION_BANK_COLLECTION,
    "exam_question_bank"
  );

  assert.strictEqual(
    EXAM_QUESTION_BANK_VERSION,
    1
  );

  assert.deepStrictEqual(
    EXAM_QUESTION_BANK_LIFECYCLE_STATUSES,
    [
      "draft",
      "pending_review",
      "approved",
      "changes_requested",
      "archived"
    ]
  );

  assert.deepStrictEqual(
    EXAM_QUESTION_BANK_CONTENT_FIELDS,
    [
      "statement",
      "options",
      "correctAnswer",
      "difficulty",
      "category",
      "media"
    ]
  );

  assert.deepStrictEqual(
    EXAM_QUESTION_BANK_TRANSITIONS,
    {
      draft: [
        "draft",
        "pending_review",
        "archived"
      ],

      pending_review: [
        "pending_review",
        "approved",
        "changes_requested",
        "archived"
      ],

      changes_requested: [
        "changes_requested",
        "pending_review",
        "archived"
      ],

      approved: [
        "archived"
      ],

      archived: [
        "archived"
      ]
    }
  );

  const created =
    buildNewQuestionBankDocument({
      statement:
        "O que caracteriza a montada?",

      options: {
        A:
          "Posicao de controle por cima.",

        B:
          "Uma pegada exclusiva de judo."
      },

      correctAnswer:
        "A",

      difficulty:
        1,

      category:
        "Posicoes",

      media:
        null,

      authorId:
        "author-1",

      timestamp:
        "timestamp-create"
    });

  assert.strictEqual(
    created.questionVersion,
    1
  );

  assert.strictEqual(
    created.lifecycleStatus,
    "draft"
  );

  assert.strictEqual(
    created.revision,
    1
  );

  assert.strictEqual(
    created.createdAt,
    "timestamp-create"
  );

  assert.strictEqual(
    created.updatedAt,
    "timestamp-create"
  );

  assert.strictEqual(
    created.correctAnswer,
    "A"
  );

  assert.ok(
    Object.isFrozen(
      created
    )
  );

  assert.ok(
    Object.isFrozen(
      created.options
    )
  );

  assert.ok(
    Object.isFrozen(
      created.media
    )
  );

  const validated =
    validateQuestionBankDocument(
      sampleDocument()
    );

  assert.strictEqual(
    validated.statement,
    "Qual e a finalidade principal da guarda fechada?"
  );

  assert.deepStrictEqual(
    validated.options,
    {
      A:
        "Controlar o adversario entre as pernas.",

      B:
        "Aplicar uma queda obrigatoriamente.",

      C:
        "Encerrar a luta sem controle."
    }
  );

  assert.strictEqual(
    validated.correctAnswer,
    "A"
  );

  assert.strictEqual(
    validated.category,
    "Fundamentos"
  );

  assert.deepStrictEqual(
    validated.media,
    {
      imageUrl:
        null,

      videoUrl:
        null
    }
  );

  // Canonical lifecycle transitions.
  assertTransition(
    "draft",
    "draft",
    true
  );

  assertTransition(
    "draft",
    "pending_review",
    false
  );

  assertTransition(
    "draft",
    "archived",
    false
  );

  assertTransition(
    "pending_review",
    "pending_review",
    true
  );

  assertTransition(
    "pending_review",
    "approved",
    false
  );

  assertTransition(
    "pending_review",
    "changes_requested",
    false
  );

  assertTransition(
    "pending_review",
    "archived",
    false
  );

  assertTransition(
    "changes_requested",
    "changes_requested",
    true
  );

  assertTransition(
    "changes_requested",
    "pending_review",
    false
  );

  assertTransition(
    "changes_requested",
    "archived",
    false
  );

  assertTransition(
    "approved",
    "archived",
    false
  );

  assertTransition(
    "archived",
    "archived",
    true
  );

  // Direct approval bypass is forbidden.
  expectDomainError(
    () =>
      resolveQuestionBankLifecycleTransition({
        currentStatus:
          "draft",

        targetStatus:
          "approved"
      }),
    "EXAM_QUESTION_BANK_TRANSITION_INVALID"
  );

  // Approved content cannot remain approved.
  expectDomainError(
    () =>
      resolveQuestionBankLifecycleTransition({
        currentStatus:
          "approved",

        targetStatus:
          "pending_review"
      }),
    "EXAM_QUESTION_BANK_TRANSITION_INVALID"
  );

  assert.strictEqual(
    resolveQuestionBankStatusAfterContentEdit(
      "approved"
    ),
    "pending_review"
  );

  assert.strictEqual(
    resolveQuestionBankStatusAfterContentEdit(
      "draft"
    ),
    "draft"
  );

  assert.strictEqual(
    resolveQuestionBankStatusAfterContentEdit(
      "pending_review"
    ),
    "pending_review"
  );

  assert.strictEqual(
    resolveQuestionBankStatusAfterContentEdit(
      "changes_requested"
    ),
    "changes_requested"
  );

  expectDomainError(
    () =>
      resolveQuestionBankStatusAfterContentEdit(
        "archived"
      ),
    "EXAM_QUESTION_BANK_CONTENT_EDIT_ARCHIVED"
  );

  expectDomainError(
    () =>
      resolveQuestionBankLifecycleTransition({
        currentStatus:
          "archived",

        targetStatus:
          "draft"
      }),
    "EXAM_QUESTION_BANK_TRANSITION_INVALID"
  );

  expectDomainError(
    () =>
      normalizeQuestionBankLifecycleStatus(
        "published"
      ),
    "EXAM_QUESTION_BANK_LIFECYCLE_INVALID"
  );

  // Question version is canonical and fixed.
  expectDomainError(
    () =>
      validateQuestionBankDocument(
        sampleDocument({
          questionVersion:
            2
        })
      ),
    "EXAM_QUESTION_BANK_VERSION_INVALID"
  );

  // Revision is monotonic and positive.
  assert.strictEqual(
    normalizeQuestionBankRevision(
      1
    ),
    1
  );

  assert.strictEqual(
    nextQuestionBankRevision(
      1
    ),
    2
  );

  expectDomainError(
    () =>
      normalizeQuestionBankRevision(
        0
      ),
    "EXAM_QUESTION_BANK_REVISION_INVALID"
  );

  expectDomainError(
    () =>
      nextQuestionBankRevision(
        Number.MAX_SAFE_INTEGER
      ),
    "EXAM_QUESTION_BANK_REVISION_OVERFLOW"
  );

  // Difficulty stays aligned with official exam snapshot rules.
  for (
    const difficulty
    of [
      1,
      2,
      3,
      4,
      5
    ]
  ) {
    assert.strictEqual(
      normalizeQuestionBankDifficulty(
        difficulty
      ),
      difficulty
    );
  }

  for (
    const difficulty
    of [
      0,
      6,
      1.5,
      "abc"
    ]
  ) {
    expectDomainError(
      () =>
        normalizeQuestionBankDifficulty(
          difficulty
        ),
      "EXAM_QUESTION_BANK_DIFFICULTY_INVALID"
    );
  }

  // Options reuse canonical exam structural rules.
  expectDomainError(
    () =>
      validateQuestionBankDocument(
        sampleDocument({
          options: {
            A:
              "Somente uma alternativa."
          }
        })
      ),
    "EXAM_QUESTION_BANK_OPTIONS_INVALID"
  );

  expectDomainError(
    () =>
      validateQuestionBankDocument(
        sampleDocument({
          options: {
            A:
              "Opcao A",

            E:
              "Opcao nao suportada"
          }
        })
      ),
    "EXAM_QUESTION_BANK_OPTIONS_INVALID"
  );

  // Answer key must point to an existing option.
  expectDomainError(
    () =>
      validateQuestionBankDocument(
        sampleDocument({
          correctAnswer:
            "D"
        })
      ),
    "EXAM_QUESTION_BANK_CORRECT_ANSWER_INVALID"
  );

  // Media reuses the HTTPS-only canonical validation.
  expectDomainError(
    () =>
      validateQuestionBankDocument(
        sampleDocument({
          media: {
            imageUrl:
              "http://example.com/question.png",

            videoUrl:
              null
          }
        })
      ),
    "EXAM_QUESTION_BANK_MEDIA_INVALID"
  );

  const secureMedia =
    validateQuestionBankDocument(
      sampleDocument({
        media: {
          imageUrl:
            "https://example.com/question.png",

          videoUrl:
            "https://example.com/question.mp4"
        }
      })
    );

  assert.ok(
    secureMedia
      .media
      .imageUrl
      .startsWith(
        "https://"
      )
  );

  assert.ok(
    secureMedia
      .media
      .videoUrl
      .startsWith(
        "https://"
      )
  );

  // Moderation metadata must remain paired.
  expectDomainError(
    () =>
      validateQuestionBankDocument(
        sampleDocument({
          moderatedAt:
            "timestamp-moderation",

          moderatedBy:
            null
        })
      ),
    "EXAM_QUESTION_BANK_MODERATION_METADATA_INVALID"
  );

  const moderated =
    validateQuestionBankDocument(
      sampleDocument({
        lifecycleStatus:
          "approved",

        moderatedAt:
          "timestamp-moderation",

        moderatedBy:
          "moderator-1",

        moderationReason:
          "Question reviewed."
      })
    );

  assert.strictEqual(
    moderated.moderatedBy,
    "moderator-1"
  );

  // Archive metadata must remain paired and archived status requires it.
  expectDomainError(
    () =>
      validateQuestionBankDocument(
        sampleDocument({
          lifecycleStatus:
            "archived"
        })
      ),
    "EXAM_QUESTION_BANK_ARCHIVE_METADATA_REQUIRED"
  );

  expectDomainError(
    () =>
      validateQuestionBankDocument(
        sampleDocument({
          archivedAt:
            "timestamp-archive",

          archivedBy:
            null
        })
      ),
    "EXAM_QUESTION_BANK_ARCHIVE_METADATA_INVALID"
  );

  const archived =
    validateQuestionBankDocument(
      sampleDocument({
        lifecycleStatus:
          "archived",

        archivedAt:
          "timestamp-archive",

        archivedBy:
          "admin-1"
      })
    );

  assert.strictEqual(
    archived.lifecycleStatus,
    "archived"
  );

  assert.strictEqual(
    archived.archivedBy,
    "admin-1"
  );

  // Identifiers cannot escape document boundaries.
  expectDomainError(
    () =>
      validateQuestionBankDocument(
        sampleDocument({
          authorId:
            "users/author-1"
        })
      ),
    "EXAM_QUESTION_BANK_IDENTIFIER_INVALID"
  );

  // Static purity: this foundation is domain-only.
  const ROOT =
    path.resolve(
      __dirname,
      ".."
    );

  const domainSource =
    fs.readFileSync(
      path.join(
        ROOT,
        "functions/src/exams/exam-question-bank-domain.js"
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
      "onCall(",
      "defineSecret",
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "GEMINI_COURSE_MODERATION_API_KEY"
    ]
  ) {
    assert.strictEqual(
      domainSource.includes(
        forbidden
      ),
      false,
      `Question bank domain must not depend on ${forbidden}`
    );
  }

  // Snapshot domain must remain a separate module.
  const snapshotSource =
    fs.readFileSync(
      path.join(
        ROOT,
        "functions/src/exams/exam-question-domain.js"
      ),
      "utf8"
    );

  assert.strictEqual(
    snapshotSource.includes(
      'require("./exam-question-bank-domain")'
    ),
    false,
    "Snapshot domain must not depend on editable question bank domain."
  );

  const publicStart =
    snapshotSource.indexOf(
      "function publicExamQuestion"
    );

  const immutableStart =
    snapshotSource.indexOf(
      "function assertExamQuestionSnapshotImmutable"
    );

  assert.ok(
    publicStart >= 0 &&
    immutableStart >
      publicStart
  );

  const publicBlock =
    snapshotSource.slice(
      publicStart,
      immutableStart
    );

  assert.strictEqual(
    publicBlock.includes(
      "correctAnswer"
    ),
    false,
    "Public exam question must not expose correctAnswer."
  );

  console.log(
    "MARCO8_QUESTION_BANK_COLLECTION=exam_question_bank"
  );

  console.log(
    "MARCO8_QUESTION_BANK_VERSION=1"
  );

  console.log(
    "MARCO8_QUESTION_BANK_LIFECYCLE_STATUSES=5/5"
  );

  console.log(
    "MARCO8_QUESTION_BANK_CONTENT_FIELDS=6/6"
  );

  console.log(
    "MARCO8_QUESTION_BANK_DRAFT_APPROVAL_BYPASS=BLOCKED"
  );

  console.log(
    "MARCO8_QUESTION_BANK_APPROVED_EDIT=pending_review"
  );

  console.log(
    "MARCO8_QUESTION_BANK_ARCHIVED_EDIT=BLOCKED"
  );

  console.log(
    "MARCO8_QUESTION_BANK_REVISION=MONOTONIC"
  );

  console.log(
    "MARCO8_QUESTION_BANK_OPTIONS=CANONICAL_EXAM_RULES"
  );

  console.log(
    "MARCO8_QUESTION_BANK_MEDIA=HTTPS_ONLY"
  );

  console.log(
    "MARCO8_QUESTION_BANK_ANSWER_KEY=AUTHORING_PRIVILEGED_FIELD"
  );

  console.log(
    "MARCO8_QUESTION_SNAPSHOT_BOUNDARY=UNTOUCHED"
  );

  console.log(
    "MARCO8_QUESTION_BANK_FIRESTORE_RUNTIME=False"
  );

  console.log(
    "MARCO8_EXAM_QUESTION_BANK_DOMAIN=PASSED"
  );
}

main();