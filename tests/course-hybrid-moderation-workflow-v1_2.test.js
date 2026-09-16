'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const submission = read('functions/src/courses/course-moderation-submission-functions.js');
const provider = read('functions/src/courses/course-moderation-provider-gemini.js');
const main = read('functions/main.js');
const browserApi = read('js/course-hybrid-moderation-api-v1_2.js');
const exceptionUi = read('js/course-exception-review-ui-v1_2.js');
const instructorPatch = read('scripts/apply-marco4a4c-instructor-hybrid-ui.ps1');
const adminPatch = read('scripts/apply-marco4a4c-admin-ui.ps1');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('backend exige aceite versionado antes da triagem', () => {
  assert.ok(submission.includes('RESPONSIBILITY_TERMS_VERSION'));
  assert.ok(submission.includes('responsibilityAccepted'));
  assert.ok(submission.includes('Aceite o Termo de Responsabilidade'));
});

test('conteudo e bloqueado em review antes de chamar o provedor', () => {
  const lockIndex = submission.indexOf("status: 'review'");
  const providerIndex = submission.indexOf('await moderateSafely(lockedCourse');
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

test('falha do provedor gera diagnostico sanitizado e correlacionavel', () => {
  assert.ok(submission.includes('COURSE_MODERATION_PROVIDER_ERROR'));
  assert.ok(submission.includes('courseId: context.courseId || null'));
  assert.ok(submission.includes('submissionId: context.submissionId || null'));
  assert.ok(submission.includes('error?.safeDiagnostic || fallbackDiagnostic(error)'));
  assert.ok(!submission.includes('OPENAI_COURSE_MODERATION_API_KEY'));
  assert.ok(!submission.includes('GEMINI_COURSE_MODERATION_API_KEY'));
});

test('decisoes automaticas geram auditoria de sistema', () => {
  assert.ok(submission.includes("actorRole: 'ai_moderator'"));
  assert.ok(submission.includes('course.moderation.submitted'));
  assert.ok(submission.includes('course.moderation.${outcome.decision}'));
});

test('fila administrativa filtra excecoes no servidor antes do limite', () => {
  assert.ok(submission.includes(".where('status', 'in', ['review', 'suspended'])"));
  assert.ok(submission.includes('.limit(100)'));
  assert.ok(!submission.includes(".filter(course => course.status === 'review' || course.status === 'suspended')"));
});

test('fila administrativa ordena excecoes apos a consulta filtrada', () => {
  assert.ok(submission.includes('updatedAtMillis'));
  assert.ok(submission.includes('.sort((left, right) => updatedAtMillis(right.updatedAt) - updatedAtMillis(left.updatedAt))'));
});

test('segredo Gemini fica vinculado somente ao backend', () => {
  assert.ok(main.includes('defineSecret'));
  assert.ok(main.includes('GEMINI_COURSE_MODERATION_API_KEY'));
  assert.ok(main.includes('secrets: [GEMINI_COURSE_MODERATION_API_KEY]'));
  assert.ok(!browserApi.includes('GEMINI_COURSE_MODERATION_API_KEY'));
});

test('provider usa Gemini 3.6 Flash via Interactions API', () => {
  assert.ok(provider.includes('gemini-3.6-flash'));
  assert.ok(provider.includes('https://generativelanguage.googleapis.com/v1beta/interactions'));
  assert.ok(provider.includes("provider: 'google-gemini'"));
  assert.ok(!provider.includes('api.openai.com'));
});

test('provider nao persiste interacao no Gemini', () => {
  assert.ok(provider.includes('store: false'));
});

test('provider envia somente titulo e descricao ao Gemini', () => {
  assert.ok(provider.includes('minimalCourseInput'));
  assert.ok(provider.includes('title: text(course.title'));
  assert.ok(provider.includes('description: text(course.description'));
  assert.ok(!provider.includes('ownerId:'));
  assert.ok(!provider.includes('priceCents:'));
});

test('browser hybrid api usa localhost em staging', () => {
  const api = require('../js/course-hybrid-moderation-api-v1_2.js');
  assert.strictEqual(api.inferEnvironment({ hostname: '127.0.0.1' }), 'staging');
  assert.ok(api.functionUrl('solicitarPublicacaoCursoV12', { hostname: '127.0.0.1' }).includes('bjj-exams-staging'));
});

test('browser api inclui callable de decisao humana no contrato', () => {
  const api = require('../js/course-hybrid-moderation-api-v1_2.js');
  assert.ok(api.functionUrl('registrarDecisaoModeracaoV12', { hostname: '127.0.0.1' }).includes('bjj-exams-staging'));
  assert.strictEqual(typeof api.resolveException, 'function');
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

test('patch do instrutor suporta controller carregado como modulo', () => {
  assert.ok(instructorPatch.includes('<script type="module" src="js/course-instructor-ui-v1_2.js"></script>'));
  assert.ok(instructorPatch.includes('js/course-hybrid-moderation-api-v1_2.js'));
});

test('tela administrativa passa a ser revisao por excecao', () => {
  assert.ok(adminPatch.includes('Revis&#227;o de Conte&#250;do'));
  assert.ok(adminPatch.includes('js/course-exception-review-ui-v1_2.js'));
  assert.ok(exceptionUi.includes('Nenhuma exceção aguardando revisão humana.'));
});

test('revisao humana exige motivo antes do override', () => {
  assert.ok(exceptionUi.includes('input: "textarea"'));
  assert.ok(exceptionUi.includes('reason.length < 10'));
  assert.ok(browserApi.includes('decisionReason.length < 10'));
  assert.ok(submission.includes('reason.length < 10'));
});

test('revisao humana preserva resultado automatico e gera auditoria propria', () => {
  assert.ok(exceptionUi.includes('hybridApi.resolveException(course.id, targetStatus, reason, options)'));
  assert.ok(submission.includes("action: 'course.moderation.human_override'"));
  assert.ok(submission.includes('moderationPreserved: true'));
  assert.ok(submission.includes('lastModerationOverride'));
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
