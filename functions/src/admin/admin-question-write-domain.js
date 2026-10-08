"use strict";

const {
  EXAM_QUESTION_BANK_CONTENT_FIELDS,
  ExamQuestionBankDomainError,
  normalizeQuestionBankOptions,
  normalizeQuestionBankCorrectAnswer,
  normalizeQuestionBankDifficulty,
  normalizeQuestionBankMedia,
  normalizeQuestionBankLifecycleStatus,
  normalizeQuestionBankRevision,
  nextQuestionBankRevision,
  validateQuestionBankDocument,
  buildNewQuestionBankDocument,
  resolveQuestionBankLifecycleTransition,
  resolveQuestionBankStatusAfterContentEdit
} = require(
  "../exams/exam-question-bank-domain"
);

const ADMIN_QUESTION_WRITE_SCHEMA_VERSION = 1;
const ADMIN_QUESTION_IMPORT_MAX_ITEMS = 25;

const ADMIN_QUESTION_MODERATION_DECISIONS =
  Object.freeze({
    approve:
      "approved",

    request_changes:
      "changes_requested"
  });

const ADMIN_QUESTION_AUDIT_ACTIONS =
  Object.freeze({
    create:
      "admin.question.created",

    update:
      "admin.question.updated",

    submit:
      "admin.question.submitted_for_review",

    moderate:
      "admin.question.moderated",

    archive:
      "admin.question.archived",

    import:
      "admin.question.imported"
  });

const ADMIN_QUESTION_AUDIT_OPERATIONS =
  Object.freeze(
    Object.keys(
      ADMIN_QUESTION_AUDIT_ACTIONS
    )
  );

class AdminQuestionWriteDomainError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminQuestionWriteDomainError";

    this.code =
      code;
  }
}

function requiredWriteText(
  value,
  field,
  maxLength = 200
) {
  if (
    typeof value !==
    "string"
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_INPUT_INVALID",
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
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_INPUT_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function optionalWriteText(
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

  return requiredWriteText(
    value,
    field,
    maxLength
  );
}

function requiredWriteIdentifier(
  value,
  field
) {
  const normalized =
    requiredWriteText(
      value,
      field,
      128
    );

  if (
    normalized.includes("/")
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function optionalWriteIdentifier(
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

  return requiredWriteIdentifier(
    value,
    field
  );
}

function requiredWriteTimestamp(
  value,
  field
) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_TIMESTAMP_INVALID",
      `${field} is required.`
    );
  }

  return value;
}

function requiredExpectedRevision(
  value
) {
  try {
    return normalizeQuestionBankRevision(
      value
    );
  }
  catch (_) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_EXPECTED_REVISION_INVALID",
      "expectedRevision must be a positive safe integer."
    );
  }
}

function assertPlainObject(
  value,
  field
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_INPUT_INVALID",
      `${field} must be an object.`
    );
  }

  return value;
}

function assertOnlyFields(
  value,
  allowedFields,
  field
) {
  const source =
    assertPlainObject(
      value,
      field
    );

  const allowed =
    new Set(
      allowedFields
    );

  const unsupported =
    Object.keys(source)
      .filter(
        key =>
          !allowed.has(key)
      )
      .sort();

  if (
    unsupported.length > 0
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_UNSUPPORTED_FIELDS",
      `${field} contains unsupported fields.`
    );
  }

  return source;
}

function normalizeStrictOptionsInput(
  input
) {
  const source =
    assertPlainObject(
      input,
      "options"
    );

  for (
    const [rawLabel, rawValue]
    of Object.entries(source)
  ) {
    requiredWriteText(
      rawLabel,
      "optionLabel",
      10
    );

    requiredWriteText(
      rawValue,
      `options.${rawLabel}`,
      1200
    );
  }

  try {
    return normalizeQuestionBankOptions(
      source
    );
  }
  catch (_) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_CONTENT_INVALID",
      "options are invalid."
    );
  }
}

function normalizeStrictMediaInput(
  input
) {
  if (
    input === undefined ||
    input === null
  ) {
    return normalizeQuestionBankMedia(
      null
    );
  }

  const source =
    assertOnlyFields(
      input,
      [
        "imageUrl",
        "videoUrl"
      ],
      "media"
    );

  for (
    const field
    of [
      "imageUrl",
      "videoUrl"
    ]
  ) {
    if (
      Object.prototype
        .hasOwnProperty.call(
          source,
          field
        ) &&
      source[field] !== null &&
      source[field] !== undefined &&
      source[field] !== ""
    ) {
      requiredWriteText(
        source[field],
        `media.${field}`,
        2000
      );
    }
  }

  try {
    return normalizeQuestionBankMedia(
      source
    );
  }
  catch (_) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_CONTENT_INVALID",
      "media is invalid."
    );
  }
}

function normalizeStrictQuestionContent(
  input,
  options = {}
) {
  const partial =
    options.partial === true;

  const source =
    assertOnlyFields(
      input,
      EXAM_QUESTION_BANK_CONTENT_FIELDS,
      partial
        ? "patch"
        : "content"
    );

  const keys =
    Object.keys(source);

  if (
    partial &&
    keys.length === 0
  ) {
    return Object.freeze({});
  }

  if (!partial) {
    for (
      const field
      of [
        "statement",
        "options",
        "correctAnswer",
        "difficulty",
        "category"
      ]
    ) {
      if (
        !Object.prototype
          .hasOwnProperty.call(
            source,
            field
          )
      ) {
        throw new AdminQuestionWriteDomainError(
          "ADMIN_QUESTION_WRITE_CONTENT_REQUIRED",
          `${field} is required.`
        );
      }
    }
  }

  const result = {};

  if (
    Object.prototype
      .hasOwnProperty.call(
        source,
        "statement"
      )
  ) {
    result.statement =
      requiredWriteText(
        source.statement,
        "statement",
        4000
      );
  }

  if (
    Object.prototype
      .hasOwnProperty.call(
        source,
        "options"
      )
  ) {
    result.options =
      normalizeStrictOptionsInput(
        source.options
      );
  }

  if (
    Object.prototype
      .hasOwnProperty.call(
        source,
        "correctAnswer"
      )
  ) {
    result.correctAnswer =
      requiredWriteText(
        source.correctAnswer,
        "correctAnswer",
        10
      )
        .toUpperCase();
  }

  if (
    Object.prototype
      .hasOwnProperty.call(
        source,
        "difficulty"
      )
  ) {
    try {
      result.difficulty =
        normalizeQuestionBankDifficulty(
          source.difficulty
        );
    }
    catch (_) {
      throw new AdminQuestionWriteDomainError(
        "ADMIN_QUESTION_WRITE_CONTENT_INVALID",
        "difficulty is invalid."
      );
    }
  }

  if (
    Object.prototype
      .hasOwnProperty.call(
        source,
        "category"
      )
  ) {
    result.category =
      requiredWriteText(
        source.category,
        "category",
        120
      );
  }

  if (
    Object.prototype
      .hasOwnProperty.call(
        source,
        "media"
      )
  ) {
    result.media =
      normalizeStrictMediaInput(
        source.media
      );
  }
  else if (!partial) {
    result.media =
      normalizeStrictMediaInput(
        null
      );
  }

  return Object.freeze(
    result
  );
}

function wrapCanonicalQuestionError(
  operation
) {
  try {
    return operation();
  }
  catch (error) {
    if (
      error instanceof
      AdminQuestionWriteDomainError
    ) {
      throw error;
    }

    if (
      error instanceof
      ExamQuestionBankDomainError
    ) {
      const mappings = {
        EXAM_QUESTION_BANK_CONTENT_EDIT_ARCHIVED:
          "ADMIN_QUESTION_WRITE_CONTENT_EDIT_ARCHIVED",

        EXAM_QUESTION_BANK_TRANSITION_INVALID:
          "ADMIN_QUESTION_WRITE_TRANSITION_INVALID",

        EXAM_QUESTION_BANK_REVISION_OVERFLOW:
          "ADMIN_QUESTION_WRITE_REVISION_OVERFLOW"
      };

      const mappedCode =
        mappings[error.code] ||
        "ADMIN_QUESTION_WRITE_CANONICAL_INVALID";

      throw new AdminQuestionWriteDomainError(
        mappedCode,
        "Question canonical state is invalid."
      );
    }

    throw error;
  }
}

function validateCurrentQuestionDocument(
  input
) {
  const source =
    assertPlainObject(
      input,
      "currentQuestion"
    );

  // Strict checks happen before the canonical normalizer so oversized
  // stored values cannot be silently truncated during an administrative
  // mutation.
  normalizeStrictQuestionContent({
    statement:
      source.statement,

    options:
      source.options,

    correctAnswer:
      source.correctAnswer,

    difficulty:
      source.difficulty,

    category:
      source.category,

    media:
      source.media
  });

  requiredWriteText(
    source.lifecycleStatus,
    "lifecycleStatus",
    40
  );

  requiredWriteIdentifier(
    source.authorId,
    "authorId"
  );

  optionalWriteIdentifier(
    source.moderatedBy,
    "moderatedBy"
  );

  optionalWriteText(
    source.moderationReason,
    "moderationReason",
    1200
  );

  optionalWriteIdentifier(
    source.archivedBy,
    "archivedBy"
  );

  if (
    source.lifecycleStatus !==
      "archived" &&
    (
      source.archivedAt !== null &&
      source.archivedAt !== undefined ||
      source.archivedBy !== null &&
      source.archivedBy !== undefined &&
      source.archivedBy !== ""
    )
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_CANONICAL_INVALID",
      "Non-archived questions cannot contain archive metadata."
    );
  }

  return wrapCanonicalQuestionError(
    () =>
      validateQuestionBankDocument(
        source
      )
  );
}

function normalizeWriteActor(
  input = {}
) {
  return Object.freeze({
    actorId:
      requiredWriteIdentifier(
        input.actorId,
        "actorId"
      ),

    actorRole:
      requiredWriteText(
        input.actorRole,
        "actorRole",
        80
      ),

    requestId:
      requiredWriteIdentifier(
        input.requestId,
        "requestId"
      )
  });
}

function assertExpectedQuestionRevision(
  currentQuestion,
  expectedRevisionInput
) {
  const current =
    validateCurrentQuestionDocument(
      currentQuestion
    );

  const expectedRevision =
    requiredExpectedRevision(
      expectedRevisionInput
    );

  if (
    current.revision !==
    expectedRevision
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_REVISION_CONFLICT",
      "Question revision does not match expectedRevision."
    );
  }

  return current;
}

function buildQuestionCreateDocument(
  input = {}
) {
  const actorId =
    requiredWriteIdentifier(
      input.actorId,
      "actorId"
    );

  const timestamp =
    requiredWriteTimestamp(
      input.timestamp,
      "timestamp"
    );

  const content =
    normalizeStrictQuestionContent(
      input.content,
      {
        partial:
          false
      }
    );

  return wrapCanonicalQuestionError(
    () =>
      buildNewQuestionBankDocument({
        ...content,
        authorId:
          actorId,
        timestamp
      })
  );
}

function normalizeSubmitForReview(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return false;
  }

  if (
    typeof value !==
    "boolean"
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_INPUT_INVALID",
      "submitForReview must be boolean."
    );
  }

  return value;
}

function buildQuestionUpdatePlan(
  input = {}
) {
  const current =
    assertExpectedQuestionRevision(
      input.currentQuestion,
      input.expectedRevision
    );

  const timestamp =
    requiredWriteTimestamp(
      input.timestamp,
      "timestamp"
    );

  const patchInput =
    input.patch === undefined ||
    input.patch === null
      ? {}
      : input.patch;

  const patch =
    normalizeStrictQuestionContent(
      patchInput,
      {
        partial:
          true
      }
    );

  const patchFields =
    Object.keys(patch);

  const hasContentChange =
    patchFields.length > 0;

  const submitForReview =
    normalizeSubmitForReview(
      input.submitForReview
    );

  if (
    !hasContentChange &&
    !submitForReview
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_NO_CHANGES",
      "Question update must change content or submit for review."
    );
  }

  let lifecycleStatus =
    current.lifecycleStatus;

  if (hasContentChange) {
    lifecycleStatus =
      wrapCanonicalQuestionError(
        () =>
          resolveQuestionBankStatusAfterContentEdit(
            current.lifecycleStatus
          )
      );
  }

  let submissionIdempotent =
    false;

  if (submitForReview) {
    const transition =
      wrapCanonicalQuestionError(
        () =>
          resolveQuestionBankLifecycleTransition({
            currentStatus:
              lifecycleStatus,

            targetStatus:
              "pending_review"
          })
      );

    lifecycleStatus =
      transition.targetStatus;

    submissionIdempotent =
      transition.idempotent ===
      true;
  }

  if (
    !hasContentChange &&
    submitForReview &&
    submissionIdempotent
  ) {
    return Object.freeze({
      changed:
        false,

      idempotent:
        true,

      operation:
        "submit",

      changedFields:
        Object.freeze([]),

      currentDocument:
        current,

      nextDocument:
        current
    });
  }

  const mergedContent = {
    statement:
      current.statement,

    options:
      current.options,

    correctAnswer:
      current.correctAnswer,

    difficulty:
      current.difficulty,

    category:
      current.category,

    media:
      current.media,

    ...patch
  };

  const moderationShouldReset =
    lifecycleStatus ===
      "pending_review" &&
    (
      hasContentChange ||
      current.lifecycleStatus !==
        "pending_review"
    );

  const next =
    wrapCanonicalQuestionError(
      () =>
        validateQuestionBankDocument({
          ...current,
          ...mergedContent,

          lifecycleStatus,

          updatedAt:
            timestamp,

          revision:
            nextQuestionBankRevision(
              current.revision
            ),

          moderatedAt:
            moderationShouldReset
              ? null
              : current.moderatedAt,

          moderatedBy:
            moderationShouldReset
              ? null
              : current.moderatedBy,

          moderationReason:
            moderationShouldReset
              ? null
              : current.moderationReason
        })
    );

  const changedFields =
    new Set(
      patchFields
    );

  if (
    next.lifecycleStatus !==
    current.lifecycleStatus
  ) {
    changedFields.add(
      "lifecycleStatus"
    );
  }

  if (moderationShouldReset) {
    changedFields.add(
      "moderation"
    );
  }

  return Object.freeze({
    changed:
      true,

    idempotent:
      false,

    operation:
      submitForReview &&
      !hasContentChange
        ? "submit"
        : "update",

    changedFields:
      Object.freeze(
        Array.from(
          changedFields
        ).sort()
      ),

    currentDocument:
      current,

    nextDocument:
      next
  });
}

function normalizeModerationDecision(
  value
) {
  const decision =
    requiredWriteText(
      value,
      "decision",
      40
    )
      .toLowerCase();

  if (
    !Object.prototype
      .hasOwnProperty.call(
        ADMIN_QUESTION_MODERATION_DECISIONS,
        decision
      )
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_MODERATION_DECISION_INVALID",
      "Moderation decision is invalid."
    );
  }

  return decision;
}

function buildQuestionModerationPlan(
  input = {}
) {
  const current =
    assertExpectedQuestionRevision(
      input.currentQuestion,
      input.expectedRevision
    );

  const actorId =
    requiredWriteIdentifier(
      input.actorId,
      "actorId"
    );

  const timestamp =
    requiredWriteTimestamp(
      input.timestamp,
      "timestamp"
    );

  const decision =
    normalizeModerationDecision(
      input.decision
    );

  const targetStatus =
    ADMIN_QUESTION_MODERATION_DECISIONS[
      decision
    ];

  const reason =
    optionalWriteText(
      input.reason,
      "reason",
      1200
    );

  if (
    decision ===
      "request_changes" &&
    !reason
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_MODERATION_REASON_REQUIRED",
      "A moderation reason is required when requesting changes."
    );
  }

  wrapCanonicalQuestionError(
    () =>
      resolveQuestionBankLifecycleTransition({
        currentStatus:
          current.lifecycleStatus,

        targetStatus
      })
  );

  const next =
    wrapCanonicalQuestionError(
      () =>
        validateQuestionBankDocument({
          ...current,

          lifecycleStatus:
            targetStatus,

          updatedAt:
            timestamp,

          revision:
            nextQuestionBankRevision(
              current.revision
            ),

          moderatedAt:
            timestamp,

          moderatedBy:
            actorId,

          moderationReason:
            reason
        })
    );

  return Object.freeze({
    changed:
      true,

    idempotent:
      false,

    operation:
      "moderate",

    decision,

    changedFields:
      Object.freeze([
        "lifecycleStatus",
        "moderation"
      ]),

    currentDocument:
      current,

    nextDocument:
      next
  });
}

function buildQuestionArchivePlan(
  input = {}
) {
  const current =
    assertExpectedQuestionRevision(
      input.currentQuestion,
      input.expectedRevision
    );

  const actorId =
    requiredWriteIdentifier(
      input.actorId,
      "actorId"
    );

  const timestamp =
    requiredWriteTimestamp(
      input.timestamp,
      "timestamp"
    );

  const transition =
    wrapCanonicalQuestionError(
      () =>
        resolveQuestionBankLifecycleTransition({
          currentStatus:
            current.lifecycleStatus,

          targetStatus:
            "archived"
        })
    );

  if (
    transition.idempotent ===
    true
  ) {
    return Object.freeze({
      changed:
        false,

      idempotent:
        true,

      operation:
        "archive",

      changedFields:
        Object.freeze([]),

      currentDocument:
        current,

      nextDocument:
        current
    });
  }

  const next =
    wrapCanonicalQuestionError(
      () =>
        validateQuestionBankDocument({
          ...current,

          lifecycleStatus:
            "archived",

          updatedAt:
            timestamp,

          revision:
            nextQuestionBankRevision(
              current.revision
            ),

          archivedAt:
            timestamp,

          archivedBy:
            actorId
        })
    );

  return Object.freeze({
    changed:
      true,

    idempotent:
      false,

    operation:
      "archive",

    changedFields:
      Object.freeze([
        "lifecycleStatus",
        "archive"
      ]),

    currentDocument:
      current,

    nextDocument:
      next
  });
}

function normalizeAuditOperation(
  value
) {
  const operation =
    requiredWriteText(
      value,
      "operation",
      40
    )
      .toLowerCase();

  if (
    !ADMIN_QUESTION_AUDIT_OPERATIONS
      .includes(operation)
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_AUDIT_INVALID",
      "Question audit operation is invalid."
    );
  }

  return operation;
}

function summarizeAuditDocument(
  document,
  field
) {
  if (
    document === undefined ||
    document === null
  ) {
    return null;
  }

  const canonical =
    validateCurrentQuestionDocument(
      document
    );

  return Object.freeze({
    lifecycleStatus:
      canonical.lifecycleStatus,

    revision:
      canonical.revision
  });
}

function normalizeChangedFields(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return Object.freeze([]);
  }

  if (!Array.isArray(value)) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_AUDIT_INVALID",
      "changedFields must be an array."
    );
  }

  const result =
    Array.from(
      new Set(
        value.map(
          item =>
            requiredWriteText(
              item,
              "changedField",
              80
            )
        )
      )
    )
      .sort();

  return Object.freeze(
    result
  );
}

function buildQuestionAuditEvent(
  input = {}
) {
  const actor =
    normalizeWriteActor(
      input
    );

  const questionId =
    requiredWriteIdentifier(
      input.questionId,
      "questionId"
    );

  const operation =
    normalizeAuditOperation(
      input.operation
    );

  const createdAt =
    requiredWriteTimestamp(
      input.createdAt,
      "createdAt"
    );

  const before =
    summarizeAuditDocument(
      input.before,
      "before"
    );

  const after =
    summarizeAuditDocument(
      input.after,
      "after"
    );

  if (!after) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_AUDIT_INVALID",
      "Question audit requires after state."
    );
  }

  if (
    [
      "create",
      "import"
    ].includes(operation) &&
    before !== null
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_AUDIT_INVALID",
      "Create/import audit cannot contain before state."
    );
  }

  if (
    ![
      "create",
      "import"
    ].includes(operation) &&
    before === null
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_WRITE_AUDIT_INVALID",
      "Mutation audit requires before state."
    );
  }

  const changedFields =
    normalizeChangedFields(
      input.changedFields
    );

  const metadata = {
    schemaVersion:
      ADMIN_QUESTION_WRITE_SCHEMA_VERSION,

    operation,

    changedFields
  };

  if (
    input.importIndex !==
      undefined &&
    input.importIndex !==
      null
  ) {
    if (
      !Number.isSafeInteger(
        input.importIndex
      ) ||
      input.importIndex < 0 ||
      input.importIndex >=
        ADMIN_QUESTION_IMPORT_MAX_ITEMS
    ) {
      throw new AdminQuestionWriteDomainError(
        "ADMIN_QUESTION_WRITE_AUDIT_INVALID",
        "importIndex is invalid."
      );
    }

    metadata.importIndex =
      input.importIndex;
  }

  return Object.freeze({
    actorId:
      actor.actorId,

    actorRole:
      actor.actorRole,

    action:
      ADMIN_QUESTION_AUDIT_ACTIONS[
        operation
      ],

    entityType:
      "question",

    entityId:
      questionId,

    organizationId:
      null,

    before,
    after,

    source:
      "function",

    requestId:
      actor.requestId,

    createdAt,

    metadata:
      Object.freeze(
        metadata
      )
  });
}

function sanitizeQuestionImportError(
  error,
  index
) {
  const errorCode =
    error instanceof
      AdminQuestionWriteDomainError
      ? error.code
      : "ADMIN_QUESTION_IMPORT_ITEM_INVALID";

  return Object.freeze({
    index,
    ok:
      false,
    errorCode
  });
}

function validateQuestionImportItems(
  input = {}
) {
  const items =
    input.items;

  if (
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length >
      ADMIN_QUESTION_IMPORT_MAX_ITEMS
  ) {
    throw new AdminQuestionWriteDomainError(
      "ADMIN_QUESTION_IMPORT_SIZE_INVALID",
      `Import must contain between 1 and ${ADMIN_QUESTION_IMPORT_MAX_ITEMS} items.`
    );
  }

  const actorId =
    requiredWriteIdentifier(
      input.actorId,
      "actorId"
    );

  const timestamp =
    requiredWriteTimestamp(
      input.timestamp,
      "timestamp"
    );

  const validItems = [];
  const errors = [];

  for (
    let index = 0;
    index < items.length;
    index += 1
  ) {
    try {
      const document =
        buildQuestionCreateDocument({
          content:
            items[index],
          actorId,
          timestamp
        });

      validItems.push(
        Object.freeze({
          index,
          document
        })
      );
    }
    catch (error) {
      errors.push(
        sanitizeQuestionImportError(
          error,
          index
        )
      );
    }
  }

  return Object.freeze({
    total:
      items.length,

    validItems:
      Object.freeze(
        validItems
      ),

    errors:
      Object.freeze(
        errors
      )
  });
}

module.exports = {
  ADMIN_QUESTION_WRITE_SCHEMA_VERSION,
  ADMIN_QUESTION_IMPORT_MAX_ITEMS,

  ADMIN_QUESTION_MODERATION_DECISIONS,
  ADMIN_QUESTION_AUDIT_ACTIONS,
  ADMIN_QUESTION_AUDIT_OPERATIONS,

  AdminQuestionWriteDomainError,

  requiredWriteText,
  optionalWriteText,
  requiredWriteIdentifier,
  requiredWriteTimestamp,
  requiredExpectedRevision,

  assertPlainObject,
  assertOnlyFields,
  normalizeStrictOptionsInput,
  normalizeStrictMediaInput,
  normalizeStrictQuestionContent,
  validateCurrentQuestionDocument,
  normalizeWriteActor,
  assertExpectedQuestionRevision,

  buildQuestionCreateDocument,
  normalizeSubmitForReview,
  buildQuestionUpdatePlan,

  normalizeModerationDecision,
  buildQuestionModerationPlan,
  buildQuestionArchivePlan,

  normalizeAuditOperation,
  buildQuestionAuditEvent,

  sanitizeQuestionImportError,
  validateQuestionImportItems
};