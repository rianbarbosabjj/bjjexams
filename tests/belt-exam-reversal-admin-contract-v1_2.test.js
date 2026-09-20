'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const courseService = fs.readFileSync(
  path.join(root, 'functions/src/finance/financial-reversal-admin-service.js'),
  'utf8'
);
const beltService = fs.readFileSync(
  path.join(root, 'functions/src/finance/financial-belt-exam-reversal-admin-service.js'),
  'utf8'
);
const functionsSource = fs.readFileSync(
  path.join(root, 'functions/src/finance/financial-reversal-admin-functions.js'),
  'utf8'
);

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

test('servico course permanece isolado em enrollment', () => {
  assert.equal(courseService.includes("require('../courses/course-enrollment-domain')"), true);
  assert.equal(courseService.includes('exam_registrations'), false);
  assert.equal(courseService.includes('belt_exam'), false);
});

test('servico belt_exam usa registration sem depender de enrollment', () => {
  assert.equal(beltService.includes('exam_registrations'), true);
  assert.equal(beltService.includes('examRegistrationDocumentId'), true);
  assert.equal(beltService.includes("collection('enrollments')"), false);
  assert.equal(beltService.includes('enrollmentDocumentId'), false);
});

test('callables preservam nomes e roteiam por productType belt_exam', () => {
  assert.equal(functionsSource.includes('cancelarCobrancaPendenteV12'), true);
  assert.equal(functionsSource.includes('solicitarEstornoIntegralV12'), true);
  assert.equal(functionsSource.includes("=== 'belt_exam'"), true);
  assert.equal(functionsSource.includes('createFinancialBeltExamReversalAdminService'), true);
  assert.equal(functionsSource.includes('createFinancialReversalAdminService'), true);
});

test('refund de exame com atividade academica e bloqueado antes do provider', () => {
  const activityIndex = beltService.indexOf('BELT_EXAM_ADMIN_REFUND_ACADEMIC_ACTIVITY');
  const providerIndex = beltService.indexOf('const api = provider()');
  assert.ok(activityIndex >= 0);
  assert.ok(providerIndex > activityIndex);
  assert.equal(beltService.includes('hasAcademicState(registration)'), true);
});

test('resposta belt_exam nao expoe providerPaymentId e mutacao canonica aguarda webhook', () => {
  const viewStart = beltService.indexOf('function requestView');
  const viewEnd = beltService.indexOf('function createFinancialBeltExamReversalAdminService');
  const viewSource = beltService.slice(viewStart, viewEnd);
  assert.equal(viewSource.includes('providerPaymentId'), false);
  assert.equal(beltService.includes("status: 'awaiting_webhook'"), true);
  assert.equal(beltService.includes('canonicalMutationPerformed: false'), true);
  assert.equal(beltService.includes('tx.set(orderRef'), false);
  assert.equal(beltService.includes('tx.set(registrationRef'), false);
});

console.log(`BELT_EXAM_REVERSAL_ADMIN_CONTRACT_V1_2=${passed}/5`);
if (passed !== 5) process.exitCode = 1;
