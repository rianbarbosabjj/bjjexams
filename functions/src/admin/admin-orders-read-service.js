"use strict";

const {
  FieldPath
} = require(
  "firebase-admin/firestore"
);

const {
  CourseEnrollmentDomainError,
  enrollmentDocumentId,
  validateEnrollment
} = require(
  "../courses/course-enrollment-domain"
);

const {
  ExamRegistrationDomainError,
  examRegistrationDocumentId,
  validateExamRegistration
} = require(
  "../exams/exam-registration-domain"
);

const {
  FINANCIAL_PRODUCT_TYPES,
  ORDER_STATUSES,
  REVERSAL_REQUEST_STATUSES,
  AdminOrderModelError,
  normalizeCanonicalOrder,
  buildOperationalOrderView
} = require(
  "./admin-order-models"
);

const ORDERS_COLLECTION =
  "orders";

const PAYMENT_TRANSACTIONS_COLLECTION =
  "payment_transactions";

const COURSES_COLLECTION =
  "courses";

const EXAM_SESSIONS_COLLECTION =
  "exam_sessions";

const ENROLLMENTS_COLLECTION =
  "enrollments";

const EXAM_REGISTRATIONS_COLLECTION =
  "exam_registrations";

const USERS_COLLECTION =
  "usuarios";

const REVERSAL_REQUESTS_COLLECTION =
  "financial_reversal_requests";

const REVERSAL_OPERATIONS =
  Object.freeze([
    "cancel_pending",
    "refund_full"
  ]);

const DEFAULT_ORDERS_LIMIT =
  20;

const MAX_ORDERS_LIMIT =
  25;

const ORDER_CURSOR_VERSION =
  1;

const ORDER_SCAN_BATCH_SIZE =
  MAX_ORDERS_LIMIT + 1;

const ORDER_MAX_SCAN_DOCS =
  ORDER_SCAN_BATCH_SIZE * 10;

class AdminOrdersReadError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminOrdersReadError";

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
    String(value)
      .trim();

  return normalized
    ? normalized.slice(
        0,
        maxLength
      )
    : null;
}

function requiredIdentifier(
  value,
  field
) {
  const identifier =
    text(
      value,
      200
    );

  if (
    !identifier ||
    identifier.includes("/")
  ) {
    throw new AdminOrdersReadError(
      "ADMIN_ORDERS_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }

  return identifier;
}

function readOrdersLimit(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return DEFAULT_ORDERS_LIMIT;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(
      parsed
    ) ||
    parsed < 1 ||
    parsed >
      MAX_ORDERS_LIMIT
  ) {
    throw new AdminOrdersReadError(
      "ADMIN_ORDERS_LIMIT_INVALID",
      `limit must be an integer between 1 and ${MAX_ORDERS_LIMIT}.`
    );
  }

  return parsed;
}

function optionalEnumFilter(
  value,
  allowedValues,
  field
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
    throw new AdminOrdersReadError(
      "ADMIN_ORDERS_FILTER_INVALID",
      `${field} filter is invalid.`
    );
  }

  const normalized =
    value
      .trim()
      .toLowerCase();

  if (
    !allowedValues.includes(
      normalized
    )
  ) {
    throw new AdminOrdersReadError(
      "ADMIN_ORDERS_FILTER_INVALID",
      `${field} filter is invalid.`
    );
  }

  return normalized;
}

function normalizeOrderFilters(
  input = {}
) {
  return Object.freeze({
    productType:
      optionalEnumFilter(
        input.productType,
        FINANCIAL_PRODUCT_TYPES,
        "productType"
      ),

    orderStatus:
      optionalEnumFilter(
        input.orderStatus,
        ORDER_STATUSES,
        "orderStatus"
      )
  });
}

function matchesOrderFilters(
  order,
  filters = {}
) {
  const safeOrder =
    order &&
    typeof order ===
      "object" &&
    !Array.isArray(
      order
    )
      ? order
      : {};

  if (
    filters.productType &&
    text(
      safeOrder.productType,
      40
    )
      ?.toLowerCase() !==
      filters.productType
  ) {
    return false;
  }

  if (
    filters.orderStatus &&
    text(
      safeOrder.status,
      40
    )
      ?.toLowerCase() !==
      filters.orderStatus
  ) {
    return false;
  }

  return true;
}

function encodeOrderCursor(
  orderIdInput
) {
  const orderId =
    requiredIdentifier(
      orderIdInput,
      "orderId"
    );

  return Buffer
    .from(
      JSON.stringify({
        v:
          ORDER_CURSOR_VERSION,

        lastOrderId:
          orderId
      }),
      "utf8"
    )
    .toString(
      "base64url"
    );
}

function decodeOrderCursor(
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
      "string" ||
    value.length > 512
  ) {
    throw new AdminOrdersReadError(
      "ADMIN_ORDERS_CURSOR_INVALID",
      "cursor is invalid."
    );
  }

  try {
    const decoded =
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
      decoded?.v !==
        ORDER_CURSOR_VERSION
    ) {
      throw new Error(
        "version"
      );
    }

    return requiredIdentifier(
      decoded.lastOrderId,
      "lastOrderId"
    );
  }
  catch (_) {
    throw new AdminOrdersReadError(
      "ADMIN_ORDERS_CURSOR_INVALID",
      "cursor is invalid."
    );
  }
}

function toMillis(
  value
) {
  if (!value) {
    return 0;
  }

  if (
    typeof value.toMillis ===
    "function"
  ) {
    return value.toMillis();
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  const millis =
    date.getTime();

  return Number.isFinite(
    millis
  )
    ? millis
    : 0;
}

function reversalPriority(
  request = {}
) {
  const status =
    text(
      request.status,
      80
    )
      ?.toLowerCase() ||
    null;

  if (
    status ===
    "needs_reconciliation"
  ) {
    return 5;
  }

  if (
    status ===
      "executing" ||
    status ===
      "awaiting_webhook"
  ) {
    return 4;
  }

  if (
    status ===
    "completed"
  ) {
    return 3;
  }

  if (
    status ===
    "provider_rejected"
  ) {
    return 2;
  }

  return 0;
}

function selectRelevantReversal(
  entries = []
) {
  return [...entries]
    .filter(
      entry =>
        entry &&
        entry.data
    )
    .sort(
      (
        left,
        right
      ) => {
        const priorityDiff =
          reversalPriority(
            right.data
          ) -
          reversalPriority(
            left.data
          );

        if (
          priorityDiff !==
          0
        ) {
          return priorityDiff;
        }

        const timeDiff =
          toMillis(
            right.data.updatedAt ||
            right.data.createdAt
          ) -
          toMillis(
            left.data.updatedAt ||
            left.data.createdAt
          );

        if (
          timeDiff !==
          0
        ) {
          return timeDiff;
        }

        return String(
          right.id
        )
          .localeCompare(
            String(
              left.id
            )
          );
      }
    )[0] || null;
}

function canonicalStateError(
  orderId,
  detail
) {
  return new AdminOrdersReadError(
    "ADMIN_ORDERS_CANONICAL_STATE_INVALID",
    `Order ${orderId} has inconsistent canonical state${detail ? `: ${detail}` : "."}`
  );
}

function normalizeOrderDocument(
  document
) {
  const orderId =
    requiredIdentifier(
      document?.id,
      "orderId"
    );

  let order;

  try {
    order =
      normalizeCanonicalOrder(
        document?.data?.() ||
        {}
      );
  }
  catch (error) {
    if (
      error instanceof
      AdminOrderModelError
    ) {
      throw canonicalStateError(
        orderId,
        "order"
      );
    }

    throw error;
  }

  return Object.freeze({
    orderId,
    order
  });
}

function productDocumentPath(
  entry
) {
  if (
    entry.order.productType ===
    "course"
  ) {
    return `${COURSES_COLLECTION}/${entry.order.productId}`;
  }

  if (
    entry.order.productType ===
    "belt_exam"
  ) {
    return `${EXAM_SESSIONS_COLLECTION}/${entry.order.productId}`;
  }

  throw canonicalStateError(
    entry.orderId,
    "product type"
  );
}

function fulfillmentDocumentPath(
  entry
) {
  try {
    if (
      entry.order.productType ===
      "course"
    ) {
      const enrollmentId =
        enrollmentDocumentId(
          entry.order.productId,
          entry.order.buyerUserId
        );

      return `${ENROLLMENTS_COLLECTION}/${enrollmentId}`;
    }

    if (
      entry.order.productType ===
      "belt_exam"
    ) {
      const registrationId =
        examRegistrationDocumentId({
          sessionId:
            entry.order.productId,

          studentId:
            entry.order.buyerUserId
        });

      return `${EXAM_REGISTRATIONS_COLLECTION}/${registrationId}`;
    }
  }
  catch (error) {
    if (
      error instanceof
        CourseEnrollmentDomainError ||
      error instanceof
        ExamRegistrationDomainError
    ) {
      throw canonicalStateError(
        entry.orderId,
        "fulfillment identity"
      );
    }

    throw error;
  }

  throw canonicalStateError(
    entry.orderId,
    "fulfillment type"
  );
}

function canonicalFulfillmentForOrder(
  entry,
  rawFulfillment
) {
  if (!rawFulfillment) {
    return null;
  }

  if (
    entry.order.productType ===
    "course"
  ) {
    let enrollment;

    try {
      enrollment =
        validateEnrollment(
          rawFulfillment
        );
    }
    catch (error) {
      if (
        error instanceof
        CourseEnrollmentDomainError
      ) {
        throw canonicalStateError(
          entry.orderId,
          "enrollment"
        );
      }

      throw error;
    }

    /*
     * A matricula e unica por curso/usuario.
     * Em uma recompra ela pode apontar para outro pedido.
     * Pedido historico nao deve herdar o fulfillment do pedido atual.
     */
    if (
      enrollment.source ===
        "order" &&
      enrollment.orderId !==
        entry.orderId
    ) {
      return null;
    }

    return rawFulfillment;
  }

  let registration;

  try {
    registration =
      validateExamRegistration(
        rawFulfillment
      );
  }
  catch (error) {
    if (
      error instanceof
      ExamRegistrationDomainError
    ) {
      throw canonicalStateError(
        entry.orderId,
        "exam registration"
      );
    }

    throw error;
  }

  /*
   * A registration e unica por sessao/aluno.
   * Uma nova tentativa financeira nao pode contaminar um pedido historico.
   */
  if (
    registration.orderId &&
    registration.orderId !==
      entry.orderId
  ) {
    return null;
  }

  return rawFulfillment;
}

function canonicalReversalEntry(
  document,
  expectedOrderByTransaction
) {
  const data =
    document?.data?.() ||
    {};

  const transactionId =
    text(
      data.transactionId,
      200
    );

  const orderId =
    text(
      data.orderId,
      200
    );

  const status =
    text(
      data.status,
      80
    )
      ?.toLowerCase() ||
    null;

  const operation =
    text(
      data.operation,
      80
    )
      ?.toLowerCase() ||
    null;

  if (
    !transactionId ||
    transactionId.includes("/") ||
    !orderId ||
    orderId.includes("/") ||
    expectedOrderByTransaction
      .get(
        transactionId
      ) !==
      orderId ||
    !REVERSAL_REQUEST_STATUSES
      .includes(
        status
      ) ||
    !REVERSAL_OPERATIONS
      .includes(
        operation
      )
  ) {
    throw new AdminOrdersReadError(
      "ADMIN_ORDERS_CANONICAL_STATE_INVALID",
      "Reversal request has inconsistent canonical state."
    );
  }

  return Object.freeze({
    id:
      document.id,

    orderId,
    transactionId,
    data
  });
}

function createAdminOrdersReadService(
  dependencies = {}
) {
  const {
    db,

    documentIdField =
      FieldPath.documentId()
  } = dependencies;

  if (
    !db ||
    typeof db.collection !==
      "function" ||
    typeof db.doc !==
      "function" ||
    typeof db.getAll !==
      "function"
  ) {
    throw new TypeError(
      "Admin orders read service requires Firestore."
    );
  }

  async function loadReversalMap(
    entries
  ) {
    const transactionEntries =
      entries.filter(
        entry =>
          Boolean(
            entry.order
              .currentTransactionId
          )
      );

    if (
      transactionEntries.length ===
      0
    ) {
      return new Map();
    }

    const expectedOrderByTransaction =
      new Map();

    for (
      const entry
      of transactionEntries
    ) {
      const transactionId =
        requiredIdentifier(
          entry.order
            .currentTransactionId,
          "currentTransactionId"
        );

      const previous =
        expectedOrderByTransaction
          .get(
            transactionId
          );

      if (
        previous &&
        previous !==
          entry.orderId
      ) {
        throw new AdminOrdersReadError(
          "ADMIN_ORDERS_CANONICAL_STATE_INVALID",
          "A transaction is referenced by multiple orders."
        );
      }

      expectedOrderByTransaction
        .set(
          transactionId,
          entry.orderId
        );
    }

    const transactionIds =
      Array.from(
        expectedOrderByTransaction
          .keys()
      );

    if (
      transactionIds.length >
      MAX_ORDERS_LIMIT
    ) {
      throw new AdminOrdersReadError(
        "ADMIN_ORDERS_REVERSAL_BATCH_INVALID",
        "Reversal read batch is too large."
      );
    }

    const maxExpectedDocuments =
      transactionIds.length *
      REVERSAL_OPERATIONS.length;

    const snapshot =
      await db
        .collection(
          REVERSAL_REQUESTS_COLLECTION
        )
        .where(
          "transactionId",
          "in",
          transactionIds
        )
        .limit(
          maxExpectedDocuments +
          1
        )
        .get();

    const documents =
      Array.isArray(
        snapshot?.docs
      )
        ? snapshot.docs
        : [];

    if (
      documents.length >
      maxExpectedDocuments
    ) {
      throw new AdminOrdersReadError(
        "ADMIN_ORDERS_CANONICAL_STATE_INVALID",
        "Too many reversal requests exist for the selected transactions."
      );
    }

    const grouped =
      new Map();

    for (
      const document
      of documents
    ) {
      const normalized =
        canonicalReversalEntry(
          document,
          expectedOrderByTransaction
        );

      const entriesForOrder =
        grouped.get(
          normalized.orderId
        ) || [];

      entriesForOrder.push(
        normalized
      );

      if (
        entriesForOrder.length >
        REVERSAL_OPERATIONS.length
      ) {
        throw new AdminOrdersReadError(
          "ADMIN_ORDERS_CANONICAL_STATE_INVALID",
          `Order ${normalized.orderId} has too many reversal requests.`
        );
      }

      grouped.set(
        normalized.orderId,
        entriesForOrder
      );
    }

    const result =
      new Map();

    for (
      const [
        orderId,
        reversalEntries
      ]
      of grouped.entries()
    ) {
      const selected =
        selectRelevantReversal(
          reversalEntries
        );

      if (selected) {
        result.set(
          orderId,
          selected.data
        );
      }
    }

    return result;
  }

  async function hydrateOrders(
    documents
  ) {
    if (
      !Array.isArray(
        documents
      ) ||
      documents.length ===
        0
    ) {
      return Object.freeze([]);
    }

    if (
      documents.length >
      MAX_ORDERS_LIMIT
    ) {
      throw new AdminOrdersReadError(
        "ADMIN_ORDERS_BATCH_INVALID",
        "Order hydration batch is too large."
      );
    }

    const entries =
      documents.map(
        normalizeOrderDocument
      );

    const refsByPath =
      new Map();

    function addRef(
      path
    ) {
      if (
        !refsByPath.has(
          path
        )
      ) {
        refsByPath.set(
          path,
          db.doc(
            path
          )
        );
      }
    }

    for (
      const entry
      of entries
    ) {
      addRef(
        productDocumentPath(
          entry
        )
      );

      addRef(
        `${USERS_COLLECTION}/${entry.order.buyerUserId}`
      );

      addRef(
        fulfillmentDocumentPath(
          entry
        )
      );

      if (
        entry.order
          .currentTransactionId
      ) {
        addRef(
          `${PAYMENT_TRANSACTIONS_COLLECTION}/${entry.order.currentTransactionId}`
        );
      }
    }

    const refs =
      Array.from(
        refsByPath.values()
      );

    const [
      snapshots,
      reversalMap
    ] =
      await Promise.all([
        refs.length
          ? db.getAll(
              ...refs
            )
          : Promise.resolve(
              []
            ),

        loadReversalMap(
          entries
        )
      ]);

    if (
      !Array.isArray(
        snapshots
      ) ||
      snapshots.length !==
        refs.length
    ) {
      throw new AdminOrdersReadError(
        "ADMIN_ORDERS_CANONICAL_STATE_INVALID",
        "Related document batch returned an unexpected result."
      );
    }

    const byPath =
      new Map(
        snapshots.map(
          snapshot => [
            snapshot.ref.path,

            snapshot.exists ===
              true
              ? {
                  id:
                    snapshot.id,

                  data:
                    snapshot.data() ||
                    {}
                }
              : null
          ]
        )
      );

    const views = [];

    for (
      const entry
      of entries
    ) {
      const productEntry =
        byPath.get(
          productDocumentPath(
            entry
          )
        ) || null;

      const buyerEntry =
        byPath.get(
          `${USERS_COLLECTION}/${entry.order.buyerUserId}`
        ) || null;

      const fulfillmentEntry =
        byPath.get(
          fulfillmentDocumentPath(
            entry
          )
        ) || null;

      const fulfillment =
        canonicalFulfillmentForOrder(
          entry,
          fulfillmentEntry?.data ||
          null
        );

      const transactionId =
        entry.order
          .currentTransactionId ||
        null;

      const transactionEntry =
        transactionId
          ? byPath.get(
              `${PAYMENT_TRANSACTIONS_COLLECTION}/${transactionId}`
            ) || null
          : null;

      let view;

      try {
        view =
          buildOperationalOrderView({
            orderId:
              entry.orderId,

            order:
              entry.order,

            transactionId,

            transaction:
              transactionEntry?.data ||
              null,

            product:
              productEntry?.data ||
              {},

            buyer:
              buyerEntry?.data ||
              {},

            fulfillment,

            reversalRequest:
              reversalMap.get(
                entry.orderId
              ) ||
              null
          });
      }
      catch (error) {
        if (
          error instanceof
          AdminOrderModelError
        ) {
          throw canonicalStateError(
            entry.orderId,
            error.code
          );
        }

        throw error;
      }

      views.push(
        view
      );
    }

    return Object.freeze(
      views
    );
  }

  async function listOrders(
    input = {}
  ) {
    const limit =
      readOrdersLimit(
        input.limit
      );

    const filters =
      normalizeOrderFilters(
        input
      );

    const afterOrderId =
      decodeOrderCursor(
        input.cursor
      );

    const matchedDocs = [];

    let scanAfterId =
      afterOrderId;

    let resumeAfterId =
      afterOrderId;

    let scannedDocs =
      0;

    let sourceExhausted =
      false;

    let hasMoreMatches =
      false;

    while (
      !sourceExhausted &&
      !hasMoreMatches &&
      scannedDocs <
        ORDER_MAX_SCAN_DOCS
    ) {
      const remainingBudget =
        ORDER_MAX_SCAN_DOCS -
        scannedDocs;

      const batchLimit =
        Math.min(
          ORDER_SCAN_BATCH_SIZE,
          remainingBudget
        );

      let query =
        db
          .collection(
            ORDERS_COLLECTION
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

      const documents =
        Array.isArray(
          snapshot?.docs
        )
          ? snapshot.docs
          : [];

      if (
        documents.length ===
        0
      ) {
        sourceExhausted =
          true;

        break;
      }

      scannedDocs +=
        documents.length;

      for (
        const document
        of documents
      ) {
        const matches =
          matchesOrderFilters(
            document.data() ||
              {},
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
         * Cursor advances only over documents actually consumed.
         * The first extra matching order remains for the next page.
         */
        resumeAfterId =
          document.id;
      }

      if (hasMoreMatches) {
        break;
      }

      if (
        documents.length <
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
        ORDER_MAX_SCAN_DOCS;

    const items =
      await hydrateOrders(
        matchedDocs
      );

    const shouldContinue =
      hasMoreMatches ||
      scanLimitReached;

    return Object.freeze({
      limit,

      items,

      nextCursor:
        shouldContinue &&
        resumeAfterId
          ? encodeOrderCursor(
              resumeAfterId
            )
          : null
    });
  }

  async function getOrder(
    input = {}
  ) {
    const orderId =
      requiredIdentifier(
        input.orderId,
        "orderId"
      );

    const snapshot =
      await db
        .doc(
          `${ORDERS_COLLECTION}/${orderId}`
        )
        .get();

    if (
      !snapshot ||
      snapshot.exists !==
        true
    ) {
      throw new AdminOrdersReadError(
        "ADMIN_ORDER_NOT_FOUND",
        "Order was not found."
      );
    }

    const items =
      await hydrateOrders([
        snapshot
      ]);

    return items[0];
  }

  return Object.freeze({
    listOrders,
    getOrder
  });
}

module.exports = {
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
  REVERSAL_REQUEST_STATUSES,

  AdminOrdersReadError,

  text,
  requiredIdentifier,
  readOrdersLimit,
  optionalEnumFilter,
  normalizeOrderFilters,
  matchesOrderFilters,

  encodeOrderCursor,
  decodeOrderCursor,

  toMillis,
  reversalPriority,
  selectRelevantReversal,

  normalizeOrderDocument,
  productDocumentPath,
  fulfillmentDocumentPath,
  canonicalFulfillmentForOrder,
  canonicalReversalEntry,

  createAdminOrdersReadService
};
