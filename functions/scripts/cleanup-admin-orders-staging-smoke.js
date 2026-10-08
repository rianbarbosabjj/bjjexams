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
const ALLOWED_BRANCH = 'feature/marco8-ops-console';
const STATE_FILE = path.join(__dirname, '..', '.admin-orders-staging-smoke.local.json');

function fail(message) { throw new Error(message); }

function currentBranch() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: path.join(__dirname, '..', '..'),
    encoding: 'utf8'
  }).trim();
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
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
  if (currentBranch() !== ALLOWED_BRANCH) {
    fail(`Branch não autorizada. Esperado: ${ALLOWED_BRANCH}.`);
  }
  if (!fs.existsSync(STATE_FILE)) {
    fail('Arquivo de estado do smoke 8.5F não encontrado. Nada foi removido.');
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  if (state.projectId !== TARGET_PROJECT) {
    fail(`Estado local aponta para projeto inesperado: ${state.projectId || 'sem projectId'}.`);
  }
  if (!state.runId) {
    fail('Estado local do smoke 8.5F sem runId.');
  }
  if (!Array.isArray(state.orderIds) || state.orderIds.length !== 2) {
    fail('Estado local do smoke 8.5F sem os dois orderIds esperados.');
  }

  return state;
}

async function deleteOwnedDocument(ref, runId, label, validator = null) {
  const snap = await ref.get();
  if (!snap.exists) return 0;

  const data = snap.data() || {};
  if (data.smokeRunId !== runId) {
    fail(`${label} ${ref.id} não pertence ao smoke atual.`);
  }
  if (validator) validator(data);

  await ref.delete();
  return 1;
}

async function deleteAuthUser(auth, uid) {
  if (!uid) return 0;

  try {
    await auth.deleteUser(uid);
    return 1;
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return 0;
    throw error;
  }
}

async function main() {
  const state = validateEnvironment();

  const app = initializeApp(
    {
      credential: applicationDefault(),
      projectId: TARGET_PROJECT
    },
    `admin-orders-cleanup-${state.runId}`
  );

  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 8.5F - ADMIN ORDERS STAGING CLEANUP ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${state.runId}`);

  try {
    await Promise.all([
      auth.listUsers(1),
      db.collection('orders').limit(1).get()
    ]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    let ordersDeleted = 0;
    let coursesDeleted = 0;
    let profilesDeleted = 0;
    let authUsersDeleted = 0;

    for (const orderId of state.orderIds) {
      ordersDeleted += await deleteOwnedDocument(
        db.doc(`orders/${orderId}`),
        state.runId,
        'Pedido',
        data => {
          if (
            data.productId !== state.courseId ||
            data.buyerUserId !== state.supportUserId
          ) {
            fail(`Pedido ${orderId} não corresponde à identidade da fixture.`);
          }
        }
      );
    }

    if (state.courseId) {
      coursesDeleted += await deleteOwnedDocument(
        db.doc(`courses/${state.courseId}`),
        state.runId,
        'Curso'
      );
    }

    for (const uid of [state.supportUserId, state.contentUserId]) {
      if (!uid) continue;

      profilesDeleted += await deleteOwnedDocument(
        db.doc(`usuarios/${uid}`),
        state.runId,
        'Perfil'
      );

      authUsersDeleted += await deleteAuthUser(auth, uid);
    }

    const residues = [];

    for (const orderId of state.orderIds) {
      if ((await db.doc(`orders/${orderId}`).get()).exists) {
        residues.push(`order:${orderId}`);
      }
    }

    if (state.courseId && (await db.doc(`courses/${state.courseId}`).get()).exists) {
      residues.push(`course:${state.courseId}`);
    }

    for (const uid of [state.supportUserId, state.contentUserId]) {
      if (!uid) continue;

      if ((await db.doc(`usuarios/${uid}`).get()).exists) {
        residues.push(`profile:${uid}`);
      }

      try {
        await auth.getUser(uid);
        residues.push(`auth:${uid}`);
      } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error;
      }
    }

    const txSnap = await db.collection('payment_transactions')
      .where('orderId', 'in', state.orderIds)
      .get();

    if (!txSnap.empty) {
      residues.push('payment_transactions');
    }

    if (residues.length) {
      fail(`Cleanup remoto incompleto: ${residues.join(', ')}`);
    }

    fs.unlinkSync(STATE_FILE);

    console.log(`TEMP_ORDERS_DELETED=${ordersDeleted}`);
    console.log(`TEMP_COURSES_DELETED=${coursesDeleted}`);
    console.log(`TEMP_PROFILES_DELETED=${profilesDeleted}`);
    console.log(`TEMP_AUTH_USERS_DELETED=${authUsersDeleted}`);
    console.log('TEMP_TRANSACTIONS_DELETED=0');
    console.log('REMOTE_RESIDUES=0');
    console.log('LOCAL_STATE_FILE_DELETED=True');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO8_5F_ADMIN_ORDERS_STAGING_CLEANUP=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO8_5F_ADMIN_ORDERS_STAGING_CLEANUP=FAILED');
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
