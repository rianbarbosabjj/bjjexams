'use strict';

const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const STATE_FILE = path.join(__dirname, '..', '.course-protected-consumption-staging.local.json');

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
    fail('Arquivo de estado do smoke 4B.2 não encontrado. Nada foi removido.');
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (state.projectId !== TARGET_PROJECT) {
    fail(`Estado local aponta para projeto inesperado: ${state.projectId || 'sem projectId'}.`);
  }
  if (!state.runId) fail('Estado local do smoke 4B.2 sem runId.');
  return state;
}

async function deleteOwnedSubcollection(db, collectionRef, runId, label) {
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

async function main() {
  const state = validateEnvironment();
  const app = initializeApp(
    { credential: applicationDefault(), projectId: TARGET_PROJECT },
    `course-consumption-cleanup-${state.runId}`
  );
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 4B.2 - PROTECTED CONSUMPTION STAGING CLEANUP ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${state.runId}`);

  try {
    await Promise.all([auth.listUsers(1), db.collection('courses').limit(1).get()]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    let lessonsDeleted = 0;
    let modulesDeleted = 0;
    let coursesDeleted = 0;
    let enrollmentsDeleted = 0;
    let membershipsDeleted = 0;
    let profilesDeleted = 0;
    let authUsersDeleted = 0;

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
      await ref.delete();
      enrollmentsDeleted += 1;
    }

    for (const membershipId of state.membershipIds || []) {
      const ref = db.doc(`vinculos_organizacao/${membershipId}`);
      const snap = await ref.get();
      if (!snap.exists) continue;
      if (snap.data()?.smokeRunId !== state.runId) {
        fail(`Vínculo ${membershipId} não pertence ao smoke atual.`);
      }
      await ref.delete();
      membershipsDeleted += 1;
    }

    for (const courseId of state.courseIds || []) {
      const courseRef = db.doc(`courses/${courseId}`);
      const courseSnap = await courseRef.get();
      if (!courseSnap.exists) continue;
      if (courseSnap.data()?.smokeRunId !== state.runId) {
        fail(`Curso ${courseId} não pertence ao smoke atual.`);
      }

      lessonsDeleted += await deleteOwnedSubcollection(
        db,
        courseRef.collection('lessons'),
        state.runId,
        `Aula de ${courseId}`
      );
      modulesDeleted += await deleteOwnedSubcollection(
        db,
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
      if ((await db.doc(`enrollments/${enrollmentId}`).get()).exists) {
        residues.push(`enrollment:${enrollmentId}`);
      }
    }
    for (const membershipId of state.membershipIds || []) {
      if ((await db.doc(`vinculos_organizacao/${membershipId}`).get()).exists) {
        residues.push(`membership:${membershipId}`);
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

    if (residues.length) {
      fail(`Cleanup remoto incompleto: ${residues.join(', ')}`);
    }

    fs.unlinkSync(STATE_FILE);
    console.log(`TEMP_LESSONS_DELETED=${lessonsDeleted}`);
    console.log(`TEMP_MODULES_DELETED=${modulesDeleted}`);
    console.log(`TEMP_COURSES_DELETED=${coursesDeleted}`);
    console.log(`TEMP_ENROLLMENTS_DELETED=${enrollmentsDeleted}`);
    console.log(`TEMP_MEMBERSHIPS_DELETED=${membershipsDeleted}`);
    console.log(`TEMP_PROFILES_DELETED=${profilesDeleted}`);
    console.log(`TEMP_AUTH_USERS_DELETED=${authUsersDeleted}`);
    console.log('LOCAL_STATE_FILE_DELETED=True');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4B2_PROTECTED_CONSUMPTION_STAGING_CLEANUP=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO4B2_PROTECTED_CONSUMPTION_STAGING_CLEANUP=FAILED');
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
