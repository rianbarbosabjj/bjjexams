"use strict";

const assert =
  require("node:assert/strict");

const {
  initializeApp,
  deleteApp
} =
  require(
    "firebase-admin/app"
  );

const {
  getFirestore
} =
  require(
    "firebase-admin/firestore"
  );

const {
  getAuth
} =
  require(
    "firebase-admin/auth"
  );

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
  process.env
    .FIRESTORE_EMULATOR_HOST
);

assertLocal(
  "FIREBASE_AUTH_EMULATOR_HOST",
  process.env
    .FIREBASE_AUTH_EMULATOR_HOST
);

const projectId =
  "demo-bjj-exams";

const functionBase =
  `http://127.0.0.1:5001/${projectId}/southamerica-east1`;

const authBase =
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const firestoreBase =
  `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents`;

const app =
  initializeApp(
    {
      projectId
    },
    `courses-${process.pid}-${Date.now()}`
  );

const db =
  getFirestore(app);

const auth =
  getAuth(app);

const runId =
  `${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;

const authUsers =
  new Set();

const profileDocs =
  new Set();

const courseIds =
  new Set();

let passed =
  0;

function id(label) {
  return `course_${runId}_${label}`;
}

function email(label) {
  return `${id(label)}@example.test`;
}

function password(label) {
  return `Course-${runId}-${label}!Aa1`;
}

async function createUser(
  label,
  tipo,
  claims = {}
) {
  const uid =
    id(label);

  const mail =
    email(label);

  const pass =
    password(label);

  await auth.createUser({
    uid,
    email:
      mail,
    password:
      pass,
    emailVerified:
      true
  });

  authUsers.add(uid);

  if (
    Object.keys(claims)
      .length
  ) {
    await auth
      .setCustomUserClaims(
        uid,
        claims
      );
  }

  await db
    .doc(
      `usuarios/${uid}`
    )
    .set({
      nome:
        label.toUpperCase(),

      email:
        mail,

      tipo_usuario:
        tipo,

      status_conta:
        "ativo"
    });

  profileDocs.add(
    `usuarios/${uid}`
  );

  if (
    tipo ===
    "professor"
  ) {
    await db
      .doc(
        `professores/${uid}`
      )
      .set({
        usuario_id:
          uid,
        status_vinculo:
          "ativo",
        eh_responsavel:
          false,
        pode_aprovar:
          false
      });

    profileDocs.add(
      `professores/${uid}`
    );
  }

  return {
    uid,
    email:
      mail,
    password:
      pass
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
  }
  catch (_) {}

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
  const audits =
    await db
      .collection(
        "audit_logs"
      )
      .get();

  const deletePaths =
    [];

  for (
    const doc
    of audits.docs
  ) {
    const entityId =
      doc.data()?.entityId;

    if (
      courseIds.has(
        entityId
      )
    ) {
      deletePaths.push(
        doc.ref.path
      );
    }
  }

  for (
    const courseId
    of courseIds
  ) {
    deletePaths.push(
      `courses/${courseId}`
    );
  }

  deletePaths.push(
    ...profileDocs
  );

  for (
    let offset = 0;
    offset < deletePaths.length;
    offset += 400
  ) {
    const batch =
      db.batch();

    for (
      const path
      of deletePaths.slice(
        offset,
        offset + 400
      )
    ) {
      batch.delete(
        db.doc(path)
      );
    }

    await batch.commit();
  }

  await Promise.allSettled(
    [...authUsers]
      .map(
        uid =>
          auth.deleteUser(uid)
      )
  );

  await deleteApp(app);
}

async function main() {
  try {
    const admin =
      await createUser(
        "admin",
        "admin",
        {
          platform_admin:
            true
        }
      );

    const content =
      await createUser(
        "content",
        "admin",
        {
          content_admin:
            true
        }
      );

    const instructor =
      await createUser(
        "instructor",
        "professor"
      );

    const student =
      await createUser(
        "student",
        "aluno"
      );

    const adminToken =
      await signIn(
        admin
      );

    const contentToken =
      await signIn(
        content
      );

    const instructorToken =
      await signIn(
        instructor
      );

    const studentToken =
      await signIn(
        student
      );

    await test(
      "Anonimo nao cria curso",
      async () => {
        const response =
          await call(
            "criarCursoV12",
            null,
            {
              title:
                "Curso anonimo"
            }
          );

        assert.equal(
          response.status,
          401
        );
      }
    );

    await test(
      "Aluno nao cria curso proprio",
      async () => {
        const response =
          await call(
            "criarCursoV12",
            studentToken,
            {
              title:
                "Curso de aluno",

              ownerType:
                "user"
            }
          );

        assert.equal(
          response.status,
          403
        );
      }
    );

    let instructorCourseId;

    await test(
      "Instrutor cria curso proprio draft sem academia",
      async () => {
        const response =
          await call(
            "criarCursoV12",
            instructorToken,
            {
              title:
                "Fundamentos do Jiu-Jitsu",

              description:
                "Curso completo de fundamentos tecnicos para praticantes de Jiu-Jitsu.",

              ownerType:
                "user",

              visibility:
                "platform",

              isPaid:
                false,

              priceCents:
                0
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result =
          payload(
            response
          );

        instructorCourseId =
          result.course.id;

        courseIds.add(
          instructorCourseId
        );

        const snap =
          await db
            .doc(
              `courses/${instructorCourseId}`
            )
            .get();

        assert.equal(
          snap.exists,
          true
        );

        assert.equal(
          snap.data()
            .ownerType,
          "user"
        );

        assert.equal(
          snap.data()
            .ownerId,
          instructor.uid
        );

        assert.equal(
          snap.data()
            .status,
          "draft"
        );

        assert.ok(
          snap.data()
            .instructorIds
            .includes(
              instructor.uid
            )
        );
      }
    );

    await test(
      "Instrutor nao cria curso da plataforma",
      async () => {
        const response =
          await call(
            "criarCursoV12",
            instructorToken,
            {
              title:
                "Curso indevido",

              ownerType:
                "platform"
            }
          );

        assert.equal(
          response.status,
          403
        );
      }
    );

    let platformCourseId;

    await test(
      "Platform admin cria curso pago da plataforma em draft",
      async () => {
        const response =
          await call(
            "criarCursoV12",
            adminToken,
            {
              title:
                "Curso Oficial BJJ Exams",

              description:
                "Curso oficial da plataforma para demonstracao do catalogo BJJ Exams.",

              ownerType:
                "platform",

              instructorIds: [
                instructor.uid
              ],

              visibility:
                "platform",

              isPaid:
                true,

              priceCents:
                19900,

              currency:
                "BRL"
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result =
          payload(
            response
          );

        platformCourseId =
          result.course.id;

        courseIds.add(
          platformCourseId
        );

        const snap =
          await db
            .doc(
              `courses/${platformCourseId}`
            )
            .get();

        assert.equal(
          snap.data()
            .ownerType,
          "platform"
        );

        assert.equal(
          snap.data()
            .priceCents,
          19900
        );

        assert.equal(
          snap.data()
            .status,
          "draft"
        );
      }
    );

    await test(
      "Instrutor edita o proprio draft",
      async () => {
        const response =
          await call(
            "atualizarCursoV12",
            instructorToken,
            {
              courseId:
                instructorCourseId,

              title:
                "Fundamentos Essenciais do Jiu-Jitsu",

              description:
                "Curso completo com os fundamentos essenciais para evolucao tecnica no Jiu-Jitsu."
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const snap =
          await db
            .doc(
              `courses/${instructorCourseId}`
            )
            .get();

        assert.equal(
          snap.data()
            .title,
          "Fundamentos Essenciais do Jiu-Jitsu"
        );
      }
    );

    await test(
      "Instrutor envia curso completo para review",
      async () => {
        const response =
          await call(
            "alterarStatusCursoV12",
            instructorToken,
            {
              courseId:
                instructorCourseId,

              status:
                "review"
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const snap =
          await db
            .doc(
              `courses/${instructorCourseId}`
            )
            .get();

        assert.equal(
          snap.data()
            .status,
          "review"
        );
      }
    );

    await test(
      "Instrutor nao publica o proprio curso",
      async () => {
        const response =
          await call(
            "alterarStatusCursoV12",
            instructorToken,
            {
              courseId:
                instructorCourseId,

              status:
                "published"
            }
          );

        assert.equal(
          response.status,
          403
        );
      }
    );

    await test(
      "Content admin publica curso em review",
      async () => {
        const response =
          await call(
            "alterarStatusCursoV12",
            contentToken,
            {
              courseId:
                instructorCourseId,

              status:
                "published"
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const snap =
          await db
            .doc(
              `courses/${instructorCourseId}`
            )
            .get();

        assert.equal(
          snap.data()
            .status,
          "published"
        );

        assert.ok(
          snap.data()
            .publishedAt
        );
      }
    );

    await test(
      "Instrutor nao edita curso publicado",
      async () => {
        const response =
          await call(
            "atualizarCursoV12",
            instructorToken,
            {
              courseId:
                instructorCourseId,

              title:
                "Tentativa indevida"
            }
          );

        assert.equal(
          response.status,
          400,
          response.text
        );

        assert.equal(
          response.body?.error?.status,
          "FAILED_PRECONDITION",
          response.text
        );
      }
    );

    await test(
      "Instrutor lista apenas cursos proprios",
      async () => {
        const response =
          await call(
            "listarCursosAdministraveisV12",
            instructorToken,
            {}
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result =
          payload(
            response
          );

        assert.ok(
          result.courses.some(
            course =>
              course.id ===
              instructorCourseId
          )
        );

        assert.equal(
          result.courses.some(
            course =>
              course.id ===
              platformCourseId
          ),
          false
        );
      }
    );

    await test(
      "Platform admin lista cursos da plataforma e de instrutores",
      async () => {
        const response =
          await call(
            "listarCursosAdministraveisV12",
            adminToken,
            {}
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result =
          payload(
            response
          );

        assert.ok(
          result.courses.some(
            course =>
              course.id ===
              instructorCourseId
          )
        );

        assert.ok(
          result.courses.some(
            course =>
              course.id ===
              platformCourseId
          )
        );
      }
    );

    await test(
      "Rules bloqueiam escrita direta em courses",
      async () => {
        const documentId =
          id(
            "direct_write"
          );

        const response =
          await fetch(
            `${firestoreBase}/courses?documentId=${encodeURIComponent(documentId)}`,
            {
              method:
                "POST",

              headers: {
                "content-type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  fields: {
                    title: {
                      stringValue:
                        "Bypass"
                    }
                  }
                })
            }
          );

        assert.ok(
          [
            401,
            403
          ].includes(
            response.status
          ),
          `status=${response.status}`
        );
      }
    );

    console.log("");
    console.log(
      `RESULTADO_COURSES_V1_2_EMULATOR=${passed}/13`
    );

    console.log(
      "INSTRUCTOR_WITHOUT_ACADEMY_CAN_CREATE=True"
    );

    console.log(
      "DIRECT_COURSE_WRITE_BLOCKED=True"
    );

    console.log(
      "PUBLICATION_REQUIRES_MODERATOR=True"
    );

    console.log(
      "PRODUCTION_ACCESS=0"
    );
  }
  finally {
    await cleanup();
  }
}

main()
  .then(() => {
    if (
      passed !== 13
    ) {
      process.exit(1);
    }
  })
  .catch(error => {
    console.error(
      error.stack ||
      error.message ||
      error
    );

    process.exit(1);
  });