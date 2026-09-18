'use strict';

const assert = require('node:assert/strict');

const {
  AsaasCheckoutAdapterError,
  createAsaasCheckoutAdapter
} = require('../src/finance/asaas-checkout-adapter');

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

function fakeHttp() {
  const calls = [];
  return {
    calls,
    async get(url, options) {
      calls.push({ method: 'get', url, options });
      return {
        data: {
          id: 'pay_reconcile_1',
          status: 'RECEIVED',
          billingType: 'PIX',
          value: 10,
          customer: 'cus_1',
          externalReference: 'BJJEX-V12-ORDER-order-1'
        }
      };
    },
    async post() {
      throw new Error('POST nao esperado neste teste.');
    }
  };
}

(async () => {
  await test('reconciliacao por id usa GET payments/{id} sem body', async () => {
    const http = fakeHttp();
    const adapter = createAsaasCheckoutAdapter({ http, environment: 'sandbox' });
    const payment = await adapter.getPaymentById('pay_reconcile_1');

    assert.equal(payment.status, 'RECEIVED');
    assert.deepEqual(http.calls, [
      {
        method: 'get',
        url: '/payments/pay_reconcile_1',
        options: undefined
      }
    ]);
  });

  await test('payment id invalido e rejeitado antes de consultar Asaas', async () => {
    const http = fakeHttp();
    const adapter = createAsaasCheckoutAdapter({ http, environment: 'sandbox' });

    await assert.rejects(
      adapter.getPaymentById('pay/invalido'),
      error => error instanceof AsaasCheckoutAdapterError &&
        error.code === 'INVALID_ASAAS_CHECKOUT_IDENTIFIER'
    );
    assert.equal(http.calls.length, 0);
  });

  console.log(`ASAAS_PAYMENT_RECONCILIATION_V1_2=${passed}/2`);
  if (passed !== 2) process.exitCode = 1;
})();
