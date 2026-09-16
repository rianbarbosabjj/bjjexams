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
  return fs.readFileSync(
    path.join(__dirname, "..", relativePath),
    "utf8"
  );
}

const loginHtml = read("login.html");
const patchSource = read("scripts/apply-marco4a4b-login-runtime.ps1");

test("login usa runtime Firebase v1.2", () => {
  assert.match(loginHtml, /js\/firebase-runtime-v1_2\.js/);
  assert.match(loginHtml, /await window\.BjjExamsFirebaseRuntime\.loadConfig/);
});

test("login nao inicializa projeto hardcoded", () => {
  assert.equal(loginHtml.includes("const firebaseConfig = {"), false);
});

test("roteamento por papel foi preservado", () => {
  assert.match(loginHtml, /async function rotearUsuario\(user\)/);
  assert.match(loginHtml, /painel_admin\.html/);
  assert.match(loginHtml, /painel_professor\.html/);
  assert.match(loginHtml, /painel_aluno\.html/);
});

test("login continua usando Auth e Firestore da mesma app resolvida", () => {
  assert.match(loginHtml, /const app = initializeApp\(firebaseConfig\)/);
  assert.match(loginHtml, /const auth = getAuth\(app\)/);
  assert.match(loginHtml, /const db = getFirestore\(app\)/);
});

test("patch do login e restrito a branch de trabalho", () => {
  assert.match(patchSource, /feature\/marco4a4-authenticated-ui/);
  assert.match(patchSource, /LOCALHOST_PRODUCTION_CONFIG=AUTO_BLOCKED/);
});

console.log(`LOGIN_RUNTIME_V1_2=${passed}/${passed}`);
