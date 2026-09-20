'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const {
  buildFinancialSnapshot
} = require('../src/finance/financial-domain');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);
assertLocal('FIREBASE_AUTH_EMULATOR_HOST', process.env.FIREBASE_AUTH_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-finance-purchase-read-functions';
const functionBase = `http://127.0.0.1:5001/${projectId}/southamerica-east1`;
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const app = initializeApp(
  { projectId },
  `purchase-read-functions-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const auth = getAuth(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const createdUids = new Set();
let passed = 0;

function id(label) {
  return `purchase_read_fn_${label}_${runId}`;
}

function now(minutes = 0) {
  return new Date(Date.parse('2026-09-19T21:00:00.000Z') + minutes * 60000);
}

function snapshot(courseId, amountCents = 5000) {
  return buildFinancialSnapshot({
    rule: {
      id: 'platform-default',
      name: 'Regra padrao',
      status: 'active',
      scope: 'platform_default',
      productType: null,
      productId: null,
      platformFeeBps: 1000,
      recipientMode: 'product_owner',
      recipientShares: [],
      version: 1,
      createdBy: 'system',
      updatedBy: 'system',
      createdAt: now(),
      updatedAt: now()
    },
    product: {
      productType: 'course',
      productId: courseId,
      ownerType: 'platform',
      ownerId: null,
      currency: 'BRL'
    },
    grossAmountCents: amountCents,
    currency: 'BRL',
    resolvedAt: now()
  });
}

async function createUser(label, claims = {}) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  const password = `Read-${runId}-${label}!Aa1`;
  await auth.createUser({ uid, email, password, emailVerified: true });
  createdUids.add(uid);
  if (Object.keys(claims).length) {
    await auth.setCustomUserClaims(uid, claims);
  }
  await db.doc(`usuarios/${uid}`).set({
    nome: `Usuario ${label}`,
    email,
    cpf: '12345678909',
    telefone: '21999999999',
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

async function seedPendingPurchase({ student }) {
  const courseId = id('course_pending');
  const orderId = id('order_pending');
  const transactionId = id('tx_pending');
  const providerPaymentId = id('provider_payment_secret');
  const amountCents = 5000;
  const financialSnapshot = snapshot(courseId, amountCents);

  await db.doc(`courses/${courseId}`).set({
    title: 'Curso pago Gate 1B',
    description: 'Teste de read model',
    status: 'published',
    visibility: 'public',
    isPaid: true,
    priceCents: amountCents,
    currency: 'BRL',
    ownerType: 'platform',
    ownerId: null,
    publishedAt: now()
  });

  await db.doc(`orders/${orderId}`).set({
    buyerUserId: student.uid,
    productType: 'course',
    productId: courseId,
    quantity: 1,
    amountCents,
    currency: 'BRL',
    status: 'pending_payment',
    financialSnapshot,
    provider: 'asaas',
    providerCustomerId: id('provider_customer_secret'),
    currentTransactionId: transactionId,
    idempotencyKey: id('intent'),
    createdAt: now(),
    updatedAt: now(1),
    paidAt: null,
    cancelledAt: null,
    expiredAt: null,
    refundedAt: null,
    chargebackAt: null
  });

  await db.doc(`payment_transactions/${transactionId}`).set({
    orderId,
    buyerUserId: student.uid,
    provider: 'asaas',
    providerPaymentId,
    providerStatus: 'PENDING',
    status: 'pending',
    amountCents,
    currency: 'BRL',
    financialSnapshot,
    providerSplitSnapshot: [],
    createdAt: now(),
    updatedAt: now(1),
    confirmedAt: null,
    refundedAt: null,
    chargebackAt: null
  });

  return { courseId, orderId, transactionId, providerPaymentId };
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
    'financial_reversal_requests',
    'payment_transactions',
    'orders',
    'enrollments',
    'courses',
    'usuarios'
  ]) {
    await deleteCollection(name);
  }
  await Promise.allSettled([...createdUids].map(uid => auth.deleteUser(uid)));
  await deleteApp(app);
}

async function main() {
  try {
    const student = await createUser('student');
    const otherStudent = await createUser('other_student');
    const platform = await createUser('platform', { platform_admin: true });
    const content = await createUser('content', { content_admin: true });

    const studentToken = await signIn(student);
    const otherToken = await signIn(otherStudent);
    const platformToken = await signIn(platform);
    const contentToken = await signIn(content);

    const seeded = await seedPendingPurchase({ student });

    await test('anonimo nao consulta status financeiro do curso', async () => {
      const response = await call('obterStatusCompraCursoV12', null, {
        courseId: seeded.courseId
      });
      assert.equal(response.status, 401, response.text);
    });

    await test('aluno consulta apenas o proprio estado sanitizado', async () => {
      const response = await call('obterStatusCompraCursoV12', studentToken, {
        courseId: seeded.courseId
      });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.ok, true);
      assert.equal(result.purchase.purchaseState, 'payment_pending');
      assert.equal(result.purchase.payment.method, 'PIX');
      assert.equal(result.purchase.payment.ready, true);
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes(seeded.providerPaymentId), false);
      assert.equal(serialized.includes('financialSnapshot'), false);
      assert.equal(serialized.includes('12345678909'), false);
    });

    await test('outro aluno nao enxerga pedido alheio', async () => {
      const response = await call('obterStatusCompraCursoV12', otherToken, {
        courseId: seeded.courseId
      });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.purchase.purchaseState, 'available_for_purchase');
      assert.equal(result.purchase.payment, null);
    });

    await test('payload extra do read model do aluno e rejeitado', async () => {
      const response = await call('obterStatusCompraCursoV12', studentToken, {
        courseId: seeded.courseId,
        userId: student.uid
      });
      assert.equal(response.status, 400, response.text);
    });

    await test('platform_admin lista operacoes sanitizadas', async () => {
      const response = await call('listarOperacoesFinanceirasCursosV12', platformToken, {
        limit: 20
      });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.ok, true);
      assert.equal(result.role, 'platform_admin');
      const row = result.items.find(item => item.orderId === seeded.orderId);
      assert.ok(row);
      assert.equal(row.canCancel, true);
      assert.equal(row.buyer.userId, student.uid);
      const serialized = JSON.stringify(row);
      assert.equal(serialized.includes(seeded.providerPaymentId), false);
      assert.equal(serialized.includes('financialSnapshot'), false);
      assert.equal(serialized.includes('12345678909'), false);
    });

    await test('content_admin nao recebe console financeiro', async () => {
      const response = await call('listarOperacoesFinanceirasCursosV12', contentToken, {
        limit: 20
      });
      assert.equal(response.status, 403, response.text);
    });

    console.log(`FINANCIAL_PURCHASE_READ_FUNCTIONS_EMULATOR_V1_2=${passed}/6`);
    if (passed !== 6) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  try { await cleanup(); } catch (_) {}
});
