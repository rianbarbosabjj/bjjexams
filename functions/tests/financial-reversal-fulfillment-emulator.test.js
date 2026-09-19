'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const {
  buildFinancialSnapshot
} = require('../src/finance/financial-domain');
const {
  paymentExternalReference
} = require('../src/finance/asaas-checkout-adapter');
const {
  paymentTransactionId
} = require('../src/finance/financial-checkout-persistence');
const {
  createFinancialWebhookPersistence
} = require('../src/finance/financial-webhook-persistence');
const {
  RECOVERY_COLLECTION,
  FinancialReversalFulfillmentError,
  createFinancialReversalFulfillment
} = require('../src/finance/financial-reversal-fulfillment');
const {
  enrollmentDocumentId
} = require('../src/courses/course-enrollment-domain');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-finance-reversal-fulfillment';
const app = initializeApp(
  { projectId },
  `financial-reversal-fulfillment-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;
let tick = 0;

function id(label) {
  return `${label}_${runId}`;
}

function now() {
  const value = new Date(Date.parse('2026-09-19T04:00:00.000Z') + tick * 1000);
  tick += 1;
  return value;
}

function financialSnapshot(courseId, amountCents = 10000) {
  return buildFinancialSnapshot({
    rule: {
      id: 'platform-default',
      name: 'Regra padrao da plataforma',
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
      createdAt: new Date('2026-09-18T10:00:00.000Z'),
      updatedAt: new Date('2026-09-18T10:00:00.000Z')
    },
    product: {
      productType: 'course',
      productId: courseId,
      financialRuleId: null,
      ownerType: 'platform',
      ownerId: null,
      currency: 'BRL'
    },
    grossAmountCents: amountCents,
    currency: 'BRL',
    resolvedAt: new Date('2026-09-18T10:00:00.000Z')
  });
}

async function seedState({
  label,
  orderStatus = 'paid',
  transactionStatus = orderStatus === 'pending_payment' ? 'pending' : orderStatus,
  enrollmentStatus = orderStatus === 'pending_payment' ? null : 'active',
  progressPercent = 42,
  completedAt = null,
  amountCents = 10000,
  chargebackAt = null,
  refundedAt = null
}) {
  const buyerUserId = id(`buyer_${label}`);
  const courseId = id(`course_${label}`);
  const orderId = id(`order_${label}`);
  const transactionId = paymentTransactionId({ provider: 'asaas', orderId });
  const paymentId = id(`pay_${label}`);
  const customerId = id(`cus_${label}`);
  const createdAt = new Date('2026-09-18T12:00:00.000Z');
  const paidAt = orderStatus === 'pending_payment'
    ? null
    : new Date('2026-09-18T12:10:00.000Z');
  const canonicalChargebackAt = chargebackAt || (
    orderStatus === 'chargeback'
      ? new Date('2026-09-19T01:00:00.000Z')
      : null
  );
  const canonicalRefundedAt = refundedAt || (
    orderStatus === 'refunded'
      ? new Date('2026-09-19T02:00:00.000Z')
      : null
  );
  const snapshot = financialSnapshot(courseId, amountCents);

  await db.doc(`orders/${orderId}`).set({
    buyerUserId,
    productType: 'course',
    productId: courseId,
    quantity: 1,
    amountCents,
    currency: 'BRL',
    status: orderStatus,
    financialSnapshot: snapshot,
    provider: 'asaas',
    providerCustomerId: customerId,
    currentTransactionId: transactionId,
    idempotencyKey: id(`intent_${label}`),
    createdAt,
    updatedAt: paidAt || createdAt,
    paidAt,
    cancelledAt: null,
    expiredAt: null,
    refundedAt: canonicalRefundedAt,
    chargebackAt: canonicalChargebackAt
  });

  await db.doc(`payment_transactions/${transactionId}`).set({
    orderId,
    buyerUserId,
    provider: 'asaas',
    providerPaymentId: paymentId,
    providerStatus: orderStatus === 'pending_payment'
      ? 'PENDING'
      : orderStatus.toUpperCase(),
    status: transactionStatus,
    amountCents,
    currency: 'BRL',
    financialSnapshot: snapshot,
    providerSplitSnapshot: [],
    createdAt,
    updatedAt: paidAt || createdAt,
    confirmedAt: orderStatus === 'pending_payment' ? null : paidAt,
    refundedAt: canonicalRefundedAt,
    chargebackAt: canonicalChargebackAt
  });

  const enrollmentId = enrollmentDocumentId(courseId, buyerUserId);
  if (enrollmentStatus) {
    await db.doc(`enrollments/${enrollmentId}`).set({
      courseId,
      userId: buyerUserId,
      source: 'order',
      orderId,
      status: enrollmentStatus,
      progressPercent,
      startedAt: paidAt,
      completedAt,
      createdAt: paidAt,
      updatedAt: paidAt
    });
  }

  return {
    buyerUserId,
    courseId,
    orderId,
    transactionId,
    paymentId,
    customerId,
    amountCents,
    enrollmentId,
    externalReference: paymentExternalReference(orderId)
  };
}

function payload(seed, {
  eventId = id('evt'),
  event,
  status,
  dateCreated = '2026-09-19T04:00:00.000Z',
  value = seed.amountCents / 100,
  paymentId = seed.paymentId,
  customerId = seed.customerId,
  externalReference = seed.externalReference,
  billingType = 'PIX'
}) {
  return {
    id: eventId,
    event,
    dateCreated,
    payment: {
      id: paymentId,
      status,
      customer: customerId,
      externalReference,
      billingType,
      value
    }
  };
}

async function register(seed, options) {
  return createFinancialWebhookPersistence({ db, clock: now })
    .registerWebhookEvent({ payload: payload(seed, options) });
}

function service() {
  return createFinancialReversalFulfillment({ db, clock: now });
}

async function docs(seed, eventId) {
  const [orderSnap, txSnap, enrollmentSnap, eventSnap, evidenceSnap] = await Promise.all([
    db.doc(`orders/${seed.orderId}`).get(),
    db.doc(`payment_transactions/${seed.transactionId}`).get(),
    db.doc(`enrollments/${seed.enrollmentId}`).get(),
    db.doc(`payment_webhook_events/${eventId}`).get(),
    db.doc(`${RECOVERY_COLLECTION}/${seed.transactionId}`).get()
  ]);
  return {
    order: orderSnap.data(),
    transaction: txSnap.data(),
    enrollment: enrollmentSnap.exists ? enrollmentSnap.data() : null,
    event: eventSnap.data(),
    evidence: evidenceSnap.exists ? evidenceSnap.data() : null
  };
}

async function audits(eventId) {
  const snap = await db.collection('audit_logs')
    .where('requestId', '==', eventId)
    .get();
  return snap.docs.map(doc => doc.data());
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
    for (const doc of snap.docs.slice(offset, offset + 400)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
}

async function cleanup() {
  for (const name of [
    'audit_logs',
    RECOVERY_COLLECTION,
    'payment_webhook_events',
    'payment_transactions',
    'orders',
    'enrollments'
  ]) {
    await deleteCollection(name);
  }
  await deleteApp(app);
}

async function main() {
  try {
    await test('PAYMENT_REFUNDED converge finance e revoga enrollment atomicamente', async () => {
      const seed = await seedState({ label: 'refund' });
      const received = await register(seed, {
        eventId: id('evt_refund'),
        event: 'PAYMENT_REFUNDED',
        status: 'REFUNDED'
      });
      const result = await service().processWebhookEvent({ eventId: received.eventId });
      const state = await docs(seed, received.eventId);

      assert.equal(result.action, 'refund');
      assert.equal(state.order.status, 'refunded');
      assert.equal(state.transaction.status, 'refunded');
      assert.equal(state.transaction.providerStatus, 'REFUNDED');
      assert.equal(state.enrollment.status, 'refunded');
      assert.equal(state.enrollment.progressPercent, 42);
      assert.equal(state.event.status, 'processed');
      const eventAudits = await audits(received.eventId);
      assert.equal(eventAudits.filter(x => x.action === 'financial.payment.refunded').length, 1);
      assert.equal(eventAudits.filter(x => x.action === 'course.enrollment.revoked_refund').length, 1);
    });

    await test('PAYMENT_CHARGEBACK_REQUESTED revoga entitlement e preserva progresso', async () => {
      const seed = await seedState({ label: 'chargeback' });
      const received = await register(seed, {
        eventId: id('evt_chargeback'),
        event: 'PAYMENT_CHARGEBACK_REQUESTED',
        status: 'CHARGEBACK_REQUESTED'
      });
      await service().processWebhookEvent({ eventId: received.eventId });
      const state = await docs(seed, received.eventId);

      assert.equal(state.order.status, 'chargeback');
      assert.ok(state.order.chargebackAt);
      assert.equal(state.transaction.status, 'chargeback');
      assert.equal(state.enrollment.status, 'chargeback');
      assert.equal(state.enrollment.progressPercent, 42);
      assert.equal(state.event.status, 'processed');
    });

    await test('refund final pode suceder chargeback sem apagar historico', async () => {
      const originalChargebackAt = new Date('2026-09-19T01:00:00.000Z');
      const seed = await seedState({
        label: 'refund_after_chargeback',
        orderStatus: 'chargeback',
        transactionStatus: 'chargeback',
        enrollmentStatus: 'chargeback',
        chargebackAt: originalChargebackAt
      });
      const received = await register(seed, {
        eventId: id('evt_refund_after_chargeback'),
        event: 'PAYMENT_REFUNDED',
        status: 'REFUNDED'
      });
      await service().processWebhookEvent({ eventId: received.eventId });
      const state = await docs(seed, received.eventId);

      assert.equal(state.order.status, 'refunded');
      assert.equal(state.transaction.status, 'refunded');
      assert.equal(state.enrollment.status, 'refunded');
      assert.equal(state.order.chargebackAt.toMillis(), originalChargebackAt.getTime());
      assert.ok(state.order.refundedAt);
    });

    await test('PAYMENT_DELETED cancela somente pre-pagamento e nao cria enrollment', async () => {
      const seed = await seedState({
        label: 'cancel',
        orderStatus: 'pending_payment',
        transactionStatus: 'pending',
        enrollmentStatus: null
      });
      const received = await register(seed, {
        eventId: id('evt_cancel'),
        event: 'PAYMENT_DELETED',
        status: 'PENDING'
      });
      await service().processWebhookEvent({ eventId: received.eventId });
      const state = await docs(seed, received.eventId);

      assert.equal(state.order.status, 'cancelled');
      assert.equal(state.transaction.status, 'cancelled');
      assert.equal(state.enrollment, null);
      assert.equal(state.event.status, 'processed');
    });

    await test('refund parcial vira review sem revogar acesso', async () => {
      const seed = await seedState({ label: 'partial_refund' });
      const received = await register(seed, {
        eventId: id('evt_partial_refund'),
        event: 'PAYMENT_PARTIALLY_REFUNDED',
        status: 'PARTIALLY_REFUNDED'
      });
      const result = await service().processWebhookEvent({ eventId: received.eventId });
      const state = await docs(seed, received.eventId);

      assert.equal(result.reviewRequired, true);
      assert.equal(state.order.status, 'paid');
      assert.equal(state.transaction.status, 'paid');
      assert.equal(state.enrollment.status, 'active');
      assert.equal(state.event.status, 'processed');
      assert.equal(state.event.reviewRequired, true);
      assert.equal(
        (await audits(received.eventId)).filter(x => x.action === 'financial.payment.partial_refund_review').length,
        1
      );
    });

    await test('refund em andamento e processado sem mutacao final', async () => {
      const seed = await seedState({ label: 'refund_pending' });
      const received = await register(seed, {
        eventId: id('evt_refund_pending'),
        event: 'PAYMENT_REFUND_IN_PROGRESS',
        status: 'REFUND_IN_PROGRESS'
      });
      const result = await service().processWebhookEvent({ eventId: received.eventId });
      const state = await docs(seed, received.eventId);

      assert.equal(result.financialMutationRequired, false);
      assert.equal(state.order.status, 'paid');
      assert.equal(state.enrollment.status, 'active');
      assert.equal(state.event.status, 'processed');
    });

    await test('evidencia awaiting reversal e persistida sem restaurar acesso', async () => {
      const seed = await seedState({
        label: 'recovery_evidence',
        orderStatus: 'chargeback',
        transactionStatus: 'chargeback',
        enrollmentStatus: 'chargeback'
      });
      const received = await register(seed, {
        eventId: id('evt_recovery_evidence'),
        event: 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
        status: 'AWAITING_CHARGEBACK_REVERSAL',
        dateCreated: '2026-09-19T01:10:00.000Z'
      });
      await service().processWebhookEvent({ eventId: received.eventId });
      const state = await docs(seed, received.eventId);

      assert.equal(state.order.status, 'chargeback');
      assert.equal(state.enrollment.status, 'chargeback');
      assert.equal(state.evidence.status, 'awaiting_reversal');
      assert.equal(state.evidence.evidenceEventId, received.eventId);
      assert.equal(state.event.status, 'processed');
    });

    await test('evento positivo antigo nao recupera chargeback', async () => {
      const seed = await seedState({
        label: 'stale_positive',
        orderStatus: 'chargeback',
        transactionStatus: 'chargeback',
        enrollmentStatus: 'chargeback',
        chargebackAt: new Date('2026-09-19T01:00:00.000Z')
      });
      const received = await register(seed, {
        eventId: id('evt_stale_positive'),
        event: 'PAYMENT_RECEIVED',
        status: 'RECEIVED',
        dateCreated: '2026-09-19T00:59:00.000Z'
      });
      const result = await service().processWebhookEvent({ eventId: received.eventId });
      const state = await docs(seed, received.eventId);

      assert.equal(result.stale, true);
      assert.equal(state.order.status, 'chargeback');
      assert.equal(state.enrollment.status, 'chargeback');
      assert.equal(state.event.status, 'processed');
      assert.equal(state.event.reversalOutcome, 'stale_positive_ignored');
    });

    await test('evento positivo sem evidencia deixa chargeback fechado e retryable', async () => {
      const seed = await seedState({
        label: 'recovery_without_evidence',
        orderStatus: 'chargeback',
        transactionStatus: 'chargeback',
        enrollmentStatus: 'chargeback',
        chargebackAt: new Date('2026-09-19T01:00:00.000Z')
      });
      const received = await register(seed, {
        eventId: id('evt_recovery_without_evidence'),
        event: 'PAYMENT_RECEIVED',
        status: 'RECEIVED',
        dateCreated: '2026-09-19T01:20:00.000Z'
      });

      await assert.rejects(
        service().processWebhookEvent({ eventId: received.eventId }),
        error => error instanceof FinancialReversalFulfillmentError &&
          error.code === 'CHARGEBACK_RECOVERY_EVIDENCE_PENDING' &&
          error.retryable === true
      );
      const state = await docs(seed, received.eventId);
      assert.equal(state.order.status, 'chargeback');
      assert.equal(state.enrollment.status, 'chargeback');
      assert.equal(state.event.status, 'received');
    });

    await test('evidencia + evento positivo recuperam chargeback e entitlement', async () => {
      const seed = await seedState({
        label: 'recovery_success',
        orderStatus: 'chargeback',
        transactionStatus: 'chargeback',
        enrollmentStatus: 'chargeback',
        chargebackAt: new Date('2026-09-19T01:00:00.000Z')
      });
      const evidenceEvent = await register(seed, {
        eventId: id('evt_recovery_success_evidence'),
        event: 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
        status: 'AWAITING_CHARGEBACK_REVERSAL',
        dateCreated: '2026-09-19T01:10:00.000Z'
      });
      await service().processWebhookEvent({ eventId: evidenceEvent.eventId });

      const positiveEvent = await register(seed, {
        eventId: id('evt_recovery_success_positive'),
        event: 'PAYMENT_RECEIVED',
        status: 'RECEIVED',
        dateCreated: '2026-09-19T01:20:00.000Z'
      });
      const result = await service().processWebhookEvent({ eventId: positiveEvent.eventId });
      const state = await docs(seed, positiveEvent.eventId);

      assert.equal(result.action, 'chargeback_recovered');
      assert.equal(state.order.status, 'paid');
      assert.equal(state.transaction.status, 'paid');
      assert.equal(state.transaction.providerStatus, 'RECEIVED');
      assert.equal(state.enrollment.status, 'active');
      assert.equal(state.evidence.status, 'consumed');
      assert.equal(state.evidence.recoveredEventId, positiveEvent.eventId);
    });

    await test('recuperacao restaura completed quando conclusao era historica', async () => {
      const seed = await seedState({
        label: 'recovery_completed',
        orderStatus: 'chargeback',
        transactionStatus: 'chargeback',
        enrollmentStatus: 'chargeback',
        progressPercent: 100,
        completedAt: new Date('2026-09-18T18:00:00.000Z'),
        chargebackAt: new Date('2026-09-19T01:00:00.000Z')
      });
      const evidenceEvent = await register(seed, {
        eventId: id('evt_recovery_completed_evidence'),
        event: 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
        status: 'AWAITING_CHARGEBACK_REVERSAL',
        dateCreated: '2026-09-19T01:10:00.000Z'
      });
      await service().processWebhookEvent({ eventId: evidenceEvent.eventId });
      const positiveEvent = await register(seed, {
        eventId: id('evt_recovery_completed_positive'),
        event: 'PAYMENT_CONFIRMED',
        status: 'CONFIRMED',
        dateCreated: '2026-09-19T01:20:00.000Z'
      });
      await service().processWebhookEvent({ eventId: positiveEvent.eventId });
      const state = await docs(seed, positiveEvent.eventId);

      assert.equal(state.enrollment.status, 'completed');
      assert.equal(state.enrollment.progressPercent, 100);
      assert.ok(state.enrollment.completedAt);
    });

    await test('retry do mesmo evento processado e idempotente sem auditoria duplicada', async () => {
      const seed = await seedState({ label: 'retry' });
      const received = await register(seed, {
        eventId: id('evt_retry'),
        event: 'PAYMENT_REFUNDED',
        status: 'REFUNDED'
      });
      const api = service();
      const first = await api.processWebhookEvent({ eventId: received.eventId });
      const auditCount = (await audits(received.eventId)).length;
      const second = await api.processWebhookEvent({ eventId: received.eventId });

      assert.equal(first.processed, true);
      assert.equal(second.idempotent, true);
      assert.equal((await audits(received.eventId)).length, auditCount);
    });

    await test('identidade divergente falha fechado e marca evento error', async () => {
      const seed = await seedState({ label: 'identity_mismatch' });
      const received = await register(seed, {
        eventId: id('evt_identity_mismatch'),
        event: 'PAYMENT_REFUNDED',
        status: 'REFUNDED',
        value: 99
      });

      await assert.rejects(
        service().processWebhookEvent({ eventId: received.eventId }),
        error => error instanceof FinancialReversalFulfillmentError &&
          error.code === 'REVERSAL_VALUE_MISMATCH'
      );
      const state = await docs(seed, received.eventId);
      assert.equal(state.order.status, 'paid');
      assert.equal(state.transaction.status, 'paid');
      assert.equal(state.enrollment.status, 'active');
      assert.equal(state.event.status, 'error');
      assert.equal(state.event.errorCode, 'REVERSAL_VALUE_MISMATCH');
    });

    await test('refund final prevalece sobre chargeback atrasado', async () => {
      const seed = await seedState({
        label: 'refund_precedence',
        orderStatus: 'refunded',
        transactionStatus: 'refunded',
        enrollmentStatus: 'refunded',
        refundedAt: new Date('2026-09-19T02:00:00.000Z')
      });
      const received = await register(seed, {
        eventId: id('evt_late_chargeback'),
        event: 'PAYMENT_CHARGEBACK_REQUESTED',
        status: 'CHARGEBACK_REQUESTED',
        dateCreated: '2026-09-19T03:00:00.000Z'
      });
      const result = await service().processWebhookEvent({ eventId: received.eventId });
      const state = await docs(seed, received.eventId);

      assert.equal(result.idempotent, true);
      assert.equal(state.order.status, 'refunded');
      assert.equal(state.transaction.status, 'refunded');
      assert.equal(state.enrollment.status, 'refunded');
      assert.equal(state.event.status, 'processed');
    });

    console.log(`FINANCIAL_REVERSAL_FULFILLMENT_EMULATOR_V1_2=${passed}/14`);
    if (passed !== 14) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  try { await cleanup(); } catch (_) {}
});
