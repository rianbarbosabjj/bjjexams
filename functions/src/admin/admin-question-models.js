"use strict";

const {
  cleanText,
  toIsoTimestamp
} = require(
  "./admin-directory-models"
);

const {
  validateQuestionBankDocument
} = require(
  "../exams/exam-question-bank-domain"
);

const QUESTION_VIEW_FIELDS =
  Object.freeze([
    "questionId",
    "statement",
    "options",
    "difficulty",
    "category",
    "lifecycleStatus",
    "authorSummary",
    "createdAt",
    "updatedAt"
  ]);

const QUESTION_AUTHOR_SUMMARY_FIELDS =
  Object.freeze([
    "authorId",
    "displayName"
  ]);

const QUESTION_AUTHORING_VIEW_FIELDS =
  Object.freeze([
    ...QUESTION_VIEW_FIELDS,
    "correctAnswer",
    "revision",
    "moderationSummary"
  ]);

const QUESTION_MODERATION_SUMMARY_FIELDS =
  Object.freeze([
    "moderatedAt",
    "moderatedBy",
    "moderationReason"
  ]);

class AdminQuestionModelError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminQuestionModelError";

    this.code =
      code;
  }
}

function requiredQuestionId(
  value
) {
  const id =
    cleanText(
      value,
      128
    );

  if (
    !id ||
    id.includes("/")
  ) {
    throw new AdminQuestionModelError(
      "ADMIN_QUESTION_ID_INVALID",
      "questionId is invalid."
    );
  }

  return id;
}

function canonicalQuestion(
  value
) {
  try {
    return validateQuestionBankDocument(
      value
    );
  }
  catch (_) {
    throw new AdminQuestionModelError(
      "ADMIN_QUESTION_CANONICAL_STATE_INVALID",
      "Question canonical state is invalid."
    );
  }
}

function buildQuestionAuthorSummary(
  question,
  input = {}
) {
  const source =
    input &&
    typeof input === "object" &&
    !Array.isArray(input)
      ? input
      : {};

  return Object.freeze({
    authorId:
      question.authorId,

    displayName:
      cleanText(
        source.displayName ||
        source.nome ||
        source.name ||
        source.nome_completo,
        180
      )
  });
}

function buildQuestionModerationSummary(
  question
) {
  return Object.freeze({
    moderatedAt:
      toIsoTimestamp(
        question.moderatedAt
      ),

    moderatedBy:
      cleanText(
        question.moderatedBy,
        128
      ),

    moderationReason:
      cleanText(
        question.moderationReason,
        1200
      )
  });
}

function buildOperationalQuestionFromCanonical(
  input = {}
) {
  const questionId =
    requiredQuestionId(
      input.questionId
    );

  const question =
    input.question;

  return Object.freeze({
    questionId,

    statement:
      question.statement,

    options:
      Object.freeze({
        ...question.options
      }),

    difficulty:
      question.difficulty,

    category:
      question.category,

    lifecycleStatus:
      question.lifecycleStatus,

    authorSummary:
      buildQuestionAuthorSummary(
        question,
        input.authorSummary
      ),

    createdAt:
      toIsoTimestamp(
        question.createdAt
      ),

    updatedAt:
      toIsoTimestamp(
        question.updatedAt
      )
  });
}

function buildOperationalQuestionView(
  input = {}
) {
  const question =
    canonicalQuestion(
      input.question
    );

  return buildOperationalQuestionFromCanonical({
    ...input,
    question
  });
}

function buildOperationalQuestionAuthoringView(
  input = {}
) {
  const question =
    canonicalQuestion(
      input.question
    );

  const operational =
    buildOperationalQuestionFromCanonical({
      ...input,
      question
    });

  return Object.freeze({
    ...operational,

    correctAnswer:
      question.correctAnswer,

    revision:
      question.revision,

    moderationSummary:
      buildQuestionModerationSummary(
        question
      )
  });
}

module.exports = {
  QUESTION_VIEW_FIELDS,
  QUESTION_AUTHOR_SUMMARY_FIELDS,
  QUESTION_AUTHORING_VIEW_FIELDS,
  QUESTION_MODERATION_SUMMARY_FIELDS,

  AdminQuestionModelError,

  requiredQuestionId,
  canonicalQuestion,
  buildQuestionAuthorSummary,
  buildQuestionModerationSummary,

  buildOperationalQuestionView,
  buildOperationalQuestionAuthoringView
};