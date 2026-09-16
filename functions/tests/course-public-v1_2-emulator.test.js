"use strict";

const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

function assertLocal(name, value) {
  if (
    !value ||
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)
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

const projectId = "demo-bjj-exams";
const functionBase =
  `http://127.0.0.1:5001/${projectId}/southamerica-east1`;

const app = initializeApp(
  { projectId },
  `course-public-${process.pid}-${Date.now()}`
);

const db = getFirestore(app);
const runId =
  `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const createdPaths = new Set();
let passed = 0;

function courseDocId(label) {
  return `public_course_${runId}_${label}`;
}

async function setDoc(path, data) {
  await db.doc(path).set(data);
  createdPaths.add(path);
}

async function call(functionName, data = {}) {
  const response = await fetch(
    `${functionBase}/${functionName}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ data })
    }
  );

  const text = await response.text();
  let body = {};

  try {
    body = JSON.parse(text);
  } catch (_) {}

  return {
    status: response.status,
    body,
    text
  };
}

function payload(response) {
  return (
    response.body?.result ??
    response.body?.data ??
    null
  );
}

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

async function cleanup() {
  const ordered = [...createdPaths]
    .sort((a, b) => b.split("/").length - a.split("/").length);

  for (let offset = 0; offset < ordered.length; offset += 400) {
    const batch = db.batch();
    for (const path of ordered.slice(offset, offset + 400)) {
      batch.delete(db.doc(path));
    }
    await batch.commit();
  }

  await deleteApp(app);
}

async function main() {
  const now = Date.now();

  const publishedFreeId = courseDocId("published_free");
  const publishedPaidId = courseDocId("published_paid");
  const draftId = courseDocId("draft");
  const privateId = courseDocId("private");
  const organizationId = courseDocId("organization");

  try {
    const base = {
      description:
        "Descricao publica suficientemente completa para o catalogo do BJJ Exams.",
      ownerType: "user",
      ownerId: `owner_${runId}`,
      instructorIds: [`instructor_${runId}`],
      organizationId: null,
      currency: "BRL",
      financialRuleId: `financial_secret_${runId}`,
      createdBy: `creator_${runId}`,
      createdAt: Timestamp.fromMillis(now - 10000),
      updatedAt: Timestamp.fromMillis(now - 5000)
    };

    await setDoc(
      `courses/${publishedFreeId}`,
      {
        ...base,
        title: "Curso Publico Gratuito",
        visibility: "platform",
        status: "published",
        isPaid: false,
        priceCents: 0,
        publishedAt: Timestamp.fromMillis(now - 2000)
      }
    );

    await setDoc(
      `courses/${publishedPaidId}`,
      {
        ...base,
        title: "Curso Publico Pago",
        visibility: "platform",
        status: "published",
        isPaid: true,
        priceCents: 12900,
        publishedAt: Timestamp.fromMillis(now - 1000)
      }
    );

    await setDoc(
      `courses/${draftId}`,
      {
        ...base,
        title: "Curso em Draft",
        visibility: "platform",
        status: "draft",
        isPaid: false,
        priceCents: 0,
        publishedAt: null
      }
    );

    await setDoc(
      `courses/${privateId}`,
      {
        ...base,
        title: "Curso Privado",
        visibility: "private",
        status: "published",
        isPaid: false,
        priceCents: 0,
        publishedAt: Timestamp.fromMillis(now - 500)
      }
    );

    await setDoc(
      `courses/${organizationId}`,
      {
        ...base,
        title: "Curso Organizacional",
        ownerType: "organization",
        ownerId: `org_${runId}`,
        organizationId: `org_${runId}`,
        visibility: "organization",
        status: "published",
        isPaid: false,
        priceCents: 0,
        publishedAt: Timestamp.fromMillis(now - 300)
      }
    );

    await setDoc(
      `courses/${publishedPaidId}/modules/module_secret`,
      {
        title: "Modulo protegido",
        order: 1
      }
    );

    await setDoc(
      `courses/${publishedPaidId}/modules/module_secret/lessons/lesson_secret`,
      {
        title: "Aula protegida",
        videoUrl: "https://example.invalid/secret-video"
      }
    );

    await test(
      "Catalogo anonimo retorna somente published + platform",
      async () => {
        const response = await call(
          "listarCatalogoCursosV12",
          { limit: 20 }
        );

        assert.equal(response.status, 200, response.text);
        const result = payload(response);
        assert.ok(Array.isArray(result.courses));

        const ids = result.courses.map(course => course.id);
        assert.deepEqual(
          ids,
          [publishedPaidId, publishedFreeId]
        );
      }
    );

    await test(
      "Catalogo publico nao expoe campos internos",
      async () => {
        const response = await call(
          "listarCatalogoCursosV12",
          { limit: 20 }
        );
        const result = payload(response);
        const course = result.courses.find(
          item => item.id === publishedPaidId
        );

        assert.ok(course);
        assert.equal(course.ownerId, undefined);
        assert.equal(course.ownerType, undefined);
        assert.equal(course.instructorIds, undefined);
        assert.equal(course.organizationId, undefined);
        assert.equal(course.financialRuleId, undefined);
        assert.equal(course.createdBy, undefined);
        assert.equal(course.status, undefined);
        assert.equal(course.modules, undefined);
        assert.equal(course.videoUrl, undefined);
        assert.equal(course.priceCents, 12900);
      }
    );

    await test(
      "Detalhe publico retorna somente curso publicavel",
      async () => {
        const response = await call(
          "obterCursoPublicoV12",
          { courseId: publishedFreeId }
        );

        assert.equal(response.status, 200, response.text);
        const result = payload(response);
        assert.equal(result.course.id, publishedFreeId);
        assert.equal(result.course.title, "Curso Publico Gratuito");
        assert.equal(result.course.ownerId, undefined);
      }
    );

    await test(
      "Detalhe nao revela curso privado",
      async () => {
        const response = await call(
          "obterCursoPublicoV12",
          { courseId: privateId }
        );

        assert.equal(response.status, 404, response.text);
      }
    );

    await test(
      "Detalhe nao revela draft",
      async () => {
        const response = await call(
          "obterCursoPublicoV12",
          { courseId: draftId }
        );

        assert.equal(response.status, 404, response.text);
      }
    );

    await test(
      "Catalogo rejeita limit fora do contrato",
      async () => {
        const response = await call(
          "listarCatalogoCursosV12",
          { limit: 500 }
        );

        assert.equal(response.status, 400, response.text);
      }
    );

    await test(
      "Detalhe rejeita courseId malformado",
      async () => {
        const response = await call(
          "obterCursoPublicoV12",
          { courseId: "abc/def" }
        );

        assert.equal(response.status, 400, response.text);
      }
    );

    console.log(`COURSE_PUBLIC_V1_2_EMULATOR=${passed}/7`);
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
