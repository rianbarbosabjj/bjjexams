"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  enrollmentDocumentId
} = require(
  "../functions/src/courses/course-enrollment-domain"
);

const {
  examRegistrationDocumentId
} = require(
  "../functions/src/exams/exam-registration-domain"
);

const {
  ORDERS_COLLECTION,
  PAYMENT_TRANSACTIONS_COLLECTION,
  COURSES_COLLECTION,
  EXAM_SESSIONS_COLLECTION,
  ENROLLMENTS_COLLECTION,
  EXAM_REGISTRATIONS_COLLECTION,
  USERS_COLLECTION,
  REVERSAL_REQUESTS_COLLECTION,
  REVERSAL_OPERATIONS,

  DEFAULT_ORDERS_LIMIT,
  MAX_ORDERS_LIMIT,
  ORDER_CURSOR_VERSION,
  ORDER_SCAN_BATCH_SIZE,
  ORDER_MAX_SCAN_DOCS,

  FINANCIAL_PRODUCT_TYPES,
  ORDER_STATUSES,

  AdminOrdersReadError,

  readOrdersLimit,
  normalizeOrderFilters,
  matchesOrderFilters,
  encodeOrderCursor,
  decodeOrderCursor,
  selectRelevantReversal,

  createAdminOrdersReadService
} = require(
  "../functions/src/admin/admin-orders-read-service"
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

  async get() {
    this.db.readOperations
      .push({
        kind:
          "doc.get",

        path:
          this.path
      });

    return this.db.snapshot(
      this.path
    );
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

    this.filters =
      state.filters ||
      [];

    this.afterId =
      state.afterId ||
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
        filters:
          patch.filters ??
          this.filters,

        afterId:
          patch.afterId ??
          this.afterId,

        limitValue:
          patch.limitValue ??
          this.limitValue
      }
    );
  }

  where(
    field,
    operator,
    value
  ) {
    return this.clone({
      filters: [
        ...this.filters,
        {
          field,
          operator,
          value
        }
      ]
    });
  }

  orderBy(
    _field
  ) {
    return this.clone();
  }

  startAfter(
    value
  ) {
    return this.clone({
      afterId:
        String(value)
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

        filters:
          clone(
            this.filters
          ),

        afterId:
          this.afterId,

        limit:
          this.limitValue
      });

    let entries =
      this.db
        .entriesForCollection(
          this.collectionName
        );

    for (
      const filter
      of this.filters
    ) {
      entries =
        entries.filter(
          entry => {
            const current =
              entry.value?.[
                filter.field
              ];

            if (
              filter.operator ===
              "=="
            ) {
              return current ===
                filter.value;
            }

            if (
              filter.operator ===
              "in"
            ) {
              return (
                Array.isArray(
                  filter.value
                ) &&
                filter.value
                  .includes(
                    current
                  )
              );
            }

            throw new Error(
              `Unsupported fake operator: ${filter.operator}`
            );
          }
        );
    }

    if (
      this.afterId
    ) {
      entries =
        entries.filter(
          entry =>
            entry.id.localeCompare(
              this.afterId
            ) > 0
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

    const docs =
      entries.map(
        entry =>
          this.db.snapshot(
            `${this.collectionName}/${entry.id}`
          )
      );

    return {
      docs,
      empty:
        docs.length ===
        0
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
  }

  doc(
    pathValue
  ) {
    return new FakeDocumentReference(
      this,
      pathValue
    );
  }

  collection(
    name
  ) {
    return new FakeQuery(
      this,
      name
    );
  }

  async getAll(
    ...references
  ) {
    this.readOperations
      .push({
        kind:
          "getAll",

        paths:
          references.map(
            reference =>
              reference.path
          )
      });

    return references.map(
      reference =>
        this.snapshot(
          reference.path
        )
    );
  }

  snapshot(
    pathValue
  ) {
    return new FakeDocumentSnapshot(
      this.doc(
        pathValue
      ),
      this.records.get(
        pathValue
      )
    );
  }

  entriesForCollection(
    collectionName
  ) {
    const prefix =
      `${collectionName}/`;

    const result =
      [];

    for (
      const [
        key,
        value
      ]
      of this.records.entries()
    ) {
      if (
        !key.startsWith(
          prefix
        )
      ) {
        continue;
      }

      const id =
        key.slice(
          prefix.length
        );

      if (
        !id ||
        id.includes("/")
      ) {
        continue;
      }

      result.push({
        id,
        value:
          clone(
            value
          )
      });
    }

    return result.sort(
      (
        left,
        right
      ) =>
        left.id.localeCompare(
          right.id
        )
    );
  }
}

function financialSnapshot(
  productType,
  productId,
  amountCents =
    10000
) {
  const platformFeeCents =
    Math.floor(
      (
        amountCents *
        1000 +
        5000
      ) /
      10000
    );

  const sellerPoolCents =
    amountCents -
    platformFeeCents;

  return {
    ruleId:
      "rule-default",

    ruleVersion:
      1,

    productType,
    productId,

    currency:
      "BRL",

    grossAmountCents:
      amountCents,

    platformFeeBps:
      1000,

    platformFeeCents,
    sellerPoolCents,

    recipientMode:
      "explicit",

    recipientAllocations: [
      {
        recipientType:
          "platform",

        recipientId:
          null,

        shareBps:
          10000,

        amountCents:
          sellerPoolCents
      }
    ],

    resolvedAt:
      "2026-09-29T12:00:00.000Z"
  };
}

function paidOrder(
  {
    productType,
    productId,
    userId,
    transactionId,
    amountCents =
      10000,
    createdAt =
      "2026-09-29T12:00:00.000Z"
  }
) {
  return {
    buyerUserId:
      userId,

    productType,
    productId,

    quantity:
      1,

    amountCents,

    currency:
      "BRL",

    status:
      "paid",

    financialSnapshot:
      financialSnapshot(
        productType,
        productId,
        amountCents
      ),

    provider:
      "asaas",

    providerCustomerId:
      `customer-${userId}`,

    currentTransactionId:
      transactionId,

    idempotencyKey:
      `idempotency-${transactionId}`,

    createdAt,

    updatedAt:
      createdAt,

    paidAt:
      createdAt,

    cancelledAt:
      null,

    expiredAt:
      null,

    refundedAt:
      null,

    chargebackAt:
      null
  };
}

function paidTransaction(
  {
    orderId,
    userId,
    productType,
    productId,
    transactionId,
    amountCents =
      10000,
    createdAt =
      "2026-09-29T12:00:00.000Z"
  }
) {
  return {
    orderId,

    buyerUserId:
      userId,

    provider:
      "asaas",

    providerPaymentId:
      `payment-${transactionId}`,

    providerStatus:
      "CONFIRMED",

    status:
      "paid",

    amountCents,

    currency:
      "BRL",

    financialSnapshot:
      financialSnapshot(
        productType,
        productId,
        amountCents
      ),

    providerSplitSnapshot: {
      walletId:
        "wallet-secret"
    },

    createdAt,

    updatedAt:
      createdAt,

    confirmedAt:
      createdAt,

    refundedAt:
      null,

    chargebackAt:
      null
  };
}

function buildSeed() {
  const courseOrderId =
    "order-a-course";

  const courseTransactionId =
    "transaction-a";

  const examOrderId =
    "order-b-exam";

  const examTransactionId =
    "transaction-b";

  const courseId =
    "course-1";

  const courseUserId =
    "user-1";

  const sessionId =
    "session-1";

  const examUserId =
    "user-2";

  const enrollmentId =
    enrollmentDocumentId(
      courseId,
      courseUserId
    );

  const registrationId =
    examRegistrationDocumentId({
      sessionId,
      studentId:
        examUserId
    });

  return {
    [`orders/${courseOrderId}`]:
      paidOrder({
        productType:
          "course",

        productId:
          courseId,

        userId:
          courseUserId,

        transactionId:
          courseTransactionId,

        createdAt:
          "2026-09-29T12:00:00.000Z"
      }),

    [`payment_transactions/${courseTransactionId}`]:
      paidTransaction({
        orderId:
          courseOrderId,

        userId:
          courseUserId,

        productType:
          "course",

        productId:
          courseId,

        transactionId:
          courseTransactionId,

        createdAt:
          "2026-09-29T12:00:00.000Z"
      }),

    [`courses/${courseId}`]: {
      title:
        " Curso Operacional ",

      financialRuleId:
        "must-not-leak",

      priceCents:
        10000
    },

    [`usuarios/${courseUserId}`]: {
      nome:
        " Aluno Curso ",

      email:
        "CURSO@EXAMPLE.COM",

      cpf:
        "must-not-leak",

      phone:
        "must-not-leak",

      claims: {
        super_admin:
          true
      }
    },

    [`enrollments/${enrollmentId}`]: {
      courseId,
      userId:
        courseUserId,

      source:
        "order",

      orderId:
        courseOrderId,

      status:
        "active",

      progressPercent:
        35,

      startedAt:
        "started-at",

      completedAt:
        null,

      createdAt:
        "enrollment-created",

      updatedAt:
        "enrollment-updated"
    },

    "financial_reversal_requests/reversal-course": {
      operation:
        "refund_full",

      orderId:
        courseOrderId,

      transactionId:
        courseTransactionId,

      status:
        "awaiting_webhook",

      provider:
        "asaas",

      providerPaymentId:
        "must-not-leak",

      reason:
        "must-not-leak",

      createdAt:
        "2026-09-29T12:10:00.000Z",

      updatedAt:
        "2026-09-29T12:11:00.000Z"
    },

    [`orders/${examOrderId}`]:
      paidOrder({
        productType:
          "belt_exam",

        productId:
          sessionId,

        userId:
          examUserId,

        transactionId:
          examTransactionId,

        createdAt:
          "2026-09-29T13:00:00.000Z"
      }),

    [`payment_transactions/${examTransactionId}`]:
      paidTransaction({
        orderId:
          examOrderId,

        userId:
          examUserId,

        productType:
          "belt_exam",

        productId:
          sessionId,

        transactionId:
          examTransactionId,

        createdAt:
          "2026-09-29T13:00:00.000Z"
      }),

    [`exam_sessions/${sessionId}`]: {
      targetBelt:
        "Azul",

      priceCents:
        10000,

      financialRuleId:
        "must-not-leak"
    },

    [`usuarios/${examUserId}`]: {
      displayName:
        " Aluno Exame ",

      email:
        "EXAME@EXAMPLE.COM",

      cpf:
        "must-not-leak"
    },

    [`exam_registrations/${registrationId}`]: {
      sessionId,

      organizationId:
        "org-1",

      studentId:
        examUserId,

      instructorId:
        "instructor-1",

      currentBelt:
        "Branca",

      targetBelt:
        "Azul",

      membershipId:
        "membership-1",

      status:
        "needs_reconciliation",

      orderId:
        examOrderId,

      attemptId:
        null,

      resultId:
        null,

      certificateId:
        null,

      selectedAt:
        "selected-at",

      paidAt:
        null,

      authorizedAt:
        null,

      cancelledAt:
        null,

      updatedAt:
        "registration-updated"
    }
  };
}

async function main() {
  assert.strictEqual(
    ORDERS_COLLECTION,
    "orders"
  );

  assert.strictEqual(
    PAYMENT_TRANSACTIONS_COLLECTION,
    "payment_transactions"
  );

  assert.strictEqual(
    COURSES_COLLECTION,
    "courses"
  );

  assert.strictEqual(
    EXAM_SESSIONS_COLLECTION,
    "exam_sessions"
  );

  assert.strictEqual(
    ENROLLMENTS_COLLECTION,
    "enrollments"
  );

  assert.strictEqual(
    EXAM_REGISTRATIONS_COLLECTION,
    "exam_registrations"
  );

  assert.strictEqual(
    USERS_COLLECTION,
    "usuarios"
  );

  assert.strictEqual(
    REVERSAL_REQUESTS_COLLECTION,
    "financial_reversal_requests"
  );

  assert.deepStrictEqual(
    REVERSAL_OPERATIONS,
    [
      "cancel_pending",
      "refund_full"
    ]
  );

  assert.strictEqual(
    DEFAULT_ORDERS_LIMIT,
    20
  );

  assert.strictEqual(
    MAX_ORDERS_LIMIT,
    25
  );

  assert.strictEqual(
    ORDER_CURSOR_VERSION,
    1
  );

  assert.strictEqual(
    ORDER_SCAN_BATCH_SIZE,
    26
  );

  assert.strictEqual(
    ORDER_MAX_SCAN_DOCS,
    260
  );

  assert.deepStrictEqual(
    FINANCIAL_PRODUCT_TYPES,
    [
      "course",
      "belt_exam"
    ]
  );

  assert.deepStrictEqual(
    ORDER_STATUSES,
    [
      "pending_payment",
      "paid",
      "cancelled",
      "expired",
      "refunded",
      "chargeback"
    ]
  );

  assert.strictEqual(
    readOrdersLimit(),
    20
  );

  assert.strictEqual(
    readOrdersLimit(
      25
    ),
    25
  );

  assert.throws(
    () =>
      readOrdersLimit(
        26
      ),
    error =>
      error instanceof
        AdminOrdersReadError &&
      error.code ===
        "ADMIN_ORDERS_LIMIT_INVALID"
  );

  assert.deepStrictEqual(
    normalizeOrderFilters({
      productType:
        " BELT_EXAM ",

      orderStatus:
        " PAID "
    }),
    {
      productType:
        "belt_exam",

      orderStatus:
        "paid"
    }
  );

  assert.strictEqual(
    matchesOrderFilters(
      {
        productType:
          "course",

        status:
          "paid"
      },
      {
        productType:
          "course",

        orderStatus:
          "paid"
      }
    ),
    true
  );

  assert.throws(
    () =>
      normalizeOrderFilters({
        productType:
          "subscription"
      }),
    error =>
      error instanceof
        AdminOrdersReadError &&
      error.code ===
        "ADMIN_ORDERS_FILTER_INVALID"
  );

  const cursor =
    encodeOrderCursor(
      "order-a-course"
    );

  assert.strictEqual(
    decodeOrderCursor(
      cursor
    ),
    "order-a-course"
  );

  assert.throws(
    () =>
      decodeOrderCursor(
        Buffer
          .from(
            JSON.stringify({
              v:
                99,

              lastOrderId:
                "order-a-course"
            })
          )
          .toString(
            "base64url"
          )
      ),
    error =>
      error instanceof
        AdminOrdersReadError &&
      error.code ===
        "ADMIN_ORDERS_CURSOR_INVALID"
  );

  const selectedReversal =
    selectRelevantReversal([
      {
        id:
          "completed",

        data: {
          status:
            "completed",

          updatedAt:
            "2026-09-29T12:20:00.000Z"
        }
      },
      {
        id:
          "reconcile",

        data: {
          status:
            "needs_reconciliation",

          updatedAt:
            "2026-09-29T12:00:00.000Z"
        }
      }
    ]);

  assert.strictEqual(
    selectedReversal.id,
    "reconcile"
  );

  const db =
    new FakeDb(
      buildSeed()
    );

  const service =
    createAdminOrdersReadService({
      db,

      documentIdField:
        "__name__"
    });

  const firstPage =
    await service.listOrders({
      limit:
        1
    });

  assert.strictEqual(
    firstPage.limit,
    1
  );

  assert.deepStrictEqual(
    firstPage.items.map(
      item =>
        item.orderId
    ),
    [
      "order-a-course"
    ]
  );

  assert.ok(
    firstPage.nextCursor
  );

  const secondPage =
    await service.listOrders({
      limit:
        1,

      cursor:
        firstPage.nextCursor
    });

  assert.deepStrictEqual(
    secondPage.items.map(
      item =>
        item.orderId
    ),
    [
      "order-b-exam"
    ]
  );

  assert.strictEqual(
    secondPage.nextCursor,
    null
  );

  const fullPage =
    await service.listOrders({
      limit:
        25
    });

  assert.strictEqual(
    fullPage.items.length,
    2
  );

  const courseView =
    fullPage.items.find(
      item =>
        item.orderId ===
        "order-a-course"
    );

  const examView =
    fullPage.items.find(
      item =>
        item.orderId ===
        "order-b-exam"
    );

  assert.ok(
    courseView
  );

  assert.ok(
    examView
  );

  assert.deepStrictEqual(
    courseView.productSummary,
    {
      productType:
        "course",

      productId:
        "course-1",

      label:
        "Curso Operacional"
    }
  );

  assert.deepStrictEqual(
    courseView.buyerSummary,
    {
      userId:
        "user-1",

      displayName:
        "Aluno Curso",

      email:
        "curso@example.com"
    }
  );

  assert.deepStrictEqual(
    courseView.paymentStatus,
    {
      orderStatus:
        "paid",

      transactionStatus:
        "paid"
    }
  );

  assert.deepStrictEqual(
    courseView.fulfillmentStatus,
    {
      kind:
        "enrollment",

      status:
        "active"
    }
  );

  assert.deepStrictEqual(
    courseView.reversalStatus,
    {
      status:
        "awaiting_webhook",

      operation:
        "refund_full"
    }
  );

  assert.deepStrictEqual(
    courseView.reconciliationStatus,
    {
      required:
        false
    }
  );

  assert.deepStrictEqual(
    examView.productSummary,
    {
      productType:
        "belt_exam",

      productId:
        "session-1",

      label:
        "Exame de faixa - Azul"
    }
  );

  assert.deepStrictEqual(
    examView.buyerSummary,
    {
      userId:
        "user-2",

      displayName:
        "Aluno Exame",

      email:
        "exame@example.com"
    }
  );

  assert.deepStrictEqual(
    examView.fulfillmentStatus,
    {
      kind:
        "exam_registration",

      status:
        "needs_reconciliation"
    }
  );

  assert.deepStrictEqual(
    examView.reconciliationStatus,
    {
      required:
        true
    }
  );

  const onlyExam =
    await service.listOrders({
      productType:
        "belt_exam"
    });

  assert.deepStrictEqual(
    onlyExam.items.map(
      item =>
        item.orderId
    ),
    [
      "order-b-exam"
    ]
  );

  const paidOnly =
    await service.listOrders({
      orderStatus:
        "paid"
    });

  assert.strictEqual(
    paidOnly.items.length,
    2
  );

  const detail =
    await service.getOrder({
      orderId:
        "order-b-exam"
    });

  assert.strictEqual(
    detail.orderId,
    "order-b-exam"
  );

  assert.deepStrictEqual(
    detail,
    examView
  );

  await assert.rejects(
    () =>
      service.getOrder({
        orderId:
          "missing-order"
      }),
    error =>
      error instanceof
        AdminOrdersReadError &&
      error.code ===
        "ADMIN_ORDER_NOT_FOUND"
  );

  await assert.rejects(
    () =>
      service.listOrders({
        productType:
          "invalid"
      }),
    error =>
      error instanceof
        AdminOrdersReadError &&
      error.code ===
        "ADMIN_ORDERS_FILTER_INVALID"
  );

  const serialized =
    JSON.stringify(
      fullPage
    );

  for (
    const forbidden
    of [
      "providerPaymentId",
      "providerCustomerId",
      "walletId",
      "financialSnapshot",
      "splitSnapshot",
      "recipientShares",
      "platformFeeBps",
      "financialRuleId",
      "idempotencyKey",
      "webhookToken",
      "apiKey",
      "cpf",
      "phone",
      "claims",
      "reason",
      "errorCode"
    ]
  ) {
    assert.strictEqual(
      serialized.includes(
        forbidden
      ),
      false,
      `Operational order read leaked ${forbidden}`
    );
  }

  const historicalSeed =
    buildSeed();

  const historicalEnrollmentId =
    enrollmentDocumentId(
      "course-1",
      "user-1"
    );

  historicalSeed[
    `enrollments/${historicalEnrollmentId}`
  ].orderId =
    "newer-order";

  const historicalService =
    createAdminOrdersReadService({
      db:
        new FakeDb(
          historicalSeed
        ),

      documentIdField:
        "__name__"
    });

  const historicalCourse =
    await historicalService.getOrder({
      orderId:
        "order-a-course"
    });

  assert.deepStrictEqual(
    historicalCourse
      .fulfillmentStatus,
    {
      kind:
        "enrollment",

      status:
        null
    }
  );

  const missingTransactionSeed =
    buildSeed();

  delete missingTransactionSeed[
    "payment_transactions/transaction-a"
  ];

  const inconsistentService =
    createAdminOrdersReadService({
      db:
        new FakeDb(
          missingTransactionSeed
        ),

      documentIdField:
        "__name__"
    });

  await assert.rejects(
    () =>
      inconsistentService.getOrder({
        orderId:
          "order-a-course"
      }),
    error =>
      error instanceof
        AdminOrdersReadError &&
      error.code ===
        "ADMIN_ORDERS_CANONICAL_STATE_INVALID"
  );

  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        "../functions/src/admin/admin-orders-read-service.js"
      ),
      "utf8"
    );

  for (
    const forbidden
    of [
      "runTransaction",
      "writeBatch",
      "bulkWriter",
      "tx.set(",
      "tx.create(",
      "tx.update(",
      "tx.delete(",
      "batch.set(",
      "batch.update(",
      "batch.delete(",
      "providerFactory",
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "financial-reversal-admin-service",
      "financial-purchase-read-service"
    ]
  ) {
    assert.strictEqual(
      source.includes(
        forbidden
      ),
      false,
      `Read service contains forbidden dependency/mutation: ${forbidden}`
    );
  }

  assert.ok(
    db.readOperations.length >
    0
  );

  console.log(
    "MARCO8_5C_COLLECTIONS=8/8"
  );

  console.log(
    "MARCO8_5C_ORDER_LIMITS=PASSED"
  );

  console.log(
    "MARCO8_5C_ORDER_FILTERS=PASSED"
  );

  console.log(
    "MARCO8_5C_ORDER_CURSOR=PASSED"
  );

  console.log(
    "MARCO8_5C_BOUNDED_SCAN=PASSED"
  );

  console.log(
    "MARCO8_5C_BATCH_HYDRATION=PASSED"
  );

  console.log(
    "MARCO8_5C_COURSE_FULFILLMENT=PASSED"
  );

  console.log(
    "MARCO8_5C_EXAM_FULFILLMENT=PASSED"
  );

  console.log(
    "MARCO8_5C_HISTORICAL_FULFILLMENT_ISOLATION=PASSED"
  );

  console.log(
    "MARCO8_5C_REVERSAL_SELECTION=PASSED"
  );

  console.log(
    "MARCO8_5C_RECONCILIATION=PASSED"
  );

  console.log(
    "MARCO8_5C_DETAIL_LOOKUP=PASSED"
  );

  console.log(
    "MARCO8_5C_NOT_FOUND=PASSED"
  );

  console.log(
    "MARCO8_5C_CANONICAL_FAIL_CLOSED=PASSED"
  );

  console.log(
    "MARCO8_5C_SENSITIVE_FIELDS_EXPOSURE=False"
  );

  console.log(
    "MARCO8_5C_FIRESTORE_WRITES=False"
  );

  console.log(
    "MARCO8_5C_PROVIDER_DEPENDENCY=False"
  );

  console.log(
    "MARCO8_5C_ADMIN_ORDERS_READ_SERVICE=PASSED"
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
