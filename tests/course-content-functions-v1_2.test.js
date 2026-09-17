"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

const source = read("functions/src/courses/course-content-functions.js");
const main = read("functions/main.js");

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test("conteudo usa subcolecoes canonicas de courses", () => {
  assert.match(source, /collection\("modules"\)/);
  assert.match(source, /collection\("lessons"\)/);
  assert.equal(source.includes("cursos_teoricos"), false);
});

test("edicao exige curso em draft", () => {
  assert.match(source, /course\.status !== "draft"/);
  assert.match(source, /so pode ser alterado enquanto o curso estiver em rascunho/);
});

test("curso de usuario exige ownership para editar", () => {
  assert.match(source, /course\.ownerType === "user" && course\.ownerId === actor\.uid/);
});

test("curso da plataforma exige moderador", () => {
  assert.match(source, /course\.ownerType === "platform" && actor\.moderatorRole/);
});

test("cada mutacao avanca contentRevision", () => {
  const occurrences = (source.match(/nextContentRevision\(course\)/g) || []).length;
  assert.equal(occurrences, 7);
});

test("modulo nao pode ser excluido contendo aulas", () => {
  assert.match(source, /module\.lessonCount/);
  assert.match(source, /Remova ou mova as aulas deste módulo antes de excluí-lo/);
});

test("movimento de aula atualiza contadores dos dois modulos", () => {
  assert.match(source, /existing\.moduleId !== nextModuleId/);
  assert.match(source, /tx\.update\(oldModuleRef/);
  assert.match(source, /tx\.update\(newModuleRef/);
});

test("reordenacao troca duas posicoes em uma unica transacao", () => {
  assert.match(source, /const reordenarConteudoCursoV12 = onCall/);
  assert.match(source, /tx\.update\(firstRef/);
  assert.match(source, /tx\.update\(secondRef/);
  assert.match(source, /course\.content\.\$\{entityType\}\.reordered/);
  assert.match(source, /first\.moduleId !== second\.moduleId/);
});

test("duracao total e mantida no curso", () => {
  assert.match(source, /estimatedDurationMinutes/);
  assert.match(source, /counters\.estimatedDurationMinutes \+ lesson\.durationMinutes/);
});

test("mutacoes geram audit_logs", () => {
  assert.match(source, /db\.collection\("audit_logs"\)\.doc\(\)/);
  assert.match(source, /course\.content\.module\.created/);
  assert.match(source, /course\.content\.lesson\.updated/);
  assert.match(source, /course\.content\.lesson\.deleted/);
});

test("API exporta leitura e CRUD de modulos e aulas", () => {
  for (const name of [
    "listarConteudoCursoV12",
    "reordenarConteudoCursoV12",
    "criarModuloCursoV12",
    "atualizarModuloCursoV12",
    "excluirModuloCursoV12",
    "criarAulaCursoV12",
    "atualizarAulaCursoV12",
    "excluirAulaCursoV12"
  ]) {
    assert.match(source, new RegExp(name));
  }
});

test("composition root exporta camada de conteudo", () => {
  assert.match(main, /createCourseContentFunctions/);
  assert.match(main, /\.\.\.courseContentFunctions/);
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

console.log(`COURSE_CONTENT_FUNCTIONS_V1_2=${passed}/${cases.length}`);
