"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const prepare = read("functions/scripts/prepare-course-moderation-ui-staging-fixture.js");
const cleanup = read("functions/scripts/cleanup-course-moderation-ui-staging-fixture.js");
const gitignore = read(".gitignore");
const configScript = read("scripts/prepare-staging-firebase-web-config.ps1");

test("fixture e cleanup sao fixados em staging", () => {
  assert.match(prepare, /TARGET_PROJECT = 'bjj-exams-staging'/);
  assert.match(cleanup, /TARGET_PROJECT = 'bjj-exams-staging'/);
  assert.match(prepare, /PRODUCTION_PROJECT = 'bjj-exams'/);
  assert.match(cleanup, /PRODUCTION_PROJECT = 'bjj-exams'/);
});

test("fixture exige confirmacao explicita de escrita em staging", () => {
  assert.match(prepare, /I_UNDERSTAND_STAGING_WRITES/);
  assert.match(cleanup, /I_UNDERSTAND_STAGING_WRITES/);
});

test("moderador temporario recebe claim platform_admin", () => {
  assert.match(prepare, /platform_admin: true/);
  assert.match(prepare, /TEMP_MODERATOR_PLATFORM_ADMIN_CLAIM=True/);
});

test("fixture cria estados necessarios para o workflow visual", () => {
  assert.match(prepare, /DEVOLVER PARA RASCUNHO/);
  assert.match(prepare, /MODERAÇÃO UI - PUBLICAR/);
  assert.match(prepare, /MODERAÇÃO UI - SUSPENDER/);
  assert.match(prepare, /MODERAÇÃO UI - REPUBLICAR/);
});

test("credencial temporaria nao e impressa", () => {
  assert.match(prepare, /PASSWORD_PRINTED=False/);
  assert.equal(prepare.includes("console.log(password"), false);
});

test("cleanup valida propriedade por smokeRunId antes de apagar curso", () => {
  assert.match(cleanup, /data\.smokeRunId !== fixture\.runId/);
  assert.match(cleanup, /cleanup bloqueado/i);
});

test("arquivo local da fixture de moderacao fica ignorado pelo Git", () => {
  assert.match(gitignore, /functions\/\.course-moderation-ui-staging\.local\.json/);
});

test("gerador de config staging autoriza branch 4A.4c", () => {
  assert.match(configScript, /feature\/marco4a4c-moderation-ui/);
});

console.log(`COURSE_MODERATION_STAGING_FIXTURE_V1_2=${passed}/${passed}`);
