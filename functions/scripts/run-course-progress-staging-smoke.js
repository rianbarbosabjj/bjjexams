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
const ALLOWED_BRANCH = 'feature/marco4b3-course-progress';
const STATE_FILE = path.join(__dirname, '..', '.course-progress-staging.local.json');
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
    fail('Já existe smoke 4B.3 pendente. Execute o cleanup antes de iniciar outro.');
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

async function callCallable(name, idToken, data = {}) {
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

async function expectCallableError(name, idToken, data, expectedStatus, expectedDomainCode = null) {
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

async function assertDirectProgressReadDenied(idToken, enrollmentId, lessonId) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT}` +
    `/databases/(default)/documents/enrollments/${enrollmentId}/lesson_progress/${lessonId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  assert(
    response.status === 403,
    `Leitura Firestore direta do progresso deveria ser negada; HTTP ${response.status}.`
  );
}

function courseFixture(overrides = {}) {
  return {
    title: 'SMOKE 4B.3 - Progresso',
    description: 'Curso temporário de staging para validar progresso por aula e conclusão.',
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
    lessonCount: 2,
    estimatedDurationMinutes: 20,
    ...overrides
  };
}

function moduleFixture(overrides = {}) {
  return {
    title: 'Fundamentos',
    description: 'Módulo temporário do smoke 4B.3.',
    position: 0,
    lessonCount: 2,
    ...overrides
  };
}

function lessonFixture(moduleId, position, title) {
  return {
    moduleId,
    title,
    description: 'Aula criada exclusivamente para o smoke 4B.3.',
    position,
    contentType: 'text',
    durationMinutes: 10,
    isPreview: false,
    videoUrl: null,
    body: `SMOKE_4B3_BODY_${position + 1}`,
    documentUrl: null
  };
}

async function progressAuditsForUser(db, uid, enrollmentId) {
  const snap = await db.collection('audit_logs').where('actorId', '==', uid).get();
  return snap.docs
    .filter(doc => {
      const data = doc.data() || {};
      return data.entityType === 'course_progress' &&
        String(data.entityId || '').startsWith(enrollmentId);
    })
    .map(doc => ({ id: doc.id, ...doc.data() }));
}

function assertInitialProgress(result) {
  assert(result.entitlement?.granted === true, 'Consulta inicial exige entitlement válido.');
  assert(result.progress?.completedLessonCount === 0, 'Progresso inicial deve ter zero aulas concluídas.');
  assert(result.progress?.totalLessonCount === 2, 'Total inicial deve ser duas aulas.');
  assert(result.progress?.progressPercent === 0, 'Percentual inicial deve ser zero.');
  assert(result.progress?.courseCompleted === false, 'Curso não pode iniciar concluído.');
  assert(Array.isArray(result.progress?.completedLessonIds), 'Consulta precisa retornar IDs concluídos.');
  assert(result.progress.completedLessonIds.length === 0, 'Lista inicial de aulas concluídas deve estar vazia.');
}

async function main() {
  const webConfig = validateEnvironment();
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const studentEmail = `progress-student-${runId}@example.invalid`;
  const studentPassword = randomPassword();

  const state = {
    projectId: TARGET_PROJECT,
    runId,
    userId: null,
    courseIds: [],
    enrollmentIds: [],
    createdAt: new Date().toISOString()
  };
  saveState(state);

  const app = initializeApp(
    { credential: applicationDefault(), projectId: TARGET_PROJECT },
    `course-progress-smoke-${runId}`
  );
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 4B.3 - COURSE PROGRESS STAGING SMOKE ===');
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

    const courseRef = db.collection('courses').doc();
    state.courseIds.push(courseRef.id);
    const enrollmentId = enrollmentDocumentId(courseRef.id, student.uid);
    state.enrollmentIds.push(enrollmentId);
    saveState(state);

    const moduleId = `module-progress-${runId}`;
    const lessonOneId = `lesson-progress-1-${runId}`;
    const lessonTwoId = `lesson-progress-2-${runId}`;
    const enrollmentRef = db.doc(`enrollments/${enrollmentId}`);

    const batch = db.batch();
    batch.set(db.doc(`usuarios/${student.uid}`), {
      nome: 'PROGRESS SMOKE STUDENT',
      email: studentEmail,
      tipo_usuario: 'aluno',
      papel_principal: 'aluno',
      papeis: ['aluno'],
      status_conta: 'ativo',
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });
    batch.create(courseRef, {
      ...courseFixture(),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(courseRef.collection('modules').doc(moduleId), {
      ...moduleFixture(),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(courseRef.collection('lessons').doc(lessonOneId), {
      ...lessonFixture(moduleId, 0, 'Aula um'),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(courseRef.collection('lessons').doc(lessonTwoId), {
      ...lessonFixture(moduleId, 1, 'Aula dois'),
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(enrollmentRef, {
      courseId: courseRef.id,
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
    });
    await batch.commit();

    console.log('TEMP_USER_CREATED=1');
    console.log('TEMP_COURSES_CREATED=1');
    console.log('TEMP_MODULES_CREATED=1');
    console.log('TEMP_LESSONS_CREATED=2');
    console.log('TEMP_ENROLLMENTS_CREATED=1');
    console.log('LOCAL_STATE_FILE=READY');
    console.log('PASSWORDS_PRINTED=False');

    const studentToken = await signIn(webConfig.apiKey, studentEmail, studentPassword);
    console.log('TEMP_AUTHENTICATION=OK');

    const initial = await callCallable(
      'obterProgressoCursoV12',
      studentToken,
      { courseId: courseRef.id }
    );
    assertInitialProgress(initial);
    console.log('INITIAL_PROGRESS_ZERO=OK');

    const firstCompletion = await callCallable(
      'concluirAulaCursoV12',
      studentToken,
      { courseId: courseRef.id, lessonId: lessonOneId }
    );
    assert(firstCompletion.changed === true, 'Primeira conclusão precisa alterar o progresso.');
    assert(firstCompletion.progress?.completedLessonCount === 1, 'Primeira conclusão precisa contar uma aula.');
    assert(firstCompletion.progress?.progressPercent === 50, 'Primeira conclusão precisa resultar em 50%.');
    assert(firstCompletion.progress?.courseCompleted === false, 'Primeira conclusão não pode concluir o curso.');
    assert(firstCompletion.progress?.status === 'active', 'Matrícula deve permanecer ativa após primeira aula.');
    console.log('FIRST_LESSON_COMPLETED=OK');

    const [enrollmentAfterFirst, detailAfterFirst] = await Promise.all([
      enrollmentRef.get(),
      enrollmentRef.collection('lesson_progress').doc(lessonOneId).get()
    ]);
    assert(enrollmentAfterFirst.exists, 'Matrícula precisa existir após primeira conclusão.');
    assert(detailAfterFirst.exists, 'Detalhe da primeira aula precisa existir.');
    assert(enrollmentAfterFirst.data().completedLessonCount === 1, 'Agregado persistido precisa contar uma aula.');
    assert(enrollmentAfterFirst.data().progressPercent === 50, 'Agregado persistido precisa registrar 50%.');
    assert(enrollmentAfterFirst.data().progressContentRevision === 1, 'Agregado precisa registrar contentRevision 1.');
    assert(enrollmentAfterFirst.data().status === 'active', 'Matrícula persistida deve seguir ativa.');
    assert(enrollmentAfterFirst.data().completedAt === null, 'completedAt deve seguir nulo antes de 100%.');
    assert(detailAfterFirst.data().courseId === courseRef.id, 'Detalhe precisa preservar courseId.');
    assert(detailAfterFirst.data().userId === student.uid, 'Detalhe precisa preservar userId.');
    assert(detailAfterFirst.data().lessonId === lessonOneId, 'Detalhe precisa preservar lessonId.');
    assert(detailAfterFirst.data().status === 'completed', 'Detalhe precisa estar completed.');
    assert(detailAfterFirst.data().contentRevision === 1, 'Detalhe precisa registrar revisão 1.');
    console.log('PERSISTED_PROGRESS_AGGREGATE=OK');

    const auditsAfterFirst = await progressAuditsForUser(db, student.uid, enrollmentId);
    assert(auditsAfterFirst.length === 1, 'Primeira conclusão deve gerar exatamente uma auditoria.');
    assert(
      auditsAfterFirst[0].action === 'course.progress.lesson.completed',
      'Primeira auditoria deve registrar conclusão de aula.'
    );

    const replayFirst = await callCallable(
      'concluirAulaCursoV12',
      studentToken,
      { courseId: courseRef.id, lessonId: lessonOneId }
    );
    assert(replayFirst.changed === false, 'Replay da primeira aula precisa ser idempotente.');
    assert(replayFirst.progress?.completedLessonCount === 1, 'Replay não pode incrementar o contador.');
    assert(replayFirst.progress?.progressPercent === 50, 'Replay precisa preservar 50%.');
    const auditsAfterReplayFirst = await progressAuditsForUser(db, student.uid, enrollmentId);
    assert(auditsAfterReplayFirst.length === 1, 'Replay não pode gerar auditoria adicional.');
    console.log('LESSON_COMPLETION_IDEMPOTENT=OK');

    const midProgress = await callCallable(
      'obterProgressoCursoV12',
      studentToken,
      { courseId: courseRef.id }
    );
    assert(midProgress.progress?.completedLessonCount === 1, 'Consulta intermediária precisa contar uma aula.');
    assert(midProgress.progress?.progressPercent === 50, 'Consulta intermediária precisa retornar 50%.');
    assert(
      JSON.stringify(midProgress.progress?.completedLessonIds) === JSON.stringify([lessonOneId]),
      'Consulta intermediária precisa retornar somente a primeira aula.'
    );
    assert(!Object.prototype.hasOwnProperty.call(midProgress.progress || {}, 'userId'), 'Consulta não deve expor userId.');
    console.log('PROGRESS_QUERY_SANITIZED=OK');

    await assertDirectProgressReadDenied(studentToken, enrollmentId, lessonOneId);
    console.log('DIRECT_FIRESTORE_PROGRESS_READ_DENIED=OK');

    const secondCompletion = await callCallable(
      'concluirAulaCursoV12',
      studentToken,
      { courseId: courseRef.id, lessonId: lessonTwoId }
    );
    assert(secondCompletion.changed === true, 'Segunda conclusão precisa alterar o progresso.');
    assert(secondCompletion.progress?.completedLessonCount === 2, 'Segunda conclusão precisa contar duas aulas.');
    assert(secondCompletion.progress?.progressPercent === 100, 'Segunda conclusão precisa resultar em 100%.');
    assert(secondCompletion.progress?.courseCompleted === true, 'Segunda conclusão precisa concluir o curso.');
    assert(secondCompletion.progress?.status === 'completed', 'Matrícula precisa mudar para completed.');
    assert(secondCompletion.progress?.completedAt, 'Conclusão integral precisa preencher completedAt.');

    const enrollmentCompletedSnap = await enrollmentRef.get();
    const completedAtBeforeReplay = enrollmentCompletedSnap.data()?.completedAt;
    assert(completedAtBeforeReplay, 'Matrícula persistida precisa possuir completedAt.');
    assert(enrollmentCompletedSnap.data().completedLessonCount === 2, 'Agregado final precisa contar duas aulas.');
    assert(enrollmentCompletedSnap.data().progressPercent === 100, 'Agregado final precisa registrar 100%.');
    assert(enrollmentCompletedSnap.data().status === 'completed', 'Agregado final precisa estar completed.');
    console.log('COURSE_COMPLETION_AT_100=OK');

    const auditsAfterCompletion = await progressAuditsForUser(db, student.uid, enrollmentId);
    const lessonAuditCount = auditsAfterCompletion.filter(
      item => item.action === 'course.progress.lesson.completed'
    ).length;
    const courseAuditCount = auditsAfterCompletion.filter(
      item => item.action === 'course.progress.course.completed'
    ).length;
    assert(auditsAfterCompletion.length === 3, 'Duas aulas + conclusão do curso devem gerar três auditorias.');
    assert(lessonAuditCount === 2, 'Devem existir duas auditorias de conclusão de aula.');
    assert(courseAuditCount === 1, 'Conclusão do curso deve ser auditada uma única vez.');
    console.log('COURSE_COMPLETION_AUDIT_ONCE=OK');

    const replaySecond = await callCallable(
      'concluirAulaCursoV12',
      studentToken,
      { courseId: courseRef.id, lessonId: lessonTwoId }
    );
    assert(replaySecond.changed === false, 'Replay da última aula precisa ser idempotente.');
    assert(replaySecond.progress?.progressPercent === 100, 'Replay final precisa preservar 100%.');
    assert(replaySecond.progress?.status === 'completed', 'Replay final precisa preservar completed.');

    const enrollmentAfterReplay = await enrollmentRef.get();
    const completedAtAfterReplay = enrollmentAfterReplay.data()?.completedAt;
    assert(
      completedAtBeforeReplay?.isEqual?.(completedAtAfterReplay) === true,
      'Replay final não pode alterar completedAt.'
    );
    const auditsAfterReplaySecond = await progressAuditsForUser(db, student.uid, enrollmentId);
    assert(auditsAfterReplaySecond.length === 3, 'Replay final não pode duplicar auditoria.');
    console.log('COURSE_COMPLETION_REPLAY_IDEMPOTENT=OK');

    const finalProgress = await callCallable(
      'obterProgressoCursoV12',
      studentToken,
      { courseId: courseRef.id }
    );
    assert(finalProgress.progress?.progressPercent === 100, 'Consulta final precisa retornar 100%.');
    assert(finalProgress.progress?.courseCompleted === true, 'Consulta final precisa marcar curso concluído.');
    assert(
      JSON.stringify(finalProgress.progress?.completedLessonIds) ===
        JSON.stringify([lessonOneId, lessonTwoId].sort()),
      'Consulta final precisa retornar as duas aulas concluídas.'
    );
    console.log('FINAL_PROGRESS_QUERY=OK');

    await courseRef.update({
      contentRevision: 2,
      updatedAt: FieldValue.serverTimestamp()
    });
    await expectCallableError(
      'obterProgressoCursoV12',
      studentToken,
      { courseId: courseRef.id },
      'FAILED_PRECONDITION',
      'PROGRESS_CONTENT_REVISION_MISMATCH'
    );
    console.log('STALE_PROGRESS_REVISION_BLOCKED=OK');

    await courseRef.update({
      contentRevision: 1,
      status: 'suspended',
      updatedAt: FieldValue.serverTimestamp()
    });
    await expectCallableError(
      'obterProgressoCursoV12',
      studentToken,
      { courseId: courseRef.id },
      'PERMISSION_DENIED',
      'COURSE_NOT_PUBLISHED'
    );
    console.log('SUSPENDED_COURSE_PROGRESS_REVOKED=OK');

    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4B3_COURSE_PROGRESS_STAGING_SMOKE=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO4B3_COURSE_PROGRESS_STAGING_SMOKE=FAILED');
  console.error(`ERROR=${error.message}`);
  if (error.httpStatus !== undefined && error.httpStatus !== null) {
    console.error(`HTTP_STATUS=${error.httpStatus}`);
  }
  if (error.callableStatus) console.error(`CALLABLE_STATUS=${error.callableStatus}`);
  if (error.details?.domainCode) console.error(`DOMAIN_CODE=${error.details.domainCode}`);
  if (error.responseContentType) console.error(`RESPONSE_CONTENT_TYPE=${error.responseContentType}`);
  if (error.responseKind) console.error(`RESPONSE_KIND=${error.responseKind}`);
  if (error.responsePreview) console.error(`RESPONSE_PREVIEW=${error.responsePreview}`);
  process.exitCode = 1;
});
