'use strict';

const crypto = require('crypto');

const EXAM_CERTIFICATE_VERSION = 1;

const EXAM_CERTIFICATE_STATUSES =
  Object.freeze([
    'valid',
    'revoked'
  ]);

class ExamCertificateDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name =
      'ExamCertificateDomainError';
    this.code = code;
  }
}

function text(
  value,
  max = 200
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized
    ? normalized.slice(0, max)
    : null;
}

function requiredText(
  value,
  field,
  max = 200
) {
  const normalized =
    text(value, max);

  if (!normalized) {
    throw new ExamCertificateDomainError(
      'EXAM_CERTIFICATE_TEXT_REQUIRED',
      `${field} é obrigatório.`
    );
  }

  return normalized;
}

function requiredIdentifier(
  value,
  field
) {
  const id =
    text(value, 200);

  if (
    !id ||
    id.includes('/')
  ) {
    throw new ExamCertificateDomainError(
      'INVALID_EXAM_CERTIFICATE_IDENTIFIER',
      `${field} inválido.`
    );
  }

  return id;
}

function optionalIdentifier(
  value,
  field
) {
  const id =
    text(value, 200);

  if (id === null) {
    return null;
  }

  return requiredIdentifier(
    id,
    field
  );
}

function timestampMillis(
  value,
  field
) {
  let millis =
    Number.NaN;

  if (value instanceof Date) {
    millis =
      value.getTime();
  } else if (
    value &&
    typeof value.toMillis ===
      'function'
  ) {
    millis =
      Number(
        value.toMillis()
      );
  } else if (
    value &&
    typeof value.toDate ===
      'function'
  ) {
    const date =
      value.toDate();

    if (date instanceof Date) {
      millis =
        date.getTime();
    }
  }

  if (!Number.isFinite(millis)) {
    throw new ExamCertificateDomainError(
      'INVALID_EXAM_CERTIFICATE_TIMESTAMP',
      `${field} inválido.`
    );
  }

  return millis;
}

function requiredTimestamp(
  value,
  field
) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new ExamCertificateDomainError(
      'EXAM_CERTIFICATE_TIMESTAMP_REQUIRED',
      `${field} é obrigatório.`
    );
  }

  timestampMillis(
    value,
    field
  );

  return value;
}

function integerInRange(
  value,
  field,
  min,
  max
) {
  const number =
    Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  ) {
    throw new ExamCertificateDomainError(
      'INVALID_EXAM_CERTIFICATE_NUMBER',
      `${field} inválido.`
    );
  }

  return number;
}

function examCertificateDocumentId(
  resultIdInput
) {
  const resultId =
    requiredIdentifier(
      resultIdInput,
      'resultId'
    );

  return crypto
    .createHash('sha256')
    .update(
      `exam-certificate-v1:${resultId}`
    )
    .digest('hex');
}

function normalizeExamCertificate(
  input = {}
) {
  return {
    certificateVersion:
      Number(
        input.certificateVersion
      ),
    registrationId:
      text(
        input.registrationId,
        200
      ),
    resultId:
      text(
        input.resultId,
        200
      ),
    attemptId:
      text(
        input.attemptId,
        200
      ),
    sessionId:
      text(
        input.sessionId,
        200
      ),
    organizationId:
      text(
        input.organizationId,
        200
      ),
    studentId:
      text(
        input.studentId,
        200
      ),
    instructorId:
      text(
        input.instructorId,
        200
      ),
    templateId:
      text(
        input.templateId,
        200
      ),
    templateVersionId:
      text(
        input.templateVersionId,
        200
      ),
    targetBelt:
      text(
        input.targetBelt,
        40
      ),
    scoreBps:
      Number(
        input.scoreBps
      ),
    correctCount:
      Number(
        input.correctCount
      ),
    totalQuestions:
      Number(
        input.totalQuestions
      ),
    resultFinalizedAt:
      input.resultFinalizedAt ??
      null,
    studentName:
      text(
        input.studentName,
        200
      ),
    organizationName:
      text(
        input.organizationName,
        200
      ),
    instructorName:
      text(
        input.instructorName,
        200
      ),
    status:
      text(
        input.status,
        40
      )?.toLowerCase() ||
      null,
    issuedAt:
      input.issuedAt ??
      null,
    issuedBy:
      text(
        input.issuedBy,
        200
      ),
    revokedAt:
      input.revokedAt ??
      null,
    revokedBy:
      text(
        input.revokedBy,
        200
      ),
    revocationReason:
      text(
        input.revocationReason,
        500
      )
  };
}

function validateExamCertificate(
  input = {}
) {
  const certificate =
    normalizeExamCertificate(
      input
    );

  if (
    certificate.certificateVersion !==
      EXAM_CERTIFICATE_VERSION
  ) {
    throw new ExamCertificateDomainError(
      'INVALID_EXAM_CERTIFICATE_VERSION',
      'certificateVersion inválido.'
    );
  }

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
      'templateVersionId'
    ]
  ) {
    certificate[field] =
      requiredIdentifier(
        certificate[field],
        field
      );
  }

  certificate.targetBelt =
    requiredText(
      certificate.targetBelt,
      'targetBelt',
      40
    );

  certificate.studentName =
    requiredText(
      certificate.studentName,
      'studentName'
    );

  certificate.organizationName =
    requiredText(
      certificate.organizationName,
      'organizationName'
    );

  certificate.instructorName =
    requiredText(
      certificate.instructorName,
      'instructorName'
    );

  certificate.scoreBps =
    integerInRange(
      certificate.scoreBps,
      'scoreBps',
      0,
      10000
    );

  certificate.totalQuestions =
    integerInRange(
      certificate.totalQuestions,
      'totalQuestions',
      1,
      500
    );

  certificate.correctCount =
    integerInRange(
      certificate.correctCount,
      'correctCount',
      0,
      certificate.totalQuestions
    );

  certificate.resultFinalizedAt =
    requiredTimestamp(
      certificate.resultFinalizedAt,
      'resultFinalizedAt'
    );

  if (
    !EXAM_CERTIFICATE_STATUSES.includes(
      certificate.status
    )
  ) {
    throw new ExamCertificateDomainError(
      'INVALID_EXAM_CERTIFICATE_STATUS',
      'status de certificado inválido.'
    );
  }

  certificate.issuedAt =
    requiredTimestamp(
      certificate.issuedAt,
      'issuedAt'
    );

  certificate.issuedBy =
    requiredIdentifier(
      certificate.issuedBy,
      'issuedBy'
    );

  const resultMillis =
    timestampMillis(
      certificate.resultFinalizedAt,
      'resultFinalizedAt'
    );

  const issuedMillis =
    timestampMillis(
      certificate.issuedAt,
      'issuedAt'
    );

  if (issuedMillis < resultMillis) {
    throw new ExamCertificateDomainError(
      'EXAM_CERTIFICATE_ISSUED_BEFORE_RESULT',
      'Certificado não pode ser emitido antes do resultado.'
    );
  }

  certificate.revokedBy =
    optionalIdentifier(
      certificate.revokedBy,
      'revokedBy'
    );

  if (
    certificate.status ===
      'valid'
  ) {
    if (
      certificate.revokedAt !==
        null ||
      certificate.revokedBy !==
        null ||
      certificate.revocationReason !==
        null
    ) {
      throw new ExamCertificateDomainError(
        'EXAM_CERTIFICATE_VALID_REVOCATION_FIELDS_NOT_ALLOWED',
        'Certificado válido não pode possuir metadados de revogação.'
      );
    }
  }

  if (
    certificate.status ===
      'revoked'
  ) {
    certificate.revokedAt =
      requiredTimestamp(
        certificate.revokedAt,
        'revokedAt'
      );

    certificate.revokedBy =
      requiredIdentifier(
        certificate.revokedBy,
        'revokedBy'
      );

    certificate.revocationReason =
      requiredText(
        certificate.revocationReason,
        'revocationReason',
        500
      );

    const revokedMillis =
      timestampMillis(
        certificate.revokedAt,
        'revokedAt'
      );

    if (
      revokedMillis <
        issuedMillis
    ) {
      throw new ExamCertificateDomainError(
        'EXAM_CERTIFICATE_REVOKED_BEFORE_ISSUED',
        'Certificado não pode ser revogado antes da emissão.'
      );
    }
  }

  return certificate;
}

function buildExamCertificate(
  input = {}
) {
  return validateExamCertificate({
    certificateVersion:
      EXAM_CERTIFICATE_VERSION,
    registrationId:
      input.registrationId,
    resultId:
      input.resultId,
    attemptId:
      input.attemptId,
    sessionId:
      input.sessionId,
    organizationId:
      input.organizationId,
    studentId:
      input.studentId,
    instructorId:
      input.instructorId,
    templateId:
      input.templateId,
    templateVersionId:
      input.templateVersionId,
    targetBelt:
      input.targetBelt,
    scoreBps:
      input.scoreBps,
    correctCount:
      input.correctCount,
    totalQuestions:
      input.totalQuestions,
    resultFinalizedAt:
      input.resultFinalizedAt,
    studentName:
      input.studentName,
    organizationName:
      input.organizationName,
    instructorName:
      input.instructorName,
    status:
      'valid',
    issuedAt:
      input.issuedAt,
    issuedBy:
      input.issuedBy,
    revokedAt:
      null,
    revokedBy:
      null,
    revocationReason:
      null
  });
}

function revokeExamCertificate(
  input = {},
  options = {}
) {
  const certificate =
    validateExamCertificate(
      input
    );

  const revokedBy =
    requiredIdentifier(
      options.revokedBy,
      'revokedBy'
    );

  const revocationReason =
    requiredText(
      options.revocationReason,
      'revocationReason',
      500
    );

  if (
    certificate.status ===
      'revoked'
  ) {
    if (
      certificate.revokedBy ===
        revokedBy &&
      certificate.revocationReason ===
        revocationReason
    ) {
      return certificate;
    }

    throw new ExamCertificateDomainError(
      'EXAM_CERTIFICATE_REVOCATION_CONFLICT',
      'Certificado já foi revogado com metadados diferentes.'
    );
  }

  const revokedAt =
    requiredTimestamp(
      options.revokedAt,
      'revokedAt'
    );

  return validateExamCertificate({
    ...certificate,
    status:
      'revoked',
    revokedAt,
    revokedBy,
    revocationReason
  });
}
function assertExamCertificateDocumentIdentity(
  certificateIdInput,
  certificateInput
) {
  const certificateId =
    requiredIdentifier(
      certificateIdInput,
      'certificateId'
    );

  const certificate =
    validateExamCertificate(
      certificateInput
    );

  const expected =
    examCertificateDocumentId(
      certificate.resultId
    );

  if (
    certificateId !==
      expected
  ) {
    throw new ExamCertificateDomainError(
      'EXAM_CERTIFICATE_ID_MISMATCH',
      'certificateId não corresponde ao resultId.'
    );
  }

  return certificate;
}

function publicTimestampAsDate(
  value,
  field,
  allowNull = false
) {
  if (
    allowNull &&
    (
      value === undefined ||
      value === null
    )
  ) {
    return null;
  }

  return new Date(
    timestampMillis(
      value,
      field
    )
  );
}

function publicExamCertificate(
  certificateIdInput,
  certificateInput
) {
  const certificate =
    assertExamCertificateDocumentIdentity(
      certificateIdInput,
      certificateInput
    );

  return {
    certificateId:
      requiredIdentifier(
        certificateIdInput,
        'certificateId'
      ),
    status:
      certificate.status,
    studentName:
      certificate.studentName,
    targetBelt:
      certificate.targetBelt,
    organizationName:
      certificate.organizationName,
    instructorName:
      certificate.instructorName,
    scoreBps:
      certificate.scoreBps,
    correctCount:
      certificate.correctCount,
    totalQuestions:
      certificate.totalQuestions,
    issuedAt:
      publicTimestampAsDate(
        certificate.issuedAt,
        'issuedAt'
      ),
    revokedAt:
      publicTimestampAsDate(
        certificate.revokedAt,
        'revokedAt',
        true
      )
  };
}

module.exports = {
  EXAM_CERTIFICATE_VERSION,
  EXAM_CERTIFICATE_STATUSES,
  ExamCertificateDomainError,
  examCertificateDocumentId,
  normalizeExamCertificate,
  validateExamCertificate,
  buildExamCertificate,
  revokeExamCertificate,
  assertExamCertificateDocumentIdentity,
  publicExamCertificate
};