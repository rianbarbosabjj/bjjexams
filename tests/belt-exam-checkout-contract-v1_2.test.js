'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  financialOrderDocumentId
} = require('../functions/src/finance/financial-order-service');
const {
  beltExamFinancialOrderDocumentId
} = require('../functions/src/finance/financial-belt-exam-order-service');

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

test('id de pedido de curso permanece byte-for-byte compativel', () => {
  const id = financialOrderDocumentId({
    buyerUserId: 'student-123',
    courseId: 'course-456',
    idempotencyKey: 'intent-789'
  });
  assert.equal(
    id,
    'df5c16a572fd28752c138124f9de49c9da5b982bb083525d8104cb0995762d1a'
  );
});

test('pedido belt_exam usa namespace deterministico proprio', () => {
  const id = beltExamFinancialOrderDocumentId({
    buyerUserId: 'student-123',
    sessionId: 'session-456',
    idempotencyKey: 'intent-789'
  });
  assert.equal(
    id,
    'f465c76fc6c0362dc35d46f7beedf913926599ef0bb0bf1451a64dd38e776513'
  );
});

test('namespace belt_exam nao colide com pedido de curso', () => {
  const course = financialOrderDocumentId({
    buyerUserId: 'student-123',
    courseId: 'session-456',
    idempotencyKey: 'intent-789'
  });
  const exam = beltExamFinancialOrderDocumentId({
    buyerUserId: 'student-123',
    sessionId: 'session-456',
    idempotencyKey: 'intent-789'
  });
  assert.notEqual(course, exam);
});

test('callable de exame nao expoe provider payment id', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'functions', 'src', 'finance', 'financial-belt-exam-checkout-functions.js'),
    'utf8'
  );
  assert.equal(source.includes('paymentId: result.paymentId'), false);
  assert.equal(source.includes("['sessionId', 'idempotencyKey']"), true);
});

test('composition root mantem checkout de exame sob runtime gate', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'functions', 'main.js'),
    'utf8'
  );
  assert.match(
    source,
    /const financialBeltExamCheckoutFunctions = webhookRuntimeAllowed\s*\? createFinancialBeltExamCheckoutFunctions/
  );
});

console.log(`BELT_EXAM_CHECKOUT_CONTRACT_V1_2=${passed}/5`);
if (passed !== 5) process.exitCode = 1;
