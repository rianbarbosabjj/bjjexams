'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const REGION = 'southamerica-east1';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const ALLOWED_BRANCH = 'feature/marco4a5-course-content';
const STATE_FILE = path.join(__dirname, '..', '.course-content-staging-smoke.local.json');
const WEB_CONFIG_FILE = path.join(__dirname, '..', '..', 'js', 'firebase-config.local.json');

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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
    fail(`Branch não autorizada para este smoke. Esperado: ${ALLOWED_BRANCH}.`);
  }
  if (!fs.existsSync(WEB_CONFIG_FILE)) {
    fail('Configuração Web de staging ausente. Execute prepare-staging-firebase-web-config.ps1.');
  }
  if (fs.existsSync(STATE_FILE)) {
    fail('Já existe smoke local pendente. Execute o cleanup antes de iniciar outro.');
  }

  const webConfig = readJson(WEB_CONFIG_FILE);
  if (webConfig.projectId !== TARGET_PROJECT) {
    fail(`Configuração Web incompatível: ${webConfig.projectId || 'sem projectId'}.`);
  }
  if (!webConfig.apiKey) fail('Configuração Web de staging sem apiKey.');
  return webConfig;
}

function randomPassword() {
  return `BjjExams-${crypto.randomBytes(18).toString('hex')}!Aa9`;
}

async function signInWithPassword(apiKey, email, password) {
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
    fail(`Falha ao autenticar usuário temporário em staging: HTTP ${response.status}.`);
  }
  return body.idToken;
}

function functionUrl(name) {
  return `https://${REGION}-${TARGET_PROJECT}.cloudfunctions.net/${name}`;
}

async function callCallable(name, idToken, data = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(functionUrl(name), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
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
    if (error.callableStatus === expectedStatus) return;
    fail(`${name} falhou com ${error.callableStatus || error.httpStatus}; esperado ${expectedStatus}.`);
  }
  fail(`${name} deveria falhar com ${expectedStatus}, mas concluiu com sucesso.`);
}

async function readCourse(db, courseId) {
  const snap = await db.doc(`courses/${courseId}`).get();
  assert(snap.exists, `Curso temporário ${courseId} não encontrado.`);
  return snap.data();
}

function assertCounters(course, expected, label) {
  for (const [field, value] of Object.entries(expected)) {
    assert(Number(course[field] || 0) === value, `${label}: ${field} esperado ${value}, recebido ${course[field]}.`);
  }
}

async function main() {
  const webConfig = validateEnvironment();
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const app = initializeApp({
    credential: applicationDefault(),
    projectId: TARGET_PROJECT
  }, `course-content-smoke-${runId}`);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const state = {
    projectId: TARGET_PROJECT,
    runId,
    userIds: [],
    courseIds: [],
    createdAt: new Date().toISOString()
  };

  console.log('=== MARCO 4A.5a - COURSE CONTENT STAGING SMOKE ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${runId}`);

  try {
    await Promise.all([
      auth.listUsers(1),
      db.collection('courses').limit(1).get()
    ]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const ownerEmail = `course-content-owner-${runId}@example.invalid`;
    const intruderEmail = `course-content-intruder-${runId}@example.invalid`;
    const ownerPassword = randomPassword();
    const intruderPassword = randomPassword();

    const [owner, intruder] = await Promise.all([
      auth.createUser({ email: ownerEmail, password: ownerPassword, emailVerified: true }),
      auth.createUser({ email: intruderEmail, password: intruderPassword, emailVerified: true })
    ]);
    state.userIds.push(owner.uid, intruder.uid);

    const draftCourseRef = db.collection('courses').doc();
    const publishedCourseRef = db.collection('courses').doc();
    state.courseIds.push(draftCourseRef.id, publishedCourseRef.id);

    const batch = db.batch();
    batch.set(db.doc(`usuarios/${owner.uid}`), {
      nome: 'COURSE CONTENT SMOKE OWNER',
      email: ownerEmail,
      tipo_usuario: 'professor',
      papel_principal: 'instrutor',
      status_conta: 'ativo',
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });
    batch.set(db.doc(`usuarios/${intruder.uid}`), {
      nome: 'COURSE CONTENT SMOKE INTRUDER',
      email: intruderEmail,
      tipo_usuario: 'professor',
      papel_principal: 'instrutor',
      status_conta: 'ativo',
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });
    batch.create(draftCourseRef, {
      title: 'SMOKE 4A.5A - COURSE CONTENT DRAFT',
      description: `Curso temporário de staging ${runId}.`,
      ownerType: 'user',
      ownerId: owner.uid,
      instructorIds: [owner.uid],
      visibility: 'platform',
      organizationId: null,
      status: 'draft',
      isPaid: false,
      priceCents: 0,
      currency: 'BRL',
      contentRevision: 0,
      moduleCount: 0,
      lessonCount: 0,
      estimatedDurationMinutes: 0,
      smokeRunId: runId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.create(publishedCourseRef, {
      title: 'SMOKE 4A.5A - COURSE CONTENT PUBLISHED',
      description: `Curso temporário publicado de staging ${runId}.`,
      ownerType: 'user',
      ownerId: owner.uid,
      instructorIds: [owner.uid],
      visibility: 'platform',
      organizationId: null,
      status: 'published',
      isPaid: false,
      priceCents: 0,
      currency: 'BRL',
      contentRevision: 0,
      moduleCount: 0,
      lessonCount: 0,
      estimatedDurationMinutes: 0,
      smokeRunId: runId,
      publishedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    await batch.commit();

    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });

    console.log(`TEMP_USERS_CREATED=${state.userIds.length}`);
    console.log(`TEMP_COURSES_CREATED=${state.courseIds.length}`);
    console.log('LOCAL_STATE_FILE=READY');
    console.log('PASSWORDS_PRINTED=False');

    const [ownerToken, intruderToken] = await Promise.all([
      signInWithPassword(webConfig.apiKey, ownerEmail, ownerPassword),
      signInWithPassword(webConfig.apiKey, intruderEmail, intruderPassword)
    ]);
    console.log('TEMP_AUTHENTICATION=OK');

    const empty = await callCallable('listarConteudoCursoV12', ownerToken, {
      courseId: draftCourseRef.id
    });
    assert(empty.modules.length === 0 && empty.lessons.length === 0, 'Conteúdo inicial deveria estar vazio.');
    assert(Number(empty.counters.contentRevision || 0) === 0, 'contentRevision inicial deveria ser zero.');
    console.log('EMPTY_CONTENT_READ=OK');

    await expectCallableError(
      'listarConteudoCursoV12',
      intruderToken,
      { courseId: draftCourseRef.id },
      'PERMISSION_DENIED'
    );
    console.log('OWNERSHIP_READ_DENIED=OK');

    const moduleA = await callCallable('criarModuloCursoV12', ownerToken, {
      courseId: draftCourseRef.id,
      title: 'Fundamentos',
      description: 'Primeiro módulo do smoke test.',
      position: 0
    });
    assert(moduleA.contentRevision === 1, 'Criação do módulo A deveria gerar revisão 1.');
    console.log('MODULE_A_CREATED=OK');

    const moduleB = await callCallable('criarModuloCursoV12', ownerToken, {
      courseId: draftCourseRef.id,
      title: 'Aplicações',
      description: 'Segundo módulo do smoke test.',
      position: 1
    });
    assert(moduleB.contentRevision === 2, 'Criação do módulo B deveria gerar revisão 2.');
    console.log('MODULE_B_CREATED=OK');

    const lesson = await callCallable('criarAulaCursoV12', ownerToken, {
      courseId: draftCourseRef.id,
      moduleId: moduleA.module.id,
      title: 'Aula de guarda',
      description: 'Aula temporária para validar CRUD.',
      position: 0,
      contentType: 'video',
      durationMinutes: 10,
      isPreview: false,
      videoUrl: 'https://example.com/bjj-smoke-video'
    });
    assert(lesson.contentRevision === 3, 'Criação da aula deveria gerar revisão 3.');
    let course = await readCourse(db, draftCourseRef.id);
    assertCounters(course, { contentRevision: 3, moduleCount: 2, lessonCount: 1, estimatedDurationMinutes: 10 }, 'Após criar aula');
    console.log('LESSON_CREATED_COUNTERS=OK');

    const moved = await callCallable('atualizarAulaCursoV12', ownerToken, {
      courseId: draftCourseRef.id,
      lessonId: lesson.lesson.id,
      moduleId: moduleB.module.id,
      title: 'Aula de guarda atualizada',
      durationMinutes: 12
    });
    assert(moved.contentRevision === 4, 'Mover aula deveria gerar revisão 4.');
    const [moduleASnap, moduleBSnap] = await Promise.all([
      draftCourseRef.collection('modules').doc(moduleA.module.id).get(),
      draftCourseRef.collection('modules').doc(moduleB.module.id).get()
    ]);
    assert(Number(moduleASnap.data().lessonCount || 0) === 0, 'Módulo A deveria ficar sem aulas.');
    assert(Number(moduleBSnap.data().lessonCount || 0) === 1, 'Módulo B deveria receber a aula.');
    course = await readCourse(db, draftCourseRef.id);
    assertCounters(course, { contentRevision: 4, moduleCount: 2, lessonCount: 1, estimatedDurationMinutes: 12 }, 'Após mover aula');
    console.log('LESSON_MOVE_COUNTERS=OK');

    await expectCallableError(
      'excluirModuloCursoV12',
      ownerToken,
      { courseId: draftCourseRef.id, moduleId: moduleB.module.id },
      'FAILED_PRECONDITION'
    );
    console.log('MODULE_WITH_LESSON_DELETE_BLOCKED=OK');

    await expectCallableError(
      'criarModuloCursoV12',
      ownerToken,
      { courseId: publishedCourseRef.id, title: 'Não permitido', position: 0 },
      'FAILED_PRECONDITION'
    );
    console.log('NON_DRAFT_MUTATION_BLOCKED=OK');

    const deletedLesson = await callCallable('excluirAulaCursoV12', ownerToken, {
      courseId: draftCourseRef.id,
      lessonId: lesson.lesson.id
    });
    assert(deletedLesson.contentRevision === 5, 'Exclusão da aula deveria gerar revisão 5.');
    console.log('LESSON_DELETED=OK');

    const deletedModuleA = await callCallable('excluirModuloCursoV12', ownerToken, {
      courseId: draftCourseRef.id,
      moduleId: moduleA.module.id
    });
    assert(deletedModuleA.contentRevision === 6, 'Exclusão do módulo A deveria gerar revisão 6.');

    const deletedModuleB = await callCallable('excluirModuloCursoV12', ownerToken, {
      courseId: draftCourseRef.id,
      moduleId: moduleB.module.id
    });
    assert(deletedModuleB.contentRevision === 7, 'Exclusão do módulo B deveria gerar revisão 7.');
    console.log('MODULES_DELETED=OK');

    const finalContent = await callCallable('listarConteudoCursoV12', ownerToken, {
      courseId: draftCourseRef.id
    });
    assert(finalContent.modules.length === 0 && finalContent.lessons.length === 0, 'Conteúdo final deveria estar vazio.');
    course = await readCourse(db, draftCourseRef.id);
    assertCounters(course, { contentRevision: 7, moduleCount: 0, lessonCount: 0, estimatedDurationMinutes: 0 }, 'Estado final');
    console.log('FINAL_CONTENT_COUNTERS=OK');

    const auditSnap = await db.collection('audit_logs').where('actorId', '==', owner.uid).get();
    const contentAudits = auditSnap.docs.filter(doc => String(doc.data().action || '').startsWith('course.content.'));
    assert(contentAudits.length === 7, `Esperados 7 logs de conteúdo; recebidos ${contentAudits.length}.`);
    console.log('CONTENT_AUDIT_LOGS=7/7');

    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('CLEANUP_REQUIRED=True');
    console.log('MARCO4A5A_COURSE_CONTENT_STAGING_SMOKE=OK');
  } catch (error) {
    console.error('MARCO4A5A_COURSE_CONTENT_STAGING_SMOKE=FAILED');
    console.error(`ERROR=${error.message}`);
    console.error('CLEANUP_REQUIRED=True');
    process.exitCode = 1;
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main();
