'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

const legacyService = fs.readFileSync(
  path.join(
    root,
    'functions/src/finance/financial-purchase-read-service.js'
  ),
  'utf8'
);

const beltService = fs.readFileSync(
  path.join(
    root,
    'functions/src/finance/financial-belt-exam-admin-read-service.js'
  ),
  'utf8'
);

const functionsSource = fs.readFileSync(
  path.join(
    root,
    'functions/src/finance/financial-purchase-read-functions.js'
  ),
  'utf8'
);

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

test('servico legado de cursos permanece course-only', () => {
  assert.equal(
    legacyService.includes(
      ".where('productType', '==', 'course')"
    ),
    true
  );
  assert.equal(
    legacyService.includes('listAdminCoursePurchases'),
    true
  );
});

test('novo servico administrativo le somente belt_exam', () => {
  assert.equal(
    beltService.includes(
      ".where('productType', '==', 'belt_exam')"
    ),
    true
  );
  assert.equal(
    beltService.includes('exam_registrations'),
    true
  );
  assert.equal(
    beltService.includes('examRegistrationDocumentId'),
    true
  );
});

test('callable generica e adicionada sem remover alias legado', () => {
  assert.equal(
    functionsSource.includes(
      'const listarOperacoesFinanceirasV12 = onCall('
    ),
    true
  );
  assert.equal(
    functionsSource.includes(
      'const listarOperacoesFinanceirasCursosV12 = onCall('
    ),
    true
  );
});

test('agregador combina course e belt_exam no backend', () => {
  assert.equal(
    functionsSource.includes(
      'beltExamAdminService.listAdminBeltExamPurchases'
    ),
    true
  );
  assert.equal(
    functionsSource.includes(
      'service.listAdminCoursePurchases'
    ),
    true
  );
  assert.equal(
    functionsSource.includes(
      'mergeAdminOperationItems('
    ),
    true
  );
});

console.log(
  `BELT_EXAM_ADMIN_FINANCIAL_READ_CONTRACT_V1_2=${passed}/4`
);

if (passed !== 4) {
  process.exitCode = 1;
}