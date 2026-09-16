"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const expectedBranch = "feature/marco4a5b-course-content-ui";
const target = "scripts/apply-marco4a5b-atomic-reorder.js";

function fail(message) {
  throw new Error(message);
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function write(relative, value) {
  fs.writeFileSync(path.join(root, relative), value, { encoding: "utf8" });
}

function replaceLineByPrefix(source, prefix, replacement, alreadyMarker, label) {
  const start = source.indexOf(prefix);
  if (start < 0) {
    if (source.includes(alreadyMarker)) {
      return { source, changed: false };
    }
    fail(`${label}: expected generator assertion not found`);
  }

  const end = source.indexOf("\n", start);
  const tail = end < 0 ? source.length : end;
  return {
    source: source.slice(0, start) + replacement + source.slice(tail),
    changed: true
  };
}

const branch = execFileSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], {
  encoding: "utf8"
}).trim();
if (branch !== expectedBranch) {
  fail(`Execution blocked on branch '${branch}'. Expected '${expectedBranch}'.`);
}

let source = read(target);
let changed = false;

const moduleReplacement = `  assert.equal(\n    ui.includes("await api.updateModule(currentCourse.id, current.id, { position: otherPosition }, options);"),\n    false\n  );`;
let result = replaceLineByPrefix(
  source,
  "  assert.equal(/reorderModule[",
  moduleReplacement,
  'ui.includes("await api.updateModule(currentCourse.id, current.id, { position: otherPosition }, options);")',
  "module generator repair"
);
source = result.source;
changed = changed || result.changed;

const lessonReplacement = `  assert.equal(\n    ui.includes("await api.updateLesson(currentCourse.id, current.id, { ...current, position: otherPosition }, options);"),\n    false\n  );`;
result = replaceLineByPrefix(
  source,
  "  assert.equal(/reorderLesson[",
  lessonReplacement,
  'ui.includes("await api.updateLesson(currentCourse.id, current.id, { ...current, position: otherPosition }, options);")',
  "lesson generator repair"
);
source = result.source;
changed = changed || result.changed;

if (changed) {
  write(target, source);
  console.log("ATOMIC_REORDER_GENERATOR_REPAIR=APPLIED");
} else {
  console.log("ATOMIC_REORDER_GENERATOR_REPAIR=ALREADY_APPLIED");
}

execFileSync("git", ["-C", root, "diff", "--check"], { stdio: "inherit" });
console.log("ATOMIC_REORDER_GENERATOR_REPAIR=OK");
