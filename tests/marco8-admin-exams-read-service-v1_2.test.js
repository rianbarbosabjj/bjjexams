"use strict";

const assert =
  require("assert");

const {
  AdminExamsReadError,
  readExamsLimit,
  normalizeExamFilters,
  encodeExamCursor,
  decodeExamCursor,
  createAdminExamsReadService
} = require(
  "../functions/src/admin/admin-exams-read-service"
);

function clone(
  value
) {
  return value === undefined
    ? undefined
    : JSON.parse(
        JSON.stringify(
          value
        )
      );
}

function createFakeFirestore() {
  const data = {
    exam_sessions: {
      "session-a": {
        organizationId:
          "org-1",

        targetBelt:
          "Branca",

        status:
          "draft",

        scheduledAt:
          "2026-10-01",

        priceCents:
          10000,

        correctAnswer:
          "DO_NOT_EXPOSE"
      },

      "session-b": {
        organizationId:
          "org-2",

        targetBelt:
          "Azul",

        status:
          "ready",

        scheduledAt:
          "2026-10-02",

        financialRuleId:
          "finance-secret"
      },

      "session-c": {
        organizationId:
          "org-1",

        targetBelt:
          "Roxa",

        status:
          "archived",

        scheduledAt:
          "2026-10-03"
      }
    },

    organizacoes: {
      "org-1": {
        name:
          "Academia Um",

        cpf:
          "secret-cpf"
      },

      "org-2": {
        nome:
          "Academia Dois",

        asaas_wallet_id:
          "secret-wallet"
      }
    },

    exam_registrations: {
      "reg-1": {
        sessionId:
          "session-b",

        status:
          "authorized"
      },

      "reg-2": {
        sessionId:
          "session-b",

        status:
          "certified"
      },

      "reg-legacy": {
        sessionId:
          "session-b",

        status:
          "legacy_unknown"
      },

      "reg-3": {
        sessionId:
          "session-a",

        status:
          "selected"
      }
    },

    exam_attempts: {
      "attempt-1": {
        sessionId:
          "session-b",

        status:
          "in_progress"
      },

      "attempt-2": {
        sessionId:
          "session-b",

        status:
          "submitted"
      }
    },

    exam_results: {
      "result-1": {
        sessionId:
          "session-b",

        outcome:
          "passed",

        answers: {
          "q-1":
            "A"
        }
      }
    },

    exam_certificates: {
      "cert-1": {
        sessionId:
          "session-b",

        status:
          "valid"
      },

      "cert-2": {
        sessionId:
          "session-b",

        status:
          "revoked"
      }
    }
  };

  const metrics = {
    aggregateQueries:
      0,

    relatedDocumentScans:
      0,

    organizationBatchReads:
      0
  };

  function matches(
    document,
    filters
  ) {
    return filters.every(
      filter =>
        document[
          filter.field
        ] ===
        filter.value
    );
  }

  function queryFor(
    collectionName,
    options = {}
  ) {
    const state = {
      filters:
        options.filters ||
        [],

      startAfter:
        options.startAfter ||
        null,

      limit:
        options.limit ||
        null
    };

    return {
      where(
        field,
        operator,
        value
      ) {
        assert.strictEqual(
          operator,
          "=="
        );

        return queryFor(
          collectionName,
          {
            ...state,

            filters: [
              ...state.filters,
              {
                field,
                value
              }
            ]
          }
        );
      },

      orderBy() {
        return queryFor(
          collectionName,
          state
        );
      },

      startAfter(
        id
      ) {
        return queryFor(
          collectionName,
          {
            ...state,
            startAfter:
              id
          }
        );
      },

      limit(
        value
      ) {
        return queryFor(
          collectionName,
          {
            ...state,
            limit:
              value
          }
        );
      },

      count() {
        return {
          async get() {
            metrics.aggregateQueries +=
              1;

            const entries =
              Object.entries(
                data[
                  collectionName
                ] || {}
              )
                .filter(
                  (
                    [
                      ,
                      document
                    ]
                  ) =>
                    matches(
                      document,
                      state.filters
                    )
                );

            return {
              data() {
                return {
                  count:
                    entries.length
                };
              }
            };
          }
        };
      },

      async get() {
        if (
          collectionName !==
            "exam_sessions"
        ) {
          metrics.relatedDocumentScans +=
            1;

          throw new Error(
            `Related collection scan forbidden: ${collectionName}`
          );
        }

        let entries =
          Object.entries(
            data.exam_sessions
          )
            .sort(
              (
                [a],
                [b]
              ) =>
                a.localeCompare(b)
            );

        if (state.startAfter) {
          entries =
            entries.filter(
              ([id]) =>
                id >
                state.startAfter
            );
        }

        if (state.limit) {
          entries =
            entries.slice(
              0,
              state.limit
            );
        }

        return {
          docs:
            entries.map(
              (
                [
                  id,
                  document
                ]
              ) => ({
                id,

                data() {
                  return clone(
                    document
                  );
                }
              })
            )
        };
      }
    };
  }

  const db = {
    data,
    metrics,

    collection(
      name
    ) {
      return queryFor(
        name
      );
    },

    doc(
      path
    ) {
      const [
        collectionName,
        id
      ] =
        path.split("/");

      return {
        id,
        path,

        async get() {
          const document =
            data[
              collectionName
            ]?.[
              id
            ];

          return {
            id,

            exists:
              document !==
                undefined,

            data() {
              return clone(
                document
              );
            }
          };
        }
      };
    },

    async getAll(
      ...refs
    ) {
      metrics.organizationBatchReads +=
        1;

      return refs.map(
        ref => {
          const [
            collectionName,
            id
          ] =
            ref.path.split("/");

          const document =
            data[
              collectionName
            ]?.[
              id
            ];

          return {
            id,
            ref,

            exists:
              document !==
                undefined,

            data() {
              return clone(
                document
              );
            }
          };
        }
      );
    }
  };

  return db;
}

async function expectError(
  operation,
  ErrorType,
  code
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
    `Expected ${code}`
  );

  assert.ok(
    received instanceof
      ErrorType
  );

  assert.strictEqual(
    received.code,
    code
  );
}

async function main() {
  assert.strictEqual(
    readExamsLimit(),
    10
  );

  assert.strictEqual(
    readExamsLimit(1),
    1
  );

  assert.throws(
    () =>
      readExamsLimit(11),
    error =>
      error instanceof
        AdminExamsReadError &&
      error.code ===
        "ADMIN_EXAMS_LIMIT_INVALID"
  );

  assert.deepStrictEqual(
    normalizeExamFilters({
      status:
        " READY ",

      organizationId:
        "org-2",

      targetBelt:
        " azul "
    }),
    {
      status:
        "ready",

      organizationId:
        "org-2",

      targetBelt:
        "Azul"
    }
  );

  assert.throws(
    () =>
      normalizeExamFilters({
        targetBelt:
          "inexistente"
      }),
    error =>
      error instanceof
        AdminExamsReadError &&
      error.code ===
        "ADMIN_EXAMS_FILTER_INVALID"
  );

  const cursor =
    encodeExamCursor(
      "session-a"
    );

  assert.strictEqual(
    decodeExamCursor(
      cursor
    ),
    "session-a"
  );

  assert.throws(
    () =>
      decodeExamCursor(
        "not-a-valid-cursor"
      ),
    error =>
      error instanceof
        AdminExamsReadError &&
      error.code ===
        "ADMIN_EXAMS_CURSOR_INVALID"
  );

  const db =
    createFakeFirestore();

  const service =
    createAdminExamsReadService({
      db
    });

  const firstPage =
    await service.listExams({
      limit:
        2
    });

  assert.strictEqual(
    firstPage.limit,
    2
  );

  assert.strictEqual(
    firstPage.items.length,
    2
  );

  assert.deepStrictEqual(
    firstPage.items.map(
      item =>
        item.sessionId
    ),
    [
      "session-a",
      "session-b"
    ]
  );

  assert.ok(
    firstPage.nextCursor
  );

  assert.deepStrictEqual(
    firstPage.items[1]
      .registrationCounts,
    {
      total:
        3
    }
  );

  assert.deepStrictEqual(
    firstPage.items[1]
      .attemptCounts,
    {
      total:
        2
    }
  );

  assert.deepStrictEqual(
    firstPage.items[1]
      .resultCounts,
    {
      total:
        1
    }
  );

  assert.deepStrictEqual(
    firstPage.items[1]
      .certificateCounts,
    {
      total:
        2
    }
  );

  assert.strictEqual(
    db.metrics.aggregateQueries,
    8
  );

  assert.strictEqual(
    db.metrics.relatedDocumentScans,
    0
  );

  assert.strictEqual(
    db.metrics.organizationBatchReads,
    1
  );

  const secondPage =
    await service.listExams({
      limit:
        2,

      cursor:
        firstPage.nextCursor
    });

  assert.deepStrictEqual(
    secondPage.items.map(
      item =>
        item.sessionId
    ),
    [
      "session-c"
    ]
  );

  assert.strictEqual(
    secondPage.nextCursor,
    null
  );

  const filtered =
    await service.listExams({
      limit:
        2,

      status:
        "ready",

      organizationId:
        "org-2",

      targetBelt:
        "Azul"
    });

  assert.deepStrictEqual(
    filtered.items.map(
      item =>
        item.sessionId
    ),
    [
      "session-b"
    ]
  );

  const detailDb =
    createFakeFirestore();

  const detailService =
    createAdminExamsReadService({
      db:
        detailDb
    });

  const detail =
    await detailService
      .getExam({
        sessionId:
          "session-b"
      });

  assert.strictEqual(
    detail.exam.sessionId,
    "session-b"
  );

  assert.deepStrictEqual(
    detail.exam.organizationSummary,
    {
      organizationId:
        "org-2",

      name:
        "Academia Dois"
    }
  );

  assert.deepStrictEqual(
    detail.exam.registrationCounts,
    {
      total:
        3,

      selected:
        0,

      awaitingPayment:
        0,

      authorized:
        1,

      started:
        0,

      submitted:
        0,

      passed:
        0,

      failed:
        0,

      certified:
        1,

      cancelled:
        0,

      needsReconciliation:
        0
    }
  );

  assert.deepStrictEqual(
    detail.exam.attemptCounts,
    {
      total:
        2,

      inProgress:
        1,

      submitted:
        1,

      invalidated:
        0
    }
  );

  assert.deepStrictEqual(
    detail.exam.resultCounts,
    {
      total:
        1,

      passed:
        1,

      failed:
        0
    }
  );

  assert.deepStrictEqual(
    detail.exam.certificateCounts,
    {
      total:
        2,

      valid:
        1,

      revoked:
        1
    }
  );

  // Detail:
  // registrations = 1 total + 10 statuses
  // attempts      = 1 total + 3 statuses
  // results       = 1 total + 2 outcomes
  // certificates  = 1 total + 2 statuses
  // total         = 21 aggregate queries
  assert.strictEqual(
    detailDb.metrics.aggregateQueries,
    21
  );

  assert.strictEqual(
    detailDb.metrics.relatedDocumentScans,
    0
  );

  const serialized =
    JSON.stringify(
      detail
    );

  for (
    const forbidden
    of [
      "financialRuleId",
      "priceCents",
      "correctAnswer",
      "answers",
      "cpf",
      "wallet",
      "asaas"
    ]
  ) {
    assert.strictEqual(
      serialized.includes(
        forbidden
      ),
      false
    );
  }

  await expectError(
    () =>
      detailService.getExam({
        sessionId:
          "missing"
      }),
    AdminExamsReadError,
    "ADMIN_EXAM_NOT_FOUND"
  );

  assert.throws(
    () =>
      createAdminExamsReadService({
        db: {}
      }),
    TypeError
  );

  console.log(
    "MARCO8_EXAM_READ_COLLECTION=exam_sessions"
  );

  console.log(
    "MARCO8_EXAM_ORGANIZATION_COLLECTION=organizacoes"
  );

  console.log(
    "MARCO8_EXAM_LIST_LIMIT=10"
  );

  console.log(
    "MARCO8_EXAM_CURSOR=DOCUMENT_ID_V1"
  );

  console.log(
    "MARCO8_EXAM_FILTERS=3/3"
  );

  console.log(
    "MARCO8_EXAM_LIST_AGGREGATES_PER_ITEM=4"
  );

  console.log(
    "MARCO8_EXAM_LIST_MAX_AGGREGATES_PER_PAGE=40"
  );

  console.log(
    "MARCO8_EXAM_DETAIL_AGGREGATES=21"
  );

  console.log(
    "MARCO8_EXAM_RELATED_DOCUMENT_SCAN=False"
  );

  console.log(
    "MARCO8_EXAM_ORGANIZATION_BATCH_READ=True"
  );

  console.log(
    "MARCO8_ADMIN_EXAMS_READ_SERVICE=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
