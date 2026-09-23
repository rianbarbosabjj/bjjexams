'use strict';

const assert =
  require('node:assert/strict');

const {
  initializeApp,
  deleteApp
} = require(
  'firebase-admin/app'
);

const {
  getFirestore
} = require(
  'firebase-admin/firestore'
);

const {
  createExamCertificateService,
  ExamCertificateServiceError
} = require(
  '../src/exams/exam-certificate-service'
);

const {
  examCertificateDocumentId,
  buildExamCertificate
} = require(
  '../src/exams/exam-certificate-domain'
);

const {
  examRegistrationDocumentId,
  validateExamRegistration,
  markRegistrationCertified
} = require(
  '../src/exams/exam-registration-domain'
);

const {
  examAttemptDocumentId,
  validateExamAttempt
} = require(
  '../src/exams/exam-attempt-domain'
);

const {
  examResultDocumentId,
  validateExamResult
} = require(
  '../src/exams/exam-result-domain'
);

const {
  validateExamSession
} = require(
  '../src/exams/exam-session-domain'
);

const {
  validateExamTemplate,
  validateExamTemplateVersion,
  examTemplateVersionDocumentId
} = require(
  '../src/exams/exam-template-domain'
);

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

const projectId =
  'demo-bjj-exams-certificate-service';

const app =
  initializeApp(
    { projectId },
    `certificate-service-${process.pid}-${Date.now()}`
  );

const db =
  getFirestore(app);

const runId =
  `${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;

const t0 =
  new Date(
    '2026-09-23T15:00:00.000Z'
  );

const resultTime =
  new Date(
    '2026-09-23T16:30:00.000Z'
  );

const fixedNow =
  new Date(
    '2026-09-23T17:00:00.000Z'
  );

const service =
  createExamCertificateService({
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
  return `cert_${label}_${runId}`;
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
  await db.doc(path).set(data);
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
          ExamCertificateServiceError
      );

      assert.equal(
        error.code,
        code
      );

      return true;
    }
  );
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

async function auditCount(
  certificateId
) {
  const snap =
    await db.collection(
      'audit_logs'
    )
      .where(
        'entityId',
        '==',
        certificateId
      )
      .get();

  return snap.docs.filter(
    doc =>
      doc.data()?.action ===
        'exam.certificate.issued'
  ).length;
}

async function seedFixture(
  label,
  options = {}
) {
  const organizationId =
    id(`org_${label}`);

  const studentId =
    id(`student_${label}`);

  const instructorId =
    id(`instructor_${label}`);

  const membershipId =
    id(`membership_${label}`);

  const sessionId =
    id(`session_${label}`);

  const templateId =
    id(`template_${label}`);

  const templateVersionId =
    examTemplateVersionDocumentId(
      1
    );

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

  const orderId =
    id(`order_${label}`);

  const outcome =
    options.outcome ||
    'passed';

  const scoreBps =
    outcome === 'passed'
      ? 8000
      : 6000;

  const certificateEligible =
    outcome === 'passed';

  const requestedStatus =
    options.registrationStatus ||
    outcome;

  const registration =
    validateExamRegistration({
      sessionId,
      organizationId,
      studentId,
      instructorId,
      currentBelt:
        'Branca',
      targetBelt:
        'Azul',
      membershipId,
      status:
        requestedStatus,
      orderId,
      attemptId,
      resultId,
      certificateId:
        options.certificateId ||
        null,
      selectedAt:
        t0,
      paidAt:
        t0,
      authorizedAt:
        t0,
      cancelledAt:
        null,
      updatedAt:
        resultTime
    });

  const attempt =
    validateExamAttempt({
      registrationId,
      sessionId,
      organizationId,
      studentId,
      templateId:
        options.attemptTemplateId ||
        templateId,
      templateVersionId:
        options.attemptTemplateVersionId ||
        templateVersionId,
      orderedQuestionIds: [
        id(`question_${label}`)
      ],
      status:
        'submitted',
      startedAt:
        new Date(
          '2026-09-23T15:30:00.000Z'
        ),
      expiresAt:
        new Date(
          '2026-09-23T16:30:00.000Z'
        ),
      submittedAt:
        resultTime,
      resultId,
      createdAt:
        new Date(
          '2026-09-23T15:30:00.000Z'
        ),
      updatedAt:
        resultTime
    });

  const result =
    validateExamResult({
      resultVersion: 1,
      attemptId,
      registrationId,
      sessionId,
      organizationId,
      studentId,
      templateId,
      templateVersionId,
      targetBelt:
        'Azul',
      scoreBps,
      correctCount:
        outcome === 'passed'
          ? 8
          : 6,
      totalQuestions:
        10,
      outcome,
      reason:
        outcome === 'passed'
          ? 'score_passed'
          : 'score_failed',
      certificateEligible,
      finalizedAt:
        resultTime
    });

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
        10000,
      currency:
        'BRL',
      financialRuleId:
        null,
      scheduledAt:
        null,
      createdBy:
        instructorId,
      createdAt:
        t0,
      updatedAt:
        t0
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
        t0,
      updatedAt:
        t0
    });

  const questionId =
    id(`template_question_${label}`);

  const templateVersion =
    validateExamTemplateVersion({
      templateId,
      version:
        1,
      status:
        'active',
      timeLimitMinutes:
        60,
      passingScoreBps:
        7000,
      questionCount:
        1,
      questionIds: [
        questionId
      ],
      source:
        'certificate_service_test',
      createdBy:
        instructorId,
      createdAt:
        t0,
      activatedAt:
        t0
    });

  await Promise.all([
    put(
      `exam_registrations/${registrationId}`,
      registration
    ),
    put(
      `exam_attempts/${attemptId}`,
      attempt
    ),
    put(
      `exam_results/${resultId}`,
      result
    ),
    put(
      `exam_sessions/${sessionId}`,
      session
    ),
    put(
      `exam_templates/${templateId}`,
      template
    ),
    put(
      `exam_templates/${templateId}/versions/${templateVersionId}`,
      templateVersion
    ),
    put(
      `usuarios/${studentId}`,
      {
        nome:
          `Aluno ${label}`,
        faixa_atual:
          'Branca',
        status_conta:
          'ativo'
      }
    ),
    put(
      `usuarios/${instructorId}`,
      {
        nome:
          `Instrutor ${label}`,
        faixa_atual:
          'Preta',
        status_conta:
          'ativo'
      }
    ),
    put(
      `organizacoes/${organizationId}`,
      {
        nome:
          `Academia ${label}`,
        status:
          'active'
      }
    ),
    put(
      `orders/${orderId}`,
      {
        sentinel:
          `order_${label}`,
        status:
          'paid'
      }
    ),
    put(
      `creditos_professor/${instructorId}`,
      {
        sentinel:
          `credits_${label}`,
        saldo:
          77
      }
    )
  ]);

  return {
    organizationId,
    studentId,
    instructorId,
    membershipId,
    sessionId,
    templateId,
    templateVersionId,
    registrationId,
    attemptId,
    resultId,
    orderId,
    certificateId:
      examCertificateDocumentId(
        resultId
      )
  };
}

async function cleanup() {
  try {
    const auditSnap =
      await db.collection(
        'audit_logs'
      ).get();

    for (
      const doc of auditSnap.docs
    ) {
      await doc.ref.delete();
    }

    const certificateSnap =
      await db.collection(
        'exam_certificates'
      ).get();

    for (
      const doc of certificateSnap.docs
    ) {
      await doc.ref.delete();
    }

    const legacySnap =
      await db.collection(
        'certificados'
      ).get();

    for (
      const doc of legacySnap.docs
    ) {
      await doc.ref.delete();
    }

    const paths =
      Array.from(
        trackedPaths
      ).sort(
        (a, b) =>
          b.split('/').length -
          a.split('/').length
      );

    for (const path of paths) {
      await db.doc(path)
        .delete()
        .catch(() => {});
    }
  } finally {
    await deleteApp(app)
      .catch(() => {});
  }
}

async function main() {
  try {
    await test(
      'passed elegivel cria exatamente um certificado e certifica registration',
      async () => {
        const fixture =
          await seedFixture(
            'issue'
          );

        const response =
          await service.issueCertificate({
            actorId:
              fixture.studentId,
            registrationId:
              fixture.registrationId
          });

        assert.equal(
          response.created,
          true
        );

        assert.equal(
          response.certificate
            .certificateId,
          fixture.certificateId
        );

        assert.equal(
          response.certificate.status,
          'valid'
        );

        const certificateSnap =
          await db.doc(
            `exam_certificates/${fixture.certificateId}`
          ).get();

        assert.equal(
          certificateSnap.exists,
          true
        );

        const registration =
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data();

        assert.equal(
          registration.status,
          'certified'
        );

        assert.equal(
          registration.certificateId,
          fixture.certificateId
        );

        assert.equal(
          await auditCount(
            fixture.certificateId
          ),
          1
        );
      }
    );

    await test(
      'retry retorna mesmo certificado sem duplicar audit',
      async () => {
        const fixture =
          await seedFixture(
            'retry'
          );

        const first =
          await service.issueCertificate({
            actorId:
              fixture.studentId,
            registrationId:
              fixture.registrationId
          });

        const second =
          await service.issueCertificate({
            actorId:
              fixture.studentId,
            registrationId:
              fixture.registrationId
          });

        assert.equal(
          first.created,
          true
        );

        assert.equal(
          second.created,
          false
        );

        assert.equal(
          first.certificate
            .certificateId,
          second.certificate
            .certificateId
        );

        assert.equal(
          await auditCount(
            fixture.certificateId
          ),
          1
        );
      }
    );

    await test(
      'emissao nao depende de membership ativa depois da aprovacao',
      async () => {
        const fixture =
          await seedFixture(
            'no_membership'
          );

        const memberships =
          await db.collection(
            'vinculos_organizacao'
          )
            .where(
              'usuario_id',
              '==',
              fixture.studentId
            )
            .get();

        assert.equal(
          memberships.empty,
          true
        );

        const response =
          await service.issueCertificate({
            actorId:
              fixture.studentId,
            registrationId:
              fixture.registrationId
          });

        assert.equal(
          response.created,
          true
        );
      }
    );

    await test(
      'outro aluno nao pode emitir certificado alheio',
      async () => {
        const fixture =
          await seedFixture(
            'foreign'
          );

        await expectCode(
          'EXAM_CERTIFICATE_STUDENT_MISMATCH',
          () =>
            service.issueCertificate({
              actorId:
                id(
                  'foreign_actor'
                ),
              registrationId:
                fixture.registrationId
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_certificates/${fixture.certificateId}`
            ).get()
          ).exists,
          false
        );
      }
    );

    await test(
      'failed nao pode emitir certificado',
      async () => {
        const fixture =
          await seedFixture(
            'failed',
            {
              outcome:
                'failed'
            }
          );

        await expectCode(
          'EXAM_CERTIFICATE_REGISTRATION_STATE_REQUIRED',
          () =>
            service.issueCertificate({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_certificates/${fixture.certificateId}`
            ).get()
          ).exists,
          false
        );
      }
    );

    await test(
      'submitted nao pode emitir certificado',
      async () => {
        const fixture =
          await seedFixture(
            'submitted',
            {
              registrationStatus:
                'submitted'
            }
          );

        await expectCode(
          'EXAM_CERTIFICATE_REGISTRATION_STATE_REQUIRED',
          () =>
            service.issueCertificate({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );
      }
    );

    await test(
      'needs_reconciliation nao pode emitir certificado',
      async () => {
        const fixture =
          await seedFixture(
            'reconciliation',
            {
              registrationStatus:
                'needs_reconciliation'
            }
          );

        await expectCode(
          'EXAM_CERTIFICATE_REGISTRATION_STATE_REQUIRED',
          () =>
            service.issueCertificate({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );
      }
    );

    await test(
      'resultado nao elegivel falha fechado sem escrita parcial',
      async () => {
        const fixture =
          await seedFixture(
            'ineligible'
          );

        const resultRef =
          db.doc(
            `exam_results/${fixture.resultId}`
          );

        const result =
          (
            await resultRef.get()
          ).data();

        await resultRef.set({
          ...result,
          scoreBps:
            6000,
          correctCount:
            6,
          outcome:
            'failed',
          reason:
            'score_failed',
          certificateEligible:
            false
        });

        await expectCode(
          'EXAM_CERTIFICATE_RESULT_NOT_ELIGIBLE',
          () =>
            service.issueCertificate({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_certificates/${fixture.certificateId}`
            ).get()
          ).exists,
          false
        );

        assert.equal(
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data().status,
          'passed'
        );
      }
    );

    await test(
      'cadeia divergente falha fechado sem certificar registration',
      async () => {
        const fixture =
          await seedFixture(
            'chain'
          );

        const attemptRef =
          db.doc(
            `exam_attempts/${fixture.attemptId}`
          );

        await attemptRef.update({
          templateId:
            id(
              'rogue_template'
            )
        });

        await expectCode(
          'EXAM_CERTIFICATE_CHAIN_MISMATCH',
          () =>
            service.issueCertificate({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data().status,
          'passed'
        );

        assert.equal(
          (
            await db.doc(
              `exam_certificates/${fixture.certificateId}`
            ).get()
          ).exists,
          false
        );
      }
    );

    await test(
      'perfil ausente bloqueia emissao sem escrita parcial',
      async () => {
        const fixture =
          await seedFixture(
            'profile'
          );

        await db.doc(
          `usuarios/${fixture.studentId}`
        ).delete();

        await expectCode(
          'EXAM_CERTIFICATE_STUDENT_PROFILE_NOT_FOUND',
          () =>
            service.issueCertificate({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_registrations/${fixture.registrationId}`
            ).get()
          ).data().status,
          'passed'
        );

        assert.equal(
          (
            await db.doc(
              `exam_certificates/${fixture.certificateId}`
            ).get()
          ).exists,
          false
        );
      }
    );

    await test(
      'certificado existente divergente falha fechado',
      async () => {
        const fixture =
          await seedFixture(
            'conflict'
          );

        const registrationRef =
          db.doc(
            `exam_registrations/${fixture.registrationId}`
          );

        const passedRegistration =
          (
            await registrationRef.get()
          ).data();

        const certified =
          markRegistrationCertified(
            passedRegistration,
            {
              certificateId:
                fixture.certificateId,
              certifiedAt:
                fixedNow
            }
          );

        await registrationRef.set(
          certified
        );

        const result =
          (
            await db.doc(
              `exam_results/${fixture.resultId}`
            ).get()
          ).data();

        const conflicting =
          buildExamCertificate({
            registrationId:
              id(
                'wrong_registration'
              ),
            resultId:
              fixture.resultId,
            attemptId:
              fixture.attemptId,
            sessionId:
              fixture.sessionId,
            organizationId:
              fixture.organizationId,
            studentId:
              fixture.studentId,
            instructorId:
              fixture.instructorId,
            templateId:
              fixture.templateId,
            templateVersionId:
              fixture.templateVersionId,
            targetBelt:
              'Azul',
            scoreBps:
              result.scoreBps,
            correctCount:
              result.correctCount,
            totalQuestions:
              result.totalQuestions,
            resultFinalizedAt:
              result.finalizedAt,
            studentName:
              'Aluno Conflict',
            organizationName:
              'Academia Conflict',
            instructorName:
              'Instrutor Conflict',
            issuedAt:
              fixedNow,
            issuedBy:
              fixture.studentId
          });

        await put(
          `exam_certificates/${fixture.certificateId}`,
          conflicting
        );

        await expectCode(
          'EXAM_CERTIFICATE_EXISTING_CONFLICT',
          () =>
            service.issueCertificate({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );
      }
    );

    await test(
      'registration certified sem documento canonico falha fechado',
      async () => {
        const fixture =
          await seedFixture(
            'missing_certificate'
          );

        const registrationRef =
          db.doc(
            `exam_registrations/${fixture.registrationId}`
          );

        const certified =
          markRegistrationCertified(
            (
              await registrationRef.get()
            ).data(),
            {
              certificateId:
                fixture.certificateId,
              certifiedAt:
                fixedNow
            }
          );

        await registrationRef.set(
          certified
        );

        await expectCode(
          'EXAM_CERTIFICATE_STATE_INCONSISTENT',
          () =>
            service.issueCertificate({
              actorId:
                fixture.studentId,
              registrationId:
                fixture.registrationId
            })
        );
      }
    );

    await test(
      'emissao preserva resultado tentativa sessao faixa financeiro e legado',
      async () => {
        const fixture =
          await seedFixture(
            'immutability'
          );

        const paths = {
          result:
            `exam_results/${fixture.resultId}`,
          attempt:
            `exam_attempts/${fixture.attemptId}`,
          session:
            `exam_sessions/${fixture.sessionId}`,
          student:
            `usuarios/${fixture.studentId}`,
          order:
            `orders/${fixture.orderId}`,
          credits:
            `creditos_professor/${fixture.instructorId}`
        };

        const before = {};

        for (
          const [
            key,
            path
          ] of Object.entries(
            paths
          )
        ) {
          before[key] =
            (
              await db.doc(path)
                .get()
            ).data();
        }

        const legacyBefore =
          (
            await db.collection(
              'certificados'
            ).get()
          ).size;

        await service.issueCertificate({
          actorId:
            fixture.studentId,
          registrationId:
            fixture.registrationId
        });

        for (
          const [
            key,
            path
          ] of Object.entries(
            paths
          )
        ) {
          const after =
            (
              await db.doc(path)
                .get()
            ).data();

          assert.deepEqual(
            after,
            before[key],
            `${key} foi alterado pela emissao`
          );
        }

        const student =
          (
            await db.doc(
              paths.student
            ).get()
          ).data();

        assert.equal(
          student.faixa_atual,
          'Branca'
        );

        const legacyAfter =
          (
            await db.collection(
              'certificados'
            ).get()
          ).size;

        assert.equal(
          legacyAfter,
          legacyBefore
        );
      }
    );

    console.log(
      `EXAM_CERTIFICATE_SERVICE_EMULATOR_V1_2=${passed}/13`
    );

    if (passed !== 13) {
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