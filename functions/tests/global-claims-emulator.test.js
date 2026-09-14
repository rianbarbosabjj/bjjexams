'use strict';

const assert = require('node:assert/strict');

const {
  initializeApp,
  deleteApp
} = require('firebase-admin/app');

const {
  getFirestore
} = require('firebase-admin/firestore');

const {
  getAuth
} = require('firebase-admin/auth');

const {
  createGlobalClaimsService
} = require('../src/auth/global-claims-service');

function assertLocalEmulator(name, value) {
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  const localPattern =
    /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;

  if (!localPattern.test(value)) {
    throw new Error(
      `${name} is not local: ${value}`
    );
  }
}

assertLocalEmulator(
  'FIRESTORE_EMULATOR_HOST',
  process.env.FIRESTORE_EMULATOR_HOST
);

assertLocalEmulator(
  'FIREBASE_AUTH_EMULATOR_HOST',
  process.env.FIREBASE_AUTH_EMULATOR_HOST
);

const projectId = 'bjj-exams-staging';

const app = initializeApp(
  { projectId },
  `claims-emulator-test-${process.pid}-${Date.now()}`
);

const db = getFirestore(app);
const auth = getAuth(app);

const service = createGlobalClaimsService({
  db,
  auth
});

const runId =
  `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createdUids = [];
const createdDocs = [];

let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function uid(suffix) {
  return `claims_it_${runId}_${suffix}`;
}

async function createAuthUser(
  userId,
  initialClaims = {}
) {
  await auth.createUser({
    uid: userId
  });

  createdUids.push(userId);

  if (Object.keys(initialClaims).length) {
    await auth.setCustomUserClaims(
      userId,
      initialClaims
    );
  }
}

async function createDoc(path, data) {
  await db.doc(path).set(data);
  createdDocs.push(path);
}

async function getClaims(userId) {
  const user = await auth.getUser(userId);
  return user.customClaims || {};
}

async function cleanup() {
  await Promise.allSettled(
    createdDocs.map(
      path => db.doc(path).delete()
    )
  );

  await Promise.allSettled(
    createdUids.map(
      userId => auth.deleteUser(userId)
    )
  );

  await deleteApp(app);
}

async function main() {
  console.log(
    `AUTH_EMULATOR=${process.env.FIREBASE_AUTH_EMULATOR_HOST}`
  );

  console.log(
    `FIRESTORE_EMULATOR=${process.env.FIRESTORE_EMULATOR_HOST}`
  );

  await test(
    'Super Admin real preserva claims nao sincronizadas',
    async () => {
      const userId = uid('super');

      await createAuthUser(
        userId,
        {
          platform_admin: true,
          finance_admin: true,
          external_claim: 'preservar'
        }
      );

      await createDoc(
        `super_admins/${userId}`,
        { ativo: true }
      );

      await createDoc(
        `admins/${userId}`,
        { ativo: true }
      );

      await createDoc(
        `usuarios/${userId}`,
        { tipo_usuario: 'admin' }
      );

      const result =
        await service.synchronizeUserGlobalClaims(
          userId
        );

      assert.equal(result.updated, true);

      assert.deepEqual(
        await getClaims(userId),
        {
          finance_admin: true,
          external_claim: 'preservar',
          super_admin: true
        }
      );
    }
  );

  await test(
    'Marker admins real gera platform_admin',
    async () => {
      const userId = uid('admin_marker');

      await createAuthUser(userId);

      await createDoc(
        `admins/${userId}`,
        { ativo: true }
      );

      await createDoc(
        `usuarios/${userId}`,
        { tipo_usuario: 'aluno' }
      );

      const result =
        await service.synchronizeUserGlobalClaims(
          userId
        );

      assert.equal(result.updated, true);

      assert.deepEqual(
        await getClaims(userId),
        {
          platform_admin: true
        }
      );
    }
  );

  await test(
    'usuarios admin real gera platform_admin',
    async () => {
      const userId = uid('user_admin');

      await createAuthUser(userId);

      await createDoc(
        `usuarios/${userId}`,
        { tipo_usuario: 'admin' }
      );

      await service.synchronizeUserGlobalClaims(
        userId
      );

      assert.deepEqual(
        await getClaims(userId),
        {
          platform_admin: true
        }
      );
    }
  );

  await test(
    'Usuario comum revoga somente claims sincronizadas',
    async () => {
      const userId = uid('student');

      await createAuthUser(
        userId,
        {
          super_admin: true,
          platform_admin: true,
          support_admin: true,
          external_claim: {
            origem: 'teste'
          }
        }
      );

      await createDoc(
        `usuarios/${userId}`,
        { tipo_usuario: 'aluno' }
      );

      await service.synchronizeUserGlobalClaims(
        userId
      );

      assert.deepEqual(
        await getClaims(userId),
        {
          support_admin: true,
          external_claim: {
            origem: 'teste'
          }
        }
      );
    }
  );

  await test(
    'Segunda sincronizacao real e idempotente',
    async () => {
      const userId = uid('idempotent');

      await createAuthUser(userId);

      await createDoc(
        `admins/${userId}`,
        { ativo: true }
      );

      const first =
        await service.synchronizeUserGlobalClaims(
          userId
        );

      const second =
        await service.synchronizeUserGlobalClaims(
          userId
        );

      assert.equal(first.updated, true);
      assert.equal(second.updated, false);

      assert.deepEqual(
        await getClaims(userId),
        {
          platform_admin: true
        }
      );
    }
  );

  console.log('');
  console.log(
    `RESULTADO_GLOBAL_CLAIMS_EMULATOR=${passed}/5`
  );
}

main()
  .then(cleanup)
  .catch(async error => {
    console.error(error);

    try {
      await cleanup();
    } catch (_) {
      // O emulator sera descartado de qualquer forma.
    }

    process.exit(1);
  });