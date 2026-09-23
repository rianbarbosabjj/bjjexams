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
  buildExamCertificate,
  validateExamCertificate
} = require(
  '../src/exams/exam-certificate-domain'
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
  'demo-bjj-exams-certificate-public';

const app =
  initializeApp(
    { projectId },
    `certificate-public-${process.pid}-${Date.now()}`
  );

const db =
  getFirestore(app);

const service =
  createExamCertificateService({
    db
  });

const finalizedAt =
  new Date(
    '2026-09-23T15:00:00.000Z'
  );

const issuedAt =
  new Date(
    '2026-09-23T15:05:00.000Z'
  );

let passed = 0;

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

function certificateFor(
  resultId,
  overrides = {}
) {
  return buildExamCertificate({
    registrationId:
      `registration_${resultId}`,
    resultId,
    attemptId:
      `attempt_${resultId}`,
    sessionId:
      `session_${resultId}`,
    organizationId:
      'organization_public',
    studentId:
      'student_public',
    instructorId:
      'instructor_public',
    templateId:
      'template_public',
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
      finalizedAt,
    studentName:
      'Aluno Público',
    organizationName:
      'Academia Pública',
    instructorName:
      'Professor Público',
    issuedAt,
    issuedBy:
      'student_public',
    ...overrides
  });
}

async function cleanup() {
  try {
    const snap =
      await db.collection(
        'exam_certificates'
      ).get();

    for (
      const doc of snap.docs
    ) {
      await doc.ref.delete();
    }
  } finally {
    await deleteApp(app)
      .catch(() => {});
  }
}

async function main() {
  try {
    await test(
      'certificado valido e verificavel publicamente',
      async () => {
        const resultId =
          'result_public_valid';

        const certificateId =
          examCertificateDocumentId(
            resultId
          );

        await db.doc(
          `exam_certificates/${certificateId}`
        ).set(
          certificateFor(
            resultId
          )
        );

        const view =
          await service.verifyPublicCertificate({
            certificateId
          });

        assert.equal(
          view.certificateId,
          certificateId
        );

        assert.equal(
          view.status,
          'valid'
        );

        assert.equal(
          view.studentName,
          'Aluno Público'
        );

        assert.equal(
          view.targetBelt,
          'Azul'
        );

        for (
          const forbidden of [
            'studentId',
            'organizationId',
            'instructorId',
            'registrationId',
            'resultId',
            'attemptId',
            'sessionId',
            'templateId',
            'templateVersionId',
            'issuedBy',
            'revokedBy',
            'revocationReason'
          ]
        ) {
          assert.equal(
            Object.hasOwn(
              view,
              forbidden
            ),
            false
          );
        }
      }
    );

    await test(
      'certificado revogado continua verificavel como revogado',
      async () => {
        const resultId =
          'result_public_revoked';

        const certificateId =
          examCertificateDocumentId(
            resultId
          );

        const valid =
          certificateFor(
            resultId
          );

        const revoked =
          validateExamCertificate({
            ...valid,
            status:
              'revoked',
            revokedAt:
              new Date(
                '2026-09-23T16:00:00.000Z'
              ),
            revokedBy:
              'admin_public',
            revocationReason:
              'Revogação administrativa de teste.'
          });

        await db.doc(
          `exam_certificates/${certificateId}`
        ).set(
          revoked
        );

        const view =
          await service.verifyPublicCertificate({
            certificateId
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
      }
    );

    await test(
      'certificado inexistente retorna not found',
      async () => {
        await expectCode(
          'EXAM_CERTIFICATE_NOT_FOUND',
          () =>
            service.verifyPublicCertificate({
              certificateId:
                'a'.repeat(64)
            })
        );
      }
    );

    await test(
      'documento sob certificateId divergente falha fechado',
      async () => {
        const sourceResultId =
          'result_public_source';

        const source =
          certificateFor(
            sourceResultId
          );

        const wrongCertificateId =
          examCertificateDocumentId(
            'result_public_wrong'
          );

        await db.doc(
          `exam_certificates/${wrongCertificateId}`
        ).set(
          source
        );

        await expectCode(
          'EXAM_CERTIFICATE_ID_MISMATCH',
          () =>
            service.verifyPublicCertificate({
              certificateId:
                wrongCertificateId
            })
        );
      }
    );

    console.log(
      `EXAM_CERTIFICATE_PUBLIC_SERVICE_EMULATOR_V1_2=${passed}/4`
    );

    if (passed !== 4) {
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