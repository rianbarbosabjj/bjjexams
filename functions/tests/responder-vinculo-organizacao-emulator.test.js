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
  `${functionsBase}/responderVinculoOrganizacao`;

const authBase =
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const app = initializeApp(
  { projectId },
  `respond-membership-${process.pid}-${Date.now()}`
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
  return `resp_${runId}_${suffix}`;
}

function makeEmail(suffix) {
  return `resp_${runId}_${suffix}@example.test`;
}

function makePassword(suffix) {
  return `T3st-${suffix}-${runId}!`;
}

async function createAuthUser(suffix) {
  const uid = makeUid(suffix);
  const email = makeEmail(suffix);
  const password = makePassword(suffix);

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

async function createDoc(path, data) {
  await db.doc(path).set(data);
  createdDocs.push(path);
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
      `Auth sign-in failed: ${JSON.stringify(body)}`
    );
  }

  return body.idToken;
}

async function callFunction({
  token = null,
  usuarioId,
  organizacaoId,
  tipo = "aluno",
  status = "ativo"
}) {
  const headers = {
    "content-type": "application/json"
  };

  if (token) {
    headers.authorization =
      `Bearer ${token}`;
  }

  const response = await fetch(
    callableUrl,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: {
          usuarioId,
          organizacaoId,
          tipo,
          status
        }
      })
    }
  );

  let body = {};

  try {
    body = await response.json();
  } catch (_) {
    // Mantem objeto vazio para diagnostico.
  }

  return {
    status: response.status,
    body
  };
}

function payloadOf(body) {
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

  const orgTarget =
    `org_target_${runId}`;

  const orgOther =
    `org_other_${runId}`;

  await createDoc(
    `organizacoes/${orgTarget}`,
    {
      nome: "Academia Target",
      status: "ativa"
    }
  );

  await createDoc(
    `organizacoes/${orgOther}`,
    {
      nome: "Academia Other",
      status: "ativa"
    }
  );

  // ============================================================
  // ATORES
  // ============================================================

  const manager =
    await createAuthUser("manager");

  await createDoc(
    `usuarios/${manager.uid}`,
    {
      email: manager.email,
      tipo_usuario: "professor",
      status_conta: "ativo"
    }
  );

  await createDoc(
    `vinculos_organizacao/${orgTarget}__${manager.uid}`,
    {
      usuario_id: manager.uid,
      organizacao_id: orgTarget,
      papel: "gestor",
      status: "ativo",
      principal: true,
      pode_aplicar_exames: true
    }
  );

  const instructor =
    await createAuthUser("instructor");

  await createDoc(
    `usuarios/${instructor.uid}`,
    {
      email: instructor.email,
      tipo_usuario: "professor",
      status_conta: "ativo"
    }
  );

  await createDoc(
    `vinculos_organizacao/${orgTarget}__${instructor.uid}`,
    {
      usuario_id: instructor.uid,
      organizacao_id: orgTarget,
      papel: "professor",
      status: "ativo",
      principal: true,
      pode_aplicar_exames: true
    }
  );

  const otherManager =
    await createAuthUser("other_manager");

  await createDoc(
    `usuarios/${otherManager.uid}`,
    {
      email: otherManager.email,
      tipo_usuario: "professor",
      status_conta: "ativo"
    }
  );

  await createDoc(
    `vinculos_organizacao/${orgOther}__${otherManager.uid}`,
    {
      usuario_id: otherManager.uid,
      organizacao_id: orgOther,
      papel: "gestor",
      status: "ativo",
      principal: true,
      pode_aplicar_exames: true
    }
  );

  const managerToken =
    await signIn(
      manager.email,
      manager.password
    );

  const instructorToken =
    await signIn(
      instructor.email,
      instructor.password
    );

  const otherManagerToken =
    await signIn(
      otherManager.email,
      otherManager.password
    );

  // ============================================================
  // ALUNO PENDENTE
  // ============================================================

  const targetUid =
    makeUid("student_pending");

  await createDoc(
    `usuarios/${targetUid}`,
    {
      tipo_usuario: "aluno",
      academia_pendente_id: orgTarget,
      academia_pendente_nome: "Academia Target"
    }
  );

  await createDoc(
    `alunos/${targetUid}`,
    {
      usuario_id: targetUid,
      equipe_id: orgTarget,
      status_vinculo: "pendente"
    }
  );

  await createDoc(
    `vinculos_organizacao/${orgTarget}__${targetUid}`,
    {
      usuario_id: targetUid,
      organizacao_id: orgTarget,
      papel: "aluno",
      status: "pendente",
      principal: true,
      pode_aplicar_exames: false
    }
  );

  // ============================================================
  // 1. ANONIMO
  // ============================================================

  await test(
    "Chamada anonima continua rejeitada",
    async () => {
      const response =
        await callFunction({
          usuarioId: targetUid,
          organizacaoId: orgTarget
        });

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
  // 2. INSTRUTOR COM PERMISSAO DE EXAME NAO E GESTOR
  // ============================================================

  await test(
    "Instrutor autorizado para exames nao pode aprovar vinculos",
    async () => {
      const response =
        await callFunction({
          token: instructorToken,
          usuarioId: targetUid,
          organizacaoId: orgTarget
        });

      assert.equal(
        response.status,
        403
      );

      assert.equal(
        response.body?.error?.status,
        "PERMISSION_DENIED"
      );

      const membership =
        await db.doc(
          `vinculos_organizacao/${orgTarget}__${targetUid}`
        ).get();

      assert.equal(
        membership.data().status,
        "pendente"
      );
    }
  );

  // ============================================================
  // 3. GESTOR DE OUTRA ACADEMIA
  // ============================================================

  await test(
    "Gestor de outra academia nao pode aprovar vinculo",
    async () => {
      const response =
        await callFunction({
          token: otherManagerToken,
          usuarioId: targetUid,
          organizacaoId: orgTarget
        });

      assert.equal(
        response.status,
        403
      );

      assert.equal(
        response.body?.error?.status,
        "PERMISSION_DENIED"
      );
    }
  );

  // ============================================================
  // 4. NAO PODE CRIAR VINCULO DIRETAMENTE
  // ============================================================

  await test(
    "Gestor nao pode ativar usuario sem solicitacao previa",
    async () => {
      const noPendingUid =
        makeUid("without_pending");

      await createDoc(
        `usuarios/${noPendingUid}`,
        {
          tipo_usuario: "aluno"
        }
      );

      await createDoc(
        `alunos/${noPendingUid}`,
        {
          usuario_id: noPendingUid,
          status_vinculo: "ativo"
        }
      );

      const response =
        await callFunction({
          token: managerToken,
          usuarioId: noPendingUid,
          organizacaoId: orgTarget
        });

      assert.equal(
        response.body?.error?.status,
        "FAILED_PRECONDITION"
      );

      const membership =
        await db.doc(
          `vinculos_organizacao/${orgTarget}__${noPendingUid}`
        ).get();

      assert.equal(
        membership.exists,
        false
      );
    }
  );

  // ============================================================
  // 5. TIPO INFORMADO DEVE CORRESPONDER AO VINCULO
  // ============================================================

  await test(
    "Tipo informado nao pode divergir do papel do vinculo",
    async () => {
      const mismatchUid =
        makeUid("mismatch");

      await createDoc(
        `usuarios/${mismatchUid}`,
        {
          tipo_usuario: "aluno"
        }
      );

      await createDoc(
        `alunos/${mismatchUid}`,
        {
          usuario_id: mismatchUid,
          status_vinculo: "pendente"
        }
      );

      await createDoc(
        `vinculos_organizacao/${orgTarget}__${mismatchUid}`,
        {
          usuario_id: mismatchUid,
          organizacao_id: orgTarget,
          papel: "professor",
          status: "pendente",
          principal: true,
          pode_aplicar_exames: false
        }
      );

      const response =
        await callFunction({
          token: managerToken,
          usuarioId: mismatchUid,
          organizacaoId: orgTarget,
          tipo: "aluno",
          status: "ativo"
        });

      assert.equal(
        response.body?.error?.status,
        "FAILED_PRECONDITION"
      );

      const membership =
        await db.doc(
          `vinculos_organizacao/${orgTarget}__${mismatchUid}`
        ).get();

      assert.equal(
        membership.data().status,
        "pendente"
      );
    }
  );

  // ============================================================
  // 6. GESTOR CORRETO APROVA SOLICITACAO PENDENTE
  // ============================================================

  await test(
    "Gestor da academia aprova vinculo pendente",
    async () => {
      const response =
        await callFunction({
          token: managerToken,
          usuarioId: targetUid,
          organizacaoId: orgTarget,
          tipo: "aluno",
          status: "ativo"
        });

      assert.equal(
        response.status,
        200
      );

      assert.deepEqual(
        payloadOf(response.body),
        {
          ok: true,
          status: "ativo"
        }
      );

      const membership =
        await db.doc(
          `vinculos_organizacao/${orgTarget}__${targetUid}`
        ).get();

      assert.equal(
        membership.data().status,
        "ativo"
      );

      assert.equal(
        membership.data().papel,
        "aluno"
      );

      assert.equal(
        membership.data().pode_aplicar_exames,
        false
      );

      assert.equal(
        membership.data().aprovado_por_uid,
        manager.uid
      );

      const legacy =
        await db.doc(
          `alunos/${targetUid}`
        ).get();

      assert.equal(
        legacy.data().equipe_id,
        orgTarget
      );

      assert.equal(
        legacy.data().status_vinculo,
        "ativo"
      );

      const user =
        await db.doc(
          `usuarios/${targetUid}`
        ).get();

      assert.equal(
        user.data().academia_principal_id,
        orgTarget
      );

      assert.equal(
        user.data().academia_pendente_id,
        null
      );
    }
  );

  // ============================================================
  // 7. RETRY IDEMPOTENTE
  // ============================================================

  await test(
    "Retry da mesma aprovacao permanece idempotente",
    async () => {
      const response =
        await callFunction({
          token: managerToken,
          usuarioId: targetUid,
          organizacaoId: orgTarget,
          tipo: "aluno",
          status: "ativo"
        });

      assert.equal(
        response.status,
        200
      );

      assert.deepEqual(
        payloadOf(response.body),
        {
          ok: true,
          status: "ativo"
        }
      );
    }
  );

  console.log("");
  console.log(
    `RESULTADO_RESPONDER_VINCULO_EMULATOR=${passed}/7`
  );
}

main()
  .then(cleanup)
  .catch(async error => {
    console.error(error);

    try {
      await cleanup();
    } catch (_) {
      // O conjunto de emulators sera descartado.
    }

    process.exit(1);
  });