'use strict';

const assert = require('node:assert/strict');

const {
  initializeApp,
  deleteApp
} = require('firebase-admin/app');

const {
  getFirestore
} = require('firebase-admin/firestore');

const {
  getAuth
} = require('firebase-admin/auth');

const {
  buildFinancialSnapshot
} = require('../src/finance/financial-domain');

const {
  examRegistrationDocumentId
} = require('../src/exams/exam-registration-domain');

function assertLocal(name, value) {
  if (
    !value ||
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)
  ) {
    throw new Error(
      `${name} nao e local: ${value || '<EMPTY>'}`
    );
  }
}

assertLocal(
  'FIRESTORE_EMULATOR_HOST',
  process.env.FIRESTORE_EMULATOR_HOST
);

assertLocal(
  'FIREBASE_AUTH_EMULATOR_HOST',
  process.env.FIREBASE_AUTH_EMULATOR_HOST
);

const projectId =
  'demo-bjj-exams-financial-admin-product-read';

const functionBase =
  `http://127.0.0.1:5001/${projectId}/southamerica-east1`;

const authBase =
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const app = initializeApp(
  { projectId },
  `financial-admin-product-read-${process.pid}-${Date.now()}`
);

const db = getFirestore(app);
const auth = getAuth(app);

const runId =
  `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createdUids = new Set();

let passed = 0;

function id(label) {
  return `admin_product_${label}_${runId}`;
}

function now(minutes = 0) {
  return new Date(
    Date.parse('2026-09-21T03:00:00.000Z') +
    minutes * 60000
  );
}

function financialSnapshot({
  productType,
  productId,
  amountCents
}) {
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
      productType,
      productId,
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
  const uid = id(`user_${label}`);
  const email = `${uid}@example.test`;
  const password = `AdminProduct-${label}-${runId}!Aa1`;

  await auth.createUser({
    uid,
    email,
    password,
    emailVerified: true
  });

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

  return {
    uid,
    email,
    password
  };
}

async function signIn(actor) {
  const response = await fetch(
    `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email: actor.email,
        password: actor.password,
        returnSecureToken: true
      })
    }
  );

  const body = await response.json();

  assert.ok(
    body.idToken,
    JSON.stringify(body)
  );

  return body.idToken;
}

async function call(functionName, token, data = {}) {
  const headers = {
    'content-type': 'application/json'
  };

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(
    `${functionBase}/${functionName}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ data })
    }
  );

  const text = await response.text();

  let body = {};
  try {
    body = JSON.parse(text);
  } catch (_) {}

  return {
    status: response.status,
    body,
    text
  };
}

function payload(response) {
  return (
    response.body?.result ??
    response.body?.data ??
    null
  );
}

async function seedCoursePending(student) {
  const courseId = id('course');
  const orderId = id('course_order');
  const transactionId = id('course_tx');
  const amountCents = 5000;

  const snapshot = financialSnapshot({
    productType: 'course',
    productId: courseId,
    amountCents
  });

  await db.doc(`courses/${courseId}`).set({
    title: 'Curso Admin Product Read',
    description: 'Contrato legado',
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
    financialSnapshot: snapshot,
    provider: 'asaas',
    providerCustomerId: id('course_customer_secret'),
    currentTransactionId: transactionId,
    idempotencyKey: id('course_intent'),
    createdAt: now(1),
    updatedAt: now(2),
    paidAt: null,
    cancelledAt: null,
    expiredAt: null,
    refundedAt: null,
    chargebackAt: null
  });

  const providerPaymentId =
    id('course_payment_secret');

  await db.doc(
    `payment_transactions/${transactionId}`
  ).set({
    orderId,
    buyerUserId: student.uid,
    provider: 'asaas',
    providerPaymentId,
    providerStatus: 'PENDING',
    status: 'pending',
    amountCents,
    currency: 'BRL',
    financialSnapshot: snapshot,
    providerSplitSnapshot: [],
    createdAt: now(1),
    updatedAt: now(2),
    confirmedAt: null,
    refundedAt: null,
    chargebackAt: null
  });

  return {
    courseId,
    orderId,
    transactionId,
    providerPaymentId
  };
}

async function seedBeltExam({
  label,
  student,
  orderStatus,
  transactionStatus,
  registrationStatus,
  offset
}) {
  const sessionId = id(`session_${label}`);
  const orderId = id(`exam_order_${label}`);
  const transactionId = id(`exam_tx_${label}`);
  const amountCents = 10000;

  const snapshot = financialSnapshot({
    productType: 'belt_exam',
    productId: sessionId,
    amountCents
  });

  await db.doc(`exam_sessions/${sessionId}`).set({
    organizationId: id(`org_${label}`),
    responsibleInstructorId: id(`instructor_${label}`),
    targetBelt: 'Azul',
    status:
      orderStatus === 'paid'
        ? 'ready'
        : 'awaiting_payment',
    priceCents: amountCents,
    currency: 'BRL',
    financialRuleId: null,
    scheduledAt: now(120),
    createdBy: id(`creator_${label}`),
    createdAt: now(offset),
    updatedAt: now(offset + 1)
  });

  const paid =
    ['paid', 'refunded', 'chargeback']
      .includes(orderStatus);

  await db.doc(`orders/${orderId}`).set({
    buyerUserId: student.uid,
    productType: 'belt_exam',
    productId: sessionId,
    quantity: 1,
    amountCents,
    currency: 'BRL',
    status: orderStatus,
    financialSnapshot: snapshot,
    provider: 'asaas',
    providerCustomerId:
      id(`exam_customer_secret_${label}`),
    currentTransactionId: transactionId,
    idempotencyKey: id(`exam_intent_${label}`),
    createdAt: now(offset),
    updatedAt: now(offset + 1),
    paidAt: paid ? now(offset + 1) : null,
    cancelledAt: null,
    expiredAt: null,
    refundedAt: null,
    chargebackAt: null
  });

  const providerPaymentId =
    id(`exam_payment_secret_${label}`);

  await db.doc(
    `payment_transactions/${transactionId}`
  ).set({
    orderId,
    buyerUserId: student.uid,
    provider: 'asaas',
    providerPaymentId,
    providerStatus:
      transactionStatus === 'paid'
        ? 'RECEIVED'
        : 'PENDING',
    status: transactionStatus,
    amountCents,
    currency: 'BRL',
    financialSnapshot: snapshot,
    providerSplitSnapshot: [],
    createdAt: now(offset),
    updatedAt: now(offset + 1),
    confirmedAt:
      transactionStatus === 'paid'
        ? now(offset + 1)
        : null,
    refundedAt: null,
    chargebackAt: null
  });

  const registrationId =
    examRegistrationDocumentId({
      sessionId,
      studentId: student.uid
    });

  await db.doc(
    `exam_registrations/${registrationId}`
  ).set({
    sessionId,
    organizationId: id(`org_${label}`),
    studentId: student.uid,
    instructorId: id(`instructor_${label}`),
    currentBelt: 'Branca',
    targetBelt: 'Azul',
    membershipId: id(`membership_${label}`),
    status: registrationStatus,
    orderId,
    attemptId: null,
    resultId: null,
    certificateId: null,
    selectedAt: now(offset),
    paidAt:
      orderStatus === 'paid'
        ? now(offset + 1)
        : null,
    authorizedAt:
      orderStatus === 'paid'
        ? now(offset + 1)
        : null,
    cancelledAt: null,
    updatedAt: now(offset + 1)
  });

  return {
    sessionId,
    orderId,
    transactionId,
    providerPaymentId,
    registrationId
  };
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

  for (
    let offset = 0;
    offset < snap.docs.length;
    offset += 400
  ) {
    const batch = db.batch();

    for (
      const doc of snap.docs.slice(
        offset,
        offset + 400
      )
    ) {
      batch.delete(doc.ref);
    }

    await batch.commit();
  }
}

async function cleanup() {
  for (const name of [
    'financial_reversal_requests',
    'payment_transactions',
    'orders',
    'exam_registrations',
    'exam_sessions',
    'enrollments',
    'courses',
    'usuarios'
  ]) {
    await deleteCollection(name);
  }

  await Promise.allSettled(
    [...createdUids].map(uid =>
      auth.deleteUser(uid)
    )
  );

  await deleteApp(app);
}

async function main() {
  try {
    const courseStudent =
      await createUser('course_student');

    const examStudent =
      await createUser('exam_student');

    const reconciliationStudent =
      await createUser('reconciliation_student');

    const platformAdmin =
      await createUser(
        'platform_admin',
        { platform_admin: true }
      );

    const contentAdmin =
      await createUser(
        'content_admin',
        { content_admin: true }
      );

    const platformToken =
      await signIn(platformAdmin);

    const contentToken =
      await signIn(contentAdmin);

    const course =
      await seedCoursePending(courseStudent);

    const pendingExam =
      await seedBeltExam({
        label: 'pending',
        student: examStudent,
        orderStatus: 'pending_payment',
        transactionStatus: 'pending',
        registrationStatus: 'awaiting_payment',
        offset: 10
      });

    const reconciliationExam =
      await seedBeltExam({
        label: 'reconciliation',
        student: reconciliationStudent,
        orderStatus: 'paid',
        transactionStatus: 'paid',
        registrationStatus: 'needs_reconciliation',
        offset: 20
      });

    await test(
      'anonimo nao consulta operacoes financeiras agregadas',
      async () => {
        const response = await call(
          'listarOperacoesFinanceirasV12',
          null,
          { limit: 20 }
        );

        assert.equal(
          response.status,
          401,
          response.text
        );
      }
    );

    await test(
      'content_admin nao recebe console financeiro agregado',
      async () => {
        const response = await call(
          'listarOperacoesFinanceirasV12',
          contentToken,
          { limit: 20 }
        );

        assert.equal(
          response.status,
          403,
          response.text
        );
      }
    );

    await test(
      'callable agregada retorna course e belt_exam sanitizados',
      async () => {
        const response = await call(
          'listarOperacoesFinanceirasV12',
          platformToken,
          { limit: 20 }
        );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result = payload(response);

        assert.equal(result.ok, true);
        assert.equal(
          result.role,
          'platform_admin'
        );

        const courseRow =
          result.items.find(
            item =>
              item.orderId === course.orderId
          );

        const pendingExamRow =
          result.items.find(
            item =>
              item.orderId ===
              pendingExam.orderId
          );

        const reconciliationRow =
          result.items.find(
            item =>
              item.orderId ===
              reconciliationExam.orderId
          );

        assert.ok(courseRow);
        assert.ok(pendingExamRow);
        assert.ok(reconciliationRow);

        assert.equal(
          courseRow.productType,
          'course'
        );

        assert.equal(
          courseRow.product.label,
          'Curso Admin Product Read'
        );

        assert.equal(
          courseRow.lifecycleKind,
          'enrollment'
        );

        assert.equal(
          pendingExamRow.productType,
          'belt_exam'
        );

        assert.equal(
          pendingExamRow.product.label,
          'Exame oficial - Faixa Azul'
        );

        assert.equal(
          pendingExamRow.lifecycleKind,
          'exam_registration'
        );

        assert.equal(
          pendingExamRow.lifecycleStatus,
          'awaiting_payment'
        );

        assert.equal(
          pendingExamRow.canCancel,
          true
        );

        assert.equal(
          pendingExamRow.canRefund,
          false
        );

        const serialized =
          JSON.stringify(result);

        assert.equal(
          serialized.includes(
            course.providerPaymentId
          ),
          false
        );

        assert.equal(
          serialized.includes(
            pendingExam.providerPaymentId
          ),
          false
        );

        assert.equal(
          serialized.includes(
            reconciliationExam.providerPaymentId
          ),
          false
        );

        assert.equal(
          serialized.includes(
            'financialSnapshot'
          ),
          false
        );

        assert.equal(
          serialized.includes(
            '12345678909'
          ),
          false
        );
      }
    );

    await test(
      'needs_reconciliation de exame aparece e bloqueia reversao',
      async () => {
        const response = await call(
          'listarOperacoesFinanceirasV12',
          platformToken,
          { limit: 20 }
        );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result = payload(response);

        const row =
          result.items.find(
            item =>
              item.orderId ===
              reconciliationExam.orderId
          );

        assert.ok(row);

        assert.equal(
          row.registrationStatus,
          'needs_reconciliation'
        );

        assert.equal(
          row.lifecycleStatus,
          'needs_reconciliation'
        );

        assert.equal(
          row.needsReconciliation,
          true
        );

        assert.equal(
          row.canCancel,
          false
        );

        assert.equal(
          row.canRefund,
          false
        );
      }
    );

    await test(
      'alias legado continua retornando somente cursos',
      async () => {
        const response = await call(
          'listarOperacoesFinanceirasCursosV12',
          platformToken,
          { limit: 20 }
        );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result = payload(response);

        assert.ok(
          result.items.some(
            item =>
              item.orderId === course.orderId
          )
        );

        assert.equal(
          result.items.some(
            item =>
              item.orderId ===
              pendingExam.orderId
          ),
          false
        );

        assert.equal(
          result.items.some(
            item =>
              item.orderId ===
              reconciliationExam.orderId
          ),
          false
        );
      }
    );

    await test(
      'payload extra da callable agregada e rejeitado',
      async () => {
        const response = await call(
          'listarOperacoesFinanceirasV12',
          platformToken,
          {
            limit: 20,
            productType: 'belt_exam'
          }
        );

        assert.equal(
          response.status,
          400,
          response.text
        );
      }
    );

    console.log(
      `FINANCIAL_ADMIN_PRODUCT_READ_FUNCTIONS_EMULATOR_V1_2=${passed}/6`
    );

    if (passed !== 6) {
      process.exitCode = 1;
    }
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;

  try {
    await cleanup();
  } catch (_) {}
});