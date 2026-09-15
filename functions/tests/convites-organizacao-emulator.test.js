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

function assertLocal(
  name,
  value
) {
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
    `org-invites-${process.pid}-${Date.now()}`
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

let passed =
  0;

function id(label) {
  return `invite_${runId}_${label}`;
}

function email(label) {
  return `${id(label)}@example.test`;
}

function password(label) {
  return `Invite-${runId}-${label}!Aa1`;
}

function track(path) {
  docs.add(path);
}

async function setDoc(
  path,
  data
) {
  await db.doc(path)
    .set(data);

  track(path);
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

      email:
        mail,

      tipo_usuario:
        tipo,

      status_conta:
        "ativo"
    }
  );

  if (
    tipo ===
    "aluno"
  ) {
    await setDoc(
      `alunos/${uid}`,
      {
        usuario_id:
          uid,

        status_vinculo:
          "ativo"
      }
    );
  }

  if (
    tipo ===
    "professor"
  ) {
    await setDoc(
      `professores/${uid}`,
      {
        usuario_id:
          uid,

        status_vinculo:
          "ativo",

        eh_responsavel:
          false,

        pode_aprovar:
          false
      }
    );
  }

  return {
    uid,
    email: mail,
    password: pass
  };
}

async function signIn(
  actor
) {
  const response =
    await fetch(
      `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      {
        method:
          "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify({
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
      `${functionBase}/${functionName}`,
      {
        method:
          "POST",

        headers,

        body:
          JSON.stringify({
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

function payload(
  response
) {
  return (
    response.body?.result ??
    response.body?.data ??
    null
  );
}

async function test(
  name,
  fn
) {
  await fn();

  passed++;

  console.log(
    `PASS | ${name}`
  );
}

async function cleanup() {
  await Promise.allSettled(
    [...docs].map(
      path =>
        db.doc(path)
          .delete()
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
  const org =
    id("org_target");

  const otherOrg =
    id("org_other");

  await setDoc(
    `organizacoes/${org}`,
    {
      nome:
        "Academia Convites",
      status:
        "ativa"
    }
  );

  await setDoc(
    `organizacoes/${otherOrg}`,
    {
      nome:
        "Outra Academia",
      status:
        "ativa"
    }
  );

  const manager =
    await createUser(
      "manager",
      "professor"
    );

  const managerToken =
    await signIn(
      manager
    );

  await setDoc(
    `vinculos_organizacao/${org}__${manager.uid}`,
    {
      usuario_id:
        manager.uid,

      organizacao_id:
        org,

      papel:
        "gestor",

      status:
        "ativo",

      principal:
        true,

      pode_aplicar_exames:
        true
    }
  );

  const instructor =
    await createUser(
      "instructor_manager_denied",
      "professor"
    );

  const instructorToken =
    await signIn(
      instructor
    );

  await setDoc(
    `vinculos_organizacao/${org}__${instructor.uid}`,
    {
      usuario_id:
        instructor.uid,

      organizacao_id:
        org,

      papel:
        "professor",

      status:
        "ativo",

      principal:
        false,

      pode_aplicar_exames:
        true
    }
  );

  const student =
    await createUser(
      "student",
      "aluno"
    );

  const studentToken =
    await signIn(
      student
    );

  const studentMembership =
    `vinculos_organizacao/${org}__${student.uid}`;

  track(
    studentMembership
  );

  await test(
    "Convite anonimo e rejeitado",
    async () => {
      const response =
        await call(
          "convidarUsuarioOrganizacao",
          null,
          {
            organizacaoId:
              org,
            email:
              student.email,
            tipo:
              "aluno"
          }
        );

      assert.equal(
        response.status,
        401
      );

      assert.equal(
        response.body
          ?.error
          ?.status,
        "UNAUTHENTICATED"
      );
    }
  );

  await test(
    "Listagem de convites anonima e rejeitada",
    async () => {
      const response =
        await call(
          "listarMeusConvitesOrganizacao",
          null
        );

      assert.equal(
        response.status,
        401
      );

      assert.equal(
        response.body
          ?.error
          ?.status,
        "UNAUTHENTICATED"
      );
    }
  );

  await test(
    "Resposta de convite anonima e rejeitada",
    async () => {
      const response =
        await call(
          "responderConviteOrganizacao",
          null,
          {
            organizacaoId:
              org,
            status:
              "active"
          }
        );

      assert.equal(
        response.status,
        401
      );

      assert.equal(
        response.body
          ?.error
          ?.status,
        "UNAUTHENTICATED"
      );
    }
  );

  await test(
    "Instrutor autorizado para exames nao pode convidar",
    async () => {
      const response =
        await call(
          "convidarUsuarioOrganizacao",
          instructorToken,
          {
            organizacaoId:
              org,
            email:
              student.email,
            tipo:
              "aluno"
          }
        );

      assert.equal(
        response.body
          ?.error
          ?.status,
        "PERMISSION_DENIED"
      );
    }
  );

  await test(
    "Gestor cria convite pendente sem ativar projecao legada",
    async () => {
      const response =
        await call(
          "convidarUsuarioOrganizacao",
          managerToken,
          {
            organizacaoId:
              org,
            email:
              student.email,
            tipo:
              "aluno"
          }
        );

      assert.equal(
        response.status,
        200,
        response.text
      );

      assert.equal(
        payload(response)
          ?.status,
        "pending"
      );

      const membership =
        await db.doc(
          studentMembership
        ).get();

      assert.equal(
        membership.data()
          .status,
        "pendente"
      );

      assert.equal(
        membership.data()
          .papel,
        "aluno"
      );

      assert.equal(
        membership.data()
          .origem_vinculo,
        "convite"
      );

      assert.equal(
        membership.data()
          .principal,
        false
      );

      const legacy =
        await db.doc(
          `alunos/${student.uid}`
        ).get();

      assert.equal(
        legacy.data()
          .equipe_id,
        undefined
      );
    }
  );

  await test(
    "Usuario visualiza convite pendente",
    async () => {
      const response =
        await call(
          "listarMeusConvitesOrganizacao",
          studentToken
        );

      assert.equal(
        response.status,
        200,
        response.text
      );

      const convites =
        payload(response)
          ?.convites;

      assert.equal(
        convites.length,
        1
      );

      assert.equal(
        convites[0]
          .organizacaoId,
        org
      );

      assert.equal(
        convites[0]
          .role,
        "student"
      );

      assert.equal(
        convites[0]
          .status,
        "pending"
      );
    }
  );

  await test(
    "Retry do convite permanece idempotente",
    async () => {
      const response =
        await call(
          "convidarUsuarioOrganizacao",
          managerToken,
          {
            organizacaoId:
              org,
            email:
              student.email,
            tipo:
              "aluno"
          }
        );

      assert.equal(
        response.status,
        200,
        response.text
      );

      assert.equal(
        payload(response)
          ?.alreadyPending,
        true
      );
    }
  );

  await test(
    "Aluno aceita convite e vinculo se torna ativo",
    async () => {
      const response =
        await call(
          "responderConviteOrganizacao",
          studentToken,
          {
            organizacaoId:
              org,
            status:
              "active"
          }
        );

      assert.equal(
        response.status,
        200,
        response.text
      );

      assert.equal(
        payload(response)
          ?.status,
        "active"
      );

      const membership =
        await db.doc(
          studentMembership
        ).get();

      assert.equal(
        membership.data()
          .status,
        "ativo"
      );

      assert.equal(
        membership.data()
          .principal,
        true
      );

      const legacy =
        await db.doc(
          `alunos/${student.uid}`
        ).get();

      assert.equal(
        legacy.data()
          .equipe_id,
        org
      );

      assert.equal(
        legacy.data()
          .status_vinculo,
        "ativo"
      );

      const user =
        await db.doc(
          `usuarios/${student.uid}`
        ).get();

      assert.equal(
        user.data()
          .academia_principal_id,
        org
      );
    }
  );

  await test(
    "Convite aceito desaparece da lista de pendentes",
    async () => {
      const response =
        await call(
          "listarMeusConvitesOrganizacao",
          studentToken
        );

      assert.deepEqual(
        payload(response)
          ?.convites,
        []
      );
    }
  );

  await test(
    "Retry da aceitacao permanece idempotente",
    async () => {
      const response =
        await call(
          "responderConviteOrganizacao",
          studentToken,
          {
            organizacaoId:
              org,
            status:
              "ativo"
          }
        );

      assert.equal(
        response.status,
        200,
        response.text
      );

      assert.equal(
        payload(response)
          ?.alreadyResolved,
        true
      );
    }
  );

  const rejectedStudent =
    await createUser(
      "student_reject",
      "aluno"
    );

  const rejectedToken =
    await signIn(
      rejectedStudent
    );

  const rejectedMembership =
    `vinculos_organizacao/${org}__${rejectedStudent.uid}`;

  track(
    rejectedMembership
  );

  await call(
    "convidarUsuarioOrganizacao",
    managerToken,
    {
      organizacaoId:
        org,
      email:
        rejectedStudent.email,
      tipo:
        "aluno"
    }
  );

  await test(
    "Aluno pode rejeitar convite sem ganhar associacao legada",
    async () => {
      const response =
        await call(
          "responderConviteOrganizacao",
          rejectedToken,
          {
            organizacaoId:
              org,
            status:
              "rejected"
          }
        );

      assert.equal(
        response.status,
        200,
        response.text
      );

      assert.equal(
        payload(response)
          ?.status,
        "rejected"
      );

      const membership =
        await db.doc(
          rejectedMembership
        ).get();

      assert.equal(
        membership.data()
          .status,
        "rejeitado"
      );

      const legacy =
        await db.doc(
          `alunos/${rejectedStudent.uid}`
        ).get();

      assert.equal(
        legacy.data()
          .equipe_id,
        undefined
      );
    }
  );

  const requestStudent =
    await createUser(
      "self_request",
      "aluno"
    );

  const requestToken =
    await signIn(
      requestStudent
    );

  const requestMembership =
    `vinculos_organizacao/${org}__${requestStudent.uid}`;

  await setDoc(
    requestMembership,
    {
      usuario_id:
        requestStudent.uid,

      organizacao_id:
        org,

      papel:
        "aluno",

      status:
        "pendente",

      principal:
        true,

      origem_vinculo:
        "solicitacao"
    }
  );

  await test(
    "Solicitacao do aluno nao pode ser respondida pelo fluxo de convite",
    async () => {
      const response =
        await call(
          "responderConviteOrganizacao",
          requestToken,
          {
            organizacaoId:
              org,
            status:
              "active"
          }
        );

      assert.equal(
        response.body
          ?.error
          ?.status,
        "FAILED_PRECONDITION"
      );

      const membership =
        await db.doc(
          requestMembership
        ).get();

      assert.equal(
        membership.data()
          .status,
        "pendente"
      );
    }
  );

  const activeElsewhere =
    await createUser(
      "active_elsewhere",
      "aluno"
    );

  await setDoc(
    `vinculos_organizacao/${otherOrg}__${activeElsewhere.uid}`,
    {
      usuario_id:
        activeElsewhere.uid,

      organizacao_id:
        otherOrg,

      papel:
        "aluno",

      status:
        "ativo",

      principal:
        true
    }
  );

  await test(
    "Aluno ativo em outra academia nao pode receber novo convite",
    async () => {
      const response =
        await call(
          "convidarUsuarioOrganizacao",
          managerToken,
          {
            organizacaoId:
              org,
            email:
              activeElsewhere.email,
            tipo:
              "aluno"
          }
        );

      assert.equal(
        response.body
          ?.error
          ?.status,
        "FAILED_PRECONDITION"
      );
    }
  );

  const raceStudent =
    await createUser(
      "invite_request_race",
      "aluno"
    );

  const raceStudentToken =
    await signIn(
      raceStudent
    );

  const raceInvitePath =
    `vinculos_organizacao/${org}__${raceStudent.uid}`;

  const raceRequestPath =
    `vinculos_organizacao/${otherOrg}__${raceStudent.uid}`;

  track(
    raceInvitePath
  );

  track(
    raceRequestPath
  );

  await test(
    "Convite e solicitacao concorrentes preservam apenas um vinculo pendente",
    async () => {
      const [
        inviteResponse,
        requestResponse
      ] =
        await Promise.all([
          call(
            "convidarUsuarioOrganizacao",
            managerToken,
            {
              organizacaoId:
                org,

              email:
                raceStudent.email,

              tipo:
                "aluno"
            }
          ),

          call(
            "solicitarVinculoOrganizacao",
            raceStudentToken,
            {
              organizacaoId:
                otherOrg
            }
          )
        ]);

      const responses =
        [
          inviteResponse,
          requestResponse
        ];

      const successes =
        responses.filter(
          response => {
            const status =
              payload(response)
                ?.status;

            return (
              response.status === 200 &&
              (
                status ===
                  "pending" ||
                status ===
                  "pendente"
              )
            );
          }
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

      const snap =
        await db
          .collection(
            "vinculos_organizacao"
          )
          .where(
            "usuario_id",
            "==",
            raceStudent.uid
          )
          .get();

      const pending =
        snap.docs
          .map(
            doc => ({
              id:
                doc.id,
              ...doc.data()
            })
          )
          .filter(
            membership => {
              const role =
                membership.role ||
                membership.papel;

              const status =
                membership.status;

              return (
                [
                  "student",
                  "aluno"
                ].includes(role) &&
                [
                  "pending",
                  "pendente"
                ].includes(status)
              );
            }
          );

      assert.equal(
        pending.length,
        1
      );
    }
  );

  const professorTarget =
    await createUser(
      "professor_target",
      "professor"
    );

  const professorToken =
    await signIn(
      professorTarget
    );

  const professorMembership =
    `vinculos_organizacao/${org}__${professorTarget.uid}`;

  track(
    professorMembership
  );

  await test(
    "Perfil professor nao pode ser convidado como aluno",
    async () => {
      const response =
        await call(
          "convidarUsuarioOrganizacao",
          managerToken,
          {
            organizacaoId:
              org,
            email:
              professorTarget.email,
            tipo:
              "aluno"
          }
        );

      assert.equal(
        response.body
          ?.error
          ?.status,
        "FAILED_PRECONDITION"
      );
    }
  );

  await test(
    "Professor pode ser convidado como instructor",
    async () => {
      const response =
        await call(
          "convidarUsuarioOrganizacao",
          managerToken,
          {
            organizacaoId:
              org,
            email:
              professorTarget.email,
            tipo:
              "professor"
          }
        );

      assert.equal(
        response.status,
        200,
        response.text
      );

      const membership =
        await db.doc(
          professorMembership
        ).get();

      assert.equal(
        membership.data()
          .papel,
        "professor"
      );

      assert.equal(
        membership.data()
          .status,
        "pendente"
      );

      assert.equal(
        membership.data()
          .pode_aplicar_exames,
        false
      );
    }
  );

  await test(
    "Professor aceita convite sem receber permissao de gestor ou exame",
    async () => {
      const response =
        await call(
          "responderConviteOrganizacao",
          professorToken,
          {
            organizacaoId:
              org,
            status:
              "active"
          }
        );

      assert.equal(
        response.status,
        200,
        response.text
      );

      const membership =
        await db.doc(
          professorMembership
        ).get();

      assert.equal(
        membership.data()
          .status,
        "ativo"
      );

      assert.equal(
        membership.data()
          .pode_aplicar_exames,
        false
      );

      const legacy =
        await db.doc(
          `professores/${professorTarget.uid}`
        ).get();

      assert.equal(
        legacy.data()
          .equipe_id,
        org
      );

      assert.equal(
        legacy.data()
          .eh_responsavel,
        false
      );

      assert.equal(
        legacy.data()
          .pode_aprovar,
        false
      );
    }
  );

  await test(
    "Gestor nao pode convidar a si mesmo",
    async () => {
      const response =
        await call(
          "convidarUsuarioOrganizacao",
          managerToken,
          {
            organizacaoId:
              org,
            email:
              manager.email,
            tipo:
              "professor"
          }
        );

      assert.equal(
        response.body
          ?.error
          ?.status,
        "FAILED_PRECONDITION"
      );
    }
  );

  assert.equal(
    passed,
    18,
    "Quantidade de testes de convite inesperada."
  );

  console.log("");
  console.log(
    `RESULTADO_CONVITES_ORGANIZACAO_EMULATOR=${passed}/18`
  );
}

main()
  .then(cleanup)
  .catch(
    async error => {
      console.error(
        error
      );

      try {
        await cleanup();
      } catch (_) {}

      process.exit(1);
    }
  );