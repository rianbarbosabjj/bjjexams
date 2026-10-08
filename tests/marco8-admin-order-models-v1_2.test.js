"use strict";

const assert =
  require("assert");

const {
  OPERATIONAL_ORDER_VIEW_FIELDS,
  OPERATIONAL_PRODUCT_SUMMARY_FIELDS,
  OPERATIONAL_BUYER_SUMMARY_FIELDS,
  OPERATIONAL_PAYMENT_STATUS_FIELDS,
  OPERATIONAL_FULFILLMENT_STATUS_FIELDS,
  OPERATIONAL_REVERSAL_STATUS_FIELDS,
  OPERATIONAL_RECONCILIATION_STATUS_FIELDS,

  FINANCIAL_PRODUCT_TYPES,
  ORDER_STATUSES,
  TRANSACTION_STATUSES,

  AdminOrderModelError,

  normalizeOperationalFinancialPair,
  buildOperationalOrderView
} = require(
  "../functions/src/admin/admin-order-models"
);

function snapshot(
  productType,
  productId,
  amountCents = 10000
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
    productType =
      "course",

    productId =
      "course-1",

    orderId =
      "order-1",

    userId =
      "user-1",

    transactionId =
      "transaction-1",

    amountCents =
      10000
  } = {}
) {
  return {
    orderId,

    transactionId,

    order: {
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
        snapshot(
          productType,
          productId,
          amountCents
        ),

      provider:
        "asaas",

      providerCustomerId:
        "provider-customer-secret",

      currentTransactionId:
        transactionId,

      idempotencyKey:
        "idempotency-secret",

      createdAt:
        "created-at",

      updatedAt:
        "updated-at",

      paidAt:
        "paid-at",

      cancelledAt:
        null,

      expiredAt:
        null,

      refundedAt:
        null,

      chargebackAt:
        null
    },

    transaction: {
      orderId,

      buyerUserId:
        userId,

      provider:
        "asaas",

      providerPaymentId:
        "provider-payment-secret",

      providerStatus:
        "CONFIRMED",

      status:
        "paid",

      amountCents,

      currency:
        "BRL",

      financialSnapshot:
        snapshot(
          productType,
          productId,
          amountCents
        ),

      providerSplitSnapshot: {
        walletId:
          "wallet-secret"
      },

      createdAt:
        "transaction-created-at",

      updatedAt:
        "transaction-updated-at",

      confirmedAt:
        "transaction-confirmed-at",

      refundedAt:
        null,

      chargebackAt:
        null
    }
  };
}

function main() {
  assert.deepStrictEqual(
    OPERATIONAL_ORDER_VIEW_FIELDS,
    [
      "orderId",
      "productType",
      "productSummary",
      "buyerSummary",
      "paymentStatus",
      "fulfillmentStatus",
      "reversalStatus",
      "reconciliationStatus",
      "createdAt"
    ]
  );

  assert.deepStrictEqual(
    OPERATIONAL_PRODUCT_SUMMARY_FIELDS,
    [
      "productType",
      "productId",
      "label"
    ]
  );

  assert.deepStrictEqual(
    OPERATIONAL_BUYER_SUMMARY_FIELDS,
    [
      "userId",
      "displayName",
      "email"
    ]
  );

  assert.deepStrictEqual(
    OPERATIONAL_PAYMENT_STATUS_FIELDS,
    [
      "orderStatus",
      "transactionStatus"
    ]
  );

  assert.deepStrictEqual(
    OPERATIONAL_FULFILLMENT_STATUS_FIELDS,
    [
      "kind",
      "status"
    ]
  );

  assert.deepStrictEqual(
    OPERATIONAL_REVERSAL_STATUS_FIELDS,
    [
      "status",
      "operation"
    ]
  );

  assert.deepStrictEqual(
    OPERATIONAL_RECONCILIATION_STATUS_FIELDS,
    [
      "required"
    ]
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

  assert.deepStrictEqual(
    TRANSACTION_STATUSES,
    [
      "created",
      "pending",
      "paid",
      "failed",
      "cancelled",
      "expired",
      "refunded",
      "chargeback"
    ]
  );

  const courseState =
    paidOrder();

  const courseView =
    buildOperationalOrderView({
      ...courseState,

      product: {
        title:
          " Curso Operacional ",

        financialRuleId:
          "must-not-leak"
      },

      buyer: {
        displayName:
          " Aluno Exemplo ",

        email:
          "ALUNO@EXAMPLE.COM",

        cpf:
          "must-not-leak",

        phone:
          "must-not-leak",

        claims: {
          super_admin:
            true
        }
      },

      fulfillment: {
        courseId:
          "course-1",

        userId:
          "user-1",

        source:
          "order",

        orderId:
          "order-1",

        status:
          "active",

        progressPercent:
          25,

        startedAt:
          "started-at",

        completedAt:
          null,

        createdAt:
          "enrollment-created-at",

        updatedAt:
          "enrollment-updated-at"
      },

      reversalRequest: {
        operation:
          "refund_full",

        orderId:
          "order-1",

        transactionId:
          "transaction-1",

        status:
          "awaiting_webhook",

        provider:
          "asaas",

        providerPaymentId:
          "must-not-leak",

        reason:
          "must-not-leak",

        createdAt:
          "reversal-created",

        updatedAt:
          "reversal-updated"
      }
    });

  assert.deepStrictEqual(
    Object.keys(
      courseView
    ),
    OPERATIONAL_ORDER_VIEW_FIELDS
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
        "Aluno Exemplo",

      email:
        "aluno@example.com"
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

  assert.strictEqual(
    courseView.createdAt,
    "created-at"
  );

  const examState =
    paidOrder({
      productType:
        "belt_exam",

      productId:
        "session-1",

      orderId:
        "order-exam-1",

      transactionId:
        "transaction-exam-1"
    });

  const examView =
    buildOperationalOrderView({
      ...examState,

      product: {
        targetBelt:
          "Azul",

        priceCents:
          10000,

        financialRuleId:
          "must-not-leak"
      },

      buyer: {
        nome:
          "Aluno Faixa",

        email:
          "faixa@example.com",

        cpf:
          "must-not-leak"
      },

      fulfillment: {
        sessionId:
          "session-1",

        organizationId:
          "org-1",

        studentId:
          "user-1",

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
          "order-exam-1",

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
    });

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

  assert.strictEqual(
    examView.reversalStatus,
    null
  );

  const pendingSnapshot =
    snapshot(
      "course",
      "course-pending"
    );

  const pendingView =
    buildOperationalOrderView({
      orderId:
        "order-pending",

      transactionId:
        null,

      transaction:
        null,

      order: {
        buyerUserId:
          "user-pending",

        productType:
          "course",

        productId:
          "course-pending",

        quantity:
          1,

        amountCents:
          10000,

        currency:
          "BRL",

        status:
          "pending_payment",

        financialSnapshot:
          pendingSnapshot,

        provider:
          null,

        providerCustomerId:
          null,

        currentTransactionId:
          null,

        idempotencyKey:
          "pending-secret",

        createdAt:
          "pending-created",

        updatedAt:
          "pending-updated",

        paidAt:
          null,

        cancelledAt:
          null,

        expiredAt:
          null,

        refundedAt:
          null,

        chargebackAt:
          null
      },

      product: {
        title:
          "Curso Pendente"
      },

      buyer: {},

      fulfillment:
        null,

      reversalRequest:
        null
    });

  assert.deepStrictEqual(
    pendingView.paymentStatus,
    {
      orderStatus:
        "pending_payment",

      transactionStatus:
        null
    }
  );

  assert.deepStrictEqual(
    pendingView.fulfillmentStatus,
    {
      kind:
        "enrollment",

      status:
        null
    }
  );

  const reconciliationCourseView =
    buildOperationalOrderView({
      ...courseState,

      product: {
        title:
          "Curso Reconciliacao"
      },

      buyer: {},

      fulfillment: {
        courseId:
          "course-1",

        userId:
          "user-1",

        source:
          "order",

        orderId:
          "order-1",

        status:
          "active",

        progressPercent:
          0,

        startedAt:
          "started-at",

        completedAt:
          null,

        createdAt:
          "created-at",

        updatedAt:
          "updated-at"
      },

      reversalRequest: {
        operation:
          "refund_full",

        orderId:
          "order-1",

        transactionId:
          "transaction-1",

        status:
          "needs_reconciliation",

        providerPaymentId:
          "provider-secret",

        errorCode:
          "provider-secret-error"
      }
    });

  assert.deepStrictEqual(
    reconciliationCourseView
      .reconciliationStatus,
    {
      required:
        true
    }
  );

  const serialized =
    JSON.stringify({
      courseView,
      examView,
      pendingView,
      reconciliationCourseView
    });

  for (
    const forbidden
    of [
      "providerPaymentId",
      "providerCustomerId",
      "walletId",
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
      `OperationalOrderView leaked ${forbidden}`
    );
  }

  assert.throws(
    () =>
      normalizeOperationalFinancialPair({
        ...courseState,

        transactionId:
          "other-transaction"
      }),
    error =>
      error instanceof
        AdminOrderModelError &&
      error.code ===
        "ADMIN_ORDER_FINANCIAL_IDENTITY_MISMATCH"
  );

  assert.throws(
    () =>
      buildOperationalOrderView({
        ...courseState,

        product: {
          title:
            "Curso"
        },

        buyer: {},

        fulfillment: {
          courseId:
            "other-course",

          userId:
            "user-1",

          source:
            "order",

          orderId:
            "order-1",

          status:
            "active",

          progressPercent:
            0,

          startedAt:
            null,

          completedAt:
            null,

          createdAt:
            "created",

          updatedAt:
            "updated"
        }
      }),
    error =>
      error instanceof
        AdminOrderModelError &&
      error.code ===
        "ADMIN_ORDER_FULFILLMENT_IDENTITY_MISMATCH"
  );

  console.log(
    "MARCO8_OPERATIONAL_ORDER_VIEW_FIELDS=9/9"
  );

  console.log(
    "MARCO8_OPERATIONAL_PRODUCT_SUMMARY_FIELDS=3/3"
  );

  console.log(
    "MARCO8_OPERATIONAL_BUYER_SUMMARY_FIELDS=3/3"
  );

  console.log(
    "MARCO8_OPERATIONAL_PAYMENT_STATUS_FIELDS=2/2"
  );

  console.log(
    "MARCO8_OPERATIONAL_FULFILLMENT_STATUS_FIELDS=2/2"
  );

  console.log(
    "MARCO8_OPERATIONAL_REVERSAL_STATUS_FIELDS=2/2"
  );

  console.log(
    "MARCO8_OPERATIONAL_RECONCILIATION_STATUS_FIELDS=1/1"
  );

  console.log(
    "MARCO8_ORDER_PRODUCT_TYPES=2/2"
  );

  console.log(
    "MARCO8_ORDER_CANONICAL_VALIDATION=PASSED"
  );

  console.log(
    "MARCO8_ORDER_COURSE_FULFILLMENT=PASSED"
  );

  console.log(
    "MARCO8_ORDER_EXAM_FULFILLMENT=PASSED"
  );

  console.log(
    "MARCO8_ORDER_REVERSAL_SANITIZATION=PASSED"
  );

  console.log(
    "MARCO8_ORDER_RECONCILIATION_DERIVATION=PASSED"
  );

  console.log(
    "MARCO8_ORDER_SENSITIVE_FIELDS_EXPOSURE=False"
  );

  console.log(
    "MARCO8_ADMIN_ORDER_MODELS=PASSED"
  );
}

main();
