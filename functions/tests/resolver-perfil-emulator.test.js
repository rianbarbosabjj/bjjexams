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

const projectId = 'demo-bjj-exams';

const functionsBase =
  'http://127.0.0.1:5001/' +
  projectId +
  '/southamerica-east1';

const resolverUrl =
  `${functionsBase}/resolverPerfilUsuario`;

const authBase =
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const app = initializeApp(
  { projectId },
  `resolver-profile-${process.pid}-${Date.now()}`
);

const db = getFirestore(app);
const auth = getAuth(app);

const runId =
  `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createdUsers = [];
const createdDocs = [];

let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function makeUid(suffix) {
  return `resolver_${runId}_${suffix}`;
}

function makeEmail(suffix) {
  return `resolver_${runId}_${suffix}@example.test`;
}

function makePassword(suffix) {
  return `T3st-${suffix}-${runId}!`;
}

async function createUser({
  suffix,
  emailVerified = true,
  initialClaims = {}
}) {
  const uid = makeUid(suffix);
  const email = makeEmail(suffix);
  const password = makePassword(suffix);

  await auth.createUser({
    uid,
    email,
    password,
    emailVerified
  });

  createdUsers.push(uid);

  if (Object.keys(initialClaims).length) {
    await auth.setCustomUserClaims(
      uid,
      initialClaims
    );
  }

  return {
    uid,
    email,
    password
  };
}

async function signIn(email, password) {
  const response = await fetch(
    `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
    }
  );

  const body = await response.json();

  if (!response.ok || !body.idToken) {
    throw new Error(
      `Auth Emulator sign-in failed: ${JSON.stringify(body)}`
    );
  }

  return body.idToken;
}

async function callResolver(idToken) {
  const response = await fetch(
    resolverUrl,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        data: {}
      })
    }
  );

  const body = await response.json();

  if (!response.ok || body.error) {
    throw new Error(
      `resolverPerfilUsuario failed: HTTP ${response.status} ${JSON.stringify(body)}`
    );
  }

  // O protocolo callable pode expor o retorno bruto
  // como result ou data dependendo da camada utilizada.
  const payload =
    Object.prototype.hasOwnProperty.call(body, 'result')
      ? body.result
      : body.data;

  if (!payload) {
    throw new Error(
      `Callable response without payload: ${JSON.stringify(body)}`
    );
  }

  return payload;
}

async function createDoc(path, data) {
  await db.doc(path).set(data);

  createdDocs.push(path);
}

async function getClaims(uid) {
  const user = await auth.getUser(uid);
  return user.customClaims || {};
}

async function cleanup() {
  await Promise.allSettled(
    createdDocs.map(
      path => db.doc(path).delete()
    )
  );

  await Promise.allSettled(
    createdUsers.map(
      uid => auth.deleteUser(uid)
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

  console.log(
    `FUNCTION_URL=${resolverUrl}`
  );

  // ============================================================
  // 1. ADMIN DIRETO
  // ============================================================

  await test(
    'Admin direto preserva contrato e recebe platform_admin',
    async () => {
      const user =
        await createUser({
          suffix: 'admin_direct'
        });

      await createDoc(
        `admins/${user.uid}`,
        {
          email: user.email,
          nome: 'Admin Direct'
        }
      );

      const token =
        await signIn(
          user.email,
          user.password
        );

      const payload =
        await callResolver(token);

      assert.deepEqual(
        payload,
        {
          encontrado: true,
          papel: 'admin',
          fonte: 'admins',
          migrado: false
        }
      );

      assert.deepEqual(
        await getClaims(user.uid),
        {
          platform_admin: true
        }
      );
    }
  );

  // ============================================================
  // 2. SUPER ADMIN
  // ============================================================

  await test(
    'Super Admin preserva precedencia e claims nao sincronizadas',
    async () => {
      const user =
        await createUser({
          suffix: 'super_direct',
          initialClaims: {
            platform_admin: true,
            finance_admin: true
          }
        });

      await createDoc(
        `super_admins/${user.uid}`,
        {
          email: user.email,
          nome: 'Super Direct'
        }
      );

      await createDoc(
        `admins/${user.uid}`,
        {
          email: user.email
        }
      );

      await createDoc(
        `usuarios/${user.uid}`,
        {
          email: user.email,
          tipo_usuario: 'admin'
        }
      );

      const token =
        await signIn(
          user.email,
          user.password
        );

      const payload =
        await callResolver(token);

      assert.deepEqual(
        payload,
        {
          encontrado: true,
          papel: 'superadmin',
          fonte: 'super_admins',
          migrado: false
        }
      );

      assert.deepEqual(
        await getClaims(user.uid),
        {
          finance_admin: true,
          super_admin: true
        }
      );
    }
  );

  // ============================================================
  // 3. ALUNO COM CLAIM ADMIN OBSOLETA
  // ============================================================

  await test(
    'Aluno preserva contrato e perde claim administrativa obsoleta',
    async () => {
      const user =
        await createUser({
          suffix: 'student',
          initialClaims: {
            platform_admin: true,
            support_admin: true
          }
        });

      await createDoc(
        `usuarios/${user.uid}`,
        {
          email: user.email,
          tipo_usuario: 'aluno'
        }
      );

      const token =
        await signIn(
          user.email,
          user.password
        );

      const payload =
        await callResolver(token);

      assert.deepEqual(
        payload,
        {
          encontrado: true,
          papel: 'aluno',
          fonte: 'usuarios',
          migrado: false
        }
      );

      assert.deepEqual(
        await getClaims(user.uid),
        {
          support_admin: true
        }
      );
    }
  );

  // ============================================================
  // 4. HOTFIX LEGADO - EMAIL VERIFICADO
  // ============================================================

  await test(
    'Perfil admin legado e relincado e sincroniza platform_admin',
    async () => {
      const user =
        await createUser({
          suffix: 'legacy_verified',
          emailVerified: true
        });

      const oldUid =
        makeUid('legacy_old');

      await createDoc(
        `admins/${oldUid}`,
        {
          email: user.email,
          nome: 'Legacy Admin'
        }
      );

      const token =
        await signIn(
          user.email,
          user.password
        );

      const payload =
        await callResolver(token);

      assert.deepEqual(
        payload,
        {
          encontrado: true,
          papel: 'admin',
          fonte: 'admins',
          migrado: true
        }
      );

      const migrated =
        await db.doc(
          `admins/${user.uid}`
        ).get();

      assert.equal(
        migrated.exists,
        true
      );

      assert.equal(
        migrated.data().migrado_de_uid,
        oldUid
      );

      assert.deepEqual(
        await getClaims(user.uid),
        {
          platform_admin: true
        }
      );

      createdDocs.push(
        `admins/${user.uid}`
      );
    }
  );

  // ============================================================
  // 5. HOTFIX LEGADO - EMAIL NAO VERIFICADO
  // ============================================================

  await test(
    'Perfil legado nao e relincado quando email nao esta verificado',
    async () => {
      const user =
        await createUser({
          suffix: 'legacy_unverified',
          emailVerified: false
        });

      const oldUid =
        makeUid('legacy_unverified_old');

      await createDoc(
        `admins/${oldUid}`,
        {
          email: user.email,
          nome: 'Legacy Unverified'
        }
      );

      const token =
        await signIn(
          user.email,
          user.password
        );

      const payload =
        await callResolver(token);

      assert.deepEqual(
        payload,
        {
          encontrado: false,
          perfilLegado: true,
          motivo: 'email_nao_verificado',
          fonte: 'admins'
        }
      );

      const migrated =
        await db.doc(
          `admins/${user.uid}`
        ).get();

      assert.equal(
        migrated.exists,
        false
      );

      assert.deepEqual(
        await getClaims(user.uid),
        {}
      );
    }
  );

  console.log('');
  console.log(
    `RESULTADO_RESOLVER_PERFIL_EMULATOR=${passed}/5`
  );
}

main()
  .then(cleanup)
  .catch(async error => {
    console.error(error);

    try {
      await cleanup();
    } catch (_) {
      // O conjunto inteiro de Emulators sera descartado.
    }

    process.exit(1);
  });