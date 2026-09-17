'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const prepare = fs.readFileSync(path.join(root, 'functions', 'scripts', 'prepare-course-student-ui-staging-smoke.js'), 'utf8');
const verify = fs.readFileSync(path.join(root, 'functions', 'scripts', 'verify-course-student-ui-staging-smoke.js'), 'utf8');
const cleanup = fs.readFileSync(path.join(root, 'functions', 'scripts', 'cleanup-course-student-ui-staging-smoke.js'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('smoke permanece restrito ao projeto de staging', () => {
  for (const source of [prepare, verify, cleanup]) {
    assert.ok(source.includes("const TARGET_PROJECT = 'bjj-exams-staging'"));
    assert.ok(source.includes("const PRODUCTION_PROJECT = 'bjj-exams'"));
    assert.ok(source.includes('Projeto de produção detectado'));
  }
});

test('smoke exige confirmação explícita e branch 4B.4', () => {
  for (const source of [prepare, verify, cleanup]) {
    assert.ok(source.includes("I_UNDERSTAND_STAGING_WRITES"));
    assert.ok(source.includes("feature/marco4b4-student-course-ui"));
  }
});

test('estado local do smoke permanece ignorado pelo Git', () => {
  assert.ok(gitignore.includes('functions/.course-student-ui-staging.local.json'));
});

test('fixture cria perfil de aluno e matrícula canônica', () => {
  assert.ok(prepare.includes('`alunos/${user.uid}`'));
  assert.ok(prepare.includes('enrollmentDocumentId(courseId, user.uid)'));
  assert.ok(prepare.includes("source: 'free'"));
  assert.ok(prepare.includes("status: 'active'"));
  assert.ok(prepare.includes('completedLessonCount: 0'));
});

test('fixture cria duas aulas protegidas com marcadores visuais', () => {
  assert.ok(prepare.includes("const lessonIds = ['lesson-1', 'lesson-2']"));
  assert.ok(prepare.includes('SMOKE_4B4_AULA_1'));
  assert.ok(prepare.includes('SMOKE_4B4_AULA_2'));
  assert.ok(prepare.includes('EXPECTED_PROGRESS=0->50->100'));
});

test('verificador exige conclusão canônica integral', () => {
  assert.ok(verify.includes("enrollment.status === 'completed'"));
  assert.ok(verify.includes('enrollment.completedLessonCount === 2'));
  assert.ok(verify.includes('Number(enrollment.progressPercent) === 100'));
  assert.ok(verify.includes('lessonAudits.length === 2'));
  assert.ok(verify.includes('courseAudits.length === 1'));
});

test('cleanup valida ownership antes de remover fixtures', () => {
  assert.ok(cleanup.includes('data.smokeRunId !== state.runId'));
  assert.ok(cleanup.includes('courseSnap.data()?.smokeRunId !== state.runId'));
  assert.ok(cleanup.includes('profileSnap.data()?.smokeRunId !== state.runId'));
  assert.ok(cleanup.includes("startsWith('course-ui-')"));
});

test('cleanup comprova ausência de resíduos e remove estado local', () => {
  assert.ok(cleanup.includes('Cleanup remoto incompleto'));
  assert.ok(cleanup.includes('fs.unlinkSync(STATE_FILE)'));
  assert.ok(cleanup.includes('COURSE_STUDENT_UI_STAGING_CLEANUP=OK'));
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

console.log(`COURSE_STUDENT_UI_STAGING_SMOKE_V1_2=${passed}/${cases.length}`);
if (passed !== cases.length) process.exitCode = 1;
