'use strict';

const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const STATE_FILE = path.join(__dirname, '..', '.course-content-staging-smoke.local.json');

function fail(message) {
  throw new Error(message);
}

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
    fail('Arquivo de estado do smoke não encontrado. Nada foi removido.');
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (state.projectId !== TARGET_PROJECT) {
    fail(`Estado local aponta para projeto inesperado: ${state.projectId || 'sem projectId'}.`);
  }
  return state;
}

async function deleteQueryDocs(db, query) {
  const snap = await query.get();
  if (snap.empty) return 0;
  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
  return snap.size;
}

async function main() {
  const state = validateEnvironment();
  const app = initializeApp({
    credential: applicationDefault(),
    projectId: TARGET_PROJECT
  }, `course-content-smoke-cleanup-${state.runId}`);
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 4A.5a - COURSE CONTENT STAGING CLEANUP ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${state.runId}`);

  try {
    await Promise.all([
      auth.listUsers(1),
      db.collection('courses').limit(1).get()
    ]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    let subcollectionDocsDeleted = 0;
    let coursesDeleted = 0;
    let profilesDeleted = 0;
    let auditLogsDeleted = 0;
    let authUsersDeleted = 0;

    for (const courseId of state.courseIds || []) {
      const courseRef = db.doc(`courses/${courseId}`);
      subcollectionDocsDeleted += await deleteQueryDocs(db, courseRef.collection('modules'));
      subcollectionDocsDeleted += await deleteQueryDocs(db, courseRef.collection('lessons'));
      const snap = await courseRef.get();
      if (snap.exists) {
        await courseRef.delete();
        coursesDeleted += 1;
      }
    }

    for (const uid of state.userIds || []) {
      auditLogsDeleted += await deleteQueryDocs(
        db,
        db.collection('audit_logs').where('actorId', '==', uid)
      );

      const profileRef = db.doc(`usuarios/${uid}`);
      const profile = await profileRef.get();
      if (profile.exists) {
        await profileRef.delete();
        profilesDeleted += 1;
      }

      try {
        await auth.deleteUser(uid);
        authUsersDeleted += 1;
      } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error;
      }
    }

    fs.unlinkSync(STATE_FILE);

    console.log(`TEMP_SUBCOLLECTION_DOCS_DELETED=${subcollectionDocsDeleted}`);
    console.log(`TEMP_COURSES_DELETED=${coursesDeleted}`);
    console.log(`TEMP_AUDIT_LOGS_DELETED=${auditLogsDeleted}`);
    console.log(`TEMP_PROFILES_DELETED=${profilesDeleted}`);
    console.log(`TEMP_AUTH_USERS_DELETED=${authUsersDeleted}`);
    console.log('LOCAL_STATE_FILE_DELETED=True');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4A5A_COURSE_CONTENT_STAGING_CLEANUP=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO4A5A_COURSE_CONTENT_STAGING_CLEANUP=FAILED');
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
