'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  PUBLICATION_SNAPSHOT_VERSION,
  MODERATION_SCOPE_VERSION,
  publicationFingerprint
} = require('../src/courses/course-publication-snapshot');
const { RESPONSIBILITY_TERMS_VERSION } = require('../src/courses/course-moderation-policy');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const REGION = 'southamerica-east1';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const ALLOWED_BRANCH = 'feature/marco4a5c-content-fingerprint';
const STATE_FILE = path.join(__dirname, '..', '.course-publication-fingerprint-staging-smoke.local.json');
const WEB_CONFIG_FILE = path.join(__dirname, '..', '..', 'js', 'firebase-config.local.json');

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function currentBranch() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: path.join(__dirname, '..', '..'), encoding: 'utf8'
  }).trim();
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '').trim();
  if (confirmation !== CONFIRMATION_VALUE) fail(`Smoke bloqueado. Defina BJJEXAMS_STAGING_SMOKE_CONFIRM=${CONFIRMATION_VALUE}.`);
  if (declaredProject === PRODUCTION_PROJECT) fail('Projeto de produção detectado. Execução bloqueada.');
  if (declaredProject && declaredProject !== TARGET_PROJECT) fail(`Projeto declarado incompatível com staging: ${declaredProject}.`);
  if (currentBranch() !== ALLOWED_BRANCH) fail(`Branch não autorizada. Esperado: ${ALLOWED_BRANCH}.`);
  if (!fs.existsSync(WEB_CONFIG_FILE)) fail('Configuração Web de staging ausente. Execute prepare-staging-firebase-web-config.ps1.');
  if (fs.existsSync(STATE_FILE)) fail('Já existe smoke 4A.5c pendente. Execute o cleanup antes de iniciar outro.');
  const config = readJson(WEB_CONFIG_FILE);
  if (config.projectId !== TARGET_PROJECT) fail(`Configuração Web incompatível: ${config.projectId || 'sem projectId'}.`);
  if (!config.apiKey) fail('Configuração Web de staging sem apiKey.');
  return config;
}

function randomPassword() { return `BjjExams-${crypto.randomBytes(18).toString('hex')}!Aa9`; }
function functionUrl(name) { return `https://${REGION}-${TARGET_PROJECT}.cloudfunctions.net/${name}`; }

async function signIn(apiKey, email, password) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) fail(`Falha ao autenticar fixture em staging: HTTP ${response.status}.`);
  return body.idToken;
}

async function callCallable(name, idToken, data = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(functionUrl(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data }),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !Object.prototype.hasOwnProperty.call(body, 'result')) {
      const error = new Error(body?.error?.message || `Callable ${name} falhou.`);
      error.httpStatus = response.status;
      error.callableStatus = body?.error?.status || null;
      error.details = body?.error?.details || null;
      throw error;
    }
    return body.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function expectCallableError(name, idToken, data, expectedStatus) {
  try {
    await callCallable(name, idToken, data);
  } catch (error) {
    if (error.callableStatus === expectedStatus) return error;
    fail(`${name} falhou com ${error.callableStatus || error.httpStatus}; esperado ${expectedStatus}.`);
  }
  fail(`${name} deveria falhar com ${expectedStatus}, mas concluiu com sucesso.`);
}

function entry(id, data) { return { id, data }; }

async function main() {
  const webConfig = validateEnvironment();
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const app = initializeApp({ credential: applicationDefault(), projectId: TARGET_PROJECT }, `course-fingerprint-smoke-${runId}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const state = { projectId: TARGET_PROJECT, runId, userIds: [], courseIds: [], createdAt: new Date().toISOString() };

  console.log('=== MARCO 4A.5c - PUBLICATION FINGERPRINT STAGING SMOKE ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${runId}`);

  try {
    await Promise.all([auth.listUsers(1), db.collection('courses').limit(1).get()]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const ownerEmail = `fingerprint-owner-${runId}@example.invalid`;
    const moderatorEmail = `fingerprint-moderator-${runId}@example.invalid`;
    const ownerPassword = randomPassword();
    const moderatorPassword = randomPassword();
    const [owner, moderator] = await Promise.all([
      auth.createUser({ email: ownerEmail, password: ownerPassword, emailVerified: true }),
      auth.createUser({ email: moderatorEmail, password: moderatorPassword, emailVerified: true })
    ]);
    state.userIds.push(owner.uid, moderator.uid);
    await auth.setCustomUserClaims(moderator.uid, { platform_admin: true });

    const submittedCourseRef = db.collection('courses').doc();
    const staleCourseRef = db.collection('courses').doc();
    state.courseIds.push(submittedCourseRef.id, staleCourseRef.id);

    const submittedModule = { title: 'Fundamentos', description: 'Bases para segurança no treino.', position: 0, lessonCount: 2 };
    const submittedLessonA = {
      moduleId: 'm1', title: 'Introdução segura', description: 'Contexto esportivo e regras de segurança.', position: 0,
      contentType: 'video', durationMinutes: 5, isPreview: true, videoUrl: 'https://example.com/fingerprint-video', body: null, documentUrl: null
    };
    const submittedLessonB = {
      moduleId: 'm1', title: 'Resumo técnico', description: 'Resumo estrutural do módulo.', position: 1,
      contentType: 'text', durationMinutes: 4, isPreview: false, videoUrl: null, body: 'Corpo integral local que não deve ser enviado ao provedor.', documentUrl: null
    };
    const submittedCourse = {
      title: 'SMOKE 4A.5c - Fingerprint estrutural',
      description: 'Curso temporário de jiu-jitsu esportivo para validar fingerprint estrutural em staging.',
      ownerType: 'user', ownerId: owner.uid, instructorIds: [owner.uid], visibility: 'platform', organizationId: null,
      status: 'draft', isPaid: false, priceCents: 0, currency: 'BRL', contentRevision: 3,
      moduleCount: 1, lessonCount: 2, estimatedDurationMinutes: 9, smokeRunId: runId
    };

    const staleModule = { title: 'Módulo revisado', description: 'Conteúdo previamente triado.', position: 0, lessonCount: 1 };
    const staleLesson = {
      moduleId: 'm1', title: 'Aula triada', description: 'Descrição previamente triada.', position: 0,
      contentType: 'text', durationMinutes: 3, isPreview: false, videoUrl: null, body: 'Versão inicialmente triada.', documentUrl: null
    };
    const staleCourse = {
      title: 'SMOKE 4A.5c - Override stale',
      description: 'Curso temporário em revisão para validar bloqueio de publicação humana com conteúdo alterado.',
      ownerType: 'user', ownerId: owner.uid, instructorIds: [owner.uid], visibility: 'platform', organizationId: null,
      status: 'review', isPaid: false, priceCents: 0, currency: 'BRL', contentRevision: 2,
      moduleCount: 1, lessonCount: 1, estimatedDurationMinutes: 3, smokeRunId: runId
    };
    const staleFingerprint = publicationFingerprint({
      course: staleCourse,
      modules: [entry('m1', staleModule)],
      lessons: [entry('l1', staleLesson)]
    });

    const batch = db.batch();
    for (const [user, email, role] of [[owner, ownerEmail, 'instrutor'], [moderator, moderatorEmail, 'platform_admin']]) {
      batch.set(db.doc(`usuarios/${user.uid}`), {
        nome: role === 'instrutor' ? 'FINGERPRINT SMOKE OWNER' : 'FINGERPRINT SMOKE MODERATOR',
        email, tipo_usuario: role === 'instrutor' ? 'professor' : 'admin', papel_principal: role,
        papeis: [role], status_conta: 'ativo', smokeRunId: runId, criado_em: FieldValue.serverTimestamp()
      });
    }
    batch.create(submittedCourseRef, { ...submittedCourse, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    batch.create(submittedCourseRef.collection('modules').doc('m1'), { ...submittedModule, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    batch.create(submittedCourseRef.collection('lessons').doc('l1'), { ...submittedLessonA, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    batch.create(submittedCourseRef.collection('lessons').doc('l2'), { ...submittedLessonB, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    batch.create(staleCourseRef, {
      ...staleCourse,
      moderation: {
        mode: 'ai', status: 'manual_review', riskLevel: 'medium', confidence: 0.5, requiresHumanReview: true,
        reasonCodes: ['SMOKE_FIXTURE'], summary: 'Fixture de staging.', policyVersion: 'course-content-v1',
        provider: 'fixture', model: 'fixture', checkedBy: 'system:course-moderation', submissionId: `fixture-${runId}`,
        contentHash: staleFingerprint.hash, contentHashVersion: staleFingerprint.version,
        contentRevision: staleFingerprint.contentRevision, moderationScopeVersion: MODERATION_SCOPE_VERSION,
        checkedAt: FieldValue.serverTimestamp()
      },
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(staleCourseRef.collection('modules').doc('m1'), { ...staleModule, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    batch.create(staleCourseRef.collection('lessons').doc('l1'), { ...staleLesson, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();

    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log('TEMP_USERS_CREATED=2');
    console.log('TEMP_COURSES_CREATED=2');
    console.log('LOCAL_STATE_FILE=READY');
    console.log('PASSWORDS_PRINTED=False');

    const [ownerToken, moderatorToken] = await Promise.all([
      signIn(webConfig.apiKey, ownerEmail, ownerPassword),
      signIn(webConfig.apiKey, moderatorEmail, moderatorPassword)
    ]);
    console.log('TEMP_AUTHENTICATION=OK');

    const expectedSubmittedFingerprint = publicationFingerprint({
      course: submittedCourse,
      modules: [entry('m1', submittedModule)],
      lessons: [entry('l1', submittedLessonA), entry('l2', submittedLessonB)]
    });

    await callCallable('solicitarPublicacaoCursoV12', ownerToken, {
      courseId: submittedCourseRef.id,
      responsibilityAccepted: true,
      termsVersion: RESPONSIBILITY_TERMS_VERSION
    });

    const submittedSnap = await submittedCourseRef.get();
    const submittedAfter = submittedSnap.data() || {};
    const responsibility = submittedAfter.contentResponsibility || {};
    const moderation = submittedAfter.moderation || {};
    assert(responsibility.contentHash === expectedSubmittedFingerprint.hash, 'contentResponsibility.contentHash não corresponde ao snapshot estrutural esperado.');
    assert(responsibility.contentHashVersion === PUBLICATION_SNAPSHOT_VERSION, 'Versão do hash de responsabilidade inesperada.');
    assert(Number(responsibility.contentRevision) === 3, 'contentRevision da responsabilidade deveria ser 3.');
    assert(responsibility.moderationScopeVersion === MODERATION_SCOPE_VERSION, 'Escopo de moderação da responsabilidade inesperado.');
    assert(moderation.contentHash === expectedSubmittedFingerprint.hash, 'moderation.contentHash não corresponde ao snapshot submetido.');
    assert(moderation.contentHashVersion === PUBLICATION_SNAPSHOT_VERSION, 'Versão do hash da moderação inesperada.');
    assert(Number(moderation.contentRevision) === 3, 'contentRevision da moderação deveria ser 3.');
    assert(moderation.moderationScopeVersion === MODERATION_SCOPE_VERSION, 'Escopo de moderação persistido inesperado.');
    console.log('STRUCTURAL_FINGERPRINT_PERSISTED=OK');
    console.log(`MODERATION_FINAL_STATUS=${String(submittedAfter.status || 'unknown')}`);

    await staleCourseRef.collection('lessons').doc('l1').update({
      body: 'Conteúdo alterado após a triagem.',
      updatedAt: FieldValue.serverTimestamp()
    });
    await staleCourseRef.update({ contentRevision: 3, updatedAt: FieldValue.serverTimestamp() });

    await expectCallableError('registrarDecisaoModeracaoV12', moderatorToken, {
      courseId: staleCourseRef.id,
      status: 'published',
      reason: 'Smoke staging: tentativa controlada de publicar snapshot estrutural desatualizado.'
    }, 'FAILED_PRECONDITION');

    const staleAfter = (await staleCourseRef.get()).data() || {};
    assert(staleAfter.status === 'review', 'Curso stale deveria permanecer em review após bloqueio do override.');
    assert(!staleAfter.publishedAt, 'Curso stale não pode receber publishedAt.');
    console.log('STALE_HUMAN_OVERRIDE_BLOCKED=OK');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4A5C_PUBLICATION_FINGERPRINT_STAGING_SMOKE=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO4A5C_PUBLICATION_FINGERPRINT_STAGING_SMOKE=FAILED');
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
