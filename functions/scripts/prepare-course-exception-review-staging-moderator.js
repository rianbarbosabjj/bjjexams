'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const OUTPUT_FILE = path.join(
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
    fail(`Fixture bloqueada. Defina BJJEXAMS_STAGING_SMOKE_CONFIRM=${CONFIRMATION_VALUE}.`);
  }
  if (declaredProject === PRODUCTION_PROJECT) {
    fail('Projeto de produção detectado. Execução bloqueada.');
  }
  if (declaredProject && declaredProject !== TARGET_PROJECT) {
    fail(`Projeto declarado incompatível com staging: ${declaredProject}.`);
  }
  if (fs.existsSync(OUTPUT_FILE)) {
    fail('Já existe moderador temporário ativo. Execute o cleanup antes de criar outro.');
  }
}

function randomPassword() {
  return `BjjExams-${crypto.randomBytes(18).toString('hex')}!Aa9`;
}

async function main() {
  validateEnvironment();

  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const app = initializeApp({
    credential: applicationDefault(),
    projectId: TARGET_PROJECT
  }, `course-exception-review-moderator-${runId}`);

  const auth = getAuth(app);
  const db = getFirestore(app);
  let uid = null;

  console.log('=== MARCO 4A.4c - EXCEPTION REVIEW MODERATOR STAGING FIXTURE ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${runId}`);

  try {
    await Promise.all([
      auth.listUsers(1),
      db.collection('usuarios').limit(1).get()
    ]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const email = `exception-review-moderator-${runId}@example.invalid`;
    const password = randomPassword();
    const user = await auth.createUser({
      email,
      password,
      emailVerified: true,
      disabled: false,
      displayName: 'EXCEPTION REVIEW MODERATOR'
    });
    uid = user.uid;

    await auth.setCustomUserClaims(uid, {
      platform_admin: true
    });

    const claimedUser = await auth.getUser(uid);
    if (claimedUser.customClaims?.platform_admin !== true) {
      fail('Claim platform_admin não foi aplicada ao moderador temporário.');
    }

    await db.doc(`usuarios/${uid}`).set({
      nome: 'EXCEPTION REVIEW MODERATOR',
      email,
      tipo_usuario: 'admin',
      papel_principal: 'platform_admin',
      papeis: ['platform_admin'],
      status_conta: 'ativo',
      fixtureType: 'course-exception-review-moderator',
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });

    const payload = {
      projectId: TARGET_PROJECT,
      runId,
      uid,
      email,
      password,
      fixtureType: 'course-exception-review-moderator',
      createdAt: new Date().toISOString()
    };

    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });

    console.log('TEMP_MODERATOR_AUTH_USER=CREATED');
    console.log('TEMP_MODERATOR_PLATFORM_ADMIN_CLAIM=True');
    console.log('TEMP_MODERATOR_PROFILE=CREATED');
    console.log('TEMP_COURSES_CREATED=0');
    console.log('LOCAL_CREDENTIAL_FILE=READY');
    console.log('PASSWORD_PRINTED=False');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4A4C_EXCEPTION_REVIEW_MODERATOR_FIXTURE=READY');
  } catch (error) {
    if (uid) {
      await Promise.allSettled([
        db.doc(`usuarios/${uid}`).delete(),
        auth.deleteUser(uid)
      ]);
    }
    if (fs.existsSync(OUTPUT_FILE)) fs.unlinkSync(OUTPUT_FILE);
    throw error;
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO4A4C_EXCEPTION_REVIEW_MODERATOR_FIXTURE=FAILED');
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
