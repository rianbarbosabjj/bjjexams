'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  FinancialCheckoutPersistenceError,
  providerCustomerDocumentId,
  providerCustomerExternalReference,
  paymentTransactionId,
  createFinancialCheckoutPersistence
} = require('../src/finance/financial-checkout-persistence');

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

(async () => {
  await test('customer document id é determinístico por provider ambiente e usuário', async () => {
    const first = providerCustomerDocumentId({
      provider: 'asaas',
      environment: 'sandbox',
      userId: 'buyer-1'
    });
    const second = providerCustomerDocumentId({
      provider: 'asaas',
      environment: 'sandbox',
      userId: 'buyer-1'
    });
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
  });

  await test('customer externalReference é determinística e não expõe userId', async () => {
    const reference = providerCustomerExternalReference({
      provider: 'asaas',
      environment: 'sandbox',
      userId: 'cpf-ou-email-nao-deve-aparecer'
    });
    assert.match(reference, /^BJJEX-V12-CUSTOMER-[a-f0-9]{32}$/);
    assert.equal(reference.includes('cpf-ou-email'), false);
  });

  await test('transaction id é determinístico por order e provider', async () => {
    const first = paymentTransactionId({ provider: 'asaas', orderId: 'order-1' });
    const second = paymentTransactionId({ provider: 'asaas', orderId: 'order-1' });
    const other = paymentTransactionId({ provider: 'asaas', orderId: 'order-2' });
    assert.equal(first, second);
    assert.notEqual(first, other);
  });

  await test('produção é bloqueada antes de construir serviço', async () => {
    assert.throws(
      () => createFinancialCheckoutPersistence({
        db: {
          doc() {},
          collection() {},
          runTransaction() {}
        },
        environment: 'production'
      }),
      error =>
        error instanceof FinancialCheckoutPersistenceError &&
        error.code === 'CHECKOUT_SANDBOX_ONLY'
    );
  });

  await test('provider diferente de Asaas é bloqueado', async () => {
    assert.throws(
      () => createFinancialCheckoutPersistence({
        db: {
          doc() {},
          collection() {},
          runTransaction() {}
        },
        environment: 'sandbox',
        provider: 'other'
      }),
      error =>
        error instanceof FinancialCheckoutPersistenceError &&
        error.code === 'CHECKOUT_PROVIDER_UNSUPPORTED'
    );
  });

  await test('lease duration insegura é rejeitada', async () => {
    assert.throws(
      () => createFinancialCheckoutPersistence({
        db: {
          doc() {},
          collection() {},
          runTransaction() {}
        },
        environment: 'sandbox',
        leaseDurationMs: 999
      }),
      /leaseDurationMs/
    );
  });

  await test('identificador com slash é rejeitado antes de gerar transaction id', async () => {
    assert.throws(
      () => paymentTransactionId({ provider: 'asaas', orderId: 'bad/order' }),
      error =>
        error instanceof FinancialCheckoutPersistenceError &&
        error.code === 'INVALID_CHECKOUT_IDENTIFIER'
    );
  });

  await test('módulo de persistência não importa helper/coleções legadas nem enrollment', async () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/finance/financial-checkout-persistence.js'),
      'utf8'
    );
    for (const forbidden of [
      'asaas-helpers',
      "collection('pedidos')",
      'collection("pedidos")',
      "collection('matriculas')",
      'collection("matriculas")',
      "collection('enrollments')",
      'collection("enrollments")'
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `Dependência proibida encontrada: ${forbidden}`
      );
    }
  });

  console.log(`FINANCIAL_CHECKOUT_PERSISTENCE_V1_2=${passed}/8`);
  if (passed !== 8) process.exitCode = 1;
})();
