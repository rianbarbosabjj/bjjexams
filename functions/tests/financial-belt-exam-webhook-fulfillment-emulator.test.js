'use strict';

const assert = require('node:assert/strict');
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
  createFinancialBeltExamWebhookFulfillment,
  FinancialBeltExamWebhookFulfillmentError,
  isBeltExamPaymentConfirmation
} = require('../src/finance/financial-belt-exam-webhook-fulfillment');
const {
  createWebhookWorkerHandler
} = require('../src/finance/financial-webhook-functions');
const {
  buildSelectedExamRegistration,
  markRegistrationAwaitingPayment,
  examRegistrationDocumentId
} = require('../src/exams/exam-registration-domain');
const {
  enrollmentDocumentId
} = require('../src/courses/course-enrollment-domain');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-belt-exam-webhook';
const app = initializeApp(
  { projectId },
  `belt-exam-webhook-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;
let clockTick = 0;

function id(label) {
  return `${label}_${runId}`;
}

function now() {
  const value = new Date(Date.parse('2026-09-20T04:00:00.000Z') + clockTick * 1000);
  clockTick += 1;
  return value;
}

function financialSnapshot(productType, productId, amountCents, recipientType = 'organization', recipientId = null) {
  const platformFeeCents = Math.round(amountCents * 0.10);
  const sellerPoolCents = amountCents - platformFeeCents;
  return {
    ruleId: 'platform-default',
    ruleVersion: 1,
    productType,
    productId,
    currency: 'BRL',
    grossAmountCents: amountCents,
    platformFeeBps: 1000,
    platformFeeCents,
    sellerPoolCents,
    recipientMode: 'product_owner',
    recipientAllocations: [
      {
        recipientType,
        recipientId: recipientType === 'platform' ? null : recipientId,
        shareBps: 10000,
        amountCents: sellerPoolCents
      }
    ],
    resolvedAt: new Date('2026-09-20T03:55:00.000Z')
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

async function seedPendingBeltExam({
  buyer = id('buyer'),
  sessionId = id('session'),
  orderId = id('order'),
  paymentId = id('pay'),
  customerId = id('cus'),
  organizationId = id('org'),
  amountCents = 5000
} = {}) {
  const transactionId = paymentTransactionId({ provider: 'asaas', orderId });
  const registrationId = examRegistrationDocumentId({
    sessionId,
    studentId: buyer
  });
  const createdAt = new Date('2026-09-20T03:50:00.000Z');
  const snapshot = financialSnapshot(
    'belt_exam',
    sessionId,
    amountCents,
    'organization',
    organizationId
  );

  await db.doc(`orders/${orderId}`).set({
    buyerUserId: buyer,
    productType: 'belt_exam',
    productId: sessionId,
    quantity: 1,
    amountCents,
    currency: 'BRL',
    status: 'pending_payment',
    financialSnapshot: snapshot,
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
    financialSnapshot: snapshot,
    providerSplitSnapshot: [],
    createdAt,
    updatedAt: createdAt,
    confirmedAt: null,
    refundedAt: null,
    chargebackAt: null
  });

  const selected = buildSelectedExamRegistration({
    sessionId,
    organizationId,
    studentId: buyer,
    instructorId: id('instructor'),
    currentBelt: 'Branca',
    targetBelt: 'Azul',
    membershipId: id('membership'),
    timestamp: createdAt
  });
  const registration = markRegistrationAwaitingPayment(selected, {
    orderId,
    updatedAt: createdAt
  });
  await db.doc(`exam_registrations/${registrationId}`).set(registration);

  return {
    buyer,
    sessionId,
    orderId,
    transactionId,
    registrationId,
    paymentId,
    customerId,
    organizationId,
    amountCents,
    externalReference: paymentExternalReference(orderId)
  };
}

async function seedPendingCourse({
  buyer = id('course_buyer'),
  courseId = id('course'),
  orderId = id('course_order'),
  paymentId = id('course_pay'),
  customerId = id('course_cus'),
  amountCents = 2000
} = {}) {
  const transactionId = paymentTransactionId({ provider: 'asaas', orderId });
  const createdAt = new Date('2026-09-20T03:50:00.000Z');
  const snapshot = financialSnapshot(
    'course',
    courseId,
    amountCents,
    'platform',
    null
  );

  await db.doc(`orders/${orderId}`).set({
    buyerUserId: buyer,
    productType: 'course',
    productId: courseId,
    quantity: 1,
    amountCents,
    currency: 'BRL',
    status: 'pending_payment',
    financialSnapshot: snapshot,
    provider: 'asaas',
    providerCustomerId: customerId,
    currentTransactionId: transactionId,
    idempotencyKey: id('course_intent'),
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
    financialSnapshot: snapshot,
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
  value = seed.amountCents / 100
} = {}) {
  return {
    id: eventId,
    event,
    dateCreated: '2026-09-20T04:00:00.000Z',
    payment: {
      id: seed.paymentId,
      status: paymentStatus,
      customer: seed.customerId,
      externalReference: seed.externalReference,
      billingType: 'PIX',
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

function fulfillment(provider) {
  return createFinancialBeltExamWebhookFulfillment({ db, provider, clock: now });
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
    'enrollments',
    'exam_registrations'
  ]) {
    await deleteCollection(name);
  }
  await deleteApp(app);
}

async function main() {
  try {
    await test('PAYMENT_RECEIVED paga order transaction e autoriza registration atomicamente', async () => {
      const seed = await seedPendingBeltExam({
        buyer: id('buyer_happy'),
        sessionId: id('session_happy'),
        orderId: id('order_happy'),
        paymentId: id('pay_happy'),
        customerId: id('cus_happy'),
        organizationId: id('org_happy')
      });
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed));
      const received = await register(webhookPayload(seed, { eventId: id('evt_happy') }));
      const result = await fulfillment(provider).processWebhookEvent({
        eventId: received.eventId
      });

      assert.equal(result.processed, true);
      assert.equal(result.registrationAuthorized, true);
      const [orderSnap, txSnap, registrationSnap, eventSnap] = await Promise.all([
        db.doc(`orders/${seed.orderId}`).get(),
        db.doc(`payment_transactions/${seed.transactionId}`).get(),
        db.doc(`exam_registrations/${seed.registrationId}`).get(),
        db.doc(`payment_webhook_events/${received.eventId}`).get()
      ]);
      assert.equal(orderSnap.data().status, 'paid');
      assert.ok(orderSnap.data().paidAt);
      assert.equal(txSnap.data().status, 'paid');
      assert.equal(txSnap.data().providerStatus, 'RECEIVED');
      assert.ok(txSnap.data().confirmedAt);
      assert.equal(registrationSnap.data().status, 'authorized');
      assert.equal(registrationSnap.data().orderId, seed.orderId);
      assert.ok(registrationSnap.data().paidAt);
      assert.ok(registrationSnap.data().authorizedAt);
      assert.equal(eventSnap.data().status, 'processed');
      assert.equal(eventSnap.data().registrationId, seed.registrationId);
      assert.equal(eventSnap.data().registrationAuthorized, true);
      assert.equal((await db.collection('enrollments').get()).empty, true);

      const audits = await auditsForRequest(received.eventId);
      assert.equal(audits.filter(item => item.action === 'financial.payment.confirmed').length, 1);
      assert.equal(audits.filter(item => item.action === 'exam.registration.authorized').length, 1);
    });

    await test('retry do mesmo evento processado nao consulta provider nem duplica auditoria', async () => {
      const seed = await seedPendingBeltExam({
        buyer: id('buyer_retry'),
        sessionId: id('session_retry'),
        orderId: id('order_retry'),
        paymentId: id('pay_retry'),
        customerId: id('cus_retry'),
        organizationId: id('org_retry')
      });
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed));
      const received = await register(webhookPayload(seed, { eventId: id('evt_retry') }));
      const api = fulfillment(provider);
      const first = await api.processWebhookEvent({ eventId: received.eventId });
      const callsAfterFirst = provider.calls;
      const second = await api.processWebhookEvent({ eventId: received.eventId });

      assert.equal(first.processed, true);
      assert.equal(second.idempotent, true);
      assert.equal(provider.calls, callsAfterFirst);
      assert.equal((await auditsForRequest(received.eventId)).length, 2);
    });

    await test('segundo evento positivo nao regride registration ja iniciada', async () => {
      const seed = await seedPendingBeltExam({
        buyer: id('buyer_started'),
        sessionId: id('session_started'),
        orderId: id('order_started'),
        paymentId: id('pay_started'),
        customerId: id('cus_started'),
        organizationId: id('org_started')
      });
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed, { status: 'CONFIRMED' }));
      const firstEvent = await register(webhookPayload(seed, {
        eventId: id('evt_started_confirmed'),
        event: 'PAYMENT_CONFIRMED',
        paymentStatus: 'CONFIRMED'
      }));
      await fulfillment(provider).processWebhookEvent({ eventId: firstEvent.eventId });

      const registrationRef = db.doc(`exam_registrations/${seed.registrationId}`);
      const authorized = (await registrationRef.get()).data();
      await registrationRef.set({
        ...authorized,
        status: 'started',
        attemptId: id('attempt_started'),
        updatedAt: now()
      });

      provider.payments.set(seed.paymentId, providerPayment(seed, { status: 'RECEIVED' }));
      const secondEvent = await register(webhookPayload(seed, {
        eventId: id('evt_started_received'),
        event: 'PAYMENT_RECEIVED',
        paymentStatus: 'RECEIVED'
      }));
      const result = await fulfillment(provider).processWebhookEvent({
        eventId: secondEvent.eventId
      });

      assert.equal(result.processed, true);
      assert.equal(result.orderAlreadyPaid, true);
      assert.equal(result.registrationAuthorized, false);
      assert.equal((await registrationRef.get()).data().status, 'started');
      assert.equal((await auditsForRequest(secondEvent.eventId)).length, 0);
    });

    await test('divergencia de valor no provider falha fechado e preserva awaiting_payment', async () => {
      const seed = await seedPendingBeltExam({
        buyer: id('buyer_value'),
        sessionId: id('session_value'),
        orderId: id('order_value'),
        paymentId: id('pay_value'),
        customerId: id('cus_value'),
        organizationId: id('org_value')
      });
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed, { value: 51 }));
      const received = await register(webhookPayload(seed, { eventId: id('evt_value') }));

      await assert.rejects(
        fulfillment(provider).processWebhookEvent({ eventId: received.eventId }),
        error => error instanceof FinancialBeltExamWebhookFulfillmentError &&
          error.code === 'BELT_EXAM_WEBHOOK_PROVIDER_PROJECTION_MISMATCH'
      );

      assert.equal((await db.doc(`orders/${seed.orderId}`).get()).data().status, 'pending_payment');
      assert.equal((await db.doc(`payment_transactions/${seed.transactionId}`).get()).data().status, 'pending');
      assert.equal((await db.doc(`exam_registrations/${seed.registrationId}`).get()).data().status, 'awaiting_payment');
      assert.equal((await db.doc(`payment_webhook_events/${received.eventId}`).get()).data().status, 'error');
    });

    await test('provider PENDING e retryable sem consumir evento', async () => {
      const seed = await seedPendingBeltExam({
        buyer: id('buyer_pending'),
        sessionId: id('session_pending'),
        orderId: id('order_pending'),
        paymentId: id('pay_pending'),
        customerId: id('cus_pending'),
        organizationId: id('org_pending')
      });
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed, { status: 'PENDING' }));
      const received = await register(webhookPayload(seed, { eventId: id('evt_pending') }));

      await assert.rejects(
        fulfillment(provider).processWebhookEvent({ eventId: received.eventId }),
        error => error instanceof FinancialBeltExamWebhookFulfillmentError &&
          error.code === 'PROVIDER_PAYMENT_NOT_CONFIRMED' &&
          error.retryable === true
      );

      assert.equal((await db.doc(`payment_webhook_events/${received.eventId}`).get()).data().status, 'received');
      assert.equal((await db.doc(`exam_registrations/${seed.registrationId}`).get()).data().status, 'awaiting_payment');
    });

    await test('registration ausente impede liquidacao financeira e marca evento error', async () => {
      const seed = await seedPendingBeltExam({
        buyer: id('buyer_missing_reg'),
        sessionId: id('session_missing_reg'),
        orderId: id('order_missing_reg'),
        paymentId: id('pay_missing_reg'),
        customerId: id('cus_missing_reg'),
        organizationId: id('org_missing_reg')
      });
      await db.doc(`exam_registrations/${seed.registrationId}`).delete();
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed));
      const received = await register(webhookPayload(seed, { eventId: id('evt_missing_reg') }));

      await assert.rejects(
        fulfillment(provider).processWebhookEvent({ eventId: received.eventId }),
        error => error instanceof FinancialBeltExamWebhookFulfillmentError &&
          error.code === 'BELT_EXAM_REGISTRATION_NOT_FOUND'
      );

      assert.equal((await db.doc(`orders/${seed.orderId}`).get()).data().status, 'pending_payment');
      assert.equal((await db.doc(`payment_transactions/${seed.transactionId}`).get()).data().status, 'pending');
      assert.equal((await db.doc(`payment_webhook_events/${received.eventId}`).get()).data().status, 'error');
    });

    await test('registration ligada a outro order impede autorizacao', async () => {
      const seed = await seedPendingBeltExam({
        buyer: id('buyer_wrong_order'),
        sessionId: id('session_wrong_order'),
        orderId: id('order_wrong_order'),
        paymentId: id('pay_wrong_order'),
        customerId: id('cus_wrong_order'),
        organizationId: id('org_wrong_order')
      });
      const registrationRef = db.doc(`exam_registrations/${seed.registrationId}`);
      const registration = (await registrationRef.get()).data();
      await registrationRef.set({
        ...registration,
        orderId: id('other_order'),
        updatedAt: now()
      });
      const provider = fakeProvider();
      provider.payments.set(seed.paymentId, providerPayment(seed));
      const received = await register(webhookPayload(seed, { eventId: id('evt_wrong_order') }));

      await assert.rejects(
        fulfillment(provider).processWebhookEvent({ eventId: received.eventId }),
        error => error instanceof FinancialBeltExamWebhookFulfillmentError &&
          error.code === 'BELT_EXAM_REGISTRATION_PAYMENT_IDENTITY_MISMATCH'
      );

      assert.equal((await db.doc(`orders/${seed.orderId}`).get()).data().status, 'pending_payment');
      assert.equal((await registrationRef.get()).data().status, 'awaiting_payment');
    });

    await test('router identifica belt_exam sem confundir pedido course', async () => {
      const belt = await seedPendingBeltExam({
        buyer: id('buyer_route_belt'),
        sessionId: id('session_route_belt'),
        orderId: id('order_route_belt'),
        paymentId: id('pay_route_belt'),
        customerId: id('cus_route_belt'),
        organizationId: id('org_route_belt')
      });
      const course = await seedPendingCourse({
        buyer: id('buyer_route_course'),
        courseId: id('course_route_course'),
        orderId: id('order_route_course'),
        paymentId: id('pay_route_course'),
        customerId: id('cus_route_course')
      });
      const beltEvent = await register(webhookPayload(belt, { eventId: id('evt_route_belt') }));
      const courseEvent = await register(webhookPayload(course, { eventId: id('evt_route_course') }));
      const beltData = (await db.doc(`payment_webhook_events/${beltEvent.eventId}`).get()).data();
      const courseData = (await db.doc(`payment_webhook_events/${courseEvent.eventId}`).get()).data();

      assert.equal(await isBeltExamPaymentConfirmation({ db, event: beltData }), true);
      assert.equal(await isBeltExamPaymentConfirmation({ db, event: courseData }), false);
    });

    await test('worker despacha belt_exam para registration e course para enrollment', async () => {
      const belt = await seedPendingBeltExam({
        buyer: id('buyer_dispatch_belt'),
        sessionId: id('session_dispatch_belt'),
        orderId: id('order_dispatch_belt'),
        paymentId: id('pay_dispatch_belt'),
        customerId: id('cus_dispatch_belt'),
        organizationId: id('org_dispatch_belt')
      });
      const course = await seedPendingCourse({
        buyer: id('buyer_dispatch_course'),
        courseId: id('course_dispatch_course'),
        orderId: id('order_dispatch_course'),
        paymentId: id('pay_dispatch_course'),
        customerId: id('cus_dispatch_course')
      });
      const provider = fakeProvider();
      provider.payments.set(belt.paymentId, providerPayment(belt));
      provider.payments.set(course.paymentId, providerPayment(course));
      const beltEvent = await register(webhookPayload(belt, { eventId: id('evt_dispatch_belt') }));
      const courseEvent = await register(webhookPayload(course, { eventId: id('evt_dispatch_course') }));
      const worker = createWebhookWorkerHandler({
        db,
        providerFactory: () => provider,
        clock: now
      });

      const beltSnap = await db.doc(`payment_webhook_events/${beltEvent.eventId}`).get();
      const beltResult = await worker({
        params: { eventId: beltEvent.eventId },
        data: beltSnap
      });
      assert.equal(beltResult.processed, true);
      assert.equal(beltResult.registrationAuthorized, true);
      assert.equal((await db.doc(`exam_registrations/${belt.registrationId}`).get()).data().status, 'authorized');

      const courseSnap = await db.doc(`payment_webhook_events/${courseEvent.eventId}`).get();
      const courseResult = await worker({
        params: { eventId: courseEvent.eventId },
        data: courseSnap
      });
      assert.equal(courseResult.processed, true);
      assert.equal(courseResult.enrollmentCreated, true);
      const courseEnrollmentId = enrollmentDocumentId(course.courseId, course.buyer);
      assert.equal((await db.doc(`enrollments/${courseEnrollmentId}`).get()).data().status, 'active');
      assert.equal((await db.collection('enrollments').where('userId', '==', belt.buyer).get()).empty, true);
    });

    console.log(`BELT_EXAM_WEBHOOK_FULFILLMENT_EMULATOR_V1_2=${passed}/9`);
    if (passed !== 9) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  try { await cleanup(); } catch (_) {}
});
