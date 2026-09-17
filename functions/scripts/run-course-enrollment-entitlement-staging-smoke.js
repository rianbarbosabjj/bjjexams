'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { enrollmentDocumentId } = require('../src/courses/course-enrollment-domain');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const REGION = 'southamerica-east1';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const ALLOWED_BRANCH = 'feature/marco4b1-enrollment-entitlement';
const STATE_FILE = path.join(__dirname, '..', '.course-enrollment-entitlement-staging.local.json');
const WEB_CONFIG_FILE = path.join(__dirname, '..', '..', 'js', 'firebase-config.local.json');

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function saveState(state) { fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); }
function currentBranch() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: path.join(__dirname, '..', '..'),
    encoding: 'utf8'
  }).trim();
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '').trim();
  if (confirmation !== CONFIRMATION_VALUE) fail(`Smoke bloqueado. Defina BJJEXAMS_STAGING_SMOKE_CONFIRM=${CONFIRMATION_VALUE}.`);
  if (declaredProject === PRODUCTION_PROJECT) fail('Projeto de produção detectado. Execução bloqueada.');
  if (declaredProject && declaredProject !== TARGET_PROJECT) fail(`Projeto declarado incompatível com staging: ${declaredProject}.`);
  if (currentBranch() !== ALLOWED_BRANCH) fail(`Branch não autorizada. Esperado: ${ALLOWED_BRANCH}.`);
  if (!fs.existsSync(WEB_CONFIG_FILE)) fail('Configuração Web de staging ausente.');
  if (fs.existsSync(STATE_FILE)) fail('Já existe smoke 4B.1 pendente. Execute o cleanup antes de iniciar outro.');
  const config = readJson(WEB_CONFIG_FILE);
  if (config.projectId !== TARGET_PROJECT) fail(`Configuração Web incompatível: ${config.projectId || 'sem projectId'}.`);
  if (!config.apiKey) fail('Configuração Web de staging sem apiKey.');
  return config;
}

function randomPassword() { return `BjjExams-${crypto.randomBytes(18).toString('hex')}!Aa9`; }
function functionUrl(name) { return `https://${REGION}-${TARGET_PROJECT}.cloudfunctions.net/${name}`; }

async function signIn(apiKey, email, password) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

async function expectCallableError(name, idToken, data, expectedStatus, expectedDomainCode = null) {
  try {
    await callCallable(name, idToken, data);
  } catch (error) {
    if (error.callableStatus !== expectedStatus) {
      fail(`${name} falhou com ${error.callableStatus || error.httpStatus}; esperado ${expectedStatus}.`);
    }
    if (expectedDomainCode && error.details?.domainCode !== expectedDomainCode) {
      fail(`${name} retornou domainCode=${error.details?.domainCode || 'ausente'}; esperado ${expectedDomainCode}.`);
    }
    return error;
  }
  fail(`${name} deveria falhar com ${expectedStatus}, mas concluiu com sucesso.`);
}

async function assertDirectEnrollmentReadDenied(idToken, enrollmentId) {
  const url = `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT}/databases/(default)/documents/enrollments/${enrollmentId}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  assert(response.status === 403, `Leitura Firestore direta deveria ser negada; HTTP ${response.status}.`);
}

function courseFixture(overrides = {}) {
  return {
    title: 'SMOKE 4B.1',
    description: 'Curso temporário de staging para validar matrícula e entitlement do aluno.',
    ownerType: 'platform',
    ownerId: null,
    instructorIds: ['system-smoke'],
    visibility: 'platform',
    organizationId: null,
    status: 'published',
    isPaid: false,
    priceCents: 0,
    currency: 'BRL',
    publishedAt: FieldValue.serverTimestamp(),
    moduleCount: 0,
    lessonCount: 0,
    estimatedDurationMinutes: 0,
    ...overrides
  };
}

async function main() {
  const webConfig = validateEnvironment();
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const state = {
    projectId: TARGET_PROJECT,
    runId,
    userId: null,
    courseIds: [],
    enrollmentIds: [],
    membershipIds: [],
    createdAt: new Date().toISOString()
  };
  saveState(state);

  const app = initializeApp({ credential: applicationDefault(), projectId: TARGET_PROJECT }, `course-enrollment-smoke-${runId}`);
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 4B.1 - ENROLLMENT ENTITLEMENT STAGING SMOKE ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${runId}`);

  try {
    await Promise.all([auth.listUsers(1), db.collection('courses').limit(1).get()]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const studentEmail = `enrollment-student-${runId}@example.invalid`;
    const studentPassword = randomPassword();
    const student = await auth.createUser({ email: studentEmail, password: studentPassword, emailVerified: true });
    state.userId = student.uid;
    saveState(state);

    const freeCourseRef = db.collection('courses').doc();
    const paidCourseRef = db.collection('courses').doc();
    const organizationCourseRef = db.collection('courses').doc();
    const organizationId = `smoke-org-${runId}`;
    state.courseIds.push(freeCourseRef.id, paidCourseRef.id, organizationCourseRef.id);

    const freeEnrollmentId = enrollmentDocumentId(freeCourseRef.id, student.uid);
    const paidEnrollmentId = enrollmentDocumentId(paidCourseRef.id, student.uid);
    const organizationEnrollmentId = enrollmentDocumentId(organizationCourseRef.id, student.uid);
    state.enrollmentIds.push(freeEnrollmentId, paidEnrollmentId, organizationEnrollmentId);
    const membershipId = `smoke-membership-${runId}`;
    state.membershipIds.push(membershipId);
    saveState(state);

    const batch = db.batch();
    batch.set(db.doc(`usuarios/${student.uid}`), {
      nome: 'ENROLLMENT SMOKE STUDENT',
      email: studentEmail,
      tipo_usuario: 'aluno',
      papel_principal: 'aluno',
      papeis: ['aluno'],
      status_conta: 'ativo',
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });
    batch.create(freeCourseRef, {
      ...courseFixture({ title: 'SMOKE 4B.1 - Gratuito' }),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(paidCourseRef, {
      ...courseFixture({ title: 'SMOKE 4B.1 - Pago', isPaid: true, priceCents: 1990 }),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(organizationCourseRef, {
      ...courseFixture({
        title: 'SMOKE 4B.1 - Organização',
        ownerType: 'organization',
        ownerId: organizationId,
        visibility: 'organization',
        organizationId
      }),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    await batch.commit();
    console.log('TEMP_USER_CREATED=1');
    console.log('TEMP_COURSES_CREATED=3');
    console.log('LOCAL_STATE_FILE=READY');
    console.log('PASSWORDS_PRINTED=False');

    const studentToken = await signIn(webConfig.apiKey, studentEmail, studentPassword);
    console.log('TEMP_AUTHENTICATION=OK');

    const firstEnrollment = await callCallable('matricularCursoGratuitoV12', studentToken, { courseId: freeCourseRef.id });
    assert(firstEnrollment.created === true, 'Primeira matrícula gratuita deveria ser criada.');
    assert(firstEnrollment.enrollment?.id === freeEnrollmentId, 'ID determinístico da matrícula gratuita divergente.');
    assert(firstEnrollment.entitlement?.granted === true, 'Primeira matrícula deveria conceder entitlement.');

    const persistedFree = await db.doc(`enrollments/${freeEnrollmentId}`).get();
    assert(persistedFree.exists, 'Matrícula gratuita não foi persistida.');
    const persistedFreeData = persistedFree.data() || {};
    assert(persistedFreeData.userId === student.uid, 'Matrícula persistida pertence a outro usuário.');
    assert(persistedFreeData.courseId === freeCourseRef.id, 'Matrícula persistida pertence a outro curso.');
    assert(persistedFreeData.createdAt?.toMillis instanceof Function, 'createdAt persistido deveria ser Timestamp.');
    console.log('FREE_ENROLLMENT_CREATED=OK');

    const secondEnrollment = await callCallable('matricularCursoGratuitoV12', studentToken, { courseId: freeCourseRef.id });
    assert(secondEnrollment.created === false, 'Segunda matrícula deveria ser idempotente.');
    assert(secondEnrollment.enrollment?.id === freeEnrollmentId, 'Matrícula idempotente deveria preservar o mesmo ID.');
    console.log('FREE_ENROLLMENT_IDEMPOTENT=OK');

    const entitlement = await callCallable('obterEntitlementCursoV12', studentToken, { courseId: freeCourseRef.id });
    assert(entitlement.entitlement?.granted === true, 'Entitlement do curso gratuito deveria estar ativo.');
    assert(!Object.prototype.hasOwnProperty.call(entitlement, 'modules'), 'Entitlement não pode entregar módulos.');
    assert(!Object.prototype.hasOwnProperty.call(entitlement, 'lessons'), 'Entitlement não pode entregar aulas.');
    console.log('ENTITLEMENT_QUERY=OK');

    const myCourses = await callCallable('listarMeusCursosV12', studentToken, {});
    const freeMatches = (myCourses.courses || []).filter(item => item?.course?.id === freeCourseRef.id);
    assert(freeMatches.length === 1, 'Meus Cursos deveria listar a matrícula gratuita exatamente uma vez.');
    assert(freeMatches[0].entitlement?.granted === true, 'Meus Cursos deveria refletir entitlement ativo.');
    console.log('MY_COURSES=OK');

    await expectCallableError(
      'matricularCursoGratuitoV12',
      studentToken,
      { courseId: paidCourseRef.id },
      'FAILED_PRECONDITION',
      'PAYMENT_REQUIRED'
    );
    assert(!(await db.doc(`enrollments/${paidEnrollmentId}`).get()).exists, 'Curso pago não pode gerar matrícula gratuita.');
    console.log('PAID_COURSE_FREE_ENROLLMENT_BLOCKED=OK');

    await expectCallableError(
      'matricularCursoGratuitoV12',
      studentToken,
      { courseId: organizationCourseRef.id },
      'FAILED_PRECONDITION',
      'ORGANIZATION_MEMBERSHIP_REQUIRED'
    );
    console.log('ORGANIZATION_ENROLLMENT_WITHOUT_MEMBERSHIP_BLOCKED=OK');

    await db.doc(`vinculos_organizacao/${membershipId}`).set({
      usuario_id: student.uid,
      organizacao_id: organizationId,
      papel: 'aluno',
      status: 'ativo',
      principal: true,
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp(),
      atualizado_em: FieldValue.serverTimestamp()
    });

    const organizationEnrollment = await callCallable('matricularCursoGratuitoV12', studentToken, { courseId: organizationCourseRef.id });
    assert(organizationEnrollment.created === true, 'Membership ativo deveria permitir matrícula da organização.');
    assert(organizationEnrollment.enrollment?.id === organizationEnrollmentId, 'ID da matrícula organizacional divergente.');
    console.log('ORGANIZATION_ENROLLMENT_WITH_ACTIVE_MEMBERSHIP=OK');

    await db.doc(`vinculos_organizacao/${membershipId}`).update({
      status: 'encerrado',
      atualizado_em: FieldValue.serverTimestamp()
    });
    const organizationEntitlement = await callCallable('obterEntitlementCursoV12', studentToken, { courseId: organizationCourseRef.id });
    assert(organizationEntitlement.entitlement?.granted === false, 'Membership encerrado deve revogar entitlement organizacional.');
    assert(organizationEntitlement.entitlement?.reason === 'ORGANIZATION_MEMBERSHIP_REQUIRED', 'Motivo de revogação organizacional inesperado.');
    console.log('ORGANIZATION_ENTITLEMENT_REVOKED_WITH_ENDED_MEMBERSHIP=OK');

    await assertDirectEnrollmentReadDenied(studentToken, freeEnrollmentId);
    console.log('DIRECT_FIRESTORE_ENROLLMENT_READ_DENIED=OK');

    const auditSnap = await db.collection('audit_logs').where('entityId', '==', freeEnrollmentId).get();
    const matchingAudit = auditSnap.docs.some(doc => {
      const data = doc.data() || {};
      return data.action === 'course.enrollment.created' && data.actorId === student.uid;
    });
    assert(matchingAudit, 'Auditoria da matrícula gratuita não foi encontrada.');
    console.log('ENROLLMENT_AUDIT=OK');

    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4B1_ENROLLMENT_ENTITLEMENT_STAGING_SMOKE=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO4B1_ENROLLMENT_ENTITLEMENT_STAGING_SMOKE=FAILED');
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
