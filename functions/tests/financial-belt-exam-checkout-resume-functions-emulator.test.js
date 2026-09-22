'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const { buildExamSession } = require('../src/exams/exam-session-domain');
const {
  buildSelectedExamRegistration,
  examRegistrationDocumentId
} = require('../src/exams/exam-registration-domain');
const { financialRecipientAccountId } = require('../src/finance/financial-admin-domain');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);
assertLocal('FIREBASE_AUTH_EMULATOR_HOST', process.env.FIREBASE_AUTH_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-belt-exam-resume';
const functionBase = `http://127.0.0.1:5001/${projectId}/southamerica-east1`;
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const app = initializeApp(
  { projectId },
  `belt-exam-resume-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const auth = getAuth(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const createdUids = new Set();
let passed = 0;

function id(label) {
  return `belt_resume_${label}_${runId}`;
}

function now(minutes = 0) {
  return new Date(Date.parse('2026-09-20T15:00:00.000Z') + minutes * 60000);
}

async function createUser(label) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  const password = `Resume-${runId}-${label}!Aa1`;
  await auth.createUser({ uid, email, password, emailVerified: true });
  createdUids.add(uid);
  await db.doc(`usuarios/${uid}`).set({
    nome: `Aluno ${label}`,
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

async function seedDefaultRule() {
  await db.doc('financial_rules/platform-default').set({
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
  });
}

async function seedSelectedExam(student) {
  const organizationId = id('org');
  const instructorId = id('instructor');
  const sessionId = id('session');
  const membershipId = id('membership');
  const registrationId = examRegistrationDocumentId({
    sessionId,
    studentId: student.uid
  });

  await db.doc(`organizacoes/${organizationId}`).set({ nome: 'Academia Resume', status: 'ativa' });
  await db.doc(`vinculos_organizacao/${membershipId}`).set({
    usuario_id: student.uid,
    organizacao_id: organizationId,
    papel: 'aluno',
    status: 'ativo'
  });

  const session = buildExamSession({
    organizationId,
    responsibleInstructorId: instructorId,
    targetBelt: 'Azul',
    priceCents: 5000,
    currency: 'BRL',
    financialRuleId: null,
    createdBy: instructorId,
    timestamp: now()
  });
  await db.doc(`exam_sessions/${sessionId}`).set({
    ...session,
    status: 'candidates_selected'
  });

  const registration = buildSelectedExamRegistration({
    sessionId,
    organizationId,
    studentId: student.uid,
    instructorId,
    currentBelt: 'Branca',
    targetBelt: 'Azul',
    membershipId,
    timestamp: now()
  });
  await db.doc(`exam_registrations/${registrationId}`).set(registration);

  const accountId = financialRecipientAccountId({
    provider: 'asaas',
    environment: 'sandbox',
    recipientType: 'organization',
    recipientId: organizationId
  });
  await db.doc(`financial_recipient_accounts/${accountId}`).set({
    recipientType: 'organization',
    recipientId: organizationId,
    provider: 'asaas',
    environment: 'sandbox',
    walletId: `wallet_resume_${runId}`,
    status: 'ready',
    version: 1,
    createdBy: 'system',
    updatedBy: 'system',
    createdAt: now(),
    updatedAt: now()
  });

  return { organizationId, sessionId, registrationId };
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
    '__emulator_asaas_fake_payments',
    '__emulator_asaas_fake_customers',
    'audit_logs',
    'financial_checkout_leases',
    'financial_provider_customers',
    'payment_transactions',
    'orders',
    'financial_recipient_accounts',
    'financial_rules',
    'exam_registrations',
    'exam_sessions',
    'vinculos_organizacao',
    'usuarios',
    'organizacoes'
  ]) {
    await deleteCollection(name);
  }
  await Promise.allSettled([...createdUids].map(uid => auth.deleteUser(uid)));
  await deleteApp(app);
}

async function main() {
  try {
    await seedDefaultRule();
    const student = await createUser('student');
    const otherStudent = await createUser('other');
    const token = await signIn(student);
    const otherToken = await signIn(otherStudent);
    const seeded = await seedSelectedExam(student);

    await test('anonimo nao retoma PIX de exame', async () => {
      const response = await call('retomarCheckoutExameFaixaV12', null, {
        sessionId: seeded.sessionId
      });
      assert.equal(response.status, 401, response.text);
    });

    await test('registration selected sem cobranca pendente nao e retomavel', async () => {
      const response = await call('retomarCheckoutExameFaixaV12', token, {
        sessionId: seeded.sessionId
      });
      assert.equal(response.status, 400, response.text);
      assert.equal(response.body?.error?.status, 'FAILED_PRECONDITION', response.text);
      assert.equal(
        response.body?.error?.details?.domainCode,
        'BELT_EXAM_ORDER_NOT_RESUMABLE',
        response.text
      );
    });

    let started;
    await test('checkout inicial cria PIX pending canonicamente', async () => {
      const response = await call('iniciarCheckoutExameFaixaV12', token, {
        sessionId: seeded.sessionId,
        idempotencyKey: 'gate-6b-original-intent'
      });
      assert.equal(response.status, 200, response.text);
      started = payload(response);
      assert.equal(started.status, 'pending_payment');
      assert.ok(started.orderId);
      assert.ok(started.transactionId);
      assert.ok(started.pix?.payload);
    });

    let resumed;
    await test('resume com somente sessionId reutiliza order transaction e PIX', async () => {
      const response = await call('retomarCheckoutExameFaixaV12', token, {
        sessionId: seeded.sessionId
      });
      assert.equal(response.status, 200, response.text);
      resumed = payload(response);
      assert.equal(resumed.orderId, started.orderId);
      assert.equal(resumed.transactionId, started.transactionId);
      assert.equal(resumed.status, 'pending_payment');
      assert.ok(resumed.pix?.payload);
      const orders = await db.collection('orders').where('buyerUserId', '==', student.uid).get();
      const transactions = await db.collection('payment_transactions').where('buyerUserId', '==', student.uid).get();
      assert.equal(orders.size, 1);
      assert.equal(transactions.size, 1);
    });

    await test('segunda retomada continua idempotente e sanitizada', async () => {
      const response = await call('retomarCheckoutExameFaixaV12', token, {
        sessionId: seeded.sessionId
      });
      assert.equal(response.status, 200, response.text);
      const second = payload(response);
      assert.equal(second.orderId, started.orderId);
      assert.equal(second.transactionId, started.transactionId);
      const serialized = JSON.stringify(second);
      assert.equal(Object.prototype.hasOwnProperty.call(second, 'paymentId'), false);
      assert.equal(serialized.includes('providerPaymentId'), false);
      assert.equal(serialized.includes('wallet_resume_'), false);
      assert.equal(serialized.includes('financialSnapshot'), false);
      assert.equal(serialized.includes('gate-6b-original-intent'), false);
    });

    await test('outro aluno nao retoma cobranca alheia', async () => {
      const response = await call('retomarCheckoutExameFaixaV12', otherToken, {
        sessionId: seeded.sessionId
      });
      assert.equal(response.status, 404, response.text);
      assert.equal(
        response.body?.error?.details?.domainCode,
        'BELT_EXAM_REGISTRATION_NOT_FOUND',
        response.text
      );
    });

    console.log(`BELT_EXAM_CHECKOUT_RESUME_FUNCTIONS_EMULATOR_V1_2=${passed}/6`);
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
