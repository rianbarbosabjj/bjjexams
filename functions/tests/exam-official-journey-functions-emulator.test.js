'use strict';

const assert =
  require('node:assert/strict');

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
  validateExamSession
} = require('../src/exams/exam-session-domain');

const {
  examRegistrationDocumentId,
  buildSelectedExamRegistration,
  markRegistrationAwaitingPayment,
  authorizePaidExamRegistration
} = require('../src/exams/exam-registration-domain');

const {
  examAttemptDocumentId
} = require('../src/exams/exam-attempt-domain');

const {
  examResultDocumentId
} = require('../src/exams/exam-result-domain');

const {
  validateExamTemplate,
  validateExamTemplateVersion
} = require('../src/exams/exam-template-domain');

const {
  buildExamQuestionSnapshot
} = require('../src/exams/exam-question-domain');

const {
  validateOrder,
  validateTransaction
} = require('../src/finance/financial-domain');

function assertLocal(
  name,
  value
) {
  if (
    !value ||
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(
      value
    )
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
  'demo-bjj-exams-marco6-journey';

const functionPort =
  String(
    process.env.BJJ_EXAMS_FUNCTIONS_EMULATOR_PORT ||
    '5001'
  ).trim();

if (
  !/^\d+$/.test(
    functionPort
  )
) {
  throw new Error(
    `Porta do Functions Emulator invalida: ${functionPort}`
  );
}

const functionBase =
  `http://127.0.0.1:${functionPort}/${projectId}/southamerica-east1`;

const authBase =
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const app =
  initializeApp(
    { projectId },
    `marco6-journey-${process.pid}-${Date.now()}`
  );

const db =
  getFirestore(app);

const auth =
  getAuth(app);

const runId =
  `${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;

const PRICE_CENTS =
  12990;

const trackedPaths =
  new Set();

const createdUids =
  new Set();

let passed =
  0;

function id(label) {
  return `journey_${label}_${runId}`;
}

function track(path) {
  trackedPaths.add(path);
  return path;
}

async function put(
  path,
  data
) {
  track(path);

  await db
    .doc(path)
    .set(data);
}

async function createUser(
  label
) {
  const uid =
    id(label);

  const email =
    `${uid}@example.test`;

  const password =
    `Exam-${runId}-${label}!Aa1`;

  await auth.createUser({
    uid,
    email,
    password,
    emailVerified: true
  });

  createdUids.add(uid);

  await put(
    `usuarios/${uid}`,
    {
      nome:
        `Usuario ${label}`,
      email,
      faixa:
        'Branca',
      faixa_atual:
        'Branca',
      status_conta:
        'ativo'
    }
  );

  return {
    uid,
    email,
    password
  };
}

async function signIn(actor) {
  const response =
    await fetch(
      `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      {
        method:
          'POST',
        headers: {
          'content-type':
            'application/json'
        },
        body:
          JSON.stringify({
            email:
              actor.email,
            password:
              actor.password,
            returnSecureToken:
              true
          })
      }
    );

  const body =
    await response.json();

  assert.ok(
    body.idToken,
    JSON.stringify(body)
  );

  return body.idToken;
}

async function call(
  functionName,
  token,
  data = {}
) {
  const headers = {
    'content-type':
      'application/json'
  };

  if (token) {
    headers.authorization =
      `Bearer ${token}`;
  }

  const response =
    await fetch(
      `${functionBase}/${functionName}`,
      {
        method:
          'POST',
        headers,
        body:
          JSON.stringify({
            data
          })
      }
    );

  const text =
    await response.text();

  let body = {};

  try {
    body =
      JSON.parse(text);
  } catch (_) {}

  return {
    status:
      response.status,
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

function canonicalize(value) {
  if (
    value &&
    typeof value.toMillis ===
      'function'
  ) {
    return {
      __timestamp:
        value.toMillis()
    };
  }

  if (value instanceof Date) {
    return {
      __date:
        value.getTime()
    };
  }

  if (Array.isArray(value)) {
    return value.map(
      canonicalize
    );
  }

  if (
    value &&
    typeof value ===
      'object'
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(
          key => [
            key,
            canonicalize(
              value[key]
            )
          ]
        )
    );
  }

  return value;
}

async function snapshot(path) {
  const snap =
    await db.doc(path).get();

  assert.equal(
    snap.exists,
    true,
    path
  );

  return canonicalize(
    snap.data()
  );
}

function financialSnapshot(
  sessionId,
  organizationId,
  now
) {
  return {
    ruleId:
      'platform-default',
    ruleVersion:
      1,
    productType:
      'belt_exam',
    productId:
      sessionId,
    currency:
      'BRL',
    grossAmountCents:
      PRICE_CENTS,
    platformFeeBps:
      1000,
    platformFeeCents:
      1299,
    sellerPoolCents:
      11691,
    recipientMode:
      'explicit',
    recipientAllocations: [
      {
        recipientType:
          'organization',
        recipientId:
          organizationId,
        shareBps:
          10000,
        amountCents:
          11691
      }
    ],
    resolvedAt:
      now
  };
}

async function seedAuthorizedFixture(
  studentId
) {
  const now =
    new Date();

  const organizationId =
    id('organization');

  const instructorId =
    id('instructor');

  const membershipId =
    id('membership');

  const sessionId =
    id('session');

  const templateId =
    id('template');

  const templateVersionId =
    'v0000001';

  const question1 =
    id('question1');

  const question2 =
    id('question2');

  const orderId =
    id('order');

  const transactionId =
    id('transaction');

  const registrationId =
    examRegistrationDocumentId({
      sessionId,
      studentId
    });

  const attemptId =
    examAttemptDocumentId(
      registrationId
    );

  const resultId =
    examResultDocumentId(
      attemptId
    );

  const session =
    validateExamSession({
      organizationId,
      responsibleInstructorId:
        instructorId,
      targetBelt:
        'Azul',
      templateId,
      templateVersionId,
      status:
        'ready',
      priceCents:
        PRICE_CENTS,
      currency:
        'BRL',
      financialRuleId:
        null,
      scheduledAt:
        null,
      createdBy:
        instructorId,
      createdAt:
        now,
      updatedAt:
        now
    });

  let registration =
    buildSelectedExamRegistration({
      sessionId,
      organizationId,
      studentId,
      instructorId,
      currentBelt:
        'Branca',
      targetBelt:
        'Azul',
      membershipId,
      timestamp:
        now
    });

  registration =
    markRegistrationAwaitingPayment(
      registration,
      {
        orderId,
        updatedAt:
          now
      }
    );

  registration =
    authorizePaidExamRegistration(
      registration,
      {
        orderId,
        paidAt:
          now
      }
    );

  const finance =
    financialSnapshot(
      sessionId,
      organizationId,
      now
    );

  const order =
    validateOrder({
      buyerUserId:
        studentId,
      productType:
        'belt_exam',
      productId:
        sessionId,
      quantity:
        1,
      amountCents:
        PRICE_CENTS,
      currency:
        'BRL',
      status:
        'paid',
      financialSnapshot:
        finance,
      provider:
        'asaas',
      providerCustomerId:
        id('customer'),
      currentTransactionId:
        transactionId,
      idempotencyKey:
        id('idempotency'),
      createdAt:
        now,
      updatedAt:
        now,
      paidAt:
        now,
      cancelledAt:
        null,
      expiredAt:
        null,
      refundedAt:
        null,
      chargebackAt:
        null
    });

  const transaction =
    validateTransaction({
      orderId,
      buyerUserId:
        studentId,
      provider:
        'asaas',
      providerPaymentId:
        id('payment'),
      providerStatus:
        'RECEIVED',
      status:
        'paid',
      amountCents:
        PRICE_CENTS,
      currency:
        'BRL',
      financialSnapshot:
        finance,
      providerSplitSnapshot:
        null,
      createdAt:
        now,
      updatedAt:
        now,
      confirmedAt:
        now,
      refundedAt:
        null,
      chargebackAt:
        null
    });

  const template =
    validateExamTemplate({
      name:
        'Template Jornada Marco 6',
      targetBelt:
        'Azul',
      status:
        'active',
      activeVersionId:
        templateVersionId,
      createdBy:
        instructorId,
      createdAt:
        now,
      updatedAt:
        now
    });

  const version =
    validateExamTemplateVersion({
      templateId,
      version:
        1,
      status:
        'active',
      timeLimitMinutes:
        30,
      passingScoreBps:
        7000,
      questionCount:
        2,
      questionIds: [
        question1,
        question2
      ],
      source:
        'test',
      createdBy:
        instructorId,
      createdAt:
        now,
      activatedAt:
        now
    });

  const q1 =
    buildExamQuestionSnapshot({
      prompt:
        'Pergunta integrada A',
      alternatives: {
        A:
          'Alternativa A',
        B:
          'Alternativa B'
      },
      correctAnswer:
        'A',
      category:
        'Fundamentos',
      difficulty:
        1,
      media:
        null,
      sourceQuestionId:
        id('source1'),
      timestamp:
        now
    });

  const q2 =
    buildExamQuestionSnapshot({
      prompt:
        'Pergunta integrada B',
      alternatives: {
        A:
          'Alternativa A',
        B:
          'Alternativa B'
      },
      correctAnswer:
        'B',
      category:
        'Regras',
      difficulty:
        2,
      media:
        null,
      sourceQuestionId:
        id('source2'),
      timestamp:
        now
    });

  await put(
    `organizacoes/${organizationId}`,
    {
      nome:
        'Academia Jornada Marco 6',
      status:
        'ativa'
    }
  );

  await put(
    `vinculos_organizacao/${membershipId}`,
    {
      organizacao_id:
        organizationId,
      usuario_id:
        studentId,
      papel:
        'aluno',
      status:
        'ativo'
    }
  );

  await put(
    `exam_sessions/${sessionId}`,
    session
  );

  await put(
    `exam_registrations/${registrationId}`,
    registration
  );

  await put(
    `orders/${orderId}`,
    order
  );

  await put(
    `payment_transactions/${transactionId}`,
    transaction
  );

  await put(
    `exam_templates/${templateId}`,
    template
  );

  await put(
    `exam_templates/${templateId}` +
      `/versions/${templateVersionId}`,
    version
  );

  await put(
    `exam_templates/${templateId}` +
      `/versions/${templateVersionId}` +
      `/questions/${question1}`,
    q1
  );

  await put(
    `exam_templates/${templateId}` +
      `/versions/${templateVersionId}` +
      `/questions/${question2}`,
    q2
  );

  await put(
    `creditos_professor/${instructorId}`,
    {
      creditos:
        37,
      saldo:
        37,
      marker:
        runId
    }
  );

  track(
    `exam_attempts/${attemptId}`
  );

  track(
    `exam_results/${resultId}`
  );

  return {
    organizationId,
    instructorId,
    membershipId,
    sessionId,
    templateId,
    templateVersionId,
    question1,
    question2,
    orderId,
    transactionId,
    registrationId,
    attemptId,
    resultId
  };
}

async function auditActionCount(
  action,
  entityId
) {
  const snap =
    await db
      .collection('audit_logs')
      .get();

  return snap.docs
    .map(
      doc => doc.data()
    )
    .filter(
      item =>
        item.action === action &&
        item.entityId === entityId
    )
    .length;
}

async function test(
  name,
  fn
) {
  try {
    await fn();

    passed += 1;

    console.log(
      `PASS | ${name}`
    );
  } catch (error) {
    console.error(
      `FAIL | ${name}`
    );

    throw error;
  }
}

async function cleanup() {
  try {
    const audits =
      await db
        .collection('audit_logs')
        .get();

    for (
      const doc of audits.docs
    ) {
      await doc.ref.delete();
    }

    const paths =
      [...trackedPaths]
        .sort(
          (left, right) =>
            right.split('/').length -
            left.split('/').length
        );

    for (const path of paths) {
      try {
        await db
          .doc(path)
          .delete();
      } catch (_) {}
    }

    await Promise.allSettled(
      [...createdUids].map(
        uid =>
          auth.deleteUser(uid)
      )
    );
  } finally {
    await deleteApp(app);
  }
}

async function main() {
  const student =
    await createUser(
      'student'
    );

  const foreign =
    await createUser(
      'foreign'
    );

  const studentToken =
    await signIn(student);

  const foreignToken =
    await signIn(foreign);

  const fixture =
    await seedAuthorizedFixture(
      student.uid
    );

  const orderBefore =
    await snapshot(
      `orders/${fixture.orderId}`
    );

  const transactionBefore =
    await snapshot(
      `payment_transactions/${fixture.transactionId}`
    );

  const creditsBefore =
    await snapshot(
      `creditos_professor/${fixture.instructorId}`
    );

  const userBefore =
    await snapshot(
      `usuarios/${student.uid}`
    );

  let originalExpiresAt =
    null;

  let firstFinalResult =
    null;

  try {
    await test(
      'read model inicial expoe authorized pronto para start',
      async () => {
        const response =
          await call(
            'listarMeusExamesFaixaV12',
            studentToken,
            {
              limit:
                20
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result =
          payload(response);

        assert.equal(
          result.ok,
          true
        );

        assert.equal(
          result.items.length,
          1
        );

        const item =
          result.items[0];

        assert.equal(
          item.registrationId,
          fixture.registrationId
        );

        assert.equal(
          item.state,
          'authorized'
        );

        assert.equal(
          item.examState,
          'not_started'
        );

        assert.equal(
          item.canStartExam,
          true
        );

        assert.equal(
          item.canResumeExam,
          false
        );

        assert.equal(
          item.result,
          null
        );

        const serialized =
          JSON.stringify(item);

        for (
          const forbidden of [
            'attemptId',
            'templateId',
            'templateVersionId',
            'orderId',
            'providerPaymentId',
            'correctAnswer',
            'answers'
          ]
        ) {
          assert.equal(
            serialized.includes(
              forbidden
            ),
            false,
            forbidden
          );
        }
      }
    );

    await test(
      'outro aluno nao enxerga registration alheia no read model',
      async () => {
        const response =
          await call(
            'listarMeusExamesFaixaV12',
            foreignToken,
            {
              limit:
                20
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result =
          payload(response);

        assert.equal(
          result.items.length,
          0
        );
      }
    );

    await test(
      'start cria exatamente uma tentativa sanitizada',
      async () => {
        const response =
          await call(
            'iniciarExameOficialV12',
            studentToken,
            {
              registrationId:
                fixture.registrationId
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result =
          payload(response);

        assert.equal(
          result.created,
          true
        );

        assert.equal(
          result.resumed,
          false
        );

        assert.equal(
          result.attempt.attemptId,
          fixture.attemptId
        );

        assert.equal(
          result.attempt.status,
          'in_progress'
        );

        assert.equal(
          result.questions.length,
          2
        );

        const serialized =
          JSON.stringify(result);

        for (
          const forbidden of [
            'correctAnswer',
            'templateId',
            'templateVersionId',
            'answerKey'
          ]
        ) {
          assert.equal(
            serialized.includes(
              forbidden
            ),
            false,
            forbidden
          );
        }

        const storedAttempt =
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).data();

        originalExpiresAt =
          storedAttempt
            .expiresAt
            .toMillis();

        const registration =
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data();

        assert.equal(
          registration.status,
          'started'
        );

        assert.equal(
          registration.attemptId,
          fixture.attemptId
        );
      }
    );

    await test(
      'retry do start converge sem duplicar ou estender prazo',
      async () => {
        const response =
          await call(
            'iniciarExameOficialV12',
            studentToken,
            {
              registrationId:
                fixture.registrationId
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result =
          payload(response);

        assert.equal(
          result.created,
          false
        );

        assert.equal(
          result.resumed,
          true
        );

        assert.equal(
          result.attempt.attemptId,
          fixture.attemptId
        );

        const storedAttempt =
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).data();

        assert.equal(
          storedAttempt
            .expiresAt
            .toMillis(),
          originalExpiresAt
        );

        const attempts =
          await db
            .collection(
              'exam_attempts'
            )
            .where(
              'registrationId',
              '==',
              fixture.registrationId
            )
            .get();

        assert.equal(
          attempts.size,
          1
        );
      }
    );

    await test(
      'read model muda para in progress e libera somente resume',
      async () => {
        const response =
          await call(
            'listarMeusExamesFaixaV12',
            studentToken,
            {
              limit:
                20
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const item =
          payload(response)
            .items[0];

        assert.equal(
          item.state,
          'started_or_later'
        );

        assert.equal(
          item.examState,
          'in_progress'
        );

        assert.equal(
          item.canStartExam,
          false
        );

        assert.equal(
          item.canResumeExam,
          true
        );

        assert.equal(
          item.result,
          null
        );
      }
    );

    await test(
      'resume preserva tentativa prazo e sanitizacao',
      async () => {
        const response =
          await call(
            'obterTentativaExameOficialV12',
            studentToken,
            {
              registrationId:
                fixture.registrationId
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result =
          payload(response);

        assert.equal(
          result.resumed,
          true
        );

        assert.equal(
          result.attempt.attemptId,
          fixture.attemptId
        );

        assert.equal(
          result.questions.length,
          2
        );

        const storedAttempt =
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).data();

        assert.equal(
          storedAttempt
            .expiresAt
            .toMillis(),
          originalExpiresAt
        );

        const serialized =
          JSON.stringify(result);

        assert.equal(
          serialized.includes(
            'correctAnswer'
          ),
          false
        );

        assert.equal(
          serialized.includes(
            'templateVersionId'
          ),
          false
        );
      }
    );

    await test(
      'outro aluno nao retoma tentativa alheia',
      async () => {
        const response =
          await call(
            'obterTentativaExameOficialV12',
            foreignToken,
            {
              registrationId:
                fixture.registrationId
            }
          );

        assert.equal(
          response.status,
          403,
          response.text
        );

        assert.equal(
          response.body?.error?.status,
          'PERMISSION_DENIED',
          response.text
        );
      }
    );

    await test(
      'submit corrige no servidor e finaliza em passed',
      async () => {
        const response =
          await call(
            'finalizarExameOficialV12',
            studentToken,
            {
              attemptId:
                fixture.attemptId,
              answers: {
                [fixture.question1]:
                  'A',
                [fixture.question2]:
                  'B'
              }
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result =
          payload(response);

        assert.equal(
          result.created,
          true
        );

        assert.equal(
          result.result.resultId,
          fixture.resultId
        );

        assert.equal(
          result.result.status,
          'passed'
        );

        assert.equal(
          result.result.scoreBps,
          10000
        );

        assert.equal(
          result.result.correctCount,
          2
        );

        assert.equal(
          result.result.totalQuestions,
          2
        );

        assert.equal(
          result.result.certificateEligible,
          true
        );

        firstFinalResult =
          result.result;

        const serialized =
          JSON.stringify(result);

        for (
          const forbidden of [
            'correctAnswer',
            '"answers"',
            'templateId',
            'templateVersionId',
            'studentId',
            'organizationId',
            'targetBelt',
            'reason'
          ]
        ) {
          assert.equal(
            serialized.includes(
              forbidden
            ),
            false,
            forbidden
          );
        }

        const storedAttempt =
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).data();

        const storedRegistration =
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data();

        const storedResult =
          (
            await db.doc(
              `exam_results/${fixture.resultId}`
            ).get()
          ).data();

        assert.equal(
          storedAttempt.status,
          'submitted'
        );

        assert.equal(
          storedAttempt.resultId,
          fixture.resultId
        );

        assert.equal(
          storedRegistration.status,
          'passed'
        );

        assert.equal(
          storedRegistration.resultId,
          fixture.resultId
        );

        assert.equal(
          Object.hasOwn(
            storedResult,
            'answers'
          ),
          false
        );
      }
    );

    await test(
      'read model final expoe somente resultado sanitizado',
      async () => {
        const response =
          await call(
            'listarMeusExamesFaixaV12',
            studentToken,
            {
              limit:
                20
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const item =
          payload(response)
            .items[0];

        assert.equal(
          item.state,
          'started_or_later'
        );

        assert.equal(
          item.examState,
          'passed'
        );

        assert.equal(
          item.canStartExam,
          false
        );

        assert.equal(
          item.canResumeExam,
          false
        );

        assert.equal(
          item.result.resultId,
          fixture.resultId
        );

        assert.equal(
          item.result.status,
          'passed'
        );

        assert.equal(
          item.result.scoreBps,
          10000
        );

        const serialized =
          JSON.stringify(
            item.result
          );

        for (
          const forbidden of [
            'attemptId',
            'registrationId',
            'sessionId',
            'organizationId',
            'studentId',
            'templateId',
            'templateVersionId',
            'targetBelt',
            'reason',
            'correctAnswer',
            'answers'
          ]
        ) {
          assert.equal(
            serialized.includes(
              forbidden
            ),
            false,
            forbidden
          );
        }
      }
    );

    await test(
      'retry do submit reutiliza resultado imutavel',
      async () => {
        const response =
          await call(
            'finalizarExameOficialV12',
            studentToken,
            {
              attemptId:
                fixture.attemptId,
              answers: {}
            }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result =
          payload(response);

        assert.equal(
          result.created,
          false
        );

        assert.deepEqual(
          result.result,
          firstFinalResult
        );

        const results =
          await db
            .collection(
              'exam_results'
            )
            .where(
              'attemptId',
              '==',
              fixture.attemptId
            )
            .get();

        assert.equal(
          results.size,
          1
        );
      }
    );

    await test(
      'execucao academica nao altera ordem ou transacao financeira',
      async () => {
        const orderAfter =
          await snapshot(
            `orders/${fixture.orderId}`
          );

        const transactionAfter =
          await snapshot(
            `payment_transactions/${fixture.transactionId}`
          );

        assert.deepEqual(
          orderAfter,
          orderBefore
        );

        assert.deepEqual(
          transactionAfter,
          transactionBefore
        );
      }
    );

    await test(
      'creditos faixa e certificados permanecem intocados',
      async () => {
        const creditsAfter =
          await snapshot(
            `creditos_professor/${fixture.instructorId}`
          );

        const userAfter =
          await snapshot(
            `usuarios/${student.uid}`
          );

        assert.deepEqual(
          creditsAfter,
          creditsBefore
        );

        assert.deepEqual(
          userAfter,
          userBefore
        );

        assert.equal(
          userAfter.faixa,
          'Branca'
        );

        assert.equal(
          userAfter.faixa_atual,
          'Branca'
        );

        const legacyCertificates =
          await db
            .collection(
              'certificados'
            )
            .get();

        const canonicalCertificates =
          await db
            .collection(
              'exam_certificates'
            )
            .get();

        assert.equal(
          legacyCertificates.size,
          0
        );

        assert.equal(
          canonicalCertificates.size,
          0
        );
      }
    );

    await test(
      'auditoria registra somente um start e uma finalizacao canonica',
      async () => {
        assert.equal(
          await auditActionCount(
            'exam.attempt.started',
            fixture.attemptId
          ),
          1
        );

        assert.equal(
          await auditActionCount(
            'exam.attempt.submitted',
            fixture.attemptId
          ),
          1
        );

        assert.equal(
          await auditActionCount(
            'exam.result.created',
            fixture.resultId
          ),
          1
        );
      }
    );

    console.log(
      `EXAM_OFFICIAL_JOURNEY_FUNCTIONS_EMULATOR_V1_2=${passed}/13`
    );

    if (passed !== 13) {
      process.exitCode = 1;
    }
  } finally {
    await cleanup();
  }
}

main().catch(
  error => {
    console.error(error);
    process.exitCode = 1;
  }
);