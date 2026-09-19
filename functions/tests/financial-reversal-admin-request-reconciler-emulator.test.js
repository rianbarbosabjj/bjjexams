'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const {
  REVERSAL_REQUESTS_COLLECTION,
  reversalRequestId
} = require('../src/finance/financial-reversal-admin-service');
const {
  createFinancialReversalAdminRequestReconciler
} = require('../src/finance/financial-reversal-admin-request-reconciler');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-finance-reversal-request-reconciler';
const app = initializeApp(
  { projectId },
  `reversal-request-reconciler-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;
let tick = 0;

function id(label) {
  return `${label}_${runId}`;
}

function clock() {
  const value = new Date(Date.parse('2026-09-19T18:00:00.000Z') + tick * 1000);
  tick += 1;
  return value;
}

function reconciler() {
  return createFinancialReversalAdminRequestReconciler({ db, clock });
}

async function seed({ eventType, operation, requestStatus = 'awaiting_webhook' }) {
  const orderId = id(`order_${eventType}`);
  const transactionId = id(`tx_${eventType}`);
  const providerPaymentId = id(`pay_${eventType}`);
  const eventId = id(`evt_${eventType}`);
  const requestId = reversalRequestId({ operation, transactionId });
  const createdAt = new Date('2026-09-19T17:00:00.000Z');

  await db.doc(`payment_webhook_events/${eventId}`).set({
    provider: 'asaas',
    eventType,
    status: 'processed',
    processingAction: 'reconcile_reversal',
    orderId,
    transactionId,
    providerPaymentId,
    processedAt: createdAt
  });

  await db.doc(`${REVERSAL_REQUESTS_COLLECTION}/${requestId}`).set({
    operation,
    orderId,
    transactionId,
    provider: 'asaas',
    providerPaymentId,
    status: requestStatus,
    reason: 'teste',
    createdBy: id('admin'),
    actorRole: 'super_admin',
    providerResultStatus: 'RECEIVED',
    errorCode: null,
    createdAt,
    updatedAt: createdAt,
    providerCompletedAt: createdAt
  });

  return { orderId, transactionId, providerPaymentId, eventId, requestId };
}

async function getRequest(requestId) {
  const snap = await db.doc(`${REVERSAL_REQUESTS_COLLECTION}/${requestId}`).get();
  return snap.exists ? snap.data() : null;
}

async function audits(eventId) {
  const snap = await db.collection('audit_logs').where('requestId', '==', eventId).get();
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
    for (const doc of snap.docs.slice(offset, offset + 400)) batch.delete(doc.ref);
    await batch.commit();
  }
}

async function cleanup() {
  for (const name of ['audit_logs', REVERSAL_REQUESTS_COLLECTION, 'payment_webhook_events']) {
    await deleteCollection(name);
  }
  await deleteApp(app);
}

async function main() {
  try {
    await test('PAYMENT_DELETED conclui request de cancelamento', async () => {
      const seeded = await seed({ eventType: 'PAYMENT_DELETED', operation: 'cancel_pending' });
      const result = await reconciler().reconcileProcessedEvent({ eventId: seeded.eventId });
      const request = await getRequest(seeded.requestId);
      assert.equal(result.reconciled, true);
      assert.equal(request.status, 'completed');
      assert.equal(request.providerLifecycleStatus, 'cancelled');
      assert.ok(request.completedAt);
    });

    await test('PAYMENT_REFUNDED conclui request de refund integral', async () => {
      const seeded = await seed({ eventType: 'PAYMENT_REFUNDED', operation: 'refund_full' });
      await reconciler().reconcileProcessedEvent({ eventId: seeded.eventId });
      const request = await getRequest(seeded.requestId);
      assert.equal(request.status, 'completed');
      assert.equal(request.providerLifecycleStatus, 'refunded');
      assert.equal(request.errorCode, null);
    });

    await test('PAYMENT_REFUND_IN_PROGRESS preserva awaiting_webhook', async () => {
      const seeded = await seed({ eventType: 'PAYMENT_REFUND_IN_PROGRESS', operation: 'refund_full' });
      await reconciler().reconcileProcessedEvent({ eventId: seeded.eventId });
      const request = await getRequest(seeded.requestId);
      assert.equal(request.status, 'awaiting_webhook');
      assert.equal(request.providerLifecycleStatus, 'in_progress');
      assert.equal(request.errorCode, null);
    });

    await test('PAYMENT_REFUND_DENIED exige reconciliacao e nao simula sucesso', async () => {
      const seeded = await seed({ eventType: 'PAYMENT_REFUND_DENIED', operation: 'refund_full' });
      const result = await reconciler().reconcileProcessedEvent({ eventId: seeded.eventId });
      const request = await getRequest(seeded.requestId);
      assert.equal(result.reviewRequired, true);
      assert.equal(request.status, 'needs_reconciliation');
      assert.equal(request.providerLifecycleStatus, 'denied');
      assert.equal(request.errorCode, 'REVERSAL_PROVIDER_REFUND_DENIED');
      assert.ok(request.reconciliationRequiredAt);
    });

    await test('PAYMENT_PARTIALLY_REFUNDED exige reconciliacao', async () => {
      const seeded = await seed({ eventType: 'PAYMENT_PARTIALLY_REFUNDED', operation: 'refund_full' });
      await reconciler().reconcileProcessedEvent({ eventId: seeded.eventId });
      const request = await getRequest(seeded.requestId);
      assert.equal(request.status, 'needs_reconciliation');
      assert.equal(request.providerLifecycleStatus, 'partial_refund');
      assert.equal(request.errorCode, 'REVERSAL_PROVIDER_PARTIAL_REFUND');
    });

    await test('evento sem request administrativo e no-op seguro', async () => {
      const eventId = id('evt_no_request');
      await db.doc(`payment_webhook_events/${eventId}`).set({
        provider: 'asaas',
        eventType: 'PAYMENT_REFUNDED',
        status: 'processed',
        processingAction: 'reconcile_reversal',
        orderId: id('order_no_request'),
        transactionId: id('tx_no_request'),
        providerPaymentId: id('pay_no_request')
      });
      const result = await reconciler().reconcileProcessedEvent({ eventId });
      assert.equal(result.reconciled, false);
      assert.equal(result.reason, 'ADMIN_REQUEST_NOT_FOUND');
    });

    await test('retry e idempotente e nao duplica auditoria', async () => {
      const seeded = await seed({ eventType: 'PAYMENT_REFUNDED', operation: 'refund_full' });
      const api = reconciler();
      const first = await api.reconcileProcessedEvent({ eventId: seeded.eventId });
      const auditCount = (await audits(seeded.eventId)).length;
      const second = await api.reconcileProcessedEvent({ eventId: seeded.eventId });
      assert.equal(first.reconciled, true);
      assert.equal(second.idempotent, true);
      assert.equal((await audits(seeded.eventId)).length, auditCount);
    });

    console.log(`FINANCIAL_REVERSAL_ADMIN_REQUEST_RECONCILER_EMULATOR_V1_2=${passed}/7`);
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
