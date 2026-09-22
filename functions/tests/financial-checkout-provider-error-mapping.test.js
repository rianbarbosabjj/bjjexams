'use strict';

const assert = require('node:assert/strict');

const {
  AsaasCheckoutAdapterError,
  ASAAS_PROVIDER_ERROR_CLASSIFICATION
} = require('../src/finance/asaas-checkout-adapter');

const {
  mapCheckoutError
} = require('../src/finance/financial-checkout-functions');

const {
  mapBeltExamCheckoutError
} = require('../src/finance/financial-belt-exam-checkout-functions');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}

function capture(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('Era esperado erro.');
}

function providerError({
  code,
  classification,
  status
}) {
  return new AsaasCheckoutAdapterError(
    code,
    'Mensagem interna que nao deve chegar ao browser.',
    {
      classification,
      operation: 'create_payment',
      httpStatus: status,
      providerCode: 'provider_internal_code'
    }
  );
}

test('curso mapeia rejeicao definitiva para failed-precondition segura', () => {
  const mapped = capture(() =>
    mapCheckoutError(
      providerError({
        code: 'ASAAS_PROVIDER_REQUEST_REJECTED',
        classification:
          ASAAS_PROVIDER_ERROR_CLASSIFICATION.DEFINITIVE,
        status: 400
      })
    )
  );

  assert.equal(mapped.code, 'failed-precondition');
  assert.equal(
    mapped.details?.domainCode,
    'ASAAS_PROVIDER_REQUEST_REJECTED'
  );
  assert.equal(
    mapped.message.includes('Mensagem interna'),
    false
  );
  assert.equal(
    JSON.stringify(mapped).includes('provider_internal_code'),
    false
  );
});

test('exame mapeia rejeicao definitiva para failed-precondition segura', () => {
  const mapped = capture(() =>
    mapBeltExamCheckoutError(
      providerError({
        code: 'ASAAS_PROVIDER_REQUEST_REJECTED',
        classification:
          ASAAS_PROVIDER_ERROR_CLASSIFICATION.DEFINITIVE,
        status: 400
      })
    )
  );

  assert.equal(mapped.code, 'failed-precondition');
  assert.equal(
    mapped.details?.domainCode,
    'ASAAS_PROVIDER_REQUEST_REJECTED'
  );
  assert.equal(
    mapped.message.includes('Mensagem interna'),
    false
  );
});

test('curso mapeia resultado inconclusivo para unavailable', () => {
  const mapped = capture(() =>
    mapCheckoutError(
      providerError({
        code: 'ASAAS_PROVIDER_REQUEST_INCONCLUSIVE',
        classification:
          ASAAS_PROVIDER_ERROR_CLASSIFICATION.INCONCLUSIVE,
        status: 500
      })
    )
  );

  assert.equal(mapped.code, 'unavailable');
  assert.equal(
    mapped.details?.domainCode,
    'ASAAS_PROVIDER_REQUEST_INCONCLUSIVE'
  );
});

test('exame mapeia resultado inconclusivo para unavailable', () => {
  const mapped = capture(() =>
    mapBeltExamCheckoutError(
      providerError({
        code: 'ASAAS_PROVIDER_REQUEST_INCONCLUSIVE',
        classification:
          ASAAS_PROVIDER_ERROR_CLASSIFICATION.INCONCLUSIVE,
        status: null
      })
    )
  );

  assert.equal(mapped.code, 'unavailable');
  assert.equal(
    mapped.details?.domainCode,
    'ASAAS_PROVIDER_REQUEST_INCONCLUSIVE'
  );
});

console.log(
  `FINANCIAL_CHECKOUT_PROVIDER_ERROR_MAPPING_V1_2=${passed}/4`
);

if (passed !== 4) {
  process.exitCode = 1;
}