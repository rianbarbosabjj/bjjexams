'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const enrollmentFunctions = fs.readFileSync(
  path.join(root, 'functions', 'src', 'courses', 'course-enrollment-functions.js'),
  'utf8'
);
const enrollmentDomain = fs.readFileSync(
  path.join(root, 'functions', 'src', 'courses', 'course-enrollment-domain.js'),
  'utf8'
);
const main = fs.readFileSync(path.join(root, 'functions', 'main.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

function contains(source, value) {
  assert.ok(source.includes(value), `Esperado encontrar: ${value}`);
}

test('callables do 4B1 exigem autenticacao', () => {
  contains(enrollmentFunctions, "if (!uid) throw new HttpsError('unauthenticated'");
  contains(enrollmentFunctions, 'matricularCursoGratuitoV12');
  contains(enrollmentFunctions, 'obterEntitlementCursoV12');
  contains(enrollmentFunctions, 'listarMeusCursosV12');
});

test('matricula usa id deterministico por curso e usuario', () => {
  contains(enrollmentFunctions, 'enrollmentDocumentId(courseId, uid)');
  contains(enrollmentDomain, "course-enrollment-v1:${course}:${user}");
});

test('auto matricula gratuita valida status visibilidade membership e pagamento', () => {
  contains(enrollmentFunctions, 'assertCanSelfEnrollFreeCourse({ course, membership })');
  contains(enrollmentDomain, "course.status !== 'published'");
  contains(enrollmentDomain, "course.visibility === 'organization'");
  contains(enrollmentDomain, "course.isPaid === true || Number(course.priceCents || 0) > 0");
});

test('membership institucional e lido somente pelo backend canonico', () => {
  contains(enrollmentFunctions, "db.collection('vinculos_organizacao')");
  contains(enrollmentFunctions, ".where('usuario_id', '==', uid)");
  contains(rules, 'match /vinculos_organizacao/{id}');
  contains(rules, 'allow read, write: if false;');
});

test('matricula existente ativa ou concluida torna auto matricula idempotente', () => {
  contains(enrollmentFunctions, "['active', 'completed'].includes(existing.status)");
  contains(enrollmentFunctions, 'created = false');
});

test('matricula cancelada ou reembolsada nao reativa automaticamente', () => {
  contains(enrollmentFunctions, 'Esta matrícula não pode ser reativada automaticamente.');
});

test('criacao de matricula gera auditoria server-side', () => {
  contains(enrollmentFunctions, "action: 'course.enrollment.created'");
  contains(enrollmentFunctions, "entityType: 'enrollment'");
  contains(enrollmentFunctions, "source: 'function'");
});

test('entitlement nao entrega conteudo de modulo ou aula', () => {
  assert.ok(!enrollmentFunctions.includes("collection('modules')"));
  assert.ok(!enrollmentFunctions.includes("collection('lessons')"));
  assert.ok(!enrollmentFunctions.includes('videoUrl'));
  assert.ok(!enrollmentFunctions.includes('documentUrl'));
  assert.ok(!enrollmentFunctions.includes('body:'));
});

test('meus cursos consulta apenas matriculas do usuario autenticado', () => {
  contains(enrollmentFunctions, ".collection('enrollments')");
  contains(enrollmentFunctions, ".where('userId', '==', uid)");
  contains(enrollmentFunctions, 'MAX_MY_COURSES = 100');
});

test('curso suspenso ou arquivado perde entitlement no resolver canonico', () => {
  contains(enrollmentDomain, "course.status !== 'published'");
  contains(enrollmentDomain, "reason: 'COURSE_NOT_PUBLISHED'");
});

test('colecao enrollments permanece deny by default para o cliente', () => {
  contains(rules, 'match /enrollments/{enrollmentId}');
  const enrollmentRule = rules.slice(rules.indexOf('match /enrollments/{enrollmentId}'));
  contains(enrollmentRule.slice(0, 220), 'allow read, write: if false;');
});

test('composition root exporta as callables de matricula', () => {
  contains(main, 'createCourseEnrollmentFunctions');
  contains(main, '...courseEnrollmentFunctions');
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

console.log(`COURSE_ENROLLMENT_WORKFLOW_V1_2=${passed}/${cases.length}`);
