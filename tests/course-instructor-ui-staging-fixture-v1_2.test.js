'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const prepare = fs.readFileSync(
  path.join(root, 'functions/scripts/prepare-course-instructor-ui-staging-fixture.js'),
  'utf8'
);
const cleanup = fs.readFileSync(
  path.join(root, 'functions/scripts/cleanup-course-instructor-ui-staging-fixture.js'),
  'utf8'
);
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('fixture e cleanup apontam exclusivamente para staging', () => {
  assert.ok(prepare.includes("const TARGET_PROJECT = 'bjj-exams-staging'"));
  assert.ok(cleanup.includes("const TARGET_PROJECT = 'bjj-exams-staging'"));
});

test('fixture e cleanup bloqueiam producao', () => {
  assert.ok(prepare.includes("const PRODUCTION_PROJECT = 'bjj-exams'"));
  assert.ok(cleanup.includes("const PRODUCTION_PROJECT = 'bjj-exams'"));
  assert.ok(cleanup.includes('Projeto de produção detectado. Cleanup bloqueado.'));
});

test('cleanup exige confirmacao explicita de escrita em staging', () => {
  assert.ok(cleanup.includes('I_UNDERSTAND_STAGING_WRITES'));
});

test('cleanup remove subcolecoes antes do documento do curso', () => {
  const modulesIndex = cleanup.indexOf("courseRef.collection('modules')");
  const lessonsIndex = cleanup.indexOf("courseRef.collection('lessons')");
  const courseDeleteIndex = cleanup.indexOf('await courseRef.delete()');
  assert.ok(modulesIndex >= 0);
  assert.ok(lessonsIndex >= 0);
  assert.ok(courseDeleteIndex > modulesIndex);
  assert.ok(courseDeleteIndex > lessonsIndex);
});

test('cleanup remove auditoria pelo ator temporario', () => {
  assert.ok(cleanup.includes("db.collection('audit_logs').where('actorId', '==', fixture.uid)"));
});

test('cleanup valida ausencia de residuos antes de apagar credencial local', () => {
  assert.ok(cleanup.includes('remainingCourses'));
  assert.ok(cleanup.includes('remainingAudits'));
  assert.ok(cleanup.includes('arquivo local de credenciais foi preservado para recuperação'));
  assert.ok(cleanup.indexOf('fs.unlinkSync(FIXTURE_FILE)') > cleanup.indexOf('remainingAudits'));
});

test('cleanup remove perfil equipe e auth apenas da fixture', () => {
  assert.ok(cleanup.includes('fixture.uid'));
  assert.ok(cleanup.includes('fixture.organizationId'));
  assert.ok(cleanup.includes('auth.deleteUser(fixture.uid)'));
});

test('arquivo local de credenciais permanece ignorado pelo git', () => {
  assert.ok(gitignore.includes('functions/.course-instructor-ui-staging.local.json'));
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

console.log(`COURSE_INSTRUCTOR_UI_STAGING_FIXTURE_V1_2=${passed}/${cases.length}`);
