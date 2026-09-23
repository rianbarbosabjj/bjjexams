'use strict';

const {
  ExamSessionDomainError,
  validateExamSession
} = require('./exam-session-domain');
const {
  ExamRegistrationDomainError,
  validateExamRegistration
} = require('./exam-registration-domain');
const {
  ExamResultDomainError,
  validateExamResult,
  publicExamResult
} = require('./exam-result-domain');
const {
  ExamCertificateDomainError,
  assertExamCertificateDocumentIdentity,
  publicExamCertificate
} = require('./exam-certificate-domain');

const STUDENT_EXAM_READ_STATES = Object.freeze([
  'selected',
  'payment_pending',
  'authorized',
  'cancelled',
  'needs_reconciliation',
  'started_or_later'
]);

const STUDENT_EXAM_ACADEMIC_STATES = Object.freeze([
  'not_started',
  'in_progress',
  'submitted',
  'passed',
  'failed',
  'certified',
  'cancelled',
  'needs_reconciliation'
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

function normalizeStoredResult(input = {}) {
  try {
    return validateExamResult(input);
  } catch (error) {
    if (
      error instanceof
        ExamResultDomainError
    ) {
      throw new ExamReadDomainError(
        'EXAM_READ_CANONICAL_STATE_INVALID',
        'Resultado de exame canônico está inconsistente.'
      );
    }

    throw error;
  }
}

function normalizeStoredCertificate(
  certificateId,
  input = {}
) {
  try {
    return assertExamCertificateDocumentIdentity(
      certificateId,
      input
    );
  } catch (error) {
    if (
      error instanceof
        ExamCertificateDomainError
    ) {
      throw new ExamReadDomainError(
        'EXAM_READ_CANONICAL_STATE_INVALID',
        'Certificado canônico está inconsistente.'
      );
    }

    throw error;
  }
}

function timestampMillis(
  value
) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (
    value &&
    typeof value.toMillis ===
      'function'
  ) {
    return Number(
      value.toMillis()
    );
  }

  if (
    value &&
    typeof value.toDate ===
      'function'
  ) {
    const date =
      value.toDate();

    if (date instanceof Date) {
      return date.getTime();
    }
  }

  return Number.NaN;
}

function sameTimestamp(
  left,
  right
) {
  const a =
    timestampMillis(left);

  const b =
    timestampMillis(right);

  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    a === b
  );
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

function studentExamAcademicState(
  statusInput
) {
  const status =
    text(
      statusInput,
      40
    )?.toLowerCase() ||
    null;

  if (
    [
      'selected',
      'awaiting_payment',
      'authorized'
    ].includes(status)
  ) {
    return 'not_started';
  }

  if (status === 'started') {
    return 'in_progress';
  }

  if (status === 'submitted') {
    return 'submitted';
  }

  if (status === 'passed') {
    return 'passed';
  }

  if (status === 'failed') {
    return 'failed';
  }

  if (status === 'certified') {
    return 'certified';
  }

  if (status === 'cancelled') {
    return 'cancelled';
  }

  if (
    status ===
      'needs_reconciliation'
  ) {
    return 'needs_reconciliation';
  }

  throw new ExamReadDomainError(
    'EXAM_READ_CANONICAL_STATE_INVALID',
    'Status acadêmico da registration não pode ser exposto.'
  );
}

function sessionHasBoundOfficialTemplate(session) {
  return Boolean(
    session?.templateId &&
    session?.templateVersionId
  );
}

function sessionAcceptsCheckout(session) {
  return (
    sessionHasBoundOfficialTemplate(session) &&
    ['candidates_selected', 'awaiting_payment', 'ready'].includes(session.status)
  );
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

function studentResultView({
  registrationId,
  registration,
  sessionId,
  session,
  resultId,
  result: resultInput
}) {
  if (!registration.resultId) {
    if (
      resultId ||
      resultInput
    ) {
      throw new ExamReadDomainError(
        'EXAM_READ_CANONICAL_STATE_INVALID',
        'Read model recebeu resultado sem vínculo canônico na registration.'
      );
    }

    return null;
  }

  if (
    !registrationId ||
    !resultId ||
    !resultInput
  ) {
    throw new ExamReadDomainError(
      'EXAM_READ_CANONICAL_STATE_INVALID',
      'Registration finalizada exige resultado canônico disponível.'
    );
  }

  if (
    registration.resultId !==
      resultId
  ) {
    throw new ExamReadDomainError(
      'EXAM_READ_CANONICAL_STATE_INVALID',
      'resultId do read model diverge da registration.'
    );
  }

  const result =
    normalizeStoredResult(
      resultInput
    );

  if (
    result.registrationId !==
      registrationId ||
    result.attemptId !==
      registration.attemptId ||
    result.sessionId !==
      sessionId ||
    result.organizationId !==
      registration.organizationId ||
    result.studentId !==
      registration.studentId ||
    result.targetBelt !==
      registration.targetBelt ||
    result.templateId !==
      session.templateId ||
    result.templateVersionId !==
      session.templateVersionId
  ) {
    throw new ExamReadDomainError(
      'EXAM_READ_CANONICAL_STATE_INVALID',
      'Resultado não corresponde à cadeia canônica do exame.'
    );
  }

  if (
    ['passed', 'certified'].includes(
      registration.status
    ) &&
    result.outcome !==
      'passed'
  ) {
    throw new ExamReadDomainError(
      'EXAM_READ_CANONICAL_STATE_INVALID',
      'Registration aprovada diverge do resultado canônico.'
    );
  }

  if (
    registration.status ===
      'failed' &&
    result.outcome !==
      'failed'
  ) {
    throw new ExamReadDomainError(
      'EXAM_READ_CANONICAL_STATE_INVALID',
      'Registration reprovada diverge do resultado canônico.'
    );
  }

  try {
    return Object.freeze(
      publicExamResult(
        resultId,
        result
      )
    );
  } catch (error) {
    if (
      error instanceof
        ExamResultDomainError
    ) {
      throw new ExamReadDomainError(
        'EXAM_READ_CANONICAL_STATE_INVALID',
        'Resultado não pode ser projetado com segurança.'
      );
    }

    throw error;
  }
}

function studentCertificateView({
  registrationId,
  registration,
  sessionId,
  session,
  resultId,
  result: resultInput,
  certificateId,
  certificate: certificateInput
}) {
  if (
    registration.status !==
      'certified'
  ) {
    if (
      certificateId ||
      certificateInput
    ) {
      throw new ExamReadDomainError(
        'EXAM_READ_CANONICAL_STATE_INVALID',
        'Registration não certificada recebeu certificado canônico.'
      );
    }

    return null;
  }

  if (
    !registration.certificateId ||
    !certificateId ||
    !certificateInput ||
    registration.certificateId !==
      certificateId
  ) {
    throw new ExamReadDomainError(
      'EXAM_READ_CANONICAL_STATE_INVALID',
      'Registration certified exige certificado canônico correspondente.'
    );
  }

  if (
    !resultId ||
    !resultInput
  ) {
    throw new ExamReadDomainError(
      'EXAM_READ_CANONICAL_STATE_INVALID',
      'Certificado exige resultado canônico disponível.'
    );
  }

  const certificate =
    normalizeStoredCertificate(
      certificateId,
      certificateInput
    );

  const result =
    normalizeStoredResult(
      resultInput
    );

  if (
    certificate.registrationId !==
      registrationId ||
    certificate.resultId !==
      resultId ||
    certificate.attemptId !==
      registration.attemptId ||
    certificate.sessionId !==
      sessionId ||
    certificate.organizationId !==
      registration.organizationId ||
    certificate.studentId !==
      registration.studentId ||
    certificate.instructorId !==
      registration.instructorId ||
    certificate.templateId !==
      session.templateId ||
    certificate.templateVersionId !==
      session.templateVersionId ||
    certificate.targetBelt !==
      registration.targetBelt
  ) {
    throw new ExamReadDomainError(
      'EXAM_READ_CANONICAL_STATE_INVALID',
      'Certificado não corresponde à cadeia canônica do exame.'
    );
  }

  if (
    certificate.scoreBps !==
      result.scoreBps ||
    certificate.correctCount !==
      result.correctCount ||
    certificate.totalQuestions !==
      result.totalQuestions ||
    !sameTimestamp(
      certificate.resultFinalizedAt,
      result.finalizedAt
    )
  ) {
    throw new ExamReadDomainError(
      'EXAM_READ_CANONICAL_STATE_INVALID',
      'Snapshot acadêmico do certificado diverge do resultado.'
    );
  }

  try {
    return Object.freeze(
      publicExamCertificate(
        certificateId,
        certificate
      )
    );
  } catch (error) {
    if (
      error instanceof
        ExamCertificateDomainError
    ) {
      throw new ExamReadDomainError(
        'EXAM_READ_CANONICAL_STATE_INVALID',
        'Certificado não pode ser projetado com segurança.'
      );
    }

    throw error;
  }
}
function buildStudentExamReadView({
  registrationId = null,
  sessionId,
  session: sessionInput,
  registration: registrationInput,
  organizationName = null,
  membershipActive = false,
  resultId = null,
  result = null,
  certificateId = null,
  certificate = null
} = {}) {
  const session = normalizeStoredSession(sessionInput);
  const registration = normalizeStoredRegistration(registrationInput);
  assertRegistrationMatchesSession(registration, sessionId, session);

  const state =
    registrationReadState(
      registration.status
    );

  const examState =
    studentExamAcademicState(
      registration.status
    );

  const saleable =
    sessionAcceptsCheckout(
      session
    );

  const activeMembership =
    membershipActive === true;

  const sessionExecutable =
    sessionHasBoundOfficialTemplate(
      session
    ) &&
    ![
      'cancelled',
      'archived'
    ].includes(
      session.status
    );

  const projectedResult =
    studentResultView({
      registrationId,
      registration,
      sessionId,
      session,
      resultId,
      result
    });

  const projectedCertificate =
    studentCertificateView({
      registrationId,
      registration,
      sessionId,
      session,
      resultId,
      result,
      certificateId,
      certificate
    });

  return Object.freeze({
    registrationId:
      text(
        registrationId,
        200
      ),
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
    examState,
    canStartCheckout:
      activeMembership &&
      saleable &&
      registration.status === 'selected',
    canResumePayment:
      activeMembership &&
      saleable &&
      registration.status === 'awaiting_payment',
    canStartExam:
      activeMembership &&
      sessionExecutable &&
      registration.status === 'authorized',
    canResumeExam:
      registration.status === 'started',
    result:
      projectedResult,
    certificate:
      projectedCertificate,
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
    templateBound:
      sessionHasBoundOfficialTemplate(session),
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
  STUDENT_EXAM_ACADEMIC_STATES,
  ExamReadDomainError,
  registrationReadState,
  studentExamAcademicState,
  sessionHasBoundOfficialTemplate,
  sessionAcceptsCheckout,
  buildStudentExamReadView,
  buildInstructorSessionSummary,
  buildInstructorRegistrationView
};
