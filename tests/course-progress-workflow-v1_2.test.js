'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const functionsSource = fs.readFileSync(
  path.join(root, 'functions', 'src', 'courses', 'course-progress-functions.js'),
  'utf8'
);
const domainSource = fs.readFileSync(
  path.join(root, 'functions', 'src', 'courses', 'course-progress-domain.js'),
  'utf8'
);
const mainSource = fs.readFileSync(path.join(root, 'functions', 'main.js'), 'utf8');
const rulesSource = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const roadmapSource = fs.readFileSync(
  path.join(root, 'docs', 'architecture', 'COURSES_MVP_V1_2.md'),
  'utf8'
);
const contractSource = fs.readFileSync(
  path.join(root, 'docs', 'course-progress-v1_2.md'),
  'utf8'
);

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function contains(source, value) {
  assert.ok(source.includes(value), `Esperado encontrar: ${value}`);
}

test('callables de progresso exigem autenticacao', () => {
  contains(functionsSource, "const uid = requireAuth(request);");
  contains(functionsSource, "const concluirAulaCursoV12 = onCall(");
  contains(functionsSource, "const obterProgressoCursoV12 = onCall(");
});

test('identidade usa uid autenticado e matricula deterministica', () => {
  contains(functionsSource, 'enrollmentDocumentId(courseId, uid)');
  assert.ok(!functionsSource.includes('request.data?.userId'));
  assert.ok(!functionsSource.includes('request.data?.uid'));
});

test('entitlement e recalculado antes de mutar progresso', () => {
  contains(functionsSource, 'resolveCourseEntitlement({');
  contains(functionsSource, 'assertEntitlement(entitlement);');
  contains(functionsSource, 'membershipForCourseInTransaction(tx, uid, course)');
});

test('aula usa caminho canonico plano e exige modulo existente', () => {
  contains(functionsSource, "courseRef.collection('lessons').doc(lessonId)");
  contains(functionsSource, "courseRef.collection('modules').doc(lesson.moduleId)");
  contains(functionsSource, "domainCode: 'ORPHAN_LESSON'");
});

test('progresso por aula fica sob a matricula canonica', () => {
  contains(functionsSource, "enrollmentRef.collection('lesson_progress').doc(lessonId)");
  contains(functionsSource, "enrollmentRef.collection('lesson_progress').get()");
  contains(domainSource, "status: 'completed'");
});

test('replay idempotente nao grava nova conclusao', () => {
  contains(functionsSource, 'if (progressSnap.exists) {');
  contains(functionsSource, 'changed = false;');
  contains(functionsSource, 'tx.create(progressRef, lessonProgress);');
});

test('agregado atualiza contador percentual e revisao na mesma transacao', () => {
  contains(functionsSource, 'completedLessonCount: next.completedLessonCount');
  contains(functionsSource, 'progressPercent: next.progressPercent');
  contains(functionsSource, 'progressContentRevision: contentRevision');
  contains(functionsSource, 'tx.update(enrollmentRef, enrollmentUpdate);');
});

test('ultima aula conclui matricula uma unica vez', () => {
  contains(functionsSource, "enrollmentUpdate.status = 'completed';");
  contains(functionsSource, 'enrollmentUpdate.completedAt = timestamp;');
  contains(domainSource, 'courseCompleted: nextCount === total');
});

test('auditoria diferencia aula e curso e nao roda no replay', () => {
  contains(functionsSource, "action: 'course.progress.lesson.completed'");
  contains(functionsSource, "action: 'course.progress.course.completed'");
  const replayIndex = functionsSource.indexOf('if (progressSnap.exists) {');
  const firstAuditIndex = functionsSource.indexOf("action: 'course.progress.lesson.completed'");
  assert.ok(replayIndex >= 0 && replayIndex < firstAuditIndex);
});

test('consulta valida detalhe contra agregado e existencia das aulas', () => {
  contains(functionsSource, 'buildCourseProgressView({');
  contains(functionsSource, 'completedLessonIds');
  contains(functionsSource, 'await db.getAll(');
  contains(functionsSource, "domainCode: 'PROGRESS_LESSON_NOT_FOUND'");
  contains(domainSource, "'PROGRESS_DETAIL_AGGREGATE_MISMATCH'");
});

test('firestore explicita deny na subcolecao lesson_progress', () => {
  contains(rulesSource, 'match /enrollments/{enrollmentId} {');
  contains(rulesSource, 'match /lesson_progress/{lessonId} {');
  const block = rulesSource.slice(
    rulesSource.indexOf('match /lesson_progress/{lessonId} {'),
    rulesSource.indexOf('match /cursos_teoricos/{id} {')
  );
  contains(block, 'allow read, write: if false;');
});

test('composition root exporta callables de progresso', () => {
  contains(mainSource, 'createCourseProgressFunctions');
  contains(mainSource, '...courseProgressFunctions');
});

test('contrato isola legado e documenta escopo 4B3', () => {
  contains(roadmapSource, 'enrollments/{enrollmentId}/lesson_progress/{lessonId}');
  contains(contractSource, 'O 4B.3 não faz dual-write para o legado.');
  contains(contractSource, '`concluirAulaCursoV12`');
  contains(contractSource, '`obterProgressoCursoV12`');
  assert.ok(!functionsSource.includes('`matriculas/'));
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

console.log(`COURSE_PROGRESS_WORKFLOW_V1_2=${passed}/${cases.length}`);
