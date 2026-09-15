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
    throw new Error(
      `${name} is not configured.`
    );
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

const projectId =
  "demo-bjj-exams";

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
  `${functionsBase}/gerenciarMeuVinculoOrganizacao`;

const authBase =
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const app = initializeApp(
  { projectId },
  `manage-membership-${process.pid}-${Date.now()}`
);

const db = getFirestore(app);
const auth = getAuth(app);

const runId =
  `${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;

const createdUsers = [];
const createdDocs = new Set();

let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function uidFor(suffix) {
  return `manage_${runId}_${suffix}`;
}

function emailFor(suffix) {
  return `manage_${runId}_${suffix}@example.test`;
}

function passwordFor(suffix) {
  return `T3st-${suffix}-${runId}!`;
}

function trackDoc(path) {
  createdDocs.add(path);
}

async function createDoc(path, data) {
  await db.doc(path).set(data);
  trackDoc(path);
}

async function createActor(
  suffix,
  tipoUsuario = "professor",
  extraUserData = {}
) {
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

  await createDoc(
    `usuarios/${uid}`,
    {
      email,
      tipo_usuario: tipoUsuario,
      status_conta: "ativo",
      ...extraUserData
    }
  );

  // Pode ser criado pela Function.
  trackDoc(`professores/${uid}`);

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
      `Auth sign-in failed: ${JSON.stringify(body)}`
    );
  }

  return body.idToken;
}

async function callFunction(
  token,
  data = {}
) {
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
        data
      })
    }
  );

  let body = {};

  try {
    body = await response.json();
  } catch (_) {
    // Mantém objeto vazio para diagnóstico.
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
    [...createdDocs].map(
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
  // 1. ANÔNIMO
  // ============================================================

  await test(
    "Chamada anonima continua rejeitada",
    async () => {
      const response =
        await callFunction(
          null,
          {
            organizacaoId: "qualquer"
          }
        );

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
  // 2. PERFIL NÃO INSTRUTOR
  // ============================================================

  await test(
    "Aluno nao pode usar fluxo de gerenciamento de instrutor",
    async () => {
      const actor =
        await createActor(
          "student_actor",
          "aluno"
        );

      const token =
        await signIn(
          actor.email,
          actor.password
        );

      const response =
        await callFunction(
          token,
          {
            nome: "ALUNO TESTE"
          }
        );

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
  // 3. SOLICITAÇÃO PENDENTE NÃO TROCA ACADEMIA PRINCIPAL
  // ============================================================

  const oldOrg =
    `org_old_${runId}`;

  const targetOrg =
    `org_target_${runId}`;

  await createDoc(
    `organizacoes/${oldOrg}`,
    {
      nome: "Academia Antiga",
      status: "ativa"
    }
  );

  await createDoc(
    `organizacoes/${targetOrg}`,
    {
      nome: "Academia Target",
      status: "ativa"
    }
  );

  const pendingActor =
    await createActor(
      "pending_actor",
      "professor",
      {
        academia_principal_id: oldOrg,
        academia_principal_nome:
          "Academia Antiga",
        equipe_id: oldOrg,
        equipe_origem:
          "Academia Antiga"
      }
    );

  const pendingToken =
    await signIn(
      pendingActor.email,
      pendingActor.password
    );

  const pendingMembershipPath =
    `vinculos_organizacao/${targetOrg}__${pendingActor.uid}`;

  trackDoc(pendingMembershipPath);

  let firstPendingCreatedAt = null;
  let firstPendingUpdatedAt = null;

  await test(
    "Nova solicitacao pendente preserva academia principal",
    async () => {
      const response =
        await callFunction(
          pendingToken,
          {
            organizacaoId: targetOrg
          }
        );

      assert.equal(
        response.status,
        200
      );

      assert.deepEqual(
        payloadOf(response.body),
        {
          ok: true,
          organizacaoId: targetOrg,
          organizacaoNome:
            "Academia Target",
          statusVinculo:
            "pendente",
          papel: "professor"
        }
      );

      const membership =
        await db.doc(
          pendingMembershipPath
        ).get();

      assert.equal(
        membership.data().papel,
        "professor"
      );

      assert.equal(
        membership.data().status,
        "pendente"
      );

      assert.equal(
        membership.data().pode_aplicar_exames,
        false
      );

      firstPendingCreatedAt =
        membership.data()
          .criado_em
          .toMillis();

      firstPendingUpdatedAt =
        membership.data()
          .atualizado_em
          .toMillis();

      const user =
        await db.doc(
          `usuarios/${pendingActor.uid}`
        ).get();

      assert.equal(
        user.data().academia_principal_id,
        oldOrg
      );

      assert.equal(
        user.data().equipe_id,
        oldOrg
      );

      assert.equal(
        user.data().academia_pendente_id,
        targetOrg
      );
    }
  );

  // ============================================================
  // 4. RETRY PENDENTE É IDEMPOTENTE
  // ============================================================

  await test(
    "Retry da solicitacao pendente nao recria nem rebaixa vinculo",
    async () => {
      const response =
        await callFunction(
          pendingToken,
          {
            organizacaoId: targetOrg
          }
        );

      assert.equal(
        response.status,
        200
      );

      assert.equal(
        payloadOf(response.body)
          .statusVinculo,
        "pendente"
      );

      const membership =
        await db.doc(
          pendingMembershipPath
        ).get();

      assert.equal(
        membership.data().status,
        "pendente"
      );

      assert.equal(
        membership.data()
          .criado_em
          .toMillis(),
        firstPendingCreatedAt
      );

      assert.equal(
        membership.data()
          .atualizado_em
          .toMillis(),
        firstPendingUpdatedAt
      );
    }
  );

  // ============================================================
  // 5. VÍNCULO ATIVO NÃO É REBAIXADO
  // ============================================================

  const activeOrg =
    `org_active_${runId}`;

  await createDoc(
    `organizacoes/${activeOrg}`,
    {
      nome: "Academia Ativa",
      status: "ativa"
    }
  );

  const activeActor =
    await createActor(
      "active_actor",
      "professor",
      {
        academia_principal_id: oldOrg,
        academia_principal_nome:
          "Academia Antiga"
      }
    );

  const activeMembershipPath =
    `vinculos_organizacao/${activeOrg}__${activeActor.uid}`;

  await createDoc(
    activeMembershipPath,
    {
      usuario_id:
        activeActor.uid,
      organizacao_id:
        activeOrg,
      papel: "professor",
      status: "ativo",
      principal: true,
      pode_aplicar_exames: true
    }
  );

  const activeToken =
    await signIn(
      activeActor.email,
      activeActor.password
    );

  await test(
    "Vinculo ativo existente nunca volta para pendente",
    async () => {
      const response =
        await callFunction(
          activeToken,
          {
            organizacaoId: activeOrg
          }
        );

      assert.equal(
        response.status,
        200
      );

      assert.equal(
        payloadOf(response.body)
          .statusVinculo,
        "ativo"
      );

      assert.equal(
        payloadOf(response.body)
          .papel,
        "professor"
      );

      const membership =
        await db.doc(
          activeMembershipPath
        ).get();

      assert.equal(
        membership.data().status,
        "ativo"
      );

      assert.equal(
        membership.data().papel,
        "professor"
      );

      assert.equal(
        membership.data()
          .pode_aplicar_exames,
        true
      );

      const user =
        await db.doc(
          `usuarios/${activeActor.uid}`
        ).get();

      assert.equal(
        user.data().academia_principal_id,
        activeOrg
      );
    }
  );

  // ============================================================
  // 6. ORGANIZAÇÃO BLOQUEADA
  // ============================================================

  const blockedOrg =
    `org_blocked_${runId}`;

  await createDoc(
    `organizacoes/${blockedOrg}`,
    {
      nome: "Academia Suspensa",
      status: "suspensa"
    }
  );

  const blockedActor =
    await createActor(
      "blocked_actor"
    );

  const blockedToken =
    await signIn(
      blockedActor.email,
      blockedActor.password
    );

  const blockedMembershipPath =
    `vinculos_organizacao/${blockedOrg}__${blockedActor.uid}`;

  trackDoc(blockedMembershipPath);

  await test(
    "Academia suspensa nao aceita nova solicitacao",
    async () => {
      const response =
        await callFunction(
          blockedToken,
          {
            organizacaoId:
              blockedOrg
          }
        );

      assert.equal(
        response.body?.error?.status,
        "FAILED_PRECONDITION"
      );

      const membership =
        await db.doc(
          blockedMembershipPath
        ).get();

      assert.equal(
        membership.exists,
        false
      );
    }
  );

  // ============================================================
  // 7. VÍNCULO REJEITADO NÃO É RESSUSCITADO
  // ============================================================

  const rejectedOrg =
    `org_rejected_${runId}`;

  await createDoc(
    `organizacoes/${rejectedOrg}`,
    {
      nome: "Academia Rejeitada",
      status: "ativa"
    }
  );

  const rejectedActor =
    await createActor(
      "rejected_actor"
    );

  const rejectedMembershipPath =
    `vinculos_organizacao/${rejectedOrg}__${rejectedActor.uid}`;

  await createDoc(
    rejectedMembershipPath,
    {
      usuario_id:
        rejectedActor.uid,
      organizacao_id:
        rejectedOrg,
      papel: "professor",
      status: "rejeitado",
      principal: true,
      pode_aplicar_exames: false
    }
  );

  const rejectedToken =
    await signIn(
      rejectedActor.email,
      rejectedActor.password
    );

  await test(
    "Vinculo rejeitado exige fluxo explicito para nova tentativa",
    async () => {
      const response =
        await callFunction(
          rejectedToken,
          {
            organizacaoId:
              rejectedOrg
          }
        );

      assert.equal(
        response.body?.error?.status,
        "FAILED_PRECONDITION"
      );

      const membership =
        await db.doc(
          rejectedMembershipPath
        ).get();

      assert.equal(
        membership.data().status,
        "rejeitado"
      );
    }
  );

  // ============================================================
  // 8. CRIAÇÃO DE NOVA ACADEMIA
  // ============================================================

  const creator =
    await createActor(
      "creator_actor"
    );

  const creatorToken =
    await signIn(
      creator.email,
      creator.password
    );

  await test(
    "Criacao de nova academia gera gestor ativo",
    async () => {
      const response =
        await callFunction(
          creatorToken,
          {
            organizacaoId:
              "nova_equipe",
            novaOrganizacaoNome:
              "Nova Academia"
          }
        );

      assert.equal(
        response.status,
        200
      );

      const payload =
        payloadOf(response.body);

      assert.equal(
        payload.ok,
        true
      );

      assert.equal(
        payload.organizacaoNome,
        "NOVA ACADEMIA"
      );

      assert.equal(
        payload.statusVinculo,
        "ativo"
      );

      assert.equal(
        payload.papel,
        "gestor"
      );

      assert.ok(
        payload.organizacaoId
      );

      const orgId =
        payload.organizacaoId;

      const membershipPath =
        `vinculos_organizacao/${orgId}__${creator.uid}`;

      trackDoc(
        `organizacoes/${orgId}`
      );

      trackDoc(
        `equipes/${orgId}`
      );

      trackDoc(
        membershipPath
      );

      const [
        org,
        legacyOrg,
        membership,
        user,
        professor
      ] = await Promise.all([
        db.doc(
          `organizacoes/${orgId}`
        ).get(),

        db.doc(
          `equipes/${orgId}`
        ).get(),

        db.doc(
          membershipPath
        ).get(),

        db.doc(
          `usuarios/${creator.uid}`
        ).get(),

        db.doc(
          `professores/${creator.uid}`
        ).get()
      ]);

      assert.equal(
        org.exists,
        true
      );

      assert.equal(
        legacyOrg.exists,
        true
      );

      assert.equal(
        membership.data().papel,
        "gestor"
      );

      assert.equal(
        membership.data().status,
        "ativo"
      );

      assert.equal(
        membership.data()
          .pode_aplicar_exames,
        true
      );

      assert.equal(
        user.data()
          .academia_principal_id,
        orgId
      );

      assert.equal(
        professor.data()
          .eh_responsavel,
        true
      );

      assert.equal(
        professor.data()
          .pode_aprovar,
        true
      );
    }
  );

  // ============================================================
  // 9. FALLBACK DE EQUIPE LEGADA
  // ============================================================

  const legacyOnlyOrg =
    `org_legacy_${runId}`;

  await createDoc(
    `equipes/${legacyOnlyOrg}`,
    {
      nome_equipe:
        "Equipe Legada",
      status: "ativa"
    }
  );

  const legacyActor =
    await createActor(
      "legacy_actor",
      "professor",
      {
        academia_principal_id:
          oldOrg,
        academia_principal_nome:
          "Academia Antiga"
      }
    );

  const legacyToken =
    await signIn(
      legacyActor.email,
      legacyActor.password
    );

  const legacyMembershipPath =
    `vinculos_organizacao/${legacyOnlyOrg}__${legacyActor.uid}`;

  trackDoc(
    legacyMembershipPath
  );

  trackDoc(
    `organizacoes/${legacyOnlyOrg}`
  );

  await test(
    "Equipe legada e projetada sem ativar vinculo automaticamente",
    async () => {
      const response =
        await callFunction(
          legacyToken,
          {
            organizacaoId:
              legacyOnlyOrg
          }
        );

      assert.equal(
        response.status,
        200
      );

      const payload =
        payloadOf(response.body);

      assert.equal(
        payload.organizacaoNome,
        "Equipe Legada"
      );

      assert.equal(
        payload.statusVinculo,
        "pendente"
      );

      const canonicalOrg =
        await db.doc(
          `organizacoes/${legacyOnlyOrg}`
        ).get();

      assert.equal(
        canonicalOrg.exists,
        true
      );

      assert.equal(
        canonicalOrg.data()
          .migrado_de_equipes,
        true
      );

      const membership =
        await db.doc(
          legacyMembershipPath
        ).get();

      assert.equal(
        membership.data().status,
        "pendente"
      );

      const user =
        await db.doc(
          `usuarios/${legacyActor.uid}`
        ).get();

      assert.equal(
        user.data()
          .academia_principal_id,
        oldOrg
      );

      assert.equal(
        user.data()
          .academia_pendente_id,
        legacyOnlyOrg
      );
    }
  );

  console.log("");
  console.log(
    `RESULTADO_GERENCIAR_VINCULO_EMULATOR=${passed}/9`
  );
}

main()
  .then(cleanup)
  .catch(async error => {
    console.error(error);

    try {
      await cleanup();
    } catch (_) {
      // Emulators serão descartados.
    }

    process.exit(1);
  });