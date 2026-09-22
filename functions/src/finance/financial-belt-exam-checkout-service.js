'use strict';

const {
  createFinancialCourseCheckoutService
} = require('./financial-course-checkout-service');
const {
  createFinancialCheckoutProviderState
} = require('./financial-checkout-provider-state');
const {
  createFinancialBeltExamCheckoutPersistence
} = require('./financial-belt-exam-checkout-persistence');

class FinancialBeltExamCheckoutServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialBeltExamCheckoutServiceError';
    this.code = code;
  }
}

function assertProvider(provider) {
  const requiredMethods = [
    'findCustomerByExternalReference',
    'createCustomer',
    'findPaymentByExternalReference',
    'createPixPayment',
    'getPixQrCode'
  ];
  for (const method of requiredMethods) {
    if (typeof provider?.[method] !== 'function') {
      throw new TypeError(`Checkout de exame exige provider.${method}().`);
    }
  }
}

function createFinancialBeltExamCheckoutService(dependencies = {}) {
  const {
    db,
    provider,
    environment = 'sandbox',
    clock = () => new Date(),
    dueDateFactory
  } = dependencies;

  assertProvider(provider);
  if (String(environment || '').trim().toLowerCase() !== 'sandbox') {
    throw new FinancialBeltExamCheckoutServiceError(
      'BELT_EXAM_CHECKOUT_SANDBOX_ONLY',
      'Checkout de exame está disponível somente em sandbox neste marco.'
    );
  }

  const persistence = createFinancialBeltExamCheckoutPersistence({
    db,
    environment,
    provider: 'asaas',
    clock
  });
  const providerState = createFinancialCheckoutProviderState({
    db,
    provider: 'asaas',
    environment,
    clock
  });

  const persistenceAdapter = {
    acquireProviderCustomerLease: persistence.acquireProviderCustomerLease,
    completeProviderCustomerBinding: persistence.completeProviderCustomerBinding,
    releaseProviderCustomerLease: persistence.releaseProviderCustomerLease,
    releaseCheckoutLease: persistence.releaseCheckoutLease,
    prepareCourseCheckout: ({ buyerUserId, courseId, idempotencyKey }) =>
      persistence.prepareBeltExamCheckout({
        buyerUserId,
        sessionId: courseId,
        idempotencyKey
      })
  };

  const providerAdapter = {
    ...provider,
    createPixPayment: request => provider.createPixPayment({
      ...request,
      description: 'BJJ Exams - exame oficial de faixa'
    })
  };

  const runner = createFinancialCourseCheckoutService({
    db,
    provider: providerAdapter,
    environment,
    clock,
    dueDateFactory,
    persistence: persistenceAdapter,
    providerState
  });

  async function startBeltExamCheckout(input = {}) {
    return runner.startCourseCheckout({
      buyerUserId: input.buyerUserId,
      courseId: input.sessionId,
      idempotencyKey: input.idempotencyKey
    });
  }

  return {
    startBeltExamCheckout
  };
}

module.exports = {
  FinancialBeltExamCheckoutServiceError,
  createFinancialBeltExamCheckoutService
};
