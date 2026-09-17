'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const run = fs.readFileSync(path.join(root, 'functions/scripts/run-course-publication-fingerprint-staging-smoke.js'), 'utf8');
const cleanup = fs.readFileSync(path.join(root, 'functions/scripts/cleanup-course-publication-fingerprint-staging-smoke.js'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('smoke e cleanup sao restritos a staging', () => {
  assert.ok(run.includes("const TARGET_PROJECT = 'bjj-exams-staging'"));
  assert.ok(cleanup.includes("const TARGET_PROJECT = 'bjj-exams-staging'"));
  assert.ok(run.includes("const PRODUCTION_PROJECT = 'bjj-exams'"));
  assert.ok(cleanup.includes("const PRODUCTION_PROJECT = 'bjj-exams'"));
});

test('smoke exige confirmacao explicita e branch 4A5c', () => {
  assert.ok(run.includes('I_UNDERSTAND_STAGING_WRITES'));
  assert.ok(run.includes("feature/marco4a5c-content-fingerprint"));
});

test('smoke usa autenticacao real e callables implantadas', () => {
  assert.ok(run.includes('accounts:signInWithPassword'));
  assert.ok(run.includes("callCallable('solicitarPublicacaoCursoV12'"));
  assert.ok(run.includes("expectCallableError('registrarDecisaoModeracaoV12'"));
});

test('smoke valida fingerprint estrutural persistido', () => {
  assert.ok(run.includes('STRUCTURAL_FINGERPRINT_PERSISTED=OK'));
  assert.ok(run.includes('PUBLICATION_SNAPSHOT_VERSION'));
  assert.ok(run.includes('MODERATION_SCOPE_VERSION'));
  assert.ok(run.includes('contentRevision'));
});

test('smoke valida bloqueio de override stale', () => {
  assert.ok(run.includes("'FAILED_PRECONDITION'"));
  assert.ok(run.includes('STALE_HUMAN_OVERRIDE_BLOCKED=OK'));
  assert.ok(run.includes("staleAfter.status === 'review'"));
});

test('smoke nunca imprime senhas e bloqueia producao', () => {
  assert.ok(run.includes('PASSWORDS_PRINTED=False'));
  assert.ok(run.includes('PRODUCTION_ACCESS=NOT_RUN'));
  assert.ok(!run.includes('console.log(ownerPassword'));
  assert.ok(!run.includes('console.log(moderatorPassword'));
});

test('cleanup remove subcolecoes cursos auditoria perfis e auth', () => {
  assert.ok(cleanup.includes("courseRef.collection('modules')"));
  assert.ok(cleanup.includes("courseRef.collection('lessons')"));
  assert.ok(cleanup.includes("db.collection('audit_logs').where('entityId', '==', courseId)"));
  assert.ok(cleanup.includes('auth.deleteUser(uid)'));
  assert.ok(cleanup.includes('MARCO4A5C_PUBLICATION_FINGERPRINT_STAGING_CLEANUP=OK'));
});

test('arquivo local do smoke e ignorado pelo git', () => {
  assert.ok(gitignore.includes('functions/.course-publication-fingerprint-staging-smoke.local.json'));
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

console.log(`COURSE_PUBLICATION_FINGERPRINT_STAGING_SMOKE_V1_2=${passed}/${cases.length}`);
