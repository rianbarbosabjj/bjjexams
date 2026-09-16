"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const hybridApi = require("../js/course-hybrid-moderation-api-v1_2.js");

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const uiSource = read("js/course-exception-review-ui-v1_2.js");
const patchSource = read("scripts/apply-marco4a4c-admin-ui.ps1");
const panel = read("painel_admin.html");

test("revisao administrativa lista somente excecoes canonicas", () => {
  assert.match(uiSource, /hybridApi\.listExceptions/);
  assert.equal(uiSource.includes("courseApi.listCourses"), false);
});

test("review permite aprovar publicar solicitar ajustes e arquivar", () => {
  assert.match(uiSource, /Aprovar e publicar/);
  assert.match(uiSource, /Solicitar ajustes/);
  assert.match(uiSource, /changeStatus\(course, "published"\)/);
  assert.match(uiSource, /changeStatus\(course, "draft"\)/);
});

test("suspenso permite republicar ou arquivar", () => {
  assert.match(uiSource, /Republicar/);
  assert.match(uiSource, /course\.status === "suspended"/);
});

test("tela exibe contexto da decisao automatizada", () => {
  assert.match(uiSource, /moderation\.riskLevel/);
  assert.match(uiSource, /moderation\.confidence/);
  assert.match(uiSource, /moderation\.reasonCodes/);
  assert.match(uiSource, /moderation\.summary/);
});

test("revisao usa clientes canonicos sem Firestore direto", () => {
  assert.equal(uiSource.includes("getFirestore"), false);
  assert.equal(uiSource.includes("collection("), false);
  assert.equal(uiSource.includes("cursos_teoricos"), false);
  assert.match(uiSource, /courseApi\.changeStatus/);
});

test("revisao valida claim global antes das callables", () => {
  assert.match(uiSource, /claims\.super_admin === true/);
  assert.match(uiSource, /claims\.platform_admin === true/);
  assert.match(uiSource, /claims\.content_admin === true/);
  assert.match(uiSource, /MODERATOR_ROLE_REQUIRED/);
});

test("revisao bloqueia divergencia de projeto Auth", () => {
  assert.match(uiSource, /ENVIRONMENT_MISMATCH/);
  assert.match(uiSource, /auth\.app\?\.options\?\.projectId/);
});

test("cliente hibrido resolve localhost para staging", () => {
  assert.equal(hybridApi.inferEnvironment({ hostname: "localhost" }), "staging");
  assert.match(
    hybridApi.functionUrl("listarExcecoesModeracaoV12", { hostname: "localhost" }),
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

test("painel carrega API hibrida e controller de excecoes", () => {
  assert.match(panel, /js\/course-hybrid-moderation-api-v1_2\.js/);
  assert.match(panel, /js\/course-exception-review-ui-v1_2\.js/);
  assert.equal(panel.includes("js/course-moderation-ui-v1_2.js"), false);
  assert.match(panel, /BjjExamsCourseModerationUi\.loadCourses/);
});

test("painel apresenta revisao de conteudo e nao moderacao manual geral", () => {
  assert.match(panel, /Revis&#227;o de Conte&#250;do/);
  assert.match(panel, /Todas as exce&#231;&#245;es/);
  assert.match(panel, /Bloqueados/);
});

test("painel nao carrega excecoes automaticamente fora da aba", () => {
  const carregarTudoMatch = panel.match(/async function carregarTudo\(\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(carregarTudoMatch);
  assert.equal(carregarTudoMatch[1].includes("BjjExamsCourseModerationUi"), false);
});

console.log(`COURSE_MODERATION_UI_V1_2=${passed}/${passed}`);
