'use strict';

const assert = require('node:assert/strict');

const {
  ASAAS_SANDBOX_BASE_URL,
  createAsaasCheckoutProviderFactory
} = require('../src/finance/asaas-checkout-provider-factory');

let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function emulatorEnv(overrides = {}) {
  return {
    FUNCTIONS_EMULATOR: 'true',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    BJJ_EXAMS_CHECKOUT_PROVIDER_FAKE: 'true',
    ...overrides
  };
}

(async () => {
  await test('fake provider funciona somente em demo emulator', async () => {
    let secretReads = 0;
    const factory = createAsaasCheckoutProviderFactory({
      environment: 'sandbox',
      projectId: 'demo-bjj-exams-checkout',
      env: emulatorEnv(),
      httpLibrary: null,
      apiKeyResolver: () => { secretReads += 1; return 'never'; }
    });
    const provider = factory();
    const customer = await provider.createCustomer({
      externalReference: 'BJJEX-V12-CUSTOMER-test',
      name: 'Aluno',
      cpfCnpj: '12345678901'
    });
    assert.ok(customer.id.startsWith('cus_fake_'));
    assert.equal(typeof provider.deletePendingPayment, 'function');
    assert.equal(typeof provider.requestFullRefund, 'function');
    assert.equal(secretReads, 0);
  });

  await test('fake provider é bloqueado fora de projeto demo', async () => {
    const factory = createAsaasCheckoutProviderFactory({
      environment: 'sandbox',
      projectId: 'bjj-exams-staging',
      env: emulatorEnv()
    });
    assert.throws(() => factory(), /Fake Asaas checkout provider/);
  });

  await test('fake provider é bloqueado sem Functions Emulator', async () => {
    const factory = createAsaasCheckoutProviderFactory({
      environment: 'sandbox',
      projectId: 'demo-bjj-exams-checkout',
      env: emulatorEnv({ FUNCTIONS_EMULATOR: 'false' })
    });
    assert.throws(() => factory(), /Fake Asaas checkout provider/);
  });

  await test('produção real falha antes de ler segredo', async () => {
    let secretReads = 0;
    const factory = createAsaasCheckoutProviderFactory({
      environment: 'production',
      projectId: 'bjj-exams',
      env: {},
      httpLibrary: { create() { throw new Error('nao deve chamar'); } },
      apiKeyResolver: () => { secretReads += 1; return '$aact_prod_fake'; }
    });
    assert.throws(() => factory(), /sandbox-only/);
    assert.equal(secretReads, 0);
  });

  await test('staging real usa base URL sandbox e expõe checkout e reversão', async () => {
    let config = null;
    const http = {
      async get() { return { data: { data: [] } }; },
      async post() { return { data: {} }; },
      async delete() { return { data: {} }; }
    };
    const factory = createAsaasCheckoutProviderFactory({
      environment: 'sandbox',
      projectId: 'bjj-exams-staging',
      env: {},
      httpLibrary: {
        create(value) { config = value; return http; }
      },
      apiKeyResolver: () => '$aact_hmlg_fake_key_for_test'
    });
    const provider = factory();
    assert.ok(provider);
    assert.equal(typeof provider.createPixPayment, 'function');
    assert.equal(typeof provider.deletePendingPayment, 'function');
    assert.equal(typeof provider.requestFullRefund, 'function');
    assert.equal(config.baseURL, ASAAS_SANDBOX_BASE_URL);
    assert.equal(config.headers.access_token, '$aact_hmlg_fake_key_for_test');
  });

  console.log(`ASAAS_CHECKOUT_PROVIDER_FACTORY_V1_2=${passed}/5`);
  if (passed !== 5) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
