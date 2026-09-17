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
const ALLOWED_BRANCH = 'feature/marco4b4-student-course-ui';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const STATE_FILE = path.join(__dirname, '..', '.course-student-ui-staging.local.json');
const WEB_CONFIG_FILE = path.join(__dirname, '..', '..', 'js', 'firebase-config.local.json');

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function currentBranch() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: path.join(__dirname, '..', '..'),
    encoding: 'utf8'
  }).trim();
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function saveState(state) {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
}
function randomPassword() {
  return `BjjExams-${crypto.randomBytes(18).toString('hex')}!Aa9`;
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || ''
  ).trim();

  assert(confirmation === CONFIRMATION_VALUE,
    `Smoke bloqueado. Defina BJJEXAMS_STAGING_SMOKE_CONFIRM=${CONFIRMATION_VALUE}.`);
  assert(declaredProject !== PRODUCTION_PROJECT, 'Projeto de produção detectado. Execução bloqueada.');
  assert(!declaredProject || declaredProject === TARGET_PROJECT,
    `Projeto declarado incompatível com staging: ${declaredProject}.`);
  assert(currentBranch() === ALLOWED_BRANCH, `Branch não autorizada. Esperado: ${ALLOWED_BRANCH}.`);
  assert(fs.existsSync(WEB_CONFIG_FILE), 'Configuração Web de staging ausente.');
  assert(!fs.existsSync(STATE_FILE), 'Já existe smoke 4B.4 pendente. Execute o cleanup antes de iniciar outro.');

  const config = readJson(WEB_CONFIG_FILE);
  assert(config.projectId === TARGET_PROJECT,
    `Configuração Web incompatível: ${config.projectId || 'sem projectId'}.`);
  assert(config.apiKey, 'Configuração Web de staging sem apiKey.');
}

async function main() {
  validateEnvironment();

  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const password = randomPassword();
  const email = `course-ui-${runId}@example.invalid`;
  const courseId = `smoke-4b4-${crypto.randomBytes(8).toString('hex')}`;
  const moduleId = 'module-1';
  const lessonIds = ['lesson-1', 'lesson-2'];

  const state = {
    projectId: TARGET_PROJECT,
    branch: ALLOWED_BRANCH,
    runId,
    userId: null,
    email,
    password,
    courseId,
    moduleId,
    lessonIds,
    enrollmentId: null,
    createdAt: new Date().toISOString()
  };
  saveState(state);

  const app = initializeApp({ credential: applicationDefault(), projectId: TARGET_PROJECT });
  const auth = getAuth(app);
  const db = getFirestore(app);

  try {
    const user = await auth.createUser({
      email,
      password,
      emailVerified: true,
      displayName: 'Aluno Smoke 4B.4'
    });
    state.userId = user.uid;
    state.enrollmentId = enrollmentDocumentId(courseId, user.uid);
    saveState(state);

    const now = FieldValue.serverTimestamp();

    await db.doc(`alunos/${user.uid}`).set({
      smokeRunId: runId,
      nome: 'ALUNO SMOKE 4B.4',
      email,
      status_vinculo: 'ativo',
      faixa_atual: 'Branca',
      faixa: 'Branca',
      equipe_origem: 'Smoke Staging',
      pontos_rola: 0,
      exame_habilitado: false,
      status_exame_em_andamento: false,
      criado_em: now
    });

    await db.doc(`courses/${courseId}`).set({
      smokeRunId: runId,
      title: 'Smoke 4B.4 - Interface do Aluno',
      description: 'Curso temporário para validar Meus Cursos, player protegido e progresso.',
      ownerType: 'platform',
      ownerId: null,
      instructorIds: ['system-smoke'],
      visibility: 'platform',
      organizationId: null,
      status: 'published',
      isPaid: false,
      priceCents: 0,
      currency: 'BRL',
      publishedAt: now,
      contentRevision: 1,
      moduleCount: 1,
      lessonCount: 2,
      estimatedDurationMinutes: 20,
      createdAt: now,
      updatedAt: now
    });

    await db.doc(`courses/${courseId}/modules/${moduleId}`).set({
      smokeRunId: runId,
      title: 'Fundamentos do Smoke',
      description: 'Módulo temporário do smoke visual 4B.4.',
      position: 0,
      lessonCount: 2
    });

    await db.doc(`courses/${courseId}/lessons/${lessonIds[0]}`).set({
      smokeRunId: runId,
      moduleId,
      title: 'Aula 1 - Início',
      description: 'Primeira aula temporária.',
      position: 0,
      contentType: 'text',
      durationMinutes: 10,
      isPreview: false,
      videoUrl: null,
      body: 'SMOKE_4B4_AULA_1 — Se você está lendo isto, o conteúdo protegido foi carregado pela API V12.',
      documentUrl: null
    });

    await db.doc(`courses/${courseId}/lessons/${lessonIds[1]}`).set({
      smokeRunId: runId,
      moduleId,
      title: 'Aula 2 - Conclusão',
      description: 'Segunda aula temporária.',
      position: 1,
      contentType: 'text',
      durationMinutes: 10,
      isPreview: false,
      videoUrl: null,
      body: 'SMOKE_4B4_AULA_2 — Conclua esta aula para validar 100% do curso.',
      documentUrl: null
    });

    await db.doc(`enrollments/${state.enrollmentId}`).set({
      smokeRunId: runId,
      courseId,
      userId: user.uid,
      source: 'free',
      orderId: null,
      status: 'active',
      progressPercent: 0,
      completedLessonCount: 0,
      progressContentRevision: null,
      startedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    });

    console.log('COURSE_STUDENT_UI_STAGING_FIXTURE=READY');
    console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
    console.log('PRODUCTION_ACCESS=FORBIDDEN');
    console.log(`SMOKE_RUN_ID=${runId}`);
    console.log(`SMOKE_EMAIL=${email}`);
    console.log(`SMOKE_PASSWORD=${password}`);
    console.log(`SMOKE_COURSE_ID=${courseId}`);
    console.log('EXPECTED_PROGRESS=0->50->100');
    console.log('LOCAL_LOGIN_URL=http://127.0.0.1:4174/login.html');
  } finally {
    await deleteApp(app);
  }
}

main().catch(error => {
  console.error(`COURSE_STUDENT_UI_STAGING_FIXTURE=FAIL | ${error.message}`);
  process.exitCode = 1;
});
