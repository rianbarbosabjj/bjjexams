'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RULES_PATH = path.join(ROOT, 'firestore.rules');
const MARKER = '// Financeiro canônico v1.2 (Marco 5.1)';

function fail(message) {
  throw new Error(`5.1 financial rules patch bloqueado: ${message}`);
}

function main() {
  const source = fs.readFileSync(RULES_PATH, 'utf8');

  if (source.includes(MARKER)) {
    console.log('FINANCIAL_FOUNDATION_RULES_PATCH=ALREADY_APPLIED');
    return;
  }

  const anchor = `    match /cursos_teoricos/{id} {`;
  const count = source.split(anchor).length - 1;
  if (count !== 1) {
    fail(`âncora de cursos legados: esperado 1 marcador, encontrado ${count}.`);
  }

  const financialRules = `    ${MARKER}\n    // Regras, pedidos, transações e eventos financeiros são estado server-side.\n    // Views sanitizadas e mutações serão expostas apenas por callables/endpoints dedicados.\n    match /financial_rules/{ruleId} {\n      allow read, write: if false;\n    }\n\n    match /orders/{orderId} {\n      allow read, write: if false;\n    }\n\n    match /payment_transactions/{transactionId} {\n      allow read, write: if false;\n    }\n\n    match /payment_webhook_events/{eventId} {\n      allow read, write: if false;\n    }\n\n`;

  const patched = source.replace(anchor, `${financialRules}${anchor}`);
  fs.writeFileSync(RULES_PATH, patched, 'utf8');

  console.log('FINANCIAL_FOUNDATION_RULES_PATCH=OK');
  console.log('DIRECT_FINANCIAL_CLIENT_ACCESS=DENIED');
  console.log('LEGACY_PEDIDOS_UNCHANGED=True');
  console.log('PRODUCTION_ACCESS=NOT_RUN');
}

main();
