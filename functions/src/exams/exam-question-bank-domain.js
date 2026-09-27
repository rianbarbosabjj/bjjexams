"use strict";

const {
  validateAlternatives,
  normalizeMedia
} = require(
  "./exam-question-domain"
);

const EXAM_QUESTION_BANK_COLLECTION =
  "exam_question_bank";

const EXAM_QUESTION_BANK_VERSION =
  1;

const EXAM_QUESTION_BANK_LIFECYCLE_STATUSES =
  Object.freeze([
    "draft",
    "pending_review",
    "approved",
    "changes_requested",
    "archived"
  ]);

const EXAM_QUESTION_BANK_CONTENT_FIELDS =
  Object.freeze([
    "statement",
    "options",
    "correctAnswer",
    "difficulty",
    "category",
    "media"
  ]);

const EXAM_QUESTION_BANK_TRANSITIONS =
  Object.freeze({
    draft:
      Object.freeze([
        "draft",
        "pending_review",
        "archived"
      ]),

    pending_review:
      Object.freeze([
        "pending_review",
        "approved",
        "changes_requested",
        "archived"
      ]),

    changes_requested:
      Object.freeze([
        "changes_requested",
        "pending_review",
        "archived"
      ]),

    approved:
      Object.freeze([
        "archived"
      ]),

    archived:
      Object.freeze([
        "archived"
      ])
  });

class ExamQuestionBankDomainError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "ExamQuestionBankDomainError";

    this.code =
      code;
  }
}

function text(
  value,
  maxLength = 200
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return null;
  }

  if (
    normalized.length >
    maxLength
  ) {
    return normalized.slice(
      0,
      maxLength
    );
  }

  return normalized;
}

function requiredText(
  value,
  field,
  maxLength = 200
) {
  if (
    typeof value !==
    "string"
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_INPUT_INVALID",
      `${field} is required.`
    );
  }

  const normalized =
    value.trim();

  if (
    !normalized ||
    normalized.length >
      maxLength
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_INPUT_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function optionalText(
  value,
  field,
  maxLength = 1000
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value !==
    "string"
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_INPUT_INVALID",
      `${field} is invalid.`
    );
  }

  const normalized =
    value.trim();

  if (!normalized) {
    return null;
  }

  if (
    normalized.length >
    maxLength
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_INPUT_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function requiredIdentifier(
  value,
  field
) {
  const normalized =
    requiredText(
      value,
      field,
      128
    );

  if (
    normalized.includes("/")
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function optionalIdentifier(
  value,
  field
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return requiredIdentifier(
    value,
    field
  );
}

function requiredTimestamp(
  value,
  field
) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_TIMESTAMP_REQUIRED",
      `${field} is required.`
    );
  }

  return value;
}

function optionalTimestamp(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  return value;
}

function normalizeQuestionBankVersion(
  value
) {
  const version =
    Number(value);

  if (
    !Number.isSafeInteger(
      version
    ) ||
    version !==
      EXAM_QUESTION_BANK_VERSION
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_VERSION_INVALID",
      "questionVersion is invalid."
    );
  }

  return version;
}

function normalizeQuestionBankRevision(
  value
) {
  const revision =
    Number(value);

  if (
    !Number.isSafeInteger(
      revision
    ) ||
    revision < 1
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_REVISION_INVALID",
      "revision must be a positive safe integer."
    );
  }

  return revision;
}

function nextQuestionBankRevision(
  value
) {
  const current =
    normalizeQuestionBankRevision(
      value
    );

  if (
    current >=
    Number.MAX_SAFE_INTEGER
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_REVISION_OVERFLOW",
      "revision cannot be incremented safely."
    );
  }

  return current + 1;
}

function normalizeQuestionBankDifficulty(
  value
) {
  const difficulty =
    Number(value);

  if (
    !Number.isSafeInteger(
      difficulty
    ) ||
    difficulty < 1 ||
    difficulty > 5
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_DIFFICULTY_INVALID",
      "difficulty must be an integer between 1 and 5."
    );
  }

  return difficulty;
}

function normalizeQuestionBankLifecycleStatus(
  value
) {
  const normalized =
    requiredText(
      value,
      "lifecycleStatus",
      40
    )
      .toLowerCase();

  if (
    !EXAM_QUESTION_BANK_LIFECYCLE_STATUSES
      .includes(
        normalized
      )
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_LIFECYCLE_INVALID",
      "Question lifecycle status is invalid."
    );
  }

  return normalized;
}

function normalizeQuestionBankOptions(
  input
) {
  try {
    const normalized =
      validateAlternatives(
        input
      );

    return Object.freeze({
      ...normalized
    });
  }
  catch (error) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_OPTIONS_INVALID",
      "options are invalid."
    );
  }
}

function normalizeQuestionBankCorrectAnswer(
  value,
  options
) {
  const answer =
    requiredText(
      value,
      "correctAnswer",
      10
    )
      .toUpperCase();

  if (
    !Object.prototype
      .hasOwnProperty.call(
        options,
        answer
      )
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_CORRECT_ANSWER_INVALID",
      "correctAnswer must reference an existing option."
    );
  }

  return answer;
}

function normalizeQuestionBankMedia(
  input
) {
  try {
    const normalized =
      normalizeMedia(
        input
      );

    return Object.freeze({
      imageUrl:
        normalized.imageUrl,

      videoUrl:
        normalized.videoUrl
    });
  }
  catch (error) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_MEDIA_INVALID",
      "media is invalid."
    );
  }
}

function validateModerationMetadata(
  input = {}
) {
  const moderatedAt =
    optionalTimestamp(
      input.moderatedAt
    );

  const moderatedBy =
    optionalIdentifier(
      input.moderatedBy,
      "moderatedBy"
    );

  const moderationReason =
    optionalText(
      input.moderationReason,
      "moderationReason",
      1200
    );

  const hasTime =
    moderatedAt !== null;

  const hasActor =
    moderatedBy !== null;

  if (
    hasTime !==
    hasActor
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_MODERATION_METADATA_INVALID",
      "moderatedAt and moderatedBy must be provided together."
    );
  }

  return Object.freeze({
    moderatedAt,
    moderatedBy,
    moderationReason
  });
}

function validateArchiveMetadata(
  input = {},
  lifecycleStatus
) {
  const archivedAt =
    optionalTimestamp(
      input.archivedAt
    );

  const archivedBy =
    optionalIdentifier(
      input.archivedBy,
      "archivedBy"
    );

  const hasTime =
    archivedAt !== null;

  const hasActor =
    archivedBy !== null;

  if (
    hasTime !==
    hasActor
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_ARCHIVE_METADATA_INVALID",
      "archivedAt and archivedBy must be provided together."
    );
  }

  if (
    lifecycleStatus ===
      "archived" &&
    !hasTime
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_ARCHIVE_METADATA_REQUIRED",
      "Archived questions require archivedAt and archivedBy."
    );
  }

  return Object.freeze({
    archivedAt,
    archivedBy
  });
}

function normalizeQuestionBankDocument(
  input = {}
) {
  return {
    questionVersion:
      Number(
        input.questionVersion
      ),

    statement:
      text(
        input.statement,
        4000
      ),

    options:
      input.options,

    correctAnswer:
      input.correctAnswer ??
      null,

    difficulty:
      Number(
        input.difficulty
      ),

    category:
      text(
        input.category,
        120
      ),

    media:
      input.media ??
      null,

    lifecycleStatus:
      text(
        input.lifecycleStatus,
        40
      ),

    authorId:
      text(
        input.authorId,
        128
      ),

    createdAt:
      input.createdAt ??
      null,

    updatedAt:
      input.updatedAt ??
      null,

    revision:
      Number(
        input.revision
      ),

    moderatedAt:
      input.moderatedAt ??
      null,

    moderatedBy:
      text(
        input.moderatedBy,
        128
      ),

    moderationReason:
      text(
        input.moderationReason,
        1200
      ),

    archivedAt:
      input.archivedAt ??
      null,

    archivedBy:
      text(
        input.archivedBy,
        128
      )
  };
}

function validateQuestionBankDocument(
  input = {}
) {
  const normalized =
    normalizeQuestionBankDocument(
      input
    );

  const questionVersion =
    normalizeQuestionBankVersion(
      normalized.questionVersion
    );

  const statement =
    requiredText(
      normalized.statement,
      "statement",
      4000
    );

  const options =
    normalizeQuestionBankOptions(
      normalized.options
    );

  const correctAnswer =
    normalizeQuestionBankCorrectAnswer(
      normalized.correctAnswer,
      options
    );

  const difficulty =
    normalizeQuestionBankDifficulty(
      normalized.difficulty
    );

  const category =
    requiredText(
      normalized.category,
      "category",
      120
    );

  const media =
    normalizeQuestionBankMedia(
      normalized.media
    );

  const lifecycleStatus =
    normalizeQuestionBankLifecycleStatus(
      normalized.lifecycleStatus
    );

  const authorId =
    requiredIdentifier(
      normalized.authorId,
      "authorId"
    );

  const createdAt =
    requiredTimestamp(
      normalized.createdAt,
      "createdAt"
    );

  const updatedAt =
    requiredTimestamp(
      normalized.updatedAt,
      "updatedAt"
    );

  const revision =
    normalizeQuestionBankRevision(
      normalized.revision
    );

  const moderation =
    validateModerationMetadata(
      normalized
    );

  const archive =
    validateArchiveMetadata(
      normalized,
      lifecycleStatus
    );

  return Object.freeze({
    questionVersion,
    statement,
    options,
    correctAnswer,
    difficulty,
    category,
    media,
    lifecycleStatus,
    authorId,
    createdAt,
    updatedAt,
    revision,

    moderatedAt:
      moderation.moderatedAt,

    moderatedBy:
      moderation.moderatedBy,

    moderationReason:
      moderation.moderationReason,

    archivedAt:
      archive.archivedAt,

    archivedBy:
      archive.archivedBy
  });
}

function buildNewQuestionBankDocument(
  input = {}
) {
  const timestamp =
    requiredTimestamp(
      input.timestamp,
      "timestamp"
    );

  return validateQuestionBankDocument({
    questionVersion:
      EXAM_QUESTION_BANK_VERSION,

    statement:
      input.statement,

    options:
      input.options,

    correctAnswer:
      input.correctAnswer,

    difficulty:
      input.difficulty,

    category:
      input.category,

    media:
      input.media,

    lifecycleStatus:
      "draft",

    authorId:
      input.authorId,

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

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
      null
  });
}

function resolveQuestionBankLifecycleTransition(
  input = {}
) {
  const currentStatus =
    normalizeQuestionBankLifecycleStatus(
      input.currentStatus
    );

  const targetStatus =
    normalizeQuestionBankLifecycleStatus(
      input.targetStatus
    );

  const allowedTargets =
    EXAM_QUESTION_BANK_TRANSITIONS[
      currentStatus
    ];

  if (
    !allowedTargets.includes(
      targetStatus
    )
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_TRANSITION_INVALID",
      `Transition from ${currentStatus} to ${targetStatus} is not allowed.`
    );
  }

  return Object.freeze({
    currentStatus,
    targetStatus,

    idempotent:
      currentStatus ===
      targetStatus
  });
}

function resolveQuestionBankStatusAfterContentEdit(
  currentStatusInput
) {
  const currentStatus =
    normalizeQuestionBankLifecycleStatus(
      currentStatusInput
    );

  if (
    currentStatus ===
    "archived"
  ) {
    throw new ExamQuestionBankDomainError(
      "EXAM_QUESTION_BANK_CONTENT_EDIT_ARCHIVED",
      "Archived questions cannot be edited."
    );
  }

  if (
    currentStatus ===
    "approved"
  ) {
    return "pending_review";
  }

  return currentStatus;
}

module.exports = {
  EXAM_QUESTION_BANK_COLLECTION,
  EXAM_QUESTION_BANK_VERSION,

  EXAM_QUESTION_BANK_LIFECYCLE_STATUSES,
  EXAM_QUESTION_BANK_CONTENT_FIELDS,
  EXAM_QUESTION_BANK_TRANSITIONS,

  ExamQuestionBankDomainError,

  requiredText,
  requiredIdentifier,
  requiredTimestamp,

  normalizeQuestionBankVersion,
  normalizeQuestionBankRevision,
  nextQuestionBankRevision,
  normalizeQuestionBankDifficulty,
  normalizeQuestionBankLifecycleStatus,
  normalizeQuestionBankOptions,
  normalizeQuestionBankCorrectAnswer,
  normalizeQuestionBankMedia,

  validateModerationMetadata,
  validateArchiveMetadata,

  normalizeQuestionBankDocument,
  validateQuestionBankDocument,
  buildNewQuestionBankDocument,

  resolveQuestionBankLifecycleTransition,
  resolveQuestionBankStatusAfterContentEdit
};