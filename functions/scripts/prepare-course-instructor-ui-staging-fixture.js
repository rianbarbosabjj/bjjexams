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
const OUTPUT_FILE = path.join(__dirname, '..', '.course-instructor-ui-staging.local.json');

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
    fail('Já existe fixture local ativa. Execute o cleanup antes de criar outra.');
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
  }, `course-ui-fixture-${runId}`);

  const auth = getAuth(app);
  const db = getFirestore(app);

  let uid = null;
  let organizationId = null;

  console.log('=== MARCO 4A.4b - INSTRUCTOR UI STAGING FIXTURE ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${runId}`);

  try {
    await Promise.all([
      auth.listUsers(1),
      db.collection('courses').limit(1).get()
    ]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const email = `ui-course-instructor-${runId}@example.invalid`;
    const password = randomPassword();

    const user = await auth.createUser({
      email,
      password,
      emailVerified: true,
      disabled: false,
      displayName: 'UI COURSE INSTRUCTOR'
    });
    uid = user.uid;

    organizationId = `ui-course-org-${runId}`;

    const batch = db.batch();
    batch.set(db.doc(`usuarios/${uid}`), {
      nome: 'UI COURSE INSTRUCTOR',
      email,
      tipo_usuario: 'professor',
      papel_principal: 'instrutor',
      papeis: ['instrutor'],
      status_conta: 'ativo',
      equipe_id: organizationId,
      equipe_origem: 'UI COURSE STAGING TEAM',
      status_vinculo: 'ativo',
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });
    batch.set(db.doc(`professores/${uid}`), {
      usuario_id: uid,
      equipe_id: organizationId,
      status_vinculo: 'ativo',
      eh_responsavel: false,
      pode_aprovar: false,
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });
    batch.set(db.doc(`equipes/${organizationId}`), {
      nome_equipe: 'UI COURSE STAGING TEAM',
      criado_por_uid: uid,
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });
    await batch.commit();

    const payload = {
      projectId: TARGET_PROJECT,
      runId,
      uid,
      email,
      password,
      organizationId,
      createdAt: new Date().toISOString()
    };

    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });

    console.log('TEMP_INSTRUCTOR_AUTH_USER=CREATED');
    console.log('TEMP_INSTRUCTOR_PROFILE=CREATED');
    console.log('TEMP_LEGACY_TEAM_FIXTURE=CREATED');
    console.log('LOCAL_CREDENTIAL_FILE=READY');
    console.log('PASSWORD_PRINTED=False');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4A4B_INSTRUCTOR_UI_FIXTURE=READY');
  } catch (error) {
    if (uid) {
      await Promise.allSettled([
        db.doc(`usuarios/${uid}`).delete(),
        db.doc(`professores/${uid}`).delete(),
        organizationId ? db.doc(`equipes/${organizationId}`).delete() : Promise.resolve(),
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
  console.error(`MARCO4A4B_INSTRUCTOR_UI_FIXTURE=FAILED`);
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
