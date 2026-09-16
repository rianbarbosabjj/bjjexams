"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const moderation = require("../js/course-moderation-ui-v1_2.js");
const courseApi = require("../js/course-admin-api-v1_2.js");

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const uiSource = read("js/course-moderation-ui-v1_2.js");
const patchSource = read("scripts/apply-marco4a4c-admin-ui.ps1");
const panel = read("painel_admin.html");

const actions = status => moderation.moderatorActions({ status });

test("review permite devolver publicar arquivar e detalhar", () => {
  assert.deepEqual(actions("review"), ["draft", "publish", "archive", "details"]);
});

test("curso publicado permite suspender e abrir catalogo", () => {
  assert.deepEqual(actions("published"), ["suspend", "archive", "view-public", "details"]);
});

test("curso suspenso pode ser republicado", () => {
  assert.deepEqual(actions("suspended"), ["publish", "archive", "details"]);
});

test("curso arquivado fica somente leitura", () => {
  assert.deepEqual(actions("archived"), ["details"]);
});

test("moderacao usa somente cliente administrativo canonico", () => {
  assert.equal(uiSource.includes("getFirestore"), false);
  assert.equal(uiSource.includes("collection("), false);
  assert.equal(uiSource.includes("cursos_teoricos"), false);
  assert.match(uiSource, /courseApi\.listCourses/);
  assert.match(uiSource, /courseApi\.changeStatus/);
});

test("moderacao valida claim global no cliente antes da callable", () => {
  assert.match(uiSource, /claims\.super_admin === true/);
  assert.match(uiSource, /claims\.platform_admin === true/);
  assert.match(uiSource, /claims\.content_admin === true/);
  assert.match(uiSource, /MODERATOR_ROLE_REQUIRED/);
});

test("moderacao bloqueia divergencia de projeto Auth", () => {
  assert.match(uiSource, /ENVIRONMENT_MISMATCH/);
  assert.match(uiSource, /auth\.app\?\.options\?\.projectId/);
});

test("cliente administrativo resolve localhost para staging", () => {
  assert.equal(courseApi.inferEnvironment({ hostname: "localhost" }), "staging");
  assert.match(
    courseApi.functionUrl("listarCursosAdministraveisV12", { explicitEnvironment: "staging" }),
    /bjj-exams-staging/
  );
});

test("patch e restrito a branch 4A.4c", () => {
  assert.match(patchSource, /feature\/marco4a4c-moderation-ui/);
});

test("painel administrativo usa runtime Firebase fail-safe", () => {
  assert.match(panel, /js\/firebase-runtime-v1_2\.js/);
  assert.match(panel, /await window\.BjjExamsFirebaseRuntime\.loadConfig/);
  assert.equal(panel.includes("const firebaseConfig = {"), false);
});

test("painel conecta bridge Auth e cliente administrativo", () => {
  assert.match(panel, /window\.__BJJ_EXAMS_AUTH__ = auth/);
  assert.match(panel, /js\/course-admin-api-v1_2\.js/);
});

test("painel possui aba e controller de moderacao", () => {
  assert.match(panel, /id="course-moderation-list-v12"/);
  assert.match(panel, /js\/course-moderation-ui-v1_2\.js/);
  assert.match(panel, /BjjExamsCourseModerationUi\.loadCourses/);
});

test("painel nao carrega cursos automaticamente fora da aba", () => {
  const carregarTudoMatch = panel.match(/async function carregarTudo\(\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(carregarTudoMatch);
  assert.equal(carregarTudoMatch[1].includes("carregarCursosModeracaoV12"), false);
  assert.equal(carregarTudoMatch[1].includes("BjjExamsCourseModerationUi"), false);
});

console.log(`COURSE_MODERATION_UI_V1_2=${passed}/${passed}`);
