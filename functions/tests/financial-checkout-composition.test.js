'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const mainSource = fs.readFileSync(
  path.join(__dirname, '..', 'main.js'),
  'utf8'
);

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

test('checkout declara staging como unico projeto com secret Asaas', () => {
  assert.ok(
    mainSource.includes('const STAGING_PROJECT_ID = "bjj-exams-staging";')
  );
  assert.ok(
    mainSource.includes('firebaseProjectId === STAGING_PROJECT_ID')
  );
});

test('ASAAS_API_KEY pode ser nulo fora de staging', () => {
  assert.ok(mainSource.includes('? defineSecret("ASAAS_API_KEY")'));
  assert.ok(mainSource.includes(': null;'));
});

test('callable recebe secret somente quando ASAAS_API_KEY existe', () => {
  assert.ok(
    mainSource.includes('const checkoutSecrets = ASAAS_API_KEY')
  );
  assert.ok(mainSource.includes('? [ASAAS_API_KEY]'));
  assert.ok(mainSource.includes(': [];'));
});

test('provider real falha se secret nao estiver vinculado', () => {
  assert.ok(
    mainSource.includes('if (!ASAAS_API_KEY)')
  );
  assert.ok(
    mainSource.includes('não está vinculada ao checkout neste projeto')
  );
});

let passed = 0;
for (const item of cases) {
  try {
    item.fn();
    passed += 1;
    console.log(`PASS | ${item.name}`);
  } catch (error) {
    console.error(`FAIL | ${item.name}`);
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}

console.log(`FINANCIAL_CHECKOUT_COMPOSITION_V1_2=${passed}/${cases.length}`);
if (passed !== cases.length) process.exitCode = 1;
