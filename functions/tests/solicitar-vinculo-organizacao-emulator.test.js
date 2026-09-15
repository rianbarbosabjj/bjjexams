"use strict";

const assert =
  require("node:assert/strict");

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

function assertLocal(name, value) {
  if (!value) {
    throw new Error(
      `${name} ausente`
    );
  }

  if (
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/
      .test(value)
  ) {
    throw new Error(
      `${name} nao e local: ${value}`
    );
  }
}

assertLocal(
  "FIRESTORE_EMULATOR_HOST",
  process.env.FIRESTORE_EMULATOR_HOST
);

assertLocal(
  "FIREBASE_AUTH_EMULATOR_HOST",
  process.env.FIREBASE_AUTH_EMULATOR_HOST
);

const projectId =
  "demo-bjj-exams";

const functionsBase =
  `http://127.0.0.1:5001/${projectId}/southamerica-east1`;

const callableUrl =
  `${functionsBase}/solicitarVinculoOrganizacao`;

const authBase =
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const app =
  initializeApp(
    { projectId },
    `request-membership-${process.pid}-${Date.now()}`
  );

const db =
  getFirestore(app);

const auth =
  getAuth(app);

const runId =
  `${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;

const docs =
  new Set();

const users = [];

let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function uid(suffix) {
  return `req_${runId}_${suffix}`;
}

function email(suffix) {
  return `req_${runId}_${suffix}@example.test`;
}

function password(suffix) {
  return `T3st-${suffix}-${runId}!`;
}

async function setDoc(path, data) {
  await db.doc(path).set(data);
  docs.add(path);
}

function track(path) {
  docs.add(path);
}

async function createUser(
  suffix,
  tipo = "aluno",
  extra = {}
) {
  const id = uid(suffix);
  const mail = email(suffix);
  const pass = password(suffix);

  await auth.createUser({
    uid: id,
    email: mail,
    password: pass,
    emailVerified: true
  });

  users.push(id);

  await setDoc(
    `usuarios/${id}`,
    {
      email: mail,
      tipo_usuario: tipo,
      status_conta: "ativo",
      ...extra
    }
  );

  await setDoc(
    `alunos/${id}`,
    {
      usuario_id: id,
      status_vinculo: "ativo"
    }
  );

  return {
    uid: id,
    email: mail,
    password: pass
  };
}

async function signIn(actor) {
  const response =
    await fetch(
      `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json"
        },
        body: JSON.stringify({
          email: actor.email,
          password:
            actor.password,
          returnSecureToken: true
        })
      }
    );

  const body =
    await response.json();

  assert.ok(body.idToken);

  return body.idToken;
}

async function call(token, organizacaoId) {
  const headers = {
    "content-type":
      "application/json"
  };

  if (token) {
    headers.authorization =
      `Bearer ${token}`;
  }

  const response =
    await fetch(
      callableUrl,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          data: {
            organizacaoId
          }
        })
      }
    );

  let body = {};

  try {
    body =
      await response.json();
  } catch (_) {}

  return {
    status: response.status,
    body
  };
}

function payload(body) {
  return Object.prototype
    .hasOwnProperty.call(
      body,
      "result"
    )
      ? body.result
      : body.data;
}

async function cleanup() {
  await Promise.allSettled(
    [...docs].map(
      path =>
        db.doc(path).delete()
    )
  );

  await Promise.allSettled(
    users.map(
      id =>
        auth.deleteUser(id)
    )
  );

  await deleteApp(app);
}

async function main() {
  // ============================================================
  // ANÔNIMO
  // ============================================================

  await test(
    "Chamada anonima continua rejeitada",
    async () => {
      const response =
        await call(
          null,
          "qualquer"
        );

      assert.equal(
        response.status,
        401
      );
    }
  );

  // ============================================================
  // PROFESSOR NÃO USA FLUXO DE ALUNO
  // ============================================================

  await test(
    "Professor nao pode solicitar vinculo pelo fluxo de aluno",
    async () => {
      const actor =
        await createUser(
          "professor",
          "professor"
        );

      const token =
        await signIn(actor);

      const org =
        `org_prof_${runId}`;

      await setDoc(
        `organizacoes/${org}`,
        {
          nome: "Academia",
          status: "ativa"
        }
      );

      const response =
        await call(
          token,
          org
        );

      assert.equal(
        response.body?.error?.status,
        "PERMISSION_DENIED"
      );
    }
  );

  // ============================================================
  // NOVA SOLICITAÇÃO
  // ============================================================

  const actor =
    await createUser(
      "student"
    );

  const token =
    await signIn(actor);

  const org =
    `org_target_${runId}`;

  await setDoc(
    `organizacoes/${org}`,
    {
      nome: "Academia Target",
      status: "ativa"
    }
  );

  const membershipPath =
    `vinculos_organizacao/${org}__${actor.uid}`;

  track(membershipPath);

  let createdAt = null;
  let updatedAt = null;

  await test(
    "Nova solicitacao cria student pendente",
    async () => {
      const response =
        await call(
          token,
          org
        );

      assert.equal(
        response.status,
        200
      );

      assert.deepEqual(
        payload(response.body),
        {
          ok: true,
          status: "pendente",
          organizacaoId: org,
          organizacaoNome:
            "Academia Target"
        }
      );

      const snap =
        await db.doc(
          membershipPath
        ).get();

      assert.equal(
        snap.data().papel,
        "aluno"
      );

      assert.equal(
        snap.data().status,
        "pendente"
      );

      assert.equal(
        snap.data()
          .pode_aplicar_exames,
        false
      );

      createdAt =
        snap.data()
          .criado_em
          .toMillis();

      updatedAt =
        snap.data()
          .atualizado_em
          .toMillis();

      const user =
        await db.doc(
          `usuarios/${actor.uid}`
        ).get();

      assert.equal(
        user.data()
          .academia_pendente_id,
        org
      );
    }
  );

  // ============================================================
  // RETRY IDEMPOTENTE
  // ============================================================

  await test(
    "Retry da mesma solicitacao permanece idempotente",
    async () => {
      const response =
        await call(
          token,
          org
        );

      assert.equal(
        response.status,
        200
      );

      assert.equal(
        payload(response.body)
          .alreadyPending,
        true
      );

      const snap =
        await db.doc(
          membershipPath
        ).get();

      assert.equal(
        snap.data()
          .criado_em
          .toMillis(),
        createdAt
      );

      assert.equal(
        snap.data()
          .atualizado_em
          .toMillis(),
        updatedAt
      );
    }
  );

  // ============================================================
  // OUTRA SOLICITAÇÃO PENDENTE É BLOQUEADA
  // ============================================================

  await test(
    "Segunda academia fica bloqueada enquanto existe pendencia",
    async () => {
      const other =
        `org_other_${runId}`;

      await setDoc(
        `organizacoes/${other}`,
        {
          nome: "Outra Academia",
          status: "ativa"
        }
      );

      track(
        `vinculos_organizacao/${other}__${actor.uid}`
      );

      const response =
        await call(
          token,
          other
        );

      assert.equal(
        response.body?.error?.status,
        "FAILED_PRECONDITION"
      );

      const snap =
        await db.doc(
          `vinculos_organizacao/${other}__${actor.uid}`
        ).get();

      assert.equal(
        snap.exists,
        false
      );
    }
  );

  // ============================================================
  // ACTIVE EM OUTRA ACADEMIA É BLOQUEADO
  // ============================================================

  await test(
    "Aluno ja ativo em outra academia nao cria nova solicitacao",
    async () => {
      const activeActor =
        await createUser(
          "active_elsewhere"
        );

      const activeToken =
        await signIn(
          activeActor
        );

      const activeOrg =
        `org_active_${runId}`;

      const requestedOrg =
        `org_request_${runId}`;

      await setDoc(
        `organizacoes/${activeOrg}`,
        {
          nome: "Atual",
          status: "ativa"
        }
      );

      await setDoc(
        `organizacoes/${requestedOrg}`,
        {
          nome: "Nova",
          status: "ativa"
        }
      );

      await setDoc(
        `vinculos_organizacao/${activeOrg}__${activeActor.uid}`,
        {
          usuario_id:
            activeActor.uid,
          organizacao_id:
            activeOrg,
          papel: "student",
          status: "active",
          principal: true
        }
      );

      track(
        `vinculos_organizacao/${requestedOrg}__${activeActor.uid}`
      );

      const response =
        await call(
          activeToken,
          requestedOrg
        );

      assert.equal(
        response.body?.error?.status,
        "FAILED_PRECONDITION"
      );
    }
  );

  // ============================================================
  // REJEITADO NÃO É RESSUSCITADO
  // ============================================================

  await test(
    "Vinculo rejeitado nao volta automaticamente para pendente",
    async () => {
      const rejectedActor =
        await createUser(
          "rejected"
        );

      const rejectedToken =
        await signIn(
          rejectedActor
        );

      const rejectedOrg =
        `org_rejected_${runId}`;

      await setDoc(
        `organizacoes/${rejectedOrg}`,
        {
          nome: "Academia",
          status: "ativa"
        }
      );

      const path =
        `vinculos_organizacao/${rejectedOrg}__${rejectedActor.uid}`;

      await setDoc(
        path,
        {
          usuario_id:
            rejectedActor.uid,
          organizacao_id:
            rejectedOrg,
          papel: "aluno",
          status: "rejeitado",
          principal: true
        }
      );

      const response =
        await call(
          rejectedToken,
          rejectedOrg
        );

      assert.equal(
        response.body?.error?.status,
        "FAILED_PRECONDITION"
      );

      const snap =
        await db.doc(path).get();

      assert.equal(
        snap.data().status,
        "rejeitado"
      );
    }
  );

  // ============================================================
  // PAPEL INCOMPATÍVEL NÃO É SOBRESCRITO
  // ============================================================

  await test(
    "Vinculo institucional de outro papel nao e sobrescrito",
    async () => {
      const roleActor =
        await createUser(
          "wrong_role"
        );

      const roleToken =
        await signIn(
          roleActor
        );

      const roleOrg =
        `org_role_${runId}`;

      await setDoc(
        `organizacoes/${roleOrg}`,
        {
          nome: "Academia",
          status: "ativa"
        }
      );

      const path =
        `vinculos_organizacao/${roleOrg}__${roleActor.uid}`;

      await setDoc(
        path,
        {
          usuario_id:
            roleActor.uid,
          organizacao_id:
            roleOrg,
          papel: "professor",
          status: "ativo",
          principal: true
        }
      );

      const response =
        await call(
          roleToken,
          roleOrg
        );

      assert.equal(
        response.body?.error?.status,
        "FAILED_PRECONDITION"
      );

      const snap =
        await db.doc(path).get();

      assert.equal(
        snap.data().papel,
        "professor"
      );
    }
  );

  // ============================================================
  // ORGANIZAÇÃO ARQUIVADA
  // ============================================================

  await test(
    "Academia arquivada nao aceita solicitacao",
    async () => {
      const archivedActor =
        await createUser(
          "archived"
        );

      const archivedToken =
        await signIn(
          archivedActor
        );

      const archivedOrg =
        `org_archived_${runId}`;

      await setDoc(
        `organizacoes/${archivedOrg}`,
        {
          nome:
            "Academia Arquivada",
          status: "archived"
        }
      );

      track(
        `vinculos_organizacao/${archivedOrg}__${archivedActor.uid}`
      );

      const response =
        await call(
          archivedToken,
          archivedOrg
        );

      assert.equal(
        response.body?.error?.status,
        "FAILED_PRECONDITION"
      );
    }
  );

  // ============================================================
  // EQUIPE LEGADA É PROJETADA
  // ============================================================

  await test(
    "Equipe legada e projetada antes da solicitacao",
    async () => {
      const legacyActor =
        await createUser(
          "legacy"
        );

      const legacyToken =
        await signIn(
          legacyActor
        );

      const legacyOrg =
        `org_legacy_${runId}`;

      await setDoc(
        `equipes/${legacyOrg}`,
        {
          nome_equipe:
            "Equipe Legada",
          status: "ativa"
        }
      );

      track(
        `organizacoes/${legacyOrg}`
      );

      track(
        `vinculos_organizacao/${legacyOrg}__${legacyActor.uid}`
      );

      const response =
        await call(
          legacyToken,
          legacyOrg
        );

      assert.equal(
        response.status,
        200
      );

      const canonical =
        await db.doc(
          `organizacoes/${legacyOrg}`
        ).get();

      assert.equal(
        canonical.exists,
        true
      );

      assert.equal(
        canonical.data()
          .migrado_de_equipes,
        true
      );

      const membership =
        await db.doc(
          `vinculos_organizacao/${legacyOrg}__${legacyActor.uid}`
        ).get();

      assert.equal(
        membership.data().status,
        "pendente"
      );
    }
  );

  // ============================================================
  // CONCORRENCIA: DUAS ACADEMIAS AO MESMO TEMPO
  // ============================================================

  await test(
    "Solicitacoes concorrentes preservam apenas um vinculo pendente",
    async () => {
      const raceActor =
        await createUser(
          "race_concurrent"
        );

      const raceToken =
        await signIn(
          raceActor
        );

      const orgA =
        `org_race_a_${runId}`;

      const orgB =
        `org_race_b_${runId}`;

      await setDoc(
        `organizacoes/${orgA}`,
        {
          nome:
            "Academia Race A",
          status:
            "ativa"
        }
      );

      await setDoc(
        `organizacoes/${orgB}`,
        {
          nome:
            "Academia Race B",
          status:
            "ativa"
        }
      );

      track(
        `vinculos_organizacao/${orgA}__${raceActor.uid}`
      );

      track(
        `vinculos_organizacao/${orgB}__${raceActor.uid}`
      );

      const [
        responseA,
        responseB
      ] =
        await Promise.all([
          call(
            raceToken,
            orgA
          ),
          call(
            raceToken,
            orgB
          )
        ]);

      const responses =
        [responseA, responseB];

      const successes =
        responses.filter(
          response =>
            response.status === 200 &&
            payload(response.body)
              ?.status === "pendente"
        );

      const rejected =
        responses.filter(
          response =>
            response.body
              ?.error
              ?.status ===
            "FAILED_PRECONDITION"
        );

      assert.equal(
        successes.length,
        1
      );

      assert.equal(
        rejected.length,
        1
      );

      const memberships =
        await db
          .collection(
            "vinculos_organizacao"
          )
          .where(
            "usuario_id",
            "==",
            raceActor.uid
          )
          .get();

      const pending =
        memberships.docs
          .map(
            doc => doc.data()
          )
          .filter(
            item =>
              ["aluno", "student"]
                .includes(item.papel || item.role) &&
              ["pendente", "pending"]
                .includes(item.status)
          );

      assert.equal(
        pending.length,
        1
      );

      const winner =
        pending[0]
          .organizacao_id;

      const user =
        await db.doc(
          `usuarios/${raceActor.uid}`
        ).get();

      const legacy =
        await db.doc(
          `alunos/${raceActor.uid}`
        ).get();

      assert.equal(
        user.data()
          .academia_pendente_id,
        winner
      );

      assert.equal(
        legacy.data()
          .equipe_id,
        winner
      );

      assert.equal(
        legacy.data()
          .status_vinculo,
        "pendente"
      );
    }
  );

  console.log("");
  console.log(
    `RESULTADO_SOLICITAR_VINCULO_EMULATOR=${passed}/11`
  );
}

main()
  .then(cleanup)
  .catch(async error => {
    console.error(error);

    try {
      await cleanup();
    } catch (_) {}

    process.exit(1);
  });