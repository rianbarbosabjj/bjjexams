"use strict";

const {
  toIsoTimestamp
} = require(
  "./admin-directory-models"
);

const {
  EXAM_CERTIFICATE_STATUSES,
  ExamCertificateDomainError,
  assertExamCertificateDocumentIdentity
} = require(
  "../exams/exam-certificate-domain"
);

const OPERATIONAL_CERTIFICATE_VIEW_FIELDS =
  Object.freeze([
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
  ]);

class AdminCertificateModelError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminCertificateModelError";

    this.code =
      code;
  }
}

function requiredCertificateId(
  value
) {
  const id =
    typeof value ===
      "string"
      ? value.trim()
      : "";

  if (
    !id ||
    id.length > 128 ||
    id.includes("/")
  ) {
    throw new AdminCertificateModelError(
      "ADMIN_CERTIFICATE_ID_INVALID",
      "certificateId is invalid."
    );
  }

  return id;
}

function canonicalCertificate(
  certificateIdInput,
  certificateInput
) {
  const certificateId =
    requiredCertificateId(
      certificateIdInput
    );

  try {
    return Object.freeze({
      certificateId,

      certificate:
        assertExamCertificateDocumentIdentity(
          certificateId,
          certificateInput
        )
    });
  }
  catch (error) {
    if (
      error instanceof
        ExamCertificateDomainError
    ) {
      throw new AdminCertificateModelError(
        "ADMIN_CERTIFICATE_CANONICAL_STATE_INVALID",
        "Certificate canonical state is invalid."
      );
    }

    throw error;
  }
}

function buildOperationalCertificateView(
  input = {}
) {
  const canonical =
    canonicalCertificate(
      input.certificateId,
      input.certificate
    );

  const certificate =
    canonical.certificate;

  return Object.freeze({
    certificateId:
      canonical.certificateId,

    status:
      certificate.status,

    studentName:
      certificate.studentName,

    organizationName:
      certificate.organizationName,

    targetBelt:
      certificate.targetBelt,

    scoreBps:
      certificate.scoreBps,

    correctCount:
      certificate.correctCount,

    totalQuestions:
      certificate.totalQuestions,

    issuedAt:
      toIsoTimestamp(
        certificate.issuedAt
      ),

    revokedAt:
      toIsoTimestamp(
        certificate.revokedAt
      )
  });
}

module.exports = {
  OPERATIONAL_CERTIFICATE_VIEW_FIELDS,
  EXAM_CERTIFICATE_STATUSES,

  AdminCertificateModelError,

  requiredCertificateId,
  canonicalCertificate,
  buildOperationalCertificateView
};