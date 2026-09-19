'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const { buildFinancialSnapshot } = require('../src/finance/financial-domain');
const { enrollmentDocumentId } = require('../src/courses/course-enrollment-domain');
const {
  FinancialPurchaseReadServiceError
} = require('../src/finance/financial-purchase-read-service');
const {
  createFinancialStudentPurchaseHistoryService
} = require('../src/finance/financial-student-purchase-history-service');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-finance-student-purchase-history';
const app = initializeApp({ projectId }, `student-history-${process.pid}-${Date.now()}`);
const db = getFirestore(app);
const service = createFinancialStudentPurchaseHistoryService({ db });
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;

function id(label) {
  return `student_history_${label}_${runId}`;
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
  await db.doc(`courses/${courseId}`).set({
    title: `Curso ${label}`,
    description: 'Teste',
    status: 'published',
    visibility: 'public',
    isPaid: true,
    priceCents: 5000,
    currency: 'BRL',
    ownerType: 'platform',
    ownerId: null,
    publishedAt: timestamp(),
    ...overrides
  });
  return courseId;
}

async function seedOrder({
  label,
  userId,
  courseId,
  orderStatus = 'pending_payment',
  transactionStatus = 'pending',
  enrollmentStatus = null,
  createdOffset = 0
}) {
  const orderId = id(`order_${label}`);
  const transactionId = id(`tx_${label}`);
  const providerPaymentId = id(`pay_${label}`);
  const financialSnapshot = snapshot(courseId);
  const createdAt = timestamp(createdOffset);
  const updatedAt = timestamp(createdOffset + 1);
  const paidAt = ['paid', 'refunded', 'chargeback'].includes(orderStatus)
    ? timestamp(createdOffset + 1)
    : null;
  const refundedAt = orderStatus === 'refunded'
    ? timestamp(createdOffset + 2)
    : null;
  const chargebackAt = orderStatus === 'chargeback'
    ? timestamp(createdOffset + 2)
    : null;

  await db.doc(`orders/${orderId}`).set({
    buyerUserId: userId,
    productType: 'course',
    productId: courseId,
    quantity: 1,
    amountCents: 5000,
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
    cancelledAt: orderStatus === 'cancelled' ? updatedAt : null,
    expiredAt: orderStatus === 'expired' ? updatedAt : null,
    refundedAt,
    chargebackAt
  });

  await db.doc(`payment_transactions/${transactionId}`).set({
    orderId,
    buyerUserId: userId,
    provider: 'asaas',
    providerPaymentId,
    providerStatus: transactionStatus.toUpperCase(),
    status: transactionStatus,
    amountCents: 5000,
    currency: 'BRL',
    financialSnapshot,
    providerSplitSnapshot: [],
    createdAt,
    updatedAt,
    confirmedAt: ['paid', 'refunded', 'chargeback'].includes(transactionStatus)
      ? paidAt
      : null,
    refundedAt: transactionStatus === 'refunded' ? refundedAt : null,
    chargebackAt: transactionStatus === 'chargeback' ? chargebackAt : null
  });

  if (enrollmentStatus) {
    await db.doc(`enrollments/${enrollmentDocumentId(courseId, userId)}`).set({
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

  return { orderId, transactionId, providerPaymentId };
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
  for (const name of ['payment_transactions', 'orders', 'enrollments', 'courses']) {
    await deleteCollection(name);
  }
  await deleteApp(app);
}

async function main() {
  try {
    await test('sem pedidos retorna historico vazio', async () => {
      const result = await service.listStudentCoursePurchases({
        userId: id('user_empty'),
        limit: 25
      });
      assert.equal(result.limit, 25);
      assert.deepEqual(result.items, []);
    });

    await test('pending retorna somente view sanitizada', async () => {
      const userId = id('user_pending');
      const courseId = await seedCourse('pending');
      const seeded = await seedOrder({ label: 'pending', userId, courseId });
      const result = await service.listStudentCoursePurchases({ userId });
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].purchaseState, 'payment_pending');
      assert.equal(result.items[0].canResumeCheckout, true);
      const serialized = JSON.stringify(result.items[0]);
      assert.equal(serialized.includes(seeded.orderId), false);
      assert.equal(serialized.includes(seeded.transactionId), false);
      assert.equal(serialized.includes(seeded.providerPaymentId), false);
      assert.equal(serialized.includes('financialSnapshot'), false);
    });

    await test('compra paga com enrollment libera curso', async () => {
      const userId = id('user_paid');
      const courseId = await seedCourse('paid');
      await seedOrder({
        label: 'paid',
        userId,
        courseId,
        orderStatus: 'paid',
        transactionStatus: 'paid',
        enrollmentStatus: 'active',
        createdOffset: 10
      });
      const result = await service.listStudentCoursePurchases({ userId });
      const item = result.items.find(row => row.course.courseId === courseId);
      assert.ok(item);
      assert.equal(item.purchaseState, 'paid_entitled');
      assert.equal(item.canOpenCourse, true);
      assert.equal(item.entitled, true);
    });

    await test('refund de curso arquivado permanece no historico', async () => {
      const userId = id('user_refunded');
      const courseId = await seedCourse('refunded', { status: 'archived' });
      await seedOrder({
        label: 'refunded',
        userId,
        courseId,
        orderStatus: 'refunded',
        transactionStatus: 'refunded',
        enrollmentStatus: 'refunded',
        createdOffset: 20
      });
      const result = await service.listStudentCoursePurchases({ userId });
      const item = result.items.find(row => row.course.courseId === courseId);
      assert.ok(item);
      assert.equal(item.purchaseState, 'refunded');
      assert.equal(item.canStartCheckout, true);
      assert.equal(item.course.title, 'Curso refunded');
    });

    await test('recompra pending ignora enrollment historico de pedido anterior', async () => {
      const userId = id('user_repurchase');
      const courseId = await seedCourse('repurchase');
      await seedOrder({
        label: 'repurchase_old',
        userId,
        courseId,
        orderStatus: 'refunded',
        transactionStatus: 'refunded',
        enrollmentStatus: 'refunded',
        createdOffset: 30
      });
      await seedOrder({
        label: 'repurchase_new',
        userId,
        courseId,
        orderStatus: 'pending_payment',
        transactionStatus: 'pending',
        createdOffset: 40
      });
      const result = await service.listStudentCoursePurchases({ userId });
      assert.equal(result.items.length, 2);
      assert.equal(result.items[0].purchaseState, 'payment_pending');
      assert.equal(result.items[0].enrollmentStatus, null);
      assert.equal(result.items[1].purchaseState, 'refunded');
      assert.equal(result.items[1].enrollmentStatus, 'refunded');
    });

    await test('limite fora do contrato e rejeitado', async () => {
      await assert.rejects(
        () => service.listStudentCoursePurchases({
          userId: id('user_limit'),
          limit: 51
        }),
        error => error instanceof FinancialPurchaseReadServiceError &&
          error.code === 'INVALID_PURCHASE_STUDENT_LIMIT'
      );
    });

    console.log(`FINANCIAL_STUDENT_PURCHASE_HISTORY_SERVICE_EMULATOR_V1_2=${passed}/6`);
    if (passed !== 6) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  try { await cleanup(); } catch (_) {}
});
