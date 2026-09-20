'use strict';

const assert = require('node:assert/strict');

const {
  buildFinancialSnapshot,
  validateOrder,
  validateTransaction
} = require('../src/finance/financial-domain');
const {
  validateEnrollment
} = require('../src/courses/course-enrollment-domain');
const {
  FinancialPurchaseReadDomainError,
  resolveStudentPurchaseState,
  resolveAdminPurchaseOperations,
  buildAdminPurchaseView
} = require('../src/finance/financial-purchase-read-domain');

const NOW = new Date('2026-09-19T18:00:00.000Z');
const LATER = new Date('2026-09-19T18:05:00.000Z');
const COURSE_ID = 'course-read-model-1';
const USER_ID = 'student-read-model-1';
const ORDER_ID = 'order-read-model-1';
const TX_ID = 'tx-read-model-1';
let passed = 0;

const course = Object.freeze({
  title: 'Curso de leitura financeira',
  status: 'published',
  isPaid: true,
  priceCents: 5000,
  currency: 'BRL'
});

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
    productType: 'course',
    productId: COURSE_ID,
    ownerType: 'platform',
    ownerId: null,
    currency: 'BRL'
  },
  grossAmountCents: 5000,
  currency: 'BRL',
  resolvedAt: NOW
});

function order(status, overrides = {}) {
  const currentTransactionId = overrides.currentTransactionId === undefined
    ? TX_ID
    : overrides.currentTransactionId;
  return validateOrder({
    buyerUserId: USER_ID,
    productType: 'course',
    productId: COURSE_ID,
    quantity: 1,
    amountCents: 5000,
    currency: 'BRL',
    status,
    financialSnapshot: snapshot,
    provider: currentTransactionId ? 'asaas' : null,
    providerCustomerId: currentTransactionId ? 'customer-read-model-1' : null,
    currentTransactionId,
    idempotencyKey: 'purchase-read-model-key',
    createdAt: NOW,
    updatedAt: LATER,
    paidAt: ['paid', 'refunded', 'chargeback'].includes(status) ? NOW : null,
    cancelledAt: status === 'cancelled' ? LATER : null,
    expiredAt: status === 'expired' ? LATER : null,
    refundedAt: status === 'refunded' ? LATER : null,
    chargebackAt: status === 'chargeback' ? LATER : null,
    ...overrides
  });
}

function transaction(status, overrides = {}) {
  return validateTransaction({
    orderId: ORDER_ID,
    buyerUserId: USER_ID,
    provider: 'asaas',
    providerPaymentId: status === 'created' ? null : 'pay-read-model-1',
    providerStatus: status.toUpperCase(),
    status,
    amountCents: 5000,
    currency: 'BRL',
    financialSnapshot: snapshot,
    providerSplitSnapshot: [],
    createdAt: NOW,
    updatedAt: LATER,
    confirmedAt: ['paid', 'refunded', 'chargeback'].includes(status) ? NOW : null,
    refundedAt: status === 'refunded' ? LATER : null,
    chargebackAt: status === 'chargeback' ? LATER : null,
    ...overrides
  });
}

function enrollment(status = 'active', overrides = {}) {
  return validateEnrollment({
    courseId: COURSE_ID,
    userId: USER_ID,
    source: 'order',
    orderId: ORDER_ID,
    status,
    progressPercent: status === 'completed' ? 100 : 25,
    startedAt: NOW,
    completedAt: status === 'completed' ? LATER : null,
    createdAt: NOW,
    updatedAt: LATER,
    ...overrides
  });
}

function studentState({
  orderStatus = null,
  txStatus = null,
  enrollmentValue = null,
  orderValue = null,
  transactionValue = null,
  courseValue = course
} = {}) {
  return resolveStudentPurchaseState({
    courseId: COURSE_ID,
    userId: USER_ID,
    course: courseValue,
    orderId: orderStatus || orderValue ? ORDER_ID : null,
    order: orderValue || (orderStatus ? order(orderStatus) : null),
    transactionId: txStatus || transactionValue ? TX_ID : null,
    transaction: transactionValue || (txStatus ? transaction(txStatus) : null),
    enrollment: enrollmentValue
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

test('sem pedido retorna available_for_purchase', () => {
  const result = studentState();
  assert.equal(result.purchaseState, 'available_for_purchase');
  assert.equal(result.canStartCheckout, true);
  assert.equal(result.canOpenCourse, false);
  assert.equal(result.orderStatus, null);
});

test('admin grant ativo em curso pago retorna granted_entitled', () => {
  const grant = enrollment('active', { source: 'admin_grant', orderId: null });
  const result = studentState({ enrollmentValue: grant });
  assert.equal(result.purchaseState, 'granted_entitled');
  assert.equal(result.entitled, true);
  assert.equal(result.canStartCheckout, false);
  assert.equal(result.canOpenCourse, true);
});

test('pending/pending retorna payment_pending sem entitlement', () => {
  const result = studentState({ orderStatus: 'pending_payment', txStatus: 'pending' });
  assert.equal(result.purchaseState, 'payment_pending');
  assert.equal(result.canStartCheckout, false);
  assert.equal(result.canOpenCourse, false);
});

test('pedido pending ainda sem transacao permanece payment_pending', () => {
  const result = studentState({
    orderValue: order('pending_payment', { currentTransactionId: null })
  });
  assert.equal(result.purchaseState, 'payment_pending');
  assert.equal(result.transactionStatus, null);
});

test('paid/paid com enrollment ativo retorna paid_entitled', () => {
  const result = studentState({
    orderStatus: 'paid',
    txStatus: 'paid',
    enrollmentValue: enrollment('active')
  });
  assert.equal(result.purchaseState, 'paid_entitled');
  assert.equal(result.entitled, true);
  assert.equal(result.canOpenCourse, true);
  assert.equal(result.requiresOperationalReview, false);
});

test('paid/paid sem enrollment falha fechado como access pending', () => {
  const result = studentState({ orderStatus: 'paid', txStatus: 'paid' });
  assert.equal(result.purchaseState, 'payment_confirmed_access_pending');
  assert.equal(result.entitled, false);
  assert.equal(result.canOpenCourse, false);
  assert.equal(result.requiresOperationalReview, true);
});

test('refund revoga acesso no read model', () => {
  const result = studentState({
    orderStatus: 'refunded',
    txStatus: 'refunded',
    enrollmentValue: enrollment('refunded')
  });
  assert.equal(result.purchaseState, 'refunded');
  assert.equal(result.entitled, false);
  assert.equal(result.canOpenCourse, false);
});

test('chargeback revoga acesso no read model', () => {
  const result = studentState({
    orderStatus: 'chargeback',
    txStatus: 'chargeback',
    enrollmentValue: enrollment('chargeback')
  });
  assert.equal(result.purchaseState, 'chargeback');
  assert.equal(result.entitled, false);
});

test('cancelado permite nova tentativa de checkout', () => {
  const result = studentState({ orderStatus: 'cancelled', txStatus: 'cancelled' });
  assert.equal(result.purchaseState, 'cancelled_or_expired');
  assert.equal(result.canStartCheckout, true);
});

test('estado divergente entre order e transaction falha fechado', () => {
  assert.throws(
    () => studentState({ orderStatus: 'paid', txStatus: 'pending' }),
    error => error instanceof FinancialPurchaseReadDomainError && error.code === 'PURCHASE_FINANCIAL_STATE_MISMATCH'
  );
});

test('enrollment pago de outro pedido falha fechado', () => {
  assert.throws(
    () => studentState({
      orderStatus: 'paid',
      txStatus: 'paid',
      enrollmentValue: enrollment('active', { orderId: 'other-order' })
    }),
    error => error instanceof FinancialPurchaseReadDomainError && error.code === 'PURCHASE_ENROLLMENT_ORDER_MISMATCH'
  );
});

test('curso gratuito nao entra no read model financeiro', () => {
  assert.throws(
    () => studentState({ courseValue: { ...course, isPaid: false, priceCents: 0 } }),
    error => error instanceof FinancialPurchaseReadDomainError && error.code === 'PURCHASE_COURSE_NOT_PAID'
  );
});

test('admin pode cancelar apenas cobranca pendente vinculada ao provider', () => {
  const operations = resolveAdminPurchaseOperations({
    order: order('pending_payment'),
    transaction: transaction('pending'),
    enrollment: null
  });
  assert.equal(operations.canCancel, true);
  assert.equal(operations.canRefund, false);
});

test('admin pode solicitar refund somente de compra paga com entitlement', () => {
  const operations = resolveAdminPurchaseOperations({
    order: order('paid'),
    transaction: transaction('paid'),
    enrollment: enrollment('active')
  });
  assert.equal(operations.canCancel, false);
  assert.equal(operations.canRefund, true);
});

test('reversal awaiting_webhook bloqueia nova acao destrutiva', () => {
  const operations = resolveAdminPurchaseOperations({
    order: order('paid'),
    transaction: transaction('paid'),
    enrollment: enrollment('active'),
    reversalRequest: {
      operation: 'refund_full',
      status: 'awaiting_webhook'
    }
  });
  assert.equal(operations.canRefund, false);
  assert.equal(operations.reversalInProgress, true);
});

test('needs_reconciliation aparece explicitamente na view admin', () => {
  const view = buildAdminPurchaseView({
    orderId: ORDER_ID,
    order: order('paid'),
    transactionId: TX_ID,
    transaction: transaction('paid'),
    enrollment: enrollment('active'),
    reversalRequestId: 'reversal-request-1',
    reversalRequest: {
      operation: 'refund_full',
      status: 'needs_reconciliation',
      providerLifecycleStatus: 'denied',
      errorCode: 'REVERSAL_PROVIDER_REFUND_DENIED',
      updatedAt: LATER
    }
  });
  assert.equal(view.needsReconciliation, true);
  assert.equal(view.reversal.status, 'needs_reconciliation');
  assert.equal(view.reversal.providerLifecycleStatus, 'denied');
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'providerPaymentId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'financialSnapshot'), false);
});

console.log(`FINANCIAL_PURCHASE_READ_DOMAIN_V1_2=${passed}/16`);
if (passed !== 16) process.exitCode = 1;
