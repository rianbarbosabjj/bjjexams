'use strict';

const {
  FinancialDomainError,
  validateOrder,
  validateTransaction
} = require('./financial-domain');
const {
  CourseEnrollmentDomainError,
  validateEnrollment
} = require('../courses/course-enrollment-domain');

const PURCHASE_STATES = Object.freeze([
  'available_for_purchase',
  'payment_pending',
  'payment_confirmed_access_pending',
  'paid_entitled',
  'granted_entitled',
  'refunded',
  'chargeback',
  'cancelled_or_expired'
]);

const REVERSAL_REQUEST_STATUSES = Object.freeze([
  'executing',
  'awaiting_webhook',
  'completed',
  'provider_rejected',
  'needs_reconciliation'
]);

class FinancialPurchaseReadDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialPurchaseReadDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function requireIdentifier(value, field) {
  const normalized = text(value, 200);
  if (!normalized || normalized.includes('/')) {
    throw new FinancialPurchaseReadDomainError(
      'INVALID_PURCHASE_READ_ID',
      `${field} inválido.`
    );
  }
  return normalized;
}

function normalizePaidCourse(courseId, course = {}) {
  const id = requireIdentifier(courseId, 'courseId');
  if (course.status !== 'published') {
    throw new FinancialPurchaseReadDomainError(
      'PURCHASE_COURSE_NOT_AVAILABLE',
      'O curso não está disponível para compra.'
    );
  }
  if (course.isPaid !== true) {
    throw new FinancialPurchaseReadDomainError(
      'PURCHASE_COURSE_NOT_PAID',
      'O read model financeiro aceita somente curso pago.'
    );
  }
  const amountCents = Number(course.priceCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new FinancialPurchaseReadDomainError(
      'PURCHASE_COURSE_PRICE_INVALID',
      'Curso pago possui preço inválido.'
    );
  }
  return {
    id,
    title: text(course.title, 200),
    amountCents,
    currency: String(course.currency || 'BRL').trim().toUpperCase()
  };
}

function normalizeEnrollmentForPurchase(enrollment, { courseId, userId, orderId = null } = {}) {
  if (!enrollment) return null;
  let normalized;
  try {
    normalized = validateEnrollment(enrollment);
  } catch (error) {
    if (error instanceof CourseEnrollmentDomainError) {
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_ENROLLMENT_INVALID',
        'A matrícula canônica está inconsistente.'
      );
    }
    throw error;
  }

  if (normalized.courseId !== courseId || normalized.userId !== userId) {
    throw new FinancialPurchaseReadDomainError(
      'PURCHASE_ENROLLMENT_IDENTITY_MISMATCH',
      'A matrícula não corresponde ao comprador e curso consultados.'
    );
  }
  if (
    normalized.source === 'order' &&
    orderId &&
    normalized.orderId !== orderId
  ) {
    throw new FinancialPurchaseReadDomainError(
      'PURCHASE_ENROLLMENT_ORDER_MISMATCH',
      'A matrícula paga não corresponde ao pedido consultado.'
    );
  }
  return normalized;
}

function validateFinancialPair({ orderId, order, transactionId = null, transaction = null, userId, courseId } = {}) {
  let normalizedOrder;
  try {
    normalizedOrder = validateOrder(order || {});
  } catch (error) {
    if (error instanceof FinancialDomainError) {
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_ORDER_INVALID',
        'O pedido canônico está inconsistente.'
      );
    }
    throw error;
  }

  const canonicalOrderId = requireIdentifier(orderId, 'orderId');
  if (
    normalizedOrder.buyerUserId !== userId ||
    normalizedOrder.productType !== 'course' ||
    normalizedOrder.productId !== courseId
  ) {
    throw new FinancialPurchaseReadDomainError(
      'PURCHASE_ORDER_IDENTITY_MISMATCH',
      'O pedido não corresponde ao comprador e curso consultados.'
    );
  }

  if (!transaction) {
    if (normalizedOrder.currentTransactionId) {
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_TRANSACTION_REQUIRED',
        'O pedido aponta para uma transação ausente.'
      );
    }
    if (normalizedOrder.status !== 'pending_payment') {
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_TRANSACTION_REQUIRED',
        'Pedido financeiro finalizado exige transação canônica.'
      );
    }
    return {
      orderId: canonicalOrderId,
      order: normalizedOrder,
      transactionId: null,
      transaction: null
    };
  }

  const canonicalTransactionId = requireIdentifier(transactionId, 'transactionId');
  let normalizedTransaction;
  try {
    normalizedTransaction = validateTransaction(transaction);
  } catch (error) {
    if (error instanceof FinancialDomainError) {
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_TRANSACTION_INVALID',
        'A transação canônica está inconsistente.'
      );
    }
    throw error;
  }

  if (
    normalizedOrder.currentTransactionId !== canonicalTransactionId ||
    normalizedTransaction.orderId !== canonicalOrderId ||
    normalizedTransaction.buyerUserId !== userId ||
    normalizedTransaction.amountCents !== normalizedOrder.amountCents ||
    normalizedTransaction.currency !== normalizedOrder.currency
  ) {
    throw new FinancialPurchaseReadDomainError(
      'PURCHASE_TRANSACTION_IDENTITY_MISMATCH',
      'Pedido e transação não correspondem entre si.'
    );
  }

  const expectedTransactionStatuses = {
    pending_payment: ['created', 'pending'],
    paid: ['paid'],
    cancelled: ['cancelled'],
    expired: ['expired'],
    refunded: ['refunded'],
    chargeback: ['chargeback']
  };
  if (!expectedTransactionStatuses[normalizedOrder.status]?.includes(normalizedTransaction.status)) {
    throw new FinancialPurchaseReadDomainError(
      'PURCHASE_FINANCIAL_STATE_MISMATCH',
      'Pedido e transação possuem estados financeiros divergentes.'
    );
  }

  return {
    orderId: canonicalOrderId,
    order: normalizedOrder,
    transactionId: canonicalTransactionId,
    transaction: normalizedTransaction
  };
}

function entitlementFromEnrollment(enrollment) {
  return Boolean(
    enrollment &&
    ['active', 'completed'].includes(enrollment.status)
  );
}

function resolveStudentPurchaseState({
  courseId,
  userId,
  course,
  orderId = null,
  order = null,
  transactionId = null,
  transaction = null,
  enrollment = null
} = {}) {
  const canonicalUserId = requireIdentifier(userId, 'userId');
  const paidCourse = normalizePaidCourse(courseId, course || {});

  if (!order) {
    const normalizedEnrollment = normalizeEnrollmentForPurchase(
      enrollment,
      { courseId: paidCourse.id, userId: canonicalUserId }
    );
    const entitled = entitlementFromEnrollment(normalizedEnrollment);
    const granted = Boolean(
      entitled && normalizedEnrollment?.source !== 'order'
    );
    if (normalizedEnrollment?.source === 'order') {
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_ORDER_REQUIRED_FOR_PAID_ENROLLMENT',
        'Matrícula originada de pedido exige pedido financeiro correspondente.'
      );
    }
    return Object.freeze({
      courseId: paidCourse.id,
      purchaseState: granted ? 'granted_entitled' : 'available_for_purchase',
      orderStatus: null,
      transactionStatus: null,
      enrollmentStatus: normalizedEnrollment?.status || null,
      entitlementSource: normalizedEnrollment?.source || null,
      entitled,
      canStartCheckout: !granted,
      canOpenCourse: entitled,
      requiresOperationalReview: false,
      amountCents: paidCourse.amountCents,
      currency: paidCourse.currency,
      createdAt: null,
      updatedAt: null,
      paidAt: null,
      refundedAt: null,
      chargebackAt: null
    });
  }

  const canonical = validateFinancialPair({
    orderId,
    order,
    transactionId,
    transaction,
    userId: canonicalUserId,
    courseId: paidCourse.id
  });
  const normalizedEnrollment = normalizeEnrollmentForPurchase(
    enrollment,
    {
      courseId: paidCourse.id,
      userId: canonicalUserId,
      orderId: canonical.orderId
    }
  );
  const entitled = entitlementFromEnrollment(normalizedEnrollment);

  let purchaseState;
  let canStartCheckout = false;
  let requiresOperationalReview = false;

  switch (canonical.order.status) {
    case 'pending_payment':
      purchaseState = 'payment_pending';
      break;
    case 'paid':
      if (entitled) {
        purchaseState = 'paid_entitled';
      } else {
        purchaseState = 'payment_confirmed_access_pending';
        requiresOperationalReview = true;
      }
      break;
    case 'refunded':
      purchaseState = 'refunded';
      break;
    case 'chargeback':
      purchaseState = 'chargeback';
      break;
    case 'cancelled':
    case 'expired':
      if (entitled && normalizedEnrollment?.source !== 'order') {
        purchaseState = 'granted_entitled';
      } else {
        purchaseState = 'cancelled_or_expired';
        canStartCheckout = true;
      }
      break;
    default:
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_STATE_UNSUPPORTED',
        'Estado financeiro não suportado pelo read model.'
      );
  }

  return Object.freeze({
    courseId: paidCourse.id,
    purchaseState,
    orderStatus: canonical.order.status,
    transactionStatus: canonical.transaction?.status || null,
    enrollmentStatus: normalizedEnrollment?.status || null,
    entitlementSource: normalizedEnrollment?.source || null,
    entitled,
    canStartCheckout,
    canOpenCourse: entitled,
    requiresOperationalReview,
    amountCents: canonical.order.amountCents,
    currency: canonical.order.currency,
    createdAt: canonical.order.createdAt,
    updatedAt: canonical.order.updatedAt,
    paidAt: canonical.order.paidAt,
    refundedAt: canonical.order.refundedAt,
    chargebackAt: canonical.order.chargebackAt
  });
}

function normalizeReversalRequest(input = null) {
  if (!input) return null;
  const status = String(input.status || '').trim().toLowerCase();
  if (!REVERSAL_REQUEST_STATUSES.includes(status)) {
    throw new FinancialPurchaseReadDomainError(
      'PURCHASE_REVERSAL_STATUS_INVALID',
      'Solicitação de reversão possui status inválido.'
    );
  }
  const operation = String(input.operation || '').trim().toLowerCase();
  if (!['cancel_pending', 'refund_full'].includes(operation)) {
    throw new FinancialPurchaseReadDomainError(
      'PURCHASE_REVERSAL_OPERATION_INVALID',
      'Solicitação de reversão possui operação inválida.'
    );
  }
  return {
    operation,
    status,
    providerLifecycleStatus: text(input.providerLifecycleStatus, 80),
    errorCode: text(input.errorCode, 120),
    createdAt: input.createdAt || null,
    updatedAt: input.updatedAt || null,
    completedAt: input.completedAt || null,
    reconciliationRequiredAt: input.reconciliationRequiredAt || null
  };
}

function resolveAdminPurchaseOperations({ order, transaction, enrollment = null, reversalRequest = null } = {}) {
  const normalizedOrder = validateOrder(order || {});
  const normalizedTransaction = transaction ? validateTransaction(transaction) : null;
  const normalizedEnrollment = enrollment ? validateEnrollment(enrollment) : null;
  const reversal = normalizeReversalRequest(reversalRequest);
  const reversalActive = Boolean(
    reversal && ['executing', 'awaiting_webhook'].includes(reversal.status)
  );
  const entitlementActive = entitlementFromEnrollment(normalizedEnrollment);

  const canCancel = Boolean(
    !reversalActive &&
    normalizedOrder.status === 'pending_payment' &&
    normalizedTransaction?.status === 'pending' &&
    normalizedTransaction.providerPaymentId &&
    !entitlementActive
  );
  const canRefund = Boolean(
    !reversalActive &&
    normalizedOrder.status === 'paid' &&
    normalizedTransaction?.status === 'paid' &&
    normalizedTransaction.providerPaymentId &&
    normalizedEnrollment?.source === 'order' &&
    entitlementActive
  );

  return Object.freeze({
    canCancel,
    canRefund,
    needsReconciliation: reversal?.status === 'needs_reconciliation',
    reversalInProgress: reversalActive,
    reversal: reversal ? Object.freeze({ ...reversal }) : null
  });
}

function buildAdminPurchaseView({
  orderId,
  order,
  transactionId,
  transaction,
  enrollment = null,
  reversalRequestId = null,
  reversalRequest = null
} = {}) {
  const canonicalOrderId = requireIdentifier(orderId, 'orderId');
  const canonical = validateFinancialPair({
    orderId: canonicalOrderId,
    order,
    transactionId,
    transaction,
    userId: validateOrder(order || {}).buyerUserId,
    courseId: validateOrder(order || {}).productId
  });
  const normalizedEnrollment = normalizeEnrollmentForPurchase(
    enrollment,
    {
      courseId: canonical.order.productId,
      userId: canonical.order.buyerUserId,
      orderId: canonicalOrderId
    }
  );
  const operations = resolveAdminPurchaseOperations({
    order: canonical.order,
    transaction: canonical.transaction,
    enrollment: normalizedEnrollment,
    reversalRequest
  });

  return Object.freeze({
    orderId: canonicalOrderId,
    transactionId: canonical.transactionId,
    courseId: canonical.order.productId,
    buyerUserId: canonical.order.buyerUserId,
    amountCents: canonical.order.amountCents,
    currency: canonical.order.currency,
    orderStatus: canonical.order.status,
    transactionStatus: canonical.transaction?.status || null,
    enrollmentStatus: normalizedEnrollment?.status || null,
    reversalRequestId: reversalRequestId || null,
    reversal: operations.reversal,
    canCancel: operations.canCancel,
    canRefund: operations.canRefund,
    needsReconciliation: operations.needsReconciliation,
    reversalInProgress: operations.reversalInProgress,
    createdAt: canonical.order.createdAt,
    updatedAt: canonical.order.updatedAt,
    paidAt: canonical.order.paidAt,
    cancelledAt: canonical.order.cancelledAt,
    expiredAt: canonical.order.expiredAt,
    refundedAt: canonical.order.refundedAt,
    chargebackAt: canonical.order.chargebackAt
  });
}

module.exports = {
  PURCHASE_STATES,
  REVERSAL_REQUEST_STATUSES,
  FinancialPurchaseReadDomainError,
  normalizePaidCourse,
  normalizeEnrollmentForPurchase,
  validateFinancialPair,
  entitlementFromEnrollment,
  resolveStudentPurchaseState,
  normalizeReversalRequest,
  resolveAdminPurchaseOperations,
  buildAdminPurchaseView
};
