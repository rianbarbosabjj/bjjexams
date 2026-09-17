'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const scriptPath = path.join(__dirname, '..', 'scripts', 'check-staging-course-student-invoker.ps1');
const source = fs.readFileSync(scriptPath, 'utf8');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('precheck permanece restrito ao projeto de staging', () => {
  assert.ok(source.includes('$ExpectedProject = "bjj-exams-staging"'));
  assert.ok(source.includes('$ProductionProject = "bjj-exams"'));
  assert.ok(source.includes('produção não pode ser consultada por este precheck'));
});

test('precheck só roda na branch do Marco 4B.4', () => {
  assert.ok(source.includes('$AllowedBranch = "feature/marco4b4-student-course-ui"'));
});

test('consulta IAM no serviço Cloud Run subjacente', () => {
  assert.ok(source.includes('"run", "services", "get-iam-policy"'));
  assert.ok(source.includes('serviceConfig.service'));
  assert.strictEqual(source.includes('"functions", "get-iam-policy"'), false);
});

test('núcleo do player contém exatamente as cinco callables usadas pela UI', () => {
  for (const fn of [
    'listarMeusCursosV12',
    'obterEstruturaConsumoCursoV12',
    'obterAulaConsumoCursoV12',
    'obterProgressoCursoV12',
    'concluirAulaCursoV12'
  ]) {
    assert.ok(source.includes(`"${fn}"`), fn);
  }
});

test('matrícula gratuita e entitlement são classificados como auxiliares', () => {
  assert.ok(source.includes('$auxiliaryFunctions = @('));
  assert.ok(source.includes('"matricularCursoGratuitoV12"'));
  assert.ok(source.includes('"obterEntitlementCursoV12"'));
});

test('precheck é somente leitura e não altera IAM', () => {
  assert.strictEqual(source.includes('add-iam-policy-binding'), false);
  assert.strictEqual(source.includes('set-iam-policy'), false);
  assert.ok(source.includes('IAM_WRITES_PERFORMED=False'));
  assert.ok(source.includes('PRODUCTION_ACCESS=NOT_RUN'));
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

console.log(`STAGING_COURSE_STUDENT_INVOKER_V1_2=${passed}/${cases.length}`);
if (passed !== cases.length) process.exitCode = 1;
