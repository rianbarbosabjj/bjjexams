'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const ALLOWED_BRANCH = 'feature/marco4b4-student-course-ui';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const STATE_FILE = path.join(__dirname, '..', '.course-student-ui-staging.local.json');

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
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

  assert(confirmation === CONFIRMATION_VALUE,
    `Verificação bloqueada. Defina BJJEXAMS_STAGING_SMOKE_CONFIRM=${CONFIRMATION_VALUE}.`);
  assert(declaredProject !== PRODUCTION_PROJECT, 'Projeto de produção detectado. Execução bloqueada.');
  assert(!declaredProject || declaredProject === TARGET_PROJECT,
    `Projeto declarado incompatível com staging: ${declaredProject}.`);
  assert(currentBranch() === ALLOWED_BRANCH, `Branch não autorizada. Esperado: ${ALLOWED_BRANCH}.`);
  assert(fs.existsSync(STATE_FILE), 'Estado do smoke 4B.4 não encontrado.');

  const state = readJson(STATE_FILE);
  assert(state.projectId === TARGET_PROJECT, 'Estado local não pertence ao projeto de staging.');
  return state;
}

async function main() {
  const state = validateEnvironment();
  const app = initializeApp({ credential: applicationDefault(), projectId: TARGET_PROJECT });
  const db = getFirestore(app);

  try {
    const enrollmentRef = db.doc(`enrollments/${state.enrollmentId}`);
    const [enrollmentSnap, progressSnap, auditsSnap] = await Promise.all([
      enrollmentRef.get(),
      enrollmentRef.collection('lesson_progress').get(),
      db.collection('audit_logs').where('actorId', '==', state.userId).get()
    ]);

    assert(enrollmentSnap.exists, 'Matrícula do smoke não existe mais.');
    const enrollment = enrollmentSnap.data() || {};
    assert(enrollment.smokeRunId === state.runId, 'Matrícula não pertence ao run atual.');
    assert(enrollment.status === 'completed', `Status esperado completed; recebido ${enrollment.status}.`);
    assert(enrollment.completedLessonCount === 2,
      `completedLessonCount esperado 2; recebido ${enrollment.completedLessonCount}.`);
    assert(Number(enrollment.progressPercent) === 100,
      `progressPercent esperado 100; recebido ${enrollment.progressPercent}.`);
    assert(enrollment.completedAt, 'completedAt precisa estar persistido após 100%.');

    const progressIds = progressSnap.docs.map(doc => doc.id).sort();
    assert(progressIds.length === 2, `Esperados 2 lesson_progress; recebidos ${progressIds.length}.`);
    assert(JSON.stringify(progressIds) === JSON.stringify([...state.lessonIds].sort()),
      `IDs de progresso inesperados: ${progressIds.join(', ')}.`);

    for (const doc of progressSnap.docs) {
      const data = doc.data() || {};
      assert(data.courseId === state.courseId, `courseId inconsistente em ${doc.id}.`);
      assert(data.userId === state.userId, `userId inconsistente em ${doc.id}.`);
      assert(data.lessonId === doc.id, `lessonId inconsistente em ${doc.id}.`);
      assert(data.status === 'completed', `Status da aula ${doc.id} não é completed.`);
      assert(Number(data.contentRevision) === 1, `contentRevision inválida em ${doc.id}.`);
      assert(data.completedAt, `completedAt ausente em ${doc.id}.`);
    }

    const audits = auditsSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => item.entityType === 'course_progress');
    const lessonAudits = audits.filter(item => item.action === 'course.progress.lesson.completed');
    const courseAudits = audits.filter(item => item.action === 'course.progress.course.completed');
    assert(lessonAudits.length === 2,
      `Esperadas 2 auditorias de aula; recebidas ${lessonAudits.length}.`);
    assert(courseAudits.length === 1,
      `Esperada 1 auditoria de conclusão do curso; recebidas ${courseAudits.length}.`);

    console.log('COURSE_STUDENT_UI_STAGING_VERIFY=OK');
    console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
    console.log('PRODUCTION_ACCESS=FORBIDDEN');
    console.log('ENROLLMENT_STATUS=completed');
    console.log('COMPLETED_LESSONS=2/2');
    console.log('PROGRESS_PERCENT=100');
    console.log('LESSON_AUDITS=2');
    console.log('COURSE_COMPLETION_AUDITS=1');
  } finally {
    await deleteApp(app);
  }
}

main().catch(error => {
  console.error(`COURSE_STUDENT_UI_STAGING_VERIFY=FAIL | ${error.message}`);
  process.exitCode = 1;
});
