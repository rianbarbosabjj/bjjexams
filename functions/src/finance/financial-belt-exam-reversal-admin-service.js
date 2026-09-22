'use strict';

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
  REVERSAL_REQUESTS_COLLECTION,
  reversalRequestId
} = require('./financial-reversal-admin-service');
const {
  FinancialBeltExamReversalStateDomainError,
  validateCanonicalBeltExamFinancialPair,
  validateCanonicalBeltExamRegistration,
  hasAcademicState
} = require('./financial-belt-exam-reversal-state-domain');
const {
  examRegistrationDocumentId
} = require('../exams/exam-registration-domain');

class FinancialBeltExamReversalAdminServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialBeltExamReversalAdminServiceError';
    this.code = code;
  }
}

function text(value, max = 300) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function requireIdentifier(value, field) {
  const normalized = text(value, 200);
  if (!normalized || normalized.includes('/')) {
    throw new FinancialBeltExamReversalAdminServiceError(
      'INVALID_REVERSAL_ADMIN_ID',
      `${field} inválido.`
    );
  }
  return normalized;
}

function requireReason(value) {
  const reason = text(value, 300);
  if (!reason || reason.length < 5) {
    throw new FinancialBeltExamReversalAdminServiceError(
      'REVERSAL_REASON_REQUIRED',
      'Operação financeira exige justificativa com pelo menos 5 caracteres.'
    );
  }
  return reason;
}

function providerCustomerId(payment = {}) {
  if (typeof payment.customer === 'string') return payment.customer.trim();
  return String(payment.customer?.id || '').trim();
}

function normalizeProviderPayment(payment = {}) {
  if (!payment || typeof payment !== 'object') {
    throw new FinancialBeltExamReversalAdminServiceError(
      'REVERSAL_PROVIDER_PAYMENT_REQUIRED',
      'Cobrança do provedor não foi encontrada.'
    );
  }

  let valueCents;
  try {
    valueCents = providerMoneyToCents(payment.value, 'provider.value');
  } catch (_error) {
    throw new FinancialBeltExamReversalAdminServiceError(
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
    productType: request.productType || 'belt_exam',
    registrationId: request.registrationId || null,
    status: request.status || null,
    awaitingWebhook: request.status === 'awaiting_webhook',
    inProgress: request.status === 'executing',
    idempotent: idempotent === true
  };
}

function createFinancialBeltExamReversalAdminService(dependencies = {}) {
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
    throw new TypeError('Belt exam reversal admin service exige Firestore válido.');
  }
  if (typeof providerFactory !== 'function') {
    throw new TypeError('Belt exam reversal admin service exige providerFactory().');
  }

  const canonicalEnvironment = String(environment || '').trim().toLowerCase();
  if (canonicalEnvironment !== 'sandbox') {
    throw new FinancialBeltExamReversalAdminServiceError(
      'REVERSAL_ADMIN_SANDBOX_ONLY',
      'Operações administrativas de exame estão bloqueadas fora do sandbox.'
    );
  }

  function timestamp() {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new FinancialBeltExamReversalAdminServiceError(
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
        throw new FinancialBeltExamReversalAdminServiceError(
          error.code,
          error.message
        );
      }
      throw error;
    }
  }

  async function loadCanonicalState(orderIdInput) {
    const orderId = requireIdentifier(orderIdInput, 'orderId');
    const orderRef = db.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new FinancialBeltExamReversalAdminServiceError(
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
      throw new FinancialBeltExamReversalAdminServiceError(
        'REVERSAL_TRANSACTION_NOT_FOUND',
        'Transação financeira não encontrada.'
      );
    }

    let canonical;
    try {
      canonical = validateCanonicalBeltExamFinancialPair({
        orderId,
        order: rawOrder,
        transactionId,
        transaction: transactionSnap.data() || {}
      });
    } catch (error) {
      if (error instanceof FinancialBeltExamReversalStateDomainError) {
        throw new FinancialBeltExamReversalAdminServiceError(
          'BELT_EXAM_REVERSAL_CANONICAL_STATE_INVALID',
          'Pedido e transação do exame possuem estado canônico incompatível.'
        );
      }
      throw error;
    }

    const registrationId = examRegistrationDocumentId({
      sessionId: canonical.order.productId,
      studentId: canonical.order.buyerUserId
    });
    const registrationSnap = await db.doc(
      `exam_registrations/${registrationId}`
    ).get();
    if (!registrationSnap.exists) {
      throw new FinancialBeltExamReversalAdminServiceError(
        'BELT_EXAM_REVERSAL_REGISTRATION_REQUIRED',
        'Operação financeira do exame exige registration canônica.'
      );
    }

    let registration;
    try {
      registration = validateCanonicalBeltExamRegistration({
        orderId,
        order: canonical.order,
        registration: registrationSnap.data() || {}
      });
    } catch (error) {
      if (error instanceof FinancialBeltExamReversalStateDomainError) {
        throw new FinancialBeltExamReversalAdminServiceError(
          'BELT_EXAM_REVERSAL_REGISTRATION_INVALID',
          'Registration não corresponde ao pedido financeiro do exame.'
        );
      }
      throw error;
    }

    return {
      orderId,
      transactionId,
      order: canonical.order,
      transaction: canonical.transaction,
      registrationId,
      registration
    };
  }

  function assertOperationState(operation, state) {
    const { order, transaction, registration } = state;

    if (!transaction.providerPaymentId) {
      throw new FinancialBeltExamReversalAdminServiceError(
        'REVERSAL_PROVIDER_PAYMENT_ID_REQUIRED',
        'Transação não possui cobrança Asaas vinculada.'
      );
    }

    if (operation === 'cancel_pending') {
      if (order.status !== 'pending_payment' || transaction.status !== 'pending') {
        throw new FinancialBeltExamReversalAdminServiceError(
          'BELT_EXAM_ADMIN_PENDING_STATE_REQUIRED',
          'Cancelamento do exame exige pedido e transação ainda pendentes.'
        );
      }
      if (
        registration.status !== 'awaiting_payment' ||
        registration.orderId !== state.orderId ||
        hasAcademicState(registration)
      ) {
        throw new FinancialBeltExamReversalAdminServiceError(
          'BELT_EXAM_ADMIN_PENDING_REGISTRATION_REQUIRED',
          'Cancelamento pending exige registration awaiting_payment sem atividade acadêmica.'
        );
      }
      return;
    }

    if (order.status !== 'paid' || transaction.status !== 'paid') {
      throw new FinancialBeltExamReversalAdminServiceError(
        'BELT_EXAM_ADMIN_REFUND_PAID_STATE_REQUIRED',
        'Estorno integral do exame exige pedido e transação pagos.'
      );
    }

    if (hasAcademicState(registration)) {
      throw new FinancialBeltExamReversalAdminServiceError(
        'BELT_EXAM_ADMIN_REFUND_ACADEMIC_ACTIVITY',
        'Exame já iniciado possui atividade acadêmica e exige reconciliação manual antes de qualquer estorno.'
      );
    }

    if (
      registration.status !== 'authorized' ||
      registration.orderId !== state.orderId
    ) {
      throw new FinancialBeltExamReversalAdminServiceError(
        'BELT_EXAM_ADMIN_REFUND_REGISTRATION_STATE_REQUIRED',
        'Estorno integral exige registration authorized do mesmo pedido.'
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
      throw new FinancialBeltExamReversalAdminServiceError(
        'REVERSAL_PROVIDER_IDENTITY_MISMATCH',
        'Cobrança Asaas não corresponde ao estado financeiro canônico do exame.'
      );
    }

    const allowedStatuses = operation === 'cancel_pending'
      ? ['PENDING']
      : ['CONFIRMED', 'RECEIVED'];
    if (!allowedStatuses.includes(payment.status)) {
      throw new FinancialBeltExamReversalAdminServiceError(
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
        'Provider de reversão de exame exige getPaymentById/deletePendingPayment/requestFullRefund.'
      );
    }
    return instance;
  }

  function assertExistingRequestIdentity(request, operation, state) {
    if (
      request.operation !== operation ||
      request.orderId !== state.orderId ||
      request.transactionId !== state.transactionId ||
      request.provider !== 'asaas' ||
      request.providerPaymentId !== state.transaction.providerPaymentId ||
      request.productType !== 'belt_exam' ||
      request.registrationId !== state.registrationId
    ) {
      throw new FinancialBeltExamReversalAdminServiceError(
        'REVERSAL_REQUEST_IDENTITY_MISMATCH',
        'Solicitação de reversão existente possui identidade divergente.'
      );
    }
  }

  function existingRequestResult(requestId, request) {
    const status = request.status;
    if (['provider_rejected', 'needs_reconciliation'].includes(status)) {
      throw new FinancialBeltExamReversalAdminServiceError(
        'REVERSAL_REQUEST_REQUIRES_RECONCILIATION',
        'Já existe solicitação que exige reconciliação antes de nova tentativa.'
      );
    }
    return requestView(requestId, request, { idempotent: true });
  }

  async function readExistingRequest(operation, state) {
    const requestId = reversalRequestId({
      operation,
      transactionId: state.transactionId
    });
    const snap = await db.doc(
      `${REVERSAL_REQUESTS_COLLECTION}/${requestId}`
    ).get();
    if (!snap.exists) return null;
    const request = snap.data() || {};
    assertExistingRequestIdentity(request, operation, state);
    return { requestId, request };
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
        const request = snap.data() || {};
        assertExistingRequestIdentity(request, operation, state);
        return { created: false, requestId, request };
      }

      const request = {
        operation,
        orderId: state.orderId,
        transactionId: state.transactionId,
        productType: 'belt_exam',
        registrationId: state.registrationId,
        provider: 'asaas',
        providerPaymentId: state.transaction.providerPaymentId,
        status: 'executing',
        reason,
        createdBy: actor.uid,
        actorRole: actor.role,
        providerResultStatus: null,
        providerLifecycleStatus: null,
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
        throw new FinancialBeltExamReversalAdminServiceError(
          'REVERSAL_REQUEST_NOT_FOUND',
          'Solicitação administrativa desapareceu durante a operação.'
        );
      }
      const current = snap.data() || {};
      assertExistingRequestIdentity(current, operation, state);
      if (current.status === 'awaiting_webhook') return current;
      if (current.status !== 'executing') {
        throw new FinancialBeltExamReversalAdminServiceError(
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
          ? 'financial.belt_exam.reversal.cancel_requested'
          : 'financial.belt_exam.reversal.refund_requested',
        entityType: 'exam_registration',
        entityId: state.registrationId,
        before: {
          orderStatus: state.order.status,
          transactionStatus: state.transaction.status,
          registrationStatus: state.registration.status
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

    throw new FinancialBeltExamReversalAdminServiceError(
      errorCode,
      safelyRejected
        ? 'O provedor rejeitou a operação financeira do exame.'
        : 'Resultado da operação no provedor é inconclusivo e exige reconciliação.'
    );
  }

  async function requestOperation({ operation, actorId, claims, data = {} }) {
    const actor = actorContext({ actorId, claims });
    const reason = requireReason(data.reason);
    const state = await loadCanonicalState(data.orderId);
    assertOperationState(operation, state);

    const existing = await readExistingRequest(operation, state);
    if (existing) {
      return existingRequestResult(existing.requestId, existing.request);
    }

    const api = provider();
    const providerPayment = assertProviderPayment(
      operation,
      state,
      await api.getPaymentById(state.transaction.providerPaymentId)
    );

    const claim = await claimRequest({ operation, state, actor, reason });
    if (!claim.created) {
      return existingRequestResult(claim.requestId, claim.request);
    }

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
  FinancialBeltExamReversalAdminServiceError,
  normalizeProviderPayment,
  requestView,
  createFinancialBeltExamReversalAdminService
};
