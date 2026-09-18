'use strict';

const assert = require('node:assert/strict');

const {
  AsaasCheckoutAdapterError,
  buildAsaasCustomerRequest,
  createAsaasCheckoutAdapter
} = require('../src/finance/asaas-checkout-adapter');

let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function fakeHttp({ rows = [], created = null } = {}) {
  const calls = [];
  return {
    calls,
    async get(path, config) {
      calls.push({ method: 'GET', path, config });
      return { data: { data: rows } };
    },
    async post(path, body) {
      calls.push({ method: 'POST', path, body });
      return { data: created || { id: 'cus_1', ...body } };
    }
  };
}

(async () => {
  await test('customer request usa somente perfil canonico normalizado', async () => {
    const request = buildAsaasCustomerRequest({
      profile: {
        nome: 'Aluno Teste',
        email: 'aluno@example.test',
        cpf: '123.456.789-01',
        telefone: '(61) 99999-0000',
        walletId: 'nao-deve-vazar'
      },
      externalReference: 'BJJEX-V12-CUSTOMER-abc'
    });
    assert.deepEqual(request, {
      name: 'Aluno Teste',
      cpfCnpj: '12345678901',
      externalReference: 'BJJEX-V12-CUSTOMER-abc',
      email: 'aluno@example.test',
      mobilePhone: '61999990000'
    });
  });

  await test('customer request exige CPF ou CNPJ canonico', async () => {
    assert.throws(
      () => buildAsaasCustomerRequest({
        profile: { nome: 'Aluno Sem CPF' },
        externalReference: 'BJJEX-V12-CUSTOMER-def'
      }),
      error => error instanceof AsaasCheckoutAdapterError &&
        error.code === 'ASAAS_CUSTOMER_DOCUMENT_REQUIRED'
    );
  });

  await test('reconciliacao de customer usa externalReference e limit 2', async () => {
    const http = fakeHttp({ rows: [{ id: 'cus_existing' }] });
    const adapter = createAsaasCheckoutAdapter({ http, environment: 'sandbox' });
    const customer = await adapter.findCustomerByExternalReference('BJJEX-V12-CUSTOMER-xyz');
    assert.equal(customer.id, 'cus_existing');
    assert.equal(http.calls[0].path, '/customers');
    assert.deepEqual(http.calls[0].config.params, {
      externalReference: 'BJJEX-V12-CUSTOMER-xyz',
      offset: 0,
      limit: 2
    });
  });

  await test('customer externalReference duplicada falha fechado', async () => {
    const http = fakeHttp({ rows: [{ id: 'cus_a' }, { id: 'cus_b' }] });
    const adapter = createAsaasCheckoutAdapter({ http, environment: 'sandbox' });
    await assert.rejects(
      adapter.findCustomerByExternalReference('BJJEX-V12-CUSTOMER-dup'),
      error => error instanceof AsaasCheckoutAdapterError &&
        error.code === 'AMBIGUOUS_ASAAS_CUSTOMER_EXTERNAL_REFERENCE'
    );
  });

  await test('criacao de customer usa endpoint canonico', async () => {
    const http = fakeHttp({ created: { id: 'cus_created' } });
    const adapter = createAsaasCheckoutAdapter({ http, environment: 'sandbox' });
    const result = await adapter.createCustomer({
      name: 'Aluno',
      cpfCnpj: '12345678901',
      externalReference: 'BJJEX-V12-CUSTOMER-new'
    });
    assert.equal(result.id, 'cus_created');
    assert.equal(http.calls[0].method, 'POST');
    assert.equal(http.calls[0].path, '/customers');
  });

  await test('adapter customer continua sandbox-only', async () => {
    assert.throws(
      () => createAsaasCheckoutAdapter({
        http: fakeHttp(),
        environment: 'production'
      }),
      error => error instanceof AsaasCheckoutAdapterError &&
        error.code === 'ASAAS_CHECKOUT_SANDBOX_ONLY'
    );
  });

  console.log(`ASAAS_CHECKOUT_CUSTOMER_V1_2=${passed}/6`);
  if (passed !== 6) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});