'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertAsaasEnvironment
} = require('../../src/config/environment');

test('staging aceita somente Sandbox', () => {
  const result = assertAsaasEnvironment({
    projectId: 'bjj-exams-staging',
    asaasEnv: 'sandbox',
    apiKey: '$aact_hmlg_TEST_ONLY'
  });

  assert.equal(result.asaasEnvironment, 'sandbox');
});

test('staging rejeita ASAAS_ENV production', () => {
  assert.throws(() => {
    assertAsaasEnvironment({
      projectId: 'bjj-exams-staging',
      asaasEnv: 'production',
      apiKey: '$aact_prod_TEST_ONLY'
    });
  });
});

test('staging rejeita chave de produção', () => {
  assert.throws(() => {
    assertAsaasEnvironment({
      projectId: 'bjj-exams-staging',
      asaasEnv: 'sandbox',
      apiKey: '$aact_prod_TEST_ONLY'
    });
  });
});

test('produção aceita somente Production', () => {
  const result = assertAsaasEnvironment({
    projectId: 'bjj-exams',
    asaasEnv: 'production',
    apiKey: '$aact_prod_TEST_ONLY'
  });

  assert.equal(result.asaasEnvironment, 'production');
});

test('produção rejeita ASAAS_ENV sandbox', () => {
  assert.throws(() => {
    assertAsaasEnvironment({
      projectId: 'bjj-exams',
      asaasEnv: 'sandbox',
      apiKey: '$aact_hmlg_TEST_ONLY'
    });
  });
});

test('produção rejeita chave Sandbox', () => {
  assert.throws(() => {
    assertAsaasEnvironment({
      projectId: 'bjj-exams',
      asaasEnv: 'production',
      apiKey: '$aact_hmlg_TEST_ONLY'
    });
  });
});

test('projeto desconhecido é bloqueado', () => {
  assert.throws(() => {
    assertAsaasEnvironment({
      projectId: 'projeto-desconhecido',
      asaasEnv: 'sandbox',
      apiKey: '$aact_hmlg_TEST_ONLY'
    });
  });
});
