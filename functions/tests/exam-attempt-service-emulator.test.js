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
  createExamAttemptService,
  ExamAttemptServiceError
} = require('../src/exams/exam-attempt-service');

const {
  examAttemptDocumentId
} = require('../src/exams/exam-attempt-domain');

const {
  examResultDocumentId
} = require('../src/exams/exam-result-domain');

const {
  examRegistrationDocumentId,
  buildSelectedExamRegistration,
  markRegistrationAwaitingPayment,
  authorizePaidExamRegistration
} = require('../src/exams/exam-registration-domain');

const {
  validateExamSession
} = require('../src/exams/exam-session-domain');

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

const projectId =
  'demo-bjj-exams-attempt-service';

const app = initializeApp(
  { projectId },
  `attempt-service-${process.pid}-${Date.now()}`
);

const db = getFirestore(app);

const runId =
  `${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;

const fixedNow =
  new Date(
    '2026-09-22T15:00:00.000Z'
  );

const PRICE_CENTS = 12990;

const service =
  createExamAttemptService({
    db,
    clock: () =>
      new Date(
        fixedNow.getTime()
      )
  });

const trackedPaths =
  new Set();

let passed = 0;

function id(label) {
  return `attempt_${label}_${runId}`;
}

function track(path) {
  trackedPaths.add(path);
  return path;
}

async function put(path, data) {
  track(path);
  await db.doc(path).set(data);
}

function financialSnapshot(
  sessionId,
  organizationId
) {
  return {
    ruleId:
      'platform-default',
    ruleVersion: 1,
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
      fixedNow
  };
}

async function seedFixture(
  label,
  options = {}
) {
  const organizationId =
    id(`org_${label}`);

  const instructorId =
    id(`instructor_${label}`);

  const studentId =
    id(`student_${label}`);

  const membershipId =
    id(`membership_${label}`);

  const sessionId =
    id(`session_${label}`);

  const templateId =
    id(`template_${label}`);

  const templateVersionId =
    'v0000001';

  const question1 =
    id(`q1_${label}`);

  const question2 =
    id(`q2_${label}`);

  const orderId =
    id(`order_${label}`);

  const transactionId =
    id(`tx_${label}`);

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
        options.sessionStatus ||
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
        fixedNow,
      updatedAt:
        fixedNow
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
        fixedNow
    });

  registration =
    markRegistrationAwaitingPayment(
      registration,
      {
        orderId,
        updatedAt:
          fixedNow
      }
    );

  registration =
    authorizePaidExamRegistration(
      registration,
      {
        orderId,
        paidAt:
          fixedNow
      }
    );

  const snapshot =
    financialSnapshot(
      sessionId,
      organizationId
    );

  const orderStatus =
    options.orderStatus ||
    'paid';

  const transactionStatus =
    options.transactionStatus ||
    'paid';

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
        orderStatus,
      financialSnapshot:
        snapshot,
      provider:
        'asaas',
      providerCustomerId:
        id(`customer_${label}`),
      currentTransactionId:
        transactionId,
      idempotencyKey:
        id(`idem_${label}`),
      createdAt:
        fixedNow,
      updatedAt:
        fixedNow,
      paidAt:
        [
          'paid',
          'refunded',
          'chargeback'
        ].includes(orderStatus)
          ? fixedNow
          : null,
      cancelledAt:
        null,
      expiredAt:
        null,
      refundedAt:
        orderStatus ===
          'refunded'
          ? fixedNow
          : null,
      chargebackAt:
        orderStatus ===
          'chargeback'
          ? fixedNow
          : null
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
        transactionStatus ===
          'paid'
          ? 'RECEIVED'
          : 'PENDING',
      status:
        transactionStatus,
      amountCents:
        PRICE_CENTS,
      currency:
        'BRL',
      financialSnapshot:
        snapshot,
      providerSplitSnapshot:
        null,
      createdAt:
        fixedNow,
      updatedAt:
        fixedNow,
      confirmedAt:
        [
          'paid',
          'refunded',
          'chargeback'
        ].includes(transactionStatus)
          ? fixedNow
          : null,
      refundedAt:
        transactionStatus ===
          'refunded'
          ? fixedNow
          : null,
      chargebackAt:
        transactionStatus ===
          'chargeback'
          ? fixedNow
          : null
    });

  await put(
    `organizacoes/${organizationId}`,
    {
      nome:
        organizationId,
      status:
        options.organizationStatus ||
        'ativa'
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
    `vinculos_organizacao/${membershipId}`,
    {
      organizacao_id:
        organizationId,
      usuario_id:
        studentId,
      papel:
        'aluno',
      status:
        options.membershipStatus ||
        'ativo'
    }
  );

  await put(
    `orders/${orderId}`,
    order
  );

  await put(
    `payment_transactions/${transactionId}`,
    transaction
  );

  track(
    `exam_attempts/${attemptId}`
  );

  track(
    `exam_results/${resultId}`
  );

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
        fixedNow,
      updatedAt:
        fixedNow
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
        fixedNow,
      activatedAt:
        fixedNow
    });

  await put(
    `exam_templates/${templateId}`,
    template
  );

  await put(
    `exam_templates/${templateId}` +
      `/versions/${templateVersionId}`,
    version
  );

  const q1 =
    buildExamQuestionSnapshot({
      prompt:
        `Pergunta A ${label}`,
      alternatives: {
        A: 'Alternativa A',
        B: 'Alternativa B'
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
        fixedNow
    });

  const q2 =
    buildExamQuestionSnapshot({
      prompt:
        `Pergunta B ${label}`,
      alternatives: {
        A: 'Alternativa A',
        B: 'Alternativa B'
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
        fixedNow
    });

  await put(
    `exam_templates/${templateId}` +
      `/versions/${templateVersionId}` +
      `/questions/${question1}`,
    q1
  );

  if (
    options.missingQuestion !== true
  ) {
    await put(
      `exam_templates/${templateId}` +
        `/versions/${templateVersionId}` +
        `/questions/${question2}`,
      q2
    );
  }

  return {
    organizationId,
    instructorId,
    studentId,
    membershipId,
    sessionId,
    registrationId,
    attemptId,
    resultId,
    orderId,
    transactionId,
    templateId,
    templateVersionId,
    question1,
    question2
  };
}

async function expectCode(
  code,
  fn
) {
  await assert.rejects(
    fn,
    error => {
      assert.ok(
        error instanceof
          ExamAttemptServiceError
      );

      assert.equal(
        error.code,
        code
      );

      return true;
    }
  );
}

async function auditCount(
  attemptId
) {
  const snap =
    await db
      .collection('audit_logs')
      .where(
        'entityId',
        '==',
        attemptId
      )
      .get();

  return snap.size;
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

async function test(name, fn) {
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

    await Promise.all(
      audits.docs.map(
        doc => doc.ref.delete()
      )
    );

    const paths =
      [...trackedPaths]
        .sort(
          (left, right) =>
            right.length -
            left.length
        );

    for (const path of paths) {
      try {
        await db
          .doc(path)
          .delete();
      } catch (_) {}
    }
  } finally {
    await deleteApp(app);
  }
}

async function main() {
  try {
    await test(
      'authorized pago cria exatamente uma tentativa',
      async () => {
        const fixture =
          await seedFixture(
            'start'
          );

        const result =
          await service.startAttempt({
            actorId:
              fixture.studentId,
            registrationId:
              fixture.registrationId
          });

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
            'templateVersionId'
          ),
          false
        );

        assert.equal(
          serialized.includes(
            'templateId'
          ),
          false
        );

        const storedAttempt =
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).data();

        assert.deepEqual(
          storedAttempt
            .orderedQuestionIds,
          [
            fixture.question1,
            fixture.question2
          ]
        );

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

        assert.equal(
          await auditCount(
            fixture.attemptId
          ),
          1
        );
      }
    );

    await test(
      'retry reutiliza tentativa sem duplicar audit',
      async () => {
        const fixture =
          await seedFixture(
            'retry'
          );

        const first =
          await service.startAttempt({
            actorId:
              fixture.studentId,
            registrationId:
              fixture.registrationId
          });

        const second =
          await service.startAttempt({
            actorId:
              fixture.studentId,
            registrationId:
              fixture.registrationId
          });

        assert.equal(
          first.attempt.attemptId,
          second.attempt.attemptId
        );

        assert.equal(
          second.created,
          false
        );

        assert.equal(
          second.resumed,
          true
        );

        assert.equal(
          await auditCount(
            fixture.attemptId
          ),
          1
        );
      }
    );

    await test(
      'starts concorrentes convergem para mesma tentativa',
      async () => {
        const fixture =
          await seedFixture(
            'concurrent'
          );

        const results =
          await Promise.all([
            service.startAttempt({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            }),

            service.startAttempt({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
          ]);

        assert.equal(
          results[0]
            .attempt
            .attemptId,
          fixture.attemptId
        );

        assert.equal(
          results[1]
            .attempt
            .attemptId,
          fixture.attemptId
        );

        const snap =
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
          snap.size,
          1
        );

        assert.equal(
          await auditCount(
            fixture.attemptId
          ),
          1
        );
      }
    );

    await test(
      'outro aluno nao inicia registration alheia',
      async () => {
        const fixture =
          await seedFixture(
            'foreign'
          );

        await expectCode(
          'EXAM_ATTEMPT_STUDENT_MISMATCH',
          () =>
            service.startAttempt({
              actorId:
                id('foreign_actor'),
              registrationId:
                fixture.registrationId
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).exists,
          false
        );
      }
    );

    await test(
      'membership inativa bloqueia inicio',
      async () => {
        const fixture =
          await seedFixture(
            'inactive_membership',
            {
              membershipStatus:
                'suspenso'
            }
          );

        await expectCode(
          'EXAM_ATTEMPT_ACTIVE_STUDENT_MEMBERSHIP_REQUIRED',
          () =>
            service.startAttempt({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );

        const registration =
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data();

        assert.equal(
          registration.status,
          'authorized'
        );

        assert.equal(
          registration.attemptId,
          null
        );
      }
    );

    await test(
      'organizacao inativa bloqueia inicio',
      async () => {
        const fixture =
          await seedFixture(
            'inactive_org',
            {
              organizationStatus:
                'inativa'
            }
          );

        await expectCode(
          'EXAM_ATTEMPT_ORGANIZATION_NOT_ACTIVE',
          () =>
            service.startAttempt({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).exists,
          false
        );
      }
    );

    await test(
      'pagamento nao confirmado bloqueia prova',
      async () => {
        const fixture =
          await seedFixture(
            'unpaid',
            {
              orderStatus:
                'pending_payment',
              transactionStatus:
                'pending'
            }
          );

        await expectCode(
          'EXAM_ATTEMPT_PAYMENT_NOT_CONFIRMED',
          () =>
            service.startAttempt({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).exists,
          false
        );
      }
    );

    await test(
      'sessao cancelada bloqueia execucao',
      async () => {
        const fixture =
          await seedFixture(
            'cancelled',
            {
              sessionStatus:
                'cancelled'
            }
          );

        await expectCode(
          'EXAM_ATTEMPT_SESSION_NOT_EXECUTABLE',
          () =>
            service.startAttempt({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );
      }
    );

    await test(
      'questao ausente nao deixa escrita parcial',
      async () => {
        const fixture =
          await seedFixture(
            'missing_question',
            {
              missingQuestion:
                true
            }
          );

        await expectCode(
          'EXAM_ATTEMPT_QUESTION_NOT_FOUND',
          () =>
            service.startAttempt({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );

        const attempt =
          await db.doc(
            `exam_attempts/${fixture.attemptId}`
          ).get();

        const registration =
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data();

        assert.equal(
          attempt.exists,
          false
        );

        assert.equal(
          registration.status,
          'authorized'
        );

        assert.equal(
          registration.attemptId,
          null
        );
      }
    );

    await test(
      'retomada preserva attempt e prazo original',
      async () => {
        const fixture =
          await seedFixture(
            'resume'
          );

        const started =
          await service.startAttempt({
            actorId:
              fixture.studentId,
            registrationId:
              fixture.registrationId
          });

        const resumed =
          await service.getAttempt({
            actorId:
              fixture.studentId,
            registrationId:
              fixture.registrationId
          });

        assert.equal(
          resumed.resumed,
          true
        );

        assert.equal(
          resumed.attempt.attemptId,
          fixture.attemptId
        );

        assert.equal(
          resumed.attempt.status,
          'in_progress'
        );

        const startedExpiresAt =
          started.attempt.expiresAt
            instanceof Date
            ? started.attempt.expiresAt
                .getTime()
            : started.attempt.expiresAt
                .toMillis();

        const resumedExpiresAt =
          resumed.attempt.expiresAt
            instanceof Date
            ? resumed.attempt.expiresAt
                .getTime()
            : resumed.attempt.expiresAt
                .toMillis();

        assert.equal(
          resumedExpiresAt,
          startedExpiresAt
        );

        assert.equal(
          resumed.questions.length,
          2
        );

        const serialized =
          JSON.stringify(resumed);

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
      }
    );

    await test(
      'outro aluno nao retoma tentativa alheia',
      async () => {
        const fixture =
          await seedFixture(
            'resume_foreign'
          );

        await service.startAttempt({
          actorId:
            fixture.studentId,
          registrationId:
            fixture.registrationId
        });

        await expectCode(
          'EXAM_ATTEMPT_STUDENT_MISMATCH',
          () =>
            service.getAttempt({
              actorId:
                id('resume_foreign_actor'),
              registrationId:
                fixture.registrationId
            })
        );
      }
    );

    await test(
      'registration authorized sem attempt nao e retomavel',
      async () => {
        const fixture =
          await seedFixture(
            'resume_not_started'
          );

        await expectCode(
          'EXAM_ATTEMPT_NOT_AVAILABLE',
          () =>
            service.getAttempt({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).exists,
          false
        );
      }
    );

    await test(
      'tentativa expirada nao pode ser retomada',
      async () => {
        const fixture =
          await seedFixture(
            'resume_expired'
          );

        await service.startAttempt({
          actorId:
            fixture.studentId,
          registrationId:
            fixture.registrationId
        });

        const lateService =
          createExamAttemptService({
            db,
            clock: () =>
              new Date(
                fixedNow.getTime() +
                31 * 60 * 1000
              )
          });

        await expectCode(
          'EXAM_ATTEMPT_EXPIRED',
          () =>
            lateService.getAttempt({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );

        const stored =
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).data();

        assert.equal(
          stored.status,
          'in_progress'
        );

        assert.equal(
          stored.submittedAt,
          null
        );
      }
    );

    await test(
      'finalizacao aprovada cria resultado e consolida estados atomicamente',
      async () => {
        const fixture =
          await seedFixture(
            'final_pass'
          );

        await service.startAttempt({
          actorId:
            fixture.studentId,
          registrationId:
            fixture.registrationId
        });

        const finalized =
          await service.finalizeAttempt({
            actorId:
              fixture.studentId,
            attemptId:
              fixture.attemptId,
            answers: {
              [fixture.question1]:
                'A',
              [fixture.question2]:
                'B'
            }
          });

        assert.equal(
          finalized.created,
          true
        );

        assert.equal(
          finalized.result.resultId,
          fixture.resultId
        );

        assert.equal(
          finalized.result.status,
          'passed'
        );

        assert.equal(
          finalized.result.scoreBps,
          10000
        );

        assert.equal(
          finalized.result.correctCount,
          2
        );

        assert.equal(
          finalized.result.totalQuestions,
          2
        );

        assert.equal(
          finalized.result.certificateEligible,
          true
        );

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

        const registration =
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data();

        assert.equal(
          registration.status,
          'passed'
        );

        assert.equal(
          registration.resultId,
          fixture.resultId
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

        const serialized =
          JSON.stringify(
            finalized.result
          );

        for (
          const forbidden of [
            'studentId',
            'organizationId',
            'templateId',
            'templateVersionId',
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
      }
    );

    await test(
      'resposta ausente conta como incorreta e reprova',
      async () => {
        const fixture =
          await seedFixture(
            'final_fail'
          );

        await service.startAttempt({
          actorId:
            fixture.studentId,
          registrationId:
            fixture.registrationId
        });

        const finalized =
          await service.finalizeAttempt({
            actorId:
              fixture.studentId,
            attemptId:
              fixture.attemptId,
            answers: {
              [fixture.question1]:
                'A'
            }
          });

        assert.equal(
          finalized.result.status,
          'failed'
        );

        assert.equal(
          finalized.result.scoreBps,
          5000
        );

        assert.equal(
          finalized.result.correctCount,
          1
        );

        assert.equal(
          finalized.result.certificateEligible,
          false
        );

        const registration =
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data();

        assert.equal(
          registration.status,
          'failed'
        );
      }
    );

    await test(
      'questao estranha no payload e rejeitada sem escrita parcial',
      async () => {
        const fixture =
          await seedFixture(
            'final_unknown'
          );

        await service.startAttempt({
          actorId:
            fixture.studentId,
          registrationId:
            fixture.registrationId
        });

        await expectCode(
          'UNKNOWN_EXAM_ANSWER_QUESTION',
          () =>
            service.finalizeAttempt({
              actorId:
                fixture.studentId,
              attemptId:
                fixture.attemptId,
              answers: {
                [fixture.question1]:
                  'A',
                question_outside_attempt:
                  'B'
              }
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_results/${fixture.resultId}`
            ).get()
          ).exists,
          false
        );

        const attempt =
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).data();

        const registration =
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data();

        assert.equal(
          attempt.status,
          'in_progress'
        );

        assert.equal(
          attempt.resultId,
          null
        );

        assert.equal(
          registration.status,
          'started'
        );

        assert.equal(
          registration.resultId,
          null
        );
      }
    );

    await test(
      'outro aluno nao finaliza tentativa alheia',
      async () => {
        const fixture =
          await seedFixture(
            'final_foreign'
          );

        await service.startAttempt({
          actorId:
            fixture.studentId,
          registrationId:
            fixture.registrationId
        });

        await expectCode(
          'EXAM_ATTEMPT_STUDENT_MISMATCH',
          () =>
            service.finalizeAttempt({
              actorId:
                id('final_foreign_actor'),
              attemptId:
                fixture.attemptId,
              answers: {}
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_results/${fixture.resultId}`
            ).get()
          ).exists,
          false
        );
      }
    );

    await test(
      'retry da finalizacao reutiliza resultado imutavel',
      async () => {
        const fixture =
          await seedFixture(
            'final_retry'
          );

        await service.startAttempt({
          actorId:
            fixture.studentId,
          registrationId:
            fixture.registrationId
        });

        const first =
          await service.finalizeAttempt({
            actorId:
              fixture.studentId,
            attemptId:
              fixture.attemptId,
            answers: {
              [fixture.question1]:
                'A',
              [fixture.question2]:
                'B'
            }
          });

        const retry =
          await service.finalizeAttempt({
            actorId:
              fixture.studentId,
            attemptId:
              fixture.attemptId,
            answers: {}
          });

        assert.equal(
          first.created,
          true
        );

        assert.equal(
          retry.created,
          false
        );

        assert.deepEqual(
          retry.result,
          first.result
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

    await test(
      'submissoes concorrentes convergem para um unico resultado',
      async () => {
        const fixture =
          await seedFixture(
            'final_concurrent'
          );

        await service.startAttempt({
          actorId:
            fixture.studentId,
          registrationId:
            fixture.registrationId
        });

        const results =
          await Promise.all([
            service.finalizeAttempt({
              actorId:
                fixture.studentId,
              attemptId:
                fixture.attemptId,
              answers: {
                [fixture.question1]:
                  'A',
                [fixture.question2]:
                  'B'
              }
            }),

            service.finalizeAttempt({
              actorId:
                fixture.studentId,
              attemptId:
                fixture.attemptId,
              answers: {}
            })
          ]);

        assert.equal(
          results[0].result.resultId,
          fixture.resultId
        );

        assert.equal(
          results[1].result.resultId,
          fixture.resultId
        );

        assert.equal(
          results[0].result.status,
          results[1].result.status
        );

        assert.deepEqual(
          results
            .map(
              item => item.created
            )
            .sort(),
          [false, true]
        );

        const resultSnap =
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
          resultSnap.size,
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

    await test(
      'tentativa expirada nao pode ser finalizada',
      async () => {
        const fixture =
          await seedFixture(
            'final_expired'
          );

        await service.startAttempt({
          actorId:
            fixture.studentId,
          registrationId:
            fixture.registrationId
        });

        const lateService =
          createExamAttemptService({
            db,
            clock: () =>
              new Date(
                fixedNow.getTime() +
                31 * 60 * 1000
              )
          });

        await expectCode(
          'EXAM_ATTEMPT_SUBMISSION_EXPIRED',
          () =>
            lateService.finalizeAttempt({
              actorId:
                fixture.studentId,
              attemptId:
                fixture.attemptId,
              answers: {}
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_results/${fixture.resultId}`
            ).get()
          ).exists,
          false
        );

        const attempt =
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).data();

        const registration =
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data();

        assert.equal(
          attempt.status,
          'in_progress'
        );

        assert.equal(
          registration.status,
          'started'
        );
      }
    );

    await test(
      'snapshot de gabarito ausente bloqueia scoring sem escrita parcial',
      async () => {
        const fixture =
          await seedFixture(
            'final_missing_snapshot'
          );

        await service.startAttempt({
          actorId:
            fixture.studentId,
          registrationId:
            fixture.registrationId
        });

        await db.doc(
          `exam_templates/${fixture.templateId}` +
          `/versions/${fixture.templateVersionId}` +
          `/questions/${fixture.question2}`
        ).delete();

        await expectCode(
          'EXAM_ATTEMPT_QUESTION_NOT_FOUND',
          () =>
            service.finalizeAttempt({
              actorId:
                fixture.studentId,
              attemptId:
                fixture.attemptId,
              answers: {
                [fixture.question1]:
                  'A'
              }
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_results/${fixture.resultId}`
            ).get()
          ).exists,
          false
        );

        const attempt =
          (
            await db.doc(
              `exam_attempts/${fixture.attemptId}`
            ).get()
          ).data();

        const registration =
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data();

        assert.equal(
          attempt.status,
          'in_progress'
        );

        assert.equal(
          registration.status,
          'started'
        );
      }
    );

    console.log(
      `EXAM_ATTEMPT_SERVICE_EMULATOR_V1_2=${passed}/21`
    );

    if (passed !== 21) {
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