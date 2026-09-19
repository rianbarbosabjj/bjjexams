'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const {
  buildFinancialSnapshot
} = require('../src/finance/financial-domain');
const {
  enrollmentDocumentId
} = require('../src/courses/course-enrollment-domain');
const {
  reversalRequestId,
  REVERSAL_REQUESTS_COLLECTION
} = require('../src/finance/financial-reversal-admin-service');
const {
  FinancialPurchaseReadServiceError,
  createFinancialPurchaseReadService
} = require('../src/finance/financial-purchase-read-service');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-finance-purchase-read-service';
const app = initializeApp(
  { projectId },
  `purchase-read-service-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const service = createFinancialPurchaseReadService({ db });
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;
let sequence = 0;

function id(label) {
  return `purchase_read_${label}_${runId}`;
}

function timestamp(offsetMinutes = 0) {
  return new Date(Date.parse('2026-09-19T20:00:00.000Z') + offsetMinutes * 60000);
}

function snapshot(courseId, amountCents = 5000) {
  return buildFinancialSnapshot({
    rule: {
      id: 'platform-default',
      name: 'Regra padrao',
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
      createdAt: timestamp(),
      updatedAt: timestamp()
    },
    product: {
      productType: 'course',
      productId: courseId,
      ownerType: 'platform',
      ownerId: null,
      currency: 'BRL'
    },
    grossAmountCents: amountCents,
    currency: 'BRL',
    resolvedAt: timestamp()
  });
}

async function seedCourse(label, overrides = {}) {
  const courseId = id(`course_${label}`);
  const course = {
    title: `Curso ${label}`,
    description: 'Curso de teste',
    status: 'published',
    visibility: 'public',
    isPaid: true,
    priceCents: 5000,
    currency: 'BRL',
    ownerType: 'platform',
    ownerId: null,
    publishedAt: timestamp(),
    ...overrides
  };
  await db.doc(`courses/${courseId}`).set(course);
  return { courseId, course };
}

async function seedUser(label, overrides = {}) {
  const userId = id(`user_${label}`);
  await db.doc(`usuarios/${userId}`).set({
    nome: `Aluno ${label}`,
    email: `${userId}@example.test`,
    cpf: '12345678909',
    telefone: '21999999999',
    status_conta: 'ativo',
    ...overrides
  });
  return userId;
}

async function seedOrder({
  label,
  userId,
  courseId,
  orderStatus = 'pending_payment',
  transactionStatus = 'pending',
  enrollmentStatus = null,
  createdOffset = 0,
  providerPayment = true
}) {
  const orderId = id(`order_${label}`);
  const transactionId = id(`tx_${label}`);
  const amountCents = 5000;
  const financialSnapshot = snapshot(courseId, amountCents);
  const createdAt = timestamp(createdOffset);
  const updatedAt = timestamp(createdOffset + 1);
  const paidAt = ['paid', 'refunded', 'chargeback'].includes(orderStatus)
    ? timestamp(createdOffset + 1)
    : null;
  const cancelledAt = orderStatus === 'cancelled' ? updatedAt : null;
  const expiredAt = orderStatus === 'expired' ? updatedAt : null;
  const refundedAt = orderStatus === 'refunded' ? timestamp(createdOffset + 2) : null;
  const chargebackAt = orderStatus === 'chargeback' ? timestamp(createdOffset + 2) : null;
  const providerPaymentId = providerPayment ? id(`pay_${label}`) : null;

  await db.doc(`orders/${orderId}`).set({
    buyerUserId: userId,
    productType: 'course',
    productId: courseId,
    quantity: 1,
    amountCents,
    currency: 'BRL',
    status: orderStatus,
    financialSnapshot,
    provider: 'asaas',
    providerCustomerId: id(`customer_${label}`),
    currentTransactionId: transactionId,
    idempotencyKey: id(`intent_${label}`),
    createdAt,
    updatedAt,
    paidAt,
    cancelledAt,
    expiredAt,
    refundedAt,
    chargebackAt
  });

  await db.doc(`payment_transactions/${transactionId}`).set({
    orderId,
    buyerUserId: userId,
    provider: 'asaas',
    providerPaymentId,
    providerStatus: orderStatus === 'paid' ? 'RECEIVED' : transactionStatus.toUpperCase(),
    status: transactionStatus,
    amountCents,
    currency: 'BRL',
    financialSnapshot,
    providerSplitSnapshot: [],
    createdAt,
    updatedAt,
    confirmedAt: ['paid', 'refunded', 'chargeback'].includes(transactionStatus) ? paidAt : null,
    refundedAt: transactionStatus === 'refunded' ? refundedAt : null,
    chargebackAt: transactionStatus === 'chargeback' ? chargebackAt : null
  });

  let enrollmentId = null;
  if (enrollmentStatus) {
    enrollmentId = enrollmentDocumentId(courseId, userId);
    await db.doc(`enrollments/${enrollmentId}`).set({
      courseId,
      userId,
      source: 'order',
      orderId,
      status: enrollmentStatus,
      progressPercent: enrollmentStatus === 'completed' ? 100 : 30,
      startedAt: paidAt || createdAt,
      completedAt: enrollmentStatus === 'completed' ? timestamp(createdOffset + 3) : null,
      createdAt: paidAt || createdAt,
      updatedAt
    });
  }

  sequence += 1;
  return { orderId, transactionId, providerPaymentId, enrollmentId };
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}

async function deleteCollection(name) {
  const snap = await db.collection(name).get();
  for (let offset = 0; offset < snap.docs.length; offset += 400) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(offset, offset + 400)) batch.delete(doc.ref);
    await batch.commit();
  }
}

async function cleanup() {
  for (const name of [
    REVERSAL_REQUESTS_COLLECTION,
    'payment_transactions',
    'orders',
    'enrollments',
    'courses',
    'usuarios'
  ]) {
    await deleteCollection(name);
  }
  await deleteApp(app);
}

async function main() {
  try {
    await test('aluno sem pedido recebe available_for_purchase', async () => {
      const userId = await seedUser('available');
      const { courseId } = await seedCourse('available');
      const result = await service.getStudentCoursePurchase({ userId, courseId });
      assert.equal(result.purchaseState, 'available_for_purchase');
      assert.equal(result.canStartCheckout, true);
      assert.equal(result.payment, null);
      assert.equal(Object.prototype.hasOwnProperty.call(result, 'orderId'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(result, 'providerPaymentId'), false);
    });

    await test('pending expõe apenas sinal sanitizado de PIX', async () => {
      const userId = await seedUser('pending');
      const { courseId } = await seedCourse('pending');
      await seedOrder({ label: 'pending', userId, courseId });
      const result = await service.getStudentCoursePurchase({ userId, courseId });
      assert.equal(result.purchaseState, 'payment_pending');
      assert.deepEqual(result.payment, { method: 'PIX', ready: true });
      assert.equal(result.canResumeCheckout, true);
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes('providerPaymentId'), false);
      assert.equal(serialized.includes('financialSnapshot'), false);
      assert.equal(serialized.includes('cpf'), false);
    });

    await test('compra paga com enrollment concede paid_entitled', async () => {
      const userId = await seedUser('paid');
      const { courseId } = await seedCourse('paid');
      await seedOrder({
        label: 'paid',
        userId,
        courseId,
        orderStatus: 'paid',
        transactionStatus: 'paid',
        enrollmentStatus: 'active'
      });
      const result = await service.getStudentCoursePurchase({ userId, courseId });
      assert.equal(result.purchaseState, 'paid_entitled');
      assert.equal(result.entitled, true);
      assert.equal(result.canOpenCourse, true);
      assert.equal(result.payment, null);
    });

    await test('nova tentativa pending supera enrollment historico refunded', async () => {
      const userId = await seedUser('repurchase');
      const { courseId } = await seedCourse('repurchase');
      await seedOrder({
        label: 'repurchase_old',
        userId,
        courseId,
        orderStatus: 'refunded',
        transactionStatus: 'refunded',
        enrollmentStatus: 'refunded',
        createdOffset: 0
      });
      await seedOrder({
        label: 'repurchase_new',
        userId,
        courseId,
        orderStatus: 'pending_payment',
        transactionStatus: 'pending',
        createdOffset: 10
      });
      const result = await service.getStudentCoursePurchase({ userId, courseId });
      assert.equal(result.purchaseState, 'payment_pending');
      assert.equal(result.canResumeCheckout, true);
      assert.equal(result.enrollmentStatus, null);
    });

    await test('admin sem claim financeiro é bloqueado', async () => {
      await assert.rejects(
        () => service.listAdminCoursePurchases({ claims: { content_admin: true }, limit: 10 }),
        error => error instanceof FinancialPurchaseReadServiceError &&
          error.code === 'FINANCIAL_ADMIN_PERMISSION_REQUIRED'
      );
    });

    await test('admin recebe view sanitizada e flags de cancelamento', async () => {
      const userId = await seedUser('admin_pending');
      const { courseId } = await seedCourse('admin_pending');
      const seeded = await seedOrder({ label: 'admin_pending', userId, courseId });
      const result = await service.listAdminCoursePurchases({
        claims: { platform_admin: true },
        limit: 50
      });
      const row = result.items.find(item => item.orderId === seeded.orderId);
      assert.ok(row);
      assert.equal(row.canCancel, true);
      assert.equal(row.canRefund, false);
      assert.equal(row.buyer.userId, userId);
      assert.equal(row.course.courseId, courseId);
      const serialized = JSON.stringify(row);
      assert.equal(serialized.includes(seeded.providerPaymentId), false);
      assert.equal(serialized.includes('financialSnapshot'), false);
      assert.equal(serialized.includes('recipientAllocations'), false);
      assert.equal(serialized.includes('12345678909'), false);
    });

    await test('needs_reconciliation é priorizado na view administrativa', async () => {
      const userId = await seedUser('reconcile');
      const { courseId } = await seedCourse('reconcile');
      const seeded = await seedOrder({
        label: 'reconcile',
        userId,
        courseId,
        orderStatus: 'paid',
        transactionStatus: 'paid',
        enrollmentStatus: 'active',
        createdOffset: 20
      });
      const requestId = reversalRequestId({
        operation: 'refund_full',
        transactionId: seeded.transactionId
      });
      await db.doc(`${REVERSAL_REQUESTS_COLLECTION}/${requestId}`).set({
        operation: 'refund_full',
        orderId: seeded.orderId,
        transactionId: seeded.transactionId,
        provider: 'asaas',
        providerPaymentId: seeded.providerPaymentId,
        status: 'needs_reconciliation',
        providerLifecycleStatus: 'denied',
        errorCode: 'REVERSAL_PROVIDER_REFUND_DENIED',
        createdAt: timestamp(22),
        updatedAt: timestamp(23),
        reconciliationRequiredAt: timestamp(23)
      });
      const result = await service.listAdminCoursePurchases({
        claims: { super_admin: true },
        limit: 50
      });
      const row = result.items.find(item => item.orderId === seeded.orderId);
      assert.ok(row);
      assert.equal(row.needsReconciliation, true);
      assert.equal(row.reversal.status, 'needs_reconciliation');
      assert.equal(row.reversal.providerLifecycleStatus, 'denied');
      assert.equal(JSON.stringify(row).includes(seeded.providerPaymentId), false);
    });

    console.log(`FINANCIAL_PURCHASE_READ_SERVICE_EMULATOR_V1_2=${passed}/7`);
    if (passed !== 7) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  try { await cleanup(); } catch (_) {}
});
