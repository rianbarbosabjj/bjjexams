"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const api = require("../js/course-public-api-v1_2.js");

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function read(relativePath) {
  return fs.readFileSync(
    path.join(__dirname, "..", relativePath),
    "utf8"
  );
}

test("localhost usa staging por padrao", () => {
  assert.equal(api.inferEnvironment({ hostname: "localhost" }), "staging");
});

test("host oficial de staging usa staging", () => {
  assert.equal(
    api.inferEnvironment({ hostname: "bjj-exams-staging.web.app" }),
    "staging"
  );
});

test("host oficial de producao usa producao", () => {
  assert.equal(
    api.inferEnvironment({ hostname: "bjj-exams.web.app" }),
    "production"
  );
});

test("host desconhecido falha para staging", () => {
  assert.equal(
    api.inferEnvironment({ hostname: "preview.example.invalid" }),
    "staging"
  );
});

test("endpoint publico de staging e resolvido corretamente", () => {
  assert.equal(
    api.functionUrl("listarCatalogoCursosV12", {
      explicitEnvironment: "staging"
    }),
    "https://southamerica-east1-bjj-exams-staging.cloudfunctions.net/listarCatalogoCursosV12"
  );
});

test("endpoint fora do contrato e bloqueado", () => {
  assert.throws(
    () => api.functionUrl("criarCursoV12", { explicitEnvironment: "staging" }),
    /fora do contrato/
  );
});

test("preco gratuito e formatado", () => {
  assert.equal(api.formatPrice({ isPaid: false, priceCents: 0 }), "GRÁTIS");
});

test("preco pago preserva centavos", () => {
  const formatted = api.formatPrice({
    isPaid: true,
    priceCents: 12900,
    currency: "BRL"
  });
  assert.match(formatted, /129,00/);
});

const catalogHtml = read("catalogo.html");
const courseHtml = read("cursos.html");
const combinedHtml = `${catalogHtml}\n${courseHtml}`;

test("UI publica nao referencia collection legada", () => {
  assert.equal(combinedHtml.includes("cursos_teoricos"), false);
});

test("UI publica nao importa Firestore direto", () => {
  assert.equal(combinedHtml.includes("firebase-firestore"), false);
  assert.equal(combinedHtml.includes("getFirestore"), false);
});

test("UI publica nao contem API key Firebase hardcoded", () => {
  assert.equal(/AIza[0-9A-Za-z_-]{20,}/.test(combinedHtml), false);
});

test("catalogo usa cliente publico canonico", () => {
  assert.match(catalogHtml, /course-public-api-v1_2\.js/);
  assert.match(catalogHtml, /listCourses/);
});

test("detalhe usa cliente publico canonico", () => {
  assert.match(courseHtml, /course-public-api-v1_2\.js/);
  assert.match(courseHtml, /getCourse/);
});

test("detalhe nao promete conteudo publico inexistente", () => {
  assert.equal(courseHtml.includes("conteudo-programatico"), false);
  assert.equal(courseHtml.includes("professor-info"), false);
});

console.log(`COURSE_PUBLIC_UI_V1_2=${passed}/${passed}`);
