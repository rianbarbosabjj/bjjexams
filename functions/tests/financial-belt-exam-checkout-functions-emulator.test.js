'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const {
  buildExamSession
} = require('../src/exams/exam-session-domain');
const {
  buildSelectedExamRegistration,
  examRegistrationDocumentId
} = require('../src/exams/exam-registration-domain');
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

const projectId = 'demo-bjj-exams-belt-exam-checkout';
const functionBase = `http://127.0.0.1:5001/${projectId}/southamerica-east1`;
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const app = initializeApp(
  { projectId },
  `belt-exam-checkout-functions-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const auth = getAuth(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const createdUids = new Set();
let passed = 0;

function id(label) {
  return `belt_exam_fn_${label}_${runId}`;
}

function now(minutes = 0) {
  return new Date(Date.parse('2026-09-20T03:00:00.000Z') + minutes * 60000);
}

async function createUser(label) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  const password = `Belt-${runId}-${label}!Aa1`;
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

async function seedSelectedExam(
  student,
  label = 'main',
  withTemplateBinding = true
) {
  const organizationId = id(`org_${label}`);
  const instructorId = id(`instructor_${label}`);
  const sessionId = id(`session_${label}`);
  const membershipId = id(`membership_${label}`);
  const registrationId = examRegistrationDocumentId({
    sessionId,
    studentId: student.uid
  });

  await db.doc(`organizacoes/${organizationId}`).set({
    nome: `Academia ${label}`,
    status: 'active'
  });
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
    templateId: withTemplateBinding
      ? id(`template_${label}`)
      : null,
    templateVersionId: withTemplateBinding
      ? 'v0000001'
      : null,
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
    walletId: `wallet_${label}_${runId}`,
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
    const token = await signIn(student);
    const selected = await seedSelectedExam(student);

    await test('anonimo nao inicia checkout de exame', async () => {
      const response = await call('iniciarCheckoutExameFaixaV12', null, {
        sessionId: selected.sessionId,
        idempotencyKey: 'intent-anon'
      });
      assert.equal(response.status, 401, response.text);
    });

    await test('payload privilegiado extra e rejeitado', async () => {
      const response = await call('iniciarCheckoutExameFaixaV12', token, {
        sessionId: selected.sessionId,
        idempotencyKey: 'intent-extra',
        priceCents: 1
      });
      assert.equal(response.status, 400, response.text);
    });

    await test('aluno nao selecionado nao compra exame', async () => {
      const response = await call('iniciarCheckoutExameFaixaV12', token, {
        sessionId: id('unknown_session'),
        idempotencyKey: 'intent-unknown'
      });
      assert.equal(response.status, 404, response.text);
    });

    await test(
      'sessao sem template oficial nao cria cobranca nem PIX',
      async () => {
        const unbound =
          await seedSelectedExam(
            student,
            'unbound',
            false
          );

        const response =
          await call(
            'iniciarCheckoutExameFaixaV12',
            token,
            {
              sessionId:
                unbound.sessionId,
              idempotencyKey:
                'intent-unbound'
            }
          );

        assert.equal(
          response.status,
          400,
          response.text
        );

        assert.equal(
          response.body?.error?.status,
          'FAILED_PRECONDITION',
          response.text
        );

        assert.equal(
          response.body?.error?.details?.domainCode,
          'BELT_EXAM_TEMPLATE_REQUIRED',
          response.text
        );

        const orders =
          await db.collection('orders')
            .where(
              'buyerUserId',
              '==',
              student.uid
            )
            .get();

        assert.equal(
          orders.size,
          0
        );

        const transactions =
          await db.collection(
            'payment_transactions'
          )
            .where(
              'buyerUserId',
              '==',
              student.uid
            )
            .get();

        assert.equal(
          transactions.size,
          0
        );

        const fakePayments =
          await db.collection(
            '__emulator_asaas_fake_payments'
          ).get();

        assert.equal(
          fakePayments.size,
          0
        );
      }
    );

    let first;
    await test('aluno selecionado recebe PIX sanitizado', async () => {
      const response = await call('iniciarCheckoutExameFaixaV12', token, {
        sessionId: selected.sessionId,
        idempotencyKey: 'intent-main'
      });
      assert.equal(response.status, 200, response.text);
      first = payload(response);
      assert.equal(first.ok, true);
      assert.equal(first.status, 'pending_payment');
      assert.equal(first.processing, false);
      assert.ok(first.orderId);
      assert.ok(first.transactionId);
      assert.ok(first.pix?.payload);
      assert.ok(first.pix?.encodedImage);
      assert.equal(Object.prototype.hasOwnProperty.call(first, 'paymentId'), false);
      const serialized = JSON.stringify(first);
      assert.equal(serialized.includes('providerPaymentId'), false);
      assert.equal(serialized.includes('wallet_'), false);
      assert.equal(serialized.includes('financialSnapshot'), false);
    });

    await test('reload com mesma intent reutiliza order e transaction', async () => {
      const response = await call('iniciarCheckoutExameFaixaV12', token, {
        sessionId: selected.sessionId,
        idempotencyKey: 'intent-main'
      });
      assert.equal(response.status, 200, response.text);
      const second = payload(response);
      assert.equal(second.orderId, first.orderId);
      assert.equal(second.transactionId, first.transactionId);
      assert.equal(second.status, 'pending_payment');
      const orders = await db.collection('orders')
        .where('buyerUserId', '==', student.uid)
        .get();
      const transactions = await db.collection('payment_transactions')
        .where('buyerUserId', '==', student.uid)
        .get();
      assert.equal(orders.size, 1);
      assert.equal(transactions.size, 1);
    });

    await test('nova intent enquanto PIX pendente nao duplica cobranca', async () => {
      const response = await call('iniciarCheckoutExameFaixaV12', token, {
        sessionId: selected.sessionId,
        idempotencyKey: 'intent-conflict'
      });
      assert.equal(response.status, 400, response.text);
      assert.equal(response.body?.error?.status, 'FAILED_PRECONDITION', response.text);
      assert.equal(
        response.body?.error?.details?.domainCode,
        'BELT_EXAM_ACTIVE_ORDER_CONFLICT',
        response.text
      );
      const orders = await db.collection('orders')
        .where('buyerUserId', '==', student.uid)
        .get();
      assert.equal(orders.size, 1);
    });

    await test('estado canonico continua awaiting_payment ate webhook do Gate 4', async () => {
      const registration = (
        await db.doc(`exam_registrations/${selected.registrationId}`).get()
      ).data();
      assert.equal(registration.status, 'awaiting_payment');
      assert.equal(registration.orderId, first.orderId);
      assert.equal(registration.paidAt, null);
      assert.equal(registration.authorizedAt, null);
      const order = (await db.doc(`orders/${first.orderId}`).get()).data();
      assert.equal(order.productType, 'belt_exam');
      assert.equal(order.status, 'pending_payment');
    });

    console.log(`BELT_EXAM_CHECKOUT_FUNCTIONS_EMULATOR_V1_2=${passed}/8`);
    if (passed !== 8) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  try { await cleanup(); } catch (_) {}
});
