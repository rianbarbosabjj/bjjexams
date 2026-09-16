'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const smoke = read('functions/scripts/run-course-content-staging-smoke.js');
const cleanup = read('functions/scripts/cleanup-course-content-staging-smoke.js');
const gitignore = read('.gitignore');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('smoke e restrito a staging', () => {
  assert.match(smoke, /TARGET_PROJECT = 'bjj-exams-staging'/);
  assert.match(smoke, /PRODUCTION_PROJECT = 'bjj-exams'/);
  assert.match(smoke, /Projeto de produção detectado/);
});

test('smoke exige confirmacao explicita', () => {
  assert.match(smoke, /I_UNDERSTAND_STAGING_WRITES/);
  assert.match(smoke, /BJJEXAMS_STAGING_SMOKE_CONFIRM/);
});

test('smoke e restrito a branch do marco 4A5', () => {
  assert.match(smoke, /feature\/marco4a5-course-content/);
  assert.match(smoke, /Branch não autorizada/);
});

test('smoke usa autenticacao real via Identity Toolkit', () => {
  assert.match(smoke, /accounts:signInWithPassword/);
  assert.match(smoke, /Authorization: `Bearer \$\{idToken\}`/);
});

test('smoke chama as callables implantadas', () => {
  for (const name of [
    'listarConteudoCursoV12',
    'criarModuloCursoV12',
    'criarAulaCursoV12',
    'atualizarAulaCursoV12',
    'excluirAulaCursoV12',
    'excluirModuloCursoV12'
  ]) {
    assert.match(smoke, new RegExp(name));
  }
});

test('smoke valida ownership e bloqueio fora de draft', () => {
  assert.match(smoke, /OWNERSHIP_READ_DENIED=OK/);
  assert.match(smoke, /NON_DRAFT_MUTATION_BLOCKED=OK/);
  assert.match(smoke, /PERMISSION_DENIED/);
  assert.match(smoke, /FAILED_PRECONDITION/);
});

test('smoke valida movimento e contadores', () => {
  assert.match(smoke, /LESSON_MOVE_COUNTERS=OK/);
  assert.match(smoke, /estimatedDurationMinutes: 12/);
  assert.match(smoke, /contentRevision: 7/);
});

test('smoke valida auditoria completa', () => {
  assert.match(smoke, /CONTENT_AUDIT_LOGS=7\/7/);
  assert.match(smoke, /startsWith\('course\.content\.'\)/);
});

test('smoke nunca imprime senhas', () => {
  assert.match(smoke, /PASSWORDS_PRINTED=False/);
  assert.equal(smoke.includes('console.log(ownerPassword)'), false);
  assert.equal(smoke.includes('console.log(intruderPassword)'), false);
});

test('cleanup e restrito a staging', () => {
  assert.match(cleanup, /TARGET_PROJECT = 'bjj-exams-staging'/);
  assert.match(cleanup, /Projeto de produção detectado/);
  assert.match(cleanup, /PRODUCTION_ACCESS=NOT_RUN/);
});

test('cleanup remove subcolecoes cursos auditoria perfis e auth', () => {
  assert.match(cleanup, /collection\('modules'\)/);
  assert.match(cleanup, /collection\('lessons'\)/);
  assert.match(cleanup, /collection\('audit_logs'\)/);
  assert.match(cleanup, /usuarios\/\$\{uid\}/);
  assert.match(cleanup, /auth\.deleteUser/);
});

test('arquivo local do smoke e ignorado pelo git', () => {
  assert.match(gitignore, /functions\/\.course-content-staging-smoke\.local\.json/);
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

console.log(`COURSE_CONTENT_STAGING_SMOKE_V1_2=${passed}/${cases.length}`);
