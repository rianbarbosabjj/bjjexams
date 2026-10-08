"use strict";

const assert =
  require("assert");

const {
  buildExamCertificate,
  revokeExamCertificate,
  examCertificateDocumentId
} = require(
  "../functions/src/exams/exam-certificate-domain"
);

const {
  OPERATIONAL_CERTIFICATE_VIEW_FIELDS,
  EXAM_CERTIFICATE_STATUSES,
  AdminCertificateModelError,
  buildOperationalCertificateView
} = require(
  "../functions/src/admin/admin-certificate-models"
);

function sampleCertificate(
  overrides = {}
) {
  return buildExamCertificate({
    registrationId:
      "registration-1",

    resultId:
      "result-1",

    attemptId:
      "attempt-1",

    sessionId:
      "session-1",

    organizationId:
      "organization-1",

    studentId:
      "student-1",

    instructorId:
      "instructor-1",

    templateId:
      "template-1",

    templateVersionId:
      "v1",

    targetBelt:
      "Azul",

    scoreBps:
      8000,

    correctCount:
      8,

    totalQuestions:
      10,

    resultFinalizedAt:
      new Date(
        "2026-09-20T12:00:00.000Z"
      ),

    studentName:
      "Aluno Teste",

    organizationName:
      "Academia Teste",

    instructorName:
      "Professor Teste",

    issuedAt:
      new Date(
        "2026-09-20T12:05:00.000Z"
      ),

    issuedBy:
      "student-1",

    ...overrides
  });
}

function sortedKeys(
  value
) {
  return Object
    .keys(value)
    .sort();
}

function main() {
  assert.deepStrictEqual(
    OPERATIONAL_CERTIFICATE_VIEW_FIELDS,
    [
      "certificateId",
      "status",
      "studentName",
      "organizationName",
      "targetBelt",
      "scoreBps",
      "correctCount",
      "totalQuestions",
      "issuedAt",
      "revokedAt"
    ]
  );

  assert.deepStrictEqual(
    EXAM_CERTIFICATE_STATUSES,
    [
      "valid",
      "revoked"
    ]
  );

  const certificate =
    sampleCertificate();

  const certificateId =
    examCertificateDocumentId(
      certificate.resultId
    );

  const view =
    buildOperationalCertificateView({
      certificateId,
      certificate
    });

  assert.deepStrictEqual(
    sortedKeys(view),
    [
      "certificateId",
      "correctCount",
      "issuedAt",
      "organizationName",
      "revokedAt",
      "scoreBps",
      "status",
      "studentName",
      "targetBelt",
      "totalQuestions"
    ]
  );

  assert.strictEqual(
    view.certificateId,
    certificateId
  );

  assert.strictEqual(
    view.status,
    "valid"
  );

  assert.strictEqual(
    view.studentName,
    "Aluno Teste"
  );

  assert.strictEqual(
    view.organizationName,
    "Academia Teste"
  );

  assert.strictEqual(
    view.targetBelt,
    "Azul"
  );

  assert.strictEqual(
    view.scoreBps,
    8000
  );

  assert.strictEqual(
    view.correctCount,
    8
  );

  assert.strictEqual(
    view.totalQuestions,
    10
  );

  assert.strictEqual(
    view.issuedAt,
    "2026-09-20T12:05:00.000Z"
  );

  assert.strictEqual(
    view.revokedAt,
    null
  );

  for (
    const forbidden
    of [
      "correctAnswers",
      "correctAnswer",
      "studentId",
      "organizationId",
      "instructorId",
      "instructorName",
      "issuedBy",
      "revokedBy",
      "revocationReason",
      "registrationId",
      "resultId",
      "attemptId",
      "sessionId",
      "templateId",
      "templateVersionId"
    ]
  ) {
    assert.strictEqual(
      Object.prototype
        .hasOwnProperty.call(
          view,
          forbidden
        ),
      false,
      `OperationalCertificateView must not expose ${forbidden}`
    );
  }

  const revoked =
    revokeExamCertificate(
      certificate,
      {
        revokedBy:
          "platform-admin-1",

        revocationReason:
          "Administrative revocation",

        revokedAt:
          new Date(
            "2026-09-21T12:00:00.000Z"
          )
      }
    );

  const revokedView =
    buildOperationalCertificateView({
      certificateId,
      certificate:
        revoked
    });

  assert.strictEqual(
    revokedView.status,
    "revoked"
  );

  assert.strictEqual(
    revokedView.revokedAt,
    "2026-09-21T12:00:00.000Z"
  );

  assert.throws(
    () =>
      buildOperationalCertificateView({
        certificateId:
          "wrong-certificate-id",

        certificate
      }),
    error =>
      error instanceof
        AdminCertificateModelError &&
      error.code ===
        "ADMIN_CERTIFICATE_CANONICAL_STATE_INVALID"
  );

  console.log(
    "MARCO8_CERTIFICATE_OPERATIONAL_VIEW_FIELDS=10/10"
  );

  console.log(
    "MARCO8_CERTIFICATE_STATUSES=2/2"
  );

  console.log(
    "MARCO8_CERTIFICATE_CORRECT_FIELD=correctCount"
  );

  console.log(
    "MARCO8_CERTIFICATE_CORRECT_ANSWERS_ALIAS=False"
  );

  console.log(
    "MARCO8_CERTIFICATE_PRIVATE_IDENTIFIERS_EXPOSURE=False"
  );

  console.log(
    "MARCO8_CERTIFICATE_REVOCATION_REASON_EXPOSURE=False"
  );

  console.log(
    "MARCO8_CERTIFICATE_TIMESTAMP_SANITIZATION=PASSED"
  );

  console.log(
    "MARCO8_CERTIFICATE_DOCUMENT_IDENTITY=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_CERTIFICATE_MODELS=PASSED"
  );
}

main();