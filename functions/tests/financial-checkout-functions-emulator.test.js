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

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);
assertLocal('FIREBASE_AUTH_EMULATOR_HOST', process.env.FIREBASE_AUTH_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-checkout';
const functionBase =
  `http://127.0.0.1:5001/${projectId}/southamerica-east1`;
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const app = initializeApp(
  { projectId },
  `financial-checkout-functions-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const auth = getAuth(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const createdUids = new Set();
let passed = 0;

function id(label) {
  return `checkout_${label}_${runId}`;
}

async function createUser(label, overrides = {}) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  const password = `Checkout-${runId}-${label}!Aa1`;
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
    status_conta: 'ativo',
    ...overrides
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

async function call(token, data = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(
    `${functionBase}/iniciarCheckoutCursoV12`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ data })
    }
  );
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch (_) {}
  return { status: response.status, body, text };
}

function payload(response) {
  return response.body?.result ?? response.body?.data ?? null;
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
    title: 'Curso checkout functions',
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
  return accountId;
}

async function countCollection(name) {
  return (await db.collection(name).get()).size;
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

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

async function main() {
  try {
    const buyer = await createUser('buyer');
    const owner = await createUser('owner');
    const token = await signIn(buyer);
    const courseId = id('course');
    const walletId = id('wallet');
    const accountId = await seedPaidCourse({
      courseId,
      ownerId: owner.uid,
      walletId
    });

    await test('anonimo e bloqueado antes do checkout', async () => {
      const response = await call(null, {
        courseId,
        idempotencyKey: id('anon')
      });
      assert.equal(response.status, 401);
    });

    await test('payload extra de preco e rejeitado', async () => {
      const response = await call(token, {
        courseId,
        idempotencyKey: id('extra'),
        amountCents: 1
      });
      assert.equal(response.status, 400);
    });

    const intent = id('intent_ok');
    let firstPayload = null;

    await test('checkout fake cria PIX pendente sanitizado', async () => {
      const response = await call(token, {
        courseId,
        idempotencyKey: intent
      });
      assert.equal(response.status, 200, response.text);
      firstPayload = payload(response);
      assert.equal(firstPayload.ok, true);
      assert.equal(firstPayload.status, 'pending_payment');
      assert.equal(firstPayload.processing, false);
      assert.ok(firstPayload.paymentId.startsWith('pay_fake_'));
      assert.ok(firstPayload.pix.payload.startsWith('000201BJJEXFAKE'));
      assert.ok(firstPayload.pix.encodedImage);
      assert.equal(firstPayload.walletId, undefined);
      assert.equal(firstPayload.providerCustomerId, undefined);
    });

    await test('estado canonico persiste transacao pending customer e lease released', async () => {
      const orderSnap = await db.doc(`orders/${firstPayload.orderId}`).get();
      const transactionSnap = await db
        .doc(`payment_transactions/${firstPayload.transactionId}`)
        .get();
      const leaseSnap = await db
        .doc(`financial_checkout_leases/${firstPayload.transactionId}`)
        .get();
      const customers = await db.collection('financial_provider_customers')
        .where('userId', '==', buyer.uid)
        .get();

      assert.equal(orderSnap.exists, true);
      assert.equal(orderSnap.data().amountCents, 10000);
      assert.equal(orderSnap.data().provider, 'asaas');
      assert.ok(orderSnap.data().providerCustomerId.startsWith('cus_fake_'));
      assert.equal(transactionSnap.data().status, 'pending');
      assert.equal(transactionSnap.data().providerPaymentId, firstPayload.paymentId);
      assert.equal(transactionSnap.data().providerSplitSnapshot[0].fixedValueCents, 9000);
      assert.equal(leaseSnap.data().status, 'released');
      assert.equal(customers.size, 1);
      assert.equal(customers.docs[0].data().status, 'ready');
    });

    const auditsAfterFirst = await countCollection('audit_logs');

    await test('retry retorna mesmo pedido transacao e pagamento sem duplicar estado', async () => {
      const response = await call(token, {
        courseId,
        idempotencyKey: intent
      });
      assert.equal(response.status, 200, response.text);
      const retry = payload(response);
      assert.equal(retry.orderId, firstPayload.orderId);
      assert.equal(retry.transactionId, firstPayload.transactionId);
      assert.equal(retry.paymentId, firstPayload.paymentId);
      assert.equal(await countCollection('orders'), 1);
      assert.equal(await countCollection('payment_transactions'), 1);
      assert.equal(await countCollection('audit_logs'), auditsAfterFirst);
    });

    await test('checkout nao cria enrollment nem legado financeiro', async () => {
      assert.equal(await countCollection('enrollments'), 0);
      assert.equal(await countCollection('pedidos'), 0);
      assert.equal(await countCollection('matriculas'), 0);
    });

    await test('recipient blocked falha antes de criar provider payment', async () => {
      await db.doc(`financial_recipient_accounts/${accountId}`).update({
        status: 'blocked'
      });
      const response = await call(token, {
        courseId,
        idempotencyKey: id('blocked')
      });
      assert.equal(response.status, 400, response.text);
      const error = response.body?.error || {};
      assert.equal(error.status, 'FAILED_PRECONDITION');
      await db.doc(`financial_recipient_accounts/${accountId}`).update({
        status: 'ready'
      });
    });

    await test('comprador sem CPF falha como precondicao e nao ganha enrollment', async () => {
      const noCpf = await createUser('no_cpf', { cpf: null });
      const noCpfToken = await signIn(noCpf);
      const response = await call(noCpfToken, {
        courseId,
        idempotencyKey: id('no_cpf_intent')
      });
      assert.equal(response.status, 400, response.text);
      const error = response.body?.error || {};
      assert.equal(error.status, 'FAILED_PRECONDITION');
      const enrollments = await db.collection('enrollments')
        .where('userId', '==', noCpf.uid)
        .get();
      assert.equal(enrollments.empty, true);
    });

    await test('curso gratuito nao entra no fluxo financeiro', async () => {
      const freeCourseId = id('course_free');
      await db.doc(`courses/${freeCourseId}`).set({
        title: 'Curso gratuito',
        status: 'published',
        visibility: 'platform',
        isPaid: false,
        priceCents: 0,
        currency: 'BRL',
        ownerType: 'platform',
        ownerId: null,
        instructorIds: [],
        financialRuleId: null
      });
      const response = await call(token, {
        courseId: freeCourseId,
        idempotencyKey: id('free_intent')
      });
      assert.equal(response.status, 400, response.text);
      const error = response.body?.error || {};
      assert.equal(error.status, 'FAILED_PRECONDITION');
    });

    console.log(`FINANCIAL_CHECKOUT_FUNCTIONS_EMULATOR_V1_2=${passed}/9`);
    if (passed !== 9) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});