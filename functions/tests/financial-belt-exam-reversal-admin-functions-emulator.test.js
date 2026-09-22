'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const {
  paymentTransactionId
} = require('../src/finance/financial-checkout-persistence');
const {
  examRegistrationDocumentId
} = require('../src/exams/exam-registration-domain');
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

const projectId = 'demo-bjj-exams-belt-exam-reversal-admin-functions';
const functionBase = `http://127.0.0.1:5001/${projectId}/southamerica-east1`;
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const app = initializeApp(
  { projectId },
  `belt-exam-reversal-admin-functions-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const auth = getAuth(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const createdUids = new Set();
let passed = 0;

function id(label) {
  return `beltexamrevadminfn_${label}_${runId}`;
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

async function createUser(label, claims = {}) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  const password = `BeltRev-${runId}-${label}!Aa1`;
  await auth.createUser({ uid, email, password, emailVerified: true });
  createdUids.add(uid);
  if (Object.keys(claims).length) await auth.setCustomUserClaims(uid, claims);
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

function domainCode(response) {
  return response.body?.error?.details?.domainCode ||
    response.body?.error?.details?.code ||
    null;
}

async function seed({
  label,
  orderStatus = 'paid',
  registrationStatus = orderStatus === 'pending_payment'
    ? 'awaiting_payment'
    : 'authorized',
  providerStatus = orderStatus === 'pending_payment' ? 'PENDING' : 'RECEIVED'
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
  const amountCents = 5000;
  const financialSnapshot = snapshot(sessionId, organizationId, amountCents);
  const transactionStatus = orderStatus === 'pending_payment' ? 'pending' : 'paid';
  const started = registrationStatus === 'started';

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
    attemptId: started ? id(`attempt_${label}`) : null,
    resultId: null,
    certificateId: null,
    selectedAt: createdAt,
    paidAt,
    authorizedAt: paidAt,
    cancelledAt: null,
    updatedAt: paidAt || createdAt
  });

  await db.doc(`${FAKE_PAYMENTS_COLLECTION}/${providerPaymentId}`).set({
    id: providerPaymentId,
    customer: providerCustomerId,
    billingType: 'PIX',
    status: providerStatus,
    value: amountCents / 100,
    externalReference: `BJJEX-V12-ORDER-${orderId}`
  });

  return { orderId, transactionId, registrationId, providerPaymentId };
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
    'payment_transactions',
    'orders',
    'exam_registrations',
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
    const platformToken = await signIn(platform);
    const superToken = await signIn(superAdmin);
    const financeToken = await signIn(finance);

    const pending = await seed({ label: 'pending', orderStatus: 'pending_payment' });

    await test('anonimo nao cancela cobranca de exame', async () => {
      const response = await call('cancelarCobrancaPendenteV12', null, {
        orderId: pending.orderId,
        reason: 'Pedido de teste'
      });
      assert.equal(response.status, 401, response.text);
    });

    await test('finance_admin isolado nao opera reversao de exame', async () => {
      const response = await call('cancelarCobrancaPendenteV12', financeToken, {
        orderId: pending.orderId,
        reason: 'Pedido de teste'
      });
      assert.equal(response.status, 403, response.text);
    });

    await test('payload extra continua rejeitado antes do roteamento', async () => {
      const response = await call('cancelarCobrancaPendenteV12', platformToken, {
        orderId: pending.orderId,
        reason: 'Pedido de teste',
        force: true
      });
      assert.equal(response.status, 400, response.text);
    });

    await test('platform_admin cancela pending belt_exam e resposta e sanitizada', async () => {
      const response = await call('cancelarCobrancaPendenteV12', platformToken, {
        orderId: pending.orderId,
        reason: 'Cancelamento do exame solicitado pelo suporte'
      });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.ok, true);
      assert.equal(result.status, 'awaiting_webhook');
      assert.equal(result.productType, 'belt_exam');
      assert.equal(result.registrationId, pending.registrationId);
      assert.equal(result.providerPaymentId, undefined);
      assert.equal((await db.doc(`orders/${pending.orderId}`).get()).data().status, 'pending_payment');
      assert.equal((await db.doc(`exam_registrations/${pending.registrationId}`).get()).data().status, 'awaiting_payment');
    });

    const paid = await seed({ label: 'paid' });
    await test('super_admin solicita refund belt_exam sem revogar antes do webhook', async () => {
      const response = await call('solicitarEstornoIntegralV12', superToken, {
        orderId: paid.orderId,
        reason: 'Estorno do exame antes do inicio'
      });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.ok, true);
      assert.equal(result.status, 'awaiting_webhook');
      assert.equal(result.providerPaymentId, undefined);
      assert.equal((await db.doc(`orders/${paid.orderId}`).get()).data().status, 'paid');
      assert.equal((await db.doc(`exam_registrations/${paid.registrationId}`).get()).data().status, 'authorized');
    });

    const started = await seed({ label: 'started', registrationStatus: 'started' });
    await test('refund de prova iniciada retorna failed-precondition sem criar request', async () => {
      const before = (await db.collection('financial_reversal_requests').get()).size;
      const response = await call('solicitarEstornoIntegralV12', superToken, {
        orderId: started.orderId,
        reason: 'Tentativa de estorno apos inicio da prova'
      });
      assert.equal(response.status, 400, response.text);
      assert.equal(domainCode(response), 'BELT_EXAM_ADMIN_REFUND_ACADEMIC_ACTIVITY');
      const after = (await db.collection('financial_reversal_requests').get()).size;
      assert.equal(after, before);
      assert.equal((await db.doc(`exam_registrations/${started.registrationId}`).get()).data().status, 'started');
    });

    console.log(`BELT_EXAM_REVERSAL_ADMIN_FUNCTIONS_EMULATOR_V1_2=${passed}/6`);
    if (passed !== 6) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
