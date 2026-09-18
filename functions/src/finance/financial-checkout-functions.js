'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');

const {
  FinancialDomainError
} = require('./financial-domain');
const {
  FinancialOrderServiceError
} = require('./financial-order-service');
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
  FinancialCourseCheckoutServiceError,
  createFinancialCourseCheckoutService
} = require('./financial-course-checkout-service');

function assertOnlyFields(data, allowed) {
  const forbidden = Object.keys(data || {})
    .filter(key => !allowed.includes(key));
  if (forbidden.length) {
    throw new HttpsError(
      'invalid-argument',
      'Payload contém campos não permitidos.',
      { forbiddenFields: forbidden }
    );
  }
}

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError(
      'unauthenticated',
      'Faça login para iniciar o checkout.'
    );
  }
  return uid;
}

function mapCheckoutError(error) {
  if (error instanceof HttpsError) throw error;

  const known =
    error instanceof FinancialDomainError ||
    error instanceof FinancialOrderServiceError ||
    error instanceof AsaasCheckoutAdapterError ||
    error instanceof FinancialCheckoutPersistenceError ||
    error instanceof FinancialCheckoutProviderStateError ||
    error instanceof FinancialCourseCheckoutServiceError;

  if (!known) {
    throw new HttpsError(
      'unavailable',
      'Não foi possível iniciar o pagamento agora. Tente novamente.'
    );
  }

  const code = error.code || 'CHECKOUT_ERROR';

  const notFound = new Set([
    'COURSE_NOT_FOUND'
  ]);
  const failedPrecondition = new Set([
    'COURSE_NOT_AVAILABLE',
    'COURSE_NOT_PAID',
    'COURSE_PRICE_INVALID',
    'DEFAULT_FINANCIAL_RULE_REQUIRED',
    'FINANCIAL_OVERRIDE_NOT_FOUND',
    'FINANCIAL_RULE_INACTIVE',
    'BUYER_PROFILE_REQUIRED',
    'BUYER_ACCOUNT_NOT_ACTIVE',
    'RECIPIENT_IDENTITY_REQUIRED',
    'RECIPIENT_NOT_READY_FOR_CHECKOUT',
    'ASAAS_CUSTOMER_DOCUMENT_REQUIRED',
    'CHECKOUT_SANDBOX_ONLY',
    'ASAAS_CHECKOUT_SANDBOX_ONLY',
    'AMBIGUOUS_ASAAS_EXTERNAL_REFERENCE',
    'AMBIGUOUS_ASAAS_CUSTOMER_EXTERNAL_REFERENCE',
    'PROVIDER_PAYMENT_MISMATCH',
    'PROVIDER_SPLIT_SNAPSHOT_MISMATCH'
  ]);

  const invalidArgument = new Set([
    'INVALID_ORDER_IDENTITY',
    'INVALID_IDEMPOTENCY_KEY',
    'INVALID_CHECKOUT_IDENTIFIER',
    'INVALID_ASAAS_CHECKOUT_IDENTIFIER',
    'INVALID_ASAAS_DUE_DATE'
  ]);

  if (notFound.has(code)) {
    throw new HttpsError('not-found', error.message, { domainCode: code });
  }
  if (failedPrecondition.has(code)) {
    throw new HttpsError(
      'failed-precondition',
      error.message,
      { domainCode: code }
    );
  }
  if (invalidArgument.has(code)) {
    throw new HttpsError(
      'invalid-argument',
      error.message,
      { domainCode: code }
    );
  }

  throw new HttpsError(
    'unavailable',
    'Não foi possível concluir a preparação do pagamento. Tente novamente.',
    { domainCode: code }
  );
}

function createFinancialCheckoutFunctions(dependencies = {}) {
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
      'Financial checkout functions: infraestrutura obrigatória ausente.'
    );
  }

  const iniciarCheckoutCursoV12 = onCall(
    {
      region: REGION,
      secrets
    },
    async request => {
      const uid = requireAuth(request);
      const data = request.data || {};
      assertOnlyFields(data, ['courseId', 'idempotencyKey']);

      if (String(environment || '').trim().toLowerCase() !== 'sandbox') {
        throw new HttpsError(
          'failed-precondition',
          'Checkout do Marco 5.3 está disponível apenas em sandbox.'
        );
      }

      try {
        const provider = providerFactory();
        const service = createFinancialCourseCheckoutService({
          db,
          provider,
          environment,
          clock
        });
        const result = await service.startCourseCheckout({
          buyerUserId: uid,
          courseId: data.courseId,
          idempotencyKey: data.idempotencyKey
        });

        return {
          ok: true,
          orderId: result.orderId,
          transactionId: result.transactionId,
          status: result.status,
          processing: result.processing,
          paymentId: result.paymentId,
          pix: result.pix
        };
      } catch (error) {
        mapCheckoutError(error);
      }
    }
  );

  return {
    iniciarCheckoutCursoV12
  };
}

module.exports = {
  assertOnlyFields,
  mapCheckoutError,
  createFinancialCheckoutFunctions
};