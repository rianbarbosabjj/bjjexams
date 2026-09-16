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
const OUTPUT_FILE = path.join(__dirname, '..', '.course-moderation-ui-staging.local.json');

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

function coursePayload({ runId, uid, title, status, isPaid = false, priceCents = 0 }) {
  return {
    title,
    description: `Curso temporário de staging para validar o fluxo de moderação ${runId}.`,
    ownerType: 'platform',
    ownerId: null,
    instructorIds: [uid],
    visibility: 'platform',
    organizationId: null,
    status,
    isPaid,
    priceCents,
    currency: 'BRL',
    financialRuleId: null,
    publishedAt: ['published', 'suspended'].includes(status)
      ? FieldValue.serverTimestamp()
      : null,
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    smokeRunId: runId
  };
}

async function main() {
  validateEnvironment();

  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const app = initializeApp({
    credential: applicationDefault(),
    projectId: TARGET_PROJECT
  }, `course-moderation-ui-fixture-${runId}`);

  const auth = getAuth(app);
  const db = getFirestore(app);
  let uid = null;
  const courseIds = [];

  console.log('=== MARCO 4A.4c - MODERATION UI STAGING FIXTURE ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${runId}`);

  try {
    await Promise.all([
      auth.listUsers(1),
      db.collection('courses').limit(1).get()
    ]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const email = `ui-course-moderator-${runId}@example.invalid`;
    const password = randomPassword();
    const user = await auth.createUser({
      email,
      password,
      emailVerified: true,
      disabled: false,
      displayName: 'UI COURSE MODERATOR'
    });
    uid = user.uid;

    await auth.setCustomUserClaims(uid, {
      platform_admin: true
    });

    const claimedUser = await auth.getUser(uid);
    if (claimedUser.customClaims?.platform_admin !== true) {
      fail('Claim platform_admin não foi aplicada ao usuário temporário.');
    }

    const batch = db.batch();
    batch.set(db.doc(`usuarios/${uid}`), {
      nome: 'UI COURSE MODERATOR',
      email,
      tipo_usuario: 'admin',
      papel_principal: 'platform_admin',
      papeis: ['platform_admin'],
      status_conta: 'ativo',
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });

    const fixtures = [
      { title: 'MODERAÇÃO UI - DEVOLVER PARA RASCUNHO', status: 'review', isPaid: false, priceCents: 0 },
      { title: 'MODERAÇÃO UI - PUBLICAR', status: 'review', isPaid: true, priceCents: 14940 },
      { title: 'MODERAÇÃO UI - SUSPENDER', status: 'published', isPaid: true, priceCents: 19990 },
      { title: 'MODERAÇÃO UI - REPUBLICAR', status: 'suspended', isPaid: false, priceCents: 0 }
    ];

    for (const fixture of fixtures) {
      const ref = db.collection('courses').doc();
      courseIds.push(ref.id);
      batch.create(ref, coursePayload({
        runId,
        uid,
        ...fixture
      }));
    }

    await batch.commit();

    const payload = {
      projectId: TARGET_PROJECT,
      runId,
      uid,
      email,
      password,
      courseIds,
      createdAt: new Date().toISOString()
    };

    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });

    console.log('TEMP_MODERATOR_AUTH_USER=CREATED');
    console.log('TEMP_MODERATOR_PLATFORM_ADMIN_CLAIM=True');
    console.log('TEMP_MODERATOR_PROFILE=CREATED');
    console.log(`TEMP_COURSES_CREATED=${courseIds.length}`);
    console.log('LOCAL_CREDENTIAL_FILE=READY');
    console.log('PASSWORD_PRINTED=False');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4A4C_MODERATION_UI_FIXTURE=READY');
  } catch (error) {
    const cleanup = [];
    for (const courseId of courseIds) {
      cleanup.push(db.doc(`courses/${courseId}`).delete());
    }
    if (uid) {
      cleanup.push(db.doc(`usuarios/${uid}`).delete());
      cleanup.push(auth.deleteUser(uid));
    }
    await Promise.allSettled(cleanup);
    if (fs.existsSync(OUTPUT_FILE)) fs.unlinkSync(OUTPUT_FILE);
    throw error;
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO4A4C_MODERATION_UI_FIXTURE=FAILED');
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
