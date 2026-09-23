'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const courseFulfillment = fs.readFileSync(
  path.join(root, 'functions/src/finance/financial-webhook-fulfillment.js'),
  'utf8'
);
const beltFulfillment = fs.readFileSync(
  path.join(root, 'functions/src/finance/financial-belt-exam-webhook-fulfillment.js'),
  'utf8'
);
const worker = fs.readFileSync(
  path.join(root, 'functions/src/finance/financial-webhook-functions.js'),
  'utf8'
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

test('fulfillment course permanece explicitamente course-first', () => {
  assert.match(courseFulfillment, /order\.productType !== 'course'/);
  assert.match(courseFulfillment, /course\.enrollment\.created/);
  assert.equal(courseFulfillment.includes('authorizePaidExamRegistration'), false);
});

test('fulfillment belt_exam autoriza registration sem criar enrollment', () => {
  assert.match(beltFulfillment, /authorizePaidExamRegistration/);
  assert.match(beltFulfillment, /exam\.registration\.authorized/);
  assert.equal(/db\.doc\(`enrollments\//.test(beltFulfillment), false);
});

test('worker despacha belt_exam antes de reutilizar fulfillment course', () => {
  const route = worker.indexOf(
    'const beltExam = await isBeltExamFinancialEvent'
  );
  const belt = worker.indexOf(
    'const fulfillment = createFinancialBeltExamWebhookFulfillment'
  );
  const course = worker.lastIndexOf(
    'const fulfillment = createFinancialWebhookFulfillment'
  );
  assert.ok(route >= 0);
  assert.ok(belt > route);
  assert.ok(course > belt);
});

test('erro belt_exam possui tratamento dedicado no worker', () => {
  assert.match(worker, /FinancialBeltExamWebhookFulfillmentError/);
  assert.match(worker, /error\.retryable !== true/);
});

console.log(`BELT_EXAM_WEBHOOK_CONTRACT_V1_2=${passed}/4`);
if (passed !== 4) process.exitCode = 1;
