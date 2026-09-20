'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rulesPath = path.resolve(__dirname, '..', 'firestore.rules');
const rules = fs.readFileSync(rulesPath, 'utf8');
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

function hasExplicitAllowForCollection(collectionName) {
  const escaped = collectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(
    `match\\s+/${escaped}\\/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`,
    'm'
  ).exec(rules);
  if (!block) return false;
  return /allow\s+(read|write|read,\s*write|write,\s*read)\s*:\s*if\s+(?!false\b)/.test(block[1]);
}

test('catch-all final permanece deny-all', () => {
  assert.match(
    rules,
    /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/m
  );
});

test('exam_sessions nao possui allow direto no browser', () => {
  assert.equal(hasExplicitAllowForCollection('exam_sessions'), false);
});

test('exam_registrations nao possui allow direto no browser', () => {
  assert.equal(hasExplicitAllowForCollection('exam_registrations'), false);
});

console.log(`EXAM_FIRESTORE_RULES_V1_2=${passed}/3`);
if (passed !== 3) process.exitCode = 1;
