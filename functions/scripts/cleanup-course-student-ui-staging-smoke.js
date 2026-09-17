'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const ALLOWED_BRANCH = 'feature/marco4b4-student-course-ui';
const STATE_FILE = path.join(__dirname, '..', '.course-student-ui-staging.local.json');

function fail(message) { throw new Error(message); }
function currentBranch() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: path.join(__dirname, '..', '..'), encoding: 'utf8'
  }).trim();
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '').trim();
  if (confirmation !== CONFIRMATION_VALUE) fail(`Cleanup bloqueado. Defina BJJEXAMS_STAGING_SMOKE_CONFIRM=${CONFIRMATION_VALUE}.`);
  if (declaredProject === PRODUCTION_PROJECT) fail('Projeto de produção detectado. Cleanup bloqueado.');
  if (declaredProject && declaredProject !== TARGET_PROJECT) fail(`Projeto declarado incompatível com staging: ${declaredProject}.`);
  if (currentBranch() !== ALLOWED_BRANCH) fail(`Branch não autorizada. Esperado: ${ALLOWED_BRANCH}.`);
  if (!fs.existsSync(STATE_FILE)) fail('Arquivo de estado do smoke 4B.4 não encontrado. Nada foi removido.');
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (state.projectId !== TARGET_PROJECT) fail(`Estado local aponta para projeto inesperado: ${state.projectId || 'sem projectId'}.`);
  if (!state.runId) fail('Estado local do smoke 4B.4 sem runId.');
  return state;
}

async function deleteOwnedCollection(collectionRef, runId, label) {
  const snap = await collectionRef.get();
  let deleted = 0;
  for (const doc of snap.docs) {
    if (doc.data()?.smokeRunId !== runId) fail(`${label} ${doc.id} não pertence ao smoke atual.`);
    await doc.ref.delete();
    deleted += 1;
  }
  return deleted;
}

async function main() {
  const state = validateEnvironment();
  const app = initializeApp({ credential: applicationDefault(), projectId: TARGET_PROJECT }, `course-student-ui-cleanup-${state.runId}`);
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 4B.4 - STUDENT UI STAGING CLEANUP ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${state.runId}`);

  try {
    await Promise.all([auth.listUsers(1), db.collection('courses').limit(1).get()]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const enrollmentRef = db.doc(`enrollments/${state.enrollmentId}`);
    const enrollmentSnap = await enrollmentRef.get();
    if (enrollmentSnap.exists) {
      const data = enrollmentSnap.data() || {};
      if (data.smokeRunId !== state.runId || data.userId !== state.userId || data.courseId !== state.courseId) {
        fail(`Matrícula ${state.enrollmentId} não pertence ao smoke atual.`);
      }
      const progressSnap = await enrollmentRef.collection('lesson_progress').get();
      for (const progressDoc of progressSnap.docs) {
        const progress = progressDoc.data() || {};
        if (progress.userId !== state.userId || progress.courseId !== state.courseId || progress.lessonId !== progressDoc.id) {
          fail(`Progresso ${progressDoc.id} não pertence ao smoke atual.`);
        }
        await progressDoc.ref.delete();
      }
      await enrollmentRef.delete();
    }

    const auditsSnap = await db.collection('audit_logs').where('actorId', '==', state.userId).get();
    for (const doc of auditsSnap.docs) {
      const data = doc.data() || {};
      if (data.entityType !== 'course_progress') continue;
      const entityId = String(data.entityId || '');
      if (!entityId.startsWith(state.enrollmentId)) fail(`Auditoria ${doc.id} não pertence ao smoke atual.`);
      await doc.ref.delete();
    }

    const courseRef = db.doc(`courses/${state.courseId}`);
    const courseSnap = await courseRef.get();
    if (courseSnap.exists) {
      if (courseSnap.data()?.smokeRunId !== state.runId) fail(`Curso ${state.courseId} não pertence ao smoke atual.`);
      await deleteOwnedCollection(courseRef.collection('lessons'), state.runId, 'Aula');
      await deleteOwnedCollection(courseRef.collection('modules'), state.runId, 'Módulo');
      await courseRef.delete();
    }

    const profileRef = db.doc(`alunos/${state.userId}`);
    const profileSnap = await profileRef.get();
    if (profileSnap.exists) {
      if (profileSnap.data()?.smokeRunId !== state.runId) fail(`Perfil ${state.userId} não pertence ao smoke atual.`);
      await profileRef.delete();
    }

    try {
      const user = await auth.getUser(state.userId);
      if (user.email !== state.email || !String(user.email || '').startsWith('course-ui-')) fail('Usuário Auth não corresponde ao smoke atual.');
      await auth.deleteUser(state.userId);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }

    const residues = [];
    if ((await enrollmentRef.get()).exists) residues.push(`enrollment:${state.enrollmentId}`);
    if (!(await enrollmentRef.collection('lesson_progress').limit(1).get()).empty) residues.push(`lesson_progress:${state.enrollmentId}`);
    if ((await courseRef.get()).exists) residues.push(`course:${state.courseId}`);
    if (!(await courseRef.collection('modules').limit(1).get()).empty) residues.push(`modules:${state.courseId}`);
    if (!(await courseRef.collection('lessons').limit(1).get()).empty) residues.push(`lessons:${state.courseId}`);
    if ((await profileRef.get()).exists) residues.push(`profile:${state.userId}`);
    const remainingAudits = await db.collection('audit_logs').where('actorId', '==', state.userId).get();
    if (remainingAudits.docs.some(doc => doc.data()?.entityType === 'course_progress')) residues.push(`audit_logs:${state.userId}`);
    if (residues.length) fail(`Cleanup remoto incompleto: ${residues.join(', ')}`);

    fs.unlinkSync(STATE_FILE);
    console.log('TEMP_FIXTURES_REMOVED=True');
    console.log('TEMP_AUTH_USER_REMOVED=True');
    console.log('LOCAL_STATE_FILE_DELETED=True');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('COURSE_STUDENT_UI_STAGING_CLEANUP=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('COURSE_STUDENT_UI_STAGING_CLEANUP=FAILED');
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
