'use strict';

const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const STATE_FILE = path.join(__dirname, '..', '.course-progress-staging.local.json');

function fail(message) { throw new Error(message); }

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || ''
  ).trim();

  if (confirmation !== CONFIRMATION_VALUE) {
    fail(`Cleanup bloqueado. Defina BJJEXAMS_STAGING_SMOKE_CONFIRM=${CONFIRMATION_VALUE}.`);
  }
  if (declaredProject === PRODUCTION_PROJECT) {
    fail('Projeto de produção detectado. Cleanup bloqueado.');
  }
  if (declaredProject && declaredProject !== TARGET_PROJECT) {
    fail(`Projeto declarado incompatível com staging: ${declaredProject}.`);
  }
  if (!fs.existsSync(STATE_FILE)) {
    fail('Arquivo de estado do smoke 4B.3 não encontrado. Nada foi removido.');
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (state.projectId !== TARGET_PROJECT) {
    fail(`Estado local aponta para projeto inesperado: ${state.projectId || 'sem projectId'}.`);
  }
  if (!state.runId) fail('Estado local do smoke 4B.3 sem runId.');
  return state;
}

async function deleteOwnedSubcollection(collectionRef, runId, label) {
  const snap = await collectionRef.get();
  let deleted = 0;
  for (const doc of snap.docs) {
    if (doc.data()?.smokeRunId !== runId) {
      fail(`${label} ${doc.id} não pertence ao smoke atual. Cleanup interrompido.`);
    }
    await doc.ref.delete();
    deleted += 1;
  }
  return deleted;
}

async function deleteProgressAudits(db, state) {
  if (!state.userId) return 0;
  const snap = await db.collection('audit_logs').where('actorId', '==', state.userId).get();
  let deleted = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (data.entityType !== 'course_progress') continue;

    const belongsToEnrollment = (state.enrollmentIds || []).some(enrollmentId =>
      String(data.entityId || '').startsWith(enrollmentId)
    );
    if (!belongsToEnrollment) {
      fail(`Auditoria ${doc.id} do usuário temporário não pertence às matrículas do smoke atual.`);
    }

    await doc.ref.delete();
    deleted += 1;
  }

  return deleted;
}

async function main() {
  const state = validateEnvironment();
  const app = initializeApp(
    { credential: applicationDefault(), projectId: TARGET_PROJECT },
    `course-progress-cleanup-${state.runId}`
  );
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 4B.3 - COURSE PROGRESS STAGING CLEANUP ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${state.runId}`);

  try {
    await Promise.all([auth.listUsers(1), db.collection('courses').limit(1).get()]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    let progressDocsDeleted = 0;
    let auditLogsDeleted = 0;
    let enrollmentsDeleted = 0;
    let lessonsDeleted = 0;
    let modulesDeleted = 0;
    let coursesDeleted = 0;
    let profilesDeleted = 0;
    let authUsersDeleted = 0;

    auditLogsDeleted = await deleteProgressAudits(db, state);

    for (const enrollmentId of state.enrollmentIds || []) {
      const ref = db.doc(`enrollments/${enrollmentId}`);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const data = snap.data() || {};
      if (
        data.smokeRunId !== state.runId ||
        data.userId !== state.userId ||
        !(state.courseIds || []).includes(data.courseId)
      ) {
        fail(`Matrícula ${enrollmentId} não pertence ao smoke atual.`);
      }

      const progressSnap = await ref.collection('lesson_progress').get();
      for (const progressDoc of progressSnap.docs) {
        const progress = progressDoc.data() || {};
        if (
          progress.userId !== state.userId ||
          progress.courseId !== data.courseId ||
          progress.lessonId !== progressDoc.id
        ) {
          fail(`Progresso ${progressDoc.id} não pertence ao smoke atual.`);
        }
        await progressDoc.ref.delete();
        progressDocsDeleted += 1;
      }

      await ref.delete();
      enrollmentsDeleted += 1;
    }

    for (const courseId of state.courseIds || []) {
      const courseRef = db.doc(`courses/${courseId}`);
      const courseSnap = await courseRef.get();
      if (!courseSnap.exists) continue;
      if (courseSnap.data()?.smokeRunId !== state.runId) {
        fail(`Curso ${courseId} não pertence ao smoke atual.`);
      }

      lessonsDeleted += await deleteOwnedSubcollection(
        courseRef.collection('lessons'),
        state.runId,
        `Aula de ${courseId}`
      );
      modulesDeleted += await deleteOwnedSubcollection(
        courseRef.collection('modules'),
        state.runId,
        `Módulo de ${courseId}`
      );

      await courseRef.delete();
      coursesDeleted += 1;
    }

    if (state.userId) {
      const profileRef = db.doc(`usuarios/${state.userId}`);
      const profileSnap = await profileRef.get();
      if (profileSnap.exists) {
        if (profileSnap.data()?.smokeRunId !== state.runId) {
          fail(`Perfil ${state.userId} não pertence ao smoke atual.`);
        }
        await profileRef.delete();
        profilesDeleted += 1;
      }

      try {
        await auth.deleteUser(state.userId);
        authUsersDeleted += 1;
      } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error;
      }
    }

    const residues = [];
    for (const enrollmentId of state.enrollmentIds || []) {
      const enrollmentRef = db.doc(`enrollments/${enrollmentId}`);
      if ((await enrollmentRef.get()).exists) residues.push(`enrollment:${enrollmentId}`);
      if (!(await enrollmentRef.collection('lesson_progress').limit(1).get()).empty) {
        residues.push(`lesson_progress:${enrollmentId}`);
      }
    }
    for (const courseId of state.courseIds || []) {
      const courseRef = db.doc(`courses/${courseId}`);
      if ((await courseRef.get()).exists) residues.push(`course:${courseId}`);
      if (!(await courseRef.collection('modules').limit(1).get()).empty) {
        residues.push(`modules:${courseId}`);
      }
      if (!(await courseRef.collection('lessons').limit(1).get()).empty) {
        residues.push(`lessons:${courseId}`);
      }
    }
    if (state.userId) {
      const remainingAudits = await db.collection('audit_logs').where('actorId', '==', state.userId).get();
      if (remainingAudits.docs.some(doc => doc.data()?.entityType === 'course_progress')) {
        residues.push(`audit_logs:${state.userId}`);
      }
    }

    if (residues.length) {
      fail(`Cleanup remoto incompleto: ${residues.join(', ')}`);
    }

    fs.unlinkSync(STATE_FILE);
    console.log(`TEMP_PROGRESS_DOCS_DELETED=${progressDocsDeleted}`);
    console.log(`TEMP_AUDIT_LOGS_DELETED=${auditLogsDeleted}`);
    console.log(`TEMP_ENROLLMENTS_DELETED=${enrollmentsDeleted}`);
    console.log(`TEMP_LESSONS_DELETED=${lessonsDeleted}`);
    console.log(`TEMP_MODULES_DELETED=${modulesDeleted}`);
    console.log(`TEMP_COURSES_DELETED=${coursesDeleted}`);
    console.log(`TEMP_PROFILES_DELETED=${profilesDeleted}`);
    console.log(`TEMP_AUTH_USERS_DELETED=${authUsersDeleted}`);
    console.log('LOCAL_STATE_FILE_DELETED=True');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4B3_COURSE_PROGRESS_STAGING_CLEANUP=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO4B3_COURSE_PROGRESS_STAGING_CLEANUP=FAILED');
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
