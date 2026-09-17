'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const rules = fs.readFileSync(
  path.join(root, 'firestore.rules'),
  'utf8'
);
const patcher = fs.readFileSync(
  path.join(
    root,
    'scripts',
    'apply-financial-admin-rules-v1_2.js'
  ),
  'utf8'
);

const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

function sectionFor(matchHeader, nextHeader) {
  const start = rules.indexOf(matchHeader);
  const end = rules.indexOf(
    nextHeader,
    start + matchHeader.length
  );

  assert.ok(start >= 0, `Seção ausente: ${matchHeader}`);
  assert.ok(
    end > start,
    `Fim de seção ausente após: ${matchHeader}`
  );

  return rules.slice(start, end);
}

test(
  'patcher usa marcador determinístico do Marco 5.2',
  () => {
    assert.ok(
      patcher.includes(
        'Contas canônicas de recebedores (Marco 5.2)'
      )
    );
    assert.ok(
      patcher.includes(
        'FINANCIAL_ADMIN_RULES_PATCH=OK'
      )
    );
  }
);

test(
  'financial_recipient_accounts nega acesso direto',
  () => {
    const section = sectionFor(
      'match /financial_recipient_accounts/{accountId}',
      'match /orders/{orderId}'
    );

    assert.ok(
      section.includes(
        'allow read, write: if false;'
      )
    );
  }
);

test(
  'rules 5.2 nao reabrem financial_rules nem orders',
  () => {
    assert.ok(
      rules.includes(
        'match /financial_rules/{ruleId}'
      )
    );
    assert.ok(
      rules.includes(
        'match /orders/{orderId}'
      )
    );

    assert.equal(
      patcher.includes('allow read: if true'),
      false
    );
  }
);

let passed = 0;

for (const item of cases) {
  try {
    item.fn();
    passed += 1;
    console.log(`PASS | ${item.name}`);
  } catch (error) {
    console.error(`FAIL | ${item.name}`);
    console.error(
      error.stack ||
      error.message ||
      error
    );
    process.exitCode = 1;
  }
}

console.log(
  `FINANCIAL_ADMIN_FIRESTORE_RULES_V1_2=${passed}/${cases.length}`
);

if (passed !== cases.length) {
  process.exitCode = 1;
}
