'use strict';

const {
  FinancialDomainError,
  validateOrder
} = require('./financial-domain');
const {
  FinancialPurchaseReadDomainError,
  normalizeReversalRequest
} = require('./financial-purchase-read-domain');
const {
  ExamRegistrationDomainError,
  validateExamRegistration
} = require('../exams/exam-registration-domain');
const {
  FinancialBeltExamReversalStateDomainError,
  validateCanonicalBeltExamFinancialPair,
  hasAcademicState
} = require('./financial-belt-exam-reversal-state-domain');

function requireIdentifier(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200 || normalized.includes('/')) {
    throw new FinancialPurchaseReadDomainError(
      'INVALID_PURCHASE_READ_ID',
      `${field} inválido.`
    );
  }
  return normalized;
}

function validateBeltExamFinancialPairForRead({
  orderId,
  order: orderInput,
  transactionId = null,
  transaction = null
} = {}) {
  const canonicalOrderId = requireIdentifier(orderId, 'orderId');

  let order;
  try {
    order = validateOrder(orderInput || {});
  } catch (error) {
    if (error instanceof FinancialDomainError) {
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_ORDER_INVALID',
        'O pedido canônico do exame está inconsistente.'
      );
    }
    throw error;
  }

  if (order.productType !== 'belt_exam') {
    throw new FinancialPurchaseReadDomainError(
      'PURCHASE_ORDER_IDENTITY_MISMATCH',
      'A operação administrativa aceita somente pedido belt_exam.'
    );
  }

  if (!transaction) {
    if (order.currentTransactionId) {
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_TRANSACTION_REQUIRED',
        'O pedido do exame aponta para uma transação ausente.'
      );
    }

    if (order.status !== 'pending_payment') {
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_TRANSACTION_REQUIRED',
        'Pedido financeiro finalizado exige transação canônica.'
      );
    }

    return Object.freeze({
      orderId: canonicalOrderId,
      order,
      transactionId: null,
      transaction: null
    });
  }

  const canonicalTransactionId = requireIdentifier(
    transactionId,
    'transactionId'
  );

  try {
    const canonical = validateCanonicalBeltExamFinancialPair({
      orderId: canonicalOrderId,
      order,
      transactionId: canonicalTransactionId,
      transaction
    });

    const expectedTransactionStatuses = {
      pending_payment: ['created', 'pending'],
      paid: ['paid'],
      cancelled: ['cancelled'],
      expired: ['expired'],
      refunded: ['refunded'],
      chargeback: ['chargeback']
    };

    if (
      !expectedTransactionStatuses[canonical.order.status]
        ?.includes(canonical.transaction.status)
    ) {
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_ADMIN_CANONICAL_STATE_INVALID',
        'Pedido e transação do exame possuem estados financeiros divergentes.'
      );
    }

    return Object.freeze(canonical);
  } catch (error) {
    if (error instanceof FinancialBeltExamReversalStateDomainError) {
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_ADMIN_CANONICAL_STATE_INVALID',
        'Pedido e transação do exame possuem estado canônico incompatível.'
      );
    }
    throw error;
  }
}

function normalizeBeltExamRegistrationForRead({
  orderId,
  order,
  registration
} = {}) {
  if (!registration) {
    return Object.freeze({
      registration: null,
      boundToOrder: false
    });
  }

  let normalized;
  try {
    normalized = validateExamRegistration(registration);
  } catch (error) {
    if (error instanceof ExamRegistrationDomainError) {
      throw new FinancialPurchaseReadDomainError(
        'PURCHASE_ADMIN_CANONICAL_STATE_INVALID',
        'Registration canônica do exame está inconsistente.'
      );
    }
    throw error;
  }

  if (
    normalized.sessionId !== order.productId ||
    normalized.studentId !== order.buyerUserId
  ) {
    throw new FinancialPurchaseReadDomainError(
      'PURCHASE_ADMIN_CANONICAL_STATE_INVALID',
      'Registration não corresponde ao produto e comprador do pedido.'
    );
  }

  return Object.freeze({
    registration: normalized,
    boundToOrder: normalized.orderId === orderId
  });
}

function buildAdminBeltExamOperationView({
  orderId,
  order,
  transactionId = null,
  transaction = null,
  registration = null,
  reversalRequestId = null,
  reversalRequest = null
} = {}) {
  const canonical = validateBeltExamFinancialPairForRead({
    orderId,
    order,
    transactionId,
    transaction
  });

  const registrationState = normalizeBeltExamRegistrationForRead({
    orderId: canonical.orderId,
    order: canonical.order,
    registration
  });

  const normalizedRegistration = registrationState.registration;
  const reversal = normalizeReversalRequest(reversalRequest);

  const reversalInProgress = Boolean(
    reversal &&
    ['executing', 'awaiting_webhook'].includes(reversal.status)
  );

  const reversalBlocksAction = Boolean(
    reversal &&
    [
      'executing',
      'awaiting_webhook',
      'provider_rejected',
      'needs_reconciliation'
    ].includes(reversal.status)
  );

  const registrationNeedsReconciliation =
    normalizedRegistration?.status === 'needs_reconciliation';

  const needsReconciliation = Boolean(
    registrationNeedsReconciliation ||
    reversal?.status === 'needs_reconciliation'
  );

  const academicActivity = Boolean(
    normalizedRegistration &&
    hasAcademicState(normalizedRegistration)
  );

  const canCancel = Boolean(
    !reversalBlocksAction &&
    !registrationNeedsReconciliation &&
    canonical.order.status === 'pending_payment' &&
    canonical.transaction?.status === 'pending' &&
    canonical.transaction?.providerPaymentId &&
    registrationState.boundToOrder &&
    normalizedRegistration?.status === 'awaiting_payment' &&
    !academicActivity
  );

  const canRefund = Boolean(
    !reversalBlocksAction &&
    !registrationNeedsReconciliation &&
    canonical.order.status === 'paid' &&
    canonical.transaction?.status === 'paid' &&
    canonical.transaction?.providerPaymentId &&
    registrationState.boundToOrder &&
    normalizedRegistration?.status === 'authorized' &&
    !academicActivity
  );

  return Object.freeze({
    orderId: canonical.orderId,
    transactionId: canonical.transactionId,
    productType: 'belt_exam',
    productId: canonical.order.productId,
    sessionId: canonical.order.productId,
    buyerUserId: canonical.order.buyerUserId,
    amountCents: canonical.order.amountCents,
    currency: canonical.order.currency,
    orderStatus: canonical.order.status,
    transactionStatus: canonical.transaction?.status || null,
    registrationStatus: normalizedRegistration?.status || null,
    reversalRequestId: reversalRequestId
      ? requireIdentifier(reversalRequestId, 'reversalRequestId')
      : null,
    reversal: reversal ? Object.freeze({ ...reversal }) : null,
    canCancel,
    canRefund,
    needsReconciliation,
    reversalInProgress,
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
  requireIdentifier,
  validateBeltExamFinancialPairForRead,
  normalizeBeltExamRegistrationForRead,
  buildAdminBeltExamOperationView
};