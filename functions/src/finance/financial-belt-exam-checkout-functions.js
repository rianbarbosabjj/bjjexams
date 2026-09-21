'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');

const {
  FinancialDomainError
} = require('./financial-domain');
const {
  AsaasCheckoutAdapterError
} = require('./asaas-checkout-adapter');
const {
  FinancialCheckoutPersistenceError
} = require('./financial-checkout-persistence');
const {
  FinancialCheckoutProviderStateError
} = require('./financial-checkout-provider-state');
const {
  FinancialCourseCheckoutServiceError
} = require('./financial-course-checkout-service');
const {
  FinancialBeltExamOrderServiceError
} = require('./financial-belt-exam-order-service');
const {
  FinancialBeltExamCheckoutPersistenceError
} = require('./financial-belt-exam-checkout-persistence');
const {
  FinancialBeltExamCheckoutServiceError,
  createFinancialBeltExamCheckoutService
} = require('./financial-belt-exam-checkout-service');

function assertOnlyFields(data, allowed) {
  const extra = Object.keys(data || {}).filter(field => !allowed.includes(field));
  if (extra.length) {
    throw new HttpsError(
      'invalid-argument',
      'Payload contém campos não permitidos.',
      { forbiddenFields: extra }
    );
  }
}

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Faça login para iniciar o checkout do exame.');
  }
  return uid;
}

function mapBeltExamCheckoutError(error) {
  if (error instanceof HttpsError) throw error;

  const known =
    error instanceof FinancialDomainError ||
    error instanceof AsaasCheckoutAdapterError ||
    error instanceof FinancialCheckoutPersistenceError ||
    error instanceof FinancialCheckoutProviderStateError ||
    error instanceof FinancialCourseCheckoutServiceError ||
    error instanceof FinancialBeltExamOrderServiceError ||
    error instanceof FinancialBeltExamCheckoutPersistenceError ||
    error instanceof FinancialBeltExamCheckoutServiceError;

  if (!known) {
    throw new HttpsError(
      'unavailable',
      'Não foi possível iniciar o pagamento do exame agora. Tente novamente.'
    );
  }

  const code = error.code || 'BELT_EXAM_CHECKOUT_ERROR';

  if (code === 'ASAAS_PROVIDER_REQUEST_REJECTED') {
    throw new HttpsError(
      'failed-precondition',
      'O provedor rejeitou os dados necessários para preparar o pagamento do exame.',
      { domainCode: code }
    );
  }

  if (code === 'ASAAS_PROVIDER_REQUEST_INCONCLUSIVE') {
    throw new HttpsError(
      'unavailable',
      'Não foi possível confirmar o resultado da comunicação com o provedor. Tente novamente mais tarde.',
      { domainCode: code }
    );
  }

  const notFound = new Set([
    'BELT_EXAM_SESSION_NOT_FOUND',
    'BELT_EXAM_REGISTRATION_NOT_FOUND'
  ]);
  const permissionDenied = new Set([
    'BELT_EXAM_STUDENT_MEMBERSHIP_REQUIRED'
  ]);
  const failedPrecondition = new Set([
    'BELT_EXAM_SESSION_INVALID',
    'BELT_EXAM_TEMPLATE_REQUIRED',
    'BELT_EXAM_REGISTRATION_INVALID',
    'BELT_EXAM_REGISTRATION_IDENTITY_MISMATCH',
    'BELT_EXAM_SESSION_NOT_SALEABLE',
    'BELT_EXAM_ACADEMIC_STATE_EXISTS',
    'BELT_EXAM_ORDER_NOT_RESUMABLE',
    'BELT_EXAM_ACTIVE_ORDER_CONFLICT',
    'BELT_EXAM_REGISTRATION_NOT_CHECKOUT_ELIGIBLE',
    'BELT_EXAM_ORDER_NOT_CHECKOUT_READY',
    'DEFAULT_FINANCIAL_RULE_REQUIRED',
    'FINANCIAL_OVERRIDE_NOT_FOUND',
    'FINANCIAL_RULE_INACTIVE',
    'BUYER_PROFILE_REQUIRED',
    'BUYER_ACCOUNT_NOT_ACTIVE',
    'BELT_EXAM_RECIPIENT_IDENTITY_REQUIRED',
    'BELT_EXAM_RECIPIENT_NOT_READY',
    'ASAAS_CUSTOMER_DOCUMENT_REQUIRED',
    'CHECKOUT_SANDBOX_ONLY',
    'BELT_EXAM_CHECKOUT_SANDBOX_ONLY',
    'ASAAS_CHECKOUT_SANDBOX_ONLY',
    'AMBIGUOUS_ASAAS_EXTERNAL_REFERENCE',
    'AMBIGUOUS_ASAAS_CUSTOMER_EXTERNAL_REFERENCE',
    'PROVIDER_PAYMENT_MISMATCH',
    'PROVIDER_SPLIT_SNAPSHOT_MISMATCH'
  ]);
  const invalidArgument = new Set([
    'INVALID_BELT_EXAM_ORDER_IDENTITY',
    'INVALID_BELT_EXAM_IDEMPOTENCY_KEY',
    'INVALID_BELT_EXAM_CHECKOUT_IDENTIFIER',
    'INVALID_CHECKOUT_IDENTIFIER',
    'INVALID_ASAAS_CHECKOUT_IDENTIFIER',
    'INVALID_ASAAS_DUE_DATE'
  ]);

  let httpsCode = 'unavailable';
  if (notFound.has(code)) httpsCode = 'not-found';
  else if (permissionDenied.has(code)) httpsCode = 'permission-denied';
  else if (failedPrecondition.has(code)) httpsCode = 'failed-precondition';
  else if (invalidArgument.has(code)) httpsCode = 'invalid-argument';

  const safeMessage = httpsCode === 'unavailable'
    ? 'Não foi possível concluir a preparação do pagamento do exame. Tente novamente.'
    : error.message;

  throw new HttpsError(
    httpsCode,
    safeMessage,
    { domainCode: code }
  );
}

function createFinancialBeltExamCheckoutFunctions(dependencies = {}) {
  const {
    REGION,
    db,
    environment,
    providerFactory,
    secrets = [],
    clock = () => new Date()
  } = dependencies;

  if (!REGION || !db || typeof providerFactory !== 'function') {
    throw new Error('Belt exam checkout functions: infraestrutura obrigatória ausente.');
  }

  const iniciarCheckoutExameFaixaV12 = onCall(
    {
      region: REGION,
      secrets
    },
    async request => {
      const uid = requireAuth(request);
      const data = request.data || {};
      assertOnlyFields(data, ['sessionId', 'idempotencyKey']);

      if (String(environment || '').trim().toLowerCase() !== 'sandbox') {
        throw new HttpsError(
          'failed-precondition',
          'Checkout de exame está disponível apenas em sandbox neste marco.'
        );
      }

      try {
        const provider = providerFactory();
        const service = createFinancialBeltExamCheckoutService({
          db,
          provider,
          environment,
          clock
        });
        const result = await service.startBeltExamCheckout({
          buyerUserId: uid,
          sessionId: data.sessionId,
          idempotencyKey: data.idempotencyKey
        });

        return {
          ok: true,
          orderId: result.orderId,
          transactionId: result.transactionId,
          status: result.status,
          processing: result.processing,
          pix: result.pix
        };
      } catch (error) {
        mapBeltExamCheckoutError(error);
      }
    }
  );

  return {
    iniciarCheckoutExameFaixaV12
  };
}

module.exports = {
  assertOnlyFields,
  mapBeltExamCheckoutError,
  createFinancialBeltExamCheckoutFunctions
};
