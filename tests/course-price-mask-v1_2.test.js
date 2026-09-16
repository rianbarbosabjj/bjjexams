"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mask = require("../js/course-price-mask-v1_2.js");

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

test("mascara aceita ponto como separador decimal", () => {
  assert.equal(mask.normalizeDraft("149.40"), "149,40");
});

test("mascara remove simbolo e separador de milhar", () => {
  assert.equal(mask.normalizeDraft("R$ 1.299,90"), "1299,90");
});

test("mascara limita centavos a duas casas", () => {
  assert.equal(mask.normalizeDraft("149,409"), "149,40");
});

test("formatacao brasileira completa centavos", () => {
  assert.equal(mask.formatValue("149,4"), "149,40");
  assert.equal(mask.formatValue("1299,9"), "1.299,90");
});

test("conversao mascarada preserva centavos", () => {
  assert.equal(mask.toCents("149,40"), 14940);
  assert.equal(mask.toCents("1.299,90"), 129990);
});

const panel = read("painel_professor.html");

test("painel carrega mascara monetaria v1.2", () => {
  assert.match(panel, /js\/course-price-mask-v1_2\.js/);
});

console.log(`COURSE_PRICE_MASK_V1_2=${passed}/${passed}`);
