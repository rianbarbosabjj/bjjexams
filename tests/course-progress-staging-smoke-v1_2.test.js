'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const runSource = fs.readFileSync(
  path.join(root, 'functions', 'scripts', 'run-course-progress-staging-smoke.js'),
  'utf8'
);
const cleanupSource = fs.readFileSync(
  path.join(root, 'functions', 'scripts', 'cleanup-course-progress-staging-smoke.js'),
  'utf8'
);
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function contains(source, value) {
  assert.ok(source.includes(value), `Esperado encontrar: ${value}`);
}

test('smoke e cleanup sao fixados em staging e bloqueiam producao', () => {
  contains(runSource, "const TARGET_PROJECT = 'bjj-exams-staging';");
  contains(runSource, "const PRODUCTION_PROJECT = 'bjj-exams';");
  contains(runSource, "fail('Projeto de produção detectado. Execução bloqueada.')");
  contains(cleanupSource, "fail('Projeto de produção detectado. Cleanup bloqueado.')");
});

test('smoke exige confirmacao explicita e branch 4B3', () => {
  contains(runSource, "const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';");
  contains(runSource, "const ALLOWED_BRANCH = 'feature/marco4b3-course-progress';");
  contains(runSource, 'currentBranch() !== ALLOWED_BRANCH');
  contains(cleanupSource, "const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';");
});

test('smoke usa autenticacao real e callables implantadas', () => {
  contains(runSource, 'accounts:signInWithPassword');
  contains(runSource, "'concluirAulaCursoV12'");
  contains(runSource, "'obterProgressoCursoV12'");
  contains(runSource, "headers.Authorization = `Bearer ${idToken}`");
});

test('fixture usa curso canonico com duas aulas e matricula deterministica', () => {
  contains(runSource, "const enrollmentId = enrollmentDocumentId(courseRef.id, student.uid);");
  contains(runSource, "courseRef.collection('lessons').doc(lessonOneId)");
  contains(runSource, "courseRef.collection('lessons').doc(lessonTwoId)");
  contains(runSource, 'lessonCount: 2');
});

test('smoke valida progresso inicial zerado', () => {
  contains(runSource, 'INITIAL_PROGRESS_ZERO=OK');
  contains(runSource, 'completedLessonCount === 0');
  contains(runSource, 'progressPercent === 0');
  contains(runSource, 'completedLessonIds.length === 0');
});

test('smoke valida primeira conclusao e agregado persistido', () => {
  contains(runSource, 'FIRST_LESSON_COMPLETED=OK');
  contains(runSource, 'PERSISTED_PROGRESS_AGGREGATE=OK');
  contains(runSource, 'completedLessonCount === 1');
  contains(runSource, 'progressPercent === 50');
  contains(runSource, 'progressContentRevision === 1');
});

test('smoke valida replay idempotente sem nova auditoria', () => {
  contains(runSource, 'LESSON_COMPLETION_IDEMPOTENT=OK');
  contains(runSource, 'replayFirst.changed === false');
  contains(runSource, 'auditsAfterReplayFirst.length === 1');
});

test('smoke valida consulta sanitizada do progresso', () => {
  contains(runSource, 'PROGRESS_QUERY_SANITIZED=OK');
  contains(runSource, "hasOwnProperty.call(midProgress.progress || {}, 'userId')");
  contains(runSource, 'completedLessonIds');
});

test('smoke valida deny direto do lesson_progress', () => {
  contains(runSource, 'DIRECT_FIRESTORE_PROGRESS_READ_DENIED=OK');
  contains(runSource, '/documents/enrollments/${enrollmentId}/lesson_progress/${lessonId}');
  contains(runSource, 'response.status === 403');
});

test('smoke valida conclusao integral e completedAt imutavel no replay', () => {
  contains(runSource, 'COURSE_COMPLETION_AT_100=OK');
  contains(runSource, 'COURSE_COMPLETION_REPLAY_IDEMPOTENT=OK');
  contains(runSource, 'progressPercent === 100');
  contains(runSource, "status === 'completed'");
  contains(runSource, 'completedAtBeforeReplay?.isEqual?.(completedAtAfterReplay) === true');
});

test('smoke valida auditoria unica da conclusao do curso', () => {
  contains(runSource, 'COURSE_COMPLETION_AUDIT_ONCE=OK');
  contains(runSource, "item.action === 'course.progress.lesson.completed'");
  contains(runSource, "item.action === 'course.progress.course.completed'");
  contains(runSource, 'auditsAfterCompletion.length === 3');
});

test('smoke falha fechado em revisao stale e curso suspenso', () => {
  contains(runSource, 'STALE_PROGRESS_REVISION_BLOCKED=OK');
  contains(runSource, "'PROGRESS_CONTENT_REVISION_MISMATCH'");
  contains(runSource, 'SUSPENDED_COURSE_PROGRESS_REVOKED=OK');
  contains(runSource, "'COURSE_NOT_PUBLISHED'");
});

test('cleanup remove progresso e auditoria antes da matricula', () => {
  contains(cleanupSource, "ref.collection('lesson_progress').get()");
  contains(cleanupSource, 'await progressDoc.ref.delete();');
  contains(cleanupSource, 'await ref.delete();');
  contains(cleanupSource, "data.entityType !== 'course_progress'");
  const progressDeleteIndex = cleanupSource.indexOf('await progressDoc.ref.delete();');
  const enrollmentDeleteIndex = cleanupSource.indexOf('await ref.delete();');
  assert.ok(progressDeleteIndex >= 0 && progressDeleteIndex < enrollmentDeleteIndex);
});

test('harness preserva diagnostico sanitizado e estado local ignorado', () => {
  contains(runSource, 'HTTP_STATUS=${error.httpStatus}');
  contains(runSource, 'RESPONSE_CONTENT_TYPE=${error.responseContentType}');
  contains(runSource, 'RESPONSE_KIND=${error.responseKind}');
  contains(runSource, 'RESPONSE_PREVIEW=${error.responsePreview}');
  contains(runSource, 'PASSWORDS_PRINTED=False');
  contains(runSource, 'PRODUCTION_ACCESS=NOT_RUN');
  contains(cleanupSource, 'PRODUCTION_ACCESS=NOT_RUN');
  contains(gitignore, 'functions/.course-progress-staging.local.json');
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

console.log(`COURSE_PROGRESS_STAGING_SMOKE_V1_2=${passed}/${cases.length}`);
