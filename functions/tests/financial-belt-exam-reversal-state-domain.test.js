'use strict';

const assert = require('node:assert/strict');
const {
  FinancialBeltExamReversalStateDomainError,
  buildCanonicalBeltExamReversalState
} = require('../src/finance/financial-belt-exam-reversal-state-domain');

let passed = 0;
const now = new Date('2026-09-20T03:00:00.000Z');
const selectedAt = new Date('2026-09-20T02:00:00.000Z');
const paidAt = new Date('2026-09-20T02:30:00.000Z');

function snapshot(sessionId, amountCents = 5000) {
  return {
    ruleId: 'platform-default',
    ruleVersion: 1,
    productType: 'belt_exam',
    productId: sessionId,
    currency: 'BRL',
    grossAmountCents: amountCents,
    platformFeeBps: 1000,
    platformFeeCents: 500,
    sellerPoolCents: 4500,
    recipientMode: 'product_owner',
    recipientAllocations: [{
      recipientType: 'organization',
      recipientId: 'org_1',
      shareBps: 10000,
      amountCents: 4500
    }],
    resolvedAt: selectedAt
  };
}

function state({
  orderStatus = 'paid',
  transactionStatus = orderStatus === 'pending_payment' ? 'pending' : orderStatus,
  registrationStatus = orderStatus === 'pending_payment' ? 'awaiting_payment' : 'authorized',
  registrationOrderId = 'order_1',
  attemptId = null,
  productType = 'belt_exam'
} = {}) {
  const sessionId = 'session_1';
  const financialSnapshot = {
    ...snapshot(sessionId),
    productType
  };
  const order = {
    buyerUserId: 'student_1',
    productType,
    productId: sessionId,
    quantity: 1,
    amountCents: 5000,
    currency: 'BRL',
    status: orderStatus,
    financialSnapshot,
    provider: 'asaas',
    providerCustomerId: 'cus_1',
    currentTransactionId: 'tx_1',
    idempotencyKey: 'intent_1',
    createdAt: selectedAt,
    updatedAt: selectedAt,
    paidAt: ['paid', 'refunded', 'chargeback'].includes(orderStatus) ? paidAt : null,
    cancelledAt: orderStatus === 'cancelled' ? now : null,
    expiredAt: null,
    refundedAt: orderStatus === 'refunded' ? now : null,
    chargebackAt: orderStatus === 'chargeback' ? now : null
  };
  const transaction = {
    orderId: 'order_1',
    buyerUserId: 'student_1',
    provider: 'asaas',
    providerPaymentId: 'pay_1',
    providerStatus: orderStatus === 'pending_payment' ? 'PENDING' : 'RECEIVED',
    status: transactionStatus,
    amountCents: 5000,
    currency: 'BRL',
    financialSnapshot,
    providerSplitSnapshot: [],
    createdAt: selectedAt,
    updatedAt: selectedAt,
    confirmedAt: ['paid', 'refunded', 'chargeback'].includes(transactionStatus) ? paidAt : null,
    refundedAt: transactionStatus === 'refunded' ? now : null,
    chargebackAt: transactionStatus === 'chargeback' ? now : null
  };
  const paidRegistration = [
    'authorized', 'started', 'submitted', 'passed', 'failed', 'certified'
  ].includes(registrationStatus);
  const registration = {
    sessionId,
    organizationId: 'org_1',
    studentId: 'student_1',
    instructorId: 'instructor_1',
    currentBelt: 'Branca',
    targetBelt: 'Azul',
    membershipId: 'membership_1',
    status: registrationStatus,
    orderId: registrationOrderId,
    attemptId,
    resultId: null,
    certificateId: null,
    selectedAt,
    paidAt: paidRegistration || registrationStatus === 'needs_reconciliation' ? paidAt : null,
    authorizedAt: paidRegistration || registrationStatus === 'needs_reconciliation' ? paidAt : null,
    cancelledAt: registrationStatus === 'cancelled' ? now : null,
    updatedAt: selectedAt
  };
  return { order, transaction, registration };
}

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

test('cancelamento pending cancela financeiro e retorna registration a selected', () => {
  const input = state({ orderStatus: 'pending_payment' });
  const result = buildCanonicalBeltExamReversalState({
    orderId: 'order_1',
    order: input.order,
    transactionId: 'tx_1',
    transaction: input.transaction,
    registration: input.registration,
    eventType: 'PAYMENT_DELETED',
    now
  });
  assert.equal(result.order.status, 'cancelled');
  assert.equal(result.transaction.status, 'cancelled');
  assert.equal(result.registration.status, 'selected');
  assert.equal(result.registration.orderId, null);
});

test('refund antes da prova revoga authorization e preserva historico do pedido', () => {
  const input = state();
  const result = buildCanonicalBeltExamReversalState({
    orderId: 'order_1', order: input.order,
    transactionId: 'tx_1', transaction: input.transaction,
    registration: input.registration,
    eventType: 'PAYMENT_REFUNDED', now
  });
  assert.equal(result.order.status, 'refunded');
  assert.equal(result.transaction.status, 'refunded');
  assert.equal(result.registration.status, 'cancelled');
  assert.equal(result.registration.orderId, 'order_1');
  assert.equal(result.reviewRequired, false);
});

test('refund apos inicio preserva atividade e exige reconciliacao', () => {
  const input = state({ registrationStatus: 'started', attemptId: 'attempt_1' });
  const result = buildCanonicalBeltExamReversalState({
    orderId: 'order_1', order: input.order,
    transactionId: 'tx_1', transaction: input.transaction,
    registration: input.registration,
    eventType: 'PAYMENT_REFUNDED', now
  });
  assert.equal(result.order.status, 'refunded');
  assert.equal(result.registration.status, 'needs_reconciliation');
  assert.equal(result.registration.attemptId, 'attempt_1');
  assert.equal(result.reviewRequired, true);
});

test('refund parcial nao mente sucesso e marca registration para reconciliacao', () => {
  const input = state();
  const result = buildCanonicalBeltExamReversalState({
    orderId: 'order_1', order: input.order,
    transactionId: 'tx_1', transaction: input.transaction,
    registration: input.registration,
    eventType: 'PAYMENT_PARTIALLY_REFUNDED', now
  });
  assert.equal(result.order.status, 'paid');
  assert.equal(result.transaction.status, 'paid');
  assert.equal(result.registration.status, 'needs_reconciliation');
  assert.equal(result.reviewRequired, true);
});

test('refund negado mantem pagamento e authorization', () => {
  const input = state();
  const result = buildCanonicalBeltExamReversalState({
    orderId: 'order_1', order: input.order,
    transactionId: 'tx_1', transaction: input.transaction,
    registration: input.registration,
    eventType: 'PAYMENT_REFUND_DENIED', now
  });
  assert.equal(result.order.status, 'paid');
  assert.equal(result.registration.status, 'authorized');
  assert.equal(result.classification.requiresReview, true);
});

test('chargeback bloqueia authorization em needs_reconciliation', () => {
  const input = state();
  const result = buildCanonicalBeltExamReversalState({
    orderId: 'order_1', order: input.order,
    transactionId: 'tx_1', transaction: input.transaction,
    registration: input.registration,
    eventType: 'PAYMENT_CHARGEBACK_REQUESTED', now
  });
  assert.equal(result.order.status, 'chargeback');
  assert.equal(result.transaction.status, 'chargeback');
  assert.equal(result.registration.status, 'needs_reconciliation');
});

test('dominio belt_exam rejeita pedido course', () => {
  const input = state({ productType: 'course' });
  assert.throws(
    () => buildCanonicalBeltExamReversalState({
      orderId: 'order_1', order: input.order,
      transactionId: 'tx_1', transaction: input.transaction,
      registration: input.registration,
      eventType: 'PAYMENT_REFUNDED', now
    }),
    error => error instanceof FinancialBeltExamReversalStateDomainError &&
      error.code === 'BELT_EXAM_REVERSAL_PRODUCT_REQUIRED'
  );
});

test('registration de outro order falha fechado', () => {
  const input = state({ registrationOrderId: 'order_other' });
  assert.throws(
    () => buildCanonicalBeltExamReversalState({
      orderId: 'order_1', order: input.order,
      transactionId: 'tx_1', transaction: input.transaction,
      registration: input.registration,
      eventType: 'PAYMENT_REFUNDED', now
    }),
    error => error instanceof FinancialBeltExamReversalStateDomainError &&
      error.code === 'BELT_EXAM_REVERSAL_REGISTRATION_IDENTITY_MISMATCH'
  );
});

console.log(`BELT_EXAM_REVERSAL_STATE_DOMAIN_V1_2=${passed}/8`);
if (passed !== 8) process.exitCode = 1;
