'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const runSource = fs.readFileSync(
  path.join(root, 'functions', 'scripts', 'run-course-protected-consumption-staging-smoke.js'),
  'utf8'
);
const cleanupSource = fs.readFileSync(
  path.join(root, 'functions', 'scripts', 'cleanup-course-protected-consumption-staging-smoke.js'),
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

test('smoke exige confirmacao explicita e branch 4B2', () => {
  contains(runSource, "const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';");
  contains(runSource, "const ALLOWED_BRANCH = 'feature/marco4b2-protected-consumption';");
  contains(runSource, 'currentBranch() !== ALLOWED_BRANCH');
  contains(cleanupSource, "const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';");
});

test('smoke usa autenticacao real e callables implantadas', () => {
  contains(runSource, 'accounts:signInWithPassword');
  contains(runSource, "'obterEstruturaConsumoCursoV12'");
  contains(runSource, "'obterAulaConsumoCursoV12'");
  contains(runSource, "'listarPreviewsCursoV12'");
});

test('smoke cria fixtures no caminho canonico plano de aulas', () => {
  contains(runSource, "platformCourseRef.collection('modules').doc(platformModuleId)");
  contains(runSource, "platformCourseRef.collection('lessons').doc(previewLessonId)");
  contains(runSource, "platformCourseRef.collection('lessons').doc(protectedLessonId)");
  assert.ok(!runSource.includes("collection('modules').doc(platformModuleId).collection('lessons')"));
});

test('smoke valida estrutura protegida sem payload integral', () => {
  contains(runSource, 'PROTECTED_STRUCTURE_WITH_ENTITLEMENT=OK');
  contains(runSource, 'PROTECTED_STRUCTURE_NO_INTEGRAL_PAYLOAD=OK');
  contains(runSource, "hasOwnProperty.call(lesson, 'body')");
  contains(runSource, "hasOwnProperty.call(lesson, 'videoUrl')");
  contains(runSource, "hasOwnProperty.call(lesson, 'documentUrl')");
});

test('smoke valida leitura integral somente com entitlement', () => {
  contains(runSource, 'ENTITLED_LESSON_PAYLOAD=OK');
  contains(runSource, "entitledLesson.accessMode === 'entitled'");
  contains(runSource, 'PROTECTED_LESSON_WITHOUT_ENTITLEMENT_BLOCKED=OK');
  contains(runSource, "'NOT_FOUND'");
});

test('smoke valida preview anonimo e indice sanitizado', () => {
  contains(runSource, 'PUBLIC_PREVIEW_LIST_SAFE=OK');
  contains(runSource, 'ANONYMOUS_PREVIEW=OK');
  contains(runSource, "anonymousPreview.accessMode === 'preview'");
  contains(runSource, 'anonymousPreview.entitlement === null');
});

test('smoke bloqueia preview publico de organizacao', () => {
  contains(runSource, 'ORGANIZATION_PUBLIC_PREVIEW_BLOCKED=OK');
  contains(runSource, "visibility: 'organization'");
  contains(runSource, "body: 'SMOKE_4B2_ORGANIZATION_BODY'");
});

test('smoke valida revogacao de consumo por membership', () => {
  contains(runSource, 'ORGANIZATION_CONSUMPTION_WITH_ACTIVE_MEMBERSHIP=OK');
  contains(runSource, "status: 'encerrado'");
  contains(runSource, 'ORGANIZATION_CONSUMPTION_REVOKED_WITH_ENDED_MEMBERSHIP=OK');
  contains(runSource, "'ORGANIZATION_MEMBERSHIP_REQUIRED'");
});

test('smoke valida deny direto da aula plana e revogacao por suspensao', () => {
  contains(runSource, 'DIRECT_FIRESTORE_FLAT_LESSON_READ_DENIED=OK');
  contains(runSource, '/documents/courses/${courseId}/lessons/${lessonId}');
  contains(runSource, 'SUSPENDED_COURSE_CONSUMPTION_REVOKED=OK');
  contains(runSource, "'COURSE_NOT_PUBLISHED'");
});

test('cleanup valida ownership e remove subcolecoes antes dos cursos', () => {
  contains(cleanupSource, 'data.smokeRunId !== state.runId');
  contains(cleanupSource, "courseRef.collection('lessons')");
  contains(cleanupSource, "courseRef.collection('modules')");
  contains(cleanupSource, 'await courseRef.delete();');
  const lessonsIndex = cleanupSource.indexOf("courseRef.collection('lessons')");
  const courseDeleteIndex = cleanupSource.indexOf('await courseRef.delete();');
  assert.ok(lessonsIndex >= 0 && lessonsIndex < courseDeleteIndex);
});

test('falhas de transporte preservam diagnostico sanitizado', () => {
  contains(runSource, 'function sanitizeDiagnosticText(value)');
  contains(runSource, "response.headers.get('content-type')");
  contains(runSource, "responseKind = 'NON_JSON'");
  contains(runSource, 'HTTP_STATUS=${error.httpStatus}');
  contains(runSource, 'RESPONSE_CONTENT_TYPE=${error.responseContentType}');
  contains(runSource, 'RESPONSE_KIND=${error.responseKind}');
  contains(runSource, 'RESPONSE_PREVIEW=${error.responsePreview}');
  contains(runSource, '[REDACTED_TOKEN]');
  contains(runSource, '[REDACTED_EMAIL]');
});

test('estado local do smoke fica ignorado e producao nunca e executada', () => {
  contains(gitignore, 'functions/.course-protected-consumption-staging.local.json');
  contains(runSource, 'PRODUCTION_ACCESS=NOT_RUN');
  contains(cleanupSource, 'PRODUCTION_ACCESS=NOT_RUN');
  contains(runSource, 'PASSWORDS_PRINTED=False');
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

console.log(`COURSE_PROTECTED_CONSUMPTION_STAGING_SMOKE_V1_2=${passed}/${cases.length}`);
