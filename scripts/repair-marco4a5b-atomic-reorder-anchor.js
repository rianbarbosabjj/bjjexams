"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const expectedBranch = "feature/marco4a5b-course-content-ui";
const target = path.join(root, "scripts", "apply-marco4a5b-atomic-reorder.js");

const branch = execFileSync(
  "git",
  ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"],
  { encoding: "utf8" }
).trim();

if (branch !== expectedBranch) {
  throw new Error(`Execution blocked on branch '${branch}'. Expected '${expectedBranch}'.`);
}

let source = fs.readFileSync(target, "utf8");

const oldBlock = `    source = replaceOnce(
      source,
      '      "listarConteudoCursoV12",\\n',
      '      "listarConteudoCursoV12",\\n      "reordenarConteudoCursoV12",\\n',
      "api allowlist"
    );`;

const newBlock = `    source = replaceOnce(
      source,
      '    const ALLOWED_FUNCTIONS = new Set([\\n      "listarConteudoCursoV12",\\n',
      '    const ALLOWED_FUNCTIONS = new Set([\\n      "listarConteudoCursoV12",\\n      "reordenarConteudoCursoV12",\\n',
      "api allowlist"
    );`;

if (source.includes(newBlock)) {
  console.log("ATOMIC_REORDER_ANCHOR_REPAIR=ALREADY_APPLIED");
  process.exit(0);
}

const first = source.indexOf(oldBlock);
if (first < 0) {
  throw new Error("Atomic reorder patch repair: expected ambiguous API allowlist block not found.");
}
if (source.indexOf(oldBlock, first + oldBlock.length) >= 0) {
  throw new Error("Atomic reorder patch repair: ambiguous patch block is not unique.");
}

source = source.slice(0, first) + newBlock + source.slice(first + oldBlock.length);
fs.writeFileSync(target, source, { encoding: "utf8" });

execFileSync("git", ["-C", root, "diff", "--check"], { stdio: "inherit" });
console.log("ATOMIC_REORDER_ANCHOR_REPAIR=APPLIED");
