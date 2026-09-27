"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  DEFAULT_QUESTIONS_LIMIT,
  MAX_QUESTIONS_LIMIT,
  QUESTION_CURSOR_VERSION,
  QUESTION_AUTHOR_COLLECTION,

  AdminQuestionsReadError,

  readQuestionsLimit,
  normalizeQuestionFilters,
  encodeQuestionCursor,
  decodeQuestionCursor,

  createAdminQuestionsReadService
} = require(
  "../functions/src/admin/admin-questions-read-service"
);

function sampleQuestion(
  overrides = {}
) {
  return {
    questionVersion:
      1,

    statement:
      "Pergunta operacional",

    options: {
      A:
        "Resposta A",

      B:
        "Resposta B"
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
      "2026-09-27T10:00:00.000Z",

    updatedAt:
      "2026-09-27T10:00:00.000Z",

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

class FakeSnapshot {
  constructor(
    id,
    value,
    exists = true
  ) {
    this.id =
      id;

    this.value =
      value;

    this.exists =
      exists;
  }

  data() {
    return this.value;
  }
}

class FakeQuery {
  constructor(
    docs,
    options = {}
  ) {
    this.docs =
      docs;

    this.after =
      options.after ||
      null;

    this.max =
      options.max ||
      null;
  }

  orderBy() {
    return new FakeQuery(
      this.docs,
      {
        after:
          this.after,

        max:
          this.max
      }
    );
  }

  startAfter(
    id
  ) {
    return new FakeQuery(
      this.docs,
      {
        after:
          id,

        max:
          this.max
      }
    );
  }

  limit(
    value
  ) {
    return new FakeQuery(
      this.docs,
      {
        after:
          this.after,

        max:
          value
      }
    );
  }

  async get() {
    let docs =
      [...this.docs]
        .sort(
          (left, right) =>
            left.id.localeCompare(
              right.id
            )
        );

    if (this.after) {
      docs =
        docs.filter(
          document =>
            document.id >
            this.after
        );
    }

    if (
      Number.isSafeInteger(
        this.max
      )
    ) {
      docs =
        docs.slice(
          0,
          this.max
        );
    }

    return {
      docs
    };
  }
}

function createFakeDb(
  questions,
  users
) {
  const stats = {
    collections:
      [],

    documentReads:
      [],

    authorBatchPaths:
      []
  };

  return {
    stats,

    collection(
      name
    ) {
      stats.collections.push(
        name
      );

      if (
        name !==
        "exam_question_bank"
      ) {
        throw new Error(
          `Unexpected collection: ${name}`
        );
      }

      return new FakeQuery(
        questions.map(
          item =>
            new FakeSnapshot(
              item.id,
              item.data,
              true
            )
        )
      );
    },

    doc(
      documentPath
    ) {
      return {
        path:
          documentPath,

        async get() {
          stats.documentReads.push(
            documentPath
          );

          if (
            documentPath.startsWith(
              "exam_question_bank/"
            )
          ) {
            const id =
              documentPath.split("/")[1];

            const found =
              questions.find(
                item =>
                  item.id === id
              );

            if (!found) {
              return new FakeSnapshot(
                id,
                undefined,
                false
              );
            }

            return new FakeSnapshot(
              id,
              found.data,
              true
            );
          }

          throw new Error(
            `Unexpected direct get: ${documentPath}`
          );
        }
      };
    },

    async getAll(
      ...refs
    ) {
      stats.authorBatchPaths.push(
        refs.map(
          ref =>
            ref.path
        )
      );

      return refs.map(
        ref => {
          const parts =
            ref.path.split("/");

          const collection =
            parts[0];

          const id =
            parts[1];

          if (
            collection !==
            "usuarios"
          ) {
            throw new Error(
              `Unexpected batch collection: ${collection}`
            );
          }

          if (
            !Object.prototype
              .hasOwnProperty.call(
                users,
                id
              )
          ) {
            return new FakeSnapshot(
              id,
              undefined,
              false
            );
          }

          return new FakeSnapshot(
            id,
            users[id],
            true
          );
        }
      );
    }
  };
}

function expectReadError(
  operation,
  expectedCode
) {
  return Promise
    .resolve()
    .then(operation)
    .then(
      () => {
        throw new Error(
          `Expected ${expectedCode}`
        );
      },
      error => {
        assert.ok(
          error instanceof
            AdminQuestionsReadError
        );

        assert.strictEqual(
          error.code,
          expectedCode
        );
      }
    );
}

async function main() {
  assert.strictEqual(
    DEFAULT_QUESTIONS_LIMIT,
    20
  );

  assert.strictEqual(
    MAX_QUESTIONS_LIMIT,
    25
  );

  assert.strictEqual(
    QUESTION_CURSOR_VERSION,
    1
  );

  assert.strictEqual(
    QUESTION_AUTHOR_COLLECTION,
    "usuarios"
  );

  assert.strictEqual(
    readQuestionsLimit(
      undefined
    ),
    20
  );

  assert.strictEqual(
    readQuestionsLimit(
      25
    ),
    25
  );

  assert.deepStrictEqual(
    normalizeQuestionFilters({
      lifecycleStatus:
        "APPROVED",

      difficulty:
        "3",

      category:
        "Fundamentos"
    }),
    {
      lifecycleStatus:
        "approved",

      difficulty:
        3,

      category:
        "Fundamentos"
    }
  );

  const cursor =
    encodeQuestionCursor(
      "question-2"
    );

  assert.strictEqual(
    decodeQuestionCursor(
      cursor
    ),
    "question-2"
  );

  await expectReadError(
    () =>
      Promise.resolve(
        readQuestionsLimit(
          26
        )
      ),
    "ADMIN_QUESTIONS_LIMIT_INVALID"
  );

  await expectReadError(
    () =>
      Promise.resolve(
        decodeQuestionCursor(
          "not-a-cursor"
        )
      ),
    "ADMIN_QUESTIONS_CURSOR_INVALID"
  );

  const questions = [
    {
      id:
        "question-1",

      data:
        sampleQuestion({
          statement:
            "Questao draft",

          lifecycleStatus:
            "draft",

          authorId:
            "author-1"
        })
    },

    {
      id:
        "question-2",

      data:
        sampleQuestion({
          statement:
            "Questao aprovada",

          lifecycleStatus:
            "approved",

          difficulty:
            3,

          authorId:
            "author-2",

          revision:
            4,

          moderatedAt:
            "2026-09-27T11:00:00.000Z",

          moderatedBy:
            "moderator-1",

          moderationReason:
            "Approved."
        })
    },

    {
      id:
        "question-3",

      data:
        sampleQuestion({
          statement:
            "Questao para ajustes",

          lifecycleStatus:
            "changes_requested",

          category:
            "Passagens",

          authorId:
            "author-1"
        })
    }
  ];

  const users = {
    "author-1": {
      displayName:
        "Author One",

      email:
        "one@example.com"
    },

    "author-2": {
      nome:
        "Author Two",

      token:
        "must-not-leak"
    }
  };

  const db =
    createFakeDb(
      questions,
      users
    );

  const service =
    createAdminQuestionsReadService({
      db,

      documentIdField:
        "__name__"
    });

  const firstPage =
    await service.listQuestions({
      limit:
        2
    });

  assert.strictEqual(
    firstPage.items.length,
    2
  );

  assert.ok(
    firstPage.nextCursor
  );

  assert.strictEqual(
    firstPage.items[0]
      .questionId,
    "question-1"
  );

  assert.strictEqual(
    firstPage.items[1]
      .questionId,
    "question-2"
  );

  for (
    const item
    of firstPage.items
  ) {
    assert.strictEqual(
      Object.prototype
        .hasOwnProperty.call(
          item,
          "correctAnswer"
        ),
      false
    );

    assert.strictEqual(
      Object.prototype
        .hasOwnProperty.call(
          item,
          "revision"
        ),
      false
    );

    assert.strictEqual(
      Object.prototype
        .hasOwnProperty.call(
          item,
          "moderationSummary"
        ),
      false
    );
  }

  assert.deepStrictEqual(
    firstPage.items[0]
      .authorSummary,
    {
      authorId:
        "author-1",

      displayName:
        "Author One"
    }
  );

  const secondPage =
    await service.listQuestions({
      limit:
        2,

      cursor:
        firstPage.nextCursor
    });

  assert.strictEqual(
    secondPage.items.length,
    1
  );

  assert.strictEqual(
    secondPage.items[0]
      .questionId,
    "question-3"
  );

  assert.strictEqual(
    secondPage.nextCursor,
    null
  );

  const filtered =
    await service.listQuestions({
      limit:
        3,

      lifecycleStatus:
        "approved",

      difficulty:
        3,

      category:
        "fundamentos"
    });

  assert.strictEqual(
    filtered.items.length,
    1
  );

  assert.strictEqual(
    filtered.items[0]
      .questionId,
    "question-2"
  );

  const detail =
    await service.getQuestion({
      questionId:
        "question-2"
    });

  assert.strictEqual(
    detail.questionId,
    "question-2"
  );

  assert.strictEqual(
    detail.authorSummary
      .displayName,
    "Author Two"
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        detail,
        "correctAnswer"
      ),
    false
  );

  const authoring =
    await service
      .getQuestionForAuthoring({
        questionId:
          "question-2"
      });

  assert.strictEqual(
    authoring.correctAnswer,
    "A"
  );

  assert.strictEqual(
    authoring.revision,
    4
  );

  assert.strictEqual(
    authoring
      .moderationSummary
      .moderatedBy,
    "moderator-1"
  );

  assert.strictEqual(
    authoring
      .authorSummary
      .displayName,
    "Author Two"
  );

  await expectReadError(
    () =>
      service.getQuestion({
        questionId:
          "missing-question"
      }),
    "ADMIN_QUESTION_NOT_FOUND"
  );

  await expectReadError(
    () =>
      service.getQuestion({
        questionId:
          "bad/id"
      }),
    "ADMIN_QUESTIONS_IDENTIFIER_INVALID"
  );

  const malformedDb =
    createFakeDb(
      [
        {
          id:
            "bad-question",

          data:
            sampleQuestion({
              correctAnswer:
                "D"
            })
        }
      ],
      users
    );

  const malformedService =
    createAdminQuestionsReadService({
      db:
        malformedDb,

      documentIdField:
        "__name__"
    });

  await expectReadError(
    () =>
      malformedService.getQuestion({
        questionId:
          "bad-question"
      }),
    "ADMIN_QUESTIONS_CANONICAL_STATE_INVALID"
  );

  assert.ok(
    db.stats.collections.every(
      name =>
        name ===
        "exam_question_bank"
    )
  );

  assert.ok(
    db.stats.authorBatchPaths
      .flat()
      .every(
        value =>
          value.startsWith(
            "usuarios/"
          )
      )
  );

  const ROOT =
    path.resolve(
      __dirname,
      ".."
    );

  const serviceSource =
    fs.readFileSync(
      path.join(
        ROOT,
        "functions/src/admin/admin-questions-read-service.js"
      ),
      "utf8"
    );

  for (
    const forbidden
    of [
      "FieldValue",
      "runTransaction",
      ".update(",
      ".create(",
      ".delete(",
      "defineSecret",
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "GEMINI_COURSE_MODERATION_API_KEY"
    ]
  ) {
    assert.strictEqual(
      serviceSource.includes(
        forbidden
      ),
      false,
      `Read service must not depend on ${forbidden}`
    );
  }

  const firestoreSetPatterns = [
    /\btransaction\s*\.\s*set\s*\(/,
    /\bbatch\s*\.\s*set\s*\(/,
    /\b[A-Za-z_$][A-Za-z0-9_$]*(?:Ref|Reference)\s*\.\s*set\s*\(/,
    /\.doc\s*\([^)]*\)\s*\.\s*set\s*\(/s
  ];

  for (
    const pattern
    of firestoreSetPatterns
  ) {
    assert.strictEqual(
      pattern.test(
        serviceSource
      ),
      false,
      `Read service must not perform Firestore writes matching ${pattern}`
    );
  }

  assert.strictEqual(
    serviceSource.includes(
      "exam_templates/"
    ),
    false
  );

  assert.strictEqual(
    serviceSource.includes(
      "questions/"
    ),
    false
  );

  console.log(
    "MARCO8_QUESTIONS_COLLECTION=exam_question_bank"
  );

  console.log(
    "MARCO8_QUESTIONS_AUTHOR_COLLECTION=usuarios"
  );

  console.log(
    "MARCO8_QUESTIONS_DEFAULT_LIMIT=20"
  );

  console.log(
    "MARCO8_QUESTIONS_MAX_LIMIT=25"
  );

  console.log(
    "MARCO8_QUESTIONS_CURSOR=DOCUMENT_ID_V1"
  );

  console.log(
    "MARCO8_QUESTIONS_FILTERS=3/3"
  );

  console.log(
    "MARCO8_QUESTIONS_AUTHOR_BATCH=True"
  );

  console.log(
    "MARCO8_QUESTIONS_LIST_ANSWER_KEY_EXPOSURE=False"
  );

  console.log(
    "MARCO8_QUESTIONS_DETAIL_ANSWER_KEY_EXPOSURE=False"
  );

  console.log(
    "MARCO8_QUESTIONS_AUTHORING_ANSWER_KEY_EXPOSURE=True"
  );

  console.log(
    "MARCO8_QUESTIONS_FIRESTORE_DEPENDENCY=READ_ONLY_SERVICE"
  );

  console.log(
    "MARCO8_ADMIN_QUESTIONS_READ_SERVICE=PASSED"
  );
}

main().catch(
  error => {
    console.error(error);
    process.exitCode = 1;
  }
);