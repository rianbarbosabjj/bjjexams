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
  ExamCertificateServiceError,
  createExamCertificateService
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
  validateExamRegistration
} = require(
  '../src/exams/exam-registration-domain'
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
  'demo-bjj-exams-certificate-revocation';

const app =
  initializeApp(
    { projectId },
    `certificate-revocation-${process.pid}-${Date.now()}`
  );

const db =
  getFirestore(app);

const runId =
  `${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;

const issuedAt =
  new Date(
    '2026-09-23T15:05:00.000Z'
  );

let currentTime =
  new Date(
    '2026-09-23T16:00:00.000Z'
  );

const service =
  createExamCertificateService({
    db,
    clock: () =>
      new Date(
        currentTime.getTime()
      )
  });

let passed = 0;

const trackedPaths =
  new Set();

function id(
  label
) {
  return `revoke_${label}_${runId}`;
}

function track(
  path
) {
  trackedPaths.add(
    path
  );

  return path;
}

async function put(
  path,
  data
) {
  track(
    path
  );

  await db.doc(
    path
  ).set(
    data
  );
}

async function test(
  name,
  fn
) {
  await fn();

  passed += 1;

  console.log(
    `PASS | ${name}`
  );
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

async function auditCount(
  certificateId
) {
  const snapshot =
    await db.collection(
      'audit_logs'
    )
      .where(
        'entityId',
        '==',
        certificateId
      )
      .get();

  return snapshot.docs.filter(
    doc =>
      doc.data()?.action ===
        'exam.certificate.revoked'
  ).length;
}

async function seedFixture(
  label
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

  const attemptId =
    id(`attempt_${label}`);

  const resultId =
    id(`result_${label}`);

  const orderId =
    id(`order_${label}`);

  const registrationId =
    id(`registration_${label}`);

  const certificateId =
    examCertificateDocumentId(
      resultId
    );

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
        'certified',
      orderId,
      attemptId,
      resultId,
      certificateId,
      selectedAt:
        new Date(
          '2026-09-23T14:00:00.000Z'
        ),
      paidAt:
        new Date(
          '2026-09-23T14:10:00.000Z'
        ),
      authorizedAt:
        new Date(
          '2026-09-23T14:15:00.000Z'
        ),
      cancelledAt:
        null,
      updatedAt:
        issuedAt
    });

  const certificate =
    buildExamCertificate({
      registrationId,
      resultId,
      attemptId,
      sessionId,
      organizationId,
      studentId,
      instructorId,
      templateId:
        id(`template_${label}`),
      templateVersionId:
        'v0000001',
      targetBelt:
        'Azul',
      scoreBps:
        8000,
      correctCount:
        8,
      totalQuestions:
        10,
      resultFinalizedAt:
        new Date(
          '2026-09-23T15:00:00.000Z'
        ),
      studentName:
        `Aluno ${label}`,
      organizationName:
        `Academia ${label}`,
      instructorName:
        `Instrutor ${label}`,
      issuedAt,
      issuedBy:
        studentId
    });

  await put(
    `exam_registrations/${registrationId}`,
    registration
  );

  await put(
    `exam_certificates/${certificateId}`,
    certificate
  );

  await put(
    `exam_results/${resultId}`,
    {
      sentinel:
        `result_${label}`,
      scoreBps:
        8000
    }
  );

  await put(
    `usuarios/${studentId}`,
    {
      sentinel:
        `student_${label}`,
      faixa_atual:
        'Branca'
    }
  );

  await put(
    `orders/${orderId}`,
    {
      sentinel:
        `order_${label}`,
      status:
        'paid'
    }
  );

  await put(
    `creditos_professor/${instructorId}`,
    {
      sentinel:
        `credits_${label}`,
      saldo:
        77
    }
  );

  return {
    registrationId,
    resultId,
    studentId,
    instructorId,
    orderId,
    certificateId
  };
}

async function cleanup() {
  try {
    const audit =
      await db.collection(
        'audit_logs'
      ).get();

    for (
      const doc of audit.docs
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

    for (
      const path of paths
    ) {
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
      'super_admin revoga certificado preservando registration resultado faixa e financeiro',
      async () => {
        const fixture =
          await seedFixture(
            'super'
          );

        const paths = {
          registration:
            `exam_registrations/${fixture.registrationId}`,
          result:
            `exam_results/${fixture.resultId}`,
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

        const result =
          await service.revokeCertificate({
            actorId:
              id('super_admin'),
            claims: {
              super_admin:
                true
            },
            certificateId:
              fixture.certificateId,
            reason:
              'Revogação administrativa.'
          });

        assert.equal(
          result.changed,
          true
        );

        assert.equal(
          result.certificate.status,
          'revoked'
        );

        const stored =
          (
            await db.doc(
              `exam_certificates/${fixture.certificateId}`
            ).get()
          ).data();

        assert.equal(
          stored.status,
          'revoked'
        );

        assert.equal(
          stored.revocationReason,
          'Revogação administrativa.'
        );

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
            `${key} foi alterado`
          );
        }

        assert.equal(
          before.registration.status,
          'certified'
        );

        assert.equal(
          (
            await db.doc(
              paths.student
            ).get()
          ).data().faixa_atual,
          'Branca'
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
      'platform_admin pode revogar certificado',
      async () => {
        const fixture =
          await seedFixture(
            'platform'
          );

        const result =
          await service.revokeCertificate({
            actorId:
              id('platform_admin'),
            claims: {
              platform_admin:
                true
            },
            certificateId:
              fixture.certificateId,
            reason:
              'Revogação pela plataforma.'
          });

        assert.equal(
          result.changed,
          true
        );

        assert.equal(
          result.certificate.status,
          'revoked'
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
      'ator sem papel administrativo e bloqueado',
      async () => {
        const fixture =
          await seedFixture(
            'unauthorized'
          );

        await expectCode(
          'EXAM_CERTIFICATE_ADMIN_PERMISSION_REQUIRED',
          () =>
            service.revokeCertificate({
              actorId:
                id('support_user'),
              claims: {
                support_admin:
                  true
              },
              certificateId:
                fixture.certificateId,
              reason:
                'Tentativa sem autorização.'
            })
        );

        assert.equal(
          (
            await db.doc(
              `exam_certificates/${fixture.certificateId}`
            ).get()
          ).data().status,
          'valid'
        );

        assert.equal(
          await auditCount(
            fixture.certificateId
          ),
          0
        );
      }
    );

    await test(
      'certificado ausente retorna not found',
      async () => {
        await expectCode(
          'EXAM_CERTIFICATE_NOT_FOUND',
          () =>
            service.revokeCertificate({
              actorId:
                id('admin_missing'),
              claims: {
                super_admin:
                  true
              },
              certificateId:
                'a'.repeat(64),
              reason:
                'Certificado ausente.'
            })
        );
      }
    );

    await test(
      'retry com mesmo ator e motivo e idempotente sem novo audit',
      async () => {
        const fixture =
          await seedFixture(
            'retry'
          );

        const actorId =
          id('admin_retry');

        const first =
          await service.revokeCertificate({
            actorId,
            claims: {
              super_admin:
                true
            },
            certificateId:
              fixture.certificateId,
            reason:
              'Mesmo motivo.'
          });

        const firstRevokedAt =
          first.certificate
            .revokedAt
            .getTime();

        currentTime =
          new Date(
            '2026-09-23T18:00:00.000Z'
          );

        const retry =
          await service.revokeCertificate({
            actorId,
            claims: {
              super_admin:
                true
            },
            certificateId:
              fixture.certificateId,
            reason:
              'Mesmo motivo.'
          });

        assert.equal(
          first.changed,
          true
        );

        assert.equal(
          retry.changed,
          false
        );

        assert.equal(
          retry.certificate
            .revokedAt
            .getTime(),
          firstRevokedAt
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
      'retry divergente de motivo ou ator falha fechado',
      async () => {
        const fixture =
          await seedFixture(
            'conflict'
          );

        const actorId =
          id('admin_conflict');

        await service.revokeCertificate({
          actorId,
          claims: {
            platform_admin:
              true
          },
          certificateId:
            fixture.certificateId,
          reason:
            'Motivo original.'
        });

        await expectCode(
          'EXAM_CERTIFICATE_REVOCATION_CONFLICT',
          () =>
            service.revokeCertificate({
              actorId,
              claims: {
                platform_admin:
                  true
              },
              certificateId:
                fixture.certificateId,
              reason:
                'Motivo diferente.'
            })
        );

        await expectCode(
          'EXAM_CERTIFICATE_REVOCATION_CONFLICT',
          () =>
            service.revokeCertificate({
              actorId:
                id('other_admin'),
              claims: {
                super_admin:
                  true
              },
              certificateId:
                fixture.certificateId,
              reason:
                'Motivo original.'
            })
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
      'certificado revogado permanece verificavel sem expor motivo interno',
      async () => {
        const fixture =
          await seedFixture(
            'public'
          );

        await service.revokeCertificate({
          actorId:
            id('public_admin'),
          claims: {
            super_admin:
              true
          },
          certificateId:
            fixture.certificateId,
          reason:
            'Motivo interno não público.'
        });

        const view =
          await service.verifyPublicCertificate({
            certificateId:
              fixture.certificateId
          });

        assert.equal(
          view.status,
          'revoked'
        );

        assert.ok(
          view.revokedAt
            instanceof Date
        );

        assert.equal(
          Object.hasOwn(
            view,
            'revocationReason'
          ),
          false
        );

        assert.equal(
          Object.hasOwn(
            view,
            'revokedBy'
          ),
          false
        );
      }
    );

    console.log(
      `EXAM_CERTIFICATE_REVOCATION_SERVICE_EMULATOR_V1_2=${passed}/7`
    );

    if (passed !== 7) {
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