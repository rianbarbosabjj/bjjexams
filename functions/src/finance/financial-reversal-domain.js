'use strict';

const FINANCIAL_REVERSAL_ACTIONS = Object.freeze([
  'cancel',
  'refund',
  'partial_refund_review',
  'refund_pending',
  'refund_denied',
  'chargeback',
  'chargeback_progress',
  'chargeback_reversal_pending',
  'positive_payment',
  'ignore'
]);

const REVERSAL_ORDER_STATUSES = Object.freeze([
  'pending_payment',
  'paid',
  'cancelled',
  'refunded',
  'chargeback'
]);

const REVERSAL_TRANSACTION_STATUSES = Object.freeze([
  'pending',
  'paid',
  'cancelled',
  'refunded',
  'chargeback'
]);

const REVERSAL_ENROLLMENT_STATUSES = Object.freeze([
  'active',
  'completed',
  'cancelled',
  'refunded',
  'chargeback'
]);

class FinancialReversalDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialReversalDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function upper(value, max = 80) {
  const normalized = text(value, max);
  return normalized ? normalized.toUpperCase() : null;
}

function lower(value, max = 80) {
  const normalized = text(value, max);
  return normalized ? normalized.toLowerCase() : null;
}

function classifyFinancialReversalEvent(eventType) {
  const type = upper(eventType, 80);
  if (!type) {
    throw new FinancialReversalDomainError(
      'REVERSAL_EVENT_TYPE_REQUIRED',
      'Evento financeiro exige eventType.'
    );
  }

  const map = {
    PAYMENT_DELETED: {
      action: 'cancel',
      mutatesFinancialState: true,
      revokesEntitlement: false,
      requiresReview: false
    },
    PAYMENT_REFUNDED: {
      action: 'refund',
      mutatesFinancialState: true,
      revokesEntitlement: true,
      requiresReview: false
    },
    PAYMENT_PARTIALLY_REFUNDED: {
      action: 'partial_refund_review',
      mutatesFinancialState: false,
      revokesEntitlement: false,
      requiresReview: true
    },
    PAYMENT_REFUND_IN_PROGRESS: {
      action: 'refund_pending',
      mutatesFinancialState: false,
      revokesEntitlement: false,
      requiresReview: false
    },
    PAYMENT_REFUND_DENIED: {
      action: 'refund_denied',
      mutatesFinancialState: false,
      revokesEntitlement: false,
      requiresReview: true
    },
    PAYMENT_CHARGEBACK_REQUESTED: {
      action: 'chargeback',
      mutatesFinancialState: true,
      revokesEntitlement: true,
      requiresReview: false
    },
    PAYMENT_CHARGEBACK_DISPUTE: {
      action: 'chargeback_progress',
      mutatesFinancialState: false,
      revokesEntitlement: true,
      requiresReview: false
    },
    PAYMENT_AWAITING_CHARGEBACK_REVERSAL: {
      action: 'chargeback_reversal_pending',
      mutatesFinancialState: false,
      revokesEntitlement: true,
      requiresReview: false
    },
    PAYMENT_CONFIRMED: {
      action: 'positive_payment',
      mutatesFinancialState: false,
      revokesEntitlement: false,
      requiresReview: false
    },
    PAYMENT_RECEIVED: {
      action: 'positive_payment',
      mutatesFinancialState: false,
      revokesEntitlement: false,
      requiresReview: false
    }
  };

  const selected = map[type] || {
    action: 'ignore',
    mutatesFinancialState: false,
    revokesEntitlement: false,
    requiresReview: false
  };

  return Object.freeze({ eventType: type, ...selected });
}

function canonicalPair(orderStatus, transactionStatus) {
  const order = lower(orderStatus, 40);
  const transaction = lower(transactionStatus, 40);

  if (!REVERSAL_ORDER_STATUSES.includes(order)) {
    throw new FinancialReversalDomainError(
      'INVALID_REVERSAL_ORDER_STATUS',
      `Status de pedido inválido para reversão: ${orderStatus}.`
    );
  }
  if (!REVERSAL_TRANSACTION_STATUSES.includes(transaction)) {
    throw new FinancialReversalDomainError(
      'INVALID_REVERSAL_TRANSACTION_STATUS',
      `Status de transação inválido para reversão: ${transactionStatus}.`
    );
  }

  const expected = {
    pending_payment: 'pending',
    paid: 'paid',
    cancelled: 'cancelled',
    refunded: 'refunded',
    chargeback: 'chargeback'
  };

  if (expected[order] !== transaction) {
    throw new FinancialReversalDomainError(
      'FINANCIAL_REVERSAL_STATE_MISMATCH',
      `Pedido ${order} e transação ${transaction} não formam estado financeiro canônico.`
    );
  }

  return { orderStatus: order, transactionStatus: transaction };
}

function transitionResult({
  action,
  eventType,
  from,
  orderStatus,
  transactionStatus,
  idempotent = false,
  noop = false,
  delegated = false,
  restoresEntitlement = false,
  reason = null
}) {
  return Object.freeze({
    action,
    eventType,
    fromOrderStatus: from.orderStatus,
    fromTransactionStatus: from.transactionStatus,
    orderStatus,
    transactionStatus,
    idempotent,
    noop,
    delegated,
    restoresEntitlement,
    reason
  });
}

function resolveFinancialReversalTransition({
  eventType,
  orderStatus,
  transactionStatus,
  chargebackRecoveryAuthorized = false
} = {}) {
  const classification = classifyFinancialReversalEvent(eventType);
  const current = canonicalPair(orderStatus, transactionStatus);
  const same = extra => transitionResult({
    action: classification.action,
    eventType: classification.eventType,
    from: current,
    orderStatus: current.orderStatus,
    transactionStatus: current.transactionStatus,
    noop: true,
    ...extra
  });

  if (classification.action === 'ignore') {
    return same({ idempotent: true, reason: 'EVENT_OUT_OF_SCOPE' });
  }

  if (classification.action === 'partial_refund_review') {
    return same({
      idempotent: true,
      reason: 'PARTIAL_REFUND_REQUIRES_MANUAL_RECONCILIATION'
    });
  }

  if (['refund_pending', 'refund_denied', 'chargeback_progress', 'chargeback_reversal_pending'].includes(classification.action)) {
    return same({ idempotent: true, reason: 'PROVIDER_STATE_PROGRESS_ONLY' });
  }

  if (classification.action === 'cancel') {
    if (current.orderStatus === 'pending_payment') {
      return transitionResult({
        action: 'cancel',
        eventType: classification.eventType,
        from: current,
        orderStatus: 'cancelled',
        transactionStatus: 'cancelled'
      });
    }
    if (current.orderStatus === 'cancelled') {
      return same({ idempotent: true, reason: 'ALREADY_CANCELLED' });
    }
    throw new FinancialReversalDomainError(
      'PAYMENT_NOT_CANCELLABLE',
      `PAYMENT_DELETED não pode cancelar pedido em ${current.orderStatus}.`
    );
  }

  if (classification.action === 'refund') {
    if (['paid', 'chargeback'].includes(current.orderStatus)) {
      return transitionResult({
        action: 'refund',
        eventType: classification.eventType,
        from: current,
        orderStatus: 'refunded',
        transactionStatus: 'refunded'
      });
    }
    if (current.orderStatus === 'refunded') {
      return same({ idempotent: true, reason: 'ALREADY_REFUNDED' });
    }
    throw new FinancialReversalDomainError(
      'PAYMENT_NOT_REFUNDABLE',
      `PAYMENT_REFUNDED não é compatível com pedido em ${current.orderStatus}.`
    );
  }

  if (classification.action === 'chargeback') {
    if (current.orderStatus === 'paid') {
      return transitionResult({
        action: 'chargeback',
        eventType: classification.eventType,
        from: current,
        orderStatus: 'chargeback',
        transactionStatus: 'chargeback'
      });
    }
    if (current.orderStatus === 'chargeback') {
      return same({ idempotent: true, reason: 'ALREADY_IN_CHARGEBACK' });
    }
    if (current.orderStatus === 'refunded') {
      return same({ idempotent: true, reason: 'REFUND_FINAL_PRECEDENCE' });
    }
    throw new FinancialReversalDomainError(
      'PAYMENT_NOT_CHARGEBACK_ELIGIBLE',
      `Chargeback não é compatível com pedido em ${current.orderStatus}.`
    );
  }

  if (classification.action === 'positive_payment') {
    if (current.orderStatus === 'chargeback') {
      if (chargebackRecoveryAuthorized !== true) {
        throw new FinancialReversalDomainError(
          'CHARGEBACK_RECOVERY_NOT_AUTHORIZED',
          'Evento positivo não pode restaurar chargeback sem evidência prévia de reversão vencida.'
        );
      }
      return transitionResult({
        action: 'chargeback_recovered',
        eventType: classification.eventType,
        from: current,
        orderStatus: 'paid',
        transactionStatus: 'paid',
        restoresEntitlement: true
      });
    }
    if (current.orderStatus === 'refunded') {
      return same({ idempotent: true, reason: 'REFUND_FINAL_PRECEDENCE' });
    }
    return same({
      idempotent: true,
      delegated: true,
      reason: 'DELEGATE_POSITIVE_PAYMENT_TO_MARCO_5_4'
    });
  }

  throw new FinancialReversalDomainError(
    'UNSUPPORTED_REVERSAL_ACTION',
    `Ação de reversão não suportada: ${classification.action}.`
  );
}

function normalizeProgress(value) {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new FinancialReversalDomainError(
      'INVALID_REVERSAL_ENROLLMENT_PROGRESS',
      'progressPercent precisa estar entre 0 e 100.'
    );
  }
  return parsed;
}

function resolveEnrollmentReversalPolicy({
  action,
  enrollment = null
} = {}) {
  const normalizedAction = lower(action, 80);

  if (normalizedAction === 'cancel') {
    if (!enrollment) {
      return Object.freeze({
        action: 'cancel',
        currentStatus: null,
        targetStatus: null,
        entitlementGranted: false,
        preserveCompletionHistory: true,
        idempotent: true
      });
    }
    throw new FinancialReversalDomainError(
      'CANCELLED_PAYMENT_HAS_ENTITLEMENT',
      'Cancelamento pré-pagamento não pode coexistir com enrollment pago.'
    );
  }

  if (!enrollment || typeof enrollment !== 'object' || Array.isArray(enrollment)) {
    throw new FinancialReversalDomainError(
      'REVERSAL_ENROLLMENT_REQUIRED',
      'Refund/chargeback exige enrollment canônico do pedido.'
    );
  }

  const source = lower(enrollment.source, 40);
  const currentStatus = lower(enrollment.status, 40);
  const progressPercent = normalizeProgress(enrollment.progressPercent);
  const completedAt = enrollment.completedAt ?? null;

  if (source !== 'order') {
    throw new FinancialReversalDomainError(
      'REVERSAL_ORDER_ENROLLMENT_REQUIRED',
      'Reversão financeira somente pode alterar enrollment com source=order.'
    );
  }
  if (!REVERSAL_ENROLLMENT_STATUSES.includes(currentStatus)) {
    throw new FinancialReversalDomainError(
      'INVALID_REVERSAL_ENROLLMENT_STATUS',
      `Status de enrollment inválido para reversão: ${enrollment.status}.`
    );
  }

  const completedHistorically = Boolean(completedAt) || progressPercent >= 100;

  if (normalizedAction === 'refund') {
    if (currentStatus === 'refunded') {
      return Object.freeze({
        action: 'refund',
        currentStatus,
        targetStatus: 'refunded',
        entitlementGranted: false,
        preserveCompletionHistory: true,
        idempotent: true
      });
    }
    if (!['active', 'completed', 'chargeback'].includes(currentStatus)) {
      throw new FinancialReversalDomainError(
        'ENROLLMENT_NOT_REFUNDABLE',
        `Enrollment em ${currentStatus} não pode ser marcado como refunded.`
      );
    }
    return Object.freeze({
      action: 'refund',
      currentStatus,
      targetStatus: 'refunded',
      entitlementGranted: false,
      preserveCompletionHistory: true,
      idempotent: false
    });
  }

  if (normalizedAction === 'chargeback') {
    if (currentStatus === 'refunded') {
      return Object.freeze({
        action: 'chargeback',
        currentStatus,
        targetStatus: 'refunded',
        entitlementGranted: false,
        preserveCompletionHistory: true,
        idempotent: true
      });
    }
    if (currentStatus === 'chargeback') {
      return Object.freeze({
        action: 'chargeback',
        currentStatus,
        targetStatus: 'chargeback',
        entitlementGranted: false,
        preserveCompletionHistory: true,
        idempotent: true
      });
    }
    if (!['active', 'completed'].includes(currentStatus)) {
      throw new FinancialReversalDomainError(
        'ENROLLMENT_NOT_CHARGEBACK_ELIGIBLE',
        `Enrollment em ${currentStatus} não pode entrar em chargeback.`
      );
    }
    return Object.freeze({
      action: 'chargeback',
      currentStatus,
      targetStatus: 'chargeback',
      entitlementGranted: false,
      preserveCompletionHistory: true,
      idempotent: false
    });
  }

  if (normalizedAction === 'chargeback_recovered') {
    if (currentStatus !== 'chargeback') {
      throw new FinancialReversalDomainError(
        'ENROLLMENT_NOT_RECOVERABLE_FROM_CHARGEBACK',
        'Somente enrollment em chargeback pode ser restaurado por disputa vencida.'
      );
    }
    const targetStatus = completedHistorically ? 'completed' : 'active';
    return Object.freeze({
      action: 'chargeback_recovered',
      currentStatus,
      targetStatus,
      entitlementGranted: true,
      preserveCompletionHistory: true,
      idempotent: false
    });
  }

  return Object.freeze({
    action: normalizedAction || 'ignore',
    currentStatus,
    targetStatus: currentStatus,
    entitlementGranted: ['active', 'completed'].includes(currentStatus),
    preserveCompletionHistory: true,
    idempotent: true
  });
}

function grantsCourseEntitlement(status) {
  return ['active', 'completed'].includes(lower(status, 40));
}

module.exports = {
  FINANCIAL_REVERSAL_ACTIONS,
  REVERSAL_ORDER_STATUSES,
  REVERSAL_TRANSACTION_STATUSES,
  REVERSAL_ENROLLMENT_STATUSES,
  FinancialReversalDomainError,
  classifyFinancialReversalEvent,
  resolveFinancialReversalTransition,
  resolveEnrollmentReversalPolicy,
  grantsCourseEntitlement
};
