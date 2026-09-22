'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

const functionsSource = source('functions/src/exams/exam-read-functions.js');
const serviceSource = source('functions/src/exams/exam-read-service.js');
const domainSource = source('functions/src/exams/exam-read-domain.js');
const mainSource = source('functions/main.js');

test('read model expõe callables dedicadas para aluno e instrutor', () => {
  for (const name of [
    'listarSessoesExameFaixaV12',
    'obterSessaoExameFaixaV12',
    'listarMeusExamesFaixaV12'
  ]) {
    assert.match(functionsSource, new RegExp(name));
  }
});

test('read service usa somente colecoes canonicas/identidade e nao consulta financeiro cru', () => {
  assert.match(serviceSource, /exam_sessions/);
  assert.match(serviceSource, /exam_registrations/);
  assert.match(serviceSource, /vinculos_organizacao/);
  assert.doesNotMatch(serviceSource, /payment_transactions/);
  assert.doesNotMatch(serviceSource, /financial_reversal_requests/);
  assert.doesNotMatch(serviceSource, /creditos_professor/);
});

test('view sanitizada nao expoe provider ids nem split financeiro', () => {
  assert.doesNotMatch(domainSource, /providerPaymentId/);
  assert.doesNotMatch(domainSource, /walletId/);
  assert.doesNotMatch(domainSource, /financialSnapshot/);
  assert.doesNotMatch(domainSource, /recipientAllocations/);
});

test('Marco 5.7 mantem start de prova explicitamente bloqueado', () => {
  assert.match(domainSource, /canStartExam:\s*false/);
});

test('composition root mantem exam read staging\/demo-only', () => {
  assert.match(mainSource, /const examReadFunctions = webhookRuntimeAllowed/);
  assert.match(mainSource, /createExamReadFunctions/);
  assert.match(mainSource, /\.\.\.examReadFunctions/);
});

console.log(`BELT_EXAM_READ_CONTRACT_V1_2=${passed}/5`);
if (passed !== 5) process.exitCode = 1;
