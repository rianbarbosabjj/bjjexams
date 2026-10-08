"use strict";

const assert =
  require("assert");

const {
  QUESTION_VIEW_FIELDS,
  QUESTION_AUTHOR_SUMMARY_FIELDS,
  QUESTION_AUTHORING_VIEW_FIELDS,
  QUESTION_MODERATION_SUMMARY_FIELDS,

  AdminQuestionModelError,

  buildOperationalQuestionView,
  buildOperationalQuestionAuthoringView
} = require(
  "../functions/src/admin/admin-question-models"
);

function sampleQuestion(
  overrides = {}
) {
  return {
    questionVersion:
      1,

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

    lifecycleStatus:
      "approved",

    authorId:
      "author-1",

    createdAt:
      "2026-09-27T10:00:00.000Z",

    updatedAt:
      "2026-09-27T11:00:00.000Z",

    revision:
      3,

    moderatedAt:
      "2026-09-27T10:30:00.000Z",

    moderatedBy:
      "moderator-1",

    moderationReason:
      "Reviewed and approved.",

    archivedAt:
      null,

    archivedBy:
      null,

    ...overrides
  };
}

function expectModelError(
  operation,
  code
) {
  let caught = null;

  try {
    operation();
  }
  catch (error) {
    caught =
      error;
  }

  assert.ok(caught);

  assert.ok(
    caught instanceof
      AdminQuestionModelError
  );

  assert.strictEqual(
    caught.code,
    code
  );
}

function main() {
  assert.deepStrictEqual(
    QUESTION_VIEW_FIELDS,
    [
      "questionId",
      "statement",
      "options",
      "difficulty",
      "category",
      "lifecycleStatus",
      "authorSummary",
      "createdAt",
      "updatedAt"
    ]
  );

  assert.deepStrictEqual(
    QUESTION_AUTHOR_SUMMARY_FIELDS,
    [
      "authorId",
      "displayName"
    ]
  );

  assert.deepStrictEqual(
    QUESTION_AUTHORING_VIEW_FIELDS,
    [
      ...QUESTION_VIEW_FIELDS,
      "correctAnswer",
      "revision",
      "moderationSummary"
    ]
  );

  assert.deepStrictEqual(
    QUESTION_MODERATION_SUMMARY_FIELDS,
    [
      "moderatedAt",
      "moderatedBy",
      "moderationReason"
    ]
  );

  const operational =
    buildOperationalQuestionView({
      questionId:
        "question-1",

      question:
        sampleQuestion(),

      authorSummary: {
        authorId:
          "different-id-must-not-win",

        displayName:
          "Admin Author",

        email:
          "secret@example.com"
      }
    });

  assert.deepStrictEqual(
    Object.keys(operational),
    QUESTION_VIEW_FIELDS
  );

  assert.strictEqual(
    operational.questionId,
    "question-1"
  );

  assert.strictEqual(
    operational.statement,
    "Qual e o objetivo da guarda fechada?"
  );

  assert.strictEqual(
    operational.lifecycleStatus,
    "approved"
  );

  assert.deepStrictEqual(
    operational.authorSummary,
    {
      authorId:
        "author-1",

      displayName:
        "Admin Author"
    }
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        operational,
        "correctAnswer"
      ),
    false
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        operational,
        "revision"
      ),
    false
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        operational,
        "moderationSummary"
      ),
    false
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        operational,
        "media"
      ),
    false
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        operational,
        "archivedBy"
      ),
    false
  );

  assert.ok(
    Object.isFrozen(
      operational
    )
  );

  assert.ok(
    Object.isFrozen(
      operational.options
    )
  );

  assert.ok(
    Object.isFrozen(
      operational.authorSummary
    )
  );

  const authoring =
    buildOperationalQuestionAuthoringView({
      questionId:
        "question-1",

      question:
        sampleQuestion(),

      authorSummary: {
        displayName:
          "Admin Author"
      }
    });

  assert.deepStrictEqual(
    Object.keys(authoring),
    QUESTION_AUTHORING_VIEW_FIELDS
  );

  assert.strictEqual(
    authoring.correctAnswer,
    "A"
  );

  assert.strictEqual(
    authoring.revision,
    3
  );

  assert.deepStrictEqual(
    authoring.moderationSummary,
    {
      moderatedAt:
        "2026-09-27T10:30:00.000Z",

      moderatedBy:
        "moderator-1",

      moderationReason:
        "Reviewed and approved."
    }
  );

  assert.ok(
    Object.isFrozen(
      authoring.moderationSummary
    )
  );

  expectModelError(
    () =>
      buildOperationalQuestionView({
        questionId:
          "bad/id",

        question:
          sampleQuestion()
      }),
    "ADMIN_QUESTION_ID_INVALID"
  );

  expectModelError(
    () =>
      buildOperationalQuestionView({
        questionId:
          "question-1",

        question:
          sampleQuestion({
            correctAnswer:
              "D"
          })
      }),
    "ADMIN_QUESTION_CANONICAL_STATE_INVALID"
  );

  console.log(
    "MARCO8_QUESTION_OPERATIONAL_VIEW_FIELDS=9/9"
  );

  console.log(
    "MARCO8_QUESTION_AUTHOR_SUMMARY_FIELDS=2/2"
  );

  console.log(
    "MARCO8_QUESTION_AUTHORING_VIEW_FIELDS=12/12"
  );

  console.log(
    "MARCO8_QUESTION_MODERATION_SUMMARY_FIELDS=3/3"
  );

  console.log(
    "MARCO8_QUESTION_READ_ANSWER_KEY_EXPOSURE=False"
  );

  console.log(
    "MARCO8_QUESTION_AUTHORING_ANSWER_KEY_EXPOSURE=True"
  );

  console.log(
    "MARCO8_QUESTION_MEDIA_EXPOSURE=False"
  );

  console.log(
    "MARCO8_QUESTION_MODEL_SANITIZATION=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_QUESTION_MODELS=PASSED"
  );
}

main();