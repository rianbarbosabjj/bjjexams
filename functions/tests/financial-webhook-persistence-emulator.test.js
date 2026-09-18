'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const {
  paymentWebhookEventDocumentId
} = require('../src/finance/financial-webhook-domain');
const {
  FinancialWebhookPersistenceError,
  createFinancialWebhookPersistence
} = require('../src/finance/financial-webhook-persistence');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-finance-webhook-persistence';
const app = initializeApp({ projectId }, `webhook-persistence-${process.pid}-${Date.now()}`);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let now = new Date('2026-09-18T20:30:00.000Z');
let passed = 0;

function id(label) {
  return `${label}_${runId}`;
}

function service() {
  return createFinancialWebhookPersistence({
    db,
    clock: () => new Date(now.getTime())
  });
}

function paymentPayload({
  eventId = id('evt'),
  event = 'PAYMENT_CONFIRMED',
  paymentId = id('pay'),
  value = 100,
  status = 'CONFIRMED',
  externalReference = id('order_ref'),
  customer = id('customer')
} = {}) {
  return {
    id: eventId,
    event,
    dateCreated: '2026-09-18 20:29:59',
    payment: {
      id: paymentId,
      customer,
      value,
      status,
      billingType: 'PIX',
      externalReference,
      name: 'nao-persistir',
      description: 'nao-persistir',
      deleted: false
    },
    account: {
      id: 'nao-persistir'
    }
  };
}

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

async function eventDoc(providerEventId) {
  const eventId = paymentWebhookEventDocumentId({
    provider: 'asaas',
    providerEventId
  });
  return db.doc(`payment_webhook_events/${eventId}`).get();
}

async function main() {
  try {
    await test('primeiro recebimento cria evento sanitizado em received', async () => {
      const providerEventId = id('evt_first');
      const payload = paymentPayload({ eventId: providerEventId });
      const result = await service().registerWebhookEvent({ payload });
      const snap = await eventDoc(providerEventId);

      assert.equal(result.created, true);
      assert.equal(result.duplicate, false);
      assert.equal(result.status, 'received');
      assert.equal(result.processingAction, 'confirm_payment');
      assert.equal(result.deliveryCount, 1);
      assert.equal(snap.exists, true);

      const data = snap.data();
      assert.equal(data.provider, 'asaas');
      assert.equal(data.providerEventId, providerEventId);
      assert.equal(data.eventType, 'PAYMENT_CONFIRMED');
      assert.equal(data.status, 'received');
      assert.equal(data.valueCents, 10000);
      assert.equal(data.deliveryCount, 1);
      assert.equal(data.processedAt, null);
      assert.equal(data.errorCode, null);
      assert.equal('payment' in data, false);
      assert.equal('account' in data, false);
      assert.equal('name' in data, false);
      assert.equal('description' in data, false);
    });

    await test('reentrega identica converge no mesmo documento', async () => {
      const providerEventId = id('evt_retry');
      const payload = paymentPayload({ eventId: providerEventId });
      const api = service();
      const first = await api.registerWebhookEvent({ payload });
      now = new Date(now.getTime() + 1000);
      const second = await api.registerWebhookEvent({ payload });
      const snap = await eventDoc(providerEventId);

      assert.equal(first.eventId, second.eventId);
      assert.equal(second.created, false);
      assert.equal(second.duplicate, true);
      assert.equal(second.deliveryCount, 2);
      assert.equal(snap.data().deliveryCount, 2);
      assert.equal(snap.data().status, 'received');
      assert.equal(
        snap.data().lastReceivedAt.toMillis() > snap.data().firstReceivedAt.toMillis(),
        true
      );
    });

    await test('duas entregas concorrentes criam somente um documento canonico', async () => {
      const providerEventId = id('evt_concurrent');
      const payload = paymentPayload({ eventId: providerEventId });
      const [left, right] = await Promise.all([
        service().registerWebhookEvent({ payload }),
        service().registerWebhookEvent({ payload })
      ]);
      const snap = await eventDoc(providerEventId);
      const query = await db.collection('payment_webhook_events')
        .where('providerEventId', '==', providerEventId)
        .get();

      assert.equal(left.eventId, right.eventId);
      assert.equal([left.created, right.created].filter(Boolean).length, 1);
      assert.equal([left.duplicate, right.duplicate].filter(Boolean).length, 1);
      assert.equal(query.size, 1);
      assert.equal(snap.data().deliveryCount, 2);
    });

    await test('reentrega com mesma event id e payment divergente falha fechado', async () => {
      const providerEventId = id('evt_mismatch');
      const firstPayload = paymentPayload({
        eventId: providerEventId,
        paymentId: id('pay_original')
      });
      const secondPayload = paymentPayload({
        eventId: providerEventId,
        paymentId: id('pay_tampered')
      });
      const api = service();
      await api.registerWebhookEvent({ payload: firstPayload });

      await assert.rejects(
        api.registerWebhookEvent({ payload: secondPayload }),
        error => error instanceof FinancialWebhookPersistenceError &&
          error.code === 'WEBHOOK_EVENT_REDELIVERY_MISMATCH'
      );

      const snap = await eventDoc(providerEventId);
      assert.equal(snap.data().providerPaymentId, firstPayload.payment.id);
      assert.equal(snap.data().deliveryCount, 1);
    });

    await test('PAYMENT_CREATED e persistido como ignored sem worker', async () => {
      const providerEventId = id('evt_created');
      const payload = paymentPayload({
        eventId: providerEventId,
        event: 'PAYMENT_CREATED',
        status: 'PENDING'
      });
      const result = await service().registerWebhookEvent({ payload });
      const snap = await eventDoc(providerEventId);

      assert.equal(result.status, 'ignored');
      assert.equal(result.processingAction, 'ignore');
      assert.equal(snap.data().processingReason, 'PAYMENT_EVENT_OUT_OF_SCOPE');
      assert.ok(snap.data().processedAt);
    });

    await test('refund fica ignored e explicitamente deferido ao Marco 5.5', async () => {
      const providerEventId = id('evt_refund');
      const payload = paymentPayload({
        eventId: providerEventId,
        event: 'PAYMENT_REFUNDED',
        status: 'REFUNDED'
      });
      await service().registerWebhookEvent({ payload });
      const snap = await eventDoc(providerEventId);

      assert.equal(snap.data().status, 'ignored');
      assert.equal(snap.data().processingReason, 'DEFERRED_TO_MARCO_5_5');
      assert.ok(snap.data().processedAt);
    });

    await test('evento nao financeiro e persistido sem objeto payment bruto', async () => {
      const providerEventId = id('evt_non_payment');
      const payload = {
        id: providerEventId,
        event: 'ACCOUNT_STATUS_CHANGED',
        dateCreated: '2026-09-18 20:29:59',
        account: { id: 'sensitive-provider-account' }
      };
      const result = await service().registerWebhookEvent({ payload });
      const snap = await eventDoc(providerEventId);

      assert.equal(result.status, 'ignored');
      assert.equal(snap.data().providerPaymentId, null);
      assert.equal(snap.data().valueCents, null);
      assert.equal(snap.data().processingReason, 'NON_PAYMENT_EVENT_OUT_OF_SCOPE');
      assert.equal('account' in snap.data(), false);
    });

    console.log(`FINANCIAL_WEBHOOK_PERSISTENCE_EMULATOR_V1_2=${passed}/7`);
    if (passed !== 7) process.exitCode = 1;
  } finally {
    await deleteApp(app);
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  try { await deleteApp(app); } catch (_) {}
});
