'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RULES_PATH = path.join(ROOT, 'firestore.rules');
const MARKER = '// Contas canônicas de recebedores (Marco 5.2)';

function fail(message) {
  throw new Error(`5.2 financial admin rules patch bloqueado: ${message}`);
}

function main() {
  const source = fs.readFileSync(RULES_PATH, 'utf8');

  if (source.includes(MARKER)) {
    console.log('FINANCIAL_ADMIN_RULES_PATCH=ALREADY_APPLIED');
    return;
  }

  const anchor =
    `    match /orders/{orderId} {\n      allow read, write: if false;\n    }`;

  const count = source.split(anchor).length - 1;
  if (count !== 1) {
    fail(
      `âncora de orders: esperado 1 marcador, encontrado ${count}.`
    );
  }

  const block =
    `    ${MARKER}\n` +
    `    // Wallet/readiness é estado financeiro server-side e nunca é lido diretamente pelo cliente.\n` +
    `    match /financial_recipient_accounts/{accountId} {\n` +
    `      allow read, write: if false;\n` +
    `    }\n\n`;

  fs.writeFileSync(
    RULES_PATH,
    source.replace(anchor, `${block}${anchor}`),
    'utf8'
  );

  console.log('FINANCIAL_ADMIN_RULES_PATCH=OK');
  console.log('RECIPIENT_ACCOUNTS_DIRECT_ACCESS=DENIED');
  console.log('PRODUCTION_ACCESS=NOT_RUN');
}

main();
