'use strict';

const assert = require('node:assert/strict');
const {
  BPS_DENOMINATOR,
  DEFAULT_PLATFORM_FEE_BPS,
  FinancialDomainError,
  normalizeFinancialRule,
  validateFinancialRule,
  resolveEffectiveFinancialRule,
  resolveRecipientShares,
  calculatePlatformFee,
  allocateSellerPool,
  buildFinancialSnapshot,
  validateFinancialSnapshot,
  canTransitionOrderStatus,
  assertOrderStatusTransition,
  canTransitionTransactionStatus,
  assertTransactionStatusTransition,
  validateOrder,
  validateTransaction,
  buildTransactionFromOrder
} = require('../src/finance/financial-domain');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

function defaultRule(overrides = {}) {
  return {
    id: 'platform-default',
    name: 'Regra padrão da plataforma',
    status: 'active',
    scope: 'platform_default',
    productType: null,
    productId: null,
    platformFeeBps: DEFAULT_PLATFORM_FEE_BPS,
    recipientMode: 'product_owner',
    recipientShares: [],
    version: 1,
    createdBy: 'admin-1',
    updatedBy: 'admin-1',
    createdAt: '2026-09-17T00:00:00Z',
    updatedAt: '2026-09-17T00:00:00Z',
    ...overrides
  };
}

function overrideRule(overrides = {}) {
  return {
    id: 'course-rule-1',
    name: 'Regra específica do curso',
    status: 'active',
    scope: 'product_override',
    productType: 'course',
    productId: 'course-1',
    platformFeeBps: 1500,
    recipientMode: 'explicit',
    recipientShares: [
      { recipientType: 'user', recipientId: 'prof-1', shareBps: 7000 },
      { recipientType: 'organization', recipientId: 'org-1', shareBps: 3000 }
    ],
    version: 3,
    createdBy: 'admin-1',
    updatedBy: 'admin-2',
    createdAt: '2026-09-17T00:00:00Z',
    updatedAt: '2026-09-18T00:00:00Z',
    ...overrides
  };
}

function courseProduct(overrides = {}) {
  return {
    productType: 'course',
    productId: 'course-1',
    financialRuleId: null,
    ownerType: 'user',
    ownerId: 'prof-1',
    currency: 'BRL',
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return buildFinancialSnapshot({
    rule: defaultRule(),
    product: courseProduct(),
    grossAmountCents: 10000,
    currency: 'BRL',
    resolvedAt: '2026-09-17T12:00:00Z',
    ...overrides
  });
}

function order(overrides = {}) {
  return {
    buyerUserId: 'student-1',
    productType: 'course',
    productId: 'course-1',
    quantity: 1,
    amountCents: 10000,
    currency: 'BRL',
    status: 'pending_payment',
    financialSnapshot: snapshot(),
    provider: null,
    providerCustomerId: null,
    currentTransactionId: null,
    idempotencyKey: 'intent-1',
    createdAt: '2026-09-17T12:00:00Z',
    updatedAt: '2026-09-17T12:00:00Z',
    paidAt: null,
    cancelledAt: null,
    expiredAt: null,
    refundedAt: null,
    chargebackAt: null,
    ...overrides
  };
}

test('constante padrão mantém taxa administrativa de 10%', () => {
  assert.equal(BPS_DENOMINATOR, 10000);
  assert.equal(DEFAULT_PLATFORM_FEE_BPS, 1000);
});

test('normalização de regra preserva bps inteiro', () => {
  const rule = normalizeFinancialRule(defaultRule({ platformFeeBps: '1000' }));
  assert.equal(rule.platformFeeBps, 1000);
});

test('regra rejeita bps negativos', () => {
  assert.throws(
    () => validateFinancialRule(defaultRule({ platformFeeBps: -1 })),
    error => error instanceof FinancialDomainError && error.code === 'INVALID_FINANCIAL_INTEGER'
  );
});

test('regra rejeita bps acima de 10000', () => {
  assert.throws(() => validateFinancialRule(defaultRule({ platformFeeBps: 10001 })), /platformFeeBps/);
});

test('regra default rejeita produto específico', () => {
  assert.throws(
    () => validateFinancialRule(defaultRule({ productType: 'course', productId: 'course-1' })),
    error => error.code === 'INVALID_DEFAULT_RULE_SCOPE'
  );
});

test('override exige productId', () => {
  assert.throws(
    () => validateFinancialRule(overrideRule({ productId: null })),
    error => error.code === 'FINANCIAL_RULE_PRODUCT_REQUIRED'
  );
});

test('product_owner não aceita recipientShares explícitos', () => {
  assert.throws(
    () => validateFinancialRule(defaultRule({ recipientShares: [{ recipientType: 'platform', recipientId: null, shareBps: 10000 }] })),
    error => error.code === 'RECIPIENT_SHARES_NOT_ALLOWED'
  );
});

test('explicit exige soma exata de 10000 bps', () => {
  assert.throws(
    () => validateFinancialRule(overrideRule({
      recipientShares: [
        { recipientType: 'user', recipientId: 'prof-1', shareBps: 7000 },
        { recipientType: 'organization', recipientId: 'org-1', shareBps: 2999 }
      ]
    })),
    error => error.code === 'INVALID_RECIPIENT_BPS_TOTAL'
  );
});

test('explicit rejeita recebedor duplicado', () => {
  assert.throws(
    () => validateFinancialRule(overrideRule({
      recipientShares: [
        { recipientType: 'user', recipientId: 'prof-1', shareBps: 5000 },
        { recipientType: 'user', recipientId: 'prof-1', shareBps: 5000 }
      ]
    })),
    error => error.code === 'DUPLICATE_FINANCIAL_RECIPIENT'
  );
});

test('regra inativa não pode ser usada como default', () => {
  assert.throws(
    () => resolveEffectiveFinancialRule({ product: courseProduct(), defaultRule: defaultRule({ status: 'inactive' }) }),
    error => error.code === 'FINANCIAL_RULE_INACTIVE'
  );
});

test('produto sem override usa regra padrão ativa', () => {
  const rule = resolveEffectiveFinancialRule({ product: courseProduct(), defaultRule: defaultRule() });
  assert.equal(rule.id, 'platform-default');
});

test('produto com override válido usa regra específica', () => {
  const rule = resolveEffectiveFinancialRule({
    product: courseProduct({ financialRuleId: 'course-rule-1' }),
    overrideRule: overrideRule(),
    defaultRule: defaultRule()
  });
  assert.equal(rule.id, 'course-rule-1');
  assert.equal(rule.platformFeeBps, 1500);
});

test('override ausente falha fechado sem cair no default', () => {
  assert.throws(
    () => resolveEffectiveFinancialRule({
      product: courseProduct({ financialRuleId: 'course-rule-1' }),
      overrideRule: null,
      defaultRule: defaultRule()
    }),
    error => error.code === 'FINANCIAL_OVERRIDE_NOT_FOUND'
  );
});

test('override de outro produto falha fechado', () => {
  assert.throws(
    () => resolveEffectiveFinancialRule({
      product: courseProduct({ financialRuleId: 'course-rule-1' }),
      overrideRule: overrideRule({ productId: 'course-other' }),
      defaultRule: defaultRule()
    }),
    error => error.code === 'FINANCIAL_OVERRIDE_SCOPE_MISMATCH'
  );
});

test('product_owner resolve plataforma', () => {
  const shares = resolveRecipientShares(
    defaultRule(),
    courseProduct({ ownerType: 'platform', ownerId: null })
  );
  assert.deepEqual(shares, [{ recipientType: 'platform', recipientId: null, shareBps: 10000 }]);
});

test('product_owner resolve usuário', () => {
  const shares = resolveRecipientShares(defaultRule(), courseProduct());
  assert.deepEqual(shares, [{ recipientType: 'user', recipientId: 'prof-1', shareBps: 10000 }]);
});

test('product_owner resolve organização', () => {
  const shares = resolveRecipientShares(
    defaultRule(),
    courseProduct({ ownerType: 'organization', ownerId: 'org-1' })
  );
  assert.deepEqual(shares, [{ recipientType: 'organization', recipientId: 'org-1', shareBps: 10000 }]);
});

test('taxa de 10% sobre R$ 100,00 resulta em R$ 10,00', () => {
  const fee = calculatePlatformFee({ grossAmountCents: 10000, platformFeeBps: 1000 });
  assert.equal(fee.platformFeeCents, 1000);
  assert.equal(fee.sellerPoolCents, 9000);
});

test('arredondamento half-up é determinístico em valores pequenos', () => {
  assert.equal(calculatePlatformFee({ grossAmountCents: 1, platformFeeBps: 1000 }).platformFeeCents, 0);
  assert.equal(calculatePlatformFee({ grossAmountCents: 5, platformFeeBps: 1000 }).platformFeeCents, 1);
  assert.equal(calculatePlatformFee({ grossAmountCents: 999, platformFeeBps: 1000 }).platformFeeCents, 100);
});

test('valor monetário não inteiro é rejeitado', () => {
  assert.throws(() => calculatePlatformFee({ grossAmountCents: 100.5, platformFeeBps: 1000 }), /grossAmountCents/);
});

test('distribuição múltipla preserva exatamente o seller pool', () => {
  const allocations = allocateSellerPool(7650, overrideRule().recipientShares);
  assert.equal(allocations.reduce((sum, item) => sum + item.amountCents, 0), 7650);
  assert.equal(allocations.find(item => item.recipientType === 'user').amountCents, 5355);
  assert.equal(allocations.find(item => item.recipientType === 'organization').amountCents, 2295);
});

test('empate de centavo residual usa chave lexicográfica estável', () => {
  const allocations = allocateSellerPool(1, [
    { recipientType: 'user', recipientId: 'b', shareBps: 5000 },
    { recipientType: 'user', recipientId: 'a', shareBps: 5000 }
  ]);
  assert.equal(allocations.find(item => item.recipientId === 'a').amountCents, 1);
  assert.equal(allocations.find(item => item.recipientId === 'b').amountCents, 0);
});

test('snapshot default fecha exatamente valor bruto', () => {
  const result = snapshot();
  assert.equal(result.platformFeeBps, 1000);
  assert.equal(result.platformFeeCents, 1000);
  assert.equal(result.sellerPoolCents, 9000);
  assert.equal(result.recipientAllocations[0].amountCents, 9000);
  assert.equal(result.platformFeeCents + result.recipientAllocations[0].amountCents, 10000);
});

test('snapshot preserva id e versão da regra efetiva', () => {
  const result = buildFinancialSnapshot({
    rule: overrideRule(),
    product: courseProduct({ financialRuleId: 'course-rule-1' }),
    grossAmountCents: 20000,
    resolvedAt: '2026-09-17T12:00:00Z'
  });
  assert.equal(result.ruleId, 'course-rule-1');
  assert.equal(result.ruleVersion, 3);
  assert.equal(result.platformFeeBps, 1500);
});

test('snapshot rejeita moeda fora do escopo', () => {
  assert.throws(
    () => buildFinancialSnapshot({
      rule: defaultRule(),
      product: courseProduct({ currency: 'USD' }),
      grossAmountCents: 10000,
      currency: 'USD',
      resolvedAt: '2026-09-17T12:00:00Z'
    }),
    /currency/
  );
});

test('validação de snapshot detecta total adulterado', () => {
  const valid = snapshot();
  assert.throws(
    () => validateFinancialSnapshot({ ...valid, sellerPoolCents: 8999 }),
    error => error.code === 'FINANCIAL_SNAPSHOT_TOTAL_MISMATCH'
  );
});

test('pedido pending pode seguir para pago cancelado ou expirado', () => {
  assert.equal(canTransitionOrderStatus('pending_payment', 'paid'), true);
  assert.equal(canTransitionOrderStatus('pending_payment', 'cancelled'), true);
  assert.equal(canTransitionOrderStatus('pending_payment', 'expired'), true);
});

test('pedido pago não pode voltar para pending', () => {
  assert.equal(canTransitionOrderStatus('paid', 'pending_payment'), false);
  assert.throws(
    () => assertOrderStatusTransition('paid', 'pending_payment'),
    error => error.code === 'INVALID_ORDER_STATUS_TRANSITION'
  );
});

test('pedido pago exige paidAt', () => {
  assert.throws(
    () => validateOrder(order({ status: 'paid', paidAt: null })),
    error => error.code === 'ORDER_PAID_TIMESTAMP_REQUIRED'
  );
});

test('pedido válido exige snapshot coerente', () => {
  const valid = validateOrder(order());
  assert.equal(valid.amountCents, 10000);
  assert.equal(valid.financialSnapshot.grossAmountCents, 10000);
  assert.throws(
    () => validateOrder(order({ amountCents: 9999 })),
    error => error.code === 'ORDER_SNAPSHOT_MISMATCH'
  );
});

test('transação created pode seguir para pending', () => {
  assert.equal(canTransitionTransactionStatus('created', 'pending'), true);
});

test('transação paga não pode voltar para pending', () => {
  assert.equal(canTransitionTransactionStatus('paid', 'pending'), false);
  assert.throws(
    () => assertTransactionStatusTransition('paid', 'pending'),
    error => error.code === 'INVALID_TRANSACTION_STATUS_TRANSITION'
  );
});

test('transação paga exige providerPaymentId e confirmedAt', () => {
  const base = buildTransactionFromOrder({
    orderId: 'order-1',
    order: order(),
    createdAt: '2026-09-17T12:01:00Z'
  });
  assert.throws(
    () => validateTransaction({ ...base, status: 'paid' }),
    error => error.code === 'TRANSACTION_PROVIDER_PAYMENT_REQUIRED'
  );
});

test('transação é criada copiando snapshot do pedido sem recalcular', () => {
  const sourceOrder = validateOrder(order());
  const transaction = buildTransactionFromOrder({
    orderId: 'order-1',
    order: sourceOrder,
    createdAt: '2026-09-17T12:01:00Z'
  });
  assert.deepEqual(transaction.financialSnapshot, sourceOrder.financialSnapshot);
  assert.notEqual(transaction.financialSnapshot, sourceOrder.financialSnapshot);
  assert.notEqual(
    transaction.financialSnapshot.recipientAllocations,
    sourceOrder.financialSnapshot.recipientAllocations
  );
});

test('alterar cópia da transação não altera snapshot do pedido', () => {
  const sourceOrder = validateOrder(order());
  const transaction = buildTransactionFromOrder({
    orderId: 'order-1',
    order: sourceOrder,
    createdAt: '2026-09-17T12:01:00Z'
  });
  transaction.financialSnapshot.recipientAllocations[0].amountCents = 1;
  assert.equal(sourceOrder.financialSnapshot.recipientAllocations[0].amountCents, 9000);
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

console.log(`FINANCIAL_DOMAIN_V1_2=${passed}/${cases.length}`);
if (passed !== cases.length) process.exitCode = 1;
