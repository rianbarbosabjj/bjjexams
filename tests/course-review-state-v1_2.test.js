"use strict";

const assert = require("node:assert/strict");
const api = require("../js/course-admin-api-v1_2.js");

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

test("review permite apenas arquivar para instrutor", () => {
  assert.deepEqual(
    api.instructorActions({ status: "review" }),
    ["archive"]
  );
});

test("review nao permite editar", () => {
  assert.equal(
    api.instructorActions({ status: "review" }).includes("edit"),
    false
  );
});

test("review nao permite publicar", () => {
  assert.equal(
    api.instructorActions({ status: "review" }).includes("publish"),
    false
  );
});

console.log(`COURSE_REVIEW_STATE_V1_2=${passed}/${passed}`);
