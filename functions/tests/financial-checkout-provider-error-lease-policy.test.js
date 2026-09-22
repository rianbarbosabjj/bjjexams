'use strict';

const assert = require('node:assert/strict');

const {
  ASAAS_PROVIDER_ERROR_CLASSIFICATION,
  AsaasCheckoutAdapterError
} = require('../src/finance/asaas-checkout-adapter');

const {
  createFinancialCourseCheckoutService
} = require('../src/finance/financial-course-checkout-service');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}

function providerError(classification) {
  const definitive =
    classification ===
    ASAAS_PROVIDER_ERROR_CLASSIFICATION.DEFINITIVE;

  return new AsaasCheckoutAdapterError(
    definitive
      ? 'ASAAS_PROVIDER_REQUEST_REJECTED'
      : 'ASAAS_PROVIDER_REQUEST_INCONCLUSIVE',
    'Mensagem interna sanitizada.',
    {
      classification,
      operation: 'create_payment',
      httpStatus: definitive ? 400 : 500,
      providerCode: definitive
        ? 'invalid_fixture'
        : 'internal_error'
    }
  );
}

function financialSnapshot() {
  return {
    ruleId: 'platform-default',
    ruleVersion: 1,
    productType: 'course',
    productId: 'course-1',
    currency: 'BRL',
    grossAmountCents: 10000,
    platformFeeBps: 1000,
    platformFeeCents: 1000,
    sellerPoolCents: 9000,
    recipientMode: 'product_owner',
    recipientAllocations: [
      {
        recipientType: 'platform',
        recipientId: null,
        shareBps: 10000,
        amountCents: 9000
      }
    ],
    resolvedAt: '2026-09-21T00:00:00.000Z'
  };
}

function canonicalOrder() {
  return {
    buyerUserId: 'buyer-1',
    productType: 'course',
    productId: 'course-1',
    quantity: 1,
    amountCents: 10000,
    currency: 'BRL',
    status: 'pending_payment',
    financialSnapshot: financialSnapshot(),
    provider: null,
    providerCustomerId: null,
    currentTransactionId: 'tx-1',
    idempotencyKey: 'intent-1',
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z',
    paidAt: null,
    cancelledAt: null,
    expiredAt: null,
    refundedAt: null,
    chargebackAt: null
  };
}

function prepared({
  customerReady = true
} = {}) {
  return {
    orderId: 'order-1',
    transactionId: 'tx-1',
    order: canonicalOrder(),
    transaction: {
      providerPaymentId: null
    },
    lease: {
      processing: false,
      acquired: true,
      leaseToken: 'checkout-lease-1'
    },
    customer: customerReady
      ? {
          status: 'ready',
          providerCustomerId: 'customer-1'
        }
      : {
          status: 'pending',
          providerCustomerId: null
        },
    recipientWallets: {},
    providerSplitSnapshot: []
  };
}

function harness({
  customerReady = true,
  createCustomerError = null,
  createPaymentError = null
} = {}) {
  const counters = {
    checkoutLeaseReleases: 0,
    customerLeaseReleases: 0,
    customerCreates: 0,
    paymentCreates: 0
  };

  const preparedValue = prepared({
    customerReady
  });

  const persistence = {
    async prepareCourseCheckout() {
      return preparedValue;
    },

    async releaseCheckoutLease(input) {
      assert.equal(
        input.transactionId,
        preparedValue.transactionId
      );
      assert.equal(
        input.leaseToken,
        preparedValue.lease.leaseToken
      );

      counters.checkoutLeaseReleases += 1;
      return true;
    },

    async acquireProviderCustomerLease(input) {
      assert.equal(
        input.userId,
        preparedValue.order.buyerUserId
      );

      return {
        ready: false,
        acquired: true,
        leaseToken: 'customer-lease-1',
        externalReference: 'customer-external-ref-1'
      };
    },

    async releaseProviderCustomerLease(input) {
      assert.equal(
        input.userId,
        preparedValue.order.buyerUserId
      );
      assert.equal(
        input.leaseToken,
        'customer-lease-1'
      );

      counters.customerLeaseReleases += 1;
      return true;
    },

    async completeProviderCustomerBinding() {
      throw new Error(
        'Binding não deve ocorrer nos cenários de erro deste teste.'
      );
    }
  };

  const providerState = {
    async getBuyerProfile() {
      return {
        nome: 'Aluno Teste',
        email: 'aluno@example.test',
        cpf: '12345678909',
        telefone: '4799376637'
      };
    },

    async bindPendingProviderPayment() {
      throw new Error(
        'Pagamento não deve ser vinculado nos cenários de erro.'
      );
    }
  };

  const provider = {
    async findCustomerByExternalReference() {
      return null;
    },

    async createCustomer() {
      counters.customerCreates += 1;

      if (createCustomerError) {
        throw createCustomerError;
      }

      return {
        id: 'customer-1',
        externalReference: 'customer-external-ref-1'
      };
    },

    async findPaymentByExternalReference() {
      return null;
    },

    async createPixPayment() {
      counters.paymentCreates += 1;

      if (createPaymentError) {
        throw createPaymentError;
      }

      throw new Error(
        'createPixPayment deveria receber erro configurado no teste.'
      );
    },

    async getPixQrCode() {
      throw new Error(
        'QR Code não deve ser consultado nos cenários de erro.'
      );
    }
  };

  const service = createFinancialCourseCheckoutService({
    provider,
    environment: 'sandbox',
    persistence,
    providerState,
    clock: () => new Date('2026-09-21T00:00:00.000Z'),
    dueDateFactory: () => '2026-09-22'
  });

  return {
    service,
    counters
  };
}

(async () => {
  await test(
    'rejeicao definitiva ao criar payment libera checkout lease',
    async () => {
      const error = providerError(
        ASAAS_PROVIDER_ERROR_CLASSIFICATION.DEFINITIVE
      );

      const { service, counters } = harness({
        customerReady: true,
        createPaymentError: error
      });

      await assert.rejects(
        service.startCourseCheckout({
          buyerUserId: 'buyer-1',
          courseId: 'course-1',
          idempotencyKey: 'intent-1'
        }),
        caught => caught === error
      );

      assert.equal(counters.paymentCreates, 1);
      assert.equal(counters.checkoutLeaseReleases, 1);
      assert.equal(counters.customerLeaseReleases, 0);
    }
  );

  await test(
    'resultado inconclusivo ao criar payment preserva checkout lease',
    async () => {
      const error = providerError(
        ASAAS_PROVIDER_ERROR_CLASSIFICATION.INCONCLUSIVE
      );

      const { service, counters } = harness({
        customerReady: true,
        createPaymentError: error
      });

      await assert.rejects(
        service.startCourseCheckout({
          buyerUserId: 'buyer-1',
          courseId: 'course-1',
          idempotencyKey: 'intent-2'
        }),
        caught => caught === error
      );

      assert.equal(counters.paymentCreates, 1);
      assert.equal(counters.checkoutLeaseReleases, 0);
      assert.equal(counters.customerLeaseReleases, 0);
    }
  );

  await test(
    'rejeicao definitiva ao criar customer libera customer e checkout leases',
    async () => {
      const error = providerError(
        ASAAS_PROVIDER_ERROR_CLASSIFICATION.DEFINITIVE
      );

      const { service, counters } = harness({
        customerReady: false,
        createCustomerError: error
      });

      await assert.rejects(
        service.startCourseCheckout({
          buyerUserId: 'buyer-1',
          courseId: 'course-1',
          idempotencyKey: 'intent-3'
        }),
        caught => caught === error
      );

      assert.equal(counters.customerCreates, 1);
      assert.equal(counters.customerLeaseReleases, 1);
      assert.equal(counters.checkoutLeaseReleases, 1);
      assert.equal(counters.paymentCreates, 0);
    }
  );

  await test(
    'resultado inconclusivo ao criar customer preserva customer lease',
    async () => {
      const error = providerError(
        ASAAS_PROVIDER_ERROR_CLASSIFICATION.INCONCLUSIVE
      );

      const { service, counters } = harness({
        customerReady: false,
        createCustomerError: error
      });

      await assert.rejects(
        service.startCourseCheckout({
          buyerUserId: 'buyer-1',
          courseId: 'course-1',
          idempotencyKey: 'intent-4'
        }),
        caught => caught === error
      );

      assert.equal(counters.customerCreates, 1);
      assert.equal(counters.customerLeaseReleases, 0);

      // A checkout lease pode ser liberada: a customer lease preservada
      // impede nova criação externa até reconciliação/expiração.
      assert.equal(counters.checkoutLeaseReleases, 1);
      assert.equal(counters.paymentCreates, 0);
    }
  );

  console.log(
    `FINANCIAL_CHECKOUT_PROVIDER_ERROR_LEASE_POLICY_V1_2=${passed}/4`
  );

  if (passed !== 4) {
    process.exitCode = 1;
  }
})();