'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const {
  FinancialReversalAdminServiceError,
  createFinancialReversalAdminService
} = require('../src/finance/financial-reversal-admin-service');
const {
  paymentTransactionId
} = require('../src/finance/financial-checkout-persistence');
const {
  enrollmentDocumentId
} = require('../src/courses/course-enrollment-domain');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-finance-reversal-admin';
const app = initializeApp({ projectId }, `reversal-admin-${process.pid}-${Date.now()}`);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;

function id(label) {
  return `revadmin_${label}_${runId}`;
}

function snapshot(courseId, amountCents = 10000) {
  const platformFeeCents = Math.round(amountCents * 0.10);
  const sellerPoolCents = amountCents - platformFeeCents;
  return {
    ruleId: 'platform-default',
    ruleVersion: 1,
    productType: 'course',
    productId: courseId,
    currency: 'BRL',
    grossAmountCents: amountCents,
    platformFeeBps: 1000,
    platformFeeCents,
    sellerPoolCents,
    recipientMode: 'product_owner',
    recipientAllocations: [{
      recipientType: 'platform',
      recipientId: null,
      shareBps: 10000,
      amountCents: sellerPoolCents
    }],
    resolvedAt: new Date('2026-09-19T12:00:00.000Z')
  };
}

function providerStub() {
  const payments = new Map();
  let deleteCalls = 0;
  let refundCalls = 0;
  let refundError = null;

  return {
    payments,
    get deleteCalls() { return deleteCalls; },
    get refundCalls() { return refundCalls; },
    set refundError(value) { refundError = value; },
    async getPaymentById(paymentId) {
      const payment = payments.get(paymentId);
      return payment ? { ...payment } : null;
    },
    async deletePendingPayment(paymentId) {
      deleteCalls += 1;
      const payment = payments.get(paymentId);
      return payment ? { ...payment, status: 'DELETED', deleted: true } : null;
    },
    async requestFullRefund(paymentId, options = {}) {
      refundCalls += 1;
      if (refundError) throw refundError;
      const payment = payments.get(paymentId);
      return payment
        ? {
            ...payment,
            status: 'REFUND_IN_PROGRESS',
            refundDescription: options.description || null
          }
        : null;
    }
  };
}

async function seed({
  label,
  orderStatus,
  transactionStatus,
  enrollmentStatus = null,
  providerStatus,
  amountCents = 10000
}) {
  const buyerUserId = id(`buyer_${label}`);
  const courseId = id(`course_${label}`);
  const orderId = id(`order_${label}`);
  const providerPaymentId = id(`pay_${label}`);
  const providerCustomerId = id(`cus_${label}`);
  const transactionId = paymentTransactionId({ provider: 'asaas', orderId });
  const createdAt = new Date('2026-09-19T12:00:00.000Z');
  const paidAt = orderStatus === 'paid'
    ? new Date('2026-09-19T12:05:00.000Z')
    : null;
  const financialSnapshot = snapshot(courseId, amountCents);

  await db.doc(`orders/${orderId}`).set({
    buyerUserId,
    productType: 'course',
    productId: courseId,
    quantity: 1,
    amountCents,
    currency: 'BRL',
    status: orderStatus,
    financialSnapshot,
    provider: 'asaas',
    providerCustomerId,
    currentTransactionId: transactionId,
    idempotencyKey: id(`intent_${label}`),
    createdAt,
    updatedAt: paidAt || createdAt,
    paidAt,
    cancelledAt: null,
    expiredAt: null,
    refundedAt: null,
    chargebackAt: null
  });

  await db.doc(`payment_transactions/${transactionId}`).set({
    orderId,
    buyerUserId,
    provider: 'asaas',
    providerPaymentId,
    providerStatus,
    status: transactionStatus,
    amountCents,
    currency: 'BRL',
    financialSnapshot,
    providerSplitSnapshot: [],
    createdAt,
    updatedAt: paidAt || createdAt,
    confirmedAt: transactionStatus === 'paid' ? paidAt : null,
    refundedAt: null,
    chargebackAt: null
  });

  let enrollmentId = null;
  if (enrollmentStatus) {
    enrollmentId = enrollmentDocumentId(courseId, buyerUserId);
    await db.doc(`enrollments/${enrollmentId}`).set({
      courseId,
      userId: buyerUserId,
      source: 'order',
      orderId,
      status: enrollmentStatus,
      progressPercent: enrollmentStatus === 'completed' ? 100 : 35,
      startedAt: paidAt,
      completedAt: enrollmentStatus === 'completed'
        ? new Date('2026-09-19T12:20:00.000Z')
        : null,
      createdAt: paidAt,
      updatedAt: paidAt
    });
  }

  return {
    buyerUserId,
    courseId,
    orderId,
    transactionId,
    providerPaymentId,
    providerCustomerId,
    enrollmentId,
    amountCents,
    providerPayment: {
      id: providerPaymentId,
      status: providerStatus,
      billingType: 'PIX',
      externalReference: `BJJEX-V12-ORDER-${orderId}`,
      customer: providerCustomerId,
      value: amountCents / 100
    }
  };
}

function service(provider, clock = () => new Date('2026-09-19T13:00:00.000Z')) {
  return createFinancialReversalAdminService({
    db,
    providerFactory: () => provider,
    environment: 'sandbox',
    clock
  });
}

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

async function count(name) {
  return (await db.collection(name).get()).size;
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
    'audit_logs',
    'financial_reversal_requests',
    'payment_transactions',
    'orders',
    'enrollments',
    'pedidos',
    'matriculas'
  ]) {
    await deleteCollection(name);
  }
  await deleteApp(app);
}

async function main() {
  try {
    await test('finance_admin isolado nao pode operar reversao', async () => {
      const provider = providerStub();
      const state = await seed({
        label: 'rbac',
        orderStatus: 'pending_payment',
        transactionStatus: 'pending',
        providerStatus: 'PENDING'
      });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      await assert.rejects(
        service(provider).cancelPendingPayment({
          actorId: id('finance_admin'),
          claims: { finance_admin: true },
          data: { orderId: state.orderId, reason: 'Cancelamento administrativo' }
        }),
        error => error instanceof FinancialReversalAdminServiceError &&
          error.code === 'FINANCIAL_ADMIN_PERMISSION_REQUIRED'
      );
      assert.equal(provider.deleteCalls, 0);
    });

    await test('platform_admin solicita cancelamento sem mutar estado canonico', async () => {
      const provider = providerStub();
      const state = await seed({
        label: 'cancel',
        orderStatus: 'pending_payment',
        transactionStatus: 'pending',
        providerStatus: 'PENDING'
      });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      const result = await service(provider).cancelPendingPayment({
        actorId: id('platform_admin'),
        claims: { platform_admin: true },
        data: { orderId: state.orderId, reason: 'Compra cancelada pelo suporte' }
      });
      assert.equal(result.status, 'awaiting_webhook');
      assert.equal(result.awaitingWebhook, true);
      assert.equal(result.idempotent, false);
      assert.equal(provider.deleteCalls, 1);
      assert.equal((await db.doc(`orders/${state.orderId}`).get()).data().status, 'pending_payment');
      assert.equal((await db.doc(`payment_transactions/${state.transactionId}`).get()).data().status, 'pending');
      assert.equal(await count('audit_logs'), 1);
    });

    await test('repeticao do cancelamento e idempotente e nao chama provider novamente', async () => {
      const provider = providerStub();
      const state = await seed({
        label: 'cancel_retry',
        orderStatus: 'pending_payment',
        transactionStatus: 'pending',
        providerStatus: 'PENDING'
      });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      const api = service(provider);
      const input = {
        actorId: id('super_admin_cancel_retry'),
        claims: { super_admin: true },
        data: { orderId: state.orderId, reason: 'Solicitação duplicada de cancelamento' }
      };
      const first = await api.cancelPendingPayment(input);
      const second = await api.cancelPendingPayment(input);
      assert.equal(first.requestId, second.requestId);
      assert.equal(second.idempotent, true);
      assert.equal(provider.deleteCalls, 1);
    });

    await test('cancelamento nao aceita pedido ja pago', async () => {
      const provider = providerStub();
      const state = await seed({
        label: 'cancel_paid',
        orderStatus: 'paid',
        transactionStatus: 'paid',
        enrollmentStatus: 'active',
        providerStatus: 'RECEIVED'
      });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      await assert.rejects(
        service(provider).cancelPendingPayment({
          actorId: id('platform_cancel_paid'),
          claims: { platform_admin: true },
          data: { orderId: state.orderId, reason: 'Tentativa incorreta de cancelamento' }
        }),
        error => error instanceof FinancialReversalAdminServiceError &&
          error.code === 'REVERSAL_PENDING_STATE_REQUIRED'
      );
      assert.equal(provider.deleteCalls, 0);
    });

    await test('super_admin solicita estorno integral e aguarda webhook', async () => {
      const provider = providerStub();
      const state = await seed({
        label: 'refund',
        orderStatus: 'paid',
        transactionStatus: 'paid',
        enrollmentStatus: 'active',
        providerStatus: 'RECEIVED'
      });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      const result = await service(provider).requestFullRefund({
        actorId: id('super_refund'),
        claims: { super_admin: true },
        data: { orderId: state.orderId, reason: 'Estorno integral solicitado pelo suporte' }
      });
      assert.equal(result.status, 'awaiting_webhook');
      assert.equal(provider.refundCalls, 1);
      assert.equal((await db.doc(`orders/${state.orderId}`).get()).data().status, 'paid');
      assert.equal((await db.doc(`enrollments/${state.enrollmentId}`).get()).data().status, 'active');
    });

    await test('repeticao do estorno integral nao duplica chamada ao provider', async () => {
      const provider = providerStub();
      const state = await seed({
        label: 'refund_retry',
        orderStatus: 'paid',
        transactionStatus: 'paid',
        enrollmentStatus: 'completed',
        providerStatus: 'CONFIRMED'
      });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      const api = service(provider);
      const input = {
        actorId: id('platform_refund_retry'),
        claims: { platform_admin: true },
        data: { orderId: state.orderId, reason: 'Repetição controlada de estorno' }
      };
      const first = await api.requestFullRefund(input);
      const second = await api.requestFullRefund(input);
      assert.equal(first.requestId, second.requestId);
      assert.equal(second.idempotent, true);
      assert.equal(provider.refundCalls, 1);
    });

    await test('estorno integral exige enrollment pago canonico', async () => {
      const provider = providerStub();
      const state = await seed({
        label: 'refund_no_enrollment',
        orderStatus: 'paid',
        transactionStatus: 'paid',
        enrollmentStatus: null,
        providerStatus: 'RECEIVED'
      });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      await assert.rejects(
        service(provider).requestFullRefund({
          actorId: id('super_no_enrollment'),
          claims: { super_admin: true },
          data: { orderId: state.orderId, reason: 'Estorno sem enrollment nao permitido' }
        }),
        error => error instanceof FinancialReversalAdminServiceError &&
          error.code === 'REVERSAL_PAID_ENROLLMENT_REQUIRED'
      );
      assert.equal(provider.refundCalls, 0);
    });

    await test('identidade divergente no provider falha fechado antes da mutacao', async () => {
      const provider = providerStub();
      const state = await seed({
        label: 'provider_mismatch',
        orderStatus: 'paid',
        transactionStatus: 'paid',
        enrollmentStatus: 'active',
        providerStatus: 'RECEIVED'
      });
      provider.payments.set(state.providerPaymentId, {
        ...state.providerPayment,
        externalReference: 'BJJEX-V12-ORDER-outro'
      });
      await assert.rejects(
        service(provider).requestFullRefund({
          actorId: id('platform_mismatch'),
          claims: { platform_admin: true },
          data: { orderId: state.orderId, reason: 'Validar divergencia de provider' }
        }),
        error => error instanceof FinancialReversalAdminServiceError &&
          error.code === 'REVERSAL_PROVIDER_IDENTITY_MISMATCH'
      );
      assert.equal(provider.refundCalls, 0);
      assert.equal(await count('financial_reversal_requests') >= 1, true);
    });

    await test('falha inconclusiva do provider bloqueia retentativa automatica', async () => {
      const provider = providerStub();
      const state = await seed({
        label: 'provider_timeout',
        orderStatus: 'paid',
        transactionStatus: 'paid',
        enrollmentStatus: 'active',
        providerStatus: 'RECEIVED'
      });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      provider.refundError = new Error('timeout');
      const api = service(provider);
      const input = {
        actorId: id('super_timeout'),
        claims: { super_admin: true },
        data: { orderId: state.orderId, reason: 'Teste de resultado inconclusivo' }
      };
      await assert.rejects(
        api.requestFullRefund(input),
        error => error instanceof FinancialReversalAdminServiceError &&
          error.code === 'REVERSAL_PROVIDER_RESULT_UNKNOWN'
      );
      provider.refundError = null;
      await assert.rejects(
        api.requestFullRefund(input),
        error => error instanceof FinancialReversalAdminServiceError &&
          error.code === 'REVERSAL_REQUEST_REQUIRES_RECONCILIATION'
      );
      assert.equal(provider.refundCalls, 1);
    });

    await test('service permanece sandbox-only e nao escreve colecoes legadas', async () => {
      assert.throws(
        () => createFinancialReversalAdminService({
          db,
          providerFactory: () => providerStub(),
          environment: 'production'
        }),
        error => error instanceof FinancialReversalAdminServiceError &&
          error.code === 'REVERSAL_ADMIN_SANDBOX_ONLY'
      );
      assert.equal(await count('pedidos'), 0);
      assert.equal(await count('matriculas'), 0);
    });

    console.log(`FINANCIAL_REVERSAL_ADMIN_SERVICE_EMULATOR_V1_2=${passed}/10`);
    if (passed !== 10) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  try { await deleteApp(app); } catch (_) {}
});
