'use strict';

const crypto = require('crypto');
const {
  requireBelt
} = require('./exam-session-domain');

const EXAM_REGISTRATION_STATUSES = Object.freeze([
  'selected',
  'awaiting_payment',
  'authorized',
  'started',
  'submitted',
  'passed',
  'failed',
  'certified',
  'cancelled',
  'needs_reconciliation'
]);

const EXAM_REGISTRATION_STATUS_TRANSITIONS = Object.freeze({
  selected: Object.freeze(['selected', 'awaiting_payment', 'cancelled']),
  awaiting_payment: Object.freeze([
    'awaiting_payment',
    'selected',
    'authorized',
    'cancelled',
    'needs_reconciliation'
  ]),
  authorized: Object.freeze([
    'authorized',
    'started',
    'cancelled',
    'needs_reconciliation'
  ]),
  started: Object.freeze(['started', 'submitted', 'needs_reconciliation']),
  submitted: Object.freeze([
    'submitted',
    'passed',
    'failed',
    'needs_reconciliation'
  ]),
  passed: Object.freeze(['passed', 'certified', 'needs_reconciliation']),
  failed: Object.freeze(['failed', 'needs_reconciliation']),
  certified: Object.freeze(['certified', 'needs_reconciliation']),
  cancelled: Object.freeze(['cancelled', 'selected']),
  needs_reconciliation: Object.freeze(['needs_reconciliation'])
});

class ExamRegistrationDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamRegistrationDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function requiredIdentifier(value, field) {
  const id = text(value, 200);
  if (!id || id.includes('/')) {
    throw new ExamRegistrationDomainError(
      'INVALID_EXAM_REGISTRATION_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return id;
}

function optionalIdentifier(value, field) {
  const id = text(value, 200);
  if (id === null) return null;
  return requiredIdentifier(id, field);
}

function requiredTimestamp(value, field) {
  if (value === undefined || value === null) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_TIMESTAMP_REQUIRED',
      `${field} é obrigatório.`
    );
  }
  return value;
}

function examRegistrationDocumentId({ sessionId, studentId } = {}) {
  const session = requiredIdentifier(sessionId, 'sessionId');
  const student = requiredIdentifier(studentId, 'studentId');
  return crypto
    .createHash('sha256')
    .update(`exam-registration-v1:${session}:${student}`)
    .digest('hex');
}

function normalizeExamRegistration(input = {}) {
  return {
    sessionId: text(input.sessionId, 200),
    organizationId: text(input.organizationId, 200),
    studentId: text(input.studentId, 200),
    instructorId: text(input.instructorId, 200),
    currentBelt: input.currentBelt ?? null,
    targetBelt: input.targetBelt ?? null,
    membershipId: text(input.membershipId, 200),
    status: text(input.status, 40)?.toLowerCase() || null,
    orderId: text(input.orderId, 200),
    attemptId: text(input.attemptId, 200),
    resultId: text(input.resultId, 200),
    certificateId: text(input.certificateId, 200),
    selectedAt: input.selectedAt ?? null,
    paidAt: input.paidAt ?? null,
    authorizedAt: input.authorizedAt ?? null,
    cancelledAt: input.cancelledAt ?? null,
    updatedAt: input.updatedAt ?? null
  };
}

function validateExamRegistration(input = {}) {
  const registration = normalizeExamRegistration(input);

  registration.sessionId = requiredIdentifier(registration.sessionId, 'sessionId');
  registration.organizationId = requiredIdentifier(
    registration.organizationId,
    'organizationId'
  );
  registration.studentId = requiredIdentifier(registration.studentId, 'studentId');
  registration.instructorId = requiredIdentifier(
    registration.instructorId,
    'instructorId'
  );
  registration.membershipId = requiredIdentifier(
    registration.membershipId,
    'membershipId'
  );
  registration.currentBelt = requireBelt(registration.currentBelt, 'currentBelt');
  registration.targetBelt = requireBelt(registration.targetBelt, 'targetBelt');

  if (!EXAM_REGISTRATION_STATUSES.includes(registration.status)) {
    throw new ExamRegistrationDomainError(
      'INVALID_EXAM_REGISTRATION_STATUS',
      'Status da registration de exame inválido.'
    );
  }

  registration.orderId = optionalIdentifier(registration.orderId, 'orderId');
  registration.attemptId = optionalIdentifier(registration.attemptId, 'attemptId');
  registration.resultId = optionalIdentifier(registration.resultId, 'resultId');
  registration.certificateId = optionalIdentifier(
    registration.certificateId,
    'certificateId'
  );

  requiredTimestamp(registration.selectedAt, 'selectedAt');
  requiredTimestamp(registration.updatedAt, 'updatedAt');

  if (registration.status === 'selected' && registration.orderId !== null) {
    throw new ExamRegistrationDomainError(
      'SELECTED_REGISTRATION_ORDER_NOT_ALLOWED',
      'Registration selected não pode manter orderId ativo.'
    );
  }

  const paymentBoundStatuses = new Set([
    'awaiting_payment',
    'authorized',
    'started',
    'submitted',
    'passed',
    'failed',
    'certified',
    'needs_reconciliation'
  ]);
  if (paymentBoundStatuses.has(registration.status) && !registration.orderId) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_ORDER_REQUIRED',
      `Registration ${registration.status} exige orderId.`
    );
  }

  const paidStatuses = new Set([
    'authorized',
    'started',
    'submitted',
    'passed',
    'failed',
    'certified'
  ]);
  if (paidStatuses.has(registration.status)) {
    requiredTimestamp(registration.paidAt, 'paidAt');
    requiredTimestamp(registration.authorizedAt, 'authorizedAt');
  }

  const startedStatuses = new Set([
    'started',
    'submitted',
    'passed',
    'failed',
    'certified'
  ]);
  if (startedStatuses.has(registration.status) && !registration.attemptId) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_ATTEMPT_REQUIRED',
      `Registration ${registration.status} exige attemptId.`
    );
  }

  if (['passed', 'failed', 'certified'].includes(registration.status) && !registration.resultId) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_RESULT_REQUIRED',
      `Registration ${registration.status} exige resultId.`
    );
  }

  if (registration.status === 'certified' && !registration.certificateId) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_CERTIFICATE_REQUIRED',
      'Registration certified exige certificateId.'
    );
  }

  return registration;
}

function assertExamRegistrationStatusTransition(fromInput, toInput) {
  const from = text(fromInput, 40)?.toLowerCase() || null;
  const to = text(toInput, 40)?.toLowerCase() || null;

  if (!EXAM_REGISTRATION_STATUSES.includes(from) || !EXAM_REGISTRATION_STATUSES.includes(to)) {
    throw new ExamRegistrationDomainError(
      'INVALID_EXAM_REGISTRATION_STATUS',
      'Transição usa status de registration inválido.'
    );
  }

  if (!EXAM_REGISTRATION_STATUS_TRANSITIONS[from].includes(to)) {
    throw new ExamRegistrationDomainError(
      'INVALID_EXAM_REGISTRATION_TRANSITION',
      `Registration não pode transicionar de ${from} para ${to}.`
    );
  }

  return true;
}

function buildSelectedExamRegistration(input = {}) {
  const timestamp = requiredTimestamp(input.timestamp, 'timestamp');
  return validateExamRegistration({
    sessionId: input.sessionId,
    organizationId: input.organizationId,
    studentId: input.studentId,
    instructorId: input.instructorId,
    currentBelt: input.currentBelt,
    targetBelt: input.targetBelt,
    membershipId: input.membershipId,
    status: 'selected',
    orderId: null,
    attemptId: null,
    resultId: null,
    certificateId: null,
    selectedAt: timestamp,
    paidAt: null,
    authorizedAt: null,
    cancelledAt: null,
    updatedAt: timestamp
  });
}

function assertRegistrationCheckoutEligible(input = {}) {
  const registration = validateExamRegistration(input);
  if (!['selected', 'awaiting_payment'].includes(registration.status)) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_NOT_CHECKOUT_ELIGIBLE',
      'Registration não está elegível para checkout.'
    );
  }
  if (registration.attemptId || registration.resultId || registration.certificateId) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_ACADEMIC_STATE_EXISTS',
      'Registration com estado acadêmico não pode iniciar checkout.'
    );
  }
  return registration;
}

function markRegistrationAwaitingPayment(input = {}, options = {}) {
  const registration = assertRegistrationCheckoutEligible(input);
  const orderId = requiredIdentifier(options.orderId, 'orderId');
  const updatedAt = requiredTimestamp(options.updatedAt, 'updatedAt');

  if (registration.status === 'awaiting_payment') {
    if (registration.orderId !== orderId) {
      throw new ExamRegistrationDomainError(
        'EXAM_REGISTRATION_ORDER_MISMATCH',
        'Registration pending já está vinculada a outro orderId.'
      );
    }
    return validateExamRegistration({ ...registration, updatedAt });
  }

  assertExamRegistrationStatusTransition(registration.status, 'awaiting_payment');
  return validateExamRegistration({
    ...registration,
    status: 'awaiting_payment',
    orderId,
    paidAt: null,
    authorizedAt: null,
    cancelledAt: null,
    updatedAt
  });
}

function authorizePaidExamRegistration(input = {}, options = {}) {
  const registration = validateExamRegistration(input);
  const orderId = requiredIdentifier(options.orderId, 'orderId');
  const paidAt = requiredTimestamp(options.paidAt, 'paidAt');

  if (registration.status === 'authorized') {
    if (registration.orderId !== orderId) {
      throw new ExamRegistrationDomainError(
        'EXAM_REGISTRATION_ORDER_MISMATCH',
        'Registration authorized pertence a outro orderId.'
      );
    }
    return registration;
  }

  if (registration.status !== 'awaiting_payment') {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_PAYMENT_STATE_REQUIRED',
      'Confirmação financeira exige registration awaiting_payment.'
    );
  }
  if (registration.orderId !== orderId) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_ORDER_MISMATCH',
      'Pagamento confirmado não corresponde ao orderId da registration.'
    );
  }

  assertExamRegistrationStatusTransition(registration.status, 'authorized');
  return validateExamRegistration({
    ...registration,
    status: 'authorized',
    paidAt,
    authorizedAt: paidAt,
    cancelledAt: null,
    updatedAt: paidAt
  });
}

function markRegistrationStarted(input = {}, options = {}) {
  const registration = validateExamRegistration(input);
  const attemptId = requiredIdentifier(
    options.attemptId,
    'attemptId'
  );
  const startedAt = requiredTimestamp(
    options.startedAt,
    'startedAt'
  );

  if (registration.status === 'started') {
    if (registration.attemptId !== attemptId) {
      throw new ExamRegistrationDomainError(
        'EXAM_REGISTRATION_ATTEMPT_MISMATCH',
        'Registration started pertence a outra tentativa.'
      );
    }

    return registration;
  }

  if (registration.status !== 'authorized') {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_START_STATE_REQUIRED',
      'Início da prova exige registration authorized.'
    );
  }

  if (
    registration.attemptId ||
    registration.resultId ||
    registration.certificateId
  ) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_ACADEMIC_STATE_EXISTS',
      'Registration authorized já possui estado acadêmico.'
    );
  }

  assertExamRegistrationStatusTransition(
    registration.status,
    'started'
  );

  return validateExamRegistration({
    ...registration,
    status: 'started',
    attemptId,
    updatedAt: startedAt
  });
}

function resetRegistrationAfterPendingCancellation(input = {}, options = {}) {
  const registration = validateExamRegistration(input);
  const orderId = requiredIdentifier(options.orderId, 'orderId');
  const updatedAt = requiredTimestamp(options.updatedAt, 'updatedAt');

  if (registration.status !== 'awaiting_payment' || registration.orderId !== orderId) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_PENDING_ORDER_REQUIRED',
      'Cancelamento pending exige registration e order correspondentes.'
    );
  }

  assertExamRegistrationStatusTransition(registration.status, 'selected');
  return validateExamRegistration({
    ...registration,
    status: 'selected',
    orderId: null,
    paidAt: null,
    authorizedAt: null,
    cancelledAt: null,
    updatedAt
  });
}

function cancelAuthorizedRegistrationAfterRefund(input = {}, options = {}) {
  const registration = validateExamRegistration(input);
  const orderId = requiredIdentifier(options.orderId, 'orderId');
  const cancelledAt = requiredTimestamp(options.cancelledAt, 'cancelledAt');

  if (registration.status !== 'authorized' || registration.orderId !== orderId) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_AUTHORIZED_ORDER_REQUIRED',
      'Refund automático exige registration authorized do mesmo orderId.'
    );
  }
  if (registration.attemptId || registration.resultId || registration.certificateId) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_REFUND_RECONCILIATION_REQUIRED',
      'Registration com atividade acadêmica exige reconciliação manual.'
    );
  }

  assertExamRegistrationStatusTransition(registration.status, 'cancelled');
  return validateExamRegistration({
    ...registration,
    status: 'cancelled',
    cancelledAt,
    updatedAt: cancelledAt
  });
}

function markRegistrationNeedsReconciliation(input = {}, options = {}) {
  const registration = validateExamRegistration(input);
  const orderId = requiredIdentifier(options.orderId, 'orderId');
  const updatedAt = requiredTimestamp(options.updatedAt, 'updatedAt');

  if (registration.orderId !== orderId) {
    throw new ExamRegistrationDomainError(
      'EXAM_REGISTRATION_ORDER_MISMATCH',
      'Reconciliação financeira não corresponde ao orderId da registration.'
    );
  }

  assertExamRegistrationStatusTransition(
    registration.status,
    'needs_reconciliation'
  );

  return validateExamRegistration({
    ...registration,
    status: 'needs_reconciliation',
    updatedAt
  });
}

module.exports = {
  EXAM_REGISTRATION_STATUSES,
  EXAM_REGISTRATION_STATUS_TRANSITIONS,
  ExamRegistrationDomainError,
  examRegistrationDocumentId,
  normalizeExamRegistration,
  validateExamRegistration,
  assertExamRegistrationStatusTransition,
  buildSelectedExamRegistration,
  assertRegistrationCheckoutEligible,
  markRegistrationAwaitingPayment,
  authorizePaidExamRegistration,
  markRegistrationStarted,
  resetRegistrationAfterPendingCancellation,
  cancelAuthorizedRegistrationAfterRefund,
  markRegistrationNeedsReconciliation
};
