'use strict';

const assert = require('node:assert/strict');
const {
  buildFinancialSnapshot,
  validateOrder,
  validateTransaction
} = require('../src/finance/financial-domain');
const {
  FinancialReversalDomainError
} = require('../src/finance/financial-reversal-domain');
const {
  FinancialReversalStateDomainError,
  buildCanonicalFinancialReversalState
} = require('../src/finance/financial-reversal-state-domain');
const {
  ENROLLMENT_STATUSES,
  CourseEnrollmentDomainError,
  validateEnrollment,
  resolveCourseEntitlement
} = require('../src/courses/course-enrollment-domain');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

function snapshot() {
  return buildFinancialSnapshot({
    rule: {
      id: 'platform-default',
      name: 'Regra padrão da plataforma',
      status: 'active',
      scope: 'platform_default',
      productType: null,
      productId: null,
      platformFeeBps: 1000,
      recipientMode: 'product_owner',
      recipientShares: [],
      version: 1,
      createdBy: 'admin-1',
      updatedBy: 'admin-1',
      createdAt: '2026-09-17T00:00:00Z',
      updatedAt: '2026-09-17T00:00:00Z'
    },
    product: {
      productType: 'course',
      productId: 'course-1',
      financialRuleId: null,
      ownerType: 'user',
      ownerId: 'prof-1',
      currency: 'BRL'
    },
    grossAmountCents: 10000,
    currency: 'BRL',
    resolvedAt: '2026-09-17T12:00:00Z'
  });
}

function paidOrder(overrides = {}) {
  return validateOrder({
    buyerUserId: 'student-1',
    productType: 'course',
    productId: 'course-1',
    quantity: 1,
    amountCents: 10000,
    currency: 'BRL',
    status: 'paid',
    financialSnapshot: snapshot(),
    provider: 'asaas',
    providerCustomerId: 'cus-1',
    currentTransactionId: 'tx-1',
    idempotencyKey: 'intent-1',
    createdAt: '2026-09-17T12:00:00Z',
    updatedAt: '2026-09-17T12:10:00Z',
    paidAt: '2026-09-17T12:10:00Z',
    cancelledAt: null,
    expiredAt: null,
    refundedAt: null,
    chargebackAt: null,
    ...overrides
  });
}

function paidTransaction(overrides = {}) {
  return validateTransaction({
    orderId: 'order-1',
    buyerUserId: 'student-1',
    provider: 'asaas',
    providerPaymentId: 'pay-1',
    providerStatus: 'RECEIVED',
    status: 'paid',
    amountCents: 10000,
    currency: 'BRL',
    financialSnapshot: snapshot(),
    providerSplitSnapshot: null,
    createdAt: '2026-09-17T12:01:00Z',
    updatedAt: '2026-09-17T12:10:00Z',
    confirmedAt: '2026-09-17T12:10:00Z',
    refundedAt: null,
    chargebackAt: null,
    ...overrides
  });
}

function activeEnrollment(overrides = {}) {
  return validateEnrollment({
    courseId: 'course-1',
    userId: 'student-1',
    source: 'order',
    orderId: 'order-1',
    status: 'active',
    progressPercent: 42,
    startedAt: '2026-09-17T12:10:00Z',
    completedAt: null,
    createdAt: '2026-09-17T12:10:00Z',
    updatedAt: '2026-09-17T12:10:00Z',
    ...overrides
  });
}

function apply(overrides = {}) {
  return buildCanonicalFinancialReversalState({
    orderId: 'order-1',
    order: paidOrder(),
    transactionId: 'tx-1',
    transaction: paidTransaction(),
    enrollment: activeEnrollment(),
    eventType: 'PAYMENT_REFUNDED',
    now: '2026-09-19T01:00:00Z',
    ...overrides
  });
}

test('enrollment canônico passa a aceitar status chargeback', () => {
  assert.equal(ENROLLMENT_STATUSES.includes('chargeback'), true);
  const enrollment = validateEnrollment(activeEnrollment({ status: 'chargeback' }));
  assert.equal(enrollment.status, 'chargeback');
});

test('chargeback em enrollment exige source=order', () => {
  assert.throws(
    () => validateEnrollment({
      ...activeEnrollment(),
      source: 'admin_grant',
      orderId: null,
      status: 'chargeback'
    }),
    error => error instanceof CourseEnrollmentDomainError &&
      error.code === 'CHARGEBACK_REQUIRES_ORDER_SOURCE'
  );
});

test('enrollment chargeback não concede entitlement', () => {
  const entitlement = resolveCourseEntitlement({
    courseId: 'course-1',
    userId: 'student-1',
    course: {
      status: 'published',
      visibility: 'platform',
      isPaid: true,
      priceCents: 10000
    },
    enrollment: activeEnrollment({ status: 'chargeback' })
  });
  assert.equal(entitlement.granted, false);
  assert.equal(entitlement.reason, 'ENROLLMENT_INACTIVE');
});

test('refund integral converge order transaction e enrollment', () => {
  const result = apply();
  assert.equal(result.order.status, 'refunded');
  assert.equal(result.transaction.status, 'refunded');
  assert.equal(result.enrollment.status, 'refunded');
  assert.equal(result.order.refundedAt, '2026-09-19T01:00:00Z');
  assert.equal(result.transaction.refundedAt, '2026-09-19T01:00:00Z');
  assert.equal(result.enrollment.progressPercent, 42);
  assert.equal(result.mutationRequired, true);
});

test('refund preserva conclusão histórica do curso', () => {
  const completed = activeEnrollment({
    status: 'completed',
    progressPercent: 100,
    completedAt: '2026-09-18T10:00:00Z'
  });
  const result = apply({ enrollment: completed });
  assert.equal(result.enrollment.status, 'refunded');
  assert.equal(result.enrollment.progressPercent, 100);
  assert.equal(result.enrollment.completedAt, '2026-09-18T10:00:00Z');
});

test('chargeback converge estados e preserva histórico', () => {
  const result = apply({ eventType: 'PAYMENT_CHARGEBACK_REQUESTED' });
  assert.equal(result.order.status, 'chargeback');
  assert.equal(result.transaction.status, 'chargeback');
  assert.equal(result.enrollment.status, 'chargeback');
  assert.equal(result.order.chargebackAt, '2026-09-19T01:00:00Z');
  assert.equal(result.transaction.chargebackAt, '2026-09-19T01:00:00Z');
  assert.equal(result.enrollment.progressPercent, 42);
});

test('refund final pode suceder chargeback mantendo timestamps históricos', () => {
  const result = apply({
    order: paidOrder({
      status: 'chargeback',
      chargebackAt: '2026-09-18T20:00:00Z'
    }),
    transaction: paidTransaction({
      status: 'chargeback',
      chargebackAt: '2026-09-18T20:00:00Z'
    }),
    enrollment: activeEnrollment({ status: 'chargeback' }),
    eventType: 'PAYMENT_REFUNDED'
  });
  assert.equal(result.order.status, 'refunded');
  assert.equal(result.transaction.status, 'refunded');
  assert.equal(result.enrollment.status, 'refunded');
  assert.equal(result.order.chargebackAt, '2026-09-18T20:00:00Z');
  assert.equal(result.order.refundedAt, '2026-09-19T01:00:00Z');
});

test('evento positivo não recupera chargeback sem autorização contextual', () => {
  assert.throws(
    () => apply({
      order: paidOrder({ status: 'chargeback', chargebackAt: '2026-09-18T20:00:00Z' }),
      transaction: paidTransaction({ status: 'chargeback', chargebackAt: '2026-09-18T20:00:00Z' }),
      enrollment: activeEnrollment({ status: 'chargeback' }),
      eventType: 'PAYMENT_RECEIVED'
    }),
    error => error instanceof FinancialReversalDomainError &&
      error.code === 'CHARGEBACK_RECOVERY_NOT_AUTHORIZED'
  );
});

test('recuperação autorizada restaura paid e enrollment ativo', () => {
  const result = apply({
    order: paidOrder({ status: 'chargeback', chargebackAt: '2026-09-18T20:00:00Z' }),
    transaction: paidTransaction({ status: 'chargeback', chargebackAt: '2026-09-18T20:00:00Z' }),
    enrollment: activeEnrollment({ status: 'chargeback' }),
    eventType: 'PAYMENT_RECEIVED',
    chargebackRecoveryAuthorized: true
  });
  assert.equal(result.transition.action, 'chargeback_recovered');
  assert.equal(result.order.status, 'paid');
  assert.equal(result.transaction.status, 'paid');
  assert.equal(result.enrollment.status, 'active');
  assert.equal(result.order.chargebackAt, '2026-09-18T20:00:00Z');
});

test('recuperação autorizada restaura completed quando há conclusão histórica', () => {
  const result = apply({
    order: paidOrder({ status: 'chargeback', chargebackAt: '2026-09-18T20:00:00Z' }),
    transaction: paidTransaction({ status: 'chargeback', chargebackAt: '2026-09-18T20:00:00Z' }),
    enrollment: activeEnrollment({
      status: 'chargeback',
      progressPercent: 100,
      completedAt: '2026-09-18T10:00:00Z'
    }),
    eventType: 'PAYMENT_CONFIRMED',
    chargebackRecoveryAuthorized: true
  });
  assert.equal(result.enrollment.status, 'completed');
  assert.equal(result.enrollment.completedAt, '2026-09-18T10:00:00Z');
});

test('recuperação de chargeback exige timestamps históricos', () => {
  assert.throws(
    () => apply({
      order: paidOrder({ status: 'chargeback', chargebackAt: null }),
      transaction: paidTransaction({ status: 'chargeback', chargebackAt: null }),
      enrollment: activeEnrollment({ status: 'chargeback' }),
      eventType: 'PAYMENT_RECEIVED',
      chargebackRecoveryAuthorized: true
    }),
    /chargeback/i
  );
});

test('refund reentregue é idempotente e pode curar enrollment divergente', () => {
  const result = apply({
    order: paidOrder({
      status: 'refunded',
      refundedAt: '2026-09-18T21:00:00Z'
    }),
    transaction: paidTransaction({
      status: 'refunded',
      refundedAt: '2026-09-18T21:00:00Z'
    }),
    enrollment: activeEnrollment({ status: 'active' }),
    eventType: 'PAYMENT_REFUNDED'
  });
  assert.equal(result.transition.idempotent, true);
  assert.equal(result.financialMutationRequired, false);
  assert.equal(result.enrollment.status, 'refunded');
  assert.equal(result.enrollmentMutationRequired, true);
});

test('cancelamento pré-pagamento converge sem enrollment', () => {
  const pendingOrder = paidOrder({
    status: 'pending_payment',
    paidAt: null,
    providerCustomerId: 'cus-1'
  });
  const pendingTransaction = paidTransaction({
    status: 'pending',
    providerPaymentId: 'pay-1',
    confirmedAt: null
  });
  const result = apply({
    order: pendingOrder,
    transaction: pendingTransaction,
    enrollment: null,
    eventType: 'PAYMENT_DELETED'
  });
  assert.equal(result.order.status, 'cancelled');
  assert.equal(result.transaction.status, 'cancelled');
  assert.equal(result.order.cancelledAt, '2026-09-19T01:00:00Z');
  assert.equal(result.enrollment, null);
});

test('cancelamento pré-pagamento falha se enrollment existir', () => {
  assert.throws(
    () => apply({
      order: paidOrder({ status: 'pending_payment', paidAt: null }),
      transaction: paidTransaction({ status: 'pending', confirmedAt: null }),
      enrollment: activeEnrollment(),
      eventType: 'PAYMENT_DELETED'
    }),
    error => error instanceof FinancialReversalDomainError &&
      error.code === 'CANCELLED_PAYMENT_HAS_ENTITLEMENT'
  );
});

test('divergência de identidade entre pedido e transação falha fechado', () => {
  assert.throws(
    () => apply({ transaction: paidTransaction({ orderId: 'order-other' }) }),
    error => error instanceof FinancialReversalStateDomainError &&
      error.code === 'REVERSAL_TRANSACTION_ORDER_MISMATCH'
  );
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

console.log(`FINANCIAL_REVERSAL_STATE_DOMAIN_V1_2=${passed}/${cases.length}`);
if (passed !== cases.length) process.exitCode = 1;