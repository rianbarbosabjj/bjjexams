"use strict";

const {
  FINANCIAL_PRODUCT_TYPES,
  ORDER_STATUSES,
  TRANSACTION_STATUSES,
  FinancialDomainError,
  validateOrder,
  validateTransaction
} = require(
  "../finance/financial-domain"
);

const {
  CourseEnrollmentDomainError,
  validateEnrollment
} = require(
  "../courses/course-enrollment-domain"
);

const {
  ExamRegistrationDomainError,
  validateExamRegistration
} = require(
  "../exams/exam-registration-domain"
);

const {
  FinancialPurchaseReadDomainError,
  REVERSAL_REQUEST_STATUSES,
  normalizeReversalRequest
} = require(
  "../finance/financial-purchase-read-domain"
);

const OPERATIONAL_ORDER_VIEW_FIELDS =
  Object.freeze([
    "orderId",
    "productType",
    "productSummary",
    "buyerSummary",
    "paymentStatus",
    "fulfillmentStatus",
    "reversalStatus",
    "reconciliationStatus",
    "createdAt"
  ]);

const OPERATIONAL_PRODUCT_SUMMARY_FIELDS =
  Object.freeze([
    "productType",
    "productId",
    "label"
  ]);

const OPERATIONAL_BUYER_SUMMARY_FIELDS =
  Object.freeze([
    "userId",
    "displayName",
    "email"
  ]);

const OPERATIONAL_PAYMENT_STATUS_FIELDS =
  Object.freeze([
    "orderStatus",
    "transactionStatus"
  ]);

const OPERATIONAL_FULFILLMENT_STATUS_FIELDS =
  Object.freeze([
    "kind",
    "status"
  ]);

const OPERATIONAL_REVERSAL_STATUS_FIELDS =
  Object.freeze([
    "status",
    "operation"
  ]);

const OPERATIONAL_RECONCILIATION_STATUS_FIELDS =
  Object.freeze([
    "required"
  ]);

const FULFILLMENT_KINDS =
  Object.freeze({
    course:
      "enrollment",

    belt_exam:
      "exam_registration"
  });

const ORDER_TRANSACTION_COMPATIBILITY =
  Object.freeze({
    pending_payment:
      Object.freeze([
        "created",
        "pending"
      ]),

    paid:
      Object.freeze([
        "paid"
      ]),

    cancelled:
      Object.freeze([
        "cancelled"
      ]),

    expired:
      Object.freeze([
        "expired"
      ]),

    refunded:
      Object.freeze([
        "refunded"
      ]),

    chargeback:
      Object.freeze([
        "chargeback"
      ])
  });

class AdminOrderModelError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminOrderModelError";

    this.code =
      code;
  }
}

function cleanText(
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
    String(value)
      .trim();

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
  const identifier =
    cleanText(
      value,
      200
    );

  if (
    !identifier ||
    identifier.includes("/")
  ) {
    throw new AdminOrderModelError(
      "ADMIN_ORDER_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }

  return identifier;
}

function normalizeCanonicalOrder(
  input
) {
  try {
    return validateOrder(
      input || {}
    );
  }
  catch (error) {
    if (
      error instanceof
      FinancialDomainError
    ) {
      throw new AdminOrderModelError(
        "ADMIN_ORDER_CANONICAL_ORDER_INVALID",
        "Canonical order is inconsistent."
      );
    }

    throw error;
  }
}

function normalizeCanonicalTransaction(
  input
) {
  try {
    return validateTransaction(
      input || {}
    );
  }
  catch (error) {
    if (
      error instanceof
      FinancialDomainError
    ) {
      throw new AdminOrderModelError(
        "ADMIN_ORDER_CANONICAL_TRANSACTION_INVALID",
        "Canonical payment transaction is inconsistent."
      );
    }

    throw error;
  }
}

function normalizeOperationalFinancialPair(
  input = {}
) {
  const orderId =
    requiredIdentifier(
      input.orderId,
      "orderId"
    );

  const order =
    normalizeCanonicalOrder(
      input.order
    );

  if (
    !input.transaction
  ) {
    if (
      input.transactionId
    ) {
      throw new AdminOrderModelError(
        "ADMIN_ORDER_TRANSACTION_MISSING",
        "Transaction identifier exists without transaction."
      );
    }

    if (
      order.currentTransactionId
    ) {
      throw new AdminOrderModelError(
        "ADMIN_ORDER_TRANSACTION_MISSING",
        "Order references a missing transaction."
      );
    }

    if (
      order.status !==
      "pending_payment"
    ) {
      throw new AdminOrderModelError(
        "ADMIN_ORDER_TRANSACTION_REQUIRED",
        "Finalized order requires canonical transaction."
      );
    }

    return Object.freeze({
      orderId,
      order,

      transactionId:
        null,

      transaction:
        null
    });
  }

  const transactionId =
    requiredIdentifier(
      input.transactionId,
      "transactionId"
    );

  const transaction =
    normalizeCanonicalTransaction(
      input.transaction
    );

  if (
    order.currentTransactionId !==
      transactionId ||
    transaction.orderId !==
      orderId ||
    transaction.buyerUserId !==
      order.buyerUserId ||
    transaction.amountCents !==
      order.amountCents ||
    transaction.currency !==
      order.currency
  ) {
    throw new AdminOrderModelError(
      "ADMIN_ORDER_FINANCIAL_IDENTITY_MISMATCH",
      "Order and transaction identities do not match."
    );
  }

  const allowedTransactionStatuses =
    ORDER_TRANSACTION_COMPATIBILITY[
      order.status
    ] || [];

  if (
    !allowedTransactionStatuses
      .includes(
        transaction.status
      )
  ) {
    throw new AdminOrderModelError(
      "ADMIN_ORDER_FINANCIAL_STATE_MISMATCH",
      "Order and transaction statuses are incompatible."
    );
  }

  return Object.freeze({
    orderId,
    order,
    transactionId,
    transaction
  });
}

function buildOperationalProductSummary(
  order,
  product = {}
) {
  const productType =
    order.productType;

  if (
    !FINANCIAL_PRODUCT_TYPES
      .includes(
        productType
      )
  ) {
    throw new AdminOrderModelError(
      "ADMIN_ORDER_PRODUCT_TYPE_INVALID",
      "Order product type is invalid."
    );
  }

  let label =
    null;

  if (
    productType ===
    "course"
  ) {
    label =
      cleanText(
        product.title ??
        product.name ??
        product.nome,
        200
      );
  }
  else if (
    productType ===
    "belt_exam"
  ) {
    const targetBelt =
      cleanText(
        product.targetBelt,
        80
      );

    label =
      targetBelt
        ? `Exame de faixa - ${targetBelt}`
        : null;
  }

  return Object.freeze({
    productType,

    productId:
      order.productId,

    label
  });
}

function buildOperationalBuyerSummary(
  order,
  buyer = {}
) {
  const safeBuyer =
    buyer &&
    typeof buyer ===
      "object" &&
    !Array.isArray(
      buyer
    )
      ? buyer
      : {};

  const displayName =
    cleanText(
      safeBuyer.displayName ??
      safeBuyer.nome ??
      safeBuyer.name,
      200
    );

  const email =
    cleanText(
      safeBuyer.email,
      320
    );

  return Object.freeze({
    userId:
      order.buyerUserId,

    displayName,

    email:
      email
        ? email.toLowerCase()
        : null
  });
}

function buildOperationalPaymentStatus(
  pair
) {
  return Object.freeze({
    orderStatus:
      pair.order.status,

    transactionStatus:
      pair.transaction?.status ||
      null
  });
}

function normalizeCourseFulfillment(
  orderId,
  order,
  enrollment
) {
  if (!enrollment) {
    return null;
  }

  let normalized;

  try {
    normalized =
      validateEnrollment(
        enrollment
      );
  }
  catch (error) {
    if (
      error instanceof
      CourseEnrollmentDomainError
    ) {
      throw new AdminOrderModelError(
        "ADMIN_ORDER_FULFILLMENT_INVALID",
        "Canonical course enrollment is inconsistent."
      );
    }

    throw error;
  }

  if (
    normalized.courseId !==
      order.productId ||
    normalized.userId !==
      order.buyerUserId
  ) {
    throw new AdminOrderModelError(
      "ADMIN_ORDER_FULFILLMENT_IDENTITY_MISMATCH",
      "Course enrollment does not match order."
    );
  }

  if (
    normalized.source ===
      "order" &&
    normalized.orderId !==
      orderId
  ) {
    throw new AdminOrderModelError(
      "ADMIN_ORDER_FULFILLMENT_ORDER_MISMATCH",
      "Paid enrollment references another order."
    );
  }

  return normalized;
}

function normalizeExamFulfillment(
  orderId,
  order,
  registration
) {
  if (!registration) {
    return null;
  }

  let normalized;

  try {
    normalized =
      validateExamRegistration(
        registration
      );
  }
  catch (error) {
    if (
      error instanceof
      ExamRegistrationDomainError
    ) {
      throw new AdminOrderModelError(
        "ADMIN_ORDER_FULFILLMENT_INVALID",
        "Canonical exam registration is inconsistent."
      );
    }

    throw error;
  }

  if (
    normalized.sessionId !==
      order.productId ||
    normalized.studentId !==
      order.buyerUserId
  ) {
    throw new AdminOrderModelError(
      "ADMIN_ORDER_FULFILLMENT_IDENTITY_MISMATCH",
      "Exam registration does not match order."
    );
  }

  if (
    normalized.orderId &&
    normalized.orderId !==
      orderId
  ) {
    throw new AdminOrderModelError(
      "ADMIN_ORDER_FULFILLMENT_ORDER_MISMATCH",
      "Exam registration references another order."
    );
  }

  return normalized;
}

function buildOperationalFulfillmentStatus(
  pair,
  fulfillment
) {
  const productType =
    pair.order.productType;

  const kind =
    FULFILLMENT_KINDS[
      productType
    ];

  if (!kind) {
    throw new AdminOrderModelError(
      "ADMIN_ORDER_FULFILLMENT_KIND_INVALID",
      "Order fulfillment kind is invalid."
    );
  }

  const normalized =
    productType ===
      "course"
      ? normalizeCourseFulfillment(
          pair.orderId,
          pair.order,
          fulfillment
        )
      : normalizeExamFulfillment(
          pair.orderId,
          pair.order,
          fulfillment
        );

  return Object.freeze({
    kind,

    status:
      normalized?.status ||
      null
  });
}

function buildOperationalReversalStatus(
  pair,
  reversalRequest
) {
  if (!reversalRequest) {
    return null;
  }

  if (
    reversalRequest.orderId &&
    cleanText(
      reversalRequest.orderId,
      200
    ) !==
      pair.orderId
  ) {
    throw new AdminOrderModelError(
      "ADMIN_ORDER_REVERSAL_IDENTITY_MISMATCH",
      "Reversal request references another order."
    );
  }

  if (
    reversalRequest.transactionId
  ) {
    if (
      !pair.transactionId ||
      cleanText(
        reversalRequest.transactionId,
        200
      ) !==
        pair.transactionId
    ) {
      throw new AdminOrderModelError(
        "ADMIN_ORDER_REVERSAL_IDENTITY_MISMATCH",
        "Reversal request references another transaction."
      );
    }
  }

  let normalized;

  try {
    normalized =
      normalizeReversalRequest(
        reversalRequest
      );
  }
  catch (error) {
    if (
      error instanceof
      FinancialPurchaseReadDomainError
    ) {
      throw new AdminOrderModelError(
        "ADMIN_ORDER_REVERSAL_INVALID",
        "Canonical reversal request is inconsistent."
      );
    }

    throw error;
  }

  return Object.freeze({
    status:
      normalized.status,

    operation:
      normalized.operation
  });
}

function buildOperationalReconciliationStatus(
  fulfillmentStatus,
  reversalStatus
) {
  return Object.freeze({
    required:
      Boolean(
        reversalStatus?.status ===
          "needs_reconciliation" ||
        (
          fulfillmentStatus?.kind ===
            "exam_registration" &&
          fulfillmentStatus?.status ===
            "needs_reconciliation"
        )
      )
  });
}

function buildOperationalOrderView(
  input = {}
) {
  const pair =
    normalizeOperationalFinancialPair(
      input
    );

  const productSummary =
    buildOperationalProductSummary(
      pair.order,
      input.product
    );

  const buyerSummary =
    buildOperationalBuyerSummary(
      pair.order,
      input.buyer
    );

  const paymentStatus =
    buildOperationalPaymentStatus(
      pair
    );

  const fulfillmentStatus =
    buildOperationalFulfillmentStatus(
      pair,
      input.fulfillment
    );

  const reversalStatus =
    buildOperationalReversalStatus(
      pair,
      input.reversalRequest
    );

  const reconciliationStatus =
    buildOperationalReconciliationStatus(
      fulfillmentStatus,
      reversalStatus
    );

  return Object.freeze({
    orderId:
      pair.orderId,

    productType:
      pair.order.productType,

    productSummary,
    buyerSummary,
    paymentStatus,
    fulfillmentStatus,
    reversalStatus,
    reconciliationStatus,

    createdAt:
      pair.order.createdAt
  });
}

module.exports = {
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
  REVERSAL_REQUEST_STATUSES,

  FULFILLMENT_KINDS,
  ORDER_TRANSACTION_COMPATIBILITY,

  AdminOrderModelError,

  cleanText,
  requiredIdentifier,

  normalizeCanonicalOrder,
  normalizeCanonicalTransaction,
  normalizeOperationalFinancialPair,

  buildOperationalProductSummary,
  buildOperationalBuyerSummary,
  buildOperationalPaymentStatus,

  normalizeCourseFulfillment,
  normalizeExamFulfillment,
  buildOperationalFulfillmentStatus,

  buildOperationalReversalStatus,
  buildOperationalReconciliationStatus,

  buildOperationalOrderView
};
