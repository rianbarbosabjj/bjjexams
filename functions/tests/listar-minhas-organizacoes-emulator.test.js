"use strict";

const assert = require("node:assert/strict");

const {
  initializeApp,
  deleteApp
} = require("firebase-admin/app");

const {
  getFirestore
} = require("firebase-admin/firestore");

const {
  getAuth
} = require("firebase-admin/auth");

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
  "FIRESTORE_EMULATOR_HOST",
  process.env.FIRESTORE_EMULATOR_HOST
);

assertLocalEmulator(
  "FIREBASE_AUTH_EMULATOR_HOST",
  process.env.FIREBASE_AUTH_EMULATOR_HOST
);

const projectId = "demo-bjj-exams";

const runtimeProject =
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  "";

if (
  runtimeProject &&
  runtimeProject !== projectId
) {
  throw new Error(
    `Unexpected project: ${runtimeProject}`
  );
}

const functionsBase =
  "http://127.0.0.1:5001/" +
  projectId +
  "/southamerica-east1";

const callableUrl =
  `${functionsBase}/listarMinhasOrganizacoes`;

const authBase =
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const app = initializeApp(
  { projectId },
  `list-orgs-${process.pid}-${Date.now()}`
);

const db = getFirestore(app);
const auth = getAuth(app);

const runId =
  `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createdDocs = [];
const createdUsers = [];

let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function uidFor(suffix) {
  return `listorgs_${runId}_${suffix}`;
}

function emailFor(suffix) {
  return `listorgs_${runId}_${suffix}@example.test`;
}

function passwordFor(suffix) {
  return `T3st-${suffix}-${runId}!`;
}

async function createUser(suffix) {
  const uid = uidFor(suffix);
  const email = emailFor(suffix);
  const password = passwordFor(suffix);

  await auth.createUser({
    uid,
    email,
    password,
    emailVerified: true
  });

  createdUsers.push(uid);

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
      method: "POST",
      headers: {
        "content-type": "application/json"
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

async function callListOrganizations(idToken = null) {
  const headers = {
    "content-type": "application/json"
  };

  if (idToken) {
    headers.authorization =
      `Bearer ${idToken}`;
  }

  const response = await fetch(
    callableUrl,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: {}
      })
    }
  );

  let body = null;

  try {
    body = await response.json();
  } catch {
    body = {};
  }

  return {
    status: response.status,
    body
  };
}

function callablePayload(body) {
  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "result"
    )
  ) {
    return body.result;
  }

  return body.data;
}

async function createDoc(path, data) {
  await db.doc(path).set(data);
  createdDocs.push(path);
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
    `FUNCTION_URL=${callableUrl}`
  );

  // ============================================================
  // 1. CALLABLE CONTINUA PRIVADA
  // ============================================================

  await test(
    "Chamada anonima continua rejeitada",
    async () => {
      const response =
        await callListOrganizations();

      assert.equal(
        response.status,
        401
      );

      assert.equal(
        response.body?.error?.status,
        "UNAUTHENTICATED"
      );
    }
  );

  // ============================================================
  // 2. FIXTURE AUTENTICADA
  // ============================================================

  const user =
    await createUser("student");

  const orgManager =
    `org_manager_${runId}`;

  const orgInstructorAllowed =
    `org_instructor_allowed_${runId}`;

  const orgInstructorDenied =
    `org_instructor_denied_${runId}`;

  const orgStudent =
    `org_student_${runId}`;

  const orgPending =
    `org_pending_${runId}`;

  const orgOrphan =
    `org_orphan_${runId}`;

  // Organização canônica.
  await createDoc(
    `organizacoes/${orgManager}`,
    {
      nome: "Academia Manager",
      status: "ativa"
    }
  );

  // Apenas legado: valida fallback equipes.
  await createDoc(
    `equipes/${orgInstructorAllowed}`,
    {
      nome_equipe: "Academia Legada",
      status: "ativa"
    }
  );

  // Canônica e legado simultâneos:
  // a canônica deve prevalecer.
  await createDoc(
    `organizacoes/${orgInstructorDenied}`,
    {
      nome: "Academia Canonica",
      status: "ativa"
    }
  );

  await createDoc(
    `equipes/${orgInstructorDenied}`,
    {
      nome_equipe: "Academia Antiga",
      status: "ativa"
    }
  );

  await createDoc(
    `organizacoes/${orgStudent}`,
    {
      nome: "Academia Student",
      status: "ativa"
    }
  );

  await createDoc(
    `organizacoes/${orgPending}`,
    {
      nome: "Academia Pending",
      status: "ativa"
    }
  );

  // Manager ativo.
  await createDoc(
    `vinculos_organizacao/${orgManager}__${user.uid}`,
    {
      usuario_id: user.uid,
      organizacao_id: orgManager,
      papel: "gestor",
      status: "ativo",
      principal: true,
      pode_aplicar_exames: false
    }
  );

  // Instructor autorizado.
  await createDoc(
    `vinculos_organizacao/${orgInstructorAllowed}__${user.uid}`,
    {
      usuario_id: user.uid,
      organizacao_id: orgInstructorAllowed,
      papel: "professor",
      status: "ativo",
      principal: false,
      pode_aplicar_exames: true
    }
  );

  // Instructor não autorizado.
  await createDoc(
    `vinculos_organizacao/${orgInstructorDenied}__${user.uid}`,
    {
      usuario_id: user.uid,
      organizacao_id: orgInstructorDenied,
      papel: "professor",
      status: "ativo",
      principal: false,
      pode_aplicar_exames: false
    }
  );

  // Aluno com flag indevida:
  // nunca deve poder aplicar exame.
  await createDoc(
    `vinculos_organizacao/${orgStudent}__${user.uid}`,
    {
      usuario_id: user.uid,
      organizacao_id: orgStudent,
      papel: "aluno",
      status: "ativo",
      principal: false,
      pode_aplicar_exames: true
    }
  );

  // Pendente: getActiveMemberships deve omitir.
  await createDoc(
    `vinculos_organizacao/${orgPending}__${user.uid}`,
    {
      usuario_id: user.uid,
      organizacao_id: orgPending,
      papel: "gestor",
      status: "pendente",
      principal: false,
      pode_aplicar_exames: true
    }
  );

  // Ativo, mas organização inexistente:
  // a função deve ignorar.
  await createDoc(
    `vinculos_organizacao/${orgOrphan}__${user.uid}`,
    {
      usuario_id: user.uid,
      organizacao_id: orgOrphan,
      papel: "gestor",
      status: "ativo",
      principal: false,
      pode_aplicar_exames: true
    }
  );

  const token =
    await signIn(
      user.email,
      user.password
    );

  const response =
    await callListOrganizations(token);

  assert.equal(
    response.status,
    200
  );

  assert.equal(
    response.body?.error,
    undefined
  );

  const payload =
    callablePayload(response.body);

  assert.ok(payload);

  assert.ok(
    Array.isArray(payload.organizacoes)
  );

  const items =
    [...payload.organizacoes].sort(
      (a, b) => a.id.localeCompare(b.id)
    );

  // ============================================================
  // 3. CONTRATO PUBLICO EXATO
  // ============================================================

  await test(
    "Contrato publico preserva campos esperados",
    async () => {
      assert.equal(
        items.length,
        4
      );

      for (const item of items) {
        assert.deepEqual(
          Object.keys(item).sort(),
          [
            "id",
            "nome",
            "papel",
            "podeAplicarExames",
            "principal",
            "status"
          ].sort()
        );
      }
    }
  );

  // ============================================================
  // 4. SEMANTICA RBAC
  // ============================================================

  await test(
    "RBAC centralizado protege permissao de exame",
    async () => {
      const byId =
        Object.fromEntries(
          items.map(
            item => [item.id, item]
          )
        );

      assert.deepEqual(
        byId[orgManager],
        {
          id: orgManager,
          nome: "Academia Manager",
          papel: "gestor",
          status: "ativo",
          principal: true,
          podeAplicarExames: true
        }
      );

      assert.deepEqual(
        byId[orgInstructorAllowed],
        {
          id: orgInstructorAllowed,
          nome: "Academia Legada",
          papel: "professor",
          status: "ativo",
          principal: false,
          podeAplicarExames: true
        }
      );

      assert.deepEqual(
        byId[orgInstructorDenied],
        {
          id: orgInstructorDenied,
          nome: "Academia Canonica",
          papel: "professor",
          status: "ativo",
          principal: false,
          podeAplicarExames: false
        }
      );

      assert.deepEqual(
        byId[orgStudent],
        {
          id: orgStudent,
          nome: "Academia Student",
          papel: "aluno",
          status: "ativo",
          principal: false,
          podeAplicarExames: false
        }
      );
    }
  );

  // ============================================================
  // 5. FILTROS TRANSICIONAIS
  // ============================================================

  await test(
    "Vinculo pendente e organizacao inexistente sao omitidos",
    async () => {
      const ids =
        new Set(
          items.map(item => item.id)
        );

      assert.equal(
        ids.has(orgPending),
        false
      );

      assert.equal(
        ids.has(orgOrphan),
        false
      );
    }
  );

  console.log("");
  console.log(
    `RESULTADO_LISTAR_ORGS_EMULATOR=${passed}/4`
  );
}

main()
  .then(cleanup)
  .catch(async error => {
    console.error(error);

    try {
      await cleanup();
    } catch (_) {
      // Os emulators serao descartados ao final.
    }

    process.exit(1);
  });