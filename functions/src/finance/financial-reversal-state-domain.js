'use strict';

const {
  validateOrder,
  validateTransaction
} = require('./financial-domain');
const {
  FinancialReversalDomainError,
  resolveFinancialReversalTransition,
  resolveEnrollmentReversalPolicy
} = require('./financial-reversal-domain');
const {
  validateEnrollment
} = require('../courses/course-enrollment-domain');

class FinancialReversalStateDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialReversalStateDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function requireTimestamp(value) {
  if (!value) {
    throw new FinancialReversalStateDomainError(
      'REVERSAL_TIMESTAMP_REQUIRED',
      'Aplicação de reversão exige timestamp canônico.'
    );
  }
  return value;
}

function snapshotFingerprint(snapshot = {}) {
  return JSON.stringify({
    ruleId: snapshot.ruleId,
    ruleVersion: snapshot.ruleVersion,
    productType: snapshot.productType,
    productId: snapshot.productId,
    currency: snapshot.currency,
    grossAmountCents: snapshot.grossAmountCents,
    platformFeeBps: snapshot.platformFeeBps,
    platformFeeCents: snapshot.platformFeeCents,
    sellerPoolCents: snapshot.sellerPoolCents,
    recipientMode: snapshot.recipientMode,
    recipientAllocations: snapshot.recipientAllocations,
    resolvedAt: snapshot.resolvedAt
  });
}

function validateCanonicalFinancialPair({
  orderId,
  order: orderInput,
  transactionId,
  transaction: transactionInput
} = {}) {
  const canonicalOrderId = text(orderId, 200);
  const canonicalTransactionId = text(transactionId, 200);
  if (!canonicalOrderId || canonicalOrderId.includes('/')) {
    throw new FinancialReversalStateDomainError(
      'REVERSAL_ORDER_ID_REQUIRED',
      'Reversão exige orderId canônico válido.'
    );
  }
  if (!canonicalTransactionId || canonicalTransactionId.includes('/')) {
    throw new FinancialReversalStateDomainError(
      'REVERSAL_TRANSACTION_ID_REQUIRED',
      'Reversão exige transactionId canônico válido.'
    );
  }

  const order = validateOrder(orderInput || {});
  const transaction = validateTransaction(transactionInput || {});

  if (order.productType !== 'course') {
    throw new FinancialReversalStateDomainError(
      'REVERSAL_PRODUCT_NOT_SUPPORTED',
      'Marco 5.5 é course-first e aceita somente productType=course.'
    );
  }
  if (transaction.orderId !== canonicalOrderId) {
    throw new FinancialReversalStateDomainError(
      'REVERSAL_TRANSACTION_ORDER_MISMATCH',
      'payment_transaction não corresponde ao orderId informado.'
    );
  }
  if (order.currentTransactionId !== canonicalTransactionId) {
    throw new FinancialReversalStateDomainError(
      'REVERSAL_CURRENT_TRANSACTION_MISMATCH',
      'Pedido não aponta para a transação financeira informada.'
    );
  }
  if (order.buyerUserId !== transaction.buyerUserId) {
    throw new FinancialReversalStateDomainError(
      'REVERSAL_BUYER_MISMATCH',
      'Pedido e transação possuem compradores divergentes.'
    );
  }
  if (order.amountCents !== transaction.amountCents || order.currency !== transaction.currency) {
    throw new FinancialReversalStateDomainError(
      'REVERSAL_AMOUNT_MISMATCH',
      'Pedido e transação possuem valor ou moeda divergentes.'
    );
  }
  if (order.provider && order.provider !== transaction.provider) {
    throw new FinancialReversalStateDomainError(
      'REVERSAL_PROVIDER_MISMATCH',
      'Pedido e transação possuem providers divergentes.'
    );
  }
  if (snapshotFingerprint(order.financialSnapshot) !== snapshotFingerprint(transaction.financialSnapshot)) {
    throw new FinancialReversalStateDomainError(
      'REVERSAL_SNAPSHOT_MISMATCH',
      'Pedido e transação possuem snapshots financeiros divergentes.'
    );
  }

  return { orderId: canonicalOrderId, transactionId: canonicalTransactionId, order, transaction };
}

function validateCanonicalOrderEnrollment({ orderId, order, enrollment } = {}) {
  if (!enrollment) return null;
  const normalized = validateEnrollment(enrollment);

  if (
    normalized.source !== 'order' ||
    normalized.orderId !== orderId ||
    normalized.courseId !== order.productId ||
    normalized.userId !== order.buyerUserId
  ) {
    throw new FinancialReversalStateDomainError(
      'REVERSAL_ENROLLMENT_IDENTITY_MISMATCH',
      'Enrollment não corresponde ao pedido pago que está sendo revertido.'
    );
  }

  return normalized;
}

function buildFinancialStateAfterTransition({ order, transaction, transition, now }) {
  if (transition.noop === true || transition.delegated === true) {
    return { order, transaction, financialMutationRequired: false };
  }

  const nextOrder = {
    ...order,
    status: transition.orderStatus,
    updatedAt: now
  };
  const nextTransaction = {
    ...transaction,
    status: transition.transactionStatus,
    updatedAt: now
  };

  if (transition.action === 'cancel') {
    nextOrder.cancelledAt = nextOrder.cancelledAt || now;
  } else if (transition.action === 'refund') {
    nextOrder.refundedAt = nextOrder.refundedAt || now;
    nextTransaction.refundedAt = nextTransaction.refundedAt || now;
  } else if (transition.action === 'chargeback') {
    nextOrder.chargebackAt = nextOrder.chargebackAt || now;
    nextTransaction.chargebackAt = nextTransaction.chargebackAt || now;
  } else if (transition.action === 'chargeback_recovered') {
    if (!nextOrder.chargebackAt || !nextTransaction.chargebackAt) {
      throw new FinancialReversalStateDomainError(
        'CHARGEBACK_HISTORY_REQUIRED',
        'Recuperação de chargeback exige timestamp histórico no pedido e na transação.'
      );
    }
  }

  return {
    order: validateOrder(nextOrder),
    transaction: validateTransaction(nextTransaction),
    financialMutationRequired: true
  };
}

function buildEnrollmentAfterTransition({
  orderId,
  order,
  enrollment,
  transition,
  now
}) {
  const action = transition.action;

  if (action === 'cancel') {
    const policy = resolveEnrollmentReversalPolicy({ action, enrollment });
    return {
      enrollment: null,
      enrollmentPolicy: policy,
      enrollmentMutationRequired: false
    };
  }

  if (!enrollment) {
    if (['refund', 'chargeback', 'chargeback_recovered'].includes(action)) {
      throw new FinancialReversalStateDomainError(
        'REVERSAL_ENROLLMENT_REQUIRED',
        'Reversão de pagamento confirmado exige enrollment canônico.'
      );
    }
    return {
      enrollment: null,
      enrollmentPolicy: null,
      enrollmentMutationRequired: false
    };
  }

  const canonicalEnrollment = validateCanonicalOrderEnrollment({
    orderId,
    order,
    enrollment
  });
  const policy = resolveEnrollmentReversalPolicy({
    action,
    enrollment: canonicalEnrollment
  });

  if (policy.targetStatus === canonicalEnrollment.status) {
    return {
      enrollment: canonicalEnrollment,
      enrollmentPolicy: policy,
      enrollmentMutationRequired: false
    };
  }

  const nextEnrollment = validateEnrollment({
    ...canonicalEnrollment,
    status: policy.targetStatus,
    updatedAt: now
  });

  return {
    enrollment: nextEnrollment,
    enrollmentPolicy: policy,
    enrollmentMutationRequired: true
  };
}

function buildCanonicalFinancialReversalState({
  orderId,
  order: orderInput,
  transactionId,
  transaction: transactionInput,
  enrollment = null,
  eventType,
  chargebackRecoveryAuthorized = false,
  now
} = {}) {
  const timestamp = requireTimestamp(now);
  const canonical = validateCanonicalFinancialPair({
    orderId,
    order: orderInput,
    transactionId,
    transaction: transactionInput
  });

  const transition = resolveFinancialReversalTransition({
    eventType,
    orderStatus: canonical.order.status,
    transactionStatus: canonical.transaction.status,
    chargebackRecoveryAuthorized
  });

  const financial = buildFinancialStateAfterTransition({
    order: canonical.order,
    transaction: canonical.transaction,
    transition,
    now: timestamp
  });

  const enrollmentResult = buildEnrollmentAfterTransition({
    orderId: canonical.orderId,
    order: financial.order,
    enrollment,
    transition,
    now: timestamp
  });

  return Object.freeze({
    transition,
    order: financial.order,
    transaction: financial.transaction,
    enrollment: enrollmentResult.enrollment,
    enrollmentPolicy: enrollmentResult.enrollmentPolicy,
    financialMutationRequired: financial.financialMutationRequired,
    enrollmentMutationRequired: enrollmentResult.enrollmentMutationRequired,
    mutationRequired:
      financial.financialMutationRequired ||
      enrollmentResult.enrollmentMutationRequired
  });
}

module.exports = {
  FinancialReversalStateDomainError,
  snapshotFingerprint,
  validateCanonicalFinancialPair,
  validateCanonicalOrderEnrollment,
  buildCanonicalFinancialReversalState
};