'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

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
  FinancialWebhookFulfillmentError,
  createFinancialWebhookFulfillment
} = require('../src/finance/financial-webhook-fulfillment');
const {
  enrollmentDocumentId
} = require('../src/courses/course-enrollment-domain');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-finance-webhook-fulfillment';
const app = initializeApp({ projectId }, `webhook-fulfillment-${process.pid}-${Date.now()}`);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;
let clockTick = 0;

function id(label) {
  return `${label}_${runId}`;
}

function now() {
  const value = new Date(Date.parse('2026-09-18T18:00:00.000Z') + clockTick * 1000);
  clockTick += 1;
  return value;
}

function snapshot(courseId, amountCents = 1000) {
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
    recipientAllocations: [
      {
        recipientType: 'platform',
        recipientId: null,
        shareBps: 10000,
        amountCents: sellerPoolCents
      }
    ],
    resolvedAt: new Date('2026-09-18T17:55:00.000Z')
  };
}

function fakeProvider() {
  const payments = new Map();
  let calls = 0;
  return {
    payments,
    get calls() {
      return calls;
    },
    async getPaymentById(paymentId) {
      calls += 1;
      const value = payments.get(paymentId);
      if (value instanceof Error) throw value;
      return value ? { ...value } : null;
    }
  };
}

async function seedPendingCheckout({
  buyer = id('buyer'),
  courseId = id('course'),
  orderId = id('order'),
  paymentId = id('pay'),
  customerId = id('cus'),
  amountCents = 1000
} = {}) {
  const transactionId = paymentTransactionId({ provider: 'asaas', orderId });
  const createdAt = new Date('2026-09-18T17:50:00.000Z');
  const financialSnapshot = snapshot(courseId, amountCents);

  await db.doc(`orders/${orderId}`).set({
    buyerUserId: buyer,
    productType: 'course',
    productId: courseId,
    quantity: 1,
    amountCents,
    currency: 'BRL',
    status: 'pending_payment',
    financialSnapshot,
    provider: 'asaas',
    providerCustomerId: customerId,
    currentTransactionId: transactionId,
    idempotencyKey: id('intent'),
    createdAt,
    updatedAt: createdAt,
    paidAt: null,
    cancelledAt: null,
    expiredAt: null,
    refundedAt: null,
    chargebackAt: null
  });

  await db.doc(`payment_transactions/${transactionId}`).set({
    orderId,
    buyerUserId: buyer,
    provider: 'asaas',
    providerPaymentId: paymentId,
    providerStatus: 'PENDING',
    status: 'pending',
    amountCents,
    currency: 'BRL',
    financialSnapshot,
    providerSplitSnapshot: [],
    createdAt,
    updatedAt: createdAt,
    confirmedAt: null,
    refundedAt: null,
    chargebackAt: null
  });

  return {
    buyer,
    courseId,
    orderId,
    transactionId,
    paymentId,
    customerId,
    amountCents,
    externalReference: paymentExternalReference(orderId)
  };
}

function webhookPayload(seed, {
  eventId = id('evt'),
  event = 'PAYMENT_RECEIVED',
  paymentStatus = event === 'PAYMENT_CONFIRMED' ? 'CONFIRMED' : 'RECEIVED',
  value = seed.amountCents / 100,
  externalReference = seed.externalReference,
  customerId = seed.customerId,
  billingType = 'PIX'
} = {}) {
  return {
    id: eventId,
    event,
    dateCreated: '2026-09-18T18:00:00.000Z',
    payment: {
      id: seed.paymentId,
      status: paymentStatus,
      customer: customerId,
      externalReference,
      billingType,
      value
    }
  };
}

function providerPayment(seed, overrides = {}) {
  return {
    id: seed.paymentId,
    status: 'RECEIVED',
    customer: seed.customerId,
    externalReference: seed.externalReference,
    billingType: 'PIX',
    value: seed.amountCents / 100,
    ...overrides
  };
}

async function register(payload) {
  return createFinancialWebhookPersistence({ db, clock: now })
    .registerWebhookEvent({ payload });
}

function worker(provider) {
  return createFinancialWebhookFulfillment({ db, provider, clock: now });
}

async function auditsForRequest(eventId) {
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

async function main() {
  try {
    await test('PAYMENT_RECEIVED confirma finance e cria enrollment source order atomicamente', async () => {
      const seed = await seedPendingCheckout({
        buyer: id('buyer_happy'),
        courseId: id('course_happy'),
        orderId: id('order_happy'),
        paymentId: id('pay_happy'),
        customerId: id('cus_happy')
      });
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed));
      const received = await register(webhookPayload(seed, { eventId: id('evt_happy') }));
      const result = await worker(provider).processWebhookEvent({ eventId: received.eventId });

      assert.equal(result.processed, true);
      assert.equal(result.enrollmentCreated, true);

      const [orderSnap, txSnap, enrollmentSnap, eventSnap] = await Promise.all([
        db.doc(`orders/${seed.orderId}`).get(),
        db.doc(`payment_transactions/${seed.transactionId}`).get(),
        db.doc(`enrollments/${result.enrollmentId}`).get(),
        db.doc(`payment_webhook_events/${received.eventId}`).get()
      ]);

      assert.equal(orderSnap.data().status, 'paid');
      assert.ok(orderSnap.data().paidAt);
      assert.equal(txSnap.data().status, 'paid');
      assert.equal(txSnap.data().providerStatus, 'RECEIVED');
      assert.ok(txSnap.data().confirmedAt);
      assert.equal(enrollmentSnap.data().source, 'order');
      assert.equal(enrollmentSnap.data().orderId, seed.orderId);
      assert.equal(enrollmentSnap.data().status, 'active');
      assert.equal(eventSnap.data().status, 'processed');
      assert.equal(eventSnap.data().orderId, seed.orderId);
      assert.equal(eventSnap.data().transactionId, seed.transactionId);

      const audits = await auditsForRequest(received.eventId);
      assert.equal(audits.filter(item => item.action === 'financial.payment.confirmed').length, 1);
      assert.equal(audits.filter(item => item.action === 'course.enrollment.created').length, 1);
    });

    await test('retry do mesmo evento processado nao consulta provider nem duplica auditoria', async () => {
      const seed = await seedPendingCheckout({
        buyer: id('buyer_retry'),
        courseId: id('course_retry'),
        orderId: id('order_retry'),
        paymentId: id('pay_retry'),
        customerId: id('cus_retry')
      });
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed));
      const received = await register(webhookPayload(seed, { eventId: id('evt_retry') }));
      const api = worker(provider);
      const first = await api.processWebhookEvent({ eventId: received.eventId });
      const callsAfterFirst = provider.calls;
      const second = await api.processWebhookEvent({ eventId: received.eventId });

      assert.equal(first.processed, true);
      assert.equal(second.idempotent, true);
      assert.equal(provider.calls, callsAfterFirst);
      assert.equal((await auditsForRequest(received.eventId)).length, 2);
    });

    await test('segundo evento CONFIRMED RECEIVED converge no pagamento ja liquidado', async () => {
      const seed = await seedPendingCheckout({
        buyer: id('buyer_two_events'),
        courseId: id('course_two_events'),
        orderId: id('order_two_events'),
        paymentId: id('pay_two_events'),
        customerId: id('cus_two_events')
      });
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed, { status: 'CONFIRMED' }));
      const confirmed = await register(webhookPayload(seed, {
        eventId: id('evt_confirmed'),
        event: 'PAYMENT_CONFIRMED',
        paymentStatus: 'CONFIRMED'
      }));
      await worker(provider).processWebhookEvent({ eventId: confirmed.eventId });

      provider.payments.set(seed.paymentId, providerPayment(seed, { status: 'RECEIVED' }));
      const received = await register(webhookPayload(seed, {
        eventId: id('evt_received_after_confirmed'),
        event: 'PAYMENT_RECEIVED',
        paymentStatus: 'RECEIVED'
      }));
      const second = await worker(provider).processWebhookEvent({ eventId: received.eventId });

      assert.equal(second.processed, true);
      assert.equal(second.orderAlreadyPaid, true);
      assert.equal(second.enrollmentCreated, false);
      assert.equal((await auditsForRequest(received.eventId)).length, 0);
    });

    await test('processamento concorrente converge para um pagamento e uma matricula', async () => {
      const seed = await seedPendingCheckout({
        buyer: id('buyer_concurrent'),
        courseId: id('course_concurrent'),
        orderId: id('order_concurrent'),
        paymentId: id('pay_concurrent'),
        customerId: id('cus_concurrent')
      });
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed));
      const received = await register(webhookPayload(seed, { eventId: id('evt_concurrent') }));
      const api = worker(provider);
      const [left, right] = await Promise.all([
        api.processWebhookEvent({ eventId: received.eventId }),
        api.processWebhookEvent({ eventId: received.eventId })
      ]);

      assert.equal(left.processed, true);
      assert.equal(right.processed, true);
      const enrollmentId = enrollmentDocumentId(seed.courseId, seed.buyer);
      assert.equal((await db.doc(`enrollments/${enrollmentId}`).get()).exists, true);
      const audits = await auditsForRequest(received.eventId);
      assert.equal(audits.filter(item => item.action === 'financial.payment.confirmed').length, 1);
      assert.equal(audits.filter(item => item.action === 'course.enrollment.created').length, 1);
    });

    await test('divergencia de valor no provider falha fechado e marca evento error', async () => {
      const seed = await seedPendingCheckout({
        buyer: id('buyer_value_mismatch'),
        courseId: id('course_value_mismatch'),
        orderId: id('order_value_mismatch'),
        paymentId: id('pay_value_mismatch'),
        customerId: id('cus_value_mismatch')
      });
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed, { value: 11 }));
      const received = await register(webhookPayload(seed, { eventId: id('evt_value_mismatch') }));

      await assert.rejects(
        worker(provider).processWebhookEvent({ eventId: received.eventId }),
        error => error instanceof FinancialWebhookFulfillmentError &&
          error.code === 'WEBHOOK_PROVIDER_PROJECTION_MISMATCH'
      );

      assert.equal((await db.doc(`orders/${seed.orderId}`).get()).data().status, 'pending_payment');
      assert.equal((await db.doc(`payment_transactions/${seed.transactionId}`).get()).data().status, 'pending');
      assert.equal((await db.doc(`payment_webhook_events/${received.eventId}`).get()).data().status, 'error');
      assert.equal((await db.collection('enrollments').where('userId', '==', seed.buyer).get()).empty, true);
    });

    await test('provider ainda PENDING e retryable sem consumir evento', async () => {
      const seed = await seedPendingCheckout({
        buyer: id('buyer_pending_provider'),
        courseId: id('course_pending_provider'),
        orderId: id('order_pending_provider'),
        paymentId: id('pay_pending_provider'),
        customerId: id('cus_pending_provider')
      });
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed, { status: 'PENDING' }));
      const received = await register(webhookPayload(seed, { eventId: id('evt_pending_provider') }));

      await assert.rejects(
        worker(provider).processWebhookEvent({ eventId: received.eventId }),
        error => error instanceof FinancialWebhookFulfillmentError &&
          error.code === 'PROVIDER_PAYMENT_NOT_CONFIRMED' &&
          error.retryable === true
      );

      assert.equal((await db.doc(`payment_webhook_events/${received.eventId}`).get()).data().status, 'received');
      assert.equal((await db.doc(`orders/${seed.orderId}`).get()).data().status, 'pending_payment');
    });

    await test('enrollment conflitante impede mutacao financeira e marca evento error', async () => {
      const seed = await seedPendingCheckout({
        buyer: id('buyer_conflict'),
        courseId: id('course_conflict'),
        orderId: id('order_conflict'),
        paymentId: id('pay_conflict'),
        customerId: id('cus_conflict')
      });
      const enrollmentId = enrollmentDocumentId(seed.courseId, seed.buyer);
      const createdAt = new Date('2026-09-18T17:58:00.000Z');
      await db.doc(`enrollments/${enrollmentId}`).set({
        courseId: seed.courseId,
        userId: seed.buyer,
        source: 'admin_grant',
        orderId: null,
        status: 'active',
        progressPercent: 0,
        startedAt: createdAt,
        completedAt: null,
        createdAt,
        updatedAt: createdAt
      });

      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed));
      const received = await register(webhookPayload(seed, { eventId: id('evt_conflict') }));

      await assert.rejects(
        worker(provider).processWebhookEvent({ eventId: received.eventId }),
        error => error instanceof FinancialWebhookFulfillmentError &&
          error.code === 'EXISTING_ENROLLMENT_CONFLICT'
      );

      assert.equal((await db.doc(`orders/${seed.orderId}`).get()).data().status, 'pending_payment');
      assert.equal((await db.doc(`payment_webhook_events/${received.eventId}`).get()).data().status, 'error');
    });

    await test('externalReference nao canonica falha antes de consultar estado financeiro', async () => {
      const seed = await seedPendingCheckout({
        buyer: id('buyer_bad_ref'),
        courseId: id('course_bad_ref'),
        orderId: id('order_bad_ref'),
        paymentId: id('pay_bad_ref'),
        customerId: id('cus_bad_ref')
      });
      const badReference = 'OUTRO-SISTEMA-123';
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed, { externalReference: badReference }));
      const received = await register(webhookPayload(seed, {
        eventId: id('evt_bad_ref'),
        externalReference: badReference
      }));

      await assert.rejects(
        worker(provider).processWebhookEvent({ eventId: received.eventId }),
        error => error instanceof FinancialWebhookFulfillmentError &&
          error.code === 'INVALID_PAYMENT_EXTERNAL_REFERENCE'
      );

      assert.equal((await db.doc(`payment_webhook_events/${received.eventId}`).get()).data().status, 'error');
      assert.equal((await db.doc(`orders/${seed.orderId}`).get()).data().status, 'pending_payment');
    });

    await test('worker canonico nao escreve nem importa pedidos ou matriculas legados', async () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../src/finance/financial-webhook-fulfillment.js'),
        'utf8'
      );
      for (const forbidden of [
        "collection('pedidos')",
        'collection("pedidos")',
        "collection('matriculas')",
        'collection("matriculas")',
        "doc('pedidos/",
        'doc("pedidos/',
        "doc('matriculas/",
        'doc("matriculas/'
      ]) {
        assert.equal(source.includes(forbidden), false, `Dependencia proibida: ${forbidden}`);
      }

      assert.equal((await db.collection('pedidos').limit(1).get()).empty, true);
      assert.equal((await db.collection('matriculas').limit(1).get()).empty, true);
    });

    console.log(`FINANCIAL_WEBHOOK_FULFILLMENT_EMULATOR_V1_2=${passed}/9`);
    if (passed !== 9) process.exitCode = 1;
  } finally {
    await deleteApp(app);
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
