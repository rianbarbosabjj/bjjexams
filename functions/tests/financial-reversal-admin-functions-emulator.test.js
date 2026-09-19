'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const {
  paymentTransactionId
} = require('../src/finance/financial-checkout-persistence');
const {
  enrollmentDocumentId
} = require('../src/courses/course-enrollment-domain');
const {
  FAKE_PAYMENTS_COLLECTION
} = require('../src/finance/fake-asaas-checkout-provider');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);
assertLocal('FIREBASE_AUTH_EMULATOR_HOST', process.env.FIREBASE_AUTH_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-finance-reversal-admin-functions';
const functionBase = `http://127.0.0.1:5001/${projectId}/southamerica-east1`;
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const app = initializeApp({ projectId }, `reversal-admin-functions-${process.pid}-${Date.now()}`);
const db = getFirestore(app);
const auth = getAuth(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const createdUids = new Set();
let passed = 0;

function id(label) {
  return `revadminfn_${label}_${runId}`;
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
    resolvedAt: new Date('2026-09-19T14:00:00.000Z')
  };
}

async function createUser(label, claims = {}) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  const password = `Rev-${runId}-${label}!Aa1`;
  await auth.createUser({ uid, email, password, emailVerified: true });
  createdUids.add(uid);
  if (Object.keys(claims).length) {
    await auth.setCustomUserClaims(uid, claims);
  }
  await db.doc(`usuarios/${uid}`).set({
    nome: label,
    email,
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

async function call(functionName, token, data = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${functionBase}/${functionName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data })
  });
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch (_) {}
  return { status: response.status, body, text };
}

function payload(response) {
  return response.body?.result ?? response.body?.data ?? null;
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
  const createdAt = new Date('2026-09-19T14:00:00.000Z');
  const paidAt = orderStatus === 'paid'
    ? new Date('2026-09-19T14:05:00.000Z')
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
      progressPercent: enrollmentStatus === 'completed' ? 100 : 40,
      startedAt: paidAt,
      completedAt: enrollmentStatus === 'completed'
        ? new Date('2026-09-19T14:30:00.000Z')
        : null,
      createdAt: paidAt,
      updatedAt: paidAt
    });
  }

  await db.doc(`${FAKE_PAYMENTS_COLLECTION}/${providerPaymentId}`).set({
    id: providerPaymentId,
    customer: providerCustomerId,
    billingType: 'PIX',
    status: providerStatus,
    value: amountCents / 100,
    externalReference: `BJJEX-V12-ORDER-${orderId}`
  });

  return {
    orderId,
    transactionId,
    enrollmentId,
    providerPaymentId
  };
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
    FAKE_PAYMENTS_COLLECTION,
    'payment_webhook_events',
    'payment_transactions',
    'orders',
    'enrollments',
    'usuarios'
  ]) {
    await deleteCollection(name);
  }
  await Promise.allSettled([...createdUids].map(uid => auth.deleteUser(uid)));
  await deleteApp(app);
}

async function main() {
  try {
    const platform = await createUser('platform', { platform_admin: true });
    const superAdmin = await createUser('super', { super_admin: true });
    const finance = await createUser('finance', { finance_admin: true });
    const content = await createUser('content', { content_admin: true });

    const platformToken = await signIn(platform);
    const superToken = await signIn(superAdmin);
    const financeToken = await signIn(finance);
    const contentToken = await signIn(content);

    const pending = await seed({
      label: 'pending',
      orderStatus: 'pending_payment',
      transactionStatus: 'pending',
      providerStatus: 'PENDING'
    });

    await test('anonimo nao cancela cobranca pendente', async () => {
      const response = await call('cancelarCobrancaPendenteV12', null, {
        orderId: pending.orderId,
        reason: 'Pedido de teste'
      });
      assert.equal(response.status, 401, response.text);
    });

    await test('finance_admin isolado nao opera reversao', async () => {
      const response = await call('cancelarCobrancaPendenteV12', financeToken, {
        orderId: pending.orderId,
        reason: 'Pedido de teste'
      });
      assert.equal(response.status, 403, response.text);
    });

    await test('payload extra e rejeitado antes da operacao', async () => {
      const response = await call('cancelarCobrancaPendenteV12', platformToken, {
        orderId: pending.orderId,
        reason: 'Pedido de teste',
        force: true
      });
      assert.equal(response.status, 400, response.text);
    });

    await test('platform_admin solicita cancelamento e aguarda webhook', async () => {
      const response = await call('cancelarCobrancaPendenteV12', platformToken, {
        orderId: pending.orderId,
        reason: 'Cancelamento solicitado no gate 4B'
      });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.ok, true);
      assert.equal(result.status, 'awaiting_webhook');
      assert.equal(result.awaitingWebhook, true);
      assert.equal(result.idempotent, false);
      assert.equal((await db.doc(`orders/${pending.orderId}`).get()).data().status, 'pending_payment');
      assert.equal((await db.doc(`payment_transactions/${pending.transactionId}`).get()).data().status, 'pending');
    });

    await test('repeticao do cancelamento e idempotente e nao duplica auditoria', async () => {
      const before = (await db.collection('audit_logs').get()).size;
      const response = await call('cancelarCobrancaPendenteV12', platformToken, {
        orderId: pending.orderId,
        reason: 'Cancelamento solicitado no gate 4B'
      });
      assert.equal(response.status, 200, response.text);
      assert.equal(payload(response).idempotent, true);
      const after = (await db.collection('audit_logs').get()).size;
      assert.equal(after, before);
    });

    const paid = await seed({
      label: 'paid',
      orderStatus: 'paid',
      transactionStatus: 'paid',
      enrollmentStatus: 'active',
      providerStatus: 'RECEIVED'
    });

    await test('super_admin solicita estorno integral sem revogar localmente', async () => {
      const response = await call('solicitarEstornoIntegralV12', superToken, {
        orderId: paid.orderId,
        reason: 'Estorno integral solicitado no gate 4B'
      });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.ok, true);
      assert.equal(result.status, 'awaiting_webhook');
      assert.equal(result.awaitingWebhook, true);
      assert.equal((await db.doc(`orders/${paid.orderId}`).get()).data().status, 'paid');
      assert.equal((await db.doc(`payment_transactions/${paid.transactionId}`).get()).data().status, 'paid');
      assert.equal((await db.doc(`enrollments/${paid.enrollmentId}`).get()).data().status, 'active');
    });

    await test('content_admin nao solicita estorno', async () => {
      const otherPaid = await seed({
        label: 'content_denied',
        orderStatus: 'paid',
        transactionStatus: 'paid',
        enrollmentStatus: 'active',
        providerStatus: 'RECEIVED'
      });
      const response = await call('solicitarEstornoIntegralV12', contentToken, {
        orderId: otherPaid.orderId,
        reason: 'Tentativa sem permissao adequada'
      });
      assert.equal(response.status, 403, response.text);
    });

    await test('callables 4B nao escrevem colecoes financeiras legadas', async () => {
      for (const name of ['pedidos', 'matriculas']) {
        assert.equal((await db.collection(name).get()).empty, true);
      }
    });

    console.log(`FINANCIAL_REVERSAL_ADMIN_FUNCTIONS_EMULATOR_V1_2=${passed}/8`);
    if (passed !== 8) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
