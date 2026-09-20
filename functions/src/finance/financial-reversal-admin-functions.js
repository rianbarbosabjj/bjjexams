'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');

const {
  FinancialReversalAdminServiceError,
  createFinancialReversalAdminService
} = require('./financial-reversal-admin-service');
const {
  FinancialBeltExamReversalAdminServiceError,
  createFinancialBeltExamReversalAdminService
} = require('./financial-belt-exam-reversal-admin-service');
const {
  AsaasReversalAdapterError
} = require('./asaas-reversal-adapter');

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError(
      'unauthenticated',
      'Faça login para continuar.'
    );
  }
  return {
    actorId: uid,
    claims: request.auth?.token || {}
  };
}

function assertOnlyFields(data, allowedFields) {
  const input = data && typeof data === 'object' && !Array.isArray(data)
    ? data
    : {};
  const allowed = new Set(allowedFields);
  const forbidden = Object.keys(input).filter(key => !allowed.has(key));
  if (forbidden.length) {
    throw new HttpsError(
      'invalid-argument',
      'A solicitação contém campos não permitidos.',
      { forbiddenFields: forbidden }
    );
  }
  return input;
}

function mapReversalAdminError(error) {
  if (error instanceof HttpsError) throw error;

  const known =
    error instanceof FinancialReversalAdminServiceError ||
    error instanceof FinancialBeltExamReversalAdminServiceError ||
    error instanceof AsaasReversalAdapterError;

  if (!known) {
    throw new HttpsError(
      'unavailable',
      'Não foi possível processar a operação financeira agora.'
    );
  }

  const code = String(error.code || 'REVERSAL_ADMIN_ERROR');

  if (code === 'FINANCIAL_ADMIN_PERMISSION_REQUIRED') {
    throw new HttpsError(
      'permission-denied',
      'Você não possui permissão para operar reversões financeiras.',
      { domainCode: code }
    );
  }

  if (['REVERSAL_ORDER_NOT_FOUND', 'REVERSAL_TRANSACTION_NOT_FOUND'].includes(code)) {
    throw new HttpsError('not-found', error.message, { domainCode: code });
  }

  const invalidArgument = new Set([
    'INVALID_REVERSAL_ADMIN_ID',
    'REVERSAL_REASON_REQUIRED',
    'INVALID_ASAAS_REVERSAL_IDENTIFIER',
    'INVALID_ASAAS_REVERSAL_DESCRIPTION'
  ]);
  if (invalidArgument.has(code)) {
    throw new HttpsError('invalid-argument', error.message, { domainCode: code });
  }

  const failedPrecondition = new Set([
    'REVERSAL_ADMIN_SANDBOX_ONLY',
    'REVERSAL_PROVIDER_PAYMENT_ID_REQUIRED',
    'REVERSAL_PENDING_STATE_REQUIRED',
    'REVERSAL_PENDING_HAS_ENROLLMENT',
    'REVERSAL_PAID_STATE_REQUIRED',
    'REVERSAL_PAID_ENROLLMENT_REQUIRED',
    'REVERSAL_PROVIDER_PAYMENT_REQUIRED',
    'REVERSAL_PROVIDER_PAYMENT_INVALID',
    'REVERSAL_PROVIDER_IDENTITY_MISMATCH',
    'REVERSAL_PROVIDER_STATUS_INVALID',
    'REVERSAL_CANONICAL_STATE_INVALID',
    'REVERSAL_ENROLLMENT_STATE_INVALID',
    'REVERSAL_REQUEST_IDENTITY_MISMATCH',
    'REVERSAL_REQUEST_STATE_INVALID',
    'REVERSAL_REQUEST_REQUIRES_RECONCILIATION',
    'REVERSAL_PROVIDER_REJECTED',
    'ASAAS_REVERSAL_SANDBOX_ONLY',
    'BELT_EXAM_REVERSAL_CANONICAL_STATE_INVALID',
    'BELT_EXAM_REVERSAL_REGISTRATION_REQUIRED',
    'BELT_EXAM_REVERSAL_REGISTRATION_INVALID',
    'BELT_EXAM_ADMIN_PENDING_STATE_REQUIRED',
    'BELT_EXAM_ADMIN_PENDING_REGISTRATION_REQUIRED',
    'BELT_EXAM_ADMIN_REFUND_PAID_STATE_REQUIRED',
    'BELT_EXAM_ADMIN_REFUND_REGISTRATION_STATE_REQUIRED',
    'BELT_EXAM_ADMIN_REFUND_ACADEMIC_ACTIVITY'
  ]);
  if (failedPrecondition.has(code)) {
    throw new HttpsError('failed-precondition', error.message, { domainCode: code });
  }

  if (code === 'REVERSAL_PROVIDER_RESULT_UNKNOWN') {
    throw new HttpsError(
      'unavailable',
      error.message,
      { domainCode: code }
    );
  }

  throw new HttpsError(
    'internal',
    'Não foi possível processar a operação financeira.',
    { domainCode: code }
  );
}

function createFinancialReversalAdminFunctions(dependencies = {}) {
  const {
    REGION,
    db,
    environment,
    providerFactory,
    secrets = [],
    clock = () => new Date()
  } = dependencies;

  if (!REGION || !db || typeof providerFactory !== 'function') {
    throw new Error(
      'Financial reversal admin functions: infraestrutura obrigatória ausente.'
    );
  }

  const courseService = createFinancialReversalAdminService({
    db,
    providerFactory,
    environment,
    clock
  });
  const beltExamService = createFinancialBeltExamReversalAdminService({
    db,
    providerFactory,
    environment,
    clock
  });

  async function invoke(request, operation) {
    const auth = requireAuth(request);
    try {
      return await operation(auth);
    } catch (error) {
      mapReversalAdminError(error);
    }
  }

  async function serviceForOrder(orderIdInput) {
    const orderId = String(orderIdInput || '').trim();
    if (!orderId || orderId.includes('/')) return courseService;

    const snap = await db.doc(`orders/${orderId}`).get();
    if (!snap.exists) return courseService;
    return String(snap.data()?.productType || '').trim().toLowerCase() === 'belt_exam'
      ? beltExamService
      : courseService;
  }

  const cancelarCobrancaPendenteV12 = onCall(
    { region: REGION, secrets },
    async request => {
      const data = assertOnlyFields(request.data, ['orderId', 'reason']);
      return invoke(request, async auth => {
        const service = await serviceForOrder(data.orderId);
        return {
          ok: true,
          ...await service.cancelPendingPayment({
            ...auth,
            data
          })
        };
      });
    }
  );

  const solicitarEstornoIntegralV12 = onCall(
    { region: REGION, secrets },
    async request => {
      const data = assertOnlyFields(request.data, ['orderId', 'reason']);
      return invoke(request, async auth => {
        const service = await serviceForOrder(data.orderId);
        return {
          ok: true,
          ...await service.requestFullRefund({
            ...auth,
            data
          })
        };
      });
    }
  );

  return {
    cancelarCobrancaPendenteV12,
    solicitarEstornoIntegralV12
  };
}

module.exports = {
  requireAuth,
  assertOnlyFields,
  mapReversalAdminError,
  createFinancialReversalAdminFunctions
};
