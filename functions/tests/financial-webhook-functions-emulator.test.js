'use strict';

const assert = require('node:assert/strict');
const {
  initializeApp,
  deleteApp
} = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const {
  financialRecipientAccountId
} = require('../src/finance/financial-admin-domain');
const {
  paymentWebhookEventDocumentId
} = require('../src/finance/financial-webhook-domain');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);
assertLocal('FIREBASE_AUTH_EMULATOR_HOST', process.env.FIREBASE_AUTH_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-webhook-functions';
const functionBase =
  `http://127.0.0.1:5001/${projectId}/southamerica-east1`;
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const webhookToken = String(process.env.BJJ_EXAMS_WEBHOOK_TOKEN || '').trim();
if (!webhookToken) {
  throw new Error('BJJ_EXAMS_WEBHOOK_TOKEN e obrigatorio no teste do Functions Emulator.');
}

const app = initializeApp(
  { projectId },
  `financial-webhook-functions-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const auth = getAuth(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const createdUids = new Set();
let passed = 0;

function id(label) {
  return `webhook_${label}_${runId}`;
}

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

async function createUser(label) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  const password = `Webhook-${runId}-${label}!Aa1`;
  await auth.createUser({
    uid,
    email,
    password,
    emailVerified: true
  });
  createdUids.add(uid);
  await db.doc(`usuarios/${uid}`).set({
    nome: `USUARIO ${label}`,
    email,
    cpf: '12345678901',
    telefone: '61999990000',
    status_conta: 'ativo'
  });
  return { uid, email, password };
}

async function signIn(actor) {
  const response = await fetch(
    `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: actor.email,
        password: actor.password,
        returnSecureToken: true
      })
    }
  );
  const body = await response.json();
  assert.ok(body.idToken, JSON.stringify(body));
  return body.idToken;
}

async function callCheckout(token, data) {
  const response = await fetch(
    `${functionBase}/iniciarCheckoutCursoV12`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ data })
    }
  );
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch (_) {}
  return {
    status: response.status,
    body,
    text,
    payload: body?.result ?? body?.data ?? null
  };
}

async function callWebhook({
  method = 'POST',
  token = webhookToken,
  payload = null
} = {}) {
  const headers = {};
  if (token !== null && token !== undefined) {
    headers['asaas-access-token'] = token;
  }
  if (payload !== null) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(
    `${functionBase}/webhookAsaasPagamentosV12`,
    {
      method,
      headers,
      body: method === 'POST' && payload !== null
        ? JSON.stringify(payload)
        : undefined
    }
  );
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch (_) {}
  return { status: response.status, body, text };
}

function defaultRule() {
  return {
    name: 'Regra padrao da plataforma',
    status: 'active',
    scope: 'platform_default',
    productType: null,
    productId: null,
    platformFeeBps: 1000,
    recipientMode: 'product_owner',
    recipientShares: [],
    version: 1,
    createdBy: id('admin'),
    updatedBy: id('admin'),
    createdAt: new Date('2026-09-18T10:00:00.000Z'),
    updatedAt: new Date('2026-09-18T10:00:00.000Z')
  };
}

async function seedPaidCourse({ courseId, ownerId, walletId }) {
  await db.doc(`courses/${courseId}`).set({
    title: 'Curso webhook functions',
    status: 'published',
    visibility: 'platform',
    isPaid: true,
    priceCents: 10000,
    currency: 'BRL',
    ownerType: 'user',
    ownerId,
    instructorIds: [ownerId],
    financialRuleId: null
  });
  await db.doc('financial_rules/platform-default').set(defaultRule());
  const accountId = financialRecipientAccountId({
    provider: 'asaas',
    environment: 'sandbox',
    recipientType: 'user',
    recipientId: ownerId
  });
  await db.doc(`financial_recipient_accounts/${accountId}`).set({
    recipientType: 'user',
    recipientId: ownerId,
    provider: 'asaas',
    environment: 'sandbox',
    walletId,
    status: 'ready',
    version: 1,
    createdBy: id('admin'),
    updatedBy: id('admin'),
    createdAt: new Date('2026-09-18T10:00:00.000Z'),
    updatedAt: new Date('2026-09-18T10:00:00.000Z')
  });
}

async function countCollection(name) {
  return (await db.collection(name).get()).size;
}

async function countAudits(action) {
  const snap = await db.collection('audit_logs').get();
  return snap.docs.filter(doc => doc.data().action === action).length;
}

async function waitForEventStatus(eventDocumentId, expectedStatus, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const snap = await db.doc(`payment_webhook_events/${eventDocumentId}`).get();
    if (snap.exists && snap.data().status === expectedStatus) {
      return snap.data();
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const finalSnap = await db.doc(`payment_webhook_events/${eventDocumentId}`).get();
  throw new Error(
    `Timeout aguardando webhook ${eventDocumentId}=${expectedStatus}; atual=` +
    `${finalSnap.exists ? finalSnap.data().status : '<MISSING>'}`
  );
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
    'financial_checkout_leases',
    'financial_provider_customers',
    'financial_recipient_accounts',
    'payment_transactions',
    'payment_webhook_events',
    'orders',
    'enrollments',
    'courses',
    'financial_rules',
    'pedidos',
    'matriculas',
    'usuarios'
  ]) {
    await deleteCollection(name);
  }
  await Promise.allSettled([...createdUids].map(uid => auth.deleteUser(uid)));
  await deleteApp(app);
}

async function main() {
  try {
    await test('ingress rejeita metodo diferente de POST sem persistir', async () => {
      const response = await callWebhook({ method: 'GET' });
      assert.equal(response.status, 405, response.text);
      assert.equal(await countCollection('payment_webhook_events'), 0);
    });

    await test('ingress rejeita token ausente antes de persistir', async () => {
      const response = await callWebhook({
        token: null,
        payload: { id: id('unauth'), event: 'PAYMENT_CREATED', payment: { id: id('pay') } }
      });
      assert.equal(response.status, 401, response.text);
      assert.equal(await countCollection('payment_webhook_events'), 0);
    });

    await test('ingress rejeita token divergente antes de persistir', async () => {
      const response = await callWebhook({
        token: `${webhookToken}-wrong`,
        payload: { id: id('wrong'), event: 'PAYMENT_CREATED', payment: { id: id('pay2') } }
      });
      assert.equal(response.status, 403, response.text);
      assert.equal(await countCollection('payment_webhook_events'), 0);
    });

    await test('payload financeiro incompleto retorna 400 sem documento', async () => {
      const response = await callWebhook({
        payload: { id: id('invalid'), event: 'PAYMENT_RECEIVED' }
      });
      assert.equal(response.status, 400, response.text);
      assert.equal(await countCollection('payment_webhook_events'), 0);
    });

    await test('evento fora do escopo e aceito e persistido como ignored', async () => {
      const providerEventId = id('created_event');
      const response = await callWebhook({
        payload: {
          id: providerEventId,
          event: 'PAYMENT_CREATED',
          dateCreated: '2026-09-18T20:00:00.000Z',
          payment: {
            id: id('created_payment'),
            status: 'PENDING',
            customer: id('created_customer'),
            externalReference: `BJJEX-V12-ORDER-${id('created_order')}`,
            billingType: 'PIX',
            value: 100
          }
        }
      });
      assert.equal(response.status, 202, response.text);
      assert.equal(response.body.accepted, true);
      assert.equal(response.body.status, 'ignored');
      const eventDocumentId = paymentWebhookEventDocumentId({
        provider: 'asaas',
        providerEventId
      });
      const event = await waitForEventStatus(eventDocumentId, 'ignored');
      assert.equal(event.processingReason, 'PAYMENT_EVENT_OUT_OF_SCOPE');
    });

    const buyer = await createUser('buyer');
    const owner = await createUser('owner');
    const token = await signIn(buyer);
    const courseId = id('course');
    await seedPaidCourse({
      courseId,
      ownerId: owner.uid,
      walletId: id('wallet')
    });
    const checkout = await callCheckout(token, {
      courseId,
      idempotencyKey: id('checkout_intent')
    });
    assert.equal(checkout.status, 200, checkout.text);
    assert.equal(checkout.payload?.status, 'pending_payment');
    assert.ok(checkout.payload?.paymentId);

    const orderId = checkout.payload.orderId;
    const transactionId = checkout.payload.transactionId;
    const paymentId = checkout.payload.paymentId;
    const orderBefore = (await db.doc(`orders/${orderId}`).get()).data();
    assert.equal(orderBefore.status, 'pending_payment');
    assert.equal(await countCollection('enrollments'), 0);

    const providerEventId = id('received_event');
    const eventDocumentId = paymentWebhookEventDocumentId({
      provider: 'asaas',
      providerEventId
    });
    const receivedPayload = {
      id: providerEventId,
      event: 'PAYMENT_RECEIVED',
      dateCreated: '2026-09-18T20:05:00.000Z',
      payment: {
        id: paymentId,
        status: 'RECEIVED',
        customer: orderBefore.providerCustomerId,
        externalReference: `BJJEX-V12-ORDER-${orderId}`,
        billingType: 'PIX',
        value: 100
      }
    };

    await test('PAYMENT_RECEIVED persiste antes do 202 e worker concede entitlement', async () => {
      const response = await callWebhook({ payload: receivedPayload });
      assert.equal(response.status, 202, response.text);
      assert.equal(response.body.accepted, true);
      assert.equal(response.body.duplicate, false);

      const event = await waitForEventStatus(eventDocumentId, 'processed');
      assert.equal(event.orderId, orderId);
      assert.equal(event.transactionId, transactionId);
      assert.ok(event.enrollmentId);

      const [orderSnap, transactionSnap, enrollmentSnap] = await Promise.all([
        db.doc(`orders/${orderId}`).get(),
        db.doc(`payment_transactions/${transactionId}`).get(),
        db.doc(`enrollments/${event.enrollmentId}`).get()
      ]);
      assert.equal(orderSnap.data().status, 'paid');
      assert.equal(transactionSnap.data().status, 'paid');
      assert.equal(transactionSnap.data().providerStatus, 'RECEIVED');
      assert.equal(enrollmentSnap.exists, true);
      assert.equal(enrollmentSnap.data().source, 'order');
      assert.equal(enrollmentSnap.data().orderId, orderId);
      assert.equal(enrollmentSnap.data().status, 'active');
    });

    const paymentAudits = await countAudits('financial.payment.confirmed');
    const enrollmentAudits = await countAudits('course.enrollment.created');

    await test('reentrega do mesmo event id responde 202 sem duplicar fulfillment', async () => {
      const response = await callWebhook({ payload: receivedPayload });
      assert.equal(response.status, 202, response.text);
      assert.equal(response.body.duplicate, true);
      const event = (await db.doc(`payment_webhook_events/${eventDocumentId}`).get()).data();
      assert.equal(event.status, 'processed');
      assert.equal(event.deliveryCount, 2);
      assert.equal(await countAudits('financial.payment.confirmed'), paymentAudits);
      assert.equal(await countAudits('course.enrollment.created'), enrollmentAudits);
      assert.equal(await countCollection('enrollments'), 1);
    });

    await test('mesmo event id com identidade divergente retorna 409 e preserva estado', async () => {
      const tampered = JSON.parse(JSON.stringify(receivedPayload));
      tampered.payment.value = 99;
      const response = await callWebhook({ payload: tampered });
      assert.equal(response.status, 409, response.text);
      const event = (await db.doc(`payment_webhook_events/${eventDocumentId}`).get()).data();
      assert.equal(event.status, 'processed');
      assert.equal(event.deliveryCount, 2);
      assert.equal((await db.doc(`orders/${orderId}`).get()).data().status, 'paid');
    });

    await test('fluxo novo nao escreve colecoes financeiras legadas', async () => {
      assert.equal(await countCollection('pedidos'), 0);
      assert.equal(await countCollection('matriculas'), 0);
    });

    console.log(`FINANCIAL_WEBHOOK_FUNCTIONS_EMULATOR_V1_2=${passed}/9`);
    if (passed !== 9) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});