'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const files = [
  'asaas-checkout-adapter.js',
  'asaas-checkout-provider-factory.js',
  'financial-checkout-persistence.js',
  'financial-checkout-provider-state.js',
  'financial-course-checkout-service.js',
  'financial-checkout-functions.js'
];

const forbidden = [
  'asaas-helpers',
  "collection('pedidos')",
  'collection("pedidos")',
  "doc('pedidos/",
  'doc("pedidos/',
  "collection('matriculas')",
  'collection("matriculas")',
  "doc('matriculas/",
  'doc("matriculas/',
  "collection('enrollments')",
  'collection("enrollments")',
  "doc('enrollments/",
  'doc("enrollments/'
];

let passed = 0;

for (const file of files) {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/finance', file),
    'utf8'
  );
  for (const token of forbidden) {
    assert.equal(
      source.includes(token),
      false,
      `${file} contém dependência proibida: ${token}`
    );
  }
  passed += 1;
  console.log(`PASS | ${file} sem legado financeiro/entitlement`);
}

console.log(`FINANCIAL_CHECKOUT_SOURCE_GUARD_V1_2=${passed}/${files.length}`);
if (passed !== files.length) process.exitCode = 1;