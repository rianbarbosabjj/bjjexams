'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const patcher = fs.readFileSync(
  path.join(root, 'scripts', 'apply-financial-foundation-rules-v1_2.js'),
  'utf8'
);

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

function sectionFor(matchHeader, nextHeader) {
  const start = rules.indexOf(matchHeader);
  const end = rules.indexOf(nextHeader, start + matchHeader.length);
  assert.ok(start >= 0, `Seção ausente: ${matchHeader}`);
  assert.ok(end > start, `Fim de seção ausente após: ${matchHeader}`);
  return rules.slice(start, end);
}

test('patcher usa marcador determinístico do Marco 5.1', () => {
  assert.ok(patcher.includes('Financeiro canônico v1.2 (Marco 5.1)'));
  assert.ok(patcher.includes("FINANCIAL_FOUNDATION_RULES_PATCH=OK"));
});

test('financial_rules permanece sem acesso direto do cliente', () => {
  const section = sectionFor('match /financial_rules/{ruleId}', 'match /orders/{orderId}');
  assert.ok(section.includes('allow read, write: if false;'));
});

test('orders permanece sem acesso direto do cliente', () => {
  const section = sectionFor('match /orders/{orderId}', 'match /payment_transactions/{transactionId}');
  assert.ok(section.includes('allow read, write: if false;'));
});

test('payment_transactions permanece sem acesso direto do cliente', () => {
  const section = sectionFor(
    'match /payment_transactions/{transactionId}',
    'match /payment_webhook_events/{eventId}'
  );
  assert.ok(section.includes('allow read, write: if false;'));
});

test('payment_webhook_events permanece sem acesso direto do cliente', () => {
  const section = sectionFor(
    'match /payment_webhook_events/{eventId}',
    'match /cursos_teoricos/{id}'
  );
  assert.ok(section.includes('allow read, write: if false;'));
});

test('coleções financeiras canônicas não reutilizam pedidos legado', () => {
  assert.ok(rules.includes('match /pedidos/{id} { allow read, write: if false; }'));
  assert.strictEqual(rules.includes('match /orders/{id}'), false);
  assert.ok(rules.includes('match /orders/{orderId}'));
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

console.log(`FINANCIAL_FIRESTORE_RULES_V1_2=${passed}/${cases.length}`);
if (passed !== cases.length) process.exitCode = 1;
