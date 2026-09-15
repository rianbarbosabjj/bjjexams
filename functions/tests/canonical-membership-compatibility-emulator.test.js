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
  if (
    !value ||
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/
      .test(value)
  ) {
    throw new Error(
      `${name} nao e local: ${value || "<EMPTY>"}`
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

const functionBase =
  `http://127.0.0.1:5001/${projectId}/southamerica-east1`;

const authBase =
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const app =
  initializeApp(
    { projectId },
    `canonical-membership-${process.pid}-${Date.now()}`
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

const authUsers =
  new Set();

let passed = 0;

function id(label) {
  return `canon_${runId}_${label}`;
}

function email(label) {
  return `${id(label)}@example.test`;
}

function password(label) {
  return `T3st-${label}-${runId}!`;
}

async function setDoc(path, data) {
  await db.doc(path).set(data);
  docs.add(path);
}

function track(path) {
  docs.add(path);
}

async function createUser(
  label,
  tipo
) {
  const uid =
    id(label);

  const mail =
    email(label);

  const pass =
    password(label);

  await auth.createUser({
    uid,
    email: mail,
    password: pass,
    emailVerified: true
  });

  authUsers.add(uid);

  await setDoc(
    `usuarios/${uid}`,
    {
      nome:
        label.toUpperCase(),
      email: mail,
      tipo_usuario: tipo,
      status_conta: "ativo"
    }
  );

  return {
    uid,
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
          email:
            actor.email,
          password:
            actor.password,
          returnSecureToken:
            true
        })
      }
    );

  const body =
    await response.json();

  assert.ok(
    body.idToken,
    JSON.stringify(body)
  );

  return body.idToken;
}

async function call(
  functionName,
  token,
  data = {}
) {
  const response =
    await fetch(
      `${functionBase}/${functionName}`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          authorization:
            `Bearer ${token}`
        },
        body: JSON.stringify({
          data
        })
      }
    );

  const text =
    await response.text();

  let body = {};

  try {
    body =
      JSON.parse(text);
  } catch (_) {}

  return {
    status:
      response.status,
    body,
    text
  };
}

function payload(response) {
  return Object.prototype
    .hasOwnProperty.call(
      response.body,
      "result"
    )
      ? response.body.result
      : response.body.data;
}

async function test(name, fn) {
  await fn();

  passed += 1;

  console.log(
    `PASS | ${name}`
  );
}

async function cleanup() {
  await Promise.allSettled(
    [...docs].map(
      path =>
        db.doc(path).delete()
    )
  );

  await Promise.allSettled(
    [...authUsers].map(
      uid =>
        auth.deleteUser(uid)
    )
  );

  await deleteApp(app);
}

async function main() {
  const orgId =
    id("org");

  await setDoc(
    `organizacoes/${orgId}`,
    {
      nome:
        "ACADEMIA CANONICA",
      status:
        "ativa"
    }
  );

  // ============================================================
  // MANAGER CANONICO
  // ============================================================

  const manager =
    await createUser(
      "manager",
      "professor"
    );

  const managerToken =
    await signIn(manager);

  await setDoc(
    `vinculos_organizacao/${orgId}__${manager.uid}`,
    {
      usuario_id:
        manager.uid,
      organizacao_id:
        orgId,

      // Semantica canonica
      role:
        "manager",
      status:
        "active",

      principal:
        true
    }
  );

  await test(
    "Manager canonico active aparece na listagem e pode aplicar exames",
    async () => {
      const response =
        await call(
          "listarMinhasOrganizacoes",
          managerToken
        );

      assert.equal(
        response.status,
        200,
        response.text
      );

      const items =
        payload(response)
          ?.organizacoes;

      assert.equal(
        items.length,
        1
      );

      assert.equal(
        items[0].papel,
        "manager"
      );

      assert.equal(
        items[0]
          .podeAplicarExames,
        true
      );
    }
  );

  // ============================================================
  // MANAGER CANONICO PODE APROVAR VINCULO
  // ============================================================

  const pendingStudent =
    await createUser(
      "pending_student",
      "aluno"
    );

  await setDoc(
    `alunos/${pendingStudent.uid}`,
    {
      usuario_id:
        pendingStudent.uid,
      status_vinculo:
        "pendente"
    }
  );

  const pendingPath =
    `vinculos_organizacao/${orgId}__${pendingStudent.uid}`;

  await setDoc(
    pendingPath,
    {
      usuario_id:
        pendingStudent.uid,
      organizacao_id:
        orgId,
      papel:
        "aluno",
      status:
        "pendente",
      principal:
        true
    }
  );

  await test(
    "Manager canonico pode aprovar solicitacao pendente",
    async () => {
      const response =
        await call(
          "responderVinculoOrganizacao",
          managerToken,
          {
            usuarioId:
              pendingStudent.uid,
            organizacaoId:
              orgId,
            tipo:
              "aluno",
            status:
              "ativo"
          }
        );

      assert.equal(
        response.status,
        200,
        response.text
      );

      const snap =
        await db.doc(
          pendingPath
        ).get();

      assert.equal(
        snap.data().status,
        "ativo"
      );
    }
  );

  // ============================================================
  // STUDENT CANONICO ACTIVE E RECONHECIDO NO EXAME
  // ============================================================

  const canonicalStudent =
    await createUser(
      "canonical_student",
      "aluno"
    );

  await setDoc(
    `vinculos_organizacao/${orgId}__${canonicalStudent.uid}`,
    {
      usuario_id:
        canonicalStudent.uid,
      organizacao_id:
        orgId,
      role:
        "student",
      status:
        "active",
      principal:
        true
    }
  );

  track(
    `autorizacoes_exame/${canonicalStudent.uid}`
  );

  await test(
    "Manager canonico reconhece aluno student active na mesma academia",
    async () => {
      const response =
        await call(
          "configurarAutorizacaoExame",
          managerToken,
          {
            alunoId:
              canonicalStudent.uid,
            autorizar:
              true,
            faixa:
              "Azul"
          }
        );

      assert.equal(
        response.status,
        200,
        response.text
      );

      assert.equal(
        payload(response)
          ?.organizacaoId,
        orgId
      );

      const authorization =
        await db.doc(
          `autorizacoes_exame/${canonicalStudent.uid}`
        ).get();

      assert.equal(
        authorization.data()
          .status,
        "autorizada"
      );
    }
  );

  // ============================================================
  // INSTRUCTOR CANONICO COM PERMISSAO EXPLICITA
  // ============================================================

  const instructor =
    await createUser(
      "instructor",
      "professor"
    );

  const instructorToken =
    await signIn(
      instructor
    );

  await setDoc(
    `vinculos_organizacao/${orgId}__${instructor.uid}`,
    {
      usuario_id:
        instructor.uid,
      organizacao_id:
        orgId,
      role:
        "instructor",
      status:
        "active",
      canApplyOfficialExam:
        true,
      principal:
        true
    }
  );

  const instructorStudent =
    await createUser(
      "instructor_student",
      "aluno"
    );

  await setDoc(
    `vinculos_organizacao/${orgId}__${instructorStudent.uid}`,
    {
      usuario_id:
        instructorStudent.uid,
      organizacao_id:
        orgId,
      role:
        "student",
      status:
        "active",
      principal:
        true
    }
  );

  track(
    `autorizacoes_exame/${instructorStudent.uid}`
  );

  await test(
    "Instructor canonico autorizado pode configurar exame",
    async () => {
      const response =
        await call(
          "configurarAutorizacaoExame",
          instructorToken,
          {
            alunoId:
              instructorStudent.uid,
            autorizar:
              true,
            faixa:
              "Roxa"
          }
        );

      assert.equal(
        response.status,
        200,
        response.text
      );
    }
  );

  // ============================================================
  // INSTRUCTOR CANONICO SEM PERMISSAO
  // ============================================================

  const deniedInstructor =
    await createUser(
      "denied_instructor",
      "professor"
    );

  const deniedToken =
    await signIn(
      deniedInstructor
    );

  await setDoc(
    `vinculos_organizacao/${orgId}__${deniedInstructor.uid}`,
    {
      usuario_id:
        deniedInstructor.uid,
      organizacao_id:
        orgId,
      role:
        "instructor",
      status:
        "active",
      principal:
        true
    }
  );

  const deniedStudent =
    await createUser(
      "denied_student",
      "aluno"
    );

  await setDoc(
    `vinculos_organizacao/${orgId}__${deniedStudent.uid}`,
    {
      usuario_id:
        deniedStudent.uid,
      organizacao_id:
        orgId,
      role:
        "student",
      status:
        "active",
      principal:
        true
    }
  );

  track(
    `autorizacoes_exame/${deniedStudent.uid}`
  );

  await test(
    "Instructor canonico sem permissao nao pode autorizar exame",
    async () => {
      const response =
        await call(
          "configurarAutorizacaoExame",
          deniedToken,
          {
            alunoId:
              deniedStudent.uid,
            autorizar:
              true,
            faixa:
              "Roxa"
          }
        );

      assert.equal(
        response.body?.error?.status,
        "PERMISSION_DENIED",
        response.text
      );

      const authorization =
        await db.doc(
          `autorizacoes_exame/${deniedStudent.uid}`
        ).get();

      assert.equal(
        authorization.exists,
        false
      );
    }
  );

  console.log("");
  console.log(
    `RESULTADO_CANONICAL_MEMBERSHIP_EMULATOR=${passed}/5`
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