'use strict';

const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const FIXTURE_FILE = path.join(__dirname, '..', '.course-moderation-ui-staging.local.json');

function fail(message) {
  throw new Error(message);
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    ''
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
  if (!fs.existsSync(FIXTURE_FILE)) {
    fail('Arquivo local da fixture não encontrado; nada foi removido automaticamente.');
  }
}

async function deleteQuery(db, query) {
  const snap = await query.get();
  if (snap.empty) return 0;

  let batch = db.batch();
  let count = 0;
  let total = 0;

  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    count += 1;
    total += 1;
    if (count === 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) await batch.commit();
  return total;
}

async function main() {
  validateEnvironment();

  const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8'));
  if (fixture.projectId !== TARGET_PROJECT) {
    fail(`Fixture local não pertence ao staging: ${fixture.projectId || 'vazio'}.`);
  }

  const app = initializeApp({
    credential: applicationDefault(),
    projectId: TARGET_PROJECT
  }, `course-moderation-ui-cleanup-${fixture.runId}`);

  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 4A.4c - MODERATION UI STAGING CLEANUP ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${fixture.runId}`);

  try {
    await Promise.all([
      auth.listUsers(1),
      db.collection('courses').limit(1).get()
    ]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    let auditDeleted = 0;
    let coursesDeleted = 0;

    for (const courseId of fixture.courseIds || []) {
      auditDeleted += await deleteQuery(
        db,
        db.collection('audit_logs').where('entityId', '==', courseId)
      );

      const ref = db.doc(`courses/${courseId}`);
      const snap = await ref.get();
      if (snap.exists) {
        const data = snap.data();
        if (data.smokeRunId !== fixture.runId) {
          fail(`Curso ${courseId} não pertence à fixture atual; cleanup bloqueado.`);
        }
        await ref.delete();
        coursesDeleted += 1;
      }
    }

    await db.doc(`usuarios/${fixture.uid}`).delete();

    try {
      await auth.deleteUser(fixture.uid);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }

    const [profileSnap, remainingCourses] = await Promise.all([
      db.doc(`usuarios/${fixture.uid}`).get(),
      db.collection('courses').where('smokeRunId', '==', fixture.runId).limit(1).get()
    ]);

    if (profileSnap.exists || !remainingCourses.empty) {
      fail('Cleanup remoto incompleto; arquivo local de credenciais foi preservado para recuperação.');
    }

    fs.unlinkSync(FIXTURE_FILE);

    console.log(`TEMP_COURSES_DELETED=${coursesDeleted}`);
    console.log(`TEMP_AUDIT_LOGS_DELETED=${auditDeleted}`);
    console.log('TEMP_MODERATOR_PROFILE_DELETED=True');
    console.log('TEMP_MODERATOR_AUTH_USER_DELETED=True');
    console.log('LOCAL_CREDENTIAL_FILE_DELETED=True');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4A4C_MODERATION_UI_CLEANUP=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO4A4C_MODERATION_UI_CLEANUP=FAILED');
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
