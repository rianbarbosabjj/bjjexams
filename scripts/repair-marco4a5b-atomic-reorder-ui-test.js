"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const expectedBranch = "feature/marco4a5b-course-content-ui";

function fail(message) {
  throw new Error(message);
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function write(relative, value) {
  fs.writeFileSync(path.join(root, relative), value, { encoding: "utf8" });
}

function replaceRequired(source, oldValue, newValue, label) {
  if (!source.includes(oldValue)) {
    if (source.includes(newValue)) return { source, changed: false };
    fail(`${label}: expected text not found`);
  }
  return {
    source: source.replace(oldValue, newValue),
    changed: true
  };
}

const branch = execFileSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], {
  encoding: "utf8"
}).trim();
if (branch !== expectedBranch) {
  fail(`Execution blocked on branch '${branch}'. Expected '${expectedBranch}'.`);
}

const oldAssertions = `  assert.equal(/reorderModule[\\s\\S]*api\\.updateModule/.test(ui), false);\n  assert.equal(/reorderLesson[\\s\\S]*api\\.updateLesson/.test(ui), false);`;
const newAssertions = `  assert.equal(\n    ui.includes("await api.updateModule(currentCourse.id, current.id, { position: otherPosition }, options);"),\n    false\n  );\n  assert.equal(\n    ui.includes("await api.updateLesson(currentCourse.id, current.id, { ...current, position: otherPosition }, options);"),\n    false\n  );`;

for (const file of [
  "tests/course-content-ui-v1_2.test.js",
  "scripts/apply-marco4a5b-atomic-reorder.js"
]) {
  const current = read(file);
  const result = replaceRequired(current, oldAssertions, newAssertions, file);
  if (result.changed) {
    write(file, result.source);
    console.log(`${file}=REPAIRED`);
  } else {
    console.log(`${file}=ALREADY_REPAIRED`);
  }
}

execFileSync("git", ["-C", root, "diff", "--check"], { stdio: "inherit" });
console.log("ATOMIC_REORDER_UI_TEST_REPAIR=OK");
