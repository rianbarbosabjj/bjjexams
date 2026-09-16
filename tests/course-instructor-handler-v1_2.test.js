"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const panelPath = path.join(__dirname, "..", "painel_professor.html");
const panel = fs.readFileSync(panelPath, "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

test("botao Novo Curso chama controller canonico v1.2", () => {
  assert.match(
    panel,
    /onclick="window\.BjjExamsInstructorCourseUi\.openCreateCourse\(\)"/
  );
});

test("botao Novo Curso nao usa handler legado", () => {
  assert.equal(panel.includes('onclick="abrirModalCriarCurso()"'), false);
});

test("menu lateral usa rotulo Meus Cursos", () => {
  assert.match(panel, /> Meus Cursos<\/button>/);
});

test("controller v1.2 continua carregado no painel", () => {
  assert.match(panel, /js\/course-instructor-ui-v1_2\.js/);
});

console.log(`COURSE_INSTRUCTOR_HANDLER_V1_2=${passed}/${passed}`);
