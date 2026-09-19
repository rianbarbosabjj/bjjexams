'use strict';

const crypto = require('crypto');

const {
  FinancialAdminDomainError,
  assertCanAdministerFinancialRules
} = require('./financial-admin-domain');
const {
  providerMoneyToCents
} = require('./financial-webhook-domain');
const {
  paymentExternalReference
} = require('./asaas-checkout-adapter');
const {
  FinancialReversalStateDomainError,
  validateCanonicalFinancialPair,
  validateCanonicalOrderEnrollment
} = require('./financial-reversal-state-domain');
const {
  enrollmentDocumentId
} = require('../courses/course-enrollment-domain');

const REVERSAL_REQUESTS_COLLECTION = 'financial_reversal_requests';
const REVERSAL_OPERATIONS = Object.freeze([
  'cancel_pending',
  'refund_full'
]);

class FinancialReversalAdminServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialReversalAdminServiceError';
    this.code = code;
  }
}

function text(value, max = 300) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function requireIdentifier(value, field) {
  const normalized = text(value, 200);
  if (!normalized || normalized.includes('/')) {
    throw new FinancialReversalAdminServiceError(
      'INVALID_REVERSAL_ADMIN_ID',
      `${field} inválido.`
    );
  }
  return normalized;
}

function requireReason(value) {
  const reason = text(value, 300);
  if (!reason || reason.length < 5) {
    throw new FinancialReversalAdminServiceError(
      'REVERSAL_REASON_REQUIRED',
      'Operação financeira exige justificativa com pelo menos 5 caracteres.'
    );
  }
  return reason;
}

function reversalRequestId({ operation, transactionId } = {}) {
  const canonicalOperation = String(operation || '').trim().toLowerCase();
  const canonicalTransactionId = requireIdentifier(transactionId, 'transactionId');
  if (!REVERSAL_OPERATIONS.includes(canonicalOperation)) {
    throw new FinancialReversalAdminServiceError(
      'INVALID_REVERSAL_OPERATION',
      'Operação administrativa de reversão inválida.'
    );
  }
  return crypto
    .createHash('sha256')
    .update(`financial-reversal-request-v1:${canonicalOperation}:${canonicalTransactionId}`)
    .digest('hex');
}

function providerCustomerId(payment = {}) {
  if (typeof payment.customer === 'string') return payment.customer.trim();
  return String(payment.customer?.id || '').trim();
}

function normalizeProviderPayment(payment = {}) {
  if (!payment || typeof payment !== 'object') {
    throw new FinancialReversalAdminServiceError(
      'REVERSAL_PROVIDER_PAYMENT_REQUIRED',
      'Cobrança do provedor não foi encontrada.'
    );
  }

  let valueCents;
  try {
    valueCents = providerMoneyToCents(payment.value, 'provider.value');
  } catch (_error) {
    throw new FinancialReversalAdminServiceError(
      'REVERSAL_PROVIDER_PAYMENT_INVALID',
      'Cobrança do provedor possui valor inválido.'
    );
  }

  return {
    id: String(payment.id || '').trim(),
    status: String(payment.status || '').trim().toUpperCase(),
    billingType: String(payment.billingType || '').trim().toUpperCase(),
    externalReference: String(payment.externalReference || '').trim(),
    customer: providerCustomerId(payment),
    valueCents
  };
}

function requestView(requestId, request = {}, { idempotent = false } = {}) {
  return {
    requestId,
    operation: request.operation || null,
    orderId: request.orderId || null,
    transactionId: request.transactionId || null,
    providerPaymentId: request.providerPaymentId || null,
    status: request.status || null,
    awaitingWebhook: request.status === 'awaiting_webhook',
    inProgress: request.status === 'executing',
    idempotent: idempotent === true
  };
}

function createFinancialReversalAdminService(dependencies = {}) {
  const {
    db,
    providerFactory,
    environment,
    clock = () => new Date()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.runTransaction !== 'function'
  ) {
    throw new TypeError('Reversal admin service exige Firestore válido.');
  }
  if (typeof providerFactory !== 'function') {
    throw new TypeError('Reversal admin service exige providerFactory().');
  }

  const canonicalEnvironment = String(environment || '').trim().toLowerCase();
  if (canonicalEnvironment !== 'sandbox') {
    throw new FinancialReversalAdminServiceError(
      'REVERSAL_ADMIN_SANDBOX_ONLY',
      'Operações administrativas do Marco 5.5 estão bloqueadas fora do sandbox.'
    );
  }

  function timestamp() {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new FinancialReversalAdminServiceError(
        'REVERSAL_ADMIN_TIMESTAMP_REQUIRED',
        'Relógio server-side inválido.'
      );
    }
    return date;
  }

  function actorContext({ actorId, claims = {} } = {}) {
    const uid = requireIdentifier(actorId, 'actorId');
    try {
      const role = assertCanAdministerFinancialRules(claims);
      return { uid, role };
    } catch (error) {
      if (error instanceof FinancialAdminDomainError) {
        throw new FinancialReversalAdminServiceError(error.code, error.message);
      }
      throw error;
    }
  }

  async function loadCanonicalState(orderIdInput) {
    const orderId = requireIdentifier(orderIdInput, 'orderId');
    const orderRef = db.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new FinancialReversalAdminServiceError(
        'REVERSAL_ORDER_NOT_FOUND',
        'Pedido financeiro não encontrado.'
      );
    }

    const rawOrder = orderSnap.data() || {};
    const transactionId = requireIdentifier(
      rawOrder.currentTransactionId,
      'currentTransactionId'
    );
    const transactionRef = db.doc(`payment_transactions/${transactionId}`);
    const transactionSnap = await transactionRef.get();
    if (!transactionSnap.exists) {
      throw new FinancialReversalAdminServiceError(
        'REVERSAL_TRANSACTION_NOT_FOUND',
        'Transação financeira não encontrada.'
      );
    }

    let canonical;
    try {
      canonical = validateCanonicalFinancialPair({
        orderId,
        order: rawOrder,
        transactionId,
        transaction: transactionSnap.data() || {}
      });
    } catch (error) {
      if (error instanceof FinancialReversalStateDomainError) {
        throw new FinancialReversalAdminServiceError(
          'REVERSAL_CANONICAL_STATE_INVALID',
          'Pedido e transação possuem estado canônico incompatível.'
        );
      }
      throw error;
    }

    const enrollmentId = enrollmentDocumentId(
      canonical.order.productId,
      canonical.order.buyerUserId
    );
    const enrollmentSnap = await db.doc(`enrollments/${enrollmentId}`).get();
    let enrollment = null;
    if (enrollmentSnap.exists) {
      try {
        enrollment = validateCanonicalOrderEnrollment({
          orderId,
          order: canonical.order,
          enrollment: enrollmentSnap.data() || {}
        });
      } catch (error) {
        if (error instanceof FinancialReversalStateDomainError) {
          throw new FinancialReversalAdminServiceError(
            'REVERSAL_ENROLLMENT_STATE_INVALID',
            'Enrollment não corresponde ao pedido financeiro.'
          );
        }
        throw error;
      }
    }

    return {
      orderId,
      transactionId,
      order: canonical.order,
      transaction: canonical.transaction,
      enrollmentId,
      enrollment
    };
  }

  function assertOperationState(operation, state) {
    const { order, transaction, enrollment } = state;
    if (!transaction.providerPaymentId) {
      throw new FinancialReversalAdminServiceError(
        'REVERSAL_PROVIDER_PAYMENT_ID_REQUIRED',
        'Transação não possui cobrança Asaas vinculada.'
      );
    }

    if (operation === 'cancel_pending') {
      if (order.status !== 'pending_payment' || transaction.status !== 'pending') {
        throw new FinancialReversalAdminServiceError(
          'REVERSAL_PENDING_STATE_REQUIRED',
          'Cancelamento administrativo exige pedido e transação ainda pendentes.'
        );
      }
      if (enrollment) {
        throw new FinancialReversalAdminServiceError(
          'REVERSAL_PENDING_HAS_ENROLLMENT',
          'Cobrança pendente com enrollment exige reconciliação manual.'
        );
      }
      return;
    }

    if (order.status !== 'paid' || transaction.status !== 'paid') {
      throw new FinancialReversalAdminServiceError(
        'REVERSAL_PAID_STATE_REQUIRED',
        'Estorno integral administrativo exige pedido e transação pagos.'
      );
    }
    if (!enrollment || !['active', 'completed'].includes(enrollment.status)) {
      throw new FinancialReversalAdminServiceError(
        'REVERSAL_PAID_ENROLLMENT_REQUIRED',
        'Estorno integral exige enrollment pago ativo ou concluído.'
      );
    }
  }

  function assertProviderPayment(operation, state, paymentInput) {
    const payment = normalizeProviderPayment(paymentInput);
    const expectedReference = paymentExternalReference(state.orderId);
    if (
      payment.id !== state.transaction.providerPaymentId ||
      payment.externalReference !== expectedReference ||
      payment.customer !== state.order.providerCustomerId ||
      payment.valueCents !== state.order.amountCents ||
      payment.billingType !== 'PIX'
    ) {
      throw new FinancialReversalAdminServiceError(
        'REVERSAL_PROVIDER_IDENTITY_MISMATCH',
        'Cobrança Asaas não corresponde ao estado financeiro canônico.'
      );
    }

    const allowedStatuses = operation === 'cancel_pending'
      ? ['PENDING']
      : ['CONFIRMED', 'RECEIVED'];
    if (!allowedStatuses.includes(payment.status)) {
      throw new FinancialReversalAdminServiceError(
        'REVERSAL_PROVIDER_STATUS_INVALID',
        `Cobrança Asaas não aceita ${operation} no status atual.`
      );
    }
    return payment;
  }

  function provider() {
    const instance = providerFactory();
    if (
      !instance ||
      typeof instance.getPaymentById !== 'function' ||
      typeof instance.deletePendingPayment !== 'function' ||
      typeof instance.requestFullRefund !== 'function'
    ) {
      throw new TypeError(
        'Provider de reversão exige getPaymentById/deletePendingPayment/requestFullRefund.'
      );
    }
    return instance;
  }

  async function claimRequest({ operation, state, actor, reason }) {
    const requestId = reversalRequestId({
      operation,
      transactionId: state.transactionId
    });
    const ref = db.doc(`${REVERSAL_REQUESTS_COLLECTION}/${requestId}`);
    const now = timestamp();

    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const existing = snap.data() || {};
        if (
          existing.operation !== operation ||
          existing.orderId !== state.orderId ||
          existing.transactionId !== state.transactionId ||
          existing.providerPaymentId !== state.transaction.providerPaymentId
        ) {
          throw new FinancialReversalAdminServiceError(
            'REVERSAL_REQUEST_IDENTITY_MISMATCH',
            'Solicitação de reversão existente possui identidade divergente.'
          );
        }
        return { created: false, requestId, request: existing };
      }

      const request = {
        operation,
        orderId: state.orderId,
        transactionId: state.transactionId,
        provider: 'asaas',
        providerPaymentId: state.transaction.providerPaymentId,
        status: 'executing',
        reason,
        createdBy: actor.uid,
        actorRole: actor.role,
        providerResultStatus: null,
        errorCode: null,
        createdAt: now,
        updatedAt: now,
        providerCompletedAt: null
      };
      tx.create(ref, request);
      return { created: true, requestId, request };
    });
  }

  async function finalizeSuccess({ requestId, operation, actor, state, providerResult }) {
    const ref = db.doc(`${REVERSAL_REQUESTS_COLLECTION}/${requestId}`);
    const now = timestamp();
    const resultStatus = String(providerResult?.status || '').trim().toUpperCase() || null;

    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new FinancialReversalAdminServiceError(
          'REVERSAL_REQUEST_NOT_FOUND',
          'Solicitação administrativa desapareceu durante a operação.'
        );
      }
      const current = snap.data() || {};
      if (current.status === 'awaiting_webhook') return current;
      if (current.status !== 'executing') {
        throw new FinancialReversalAdminServiceError(
          'REVERSAL_REQUEST_STATE_INVALID',
          'Solicitação administrativa não está em execução.'
        );
      }

      const updated = {
        ...current,
        status: 'awaiting_webhook',
        providerResultStatus: resultStatus,
        errorCode: null,
        updatedAt: now,
        providerCompletedAt: now
      };
      tx.set(ref, updated);
      tx.create(db.collection('audit_logs').doc(), {
        actorId: actor.uid,
        actorRole: actor.role,
        action: operation === 'cancel_pending'
          ? 'financial.reversal.cancel_requested'
          : 'financial.reversal.refund_requested',
        entityType: 'payment_transaction',
        entityId: state.transactionId,
        before: {
          orderStatus: state.order.status,
          transactionStatus: state.transaction.status
        },
        after: {
          requestStatus: 'awaiting_webhook',
          canonicalMutationPerformed: false
        },
        source: 'service',
        requestId,
        createdAt: now
      });
      return updated;
    });
  }

  async function finalizeFailure(requestId, error) {
    const ref = db.doc(`${REVERSAL_REQUESTS_COLLECTION}/${requestId}`);
    const now = timestamp();
    const statusCode = Number(error?.response?.status || 0);
    const safelyRejected = statusCode >= 400 && statusCode < 500;
    const status = safelyRejected ? 'provider_rejected' : 'needs_reconciliation';
    const errorCode = safelyRejected
      ? 'REVERSAL_PROVIDER_REJECTED'
      : 'REVERSAL_PROVIDER_RESULT_UNKNOWN';

    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const current = snap.data() || {};
      if (current.status !== 'executing') return;
      tx.update(ref, {
        status,
        errorCode,
        updatedAt: now
      });
    });

    throw new FinancialReversalAdminServiceError(
      errorCode,
      safelyRejected
        ? 'O provedor rejeitou a operação financeira.'
        : 'Resultado da operação no provedor é inconclusivo e exige reconciliação.'
    );
  }

  function existingRequestResult(claim) {
    const status = claim.request.status;
    if (['provider_rejected', 'needs_reconciliation'].includes(status)) {
      throw new FinancialReversalAdminServiceError(
        'REVERSAL_REQUEST_REQUIRES_RECONCILIATION',
        'Já existe solicitação que exige reconciliação antes de nova tentativa.'
      );
    }
    return requestView(claim.requestId, claim.request, { idempotent: true });
  }

  async function requestOperation({ operation, actorId, claims, data = {} }) {
    const actor = actorContext({ actorId, claims });
    const reason = requireReason(data.reason);
    const state = await loadCanonicalState(data.orderId);
    assertOperationState(operation, state);

    const api = provider();
    const providerPayment = assertProviderPayment(
      operation,
      state,
      await api.getPaymentById(state.transaction.providerPaymentId)
    );

    const claim = await claimRequest({ operation, state, actor, reason });
    if (!claim.created) return existingRequestResult(claim);

    let providerResult;
    try {
      providerResult = operation === 'cancel_pending'
        ? await api.deletePendingPayment(providerPayment.id)
        : await api.requestFullRefund(providerPayment.id, { description: reason });
    } catch (error) {
      return finalizeFailure(claim.requestId, error);
    }

    const completed = await finalizeSuccess({
      requestId: claim.requestId,
      operation,
      actor,
      state,
      providerResult
    });
    return requestView(claim.requestId, completed, { idempotent: false });
  }

  return {
    cancelPendingPayment(input = {}) {
      return requestOperation({
        operation: 'cancel_pending',
        actorId: input.actorId,
        claims: input.claims,
        data: input.data
      });
    },
    requestFullRefund(input = {}) {
      return requestOperation({
        operation: 'refund_full',
        actorId: input.actorId,
        claims: input.claims,
        data: input.data
      });
    }
  };
}

module.exports = {
  REVERSAL_REQUESTS_COLLECTION,
  REVERSAL_OPERATIONS,
  FinancialReversalAdminServiceError,
  reversalRequestId,
  normalizeProviderPayment,
  createFinancialReversalAdminService
};
