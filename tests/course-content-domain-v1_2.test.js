"use strict";

const assert = require("node:assert/strict");
const {
  COURSE_CONTENT_TYPES,
  CourseContentDomainError,
  validateModule,
  validateLesson,
  nextContentRevision,
  courseContentCounters
} = require("../functions/src/courses/course-content-domain");

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

function expectDomainError(fn, code) {
  assert.throws(fn, error => {
    assert.ok(error instanceof CourseContentDomainError);
    assert.equal(error.code, code);
    return true;
  });
}

test("tipos canonicos de aula sao restritos", () => {
  assert.deepEqual(COURSE_CONTENT_TYPES, ["video", "text", "document"]);
});

test("modulo valido normaliza campos", () => {
  const result = validateModule({
    title: "  Fundamentos de Guarda  ",
    description: "  Conceitos basicos  ",
    position: 2
  });
  assert.equal(result.title, "Fundamentos de Guarda");
  assert.equal(result.description, "Conceitos basicos");
  assert.equal(result.position, 2);
  assert.equal(result.lessonCount, 0);
});

test("modulo exige titulo minimo", () => {
  expectDomainError(() => validateModule({ title: "A" }), "INVALID_MODULE_TITLE");
});

test("posicao invalida falha", () => {
  expectDomainError(
    () => validateModule({ title: "Modulo valido", position: -1 }),
    "INVALID_POSITION"
  );
});

test("aula de video exige HTTPS", () => {
  expectDomainError(
    () => validateLesson({
      moduleId: "m1",
      title: "Aula de guarda",
      contentType: "video",
      videoUrl: "http://example.com/aula.mp4"
    }),
    "INVALID_URL"
  );
});

test("aula de video valida remove campos de outros tipos", () => {
  const result = validateLesson({
    moduleId: "m1",
    title: "Passagem de guarda",
    description: "Aula demonstrativa",
    contentType: "video",
    durationMinutes: 12,
    isPreview: true,
    videoUrl: "https://example.com/aula.mp4",
    body: "nao deve persistir",
    documentUrl: "https://example.com/material.pdf"
  });
  assert.equal(result.contentType, "video");
  assert.equal(result.durationMinutes, 12);
  assert.equal(result.isPreview, true);
  assert.match(result.videoUrl, /^https:\/\//);
  assert.equal(result.body, null);
  assert.equal(result.documentUrl, null);
});

test("aula textual exige corpo", () => {
  expectDomainError(
    () => validateLesson({
      moduleId: "m1",
      title: "Conceitos de base",
      contentType: "text"
    }),
    "LESSON_BODY_REQUIRED"
  );
});

test("aula documento exige documentUrl", () => {
  expectDomainError(
    () => validateLesson({
      moduleId: "m1",
      title: "Material complementar",
      contentType: "document"
    }),
    "DOCUMENT_URL_REQUIRED"
  );
});

test("duracao possui limite operacional", () => {
  expectDomainError(
    () => validateLesson({
      moduleId: "m1",
      title: "Video extenso",
      contentType: "video",
      durationMinutes: 2000,
      videoUrl: "https://example.com/video"
    }),
    "INVALID_DURATION"
  );
});

test("contentRevision avanca monotonamente", () => {
  assert.equal(nextContentRevision({}), 1);
  assert.equal(nextContentRevision({ contentRevision: 7 }), 8);
  assert.equal(nextContentRevision({ contentRevision: -2 }), 1);
});

test("contadores antigos ausentes sao tratados como zero", () => {
  assert.deepEqual(courseContentCounters({}), {
    contentRevision: 0,
    moduleCount: 0,
    lessonCount: 0,
    estimatedDurationMinutes: 0
  });
});

let passed = 0;
for (const item of cases) {
  try {
    item.fn();
    passed += 1;
    console.log(`PASS | ${item.name}`);
  } catch (error) {
    console.error(`FAIL | ${item.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log(`COURSE_CONTENT_DOMAIN_V1_2=${passed}/${cases.length}`);
