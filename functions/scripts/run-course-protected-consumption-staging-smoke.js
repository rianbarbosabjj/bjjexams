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
const ALLOWED_BRANCH = 'feature/marco4b2-protected-consumption';
const STATE_FILE = path.join(__dirname, '..', '.course-protected-consumption-staging.local.json');
const WEB_CONFIG_FILE = path.join(__dirname, '..', '..', 'js', 'firebase-config.local.json');

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function saveState(state) {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
}

function currentBranch() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: path.join(__dirname, '..', '..'),
    encoding: 'utf8'
  }).trim();
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || ''
  ).trim();

  if (confirmation !== CONFIRMATION_VALUE) {
    fail(`Smoke bloqueado. Defina BJJEXAMS_STAGING_SMOKE_CONFIRM=${CONFIRMATION_VALUE}.`);
  }
  if (declaredProject === PRODUCTION_PROJECT) {
    fail('Projeto de produção detectado. Execução bloqueada.');
  }
  if (declaredProject && declaredProject !== TARGET_PROJECT) {
    fail(`Projeto declarado incompatível com staging: ${declaredProject}.`);
  }
  if (currentBranch() !== ALLOWED_BRANCH) {
    fail(`Branch não autorizada. Esperado: ${ALLOWED_BRANCH}.`);
  }
  if (!fs.existsSync(WEB_CONFIG_FILE)) {
    fail('Configuração Web de staging ausente.');
  }
  if (fs.existsSync(STATE_FILE)) {
    fail('Já existe smoke 4B.2 pendente. Execute o cleanup antes de iniciar outro.');
  }

  const config = readJson(WEB_CONFIG_FILE);
  if (config.projectId !== TARGET_PROJECT) {
    fail(`Configuração Web incompatível: ${config.projectId || 'sem projectId'}.`);
  }
  if (!config.apiKey) fail('Configuração Web de staging sem apiKey.');
  return config;
}

function randomPassword() {
  return `BjjExams-${crypto.randomBytes(18).toString('hex')}!Aa9`;
}

function functionUrl(name) {
  return `https://${REGION}-${TARGET_PROJECT}.cloudfunctions.net/${name}`;
}

function sanitizeDiagnosticText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[REDACTED_TOKEN]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .slice(0, 240);
}

async function signIn(apiKey, email, password) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) {
    fail(`Falha ao autenticar fixture em staging: HTTP ${response.status}.`);
  }
  return body.idToken;
}

async function callCallable(name, idToken = null, data = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  try {
    const response = await fetch(functionUrl(name), {
      method: 'POST',
      headers,
      body: JSON.stringify({ data }),
      signal: controller.signal
    });
    const responseContentType = response.headers.get('content-type') || 'unknown';
    const rawBody = await response.text();
    let body = {};
    let responseKind = 'JSON';
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch (_error) {
      responseKind = 'NON_JSON';
    }
    if (!response.ok || !Object.prototype.hasOwnProperty.call(body, 'result')) {
      const error = new Error(body?.error?.message || `Callable ${name} falhou.`);
      error.httpStatus = response.status;
      error.callableStatus = body?.error?.status || null;
      error.details = body?.error?.details || null;
      error.responseContentType = responseContentType;
      error.responseKind = responseKind;
      error.responsePreview = responseKind === 'NON_JSON'
        ? sanitizeDiagnosticText(rawBody)
        : null;
      throw error;
    }
    return body.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function expectCallableError(
  name,
  idToken,
  data,
  expectedStatus,
  expectedDomainCode = null
) {
  try {
    await callCallable(name, idToken, data);
  } catch (error) {
    if (error.callableStatus !== expectedStatus) {
      fail(`${name} falhou com ${error.callableStatus || error.httpStatus}; esperado ${expectedStatus}.`);
    }
    if (expectedDomainCode && error.details?.domainCode !== expectedDomainCode) {
      fail(
        `${name} retornou domainCode=${error.details?.domainCode || 'ausente'}; esperado ${expectedDomainCode}.`
      );
    }
    return error;
  }
  fail(`${name} deveria falhar com ${expectedStatus}, mas concluiu com sucesso.`);
}

async function assertDirectFlatLessonReadDenied(idToken, courseId, lessonId) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT}` +
    `/databases/(default)/documents/courses/${courseId}/lessons/${lessonId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  assert(
    response.status === 403,
    `Leitura Firestore direta da aula plana deveria ser negada; HTTP ${response.status}.`
  );
}

function courseFixture(overrides = {}) {
  return {
    title: 'SMOKE 4B.2',
    description: 'Curso temporário de staging para validar consumo protegido.',
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
    contentRevision: 1,
    moduleCount: 1,
    lessonCount: 1,
    estimatedDurationMinutes: 10,
    ...overrides
  };
}

function moduleFixture(overrides = {}) {
  return {
    title: 'Fundamentos',
    description: 'Módulo temporário do smoke 4B.2.',
    position: 0,
    lessonCount: 1,
    ...overrides
  };
}

function lessonFixture(overrides = {}) {
  return {
    moduleId: null,
    title: 'Aula temporária',
    description: 'Aula criada exclusivamente para o smoke 4B.2.',
    position: 0,
    contentType: 'text',
    durationMinutes: 10,
    isPreview: false,
    videoUrl: null,
    body: 'SMOKE_4B2_PROTECTED_BODY',
    documentUrl: null,
    ...overrides
  };
}

function assertNoIntegralPayload(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('SMOKE_4B2_PROTECTED_BODY'), `${label} vazou corpo protegido.`);
  assert(!serialized.includes('SMOKE_4B2_PREVIEW_BODY'), `${label} vazou corpo de preview na estrutura.`);

  const inspectLessons = [];
  for (const module of value?.modules || []) {
    for (const lesson of module?.lessons || []) inspectLessons.push(lesson);
  }
  for (const lesson of inspectLessons) {
    assert(!Object.prototype.hasOwnProperty.call(lesson, 'body'), `${label} incluiu body.`);
    assert(!Object.prototype.hasOwnProperty.call(lesson, 'videoUrl'), `${label} incluiu videoUrl.`);
    assert(!Object.prototype.hasOwnProperty.call(lesson, 'documentUrl'), `${label} incluiu documentUrl.`);
  }
}

async function main() {
  const webConfig = validateEnvironment();
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const studentEmail = `consumption-student-${runId}@example.invalid`;
  const studentPassword = randomPassword();
  const organizationId = `smoke-org-${runId}`;

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

  const app = initializeApp(
    { credential: applicationDefault(), projectId: TARGET_PROJECT },
    `course-consumption-smoke-${runId}`
  );
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 4B.2 - PROTECTED CONSUMPTION STAGING SMOKE ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${runId}`);

  try {
    await Promise.all([auth.listUsers(1), db.collection('courses').limit(1).get()]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const student = await auth.createUser({
      email: studentEmail,
      password: studentPassword,
      emailVerified: true
    });
    state.userId = student.uid;

    const platformCourseRef = db.collection('courses').doc();
    const organizationCourseRef = db.collection('courses').doc();
    state.courseIds.push(platformCourseRef.id, organizationCourseRef.id);

    const platformEnrollmentId = enrollmentDocumentId(platformCourseRef.id, student.uid);
    const organizationEnrollmentId = enrollmentDocumentId(organizationCourseRef.id, student.uid);
    state.enrollmentIds.push(platformEnrollmentId, organizationEnrollmentId);

    const membershipId = `smoke-membership-${runId}`;
    state.membershipIds.push(membershipId);
    saveState(state);

    const platformModuleId = `module-platform-${runId}`;
    const previewLessonId = `lesson-preview-${runId}`;
    const protectedLessonId = `lesson-protected-${runId}`;
    const organizationModuleId = `module-organization-${runId}`;
    const organizationLessonId = `lesson-organization-${runId}`;

    const batch = db.batch();
    batch.set(db.doc(`usuarios/${student.uid}`), {
      nome: 'CONSUMPTION SMOKE STUDENT',
      email: studentEmail,
      tipo_usuario: 'aluno',
      papel_principal: 'aluno',
      papeis: ['aluno'],
      status_conta: 'ativo',
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });

    batch.create(platformCourseRef, {
      ...courseFixture({
        title: 'SMOKE 4B.2 - Plataforma',
        lessonCount: 2,
        estimatedDurationMinutes: 18
      }),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(platformCourseRef.collection('modules').doc(platformModuleId), {
      ...moduleFixture({ lessonCount: 2 }),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(platformCourseRef.collection('lessons').doc(previewLessonId), {
      ...lessonFixture({
        moduleId: platformModuleId,
        title: 'Preview temporário',
        position: 0,
        durationMinutes: 8,
        isPreview: true,
        body: 'SMOKE_4B2_PREVIEW_BODY'
      }),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(platformCourseRef.collection('lessons').doc(protectedLessonId), {
      ...lessonFixture({
        moduleId: platformModuleId,
        title: 'Aula protegida',
        position: 1,
        durationMinutes: 10,
        isPreview: false,
        body: 'SMOKE_4B2_PROTECTED_BODY'
      }),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    batch.create(organizationCourseRef, {
      ...courseFixture({
        title: 'SMOKE 4B.2 - Organização',
        ownerType: 'organization',
        ownerId: organizationId,
        visibility: 'organization',
        organizationId
      }),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(organizationCourseRef.collection('modules').doc(organizationModuleId), {
      ...moduleFixture({ lessonCount: 1 }),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(organizationCourseRef.collection('lessons').doc(organizationLessonId), {
      ...lessonFixture({
        moduleId: organizationModuleId,
        title: 'Aula institucional',
        isPreview: true,
        body: 'SMOKE_4B2_ORGANIZATION_BODY'
      }),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    const enrollmentBase = {
      userId: student.uid,
      source: 'free',
      orderId: null,
      status: 'active',
      progressPercent: 0,
      startedAt: FieldValue.serverTimestamp(),
      completedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      smokeRunId: runId
    };
    batch.create(db.doc(`enrollments/${platformEnrollmentId}`), {
      ...enrollmentBase,
      courseId: platformCourseRef.id
    });
    batch.create(db.doc(`enrollments/${organizationEnrollmentId}`), {
      ...enrollmentBase,
      courseId: organizationCourseRef.id
    });
    batch.create(db.doc(`vinculos_organizacao/${membershipId}`), {
      usuario_id: student.uid,
      organizacao_id: organizationId,
      papel: 'aluno',
      status: 'ativo',
      principal: true,
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp(),
      atualizado_em: FieldValue.serverTimestamp()
    });

    await batch.commit();
    console.log('TEMP_USER_CREATED=1');
    console.log('TEMP_COURSES_CREATED=2');
    console.log('TEMP_MODULES_CREATED=2');
    console.log('TEMP_LESSONS_CREATED=3');
    console.log('TEMP_ENROLLMENTS_CREATED=2');
    console.log('TEMP_MEMBERSHIPS_CREATED=1');
    console.log('LOCAL_STATE_FILE=READY');
    console.log('PASSWORDS_PRINTED=False');

    const studentToken = await signIn(webConfig.apiKey, studentEmail, studentPassword);
    console.log('TEMP_AUTHENTICATION=OK');

    const structure = await callCallable(
      'obterEstruturaConsumoCursoV12',
      studentToken,
      { courseId: platformCourseRef.id }
    );
    assert(structure.entitlement?.granted === true, 'Estrutura protegida exige entitlement concedido.');
    assert(structure.modules?.length === 1, 'Estrutura deveria conter um módulo.');
    assert(structure.modules[0]?.lessons?.length === 2, 'Estrutura deveria conter duas aulas resumidas.');
    assertNoIntegralPayload(structure, 'Estrutura protegida');
    console.log('PROTECTED_STRUCTURE_WITH_ENTITLEMENT=OK');
    console.log('PROTECTED_STRUCTURE_NO_INTEGRAL_PAYLOAD=OK');

    const entitledLesson = await callCallable(
      'obterAulaConsumoCursoV12',
      studentToken,
      { courseId: platformCourseRef.id, lessonId: protectedLessonId }
    );
    assert(entitledLesson.accessMode === 'entitled', 'Aula protegida deveria usar accessMode entitled.');
    assert(entitledLesson.lesson?.body === 'SMOKE_4B2_PROTECTED_BODY', 'Payload integral protegido divergente.');
    console.log('ENTITLED_LESSON_PAYLOAD=OK');

    const previewList = await callCallable(
      'listarPreviewsCursoV12',
      null,
      { courseId: platformCourseRef.id }
    );
    assert(previewList.previews?.length === 1, 'Listagem pública deveria retornar somente um preview.');
    assert(previewList.previews[0]?.id === previewLessonId, 'Listagem pública retornou aula incorreta.');
    const previewListSerialized = JSON.stringify(previewList);
    assert(!previewListSerialized.includes('SMOKE_4B2_PREVIEW_BODY'), 'Listagem de preview não pode entregar body.');
    assert(!Object.prototype.hasOwnProperty.call(previewList.previews[0], 'body'), 'Listagem de preview incluiu body.');
    console.log('PUBLIC_PREVIEW_LIST_SAFE=OK');

    const anonymousPreview = await callCallable(
      'obterAulaConsumoCursoV12',
      null,
      { courseId: platformCourseRef.id, lessonId: previewLessonId }
    );
    assert(anonymousPreview.accessMode === 'preview', 'Preview anônimo deveria usar accessMode preview.');
    assert(anonymousPreview.entitlement === null, 'Preview anônimo não deve criar ou simular entitlement.');
    assert(anonymousPreview.lesson?.body === 'SMOKE_4B2_PREVIEW_BODY', 'Payload do preview divergente.');
    console.log('ANONYMOUS_PREVIEW=OK');

    await expectCallableError(
      'obterAulaConsumoCursoV12',
      null,
      { courseId: platformCourseRef.id, lessonId: protectedLessonId },
      'NOT_FOUND'
    );
    console.log('PROTECTED_LESSON_WITHOUT_ENTITLEMENT_BLOCKED=OK');

    const organizationStructure = await callCallable(
      'obterEstruturaConsumoCursoV12',
      studentToken,
      { courseId: organizationCourseRef.id }
    );
    assert(organizationStructure.entitlement?.granted === true, 'Membership ativo deveria permitir consumo institucional.');
    assertNoIntegralPayload(organizationStructure, 'Estrutura institucional');
    console.log('ORGANIZATION_CONSUMPTION_WITH_ACTIVE_MEMBERSHIP=OK');

    await expectCallableError(
      'obterAulaConsumoCursoV12',
      null,
      { courseId: organizationCourseRef.id, lessonId: organizationLessonId },
      'NOT_FOUND'
    );
    await expectCallableError(
      'listarPreviewsCursoV12',
      null,
      { courseId: organizationCourseRef.id },
      'NOT_FOUND'
    );
    console.log('ORGANIZATION_PUBLIC_PREVIEW_BLOCKED=OK');

    await db.doc(`vinculos_organizacao/${membershipId}`).update({
      status: 'encerrado',
      atualizado_em: FieldValue.serverTimestamp()
    });
    await expectCallableError(
      'obterEstruturaConsumoCursoV12',
      studentToken,
      { courseId: organizationCourseRef.id },
      'PERMISSION_DENIED',
      'ORGANIZATION_MEMBERSHIP_REQUIRED'
    );
    console.log('ORGANIZATION_CONSUMPTION_REVOKED_WITH_ENDED_MEMBERSHIP=OK');

    await assertDirectFlatLessonReadDenied(
      studentToken,
      platformCourseRef.id,
      protectedLessonId
    );
    console.log('DIRECT_FIRESTORE_FLAT_LESSON_READ_DENIED=OK');

    await platformCourseRef.update({
      status: 'suspended',
      updatedAt: FieldValue.serverTimestamp()
    });
    await expectCallableError(
      'obterEstruturaConsumoCursoV12',
      studentToken,
      { courseId: platformCourseRef.id },
      'PERMISSION_DENIED',
      'COURSE_NOT_PUBLISHED'
    );
    await expectCallableError(
      'listarPreviewsCursoV12',
      null,
      { courseId: platformCourseRef.id },
      'NOT_FOUND'
    );
    console.log('SUSPENDED_COURSE_CONSUMPTION_REVOKED=OK');

    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4B2_PROTECTED_CONSUMPTION_STAGING_SMOKE=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO4B2_PROTECTED_CONSUMPTION_STAGING_SMOKE=FAILED');
  console.error(`ERROR=${error.message}`);
  if (error.httpStatus) console.error(`HTTP_STATUS=${error.httpStatus}`);
  if (error.callableStatus) console.error(`CALLABLE_STATUS=${error.callableStatus}`);
  if (error.details?.domainCode) console.error(`DOMAIN_CODE=${error.details.domainCode}`);
  if (error.responseContentType) {
    console.error(`RESPONSE_CONTENT_TYPE=${error.responseContentType}`);
  }
  if (error.responseKind) console.error(`RESPONSE_KIND=${error.responseKind}`);
  if (error.responsePreview) console.error(`RESPONSE_PREVIEW=${error.responsePreview}`);
  process.exitCode = 1;
});
