"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "../js/course-admin-api-v1_2.js"),
  "utf8"
);

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}

test("lazy loader so ativa em pagina com aba financeiro", () => {
  assert.match(source, /getElementById\("financeiro"\)/);
});

test("lazy loader usa currentScript para resolver assets", () => {
  assert.match(source, /document\.currentScript/);
  assert.match(source, /new URL\("\."\s*,\s*currentSrc\)/);
});

test("loader inclui exatamente os modulos financeiros esperados", () => {
  for (const filename of [
    "course-purchase-api-v1_2.js",
    "financial-ops-ui-v1_2.js",
    "financial-ops-admin-bootstrap-v1_2.js",
    "admin-financial-ops-entry-v1_2.js"
  ]) {
    assert.ok(source.includes(`\"${filename}\"`), `${filename} ausente`);
  }
});

test("instalacao aguarda load do painel administrativo", () => {
  assert.match(source, /addEventListener\("load"\s*,\s*install/);
});

test("loader nao referencia Firestore financeiro direto", () => {
  for (const forbidden of [
    "payment_transactions",
    "payment_webhook_events",
    "financial_reversal_requests",
    "financial_chargeback_recovery"
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("course admin api permanece carregavel em Node sem DOM", () => {
  const api = require("../js/course-admin-api-v1_2.js");
  assert.equal(typeof api.listCourses, "function");
  assert.equal(typeof api.createCourse, "function");
  assert.equal(typeof api.changeStatus, "function");
});

console.log(`ADMIN_FINANCIAL_OPS_LOADER_V1_2=${passed}/6`);
if (passed !== 6) process.exitCode = 1;
