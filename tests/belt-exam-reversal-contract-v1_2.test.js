'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

const financeDir = path.join(__dirname, '../functions/src/finance');
const worker = fs.readFileSync(path.join(financeDir, 'financial-webhook-functions.js'), 'utf8');
const courseReversal = fs.readFileSync(path.join(financeDir, 'financial-reversal-fulfillment.js'), 'utf8');
const beltReversal = fs.readFileSync(path.join(financeDir, 'financial-belt-exam-reversal-fulfillment.js'), 'utf8');
const stateDomain = fs.readFileSync(path.join(financeDir, 'financial-belt-exam-reversal-state-domain.js'), 'utf8');

test('reversal course permanece isolado em enrollment', () => {
  assert.equal(courseReversal.includes("enrollmentDocumentId(order.productId"), true);
  assert.equal(courseReversal.includes('exam_registrations'), false);
});

test('reversal belt_exam usa registration e nao enrollment', () => {
  assert.equal(beltReversal.includes('exam_registrations/'), true);
  assert.equal(beltReversal.includes('enrollments/'), false);
});

test('worker identifica belt_exam antes do fulfillment course', () => {
  const beltIndex = worker.indexOf('const beltExam = await isBeltExamFinancialEvent');
  const courseIndex = worker.indexOf('const reversalFulfillment = createFinancialReversalFulfillment({');
  assert.ok(beltIndex >= 0);
  assert.ok(courseIndex > beltIndex);
});

test('dominio explicita refund parcial como reconciliacao', () => {
  assert.equal(stateDomain.includes("action === 'partial_refund_review'"), true);
  assert.equal(stateDomain.includes('moveToReconciliation'), true);
});

test('chargeback de exame exige reconciliacao em vez de restauracao automatica', () => {
  assert.equal(stateDomain.includes("'chargeback_reversal_pending'"), true);
  assert.equal(beltReversal.includes('chargeback_positive_requires_review'), true);
});

console.log(`BELT_EXAM_REVERSAL_CONTRACT_V1_2=${passed}/5`);
if (passed !== 5) process.exitCode = 1;
