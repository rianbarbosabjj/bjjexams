'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const {
  paymentWebhookEventDocumentId
} = require('../src/finance/financial-webhook-domain');
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

const projectId = 'demo-bjj-exams-finance-reversal-functions';
const functionBase = `http://127.0.0.1:5001/${projectId}/southamerica-east1`;
const webhookToken = String(process.env.BJJ_EXAMS_WEBHOOK_TOKEN || '').trim();
if (!webhookToken || webhookToken.length < 32) {
  throw new Error('BJJ_EXAMS_WEBHOOK_TOKEN local com pelo menos 32 caracteres e obrigatorio.');
}

const app = initializeApp({ projectId }, `reversal-functions-${process.pid}-${Date.now()}`);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;

function id(label) {
  return `revfn_${label}_${runId}`;
}

function financialSnapshot(courseId, amountCents = 10000) {
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
    resolvedAt: new Date('2026-09-19T09:00:00.000Z')
  };
}

async function seedFinancialState({
  label,
  status = 'paid',
  transactionStatus = status === 'pending_payment' ? 'pending' : status,
  enrollmentStatus = status === 'paid' ? 'active' : null,
  progressPercent = 35,
  completedAt = null,
  amountCents = 10000
}) {
  const buyerUserId = id(`buyer_${label}`);
  const courseId = id(`course_${label}`);
  const orderId = id(`order_${label}`);
  const providerPaymentId = id(`pay_${label}`);
  const providerCustomerId = id(`cus_${label}`);
  const transactionId = paymentTransactionId({ provider: 'asaas', orderId });
  const createdAt = new Date('2026-09-19T09:00:00.000Z');
  const paidAt = status === 'pending_payment' ? null : new Date('2026-09-19T09:05:00.000Z');
  const snapshot = financialSnapshot(courseId, amountCents);

  await db.doc(`orders/${orderId}`).set({
    buyerUserId,
    productType: 'course',
    productId: courseId,
    quantity: 1,
    amountCents,
    currency: 'BRL',
    status,
    financialSnapshot: snapshot,
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
    providerStatus: transactionStatus === 'pending' ? 'PENDING' : 'RECEIVED',
    status: transactionStatus,
    amountCents,
    currency: 'BRL',
    financialSnapshot: snapshot,
    providerSplitSnapshot: [],
    createdAt,
    updatedAt: paidAt || createdAt,
    confirmedAt: transactionStatus === 'pending' ? null : paidAt,
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
    providerPaymentId,
    providerCustomerId,
    enrollmentId,
    amountCents,
    externalReference: `BJJEX-V12-ORDER-${orderId}`
  };
}

function webhookPayload(seed, {
  eventId = id('event'),
  event,
  paymentStatus,
  dateCreated = '2026-09-19T10:00:00.000Z'
}) {
  return {
    id: eventId,
    event,
    dateCreated,
    payment: {
      id: seed.providerPaymentId,
      status: paymentStatus,
      customer: seed.providerCustomerId,
      externalReference: seed.externalReference,
      billingType: 'PIX',
      value: seed.amountCents / 100
    }
  };
}

async function callWebhook(payload) {
  const response = await fetch(`${functionBase}/webhookAsaasPagamentosV12`, {
    method: 'POST',
    headers: {
      'asaas-access-token': webhookToken,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch (_) {}
  return { status: response.status, body, text };
}

async function waitForEvent(providerEventId, expectedStatus = 'processed', timeoutMs = 15000) {
  const eventDocumentId = paymentWebhookEventDocumentId({
    provider: 'asaas',
    providerEventId
  });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const snap = await db.doc(`payment_webhook_events/${eventDocumentId}`).get();
    if (snap.exists && snap.data().status === expectedStatus) {
      return { id: eventDocumentId, data: snap.data() };
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const finalSnap = await db.doc(`payment_webhook_events/${eventDocumentId}`).get();
  throw new Error(
    `Timeout aguardando ${providerEventId}=${expectedStatus}; atual=` +
    `${finalSnap.exists ? finalSnap.data().status : '<MISSING>'}`
  );
}

async function auditsForRequest(eventDocumentId) {
  const snap = await db.collection('audit_logs').where('requestId', '==', eventDocumentId).get();
  return snap.docs.map(doc => doc.data());
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
    'financial_chargeback_recovery',
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
    await test('HTTP PAYMENT_REFUNDED revoga entitlement e converge estado final', async () => {
      const seed = await seedFinancialState({ label: 'refund' });
      const providerEventId = id('evt_refund');
      const payload = webhookPayload(seed, {
        eventId: providerEventId,
        event: 'PAYMENT_REFUNDED',
        paymentStatus: 'REFUNDED'
      });
      const response = await callWebhook(payload);
      assert.equal(response.status, 202, response.text);
      assert.equal(response.body.status, 'received');
      const event = await waitForEvent(providerEventId);
      const [orderSnap, txSnap, enrollmentSnap] = await Promise.all([
        db.doc(`orders/${seed.orderId}`).get(),
        db.doc(`payment_transactions/${seed.transactionId}`).get(),
        db.doc(`enrollments/${seed.enrollmentId}`).get()
      ]);
      assert.equal(event.data.reversalOutcome, 'refund');
      assert.equal(orderSnap.data().status, 'refunded');
      assert.equal(txSnap.data().status, 'refunded');
      assert.equal(enrollmentSnap.data().status, 'refunded');
      assert.equal(enrollmentSnap.data().progressPercent, 35);
      const audits = await auditsForRequest(event.id);
      assert.equal(audits.filter(item => item.action === 'financial.payment.refunded').length, 1);
      assert.equal(audits.filter(item => item.action === 'course.enrollment.revoked_refund').length, 1);
    });

    await test('HTTP PAYMENT_CHARGEBACK_REQUESTED revoga acesso sem apagar progresso', async () => {
      const seed = await seedFinancialState({ label: 'chargeback', progressPercent: 61 });
      const providerEventId = id('evt_chargeback');
      const response = await callWebhook(webhookPayload(seed, {
        eventId: providerEventId,
        event: 'PAYMENT_CHARGEBACK_REQUESTED',
        paymentStatus: 'CHARGEBACK_REQUESTED'
      }));
      assert.equal(response.status, 202, response.text);
      const event = await waitForEvent(providerEventId);
      const [orderSnap, txSnap, enrollmentSnap] = await Promise.all([
        db.doc(`orders/${seed.orderId}`).get(),
        db.doc(`payment_transactions/${seed.transactionId}`).get(),
        db.doc(`enrollments/${seed.enrollmentId}`).get()
      ]);
      assert.equal(event.data.reversalOutcome, 'chargeback');
      assert.equal(orderSnap.data().status, 'chargeback');
      assert.equal(txSnap.data().status, 'chargeback');
      assert.equal(enrollmentSnap.data().status, 'chargeback');
      assert.equal(enrollmentSnap.data().progressPercent, 61);
    });

    await test('HTTP PAYMENT_DELETED cancela somente checkout ainda pendente', async () => {
      const seed = await seedFinancialState({
        label: 'delete',
        status: 'pending_payment',
        transactionStatus: 'pending',
        enrollmentStatus: null
      });
      const providerEventId = id('evt_delete');
      const response = await callWebhook(webhookPayload(seed, {
        eventId: providerEventId,
        event: 'PAYMENT_DELETED',
        paymentStatus: 'PENDING'
      }));
      assert.equal(response.status, 202, response.text);
      await waitForEvent(providerEventId);
      assert.equal((await db.doc(`orders/${seed.orderId}`).get()).data().status, 'cancelled');
      assert.equal((await db.doc(`payment_transactions/${seed.transactionId}`).get()).data().status, 'cancelled');
      assert.equal((await db.collection('enrollments').where('orderId', '==', seed.orderId).get()).empty, true);
    });

    await test('refund parcial e persistido para revisao sem revogar acesso', async () => {
      const seed = await seedFinancialState({ label: 'partial' });
      const providerEventId = id('evt_partial');
      const response = await callWebhook(webhookPayload(seed, {
        eventId: providerEventId,
        event: 'PAYMENT_PARTIALLY_REFUNDED',
        paymentStatus: 'RECEIVED'
      }));
      assert.equal(response.status, 202, response.text);
      const event = await waitForEvent(providerEventId);
      assert.equal(event.data.reviewRequired, true);
      assert.equal(event.data.reversalOutcome, 'partial_refund_review');
      assert.equal((await db.doc(`orders/${seed.orderId}`).get()).data().status, 'paid');
      assert.equal((await db.doc(`enrollments/${seed.enrollmentId}`).get()).data().status, 'active');
    });

    await test('evidencia de reversao + evento positivo recuperam chargeback com entitlement', async () => {
      const seed = await seedFinancialState({ label: 'recovery' });
      const chargebackEventId = id('evt_recovery_chargeback');
      await callWebhook(webhookPayload(seed, {
        eventId: chargebackEventId,
        event: 'PAYMENT_CHARGEBACK_REQUESTED',
        paymentStatus: 'CHARGEBACK_REQUESTED',
        dateCreated: '2026-09-19T10:00:00.000Z'
      }));
      await waitForEvent(chargebackEventId);

      const evidenceEventId = id('evt_recovery_evidence');
      await callWebhook(webhookPayload(seed, {
        eventId: evidenceEventId,
        event: 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
        paymentStatus: 'CHARGEBACK_REQUESTED',
        dateCreated: '2026-09-19T10:01:00.000Z'
      }));
      await waitForEvent(evidenceEventId);

      const recoveredEventId = id('evt_recovered');
      await callWebhook(webhookPayload(seed, {
        eventId: recoveredEventId,
        event: 'PAYMENT_RECEIVED',
        paymentStatus: 'RECEIVED',
        dateCreated: '2026-09-19T10:02:00.000Z'
      }));
      const recovered = await waitForEvent(recoveredEventId);
      assert.equal(recovered.data.reversalOutcome, 'chargeback_recovered');
      assert.equal((await db.doc(`orders/${seed.orderId}`).get()).data().status, 'paid');
      assert.equal((await db.doc(`payment_transactions/${seed.transactionId}`).get()).data().status, 'paid');
      assert.equal((await db.doc(`enrollments/${seed.enrollmentId}`).get()).data().status, 'active');
      const evidence = (await db.doc(`financial_chargeback_recovery/${seed.transactionId}`).get()).data();
      assert.equal(evidence.status, 'consumed');
    });

    await test('evento positivo anterior ao chargeback nao restaura acesso', async () => {
      const seed = await seedFinancialState({ label: 'stale' });
      const chargebackEventId = id('evt_stale_chargeback');
      await callWebhook(webhookPayload(seed, {
        eventId: chargebackEventId,
        event: 'PAYMENT_CHARGEBACK_REQUESTED',
        paymentStatus: 'CHARGEBACK_REQUESTED',
        dateCreated: '2026-09-19T10:10:00.000Z'
      }));
      await waitForEvent(chargebackEventId);

      const staleEventId = id('evt_stale_positive');
      await callWebhook(webhookPayload(seed, {
        eventId: staleEventId,
        event: 'PAYMENT_RECEIVED',
        paymentStatus: 'RECEIVED',
        dateCreated: '2026-09-19T09:59:00.000Z'
      }));
      const stale = await waitForEvent(staleEventId);
      assert.equal(stale.data.reversalOutcome, 'stale_positive_ignored');
      assert.equal((await db.doc(`orders/${seed.orderId}`).get()).data().status, 'chargeback');
      assert.equal((await db.doc(`enrollments/${seed.enrollmentId}`).get()).data().status, 'chargeback');
    });

    await test('refund final entregue apos chargeback prevalece', async () => {
      const seed = await seedFinancialState({ label: 'refund_after_chargeback' });
      const chargebackEventId = id('evt_final_cb');
      await callWebhook(webhookPayload(seed, {
        eventId: chargebackEventId,
        event: 'PAYMENT_CHARGEBACK_REQUESTED',
        paymentStatus: 'CHARGEBACK_REQUESTED'
      }));
      await waitForEvent(chargebackEventId);

      const refundEventId = id('evt_final_refund');
      await callWebhook(webhookPayload(seed, {
        eventId: refundEventId,
        event: 'PAYMENT_REFUNDED',
        paymentStatus: 'REFUNDED',
        dateCreated: '2026-09-19T10:05:00.000Z'
      }));
      await waitForEvent(refundEventId);
      assert.equal((await db.doc(`orders/${seed.orderId}`).get()).data().status, 'refunded');
      assert.equal((await db.doc(`payment_transactions/${seed.transactionId}`).get()).data().status, 'refunded');
      assert.equal((await db.doc(`enrollments/${seed.enrollmentId}`).get()).data().status, 'refunded');
    });

    await test('reentrega HTTP do mesmo refund e idempotente e nao duplica auditoria', async () => {
      const seed = await seedFinancialState({ label: 'duplicate' });
      const providerEventId = id('evt_duplicate_refund');
      const payload = webhookPayload(seed, {
        eventId: providerEventId,
        event: 'PAYMENT_REFUNDED',
        paymentStatus: 'REFUNDED'
      });
      const firstResponse = await callWebhook(payload);
      assert.equal(firstResponse.status, 202, firstResponse.text);
      const event = await waitForEvent(providerEventId);
      const auditCount = (await auditsForRequest(event.id)).length;
      const secondResponse = await callWebhook(payload);
      assert.equal(secondResponse.status, 202, secondResponse.text);
      assert.equal(secondResponse.body.duplicate, true);
      await new Promise(resolve => setTimeout(resolve, 400));
      assert.equal((await auditsForRequest(event.id)).length, auditCount);
      assert.equal((await db.doc(`payment_webhook_events/${event.id}`).get()).data().deliveryCount, 2);
    });

    console.log(`FINANCIAL_REVERSAL_FUNCTIONS_EMULATOR_V1_2=${passed}/8`);
    if (passed !== 8) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error.stack || error);
  process.exitCode = 1;
  try { await cleanup(); } catch (_) {}
});
