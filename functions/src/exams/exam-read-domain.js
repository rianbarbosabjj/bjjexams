'use strict';

const {
  ExamSessionDomainError,
  validateExamSession
} = require('./exam-session-domain');
const {
  ExamRegistrationDomainError,
  validateExamRegistration
} = require('./exam-registration-domain');

const STUDENT_EXAM_READ_STATES = Object.freeze([
  'selected',
  'payment_pending',
  'authorized',
  'cancelled',
  'needs_reconciliation',
  'started_or_later'
]);

class ExamReadDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamReadDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function normalizeStoredSession(input = {}) {
  try {
    return validateExamSession(input);
  } catch (error) {
    if (error instanceof ExamSessionDomainError) {
      throw new ExamReadDomainError(
        'EXAM_READ_CANONICAL_STATE_INVALID',
        'Sessão de exame canônica está inconsistente.'
      );
    }
    throw error;
  }
}

function normalizeStoredRegistration(input = {}) {
  try {
    return validateExamRegistration(input);
  } catch (error) {
    if (error instanceof ExamRegistrationDomainError) {
      throw new ExamReadDomainError(
        'EXAM_READ_CANONICAL_STATE_INVALID',
        'Registration de exame canônica está inconsistente.'
      );
    }
    throw error;
  }
}

function registrationReadState(statusInput) {
  const status = text(statusInput, 40)?.toLowerCase() || null;
  if (status === 'selected') return 'selected';
  if (status === 'awaiting_payment') return 'payment_pending';
  if (status === 'authorized') return 'authorized';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'needs_reconciliation') return 'needs_reconciliation';
  if (['started', 'submitted', 'passed', 'failed', 'certified'].includes(status)) {
    return 'started_or_later';
  }
  throw new ExamReadDomainError(
    'EXAM_READ_CANONICAL_STATE_INVALID',
    'Status da registration não pode ser exposto pela view de exame.'
  );
}

function sessionAcceptsCheckout(session) {
  return ['candidates_selected', 'awaiting_payment', 'ready'].includes(session.status);
}

function assertRegistrationMatchesSession(registration, sessionId, session) {
  if (
    registration.sessionId !== sessionId ||
    registration.organizationId !== session.organizationId ||
    registration.targetBelt !== session.targetBelt
  ) {
    throw new ExamReadDomainError(
      'EXAM_READ_CANONICAL_STATE_INVALID',
      'Registration não corresponde à sessão canônica.'
    );
  }
}

function buildStudentExamReadView({
  sessionId,
  session: sessionInput,
  registration: registrationInput,
  organizationName = null,
  membershipActive = false
} = {}) {
  const session = normalizeStoredSession(sessionInput);
  const registration = normalizeStoredRegistration(registrationInput);
  assertRegistrationMatchesSession(registration, sessionId, session);

  const state = registrationReadState(registration.status);
  const saleable = sessionAcceptsCheckout(session);
  const activeMembership = membershipActive === true;

  return Object.freeze({
    sessionId,
    organization: Object.freeze({
      organizationId: session.organizationId,
      name: text(organizationName, 160)
    }),
    currentBelt: registration.currentBelt,
    targetBelt: registration.targetBelt,
    scheduledAt: session.scheduledAt || null,
    price: Object.freeze({
      amountCents: session.priceCents,
      currency: session.currency
    }),
    state,
    canStartCheckout:
      activeMembership &&
      saleable &&
      registration.status === 'selected',
    canResumePayment:
      activeMembership &&
      saleable &&
      registration.status === 'awaiting_payment',
    canStartExam: false,
    selectedAt: registration.selectedAt,
    updatedAt: registration.updatedAt
  });
}

function buildInstructorSessionSummary({
  sessionId,
  session: sessionInput,
  organizationName = null
} = {}) {
  const session = normalizeStoredSession(sessionInput);
  return Object.freeze({
    sessionId,
    organization: Object.freeze({
      organizationId: session.organizationId,
      name: text(organizationName, 160)
    }),
    responsibleInstructorId: session.responsibleInstructorId,
    targetBelt: session.targetBelt,
    status: session.status,
    scheduledAt: session.scheduledAt || null,
    price: Object.freeze({
      amountCents: session.priceCents,
      currency: session.currency
    }),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  });
}

function buildInstructorRegistrationView({
  registrationId,
  registration: registrationInput,
  sessionId,
  session: sessionInput,
  studentName = null
} = {}) {
  const session = normalizeStoredSession(sessionInput);
  const registration = normalizeStoredRegistration(registrationInput);
  assertRegistrationMatchesSession(registration, sessionId, session);

  const state = registrationReadState(registration.status);
  const startedOrLater = state === 'started_or_later';

  return Object.freeze({
    registrationId,
    student: Object.freeze({
      studentId: registration.studentId,
      name: text(studentName, 160)
    }),
    currentBelt: registration.currentBelt,
    targetBelt: registration.targetBelt,
    status: registration.status,
    state,
    selected: registration.status === 'selected',
    awaitingPayment: registration.status === 'awaiting_payment',
    authorized: registration.status === 'authorized',
    needsReconciliation: registration.status === 'needs_reconciliation',
    startedOrLater,
    selectedAt: registration.selectedAt,
    updatedAt: registration.updatedAt
  });
}

module.exports = {
  STUDENT_EXAM_READ_STATES,
  ExamReadDomainError,
  registrationReadState,
  sessionAcceptsCheckout,
  buildStudentExamReadView,
  buildInstructorSessionSummary,
  buildInstructorRegistrationView
};
