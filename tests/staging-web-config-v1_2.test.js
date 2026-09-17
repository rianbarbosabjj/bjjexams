'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const scriptPath = path.join(__dirname, '..', 'scripts', 'prepare-staging-firebase-web-config.ps1');
const source = fs.readFileSync(scriptPath, 'utf8');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('config web permanece restrita ao projeto de staging', () => {
  assert.ok(source.includes('$ExpectedProject = "bjj-exams-staging"'));
  assert.ok(source.includes('if ($ProjectId -ne $ExpectedProject)'));
  assert.ok(source.includes('PRODUCTION_ACCESS=NOT_RUN'));
});

test('branch do Marco 4B.4 está autorizada explicitamente', () => {
  assert.ok(source.includes('"feature/marco4b4-student-course-ui"'));
});

test('arquivo local precisa permanecer ignorado pelo Git', () => {
  assert.ok(source.includes('git -C $RepoRoot check-ignore -q "js/firebase-config.local.json"'));
  assert.ok(source.includes('LOCAL_CONFIG_GIT_IGNORED=True'));
});

test('toolchain de staging permanece pinada', () => {
  assert.ok(source.includes('--package=node@22.23.2'));
  assert.ok(source.includes('--package=firebase-tools@15.28.1'));
});

test('app web de staging é validado antes de gravar configuração', () => {
  assert.ok(source.includes('$WebAppId = "1:206338587822:web:d870ac4cf23b6a1b6f813f"'));
  assert.ok(source.includes('if ($config.appId -ne $WebAppId)'));
  assert.ok(source.includes('WEB_APP_ID_MATCH=True'));
});

let passed = 0;
for (const item of cases) {
  try {
    item.fn();
    passed += 1;
    console.log(`PASS | ${item.name}`);
  } catch (error) {
    console.error(`FAIL | ${item.name}`);
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}

console.log(`STAGING_WEB_CONFIG_V1_2=${passed}/${cases.length}`);
if (passed !== cases.length) process.exitCode = 1;
