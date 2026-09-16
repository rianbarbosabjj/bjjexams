'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const submission = read('functions/src/courses/course-moderation-submission-functions.js');
const main = read('functions/main.js');
const browserApi = read('js/course-hybrid-moderation-api-v1_2.js');
const exceptionUi = read('js/course-exception-review-ui-v1_2.js');
const instructorPatch = read('scripts/apply-marco4a4c-instructor-hybrid-ui.ps1');
const adminPatch = read('scripts/apply-marco4a4c-admin-ui.ps1');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('backend exige aceite versionado antes da triagem', () => {
  assert.ok(submission.includes("RESPONSIBILITY_TERMS_VERSION"));
  assert.ok(submission.includes("responsibilityAccepted"));
  assert.ok(submission.includes("Aceite o Termo de Responsabilidade"));
});

test('conteudo e bloqueado em review antes de chamar o provedor', () => {
  const lockIndex = submission.indexOf("status: 'review'");
  const providerIndex = submission.indexOf('await moderateSafely(lockedCourse)');
  assert.ok(lockIndex >= 0 && providerIndex > lockIndex);
});

test('fingerprint protege contra alteracao durante a moderacao', () => {
  assert.ok(submission.includes('contentFingerprint'));
  assert.ok(submission.includes('CONTENT_CHANGED_DURING_MODERATION'));
});

test('falha do provedor nunca publica automaticamente', () => {
  assert.ok(submission.includes("providerReasonCodes: ['PROVIDER_ERROR']"));
  assert.ok(submission.includes("status: 'manual_review'"));
});

test('decisoes automaticas geram auditoria de sistema', () => {
  assert.ok(submission.includes("actorRole: 'ai_moderator'"));
  assert.ok(submission.includes('course.moderation.submitted'));
  assert.ok(submission.includes('course.moderation.${outcome.decision}'));
});

test('fila administrativa retorna apenas review e suspended', () => {
  assert.ok(submission.includes("course.status === 'review' || course.status === 'suspended'"));
});

test('segredo openai fica vinculado somente ao backend', () => {
  assert.ok(main.includes('defineSecret'));
  assert.ok(main.includes('OPENAI_COURSE_MODERATION_API_KEY'));
  assert.ok(main.includes('secrets: [OPENAI_COURSE_MODERATION_API_KEY]'));
  assert.ok(!browserApi.includes('OPENAI_COURSE_MODERATION_API_KEY'));
});

test('browser hybrid api usa localhost em staging', () => {
  const api = require('../js/course-hybrid-moderation-api-v1_2.js');
  assert.strictEqual(api.inferEnvironment({ hostname: '127.0.0.1' }), 'staging');
  assert.ok(api.functionUrl('solicitarPublicacaoCursoV12', { hostname: '127.0.0.1' }).includes('bjj-exams-staging'));
});

test('browser api nao permite callable fora do contrato', () => {
  const api = require('../js/course-hybrid-moderation-api-v1_2.js');
  assert.throws(() => api.functionUrl('qualquerOutraFunction', { hostname: '127.0.0.1' }), /fora do contrato/);
});

test('patch do instrutor exige checkbox e versao do termo', () => {
  assert.ok(instructorPatch.includes('course-v12-responsibility'));
  assert.ok(instructorPatch.includes('RESPONSIBILITY_TERMS_VERSION'));
  assert.ok(instructorPatch.includes('submitForPublication(courseId'));
});

test('tela administrativa passa a ser revisao por excecao', () => {
  assert.ok(adminPatch.includes('Revis&#227;o de Conte&#250;do'));
  assert.ok(adminPatch.includes('js/course-exception-review-ui-v1_2.js'));
  assert.ok(exceptionUi.includes('Nenhuma exceção aguardando revisão humana.'));
});

test('revisao humana preserva override manual via backend canonico', () => {
  assert.ok(exceptionUi.includes('courseApi.changeStatus(course.id, targetStatus, options)'));
  assert.ok(exceptionUi.includes('Aprovar e publicar'));
  assert.ok(exceptionUi.includes('Solicitar ajustes'));
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

console.log(`COURSE_HYBRID_MODERATION_WORKFLOW_V1_2=${passed}/${cases.length}`);
