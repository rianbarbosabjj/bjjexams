"use strict";

const assert =
  require("assert");

const {
  AUDIT_LOGS_COLLECTION,
  DEFAULT_AUDIT_LIMIT,
  MAX_AUDIT_LIMIT,
  AUDIT_CURSOR_VERSION,
  AUDIT_SCAN_BATCH_SIZE,
  AUDIT_MAX_SCAN_DOCS,
  AdminAuditReadError,
  readAuditLimit,
  normalizeAuditFilters,
  encodeAuditCursor,
  decodeAuditCursor,
  createAdminAuditReadService
} = require(
  "../functions/src/admin/admin-audit-read-service"
);

function clone(
  value
) {
  return JSON.parse(
    JSON.stringify(
      value
    )
  );
}

class FakeDocumentSnapshot {
  constructor(
    reference,
    value
  ) {
    this.ref =
      reference;

    this.id =
      reference.id;

    this.exists =
      value !==
      undefined;

    this.value =
      value;
  }

  data() {
    return this.exists
      ? clone(
          this.value
        )
      : undefined;
  }
}

class FakeDocumentReference {
  constructor(
    db,
    pathValue
  ) {
    this.db =
      db;

    this.path =
      pathValue;

    this.id =
      pathValue
        .split("/")
        .pop();
  }
}

class FakeQuery {
  constructor(
    db,
    collectionName,
    state = {}
  ) {
    this.db =
      db;

    this.collectionName =
      collectionName;

    this.ordering =
      state.ordering ||
      [];

    this.after =
      state.after ||
      null;

    this.limitValue =
      state.limitValue ??
      null;
  }

  clone(
    patch = {}
  ) {
    return new FakeQuery(
      this.db,
      this.collectionName,
      {
        ordering:
          patch.ordering ??
          this.ordering,

        after:
          patch.after ??
          this.after,

        limitValue:
          patch.limitValue ??
          this.limitValue
      }
    );
  }

  orderBy(
    field,
    direction = "asc"
  ) {
    return this.clone({
      ordering: [
        ...this.ordering,
        {
          field,
          direction
        }
      ]
    });
  }

  startAfter(
    createdAt,
    auditId
  ) {
    return this.clone({
      after: {
        createdAtMillis:
          new Date(
            createdAt
          ).getTime(),

        auditId:
          String(
            auditId
          )
      }
    });
  }

  limit(
    value
  ) {
    return this.clone({
      limitValue:
        Number(value)
    });
  }

  async get() {
    this.db.readOperations
      .push({
        kind:
          "query.get",

        collection:
          this.collectionName,

        ordering:
          this.ordering.map(
            item => ({
              field:
                String(
                  item.field
                ),

              direction:
                item.direction
            })
          ),

        after:
          this.after
            ? {
                ...this.after
              }
            : null,

        limit:
          this.limitValue
      });

    let entries =
      this.db
        .entriesForCollection(
          this.collectionName
        )
        .sort(
          (
            left,
            right
          ) => {
            const leftMillis =
              new Date(
                left.value
                  .createdAt
              ).getTime();

            const rightMillis =
              new Date(
                right.value
                  .createdAt
              ).getTime();

            if (
              leftMillis !==
                rightMillis
            ) {
              return (
                rightMillis -
                leftMillis
              );
            }

            return right.id
              .localeCompare(
                left.id
              );
          }
        );

    if (
      this.after
    ) {
      entries =
        entries.filter(
          entry => {
            const millis =
              new Date(
                entry.value
                  .createdAt
              ).getTime();

            if (
              millis <
                this.after
                  .createdAtMillis
            ) {
              return true;
            }

            if (
              millis >
                this.after
                  .createdAtMillis
            ) {
              return false;
            }

            return (
              entry.id
                .localeCompare(
                  this.after
                    .auditId
                ) <
              0
            );
          }
        );
    }

    if (
      Number.isSafeInteger(
        this.limitValue
      )
    ) {
      entries =
        entries.slice(
          0,
          this.limitValue
        );
    }

    return {
      docs:
        entries.map(
          entry =>
            this.db.snapshot(
              `${this.collectionName}/${entry.id}`
            )
        )
    };
  }
}

class FakeDb {
  constructor(
    seed = {}
  ) {
    this.records =
      new Map(
        Object.entries(
          clone(
            seed
          )
        )
      );

    this.readOperations =
      [];

    this.writeOperations =
      [];
  }

  collection(
    name
  ) {
    return new FakeQuery(
      this,
      name
    );
  }

  snapshot(
    pathValue
  ) {
    const value =
      this.records.has(
        pathValue
      )
        ? this.records.get(
            pathValue
          )
        : undefined;

    return new FakeDocumentSnapshot(
      new FakeDocumentReference(
        this,
        pathValue
      ),
      value
    );
  }

  entriesForCollection(
    name
  ) {
    const prefix =
      `${name}/`;

    return Array
      .from(
        this.records.entries()
      )
      .filter(
        ([pathValue]) =>
          pathValue.startsWith(
            prefix
          ) &&
          !pathValue
            .slice(
              prefix.length
            )
            .includes("/")
      )
      .map(
        ([
          pathValue,
          value
        ]) => ({
          id:
            pathValue.slice(
              prefix.length
            ),

          value:
            clone(
              value
            )
        })
      );
  }
}

function seed() {
  return {
    "audit_logs/audit-d": {
      eventType:
        "admin.webhook.reprocess.requested",

      actorUid:
        "finance-1",

      actorRole:
        "finance_admin",

      targetType:
        "webhook_event",

      targetId:
        "event-1",

      organizationId:
        null,

      source:
        "function",

      requestId:
        "request-d",

      createdAt:
        "2026-09-30T10:04:00.000Z",

      metadata: {
        schemaVersion:
          1,

        previousStatus:
          "error",

        previousErrorCode:
          "PROVIDER_PAYMENT_VALUE_MISMATCH",

        reprocessCount:
          1
      }
    },

    "audit_logs/audit-c": {
      actorId:
        "admin-org",

      actorRole:
        "support_admin",

      action:
        "admin.organization.suspended",

      entityType:
        "organization",

      entityId:
        "org-1",

      organizationId:
        "org-1",

      before: {
        status:
          "active"
      },

      after: {
        status:
          "suspended"
      },

      source:
        "function",

      requestId:
        "request-c",

      createdAt:
        "2026-09-30T10:03:00.000Z",

      metadata: {
        schemaVersion:
          1
      }
    },

    "audit_logs/audit-b": {
      actorId:
        "system:asaas-webhook",

      actorRole:
        "system",

      action:
        "financial.payment.confirmed",

      entityType:
        "payment_transaction",

      entityId:
        "transaction-1",

      before: {
        orderStatus:
          "pending_payment",

        transactionStatus:
          "pending",

        walletId:
          "wallet-secret"
      },

      after: {
        orderStatus:
          "paid",

        transactionStatus:
          "paid",

        providerStatus:
          "RECEIVED",

        amountCents:
          10000
      },

      source:
        "webhook_worker",

      requestId:
        "event-b",

      createdAt:
        "2026-09-30T10:02:00.000Z"
    },

    "audit_logs/audit-a": {
      actorId:
        "content-1",

      actorRole:
        "content_admin",

      action:
        "admin.question.updated",

      entityType:
        "question",

      entityId:
        "question-1",

      before: {
        lifecycleStatus:
          "draft",

        revision:
          2,

        statement:
          "secret question body"
      },

      after: {
        lifecycleStatus:
          "pending_review",

        revision:
          3,

        statement:
          "changed secret question body"
      },

      source:
        "function",

      requestId:
        "request-a",

      createdAt:
        "2026-09-30T10:01:00.000Z",

      metadata: {
        schemaVersion:
          1,

        operation:
          "update",

        changedFields: [
          "statement"
        ]
      }
    }
  };
}

async function main() {
  assert.strictEqual(
    AUDIT_LOGS_COLLECTION,
    "audit_logs"
  );

  assert.strictEqual(
    DEFAULT_AUDIT_LIMIT,
    20
  );

  assert.strictEqual(
    MAX_AUDIT_LIMIT,
    25
  );

  assert.strictEqual(
    AUDIT_CURSOR_VERSION,
    1
  );

  assert.strictEqual(
    AUDIT_SCAN_BATCH_SIZE,
    26
  );

  assert.strictEqual(
    AUDIT_MAX_SCAN_DOCS,
    260
  );

  assert.strictEqual(
    readAuditLimit(),
    20
  );

  assert.strictEqual(
    readAuditLimit(
      25
    ),
    25
  );

  assert.throws(
    () =>
      readAuditLimit(
        26
      ),
    error =>
      error instanceof
        AdminAuditReadError &&
      error.code ===
        "ADMIN_AUDIT_LIMIT_INVALID"
  );

  assert.deepStrictEqual(
    normalizeAuditFilters({
      eventType:
        " ADMIN.ORGANIZATION.SUSPENDED ",

      actorUid:
        " admin-org ",

      targetType:
        " ORGANIZATION ",

      targetId:
        " org-1 ",

      organizationId:
        " org-1 "
    }),
    {
      eventType:
        "admin.organization.suspended",

      actorUid:
        "admin-org",

      targetType:
        "organization",

      targetId:
        "org-1",

      organizationId:
        "org-1"
    }
  );

  assert.deepStrictEqual(
    normalizeAuditFilters({
      targetType:
        "course_content",

      targetId:
        "course-1/lessons/lesson-1"
    }),
    {
      eventType:
        null,

      actorUid:
        null,

      targetType:
        "course_content",

      targetId:
        "course-1/lessons/lesson-1",

      organizationId:
        null
    }
  );

  assert.throws(
    () =>
      normalizeAuditFilters({
        targetId:
          "course-1/lessons/lesson-1"
      }),
    error =>
      error instanceof
        AdminAuditReadError &&
      error.code ===
        "ADMIN_AUDIT_FILTER_INVALID"
  );

  const cursor =
    encodeAuditCursor({
      auditId:
        "audit-d",

      createdAt:
        "2026-09-30T10:04:00.000Z"
    });

  assert.deepStrictEqual(
    decodeAuditCursor(
      cursor
    ),
    {
      createdAtMillis:
        Date.parse(
          "2026-09-30T10:04:00.000Z"
        ),

      auditId:
        "audit-d"
    }
  );

  assert.throws(
    () =>
      decodeAuditCursor(
        "not-a-valid-cursor"
      ),
    error =>
      error instanceof
        AdminAuditReadError &&
      error.code ===
        "ADMIN_AUDIT_CURSOR_INVALID"
  );

  const db =
    new FakeDb(
      seed()
    );

  const service =
    createAdminAuditReadService({
      db,

      documentIdField:
        "__name__"
    });

  const firstPage =
    await service.listAuditEvents({
      limit:
        1
    });

  assert.deepStrictEqual(
    firstPage.items.map(
      item =>
        item.auditId
    ),
    [
      "audit-d"
    ]
  );

  assert.ok(
    firstPage.nextCursor
  );

  const secondPage =
    await service.listAuditEvents({
      limit:
        1,

      cursor:
        firstPage.nextCursor
    });

  assert.deepStrictEqual(
    secondPage.items.map(
      item =>
        item.auditId
    ),
    [
      "audit-c"
    ]
  );

  assert.ok(
    secondPage.nextCursor
  );

  const filtered =
    await service.listAuditEvents({
      eventType:
        "admin.organization.suspended",

      actorUid:
        "admin-org",

      targetType:
        "organization",

      targetId:
        "org-1",

      organizationId:
        "org-1"
    });

  assert.deepStrictEqual(
    filtered.items.map(
      item =>
        item.auditId
    ),
    [
      "audit-c"
    ]
  );

  const all =
    await service.listAuditEvents({
      limit:
        25
    });

  assert.deepStrictEqual(
    all.items.map(
      item =>
        item.auditId
    ),
    [
      "audit-d",
      "audit-c",
      "audit-b",
      "audit-a"
    ]
  );

  const courseContentDb =
    new FakeDb({
      "audit_logs/audit-course-content": {
        actorId:
          "instructor-1",

        actorRole:
          "instructor",

        action:
          "course.content.lesson.created",

        entityType:
          "course_content",

        entityId:
          "course-1/lessons/lesson-1",

        before:
          null,

        after: {
          title:
            "Nao expor conteudo"
        },

        source:
          "function",

        requestId:
          null,

        createdAt:
          "2026-09-30T12:30:00.000Z"
      }
    });

  const courseContentService =
    createAdminAuditReadService({
      db:
        courseContentDb,

      documentIdField:
        "__name__"
    });

  const courseContentPage =
    await courseContentService
      .listAuditEvents({
        targetType:
          "course_content",

        targetId:
          "course-1/lessons/lesson-1"
      });

  assert.deepStrictEqual(
    courseContentPage.items.map(
      item => ({
        eventType:
          item.eventType,

        target:
          item.target,

        requestId:
          item.requestId
      })
    ),
    [
      {
        eventType:
          "course.content.lesson.created",

        target: {
          type:
            "course_content",

          id:
            "course-1/lessons/lesson-1"
        },

        requestId:
          null
      }
    ]
  );

  assert.strictEqual(
    courseContentDb.writeOperations.length,
    0
  );

  const serialized =
    JSON.stringify(
      all
    );

  for (
    const forbidden
    of [
      "\"before\"",
      "\"after\"",
      "wallet-secret",
      "secret question body",
      "changed secret question body",
      "amountCents",
      "recipientShares",
      "correctAnswer",
      "cpf",
      "password",
      "bearerToken",
      "rawPayload"
    ]
  ) {
    assert.strictEqual(
      serialized.includes(
        forbidden
      ),
      false,
      `Audit service leaked ${forbidden}`
    );
  }

  assert.strictEqual(
    db.writeOperations.length,
    0
  );

  assert.ok(
    db.readOperations.every(
      operation =>
        operation.kind ===
          "query.get" &&
        operation.collection ===
          "audit_logs"
    )
  );

  const invalidDb =
    new FakeDb({
      "audit_logs/broken": {
        actorId:
          "admin-1",

        actorRole:
          "support_admin",

        action:
          "admin.person.suspended",

        eventType:
          "admin.person.reactivated",

        entityType:
          "person",

        entityId:
          "person-1",

        source:
          "function",

        requestId:
          "request-broken",

        createdAt:
          "2026-09-30T11:00:00.000Z"
      }
    });

  const invalidService =
    createAdminAuditReadService({
      db:
        invalidDb,

      documentIdField:
        "__name__"
    });

  await assert.rejects(
    () =>
      invalidService
        .listAuditEvents(),
    error =>
      error instanceof
        AdminAuditReadError &&
      error.code ===
        "ADMIN_AUDIT_CANONICAL_STATE_INVALID"
  );

  console.log(
    "MARCO8_6D_AUDIT_COLLECTION=audit_logs"
  );

  console.log(
    "MARCO8_6D_AUDIT_LIMITS=PASSED"
  );

  console.log(
    "MARCO8_6D_AUDIT_FILTERS=5/5"
  );

  console.log(
    "MARCO8_6D_AUDIT_CURSOR=PASSED"
  );

  console.log(
    "MARCO8_6D_AUDIT_ORDERING=CREATED_AT_DESC_ID_DESC"
  );

  console.log(
    "MARCO8_6D_AUDIT_BOUNDED_SCAN=PASSED"
  );

  console.log(
    "MARCO8_6D_LEGACY_COMPATIBILITY=PASSED"
  );

  console.log(
    "MARCO8_6D_CANONICAL_FAIL_CLOSED=PASSED"
  );

  console.log(
    "MARCO8_6D_RAW_BEFORE_AFTER_EXPOSURE=False"
  );

  console.log(
    "MARCO8_6D_SENSITIVE_FIELD_EXPOSURE=False"
  );

  console.log(
    "MARCO8_6D_FIRESTORE_WRITES=False"
  );

  console.log(
    "MARCO8_6D_ADMIN_AUDIT_READ_SERVICE=PASSED"
  );
}

main()
  .catch(
    error => {
      console.error(
        error
      );

      process.exitCode =
        1;
    }
  );
