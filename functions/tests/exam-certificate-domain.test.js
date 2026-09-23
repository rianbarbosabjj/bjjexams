'use strict';

const assert =
  require('node:assert/strict');

const {
  ExamCertificateDomainError,
  examCertificateDocumentId,
  validateExamCertificate,
  buildExamCertificate,
  revokeExamCertificate,
  assertExamCertificateDocumentIdentity,
  publicExamCertificate
} = require(
  '../src/exams/exam-certificate-domain'
);

let passed = 0;

function test(name, fn) {
  try {
    fn();
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

function expectCode(
  code,
  fn
) {
  assert.throws(
    fn,
    error => {
      assert.ok(
        error instanceof
          ExamCertificateDomainError
      );

      assert.equal(
        error.code,
        code
      );

      return true;
    }
  );
}

const resultFinalizedAt =
  new Date(
    '2026-09-23T15:00:00.000Z'
  );

const issuedAt =
  new Date(
    '2026-09-23T15:05:00.000Z'
  );

function baseCertificate(
  overrides = {}
) {
  return buildExamCertificate({
    registrationId:
      'registration_1',
    resultId:
      'result_1',
    attemptId:
      'attempt_1',
    sessionId:
      'session_1',
    organizationId:
      'organization_1',
    studentId:
      'student_1',
    instructorId:
      'instructor_1',
    templateId:
      'template_1',
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
    resultFinalizedAt,
    studentName:
      'Aluno Teste',
    organizationName:
      'Academia Teste',
    instructorName:
      'Professor Teste',
    issuedAt,
    issuedBy:
      'student_1',
    ...overrides
  });
}

test(
  'certificate id e deterministico por result',
  () => {
    const first =
      examCertificateDocumentId(
        'result_1'
      );

    const second =
      examCertificateDocumentId(
        'result_1'
      );

    const other =
      examCertificateDocumentId(
        'result_2'
      );

    assert.equal(
      first,
      second
    );

    assert.notEqual(
      first,
      other
    );

    assert.match(
      first,
      /^[a-f0-9]{64}$/
    );
  }
);

test(
  'build cria certificado valido com snapshot canonico',
  () => {
    const certificate =
      baseCertificate();

    assert.equal(
      certificate.certificateVersion,
      1
    );

    assert.equal(
      certificate.status,
      'valid'
    );

    assert.equal(
      certificate.resultId,
      'result_1'
    );

    assert.equal(
      certificate.targetBelt,
      'Azul'
    );

    assert.equal(
      certificate.scoreBps,
      8000
    );

    assert.equal(
      certificate.revokedAt,
      null
    );
  }
);

test(
  'document identity converge para result',
  () => {
    const certificate =
      baseCertificate();

    const certificateId =
      examCertificateDocumentId(
        certificate.resultId
      );

    assert.equal(
      assertExamCertificateDocumentIdentity(
        certificateId,
        certificate
      ).resultId,
      'result_1'
    );
  }
);

test(
  'certificate rejeita versao invalida',
  () => {
    expectCode(
      'INVALID_EXAM_CERTIFICATE_VERSION',
      () =>
        validateExamCertificate({
          ...baseCertificate(),
          certificateVersion: 2
        })
    );
  }
);

test(
  'certificate rejeita identificador invalido',
  () => {
    expectCode(
      'INVALID_EXAM_CERTIFICATE_IDENTIFIER',
      () =>
        validateExamCertificate({
          ...baseCertificate(),
          resultId:
            'bad/result'
        })
    );
  }
);

test(
  'certificate exige nomes de apresentacao',
  () => {
    expectCode(
      'EXAM_CERTIFICATE_TEXT_REQUIRED',
      () =>
        validateExamCertificate({
          ...baseCertificate(),
          studentName: ''
        })
    );

    expectCode(
      'EXAM_CERTIFICATE_TEXT_REQUIRED',
      () =>
        validateExamCertificate({
          ...baseCertificate(),
          organizationName: null
        })
    );
  }
);

test(
  'certificate valida score e contagens',
  () => {
    expectCode(
      'INVALID_EXAM_CERTIFICATE_NUMBER',
      () =>
        validateExamCertificate({
          ...baseCertificate(),
          scoreBps: 10001
        })
    );

    expectCode(
      'INVALID_EXAM_CERTIFICATE_NUMBER',
      () =>
        validateExamCertificate({
          ...baseCertificate(),
          correctCount: 11
        })
    );
  }
);

test(
  'certificate valid nao aceita metadados de revogacao',
  () => {
    expectCode(
      'EXAM_CERTIFICATE_VALID_REVOCATION_FIELDS_NOT_ALLOWED',
      () =>
        validateExamCertificate({
          ...baseCertificate(),
          revokedAt:
            new Date(
              '2026-09-23T16:00:00.000Z'
            )
        })
    );
  }
);

test(
  'certificate revoked exige lifecycle completo',
  () => {
    expectCode(
      'EXAM_CERTIFICATE_TIMESTAMP_REQUIRED',
      () =>
        validateExamCertificate({
          ...baseCertificate(),
          status: 'revoked',
          revokedBy:
            'admin_1',
          revocationReason:
            'Revogacao administrativa.'
        })
    );
  }
);

test(
  'certificate revoked preserva snapshot e lifecycle',
  () => {
    const revokedAt =
      new Date(
        '2026-09-23T16:00:00.000Z'
      );

    const certificate =
      validateExamCertificate({
        ...baseCertificate(),
        status:
          'revoked',
        revokedAt,
        revokedBy:
          'admin_1',
        revocationReason:
          'Revogacao administrativa.'
      });

    assert.equal(
      certificate.status,
      'revoked'
    );

    assert.equal(
      certificate.resultId,
      'result_1'
    );

    assert.equal(
      certificate.revokedBy,
      'admin_1'
    );
  }
);

test(
  'certificate nao pode ser emitido antes do resultado',
  () => {
    expectCode(
      'EXAM_CERTIFICATE_ISSUED_BEFORE_RESULT',
      () =>
        baseCertificate({
          issuedAt:
            new Date(
              '2026-09-23T14:59:59.000Z'
            )
        })
    );
  }
);

test(
  'certificate nao pode ser revogado antes da emissao',
  () => {
    expectCode(
      'EXAM_CERTIFICATE_REVOKED_BEFORE_ISSUED',
      () =>
        validateExamCertificate({
          ...baseCertificate(),
          status:
            'revoked',
          revokedAt:
            new Date(
              '2026-09-23T15:04:00.000Z'
            ),
          revokedBy:
            'admin_1',
          revocationReason:
            'Revogacao administrativa.'
        })
    );
  }
);

test(
  'document identity rejeita certificate id divergente',
  () => {
    expectCode(
      'EXAM_CERTIFICATE_ID_MISMATCH',
      () =>
        assertExamCertificateDocumentIdentity(
          examCertificateDocumentId(
            'result_2'
          ),
          baseCertificate()
        )
    );
  }
);

test(
  'public certificate expoe somente snapshot sanitizado',
  () => {
    const certificate =
      baseCertificate();

    const certificateId =
      examCertificateDocumentId(
        certificate.resultId
      );

    const publicView =
      publicExamCertificate(
        certificateId,
        certificate
      );

    assert.equal(
      publicView.certificateId,
      certificateId
    );

    assert.equal(
      publicView.studentName,
      'Aluno Teste'
    );

    assert.equal(
      publicView.status,
      'valid'
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
          publicView,
          forbidden
        ),
        false
      );
    }
  }
);

test(
  'public certificate normaliza timestamps persistidos',
  () => {
    const persistedFinalizedAt = {
      toMillis: () =>
        resultFinalizedAt.getTime()
    };

    const persistedIssuedAt = {
      toMillis: () =>
        issuedAt.getTime()
    };

    const certificate =
      baseCertificate({
        resultFinalizedAt:
          persistedFinalizedAt,
        issuedAt:
          persistedIssuedAt
      });

    const certificateId =
      examCertificateDocumentId(
        certificate.resultId
      );

    const publicView =
      publicExamCertificate(
        certificateId,
        certificate
      );

    assert.ok(
      publicView.issuedAt
        instanceof Date
    );

    assert.equal(
      publicView.issuedAt.getTime(),
      issuedAt.getTime()
    );

    assert.equal(
      publicView.revokedAt,
      null
    );
  }
);

test(
  'revoke transiciona valid para revoked preservando snapshot',
  () => {
    const source =
      baseCertificate();

    const revokedAt =
      new Date(
        '2026-09-23T16:00:00.000Z'
      );

    const revoked =
      revokeExamCertificate(
        source,
        {
          revokedAt,
          revokedBy:
            'admin_1',
          revocationReason:
            'Revogação administrativa.'
        }
      );

    assert.equal(
      revoked.status,
      'revoked'
    );

    assert.equal(
      revoked.revokedBy,
      'admin_1'
    );

    assert.equal(
      revoked.revocationReason,
      'Revogação administrativa.'
    );

    for (
      const field of [
        'registrationId',
        'resultId',
        'attemptId',
        'sessionId',
        'organizationId',
        'studentId',
        'instructorId',
        'templateId',
        'templateVersionId',
        'targetBelt',
        'scoreBps',
        'correctCount',
        'totalQuestions',
        'studentName',
        'organizationName',
        'instructorName',
        'issuedBy'
      ]
    ) {
      assert.equal(
        revoked[field],
        source[field],
        field
      );
    }
  }
);

test(
  'retry de revogacao com mesmo ator e motivo e idempotente',
  () => {
    const first =
      revokeExamCertificate(
        baseCertificate(),
        {
          revokedAt:
            new Date(
              '2026-09-23T16:00:00.000Z'
            ),
          revokedBy:
            'admin_1',
          revocationReason:
            'Mesmo motivo.'
        }
      );

    const retry =
      revokeExamCertificate(
        first,
        {
          revokedAt:
            new Date(
              '2026-09-23T17:00:00.000Z'
            ),
          revokedBy:
            'admin_1',
          revocationReason:
            'Mesmo motivo.'
        }
      );

    assert.equal(
      retry.status,
      'revoked'
    );

    assert.equal(
      retry.revokedAt.getTime(),
      first.revokedAt.getTime()
    );
  }
);

test(
  'retry de revogacao divergente falha fechado',
  () => {
    const first =
      revokeExamCertificate(
        baseCertificate(),
        {
          revokedAt:
            new Date(
              '2026-09-23T16:00:00.000Z'
            ),
          revokedBy:
            'admin_1',
          revocationReason:
            'Motivo original.'
        }
      );

    expectCode(
      'EXAM_CERTIFICATE_REVOCATION_CONFLICT',
      () =>
        revokeExamCertificate(
          first,
          {
            revokedAt:
              new Date(
                '2026-09-23T17:00:00.000Z'
              ),
            revokedBy:
              'admin_1',
            revocationReason:
              'Outro motivo.'
          }
        )
    );

    expectCode(
      'EXAM_CERTIFICATE_REVOCATION_CONFLICT',
      () =>
        revokeExamCertificate(
          first,
          {
            revokedAt:
              new Date(
                '2026-09-23T17:00:00.000Z'
              ),
            revokedBy:
              'admin_2',
            revocationReason:
              'Motivo original.'
          }
        )
    );
  }
);

test(
  'revogacao exige motivo',
  () => {
    expectCode(
      'EXAM_CERTIFICATE_TEXT_REQUIRED',
      () =>
        revokeExamCertificate(
          baseCertificate(),
          {
            revokedAt:
              new Date(
                '2026-09-23T16:00:00.000Z'
              ),
            revokedBy:
              'admin_1',
            revocationReason:
              '   '
          }
        )
    );
  }
);
console.log(
  `EXAM_CERTIFICATE_DOMAIN_V1_2=${passed}/19`
);

if (passed !== 19) {
  process.exitCode = 1;
}