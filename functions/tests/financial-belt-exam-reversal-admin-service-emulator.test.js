'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const {
  FinancialBeltExamReversalAdminServiceError,
  createFinancialBeltExamReversalAdminService
} = require('../src/finance/financial-belt-exam-reversal-admin-service');
const {
  paymentTransactionId
} = require('../src/finance/financial-checkout-persistence');
const {
  examRegistrationDocumentId
} = require('../src/exams/exam-registration-domain');
const {
  reversalRequestId
} = require('../src/finance/financial-reversal-admin-service');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}
assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-belt-exam-reversal-admin';
const app = initializeApp(
  { projectId },
  `belt-exam-reversal-admin-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;

function id(label) {
  return `beltexamrevadmin_${label}_${runId}`;
}

function snapshot(sessionId, organizationId, amountCents = 5000) {
  const platformFeeCents = Math.round(amountCents * 0.10);
  return {
    ruleId: 'platform-default',
    ruleVersion: 1,
    productType: 'belt_exam',
    productId: sessionId,
    currency: 'BRL',
    grossAmountCents: amountCents,
    platformFeeBps: 1000,
    platformFeeCents,
    sellerPoolCents: amountCents - platformFeeCents,
    recipientMode: 'product_owner',
    recipientAllocations: [{
      recipientType: 'organization',
      recipientId: organizationId,
      shareBps: 10000,
      amountCents: amountCents - platformFeeCents
    }],
    resolvedAt: new Date('2026-09-20T05:00:00.000Z')
  };
}

function providerStub() {
  const payments = new Map();
  let getCalls = 0;
  let deleteCalls = 0;
  let refundCalls = 0;
  let deleteError = null;
  let refundError = null;

  return {
    payments,
    get getCalls() { return getCalls; },
    get deleteCalls() { return deleteCalls; },
    get refundCalls() { return refundCalls; },
    set deleteError(value) { deleteError = value; },
    set refundError(value) { refundError = value; },
    async getPaymentById(paymentId) {
      getCalls += 1;
      const payment = payments.get(paymentId);
      return payment ? { ...payment } : null;
    },
    async deletePendingPayment(paymentId) {
      deleteCalls += 1;
      if (deleteError) throw deleteError;
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
  orderStatus = 'paid',
  registrationStatus = orderStatus === 'pending_payment'
    ? 'awaiting_payment'
    : 'authorized',
  providerStatus = orderStatus === 'pending_payment' ? 'PENDING' : 'RECEIVED',
  attemptId = null,
  amountCents = 5000
}) {
  const buyerUserId = id(`buyer_${label}`);
  const sessionId = id(`session_${label}`);
  const organizationId = id(`org_${label}`);
  const orderId = id(`order_${label}`);
  const transactionId = paymentTransactionId({ provider: 'asaas', orderId });
  const providerPaymentId = id(`pay_${label}`);
  const providerCustomerId = id(`cus_${label}`);
  const registrationId = examRegistrationDocumentId({
    sessionId,
    studentId: buyerUserId
  });
  const createdAt = new Date('2026-09-20T05:00:00.000Z');
  const paidAt = orderStatus === 'paid'
    ? new Date('2026-09-20T05:05:00.000Z')
    : null;
  const financialSnapshot = snapshot(sessionId, organizationId, amountCents);
  const transactionStatus = orderStatus === 'pending_payment' ? 'pending' : 'paid';
  const academic = ['started', 'submitted', 'passed', 'failed', 'certified']
    .includes(registrationStatus);

  await db.doc(`orders/${orderId}`).set({
    buyerUserId,
    productType: 'belt_exam',
    productId: sessionId,
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

  await db.doc(`exam_registrations/${registrationId}`).set({
    sessionId,
    organizationId,
    studentId: buyerUserId,
    instructorId: id(`instructor_${label}`),
    currentBelt: 'Branca',
    targetBelt: 'Azul',
    membershipId: id(`membership_${label}`),
    status: registrationStatus,
    orderId,
    attemptId: academic ? (attemptId || id(`attempt_${label}`)) : null,
    resultId: null,
    certificateId: null,
    selectedAt: createdAt,
    paidAt,
    authorizedAt: paidAt,
    cancelledAt: null,
    updatedAt: paidAt || createdAt
  });

  return {
    orderId,
    transactionId,
    providerPaymentId,
    providerCustomerId,
    registrationId,
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

function service(provider) {
  return createFinancialBeltExamReversalAdminService({
    db,
    providerFactory: () => provider,
    environment: 'sandbox',
    clock: () => new Date('2026-09-20T06:00:00.000Z')
  });
}

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
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
    'exam_registrations'
  ]) {
    await deleteCollection(name);
  }
  await deleteApp(app);
}

async function main() {
  try {
    await test('finance_admin isolado nao opera reversao belt_exam', async () => {
      const provider = providerStub();
      const state = await seed({ label: 'rbac', orderStatus: 'pending_payment' });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      await assert.rejects(
        service(provider).cancelPendingPayment({
          actorId: id('finance_admin'),
          claims: { finance_admin: true },
          data: { orderId: state.orderId, reason: 'Cancelamento administrativo' }
        }),
        error => error instanceof FinancialBeltExamReversalAdminServiceError &&
          error.code === 'FINANCIAL_ADMIN_PERMISSION_REQUIRED'
      );
      assert.equal(provider.getCalls, 0);
      assert.equal(provider.deleteCalls, 0);
    });

    await test('cancelamento pending solicita provider sem mutar registration localmente', async () => {
      const provider = providerStub();
      const state = await seed({ label: 'cancel', orderStatus: 'pending_payment' });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      const result = await service(provider).cancelPendingPayment({
        actorId: id('platform_cancel'),
        claims: { platform_admin: true },
        data: { orderId: state.orderId, reason: 'Cancelamento solicitado pelo suporte' }
      });
      assert.equal(result.status, 'awaiting_webhook');
      assert.equal(result.awaitingWebhook, true);
      assert.equal(result.providerPaymentId, undefined);
      assert.equal(provider.deleteCalls, 1);
      assert.equal((await db.doc(`orders/${state.orderId}`).get()).data().status, 'pending_payment');
      assert.equal((await db.doc(`exam_registrations/${state.registrationId}`).get()).data().status, 'awaiting_payment');
    });

    await test('retry de cancelamento e idempotente antes de consultar provider', async () => {
      const provider = providerStub();
      const state = await seed({ label: 'cancel_retry', orderStatus: 'pending_payment' });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      const api = service(provider);
      const input = {
        actorId: id('super_cancel_retry'),
        claims: { super_admin: true },
        data: { orderId: state.orderId, reason: 'Repeticao controlada de cancelamento' }
      };
      const first = await api.cancelPendingPayment(input);
      const getCallsAfterFirst = provider.getCalls;
      const second = await api.cancelPendingPayment(input);
      assert.equal(first.requestId, second.requestId);
      assert.equal(second.idempotent, true);
      assert.equal(provider.getCalls, getCallsAfterFirst);
      assert.equal(provider.deleteCalls, 1);
    });

    await test('refund authorized solicita provider sem revogar registration antes do webhook', async () => {
      const provider = providerStub();
      const state = await seed({ label: 'refund' });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      const result = await service(provider).requestFullRefund({
        actorId: id('super_refund'),
        claims: { super_admin: true },
        data: { orderId: state.orderId, reason: 'Estorno integral antes da prova' }
      });
      assert.equal(result.status, 'awaiting_webhook');
      assert.equal(result.providerPaymentId, undefined);
      assert.equal(provider.refundCalls, 1);
      assert.equal((await db.doc(`orders/${state.orderId}`).get()).data().status, 'paid');
      assert.equal((await db.doc(`exam_registrations/${state.registrationId}`).get()).data().status, 'authorized');
    });

    await test('refund de exame iniciado e bloqueado antes de consultar provider', async () => {
      const provider = providerStub();
      const state = await seed({
        label: 'started',
        registrationStatus: 'started',
        attemptId: id('attempt_started')
      });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      await assert.rejects(
        service(provider).requestFullRefund({
          actorId: id('platform_started'),
          claims: { platform_admin: true },
          data: { orderId: state.orderId, reason: 'Nao deve estornar prova iniciada' }
        }),
        error => error instanceof FinancialBeltExamReversalAdminServiceError &&
          error.code === 'BELT_EXAM_ADMIN_REFUND_ACADEMIC_ACTIVITY'
      );
      assert.equal(provider.getCalls, 0);
      assert.equal(provider.refundCalls, 0);
      assert.equal((await db.doc(`exam_registrations/${state.registrationId}`).get()).data().status, 'started');
    });

    await test('identidade divergente do provider falha fechado', async () => {
      const provider = providerStub();
      const state = await seed({ label: 'mismatch' });
      provider.payments.set(state.providerPaymentId, {
        ...state.providerPayment,
        externalReference: 'BJJEX-V12-ORDER-outro'
      });
      await assert.rejects(
        service(provider).requestFullRefund({
          actorId: id('platform_mismatch'),
          claims: { platform_admin: true },
          data: { orderId: state.orderId, reason: 'Validar identidade da cobranca' }
        }),
        error => error instanceof FinancialBeltExamReversalAdminServiceError &&
          error.code === 'REVERSAL_PROVIDER_IDENTITY_MISMATCH'
      );
      assert.equal(provider.refundCalls, 0);
      assert.equal((await db.doc(`orders/${state.orderId}`).get()).data().status, 'paid');
    });

    await test('rejeicao 4xx do provider vira provider_rejected sem mutacao canonica', async () => {
      const provider = providerStub();
      const state = await seed({ label: 'provider_4xx' });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      const providerError = new Error('refund rejected');
      providerError.response = { status: 400 };
      provider.refundError = providerError;
      await assert.rejects(
        service(provider).requestFullRefund({
          actorId: id('super_4xx'),
          claims: { super_admin: true },
          data: { orderId: state.orderId, reason: 'Teste de rejeicao controlada' }
        }),
        error => error instanceof FinancialBeltExamReversalAdminServiceError &&
          error.code === 'REVERSAL_PROVIDER_REJECTED'
      );
      const requestId = reversalRequestId({
        operation: 'refund_full',
        transactionId: state.transactionId
      });
      assert.equal((await db.doc(`financial_reversal_requests/${requestId}`).get()).data().status, 'provider_rejected');
      assert.equal((await db.doc(`orders/${state.orderId}`).get()).data().status, 'paid');
      assert.equal((await db.doc(`exam_registrations/${state.registrationId}`).get()).data().status, 'authorized');
    });

    await test('falha inconclusiva do provider exige reconciliacao e bloqueia retry destrutivo', async () => {
      const provider = providerStub();
      const state = await seed({ label: 'provider_unknown' });
      provider.payments.set(state.providerPaymentId, state.providerPayment);
      provider.refundError = new Error('timeout');
      const api = service(provider);
      const input = {
        actorId: id('super_unknown'),
        claims: { super_admin: true },
        data: { orderId: state.orderId, reason: 'Teste de resultado inconclusivo' }
      };
      await assert.rejects(
        api.requestFullRefund(input),
        error => error instanceof FinancialBeltExamReversalAdminServiceError &&
          error.code === 'REVERSAL_PROVIDER_RESULT_UNKNOWN'
      );
      await assert.rejects(
        api.requestFullRefund(input),
        error => error instanceof FinancialBeltExamReversalAdminServiceError &&
          error.code === 'REVERSAL_REQUEST_REQUIRES_RECONCILIATION'
      );
      assert.equal(provider.refundCalls, 1);
      const requestId = reversalRequestId({
        operation: 'refund_full',
        transactionId: state.transactionId
      });
      assert.equal((await db.doc(`financial_reversal_requests/${requestId}`).get()).data().status, 'needs_reconciliation');
      assert.equal((await db.doc(`exam_registrations/${state.registrationId}`).get()).data().status, 'authorized');
    });

    console.log(`BELT_EXAM_REVERSAL_ADMIN_SERVICE_EMULATOR_V1_2=${passed}/8`);
    if (passed !== 8) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error.stack || error);
  process.exitCode = 1;
  try { await deleteApp(app); } catch (_) {}
});
