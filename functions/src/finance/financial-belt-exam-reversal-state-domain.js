'use strict';

const {
  FinancialDomainError,
  validateOrder,
  validateTransaction,
  assertOrderStatusTransition,
  assertTransactionStatusTransition
} = require('./financial-domain');
const {
  FinancialReversalDomainError,
  classifyFinancialReversalEvent,
  resolveFinancialReversalTransition
} = require('./financial-reversal-domain');
const {
  ExamRegistrationDomainError,
  validateExamRegistration,
  resetRegistrationAfterPendingCancellation,
  cancelAuthorizedRegistrationAfterRefund,
  markRegistrationNeedsReconciliation
} = require('../exams/exam-registration-domain');

class FinancialBeltExamReversalStateDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialBeltExamReversalStateDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function requireTimestamp(value) {
  if (!value) {
    throw new FinancialBeltExamReversalStateDomainError(
      'BELT_EXAM_REVERSAL_TIMESTAMP_REQUIRED',
      'Reversão do exame exige timestamp canônico.'
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

function normalizeFailure(error) {
  if (error instanceof FinancialBeltExamReversalStateDomainError) return error;
  if (
    error instanceof FinancialDomainError ||
    error instanceof FinancialReversalDomainError ||
    error instanceof ExamRegistrationDomainError
  ) {
    return new FinancialBeltExamReversalStateDomainError(
      error.code || 'INVALID_BELT_EXAM_REVERSAL_STATE',
      error.message || 'Estado canônico incompatível com a reversão do exame.'
    );
  }
  return error;
}

function validateCanonicalBeltExamFinancialPair({
  orderId,
  order: orderInput,
  transactionId,
  transaction: transactionInput
} = {}) {
  const canonicalOrderId = text(orderId, 200);
  const canonicalTransactionId = text(transactionId, 200);
  if (!canonicalOrderId || canonicalOrderId.includes('/')) {
    throw new FinancialBeltExamReversalStateDomainError(
      'BELT_EXAM_REVERSAL_ORDER_ID_REQUIRED',
      'Reversão do exame exige orderId válido.'
    );
  }
  if (!canonicalTransactionId || canonicalTransactionId.includes('/')) {
    throw new FinancialBeltExamReversalStateDomainError(
      'BELT_EXAM_REVERSAL_TRANSACTION_ID_REQUIRED',
      'Reversão do exame exige transactionId válido.'
    );
  }

  let order;
  let transaction;
  try {
    order = validateOrder(orderInput || {});
    transaction = validateTransaction(transactionInput || {});
  } catch (error) {
    throw normalizeFailure(error);
  }

  if (order.productType !== 'belt_exam') {
    throw new FinancialBeltExamReversalStateDomainError(
      'BELT_EXAM_REVERSAL_PRODUCT_REQUIRED',
      'Reversão de exame aceita somente productType=belt_exam.'
    );
  }
  if (transaction.orderId !== canonicalOrderId) {
    throw new FinancialBeltExamReversalStateDomainError(
      'BELT_EXAM_REVERSAL_TRANSACTION_ORDER_MISMATCH',
      'Transação não corresponde ao pedido do exame.'
    );
  }
  if (order.currentTransactionId !== canonicalTransactionId) {
    throw new FinancialBeltExamReversalStateDomainError(
      'BELT_EXAM_REVERSAL_CURRENT_TRANSACTION_MISMATCH',
      'Pedido do exame não aponta para a transação informada.'
    );
  }
  if (order.buyerUserId !== transaction.buyerUserId) {
    throw new FinancialBeltExamReversalStateDomainError(
      'BELT_EXAM_REVERSAL_BUYER_MISMATCH',
      'Pedido e transação possuem compradores divergentes.'
    );
  }
  if (
    order.amountCents !== transaction.amountCents ||
    order.currency !== transaction.currency ||
    order.provider !== transaction.provider
  ) {
    throw new FinancialBeltExamReversalStateDomainError(
      'BELT_EXAM_REVERSAL_FINANCIAL_IDENTITY_MISMATCH',
      'Pedido e transação possuem identidade financeira divergente.'
    );
  }
  if (
    snapshotFingerprint(order.financialSnapshot) !==
    snapshotFingerprint(transaction.financialSnapshot)
  ) {
    throw new FinancialBeltExamReversalStateDomainError(
      'BELT_EXAM_REVERSAL_SNAPSHOT_MISMATCH',
      'Pedido e transação possuem snapshots financeiros divergentes.'
    );
  }

  return {
    orderId: canonicalOrderId,
    transactionId: canonicalTransactionId,
    order,
    transaction
  };
}

function validateCanonicalBeltExamRegistration({ orderId, order, registration } = {}) {
  let canonical;
  try {
    canonical = validateExamRegistration(registration || {});
  } catch (error) {
    throw normalizeFailure(error);
  }

  if (
    canonical.sessionId !== order.productId ||
    canonical.studentId !== order.buyerUserId ||
    canonical.orderId !== orderId
  ) {
    throw new FinancialBeltExamReversalStateDomainError(
      'BELT_EXAM_REVERSAL_REGISTRATION_IDENTITY_MISMATCH',
      'Registration não corresponde ao pedido financeiro do exame.'
    );
  }
  return canonical;
}

function buildFinancialAfterTransition({ order, transaction, transition, now }) {
  if (transition.noop === true || transition.delegated === true) {
    return { order, transaction, financialMutationRequired: false };
  }

  const nextOrder = { ...order, status: transition.orderStatus, updatedAt: now };
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
  }

  try {
    assertOrderStatusTransition(order.status, nextOrder.status);
    assertTransactionStatusTransition(transaction.status, nextTransaction.status);
    return {
      order: validateOrder(nextOrder),
      transaction: validateTransaction(nextTransaction),
      financialMutationRequired: true
    };
  } catch (error) {
    throw normalizeFailure(error);
  }
}

function hasAcademicState(registration) {
  return Boolean(
    ['started', 'submitted', 'passed', 'failed', 'certified'].includes(registration.status) ||
    registration.attemptId ||
    registration.resultId ||
    registration.certificateId
  );
}

function moveToReconciliation(registration, orderId, now) {
  if (registration.status === 'needs_reconciliation') {
    return { registration, registrationMutationRequired: false, reviewRequired: true };
  }
  try {
    return {
      registration: markRegistrationNeedsReconciliation(registration, {
        orderId,
        updatedAt: now
      }),
      registrationMutationRequired: true,
      reviewRequired: true
    };
  } catch (error) {
    throw normalizeFailure(error);
  }
}

function buildRegistrationAfterTransition({
  orderId,
  registration,
  transition,
  classification,
  now
}) {
  const action = transition.action;

  if (action === 'cancel') {
    if (registration.status === 'selected' && registration.orderId === null) {
      return {
        registration,
        registrationMutationRequired: false,
        reviewRequired: false
      };
    }
    try {
      return {
        registration: resetRegistrationAfterPendingCancellation(registration, {
          orderId,
          updatedAt: now
        }),
        registrationMutationRequired: true,
        reviewRequired: false
      };
    } catch (error) {
      throw normalizeFailure(error);
    }
  }

  if (action === 'refund') {
    if (registration.status === 'cancelled') {
      return {
        registration,
        registrationMutationRequired: false,
        reviewRequired: false
      };
    }
    if (registration.status === 'authorized' && !hasAcademicState(registration)) {
      try {
        return {
          registration: cancelAuthorizedRegistrationAfterRefund(registration, {
            orderId,
            cancelledAt: now
          }),
          registrationMutationRequired: true,
          reviewRequired: false
        };
      } catch (error) {
        throw normalizeFailure(error);
      }
    }
    return moveToReconciliation(registration, orderId, now);
  }

  if (action === 'partial_refund_review') {
    return moveToReconciliation(registration, orderId, now);
  }

  if (['chargeback', 'chargeback_progress', 'chargeback_reversal_pending'].includes(action)) {
    return moveToReconciliation(registration, orderId, now);
  }

  if (['refund_pending', 'refund_denied', 'positive_payment', 'ignore'].includes(action)) {
    return {
      registration,
      registrationMutationRequired: false,
      reviewRequired: classification?.requiresReview === true
    };
  }

  return {
    registration,
    registrationMutationRequired: false,
    reviewRequired: false
  };
}

function buildCanonicalBeltExamReversalState({
  orderId,
  order: orderInput,
  transactionId,
  transaction: transactionInput,
  registration: registrationInput,
  eventType,
  now
} = {}) {
  const timestamp = requireTimestamp(now);
  const canonical = validateCanonicalBeltExamFinancialPair({
    orderId,
    order: orderInput,
    transactionId,
    transaction: transactionInput
  });
  const registration = validateCanonicalBeltExamRegistration({
    orderId: canonical.orderId,
    order: canonical.order,
    registration: registrationInput
  });

  let transition;
  let classification;
  try {
    classification = classifyFinancialReversalEvent(eventType);
    transition = resolveFinancialReversalTransition({
      eventType,
      orderStatus: canonical.order.status,
      transactionStatus: canonical.transaction.status,
      chargebackRecoveryAuthorized: false
    });
  } catch (error) {
    throw normalizeFailure(error);
  }

  const financial = buildFinancialAfterTransition({
    order: canonical.order,
    transaction: canonical.transaction,
    transition,
    now: timestamp
  });
  const registrationResult = buildRegistrationAfterTransition({
    orderId: canonical.orderId,
    registration,
    transition,
    classification,
    now: timestamp
  });

  return Object.freeze({
    classification,
    transition,
    order: financial.order,
    transaction: financial.transaction,
    registration: registrationResult.registration,
    financialMutationRequired: financial.financialMutationRequired,
    registrationMutationRequired: registrationResult.registrationMutationRequired,
    reviewRequired: registrationResult.reviewRequired,
    mutationRequired:
      financial.financialMutationRequired ||
      registrationResult.registrationMutationRequired
  });
}

module.exports = {
  FinancialBeltExamReversalStateDomainError,
  snapshotFingerprint,
  validateCanonicalBeltExamFinancialPair,
  validateCanonicalBeltExamRegistration,
  hasAcademicState,
  buildCanonicalBeltExamReversalState
};
