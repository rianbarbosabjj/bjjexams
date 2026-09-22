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
  'demo-bjj-exams-attempt-functions';

const functionBase =
  `http://127.0.0.1:5001/${projectId}/southamerica-east1`;

const authBase =
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const app =
  initializeApp(
    { projectId },
    `attempt-functions-${process.pid}-${Date.now()}`
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

let passed = 0;

function id(label) {
  return `attempt_fn_${label}_${runId}`;
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
        method: 'POST',
        headers: {
          'content-type':
            'application/json'
        },
        body: JSON.stringify({
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
        method: 'POST',
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
  label,
  studentId
) {
  const now =
    new Date();

  const organizationId =
    id(`org_${label}`);

  const instructorId =
    id(`instructor_${label}`);

  const membershipId =
    id(`membership_${label}`);

  const sessionId =
    id(`session_${label}`);

  const templateId =
    id(`template_${label}`);

  const templateVersionId =
    'v0000001';

  const question1 =
    id(`question1_${label}`);

  const question2 =
    id(`question2_${label}`);

  const orderId =
    id(`order_${label}`);

  const transactionId =
    id(`transaction_${label}`);

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
        id(`customer_${label}`),
      currentTransactionId:
        transactionId,
      idempotencyKey:
        id(`idem_${label}`),
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
        id(`payment_${label}`),
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
        `Template ${label}`,
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
        `Pergunta A ${label}`,
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
        id(`source1_${label}`),
      timestamp:
        now
    });

  const q2 =
    buildExamQuestionSnapshot({
      prompt:
        `Pergunta B ${label}`,
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
        id(`source2_${label}`),
      timestamp:
        now
    });

  await put(
    `organizacoes/${organizationId}`,
    {
      nome:
        organizationId,
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

  track(
    `exam_attempts/${attemptId}`
  );

  track(
    `exam_results/${resultId}`
  );

  return {
    registrationId,
    attemptId,
    resultId,
    question1,
    question2
  };
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

  try {
    const fixture =
      await seedAuthorizedFixture(
        'main',
        student.uid
      );

    await test(
      'anonimo nao inicia prova oficial',
      async () => {
        const response =
          await call(
            'iniciarExameOficialV12',
            null,
            {
              registrationId:
                fixture.registrationId
            }
          );

        assert.equal(
          response.status,
          401,
          response.text
        );
      }
    );

    await test(
      'payload extra e rejeitado antes do service',
      async () => {
        const response =
          await call(
            'iniciarExameOficialV12',
            studentToken,
            {
              registrationId:
                fixture.registrationId,
              templateId:
                'nao-permitido'
            }
          );

        assert.equal(
          response.status,
          400,
          response.text
        );
      }
    );

    let originalExpiresAt =
      null;

    await test(
      'aluno inicia tentativa por callable sanitizada',
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
          result.ok,
          true
        );

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

        assert.equal(
          serialized.includes(
            'correctAnswer'
          ),
          false
        );

        assert.equal(
          serialized.includes(
            'templateId'
          ),
          false
        );

        assert.equal(
          serialized.includes(
            'templateVersionId'
          ),
          false
        );

        const storedAttempt =
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).data();

        originalExpiresAt =
          storedAttempt.expiresAt.toMillis();

        const storedRegistration =
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data();

        assert.equal(
          storedRegistration.status,
          'started'
        );

        assert.equal(
          storedRegistration.attemptId,
          fixture.attemptId
        );
      }
    );

    await test(
      'retry do start reutiliza tentativa',
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
          storedAttempt.expiresAt.toMillis(),
          originalExpiresAt
        );
      }
    );

    await test(
      'retomada por callable preserva prazo e sanitizacao',
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
          result.ok,
          true
        );

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
            'templateId'
          ),
          false
        );

        assert.equal(
          serialized.includes(
            'templateVersionId'
          ),
          false
        );

        const storedAttempt =
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).data();

        assert.equal(
          storedAttempt.expiresAt.toMillis(),
          originalExpiresAt
        );
      }
    );

    await test(
      'outro usuario nao inicia tentativa alheia',
      async () => {
        const foreignFixture =
          await seedAuthorizedFixture(
            'foreign_guard',
            student.uid
          );

        const response =
          await call(
            'iniciarExameOficialV12',
            foreignToken,
            {
              registrationId:
                foreignFixture.registrationId
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
      'outro usuario nao retoma tentativa alheia',
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
      'registration authorized sem tentativa nao e retomavel',
      async () => {
        const pendingFixture =
          await seedAuthorizedFixture(
            'not_started',
            student.uid
          );

        const response =
          await call(
            'obterTentativaExameOficialV12',
            studentToken,
            {
              registrationId:
                pendingFixture.registrationId
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
          response.body?.error?.details
            ?.domainCode,
          'EXAM_ATTEMPT_NOT_AVAILABLE',
          response.text
        );
      }
    );

    await test(
      'anonimo nao finaliza prova oficial',
      async () => {
        const response =
          await call(
            'finalizarExameOficialV12',
            null,
            {
              attemptId:
                fixture.attemptId,
              answers: {}
            }
          );

        assert.equal(
          response.status,
          401,
          response.text
        );
      }
    );

    await test(
      'finalizacao rejeita campos privilegiados extras',
      async () => {
        const response =
          await call(
            'finalizarExameOficialV12',
            studentToken,
            {
              attemptId:
                fixture.attemptId,
              answers: {},
              passingScoreBps:
                0
            }
          );

        assert.equal(
          response.status,
          400,
          response.text
        );
      }
    );

    await test(
      'finalizacao exige answers como objeto',
      async () => {
        const response =
          await call(
            'finalizarExameOficialV12',
            studentToken,
            {
              attemptId:
                fixture.attemptId,
              answers: []
            }
          );

        assert.equal(
          response.status,
          400,
          response.text
        );
      }
    );

    let firstFinalResult =
      null;

    await test(
      'aluno finaliza prova com scoring server side',
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
          result.ok,
          true
        );

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
            false
          );
        }

        const storedResult =
          (
            await db.doc(
              `exam_results/${fixture.resultId}`
            ).get()
          ).data();

        assert.equal(
          Object.hasOwn(
            storedResult,
            'answers'
          ),
          false
        );

        assert.equal(
          JSON.stringify(
            storedResult
          ).includes(
            'correctAnswer'
          ),
          false
        );

        const storedAttempt =
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
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

        const storedRegistration =
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data();

        assert.equal(
          storedRegistration.status,
          'passed'
        );

        assert.equal(
          storedRegistration.resultId,
          fixture.resultId
        );
      }
    );

    await test(
      'retry da callable reutiliza resultado imutavel',
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
      }
    );

    await test(
      'outro usuario nao finaliza tentativa alheia',
      async () => {
        const response =
          await call(
            'finalizarExameOficialV12',
            foreignToken,
            {
              attemptId:
                fixture.attemptId,
              answers: {}
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
      'questao fora da tentativa e rejeitada sem resultado parcial',
      async () => {
        const invalidFixture =
          await seedAuthorizedFixture(
            'invalid_answer',
            student.uid
          );

        const startResponse =
          await call(
            'iniciarExameOficialV12',
            studentToken,
            {
              registrationId:
                invalidFixture.registrationId
            }
          );

        assert.equal(
          startResponse.status,
          200,
          startResponse.text
        );

        const response =
          await call(
            'finalizarExameOficialV12',
            studentToken,
            {
              attemptId:
                invalidFixture.attemptId,
              answers: {
                [invalidFixture.question1]:
                  'A',
                question_outside_attempt:
                  'B'
              }
            }
          );

        assert.equal(
          response.status,
          400,
          response.text
        );

        assert.equal(
          response.body?.error?.status,
          'INVALID_ARGUMENT',
          response.text
        );

        assert.equal(
          response.body?.error?.details
            ?.domainCode,
          'UNKNOWN_EXAM_ANSWER_QUESTION',
          response.text
        );

        const resultSnap =
          await db.doc(
            `exam_results/${invalidFixture.resultId}`
          ).get();

        assert.equal(
          resultSnap.exists,
          false
        );

        const storedAttempt =
          (
            await db.doc(
              `exam_attempts/${invalidFixture.attemptId}`
            ).get()
          ).data();

        assert.equal(
          storedAttempt.status,
          'in_progress'
        );

        assert.equal(
          storedAttempt.resultId,
          null
        );

        const storedRegistration =
          (
            await db.doc(
              `exam_registrations/${invalidFixture.registrationId}`
            ).get()
          ).data();

        assert.equal(
          storedRegistration.status,
          'started'
        );

        assert.equal(
          storedRegistration.resultId,
          null
        );
      }
    );

    console.log(
      `EXAM_ATTEMPT_FUNCTIONS_EMULATOR_V1_2=${passed}/15`
    );

    if (passed !== 15) {
      process.exitCode = 1;
    }
  } finally {
    await cleanup();
  }
}

main().catch(
  async error => {
    console.error(error);
    process.exitCode = 1;

    try {
      await cleanup();
    } catch (_) {}
  }
);