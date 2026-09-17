'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const runSmoke = fs.readFileSync(
  path.join(root, 'functions', 'scripts', 'run-course-enrollment-entitlement-staging-smoke.js'),
  'utf8'
);
const cleanupSmoke = fs.readFileSync(
  path.join(root, 'functions', 'scripts', 'cleanup-course-enrollment-entitlement-staging-smoke.js'),
  'utf8'
);
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function contains(source, value) { assert.ok(source.includes(value), `Esperado encontrar: ${value}`); }


test('smoke e cleanup sao restritos a staging e bloqueiam producao', () => {
  contains(runSmoke, "TARGET_PROJECT = 'bjj-exams-staging'");
  contains(runSmoke, "PRODUCTION_PROJECT = 'bjj-exams'");
  contains(runSmoke, 'Projeto de produção detectado. Execução bloqueada.');
  contains(cleanupSmoke, 'Projeto de produção detectado. Cleanup bloqueado.');
});

test('smoke exige confirmacao explicita e branch 4B1', () => {
  contains(runSmoke, "CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES'");
  contains(runSmoke, "ALLOWED_BRANCH = 'feature/marco4b1-enrollment-entitlement'");
  contains(runSmoke, 'currentBranch() !== ALLOWED_BRANCH');
});

test('smoke usa autenticacao real e callables implantadas', () => {
  contains(runSmoke, 'accounts:signInWithPassword');
  contains(runSmoke, "callCallable('matricularCursoGratuitoV12'");
  contains(runSmoke, "callCallable('obterEntitlementCursoV12'");
  contains(runSmoke, "callCallable('listarMeusCursosV12'");
});

test('smoke valida matricula gratuita e idempotencia', () => {
  contains(runSmoke, 'FREE_ENROLLMENT_CREATED=OK');
  contains(runSmoke, 'FREE_ENROLLMENT_IDEMPOTENT=OK');
  contains(runSmoke, 'firstEnrollment.created === true');
  contains(runSmoke, 'secondEnrollment.created === false');
});

test('smoke bloqueia matricula gratuita em curso pago', () => {
  contains(runSmoke, "'PAYMENT_REQUIRED'");
  contains(runSmoke, 'PAID_COURSE_FREE_ENROLLMENT_BLOCKED=OK');
});

test('smoke valida membership de organizacao e revogacao de entitlement', () => {
  contains(runSmoke, 'ORGANIZATION_ENROLLMENT_WITHOUT_MEMBERSHIP_BLOCKED=OK');
  contains(runSmoke, 'ORGANIZATION_ENROLLMENT_WITH_ACTIVE_MEMBERSHIP=OK');
  contains(runSmoke, 'ORGANIZATION_ENTITLEMENT_REVOKED_WITH_ENDED_MEMBERSHIP=OK');
});

test('smoke valida meus cursos entitlement e ausencia de conteudo', () => {
  contains(runSmoke, 'MY_COURSES=OK');
  contains(runSmoke, 'ENTITLEMENT_QUERY=OK');
  contains(runSmoke, "hasOwnProperty.call(entitlement, 'modules')");
  contains(runSmoke, "hasOwnProperty.call(entitlement, 'lessons')");
});

test('smoke valida deny de leitura direta do enrollment', () => {
  contains(runSmoke, 'firestore.googleapis.com/v1/projects/');
  contains(runSmoke, 'response.status === 403');
  contains(runSmoke, 'DIRECT_FIRESTORE_ENROLLMENT_READ_DENIED=OK');
});

test('cleanup valida ownership antes de remover dados temporarios', () => {
  contains(cleanupSmoke, 'não pertence ao smoke atual');
  contains(cleanupSmoke, "data.action !== 'course.enrollment.created'");
  contains(cleanupSmoke, 'MARCO4B1_ENROLLMENT_ENTITLEMENT_STAGING_CLEANUP=OK');
});

test('arquivo local do smoke fica ignorado pelo git', () => {
  contains(gitignore, 'functions/.course-enrollment-entitlement-staging.local.json');
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

console.log(`COURSE_ENROLLMENT_STAGING_SMOKE_V1_2=${passed}/${cases.length}`);
