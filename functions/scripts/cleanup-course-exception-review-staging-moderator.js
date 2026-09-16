'use strict';

const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const FIXTURE_FILE = path.join(
  __dirname,
  '..',
  '.course-exception-review-moderator-staging.local.json'
);

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
    fail('Arquivo local do moderador temporário não encontrado; nada foi removido automaticamente.');
  }
}

async function main() {
  validateEnvironment();

  const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8'));
  if (fixture.projectId !== TARGET_PROJECT) {
    fail(`Fixture local não pertence ao staging: ${fixture.projectId || 'vazio'}.`);
  }
  if (fixture.fixtureType !== 'course-exception-review-moderator') {
    fail('Tipo de fixture inesperado. Cleanup bloqueado.');
  }
  if (!fixture.uid || !fixture.runId) {
    fail('Fixture local incompleta. Cleanup bloqueado.');
  }

  const app = initializeApp({
    credential: applicationDefault(),
    projectId: TARGET_PROJECT
  }, `course-exception-review-moderator-cleanup-${fixture.runId}`);

  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 4A.4c - EXCEPTION REVIEW MODERATOR STAGING CLEANUP ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${fixture.runId}`);

  try {
    await Promise.all([
      auth.listUsers(1),
      db.collection('usuarios').limit(1).get()
    ]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const profileRef = db.doc(`usuarios/${fixture.uid}`);
    const profileSnap = await profileRef.get();
    if (profileSnap.exists) {
      const profile = profileSnap.data() || {};
      if (
        profile.smokeRunId !== fixture.runId ||
        profile.fixtureType !== 'course-exception-review-moderator'
      ) {
        fail('Perfil remoto não pertence à fixture atual; cleanup bloqueado.');
      }
      await profileRef.delete();
    }

    try {
      await auth.deleteUser(fixture.uid);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }

    const remainingProfile = await profileRef.get();
    if (remainingProfile.exists) {
      fail('Cleanup remoto incompleto; arquivo local foi preservado para recuperação.');
    }

    fs.unlinkSync(FIXTURE_FILE);

    console.log('TEMP_MODERATOR_PROFILE_DELETED=True');
    console.log('TEMP_MODERATOR_AUTH_USER_DELETED=True');
    console.log('TEMP_COURSES_DELETED=0');
    console.log('LOCAL_CREDENTIAL_FILE_DELETED=True');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4A4C_EXCEPTION_REVIEW_MODERATOR_CLEANUP=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO4A4C_EXCEPTION_REVIEW_MODERATOR_CLEANUP=FAILED');
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
