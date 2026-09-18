'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const rules = fs.readFileSync(
  path.join(root, 'firestore.rules'),
  'utf8'
);

const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

function sectionFor(matchHeader, nextHeader) {
  const start = rules.indexOf(matchHeader);
  const end = rules.indexOf(
    nextHeader,
    start + matchHeader.length
  );

  assert.ok(start >= 0, `Seção ausente: ${matchHeader}`);
  assert.ok(
    end > start,
    `Fim de seção ausente após: ${matchHeader}`
  );

  return rules.slice(start, end);
}

test(
  'financial_provider_customers nega acesso direto do cliente',
  () => {
    const section = sectionFor(
      'match /financial_provider_customers/{customerId}',
      'match /financial_checkout_leases/{leaseId}'
    );

    assert.ok(
      section.includes('allow read, write: if false;')
    );
  }
);

test(
  'financial_checkout_leases nega acesso direto do cliente',
  () => {
    const section = sectionFor(
      'match /financial_checkout_leases/{leaseId}',
      'match /orders/{orderId}'
    );

    assert.ok(
      section.includes('allow read, write: if false;')
    );
  }
);

test(
  'rules do checkout nao reabrem pedidos transacoes ou enrollments',
  () => {
    for (const header of [
      'match /orders/{orderId}',
      'match /payment_transactions/{transactionId}',
      'match /enrollments/{enrollmentId}'
    ]) {
      assert.ok(rules.includes(header));
    }

    assert.equal(
      rules.includes('match /financial_provider_customers/{id} { allow read: if true; }'),
      false
    );
    assert.equal(
      rules.includes('match /financial_checkout_leases/{id} { allow read: if true; }'),
      false
    );
  }
);

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

console.log(
  `FINANCIAL_CHECKOUT_FIRESTORE_RULES_V1_2=${passed}/${cases.length}`
);

if (passed !== cases.length) {
  process.exitCode = 1;
}
