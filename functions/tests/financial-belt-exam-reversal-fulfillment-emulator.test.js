'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const { paymentExternalReference } = require('../src/finance/asaas-checkout-adapter');
const { paymentTransactionId } = require('../src/finance/financial-checkout-persistence');
const { createFinancialWebhookPersistence } = require('../src/finance/financial-webhook-persistence');
const {
  createFinancialBeltExamReversalFulfillment
} = require('../src/finance/financial-belt-exam-reversal-fulfillment');
const {
  createWebhookWorkerHandler
} = require('../src/finance/financial-webhook-functions');
const { examRegistrationDocumentId } = require('../src/exams/exam-registration-domain');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}
assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-belt-exam-reversal';
const app = initializeApp({ projectId }, `belt-exam-reversal-${process.pid}-${Date.now()}`);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;
let tick = 0;

function id(label) {
  return `${label}_${runId}`;
}
function now() {
  const date = new Date(Date.parse('2026-09-20T04:00:00.000Z') + tick * 1000);
  tick += 1;
  return date;
}
function snapshot(sessionId, orgId, amountCents = 5000) {
  return {
    ruleId: 'platform-default',
    ruleVersion: 1,
    productType: 'belt_exam',
    productId: sessionId,
    currency: 'BRL',
    grossAmountCents: amountCents,
    platformFeeBps: 1000,
    platformFeeCents: Math.round(amountCents * 0.10),
    sellerPoolCents: amountCents - Math.round(amountCents * 0.10),
    recipientMode: 'product_owner',
    recipientAllocations: [{
      recipientType: 'organization',
      recipientId: orgId,
      shareBps: 10000,
      amountCents: amountCents - Math.round(amountCents * 0.10)
    }],
    resolvedAt: new Date('2026-09-20T03:30:00.000Z')
  };
}

async function seed({
  label,
  orderStatus = 'paid',
  registrationStatus = orderStatus === 'pending_payment' ? 'awaiting_payment' : 'authorized',
  attemptId = null
}) {
  const buyer = id(`buyer_${label}`);
  const sessionId = id(`session_${label}`);
  const orgId = id(`org_${label}`);
  const orderId = id(`order_${label}`);
  const transactionId = paymentTransactionId({ provider: 'asaas', orderId });
  const paymentId = id(`pay_${label}`);
  const customerId = id(`cus_${label}`);
  const createdAt = new Date('2026-09-20T03:00:00.000Z');
  const paidAt = new Date('2026-09-20T03:20:00.000Z');
  const financialSnapshot = snapshot(sessionId, orgId);
  const transactionStatus = orderStatus === 'pending_payment' ? 'pending' : orderStatus;

  await db.doc(`orders/${orderId}`).set({
    buyerUserId: buyer,
    productType: 'belt_exam',
    productId: sessionId,
    quantity: 1,
    amountCents: 5000,
    currency: 'BRL',
    status: orderStatus,
    financialSnapshot,
    provider: 'asaas',
    providerCustomerId: customerId,
    currentTransactionId: transactionId,
    idempotencyKey: id(`intent_${label}`),
    createdAt,
    updatedAt: createdAt,
    paidAt: ['paid', 'refunded', 'chargeback'].includes(orderStatus) ? paidAt : null,
    cancelledAt: null,
    expiredAt: null,
    refundedAt: orderStatus === 'refunded' ? paidAt : null,
    chargebackAt: orderStatus === 'chargeback' ? paidAt : null
  });

  await db.doc(`payment_transactions/${transactionId}`).set({
    orderId,
    buyerUserId: buyer,
    provider: 'asaas',
    providerPaymentId: paymentId,
    providerStatus: orderStatus === 'pending_payment' ? 'PENDING' : 'RECEIVED',
    status: transactionStatus,
    amountCents: 5000,
    currency: 'BRL',
    financialSnapshot,
    providerSplitSnapshot: [],
    createdAt,
    updatedAt: createdAt,
    confirmedAt: ['paid', 'refunded', 'chargeback'].includes(transactionStatus) ? paidAt : null,
    refundedAt: transactionStatus === 'refunded' ? paidAt : null,
    chargebackAt: transactionStatus === 'chargeback' ? paidAt : null
  });

  const registrationId = examRegistrationDocumentId({ sessionId, studentId: buyer });
  const paidRegistration = [
    'authorized', 'started', 'submitted', 'passed', 'failed', 'certified'
  ].includes(registrationStatus);
  await db.doc(`exam_registrations/${registrationId}`).set({
    sessionId,
    organizationId: orgId,
    studentId: buyer,
    instructorId: id(`instructor_${label}`),
    currentBelt: 'Branca',
    targetBelt: 'Azul',
    membershipId: id(`membership_${label}`),
    status: registrationStatus,
    orderId,
    attemptId,
    resultId: null,
    certificateId: null,
    selectedAt: createdAt,
    paidAt: paidRegistration ? paidAt : null,
    authorizedAt: paidRegistration ? paidAt : null,
    cancelledAt: null,
    updatedAt: createdAt
  });

  return {
    buyer,
    sessionId,
    orgId,
    orderId,
    transactionId,
    paymentId,
    customerId,
    registrationId,
    amountCents: 5000,
    externalReference: paymentExternalReference(orderId)
  };
}

function providerStatusForEvent(event) {
  const map = {
    PAYMENT_DELETED: 'PENDING',
    PAYMENT_REFUNDED: 'REFUNDED',
    PAYMENT_PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
    PAYMENT_REFUND_IN_PROGRESS: 'REFUND_IN_PROGRESS',
    PAYMENT_REFUND_DENIED: 'REFUND_DENIED',
    PAYMENT_CHARGEBACK_REQUESTED: 'CHARGEBACK_REQUESTED',
    PAYMENT_CHARGEBACK_DISPUTE: 'CHARGEBACK_DISPUTE',
    PAYMENT_AWAITING_CHARGEBACK_REVERSAL: 'AWAITING_CHARGEBACK_REVERSAL',
    PAYMENT_CONFIRMED: 'CONFIRMED',
    PAYMENT_RECEIVED: 'RECEIVED'
  };
  return map[event] || 'RECEIVED';
}

function webhookPayload(seedValue, event, eventId = id(`evt_${event.toLowerCase()}`)) {
  return {
    id: eventId,
    event,
    dateCreated: '2026-09-20T04:00:00.000Z',
    payment: {
      id: seedValue.paymentId,
      status: providerStatusForEvent(event),
      customer: seedValue.customerId,
      externalReference: seedValue.externalReference,
      billingType: 'PIX',
      value: seedValue.amountCents / 100
    }
  };
}

async function register(payload) {
  return createFinancialWebhookPersistence({ db, clock: now })
    .registerWebhookEvent({ payload });
}

async function process(seedValue, event) {
  const received = await register(webhookPayload(seedValue, event));
  const result = await createFinancialBeltExamReversalFulfillment({ db, clock: now })
    .processWebhookEvent({ eventId: received.eventId });
  return { received, result };
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

async function main() {
  try {
    await test('PAYMENT_DELETED cancela financeiro e retorna registration a selected', async () => {
      const s = await seed({ label: 'cancel', orderStatus: 'pending_payment' });
      const { result } = await process(s, 'PAYMENT_DELETED');
      assert.equal(result.processed, true);
      const [orderSnap, txSnap, regSnap] = await Promise.all([
        db.doc(`orders/${s.orderId}`).get(),
        db.doc(`payment_transactions/${s.transactionId}`).get(),
        db.doc(`exam_registrations/${s.registrationId}`).get()
      ]);
      assert.equal(orderSnap.data().status, 'cancelled');
      assert.equal(txSnap.data().status, 'cancelled');
      assert.equal(regSnap.data().status, 'selected');
      assert.equal(regSnap.data().orderId, null);
    });

    await test('PAYMENT_REFUNDED antes da prova cancela authorization', async () => {
      const s = await seed({ label: 'refund' });
      const { result } = await process(s, 'PAYMENT_REFUNDED');
      assert.equal(result.reviewRequired, false);
      const [orderSnap, regSnap] = await Promise.all([
        db.doc(`orders/${s.orderId}`).get(),
        db.doc(`exam_registrations/${s.registrationId}`).get()
      ]);
      assert.equal(orderSnap.data().status, 'refunded');
      assert.equal(regSnap.data().status, 'cancelled');
      assert.equal(regSnap.data().orderId, s.orderId);
    });

    await test('PAYMENT_REFUNDED apos inicio preserva attempt e exige reconciliacao', async () => {
      const attemptId = id('attempt_started');
      const s = await seed({
        label: 'refund_started',
        registrationStatus: 'started',
        attemptId
      });
      const { result } = await process(s, 'PAYMENT_REFUNDED');
      assert.equal(result.reviewRequired, true);
      const reg = (await db.doc(`exam_registrations/${s.registrationId}`).get()).data();
      assert.equal(reg.status, 'needs_reconciliation');
      assert.equal(reg.attemptId, attemptId);
      assert.equal((await db.doc(`orders/${s.orderId}`).get()).data().status, 'refunded');
    });

    await test('refund parcial mantem financeiro pago e bloqueia registration para revisao', async () => {
      const s = await seed({ label: 'partial' });
      const { result } = await process(s, 'PAYMENT_PARTIALLY_REFUNDED');
      assert.equal(result.reviewRequired, true);
      assert.equal((await db.doc(`orders/${s.orderId}`).get()).data().status, 'paid');
      assert.equal(
        (await db.doc(`exam_registrations/${s.registrationId}`).get()).data().status,
        'needs_reconciliation'
      );
    });

    await test('refund negado nao revoga authorization nem simula refund', async () => {
      const s = await seed({ label: 'denied' });
      const { result, received } = await process(s, 'PAYMENT_REFUND_DENIED');
      assert.equal(result.reviewRequired, true);
      assert.equal((await db.doc(`orders/${s.orderId}`).get()).data().status, 'paid');
      assert.equal(
        (await db.doc(`exam_registrations/${s.registrationId}`).get()).data().status,
        'authorized'
      );
      const event = (await db.doc(`payment_webhook_events/${received.eventId}`).get()).data();
      assert.equal(event.status, 'processed');
      assert.equal(event.reviewRequired, true);
    });

    await test('chargeback muda financeiro e registration para needs_reconciliation', async () => {
      const s = await seed({ label: 'chargeback' });
      const { result } = await process(s, 'PAYMENT_CHARGEBACK_REQUESTED');
      assert.equal(result.reviewRequired, true);
      assert.equal((await db.doc(`orders/${s.orderId}`).get()).data().status, 'chargeback');
      assert.equal(
        (await db.doc(`exam_registrations/${s.registrationId}`).get()).data().status,
        'needs_reconciliation'
      );
    });

    await test('evento positivo normal delega para fulfillment de confirmacao', async () => {
      const s = await seed({ label: 'positive' });
      const received = await register(webhookPayload(s, 'PAYMENT_CONFIRMED'));
      const result = await createFinancialBeltExamReversalFulfillment({ db, clock: now })
        .processWebhookEvent({ eventId: received.eventId });
      assert.equal(result.delegatedToConfirmation, true);
      assert.equal(
        (await db.doc(`payment_webhook_events/${received.eventId}`).get()).data().status,
        'received'
      );
    });

    await test('worker roteia reversal belt_exam sem chamar provider', async () => {
      const s = await seed({ label: 'worker_partial' });
      const received = await register(webhookPayload(s, 'PAYMENT_PARTIALLY_REFUNDED'));
      const eventSnap = await db.doc(`payment_webhook_events/${received.eventId}`).get();
      let providerCalls = 0;
      const worker = createWebhookWorkerHandler({
        db,
        providerFactory() {
          providerCalls += 1;
          throw new Error('provider nao deveria ser chamado em reversal');
        },
        clock: now
      });
      const result = await worker({
        params: { eventId: received.eventId },
        data: eventSnap
      });
      assert.equal(result.processed, true);
      assert.equal(result.reviewRequired, true);
      assert.equal(providerCalls, 0);
      assert.equal(
        (await db.doc(`exam_registrations/${s.registrationId}`).get()).data().status,
        'needs_reconciliation'
      );
    });

    console.log(`BELT_EXAM_REVERSAL_FULFILLMENT_EMULATOR_V1_2=${passed}/8`);
    if (passed !== 8) process.exitCode = 1;
  } finally {
    await deleteApp(app);
  }
}

main().catch(async error => {
  console.error(error.stack || error);
  process.exitCode = 1;
  try { await deleteApp(app); } catch (_) {}
});
