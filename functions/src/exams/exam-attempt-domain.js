'use strict';

const crypto = require('crypto');

const EXAM_ATTEMPT_STATUSES = Object.freeze([
  'in_progress',
  'submitted',
  'invalidated'
]);

const EXAM_ATTEMPT_STATUS_TRANSITIONS = Object.freeze({
  in_progress: Object.freeze([
    'in_progress',
    'submitted',
    'invalidated'
  ]),
  submitted: Object.freeze([
    'submitted',
    'invalidated'
  ]),
  invalidated: Object.freeze([
    'invalidated'
  ])
});

class ExamAttemptDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamAttemptDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, max);
}

function requiredIdentifier(value, field) {
  const id = text(value, 200);

  if (!id || id.includes('/')) {
    throw new ExamAttemptDomainError(
      'INVALID_EXAM_ATTEMPT_IDENTIFIER',
      `${field} inválido.`
    );
  }

  return id;
}

function optionalIdentifier(value, field) {
  const id = text(value, 200);

  if (id === null) {
    return null;
  }

  return requiredIdentifier(id, field);
}

function timestampMillis(value, field) {
  let millis = Number.NaN;

  if (value instanceof Date) {
    millis = value.getTime();
  } else if (
    value &&
    typeof value.toMillis === 'function'
  ) {
    millis = Number(value.toMillis());
  } else if (
    value &&
    typeof value.toDate === 'function'
  ) {
    const date = value.toDate();

    if (date instanceof Date) {
      millis = date.getTime();
    }
  }

  if (!Number.isFinite(millis)) {
    throw new ExamAttemptDomainError(
      'INVALID_EXAM_ATTEMPT_TIMESTAMP',
      `${field} inválido.`
    );
  }

  return millis;
}

function requiredTimestamp(value, field) {
  if (value === undefined || value === null) {
    throw new ExamAttemptDomainError(
      'EXAM_ATTEMPT_TIMESTAMP_REQUIRED',
      `${field} é obrigatório.`
    );
  }

  timestampMillis(value, field);

  return value;
}

function validateOrderedQuestionIds(value) {
  if (!Array.isArray(value)) {
    throw new ExamAttemptDomainError(
      'INVALID_EXAM_ATTEMPT_QUESTION_IDS',
      'orderedQuestionIds precisa ser uma lista.'
    );
  }

  if (value.length === 0) {
    throw new ExamAttemptDomainError(
      'EXAM_ATTEMPT_QUESTIONS_REQUIRED',
      'Tentativa precisa possuir questões.'
    );
  }

  if (value.length > 500) {
    throw new ExamAttemptDomainError(
      'EXAM_ATTEMPT_TOO_MANY_QUESTIONS',
      'Tentativa excede o limite de questões.'
    );
  }

  const ids = [];
  const seen = new Set();

  for (const valueItem of value) {
    const questionId =
      requiredIdentifier(
        valueItem,
        'orderedQuestionIds'
      );

    if (seen.has(questionId)) {
      throw new ExamAttemptDomainError(
        'DUPLICATE_EXAM_ATTEMPT_QUESTION',
        'orderedQuestionIds não pode possuir duplicatas.'
      );
    }

    seen.add(questionId);
    ids.push(questionId);
  }

  return ids;
}

function examAttemptDocumentId(
  registrationIdInput
) {
  const registrationId =
    requiredIdentifier(
      registrationIdInput,
      'registrationId'
    );

  return crypto
    .createHash('sha256')
    .update(
      `exam-attempt-v1:${registrationId}`
    )
    .digest('hex');
}

function normalizeExamAttempt(input = {}) {
  return {
    registrationId:
      text(input.registrationId, 200),
    sessionId:
      text(input.sessionId, 200),
    organizationId:
      text(input.organizationId, 200),
    studentId:
      text(input.studentId, 200),
    templateId:
      text(input.templateId, 200),
    templateVersionId:
      text(input.templateVersionId, 200),
    orderedQuestionIds:
      Array.isArray(input.orderedQuestionIds)
        ? [...input.orderedQuestionIds]
        : input.orderedQuestionIds,
    status:
      text(input.status, 40)?.toLowerCase() ||
      null,
    startedAt:
      input.startedAt ?? null,
    expiresAt:
      input.expiresAt ?? null,
    submittedAt:
      input.submittedAt ?? null,
    resultId:
      text(input.resultId, 200),
    createdAt:
      input.createdAt ?? null,
    updatedAt:
      input.updatedAt ?? null
  };
}

function validateExamAttempt(input = {}) {
  const attempt =
    normalizeExamAttempt(input);

  attempt.registrationId =
    requiredIdentifier(
      attempt.registrationId,
      'registrationId'
    );

  attempt.sessionId =
    requiredIdentifier(
      attempt.sessionId,
      'sessionId'
    );

  attempt.organizationId =
    requiredIdentifier(
      attempt.organizationId,
      'organizationId'
    );

  attempt.studentId =
    requiredIdentifier(
      attempt.studentId,
      'studentId'
    );

  attempt.templateId =
    requiredIdentifier(
      attempt.templateId,
      'templateId'
    );

  attempt.templateVersionId =
    requiredIdentifier(
      attempt.templateVersionId,
      'templateVersionId'
    );

  attempt.orderedQuestionIds =
    validateOrderedQuestionIds(
      attempt.orderedQuestionIds
    );

  if (
    !EXAM_ATTEMPT_STATUSES.includes(
      attempt.status
    )
  ) {
    throw new ExamAttemptDomainError(
      'INVALID_EXAM_ATTEMPT_STATUS',
      'Status da tentativa inválido.'
    );
  }

  attempt.startedAt =
    requiredTimestamp(
      attempt.startedAt,
      'startedAt'
    );

  attempt.expiresAt =
    requiredTimestamp(
      attempt.expiresAt,
      'expiresAt'
    );

  attempt.createdAt =
    requiredTimestamp(
      attempt.createdAt,
      'createdAt'
    );

  attempt.updatedAt =
    requiredTimestamp(
      attempt.updatedAt,
      'updatedAt'
    );

  attempt.resultId =
    optionalIdentifier(
      attempt.resultId,
      'resultId'
    );

  const startedAtMillis =
    timestampMillis(
      attempt.startedAt,
      'startedAt'
    );

  const expiresAtMillis =
    timestampMillis(
      attempt.expiresAt,
      'expiresAt'
    );

  const createdAtMillis =
    timestampMillis(
      attempt.createdAt,
      'createdAt'
    );

  const updatedAtMillis =
    timestampMillis(
      attempt.updatedAt,
      'updatedAt'
    );

  if (expiresAtMillis <= startedAtMillis) {
    throw new ExamAttemptDomainError(
      'INVALID_EXAM_ATTEMPT_EXPIRATION',
      'expiresAt precisa ser posterior a startedAt.'
    );
  }

  if (createdAtMillis > startedAtMillis) {
    throw new ExamAttemptDomainError(
      'INVALID_EXAM_ATTEMPT_CREATED_AT',
      'createdAt não pode ser posterior a startedAt.'
    );
  }

  if (updatedAtMillis < createdAtMillis) {
    throw new ExamAttemptDomainError(
      'INVALID_EXAM_ATTEMPT_UPDATED_AT',
      'updatedAt não pode ser anterior a createdAt.'
    );
  }

  if (attempt.status === 'in_progress') {
    if (attempt.submittedAt !== null) {
      throw new ExamAttemptDomainError(
        'IN_PROGRESS_EXAM_ATTEMPT_SUBMITTED_AT_NOT_ALLOWED',
        'Tentativa em andamento não pode possuir submittedAt.'
      );
    }

    if (attempt.resultId !== null) {
      throw new ExamAttemptDomainError(
        'IN_PROGRESS_EXAM_ATTEMPT_RESULT_NOT_ALLOWED',
        'Tentativa em andamento não pode possuir resultId.'
      );
    }
  }

  if (attempt.status === 'submitted') {
    attempt.submittedAt =
      requiredTimestamp(
        attempt.submittedAt,
        'submittedAt'
      );

    if (!attempt.resultId) {
      throw new ExamAttemptDomainError(
        'SUBMITTED_EXAM_ATTEMPT_RESULT_REQUIRED',
        'Tentativa submetida exige resultId.'
      );
    }

    const submittedAtMillis =
      timestampMillis(
        attempt.submittedAt,
        'submittedAt'
      );

    if (submittedAtMillis < startedAtMillis) {
      throw new ExamAttemptDomainError(
        'INVALID_EXAM_ATTEMPT_SUBMITTED_AT',
        'submittedAt não pode ser anterior a startedAt.'
      );
    }

    if (updatedAtMillis < submittedAtMillis) {
      throw new ExamAttemptDomainError(
        'INVALID_EXAM_ATTEMPT_UPDATED_AT',
        'updatedAt não pode ser anterior a submittedAt.'
      );
    }
  } else if (
    attempt.submittedAt !== null
  ) {
    requiredTimestamp(
      attempt.submittedAt,
      'submittedAt'
    );
  }

  return attempt;
}

function assertExamAttemptDocumentIdentity(
  attemptIdInput,
  attemptInput
) {
  const attemptId =
    requiredIdentifier(
      attemptIdInput,
      'attemptId'
    );

  const attempt =
    validateExamAttempt(attemptInput);

  const expectedId =
    examAttemptDocumentId(
      attempt.registrationId
    );

  if (attemptId !== expectedId) {
    throw new ExamAttemptDomainError(
      'EXAM_ATTEMPT_ID_MISMATCH',
      'attemptId não corresponde à registration.'
    );
  }

  return attempt;
}

function assertExamAttemptStatusTransition(
  fromInput,
  toInput
) {
  const from =
    text(fromInput, 40)?.toLowerCase() ||
    null;

  const to =
    text(toInput, 40)?.toLowerCase() ||
    null;

  if (
    !EXAM_ATTEMPT_STATUSES.includes(from) ||
    !EXAM_ATTEMPT_STATUSES.includes(to)
  ) {
    throw new ExamAttemptDomainError(
      'INVALID_EXAM_ATTEMPT_STATUS',
      'Transição usa status de tentativa inválido.'
    );
  }

  if (
    !EXAM_ATTEMPT_STATUS_TRANSITIONS[
      from
    ].includes(to)
  ) {
    throw new ExamAttemptDomainError(
      'INVALID_EXAM_ATTEMPT_TRANSITION',
      `Tentativa não pode transicionar de ${from} para ${to}.`
    );
  }

  return true;
}

function buildInProgressExamAttempt(
  input = {}
) {
  const startedAt =
    requiredTimestamp(
      input.startedAt,
      'startedAt'
    );

  const expiresAt =
    requiredTimestamp(
      input.expiresAt,
      'expiresAt'
    );

  return validateExamAttempt({
    registrationId: input.registrationId,
    sessionId: input.sessionId,
    organizationId:
      input.organizationId,
    studentId: input.studentId,
    templateId: input.templateId,
    templateVersionId:
      input.templateVersionId,
    orderedQuestionIds:
      input.orderedQuestionIds,
    status: 'in_progress',
    startedAt,
    expiresAt,
    submittedAt: null,
    resultId: null,
    createdAt: startedAt,
    updatedAt: startedAt
  });
}

function markExamAttemptSubmitted(
  input = {},
  options = {}
) {
  const attempt =
    validateExamAttempt(input);

  const resultId =
    requiredIdentifier(
      options.resultId,
      'resultId'
    );

  const submittedAt =
    requiredTimestamp(
      options.submittedAt,
      'submittedAt'
    );

  if (attempt.status === 'submitted') {
    if (attempt.resultId !== resultId) {
      throw new ExamAttemptDomainError(
        'EXAM_ATTEMPT_RESULT_MISMATCH',
        'Tentativa submetida pertence a outro resultado.'
      );
    }

    return attempt;
  }

  if (attempt.status !== 'in_progress') {
    throw new ExamAttemptDomainError(
      'EXAM_ATTEMPT_SUBMIT_STATE_REQUIRED',
      'Finalização exige tentativa em andamento.'
    );
  }

  if (
    timestampMillis(
      submittedAt,
      'submittedAt'
    ) >=
    timestampMillis(
      attempt.expiresAt,
      'expiresAt'
    )
  ) {
    throw new ExamAttemptDomainError(
      'EXAM_ATTEMPT_SUBMISSION_EXPIRED',
      'Tentativa expirada não pode ser submetida.'
    );
  }

  assertExamAttemptStatusTransition(
    attempt.status,
    'submitted'
  );

  return validateExamAttempt({
    ...attempt,
    status: 'submitted',
    submittedAt,
    resultId,
    updatedAt: submittedAt
  });
}

function assertExamAttemptResumeEligible(
  input = {},
  options = {}
) {
  const attempt =
    validateExamAttempt(input);

  if (attempt.status !== 'in_progress') {
    throw new ExamAttemptDomainError(
      'EXAM_ATTEMPT_NOT_RESUMABLE',
      'Somente tentativa em andamento pode ser retomada.'
    );
  }

  const now =
    requiredTimestamp(
      options.now,
      'now'
    );

  if (
    timestampMillis(now, 'now') >=
    timestampMillis(
      attempt.expiresAt,
      'expiresAt'
    )
  ) {
    throw new ExamAttemptDomainError(
      'EXAM_ATTEMPT_EXPIRED',
      'Tentativa expirada não pode ser retomada.'
    );
  }

  return attempt;
}

function publicTimestampAsDate(
  value,
  field,
  options = {}
) {
  const allowNull =
    options.allowNull === true;

  if (
    allowNull &&
    (
      value === undefined ||
      value === null
    )
  ) {
    return null;
  }

  const millis =
    timestampMillis(
      value,
      field
    );

  return new Date(millis);
}

function publicExamAttempt(
  attemptIdInput,
  attemptInput
) {
  const attempt =
    assertExamAttemptDocumentIdentity(
      attemptIdInput,
      attemptInput
    );

  return {
    attemptId:
      requiredIdentifier(
        attemptIdInput,
        'attemptId'
      ),
    registrationId:
      attempt.registrationId,
    sessionId:
      attempt.sessionId,
    status:
      attempt.status,
    startedAt:
      publicTimestampAsDate(
        attempt.startedAt,
        'startedAt'
      ),
    expiresAt:
      publicTimestampAsDate(
        attempt.expiresAt,
        'expiresAt'
      ),
    submittedAt:
      publicTimestampAsDate(
        attempt.submittedAt,
        'submittedAt',
        { allowNull: true }
      )
  };
}

module.exports = {
  EXAM_ATTEMPT_STATUSES,
  EXAM_ATTEMPT_STATUS_TRANSITIONS,
  ExamAttemptDomainError,
  examAttemptDocumentId,
  normalizeExamAttempt,
  validateExamAttempt,
  assertExamAttemptDocumentIdentity,
  assertExamAttemptStatusTransition,
  buildInProgressExamAttempt,
  markExamAttemptSubmitted,
  assertExamAttemptResumeEligible,
  publicExamAttempt
};