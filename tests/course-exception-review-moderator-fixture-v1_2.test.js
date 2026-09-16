'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const prepare = fs.readFileSync(
  path.join(root, 'functions/scripts/prepare-course-exception-review-staging-moderator.js'),
  'utf8'
);
const cleanup = fs.readFileSync(
  path.join(root, 'functions/scripts/cleanup-course-exception-review-staging-moderator.js'),
  'utf8'
);
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('fixture aponta exclusivamente para staging', () => {
  assert.ok(prepare.includes("const TARGET_PROJECT = 'bjj-exams-staging'"));
  assert.ok(cleanup.includes("const TARGET_PROJECT = 'bjj-exams-staging'"));
});

test('fixture bloqueia projeto de producao', () => {
  assert.ok(prepare.includes("const PRODUCTION_PROJECT = 'bjj-exams'"));
  assert.ok(prepare.includes('Projeto de produção detectado. Execução bloqueada.'));
  assert.ok(cleanup.includes('Projeto de produção detectado. Cleanup bloqueado.'));
});

test('fixture exige confirmacao explicita de escrita em staging', () => {
  assert.ok(prepare.includes('I_UNDERSTAND_STAGING_WRITES'));
  assert.ok(cleanup.includes('I_UNDERSTAND_STAGING_WRITES'));
});

test('moderador recebe somente claim global necessario ao teste', () => {
  assert.ok(prepare.includes('platform_admin: true'));
  assert.ok(!prepare.includes('super_admin: true'));
});

test('fixture limpa nao cria cursos artificiais', () => {
  assert.ok(prepare.includes('TEMP_COURSES_CREATED=0'));
  assert.ok(!prepare.includes("db.collection('courses')"));
  assert.ok(!prepare.includes('coursePayload'));
});

test('senha fica somente em arquivo local protegido e nao e impressa', () => {
  assert.ok(prepare.includes('mode: 0o600'));
  assert.ok(prepare.includes('PASSWORD_PRINTED=False'));
  assert.ok(!prepare.includes('console.log(password'));
});

test('arquivo local de credenciais e ignorado pelo git', () => {
  assert.ok(gitignore.includes('functions/.course-exception-review-moderator-staging.local.json'));
});

test('cleanup valida ownership da fixture antes de remover perfil', () => {
  assert.ok(cleanup.includes("profile.fixtureType !== 'course-exception-review-moderator'"));
  assert.ok(cleanup.includes('profile.smokeRunId !== fixture.runId'));
});

test('cleanup remove somente perfil e auth temporarios', () => {
  assert.ok(cleanup.includes('auth.deleteUser(fixture.uid)'));
  assert.ok(cleanup.includes('TEMP_COURSES_DELETED=0'));
  assert.ok(!cleanup.includes("db.collection('courses')"));
});

let passed = 0;
for (const item of cases) {
  try {
    item.fn();
    passed += 1;
    console.log(`PASS | ${item.name}`);
  } catch (error) {
    console.error(`FAIL | ${item.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log(`COURSE_EXCEPTION_REVIEW_MODERATOR_FIXTURE_V1_2=${passed}/${cases.length}`);
