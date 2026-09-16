"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const api = read("js/course-content-api-v1_2.js");
const ui = read("js/course-content-ui-v1_2.js");
const admin = read("js/course-admin-api-v1_2.js");
const instructor = read("js/course-instructor-ui-v1_2.js");
const panel = read("painel_professor.html");
const patch = read("scripts/apply-marco4a5b-course-content-ui.ps1");

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test("cliente de conteudo nao acessa Firestore diretamente", () => {
  assert.equal(/firebase-firestore|getFirestore|collection\(|doc\(/.test(api), false);
});

test("studio nao acessa Firestore diretamente", () => {
  assert.equal(/firebase-firestore|getFirestore|collection\(|updateDoc\(|setDoc\(|addDoc\(/.test(ui), false);
});

test("studio exige auth no mesmo projeto", () => {
  assert.match(ui, /assertSafeAuthProject/);
  assert.match(ui, /actual !== expected/);
  assert.match(ui, /ENVIRONMENT_MISMATCH/);
});

test("studio suporta criar editar e excluir modulo", () => {
  assert.match(ui, /createModule/);
  assert.match(ui, /editModule/);
  assert.match(ui, /deleteModule/);
});

test("studio suporta criar editar e excluir aula", () => {
  assert.match(ui, /createLesson/);
  assert.match(ui, /editLesson/);
  assert.match(ui, /deleteLesson/);
});

test("studio suporta mover aula entre modulos", () => {
  assert.match(ui, /content-lesson-module/);
  assert.match(ui, /moduleId/);
});

test("studio suporta reordenacao por setas", () => {
  assert.match(ui, /reorderModule/);
  assert.match(ui, /reorderLesson/);
  assert.match(ui, /arrow-up/);
  assert.match(ui, /arrow-down/);
});

test("studio cobre video texto e documento", () => {
  assert.match(ui, /value="video"/);
  assert.match(ui, /value="text"/);
  assert.match(ui, /value="document"/);
});

test("studio exibe contadores canonicos", () => {
  assert.match(ui, /moduleCount/);
  assert.match(ui, /lessonCount/);
  assert.match(ui, /estimatedDurationMinutes/);
  assert.match(ui, /contentRevision/);
});

test("patch adiciona acao Conteudo apenas a rascunhos", () => {
  assert.match(admin, /return \["edit", "content", "review", "archive"\];/);
  assert.match(instructor, /action === "content"/);
  assert.match(instructor, /actionButton\("Conte\\u00fado", "list-dashes"/);
  assert.equal(instructor.includes("ConteÃºdo"), false);
  assert.equal(instructor.includes("EstÃºdio"), false);
  assert.equal(
    instructor.includes(');      } else if (action === "review")'),
    false
  );
});

test("painel carrega cliente e studio antes do controller do instrutor", () => {
  const apiIndex = panel.indexOf("js/course-content-api-v1_2.js");
  const uiIndex = panel.indexOf("js/course-content-ui-v1_2.js");
  const instructorIndex = panel.indexOf("js/course-instructor-ui-v1_2.js");
  assert.ok(apiIndex >= 0);
  assert.ok(uiIndex > apiIndex);
  assert.ok(instructorIndex > uiIndex);
});

test("patch e restrito a branch 4A5b", () => {
  assert.match(patch, /feature\/marco4a5b-course-content-ui/);
  assert.match(patch, /Execução bloqueada/);
});

test("patch preserva UTF-8 sem BOM", () => {
  assert.match(patch, /UTF8Encoding\(\$false\)/);
  assert.match(patch, /ASCII-only/);
});

test("patch executa git diff check", () => {
  assert.match(patch, /diff --check/);
  assert.match(patch, /MARCO4A5B_COURSE_CONTENT_UI_PATCH=OK/);
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

console.log(`COURSE_CONTENT_UI_V1_2=${passed}/${cases.length}`);
