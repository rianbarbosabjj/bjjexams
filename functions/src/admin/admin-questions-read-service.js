"use strict";

const {
  FieldPath
} = require(
  "firebase-admin/firestore"
);

const {
  EXAM_QUESTION_BANK_COLLECTION,
  EXAM_QUESTION_BANK_LIFECYCLE_STATUSES
} = require(
  "../exams/exam-question-bank-domain"
);

const {
  cleanText
} = require(
  "./admin-directory-models"
);

const {
  AdminQuestionModelError,
  buildOperationalQuestionView,
  buildOperationalQuestionAuthoringView
} = require(
  "./admin-question-models"
);

const DEFAULT_QUESTIONS_LIMIT = 20;
const MAX_QUESTIONS_LIMIT = 25;
const QUESTION_CURSOR_VERSION = 1;

const QUESTION_SCAN_BATCH_SIZE =
  MAX_QUESTIONS_LIMIT + 1;

const QUESTION_MAX_SCAN_DOCS =
  QUESTION_SCAN_BATCH_SIZE * 10;

const QUESTION_AUTHOR_COLLECTION =
  "usuarios";

class AdminQuestionsReadError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminQuestionsReadError";

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

  return normalized.slice(
    0,
    maxLength
  );
}

function requiredIdentifier(
  value,
  field
) {
  const id =
    text(
      value,
      128
    );

  if (
    !id ||
    id.includes("/")
  ) {
    throw new AdminQuestionsReadError(
      "ADMIN_QUESTIONS_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }

  return id;
}

function readQuestionsLimit(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return DEFAULT_QUESTIONS_LIMIT;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_QUESTIONS_LIMIT
  ) {
    throw new AdminQuestionsReadError(
      "ADMIN_QUESTIONS_LIMIT_INVALID",
      `limit must be an integer between 1 and ${MAX_QUESTIONS_LIMIT}.`
    );
  }

  return parsed;
}

function optionalLifecycleFilter(
  value
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
    throw new AdminQuestionsReadError(
      "ADMIN_QUESTIONS_FILTER_INVALID",
      "lifecycleStatus filter is invalid."
    );
  }

  const normalized =
    value
      .trim()
      .toLowerCase();

  if (
    !EXAM_QUESTION_BANK_LIFECYCLE_STATUSES
      .includes(normalized)
  ) {
    throw new AdminQuestionsReadError(
      "ADMIN_QUESTIONS_FILTER_INVALID",
      "lifecycleStatus filter is invalid."
    );
  }

  return normalized;
}

function optionalDifficultyFilter(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > 5
  ) {
    throw new AdminQuestionsReadError(
      "ADMIN_QUESTIONS_FILTER_INVALID",
      "difficulty filter is invalid."
    );
  }

  return parsed;
}

function optionalCategoryFilter(
  value
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
    throw new AdminQuestionsReadError(
      "ADMIN_QUESTIONS_FILTER_INVALID",
      "category filter is invalid."
    );
  }

  const normalized =
    value.trim();

  if (
    !normalized ||
    normalized.length > 120
  ) {
    throw new AdminQuestionsReadError(
      "ADMIN_QUESTIONS_FILTER_INVALID",
      "category filter is invalid."
    );
  }

  return normalized;
}

function normalizeQuestionFilters(
  input = {}
) {
  return Object.freeze({
    lifecycleStatus:
      optionalLifecycleFilter(
        input.lifecycleStatus
      ),

    difficulty:
      optionalDifficultyFilter(
        input.difficulty
      ),

    category:
      optionalCategoryFilter(
        input.category
      )
  });
}

function matchesQuestionFilters(
  question,
  filters = {}
) {
  const source =
    question &&
    typeof question === "object" &&
    !Array.isArray(question)
      ? question
      : {};

  if (
    filters.lifecycleStatus &&
    String(
      source.lifecycleStatus || ""
    )
      .trim()
      .toLowerCase() !==
      filters.lifecycleStatus
  ) {
    return false;
  }

  if (
    filters.difficulty !== null &&
    Number(
      source.difficulty
    ) !== filters.difficulty
  ) {
    return false;
  }

  if (filters.category) {
    const category =
      String(
        source.category || ""
      )
        .trim()
        .toLowerCase();

    if (
      category !==
      filters.category
        .toLowerCase()
    ) {
      return false;
    }
  }

  return true;
}

function encodeQuestionCursor(
  questionId
) {
  const id =
    requiredIdentifier(
      questionId,
      "questionId"
    );

  return Buffer
    .from(
      JSON.stringify({
        v:
          QUESTION_CURSOR_VERSION,

        lastQuestionId:
          id
      }),
      "utf8"
    )
    .toString(
      "base64url"
    );
}

function decodeQuestionCursor(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value !== "string" ||
    value.length > 512
  ) {
    throw new AdminQuestionsReadError(
      "ADMIN_QUESTIONS_CURSOR_INVALID",
      "Question cursor is invalid."
    );
  }

  try {
    const parsed =
      JSON.parse(
        Buffer
          .from(
            value,
            "base64url"
          )
          .toString(
            "utf8"
          )
      );

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.v !==
        QUESTION_CURSOR_VERSION
    ) {
      throw new Error(
        "invalid cursor"
      );
    }

    return requiredIdentifier(
      parsed.lastQuestionId,
      "cursor.lastQuestionId"
    );
  }
  catch (error) {
    if (
      error instanceof
      AdminQuestionsReadError
    ) {
      throw error;
    }

    throw new AdminQuestionsReadError(
      "ADMIN_QUESTIONS_CURSOR_INVALID",
      "Question cursor is invalid."
    );
  }
}

function authorDescriptor(
  question = {}
) {
  const authorId =
    cleanText(
      question.authorId,
      128
    );

  if (
    !authorId ||
    authorId.includes("/")
  ) {
    return null;
  }

  return Object.freeze({
    authorId,

    path:
      `${QUESTION_AUTHOR_COLLECTION}/${authorId}`
  });
}

function authorDisplayName(
  profile = {}
) {
  const source =
    profile &&
    typeof profile === "object" &&
    !Array.isArray(profile)
      ? profile
      : {};

  return cleanText(
    source.displayName ||
    source.nome ||
    source.name ||
    source.nome_completo,
    180
  );
}

function mapQuestionModelError(
  error
) {
  if (
    error instanceof
    AdminQuestionModelError
  ) {
    throw new AdminQuestionsReadError(
      "ADMIN_QUESTIONS_CANONICAL_STATE_INVALID",
      "Question canonical state is invalid."
    );
  }

  throw error;
}

function createAdminQuestionsReadService(
  dependencies = {}
) {
  const {
    db,

    documentIdField =
      FieldPath.documentId()
  } = dependencies;

  if (
    !db ||
    typeof db.collection !== "function" ||
    typeof db.doc !== "function" ||
    typeof db.getAll !== "function"
  ) {
    throw new TypeError(
      "Admin questions read service requires Firestore."
    );
  }

  async function loadAuthorSummaries(
    questions
  ) {
    const records =
      Array.isArray(questions)
        ? questions
        : [];

    const descriptors =
      new Map();

    for (const question of records) {
      const descriptor =
        authorDescriptor(
          question
        );

      if (descriptor) {
        descriptors.set(
          descriptor.authorId,
          descriptor
        );
      }
    }

    const unique =
      Array.from(
        descriptors.values()
      );

    if (unique.length === 0) {
      return new Map();
    }

    if (
      unique.length >
      MAX_QUESTIONS_LIMIT
    ) {
      throw new AdminQuestionsReadError(
        "ADMIN_QUESTIONS_BATCH_INVALID",
        "Question author batch is too large."
      );
    }

    const refs =
      unique.map(
        descriptor =>
          db.doc(
            descriptor.path
          )
      );

    const snapshots =
      await db.getAll(
        ...refs
      );

    if (
      !Array.isArray(snapshots) ||
      snapshots.length !==
        unique.length
    ) {
      throw new AdminQuestionsReadError(
        "ADMIN_QUESTIONS_BATCH_INVALID",
        "Question author batch returned an unexpected result."
      );
    }

    const result =
      new Map();

    for (
      let index = 0;
      index < unique.length;
      index += 1
    ) {
      const descriptor =
        unique[index];

      const snapshot =
        snapshots[index];

      const profile =
        snapshot?.exists === true
          ? snapshot.data() || {}
          : {};

      result.set(
        descriptor.authorId,
        Object.freeze({
          authorId:
            descriptor.authorId,

          displayName:
            authorDisplayName(
              profile
            )
        })
      );
    }

    return result;
  }

  function resolveAuthorSummary(
    question,
    summaries
  ) {
    const descriptor =
      authorDescriptor(
        question
      );

    if (!descriptor) {
      return null;
    }

    return (
      summaries.get(
        descriptor.authorId
      ) ||
      Object.freeze({
        authorId:
          descriptor.authorId,

        displayName:
          null
      })
    );
  }

  function buildSanitizedView(
    input
  ) {
    try {
      return buildOperationalQuestionView(
        input
      );
    }
    catch (error) {
      mapQuestionModelError(
        error
      );
    }
  }

  function buildAuthoringView(
    input
  ) {
    try {
      return buildOperationalQuestionAuthoringView(
        input
      );
    }
    catch (error) {
      mapQuestionModelError(
        error
      );
    }
  }

  async function listQuestions(
    input = {}
  ) {
    const limit =
      readQuestionsLimit(
        input.limit
      );

    const filters =
      normalizeQuestionFilters(
        input
      );

    const afterQuestionId =
      decodeQuestionCursor(
        input.cursor
      );

    const matchedDocs = [];

    let scanAfterId =
      afterQuestionId;

    let resumeAfterId =
      afterQuestionId;

    let scannedDocs = 0;

    let sourceExhausted =
      false;

    let hasMoreMatches =
      false;

    while (
      !sourceExhausted &&
      !hasMoreMatches &&
      scannedDocs <
        QUESTION_MAX_SCAN_DOCS
    ) {
      const remainingBudget =
        QUESTION_MAX_SCAN_DOCS -
        scannedDocs;

      const batchLimit =
        Math.min(
          QUESTION_SCAN_BATCH_SIZE,
          remainingBudget
        );

      let query =
        db
          .collection(
            EXAM_QUESTION_BANK_COLLECTION
          )
          .orderBy(
            documentIdField
          );

      if (scanAfterId) {
        query =
          query.startAfter(
            scanAfterId
          );
      }

      const snapshot =
        await query
          .limit(
            batchLimit
          )
          .get();

      const docs =
        Array.isArray(
          snapshot?.docs
        )
          ? snapshot.docs
          : [];

      if (
        docs.length === 0
      ) {
        sourceExhausted =
          true;

        break;
      }

      scannedDocs +=
        docs.length;

      for (
        const document
        of docs
      ) {
        const question =
          document.data() ||
          {};

        const matches =
          matchesQuestionFilters(
            question,
            filters
          );

        if (
          matches &&
          matchedDocs.length >=
            limit
        ) {
          hasMoreMatches =
            true;

          break;
        }

        if (matches) {
          matchedDocs.push(
            document
          );
        }

        /*
         * resumeAfterId points to the last document that is safe
         * to skip on the next page.
         *
         * The first matching document beyond the page limit is
         * intentionally NOT consumed, preventing skipped results.
         */
        resumeAfterId =
          document.id;
      }

      if (hasMoreMatches) {
        break;
      }

      if (
        docs.length <
        batchLimit
      ) {
        sourceExhausted =
          true;

        break;
      }

      scanAfterId =
        resumeAfterId;
    }

    const scanLimitReached =
      !sourceExhausted &&
      !hasMoreMatches &&
      scannedDocs >=
        QUESTION_MAX_SCAN_DOCS;

    const questionData =
      matchedDocs.map(
        document =>
          document.data() ||
          {}
      );

    const authorSummaries =
      await loadAuthorSummaries(
        questionData
      );

    const items =
      matchedDocs.map(
        document => {
          const question =
            document.data() ||
            {};

          return buildSanitizedView({
            questionId:
              document.id,

            question,

            authorSummary:
              resolveAuthorSummary(
                question,
                authorSummaries
              )
          });
        }
      );

    const shouldContinue =
      hasMoreMatches ||
      scanLimitReached;

    return Object.freeze({
      items:
        Object.freeze(
          items
        ),

      nextCursor:
        shouldContinue &&
        resumeAfterId
          ? encodeQuestionCursor(
              resumeAfterId
            )
          : null
    });
  }

  async function loadQuestionDocument(
    questionIdInput
  ) {
    const questionId =
      requiredIdentifier(
        questionIdInput,
        "questionId"
      );

    const snapshot =
      await db
        .doc(
          `${EXAM_QUESTION_BANK_COLLECTION}/${questionId}`
        )
        .get();

    if (
      !snapshot ||
      snapshot.exists !== true
    ) {
      throw new AdminQuestionsReadError(
        "ADMIN_QUESTION_NOT_FOUND",
        "Operational question was not found."
      );
    }

    return Object.freeze({
      questionId,
      question:
        snapshot.data() || {}
    });
  }

  async function getQuestion(
    input = {}
  ) {
    const loaded =
      await loadQuestionDocument(
        input.questionId
      );

    const summaries =
      await loadAuthorSummaries([
        loaded.question
      ]);

    return buildSanitizedView({
      questionId:
        loaded.questionId,

      question:
        loaded.question,

      authorSummary:
        resolveAuthorSummary(
          loaded.question,
          summaries
        )
    });
  }

  async function getQuestionForAuthoring(
    input = {}
  ) {
    const loaded =
      await loadQuestionDocument(
        input.questionId
      );

    const summaries =
      await loadAuthorSummaries([
        loaded.question
      ]);

    return buildAuthoringView({
      questionId:
        loaded.questionId,

      question:
        loaded.question,

      authorSummary:
        resolveAuthorSummary(
          loaded.question,
          summaries
        )
    });
  }

  return Object.freeze({
    listQuestions,
    getQuestion,
    getQuestionForAuthoring
  });
}

module.exports = {
  DEFAULT_QUESTIONS_LIMIT,
  MAX_QUESTIONS_LIMIT,
  QUESTION_CURSOR_VERSION,
  QUESTION_SCAN_BATCH_SIZE,
  QUESTION_MAX_SCAN_DOCS,

  QUESTION_AUTHOR_COLLECTION,

  AdminQuestionsReadError,

  requiredIdentifier,
  readQuestionsLimit,

  optionalLifecycleFilter,
  optionalDifficultyFilter,
  optionalCategoryFilter,
  normalizeQuestionFilters,
  matchesQuestionFilters,

  encodeQuestionCursor,
  decodeQuestionCursor,

  authorDescriptor,
  authorDisplayName,

  createAdminQuestionsReadService
};