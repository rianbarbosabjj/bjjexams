'use strict';

const assert = require('node:assert/strict');

const {
  buildFinancialSnapshot,
  validateOrder,
  validateTransaction
} = require('../src/finance/financial-domain');
const {
  validateExamRegistration
} = require('../src/exams/exam-registration-domain');
const {
  FinancialPurchaseReadDomainError
} = require('../src/finance/financial-purchase-read-domain');
const {
  buildAdminBeltExamOperationView
} = require('../src/finance/financial-belt-exam-admin-read-domain');

const NOW = new Date('2026-09-20T18:00:00.000Z');
const LATER = new Date('2026-09-20T18:05:00.000Z');

const SESSION_ID = 'exam-session-admin-read-1';
const USER_ID = 'student-admin-read-1';
const ORDER_ID = 'order-admin-read-1';
const TX_ID = 'tx-admin-read-1';

let passed = 0;

const rule = Object.freeze({
  id: 'platform-default',
  name: 'Regra padrão',
  status: 'active',
  scope: 'platform_default',
  productType: null,
  productId: null,
  platformFeeBps: 1000,
  recipientMode: 'product_owner',
  recipientShares: [],
  version: 1,
  createdBy: 'system',
  updatedBy: 'system',
  createdAt: NOW,
  updatedAt: NOW
});

const snapshot = buildFinancialSnapshot({
  rule,
  product: {
    productType: 'belt_exam',
    productId: SESSION_ID,
    ownerType: 'platform',
    ownerId: null,
    currency: 'BRL'
  },
  grossAmountCents: 6500,
  currency: 'BRL',
  resolvedAt: NOW
});

function order(status = 'pending_payment') {
  return validateOrder({
    buyerUserId: USER_ID,
    productType: 'belt_exam',
    productId: SESSION_ID,
    quantity: 1,
    amountCents: 6500,
    currency: 'BRL',
    status,
    financialSnapshot: snapshot,
    provider: 'asaas',
    providerCustomerId: 'customer-admin-read-1',
    currentTransactionId: TX_ID,
    idempotencyKey: 'belt-admin-read-intent',
    createdAt: NOW,
    updatedAt: LATER,
    paidAt: ['paid', 'refunded', 'chargeback'].includes(status)
      ? NOW
      : null,
    cancelledAt: status === 'cancelled' ? LATER : null,
    expiredAt: status === 'expired' ? LATER : null,
    refundedAt: status === 'refunded' ? LATER : null,
    chargebackAt: status === 'chargeback' ? LATER : null
  });
}

function transaction(status = 'pending') {
  return validateTransaction({
    orderId: ORDER_ID,
    buyerUserId: USER_ID,
    provider: 'asaas',
    providerPaymentId: 'payment-admin-read-secret',
    providerStatus:
      status === 'paid'
        ? 'RECEIVED'
        : status.toUpperCase(),
    status,
    amountCents: 6500,
    currency: 'BRL',
    financialSnapshot: snapshot,
    providerSplitSnapshot: [],
    createdAt: NOW,
    updatedAt: LATER,
    confirmedAt: ['paid', 'refunded', 'chargeback'].includes(status)
      ? NOW
      : null,
    refundedAt: status === 'refunded' ? LATER : null,
    chargebackAt: status === 'chargeback' ? LATER : null
  });
}

function registration(status = 'awaiting_payment', overrides = {}) {
  const paid = [
    'authorized',
    'started',
    'submitted',
    'passed',
    'failed',
    'certified'
  ].includes(status);

  return validateExamRegistration({
    sessionId: SESSION_ID,
    organizationId: 'org-admin-read-1',
    studentId: USER_ID,
    instructorId: 'instructor-admin-read-1',
    currentBelt: 'Branca',
    targetBelt: 'Azul',
    membershipId: 'membership-admin-read-1',
    status,
    orderId:
      status === 'selected'
        ? null
        : ORDER_ID,
    attemptId:
      ['started', 'submitted', 'passed', 'failed', 'certified'].includes(status)
        ? 'attempt-admin-read-1'
        : null,
    resultId:
      ['passed', 'failed', 'certified'].includes(status)
        ? 'result-admin-read-1'
        : null,
    certificateId:
      status === 'certified'
        ? 'certificate-admin-read-1'
        : null,
    selectedAt: NOW,
    paidAt: paid ? NOW : null,
    authorizedAt: paid ? NOW : null,
    cancelledAt: status === 'cancelled' ? LATER : null,
    updatedAt: LATER,
    ...overrides
  });
}

function view({
  orderStatus = 'pending_payment',
  transactionStatus = 'pending',
  registrationStatus = 'awaiting_payment',
  reversalRequest = null
} = {}) {
  return buildAdminBeltExamOperationView({
    orderId: ORDER_ID,
    order: order(orderStatus),
    transactionId: TX_ID,
    transaction: transaction(transactionStatus),
    registration: registration(registrationStatus),
    reversalRequestId:
      reversalRequest
        ? 'reversal-admin-read-1'
        : null,
    reversalRequest
  });
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

test('belt_exam pending permite apenas cancelamento seguro', () => {
  const result = view();

  assert.equal(result.productType, 'belt_exam');
  assert.equal(result.registrationStatus, 'awaiting_payment');
  assert.equal(result.canCancel, true);
  assert.equal(result.canRefund, false);
});

test('belt_exam paid authorized permite refund integral', () => {
  const result = view({
    orderStatus: 'paid',
    transactionStatus: 'paid',
    registrationStatus: 'authorized'
  });

  assert.equal(result.canCancel, false);
  assert.equal(result.canRefund, true);
  assert.equal(result.needsReconciliation, false);
});

test('atividade academica bloqueia refund administrativo', () => {
  const result = view({
    orderStatus: 'paid',
    transactionStatus: 'paid',
    registrationStatus: 'started'
  });

  assert.equal(result.canRefund, false);
});

test('registration needs_reconciliation aparece e bloqueia acao', () => {
  const result = view({
    orderStatus: 'paid',
    transactionStatus: 'paid',
    registrationStatus: 'needs_reconciliation'
  });

  assert.equal(result.needsReconciliation, true);
  assert.equal(result.canCancel, false);
  assert.equal(result.canRefund, false);
});

test('provider_rejected bloqueia repeticao destrutiva', () => {
  const result = view({
    orderStatus: 'paid',
    transactionStatus: 'paid',
    registrationStatus: 'authorized',
    reversalRequest: {
      operation: 'refund_full',
      status: 'provider_rejected',
      errorCode: 'REVERSAL_PROVIDER_REJECTED'
    }
  });

  assert.equal(result.reversal.status, 'provider_rejected');
  assert.equal(result.canRefund, false);
});

test('order e transaction divergentes falham fechado', () => {
  assert.throws(
    () => view({
      orderStatus: 'paid',
      transactionStatus: 'pending',
      registrationStatus: 'authorized'
    }),
    error =>
      error instanceof FinancialPurchaseReadDomainError &&
      error.code === 'PURCHASE_ADMIN_CANONICAL_STATE_INVALID'
  );
});

test('view sanitizada nao expoe ids do provider nem estado academico interno', () => {
  const result = view({
    orderStatus: 'paid',
    transactionStatus: 'paid',
    registrationStatus: 'authorized'
  });

  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('payment-admin-read-secret'), false);
  assert.equal(serialized.includes('financialSnapshot'), false);
  assert.equal(serialized.includes('providerCustomerId'), false);
  assert.equal(serialized.includes('attemptId'), false);
  assert.equal(serialized.includes('resultId'), false);
  assert.equal(serialized.includes('certificateId'), false);
});

console.log(
  `FINANCIAL_BELT_EXAM_ADMIN_READ_DOMAIN_V1_2=${passed}/7`
);

if (passed !== 7) {
  process.exitCode = 1;
}