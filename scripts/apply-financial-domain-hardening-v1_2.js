'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOMAIN_PATH = path.join(ROOT, 'functions', 'src', 'finance', 'financial-domain.js');
const TEST_PATH = path.join(ROOT, 'functions', 'tests', 'financial-domain.test.js');
const MARKER = 'FINANCIAL_DOMAIN_HARDENING_V1_2';

function fail(message) {
  throw new Error(`5.1 financial domain hardening bloqueado: ${message}`);
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) fail(`${label}: esperado 1 marcador, encontrado ${count}.`);
  return source.replace(before, after);
}

function patchDomain(source) {
  source = replaceOnce(
    source,
    `  const raw = gross * bps;\n  if (!Number.isSafeInteger(raw)) {`,
    `  const raw = gross * bps;\n  if (\n    !Number.isSafeInteger(raw) ||\n    raw > Number.MAX_SAFE_INTEGER - (BPS_DENOMINATOR / 2)\n  ) {`,
    'proteção de overflow do arredondamento'
  );

  source = replaceOnce(
    source,
    `  const rule = validateFinancialRule(ruleInput);\n  assertActiveRule(rule);\n  const product = validateProductContext({ ...productInput, currency });\n  const fee = calculatePlatformFee({ grossAmountCents, platformFeeBps: rule.platformFeeBps });`,
    `  const rule = validateFinancialRule(ruleInput);\n  assertActiveRule(rule);\n  const product = validateProductContext({ ...productInput, currency });\n\n  if (product.financialRuleId && rule.id !== product.financialRuleId) {\n    throw new FinancialDomainError(\n      'FINANCIAL_RULE_RESOLUTION_MISMATCH',\n      'Regra usada no snapshot não corresponde ao financialRuleId do produto.'\n    );\n  }\n  if (!product.financialRuleId && rule.scope === 'product_override') {\n    throw new FinancialDomainError(\n      'FINANCIAL_RULE_RESOLUTION_MISMATCH',\n      'Override financeiro não pode ser aplicado sem referência explícita do produto.'\n    );\n  }\n  if (\n    rule.scope === 'product_override' &&\n    (rule.productType !== product.productType || rule.productId !== product.productId)\n  ) {\n    throw new FinancialDomainError(\n      'FINANCIAL_OVERRIDE_SCOPE_MISMATCH',\n      'Override financeiro não corresponde ao produto do snapshot.'\n    );\n  }\n\n  const fee = calculatePlatformFee({ grossAmountCents, platformFeeBps: rule.platformFeeBps });`,
    'alinhamento regra/produto do snapshot'
  );

  source = replaceOnce(
    source,
    `  if (order.status === 'paid' && !order.paidAt) {\n    throw new FinancialDomainError('ORDER_PAID_TIMESTAMP_REQUIRED', 'Pedido pago exige paidAt.');\n  }`,
    `  if (['paid', 'refunded', 'chargeback'].includes(order.status) && !order.paidAt) {\n    throw new FinancialDomainError(\n      'ORDER_PAID_TIMESTAMP_REQUIRED',\n      'Pedido pago, reembolsado ou em chargeback exige paidAt histórico.'\n    );\n  }`,
    'paidAt histórico do pedido'
  );

  source = replaceOnce(
    source,
    `  if (!createdAt) {\n    throw new FinancialDomainError('TRANSACTION_TIMESTAMP_REQUIRED', 'Transação exige createdAt.');\n  }\n\n  return validateTransaction({`,
    `  if (!createdAt) {\n    throw new FinancialDomainError('TRANSACTION_TIMESTAMP_REQUIRED', 'Transação exige createdAt.');\n  }\n  if (order.status !== 'pending_payment') {\n    throw new FinancialDomainError(\n      'ORDER_NOT_PENDING_PAYMENT',\n      'Nova transação somente pode ser criada para pedido pending_payment.'\n    );\n  }\n\n  return validateTransaction({`,
    'transação somente para pedido pendente'
  );

  return `${source}\n// ${MARKER}\n`;
}

function patchTests(source) {
  const marker = `test('snapshot rejeita moeda fora do escopo', () => {`;
  const extraSnapshotTests = `test('snapshot rejeita override de outro produto', () => {\n  assert.throws(\n    () => buildFinancialSnapshot({\n      rule: overrideRule({ productId: 'course-other' }),\n      product: courseProduct({ financialRuleId: 'course-rule-1' }),\n      grossAmountCents: 10000,\n      resolvedAt: '2026-09-17T12:00:00Z'\n    }),\n    error => error.code === 'FINANCIAL_OVERRIDE_SCOPE_MISMATCH'\n  );\n});\n\ntest('snapshot não aceita default quando produto referencia override', () => {\n  assert.throws(\n    () => buildFinancialSnapshot({\n      rule: defaultRule(),\n      product: courseProduct({ financialRuleId: 'course-rule-1' }),\n      grossAmountCents: 10000,\n      resolvedAt: '2026-09-17T12:00:00Z'\n    }),\n    error => error.code === 'FINANCIAL_RULE_RESOLUTION_MISMATCH'\n  );\n});\n\n${marker}`;
  source = replaceOnce(source, marker, extraSnapshotTests, 'testes de alinhamento do snapshot');

  const moneyMarker = `test('distribuição múltipla preserva exatamente o seller pool', () => {`;
  const overflowTest = `test('cálculo bloqueia overflow antes de somar arredondamento', () => {\n  const grossNearLimit = Math.floor(Number.MAX_SAFE_INTEGER / BPS_DENOMINATOR);\n  assert.throws(\n    () => calculatePlatformFee({ grossAmountCents: grossNearLimit, platformFeeBps: 10000 }),\n    error => error.code === 'FINANCIAL_AMOUNT_OVERFLOW'\n  );\n});\n\n${moneyMarker}`;
  source = replaceOnce(source, moneyMarker, overflowTest, 'teste de overflow');

  const orderMarker = `test('pedido válido exige snapshot coerente', () => {`;
  const orderHistoryTest = `test('pedido reembolsado preserva paidAt histórico', () => {\n  assert.throws(\n    () => validateOrder(order({\n      status: 'refunded',\n      paidAt: null,\n      refundedAt: '2026-09-18T12:00:00Z'\n    })),\n    error => error.code === 'ORDER_PAID_TIMESTAMP_REQUIRED'\n  );\n});\n\n${orderMarker}`;
  source = replaceOnce(source, orderMarker, orderHistoryTest, 'teste de paidAt histórico');

  const transactionMarker = `test('transação é criada copiando snapshot do pedido sem recalcular', () => {`;
  const pendingOrderTest = `test('nova transação exige pedido ainda pending_payment', () => {\n  const paidOrder = order({\n    status: 'paid',\n    paidAt: '2026-09-17T12:10:00Z'\n  });\n  assert.throws(\n    () => buildTransactionFromOrder({\n      orderId: 'order-1',\n      order: paidOrder,\n      createdAt: '2026-09-17T12:11:00Z'\n    }),\n    error => error.code === 'ORDER_NOT_PENDING_PAYMENT'\n  );\n});\n\n${transactionMarker}`;
  source = replaceOnce(source, transactionMarker, pendingOrderTest, 'teste de pedido pendente');

  return source;
}

function main() {
  const domain = fs.readFileSync(DOMAIN_PATH, 'utf8');
  const tests = fs.readFileSync(TEST_PATH, 'utf8');

  if (domain.includes(MARKER)) {
    console.log('FINANCIAL_DOMAIN_HARDENING_PATCH=ALREADY_APPLIED');
    return;
  }

  fs.writeFileSync(DOMAIN_PATH, patchDomain(domain), 'utf8');
  fs.writeFileSync(TEST_PATH, patchTests(tests), 'utf8');

  console.log('FINANCIAL_DOMAIN_HARDENING_PATCH=OK');
  console.log('SNAPSHOT_RULE_SCOPE_GUARD=True');
  console.log('ORDER_HISTORY_GUARD=True');
  console.log('SAFE_INTEGER_ROUNDING_GUARD=True');
  console.log('PRODUCTION_ACCESS=NOT_RUN');
}

main();
