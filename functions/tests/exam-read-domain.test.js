'use strict';

const assert = require('node:assert/strict');
const {
  buildExamSession
} = require('../src/exams/exam-session-domain');
const {
  buildSelectedExamRegistration,
  validateExamRegistration
} = require('../src/exams/exam-registration-domain');
const {
  examResultDocumentId,
  validateExamResult
} = require('../src/exams/exam-result-domain');
const {
  ExamReadDomainError,
  registrationReadState,
  studentExamAcademicState,
  buildStudentExamReadView,
  buildInstructorSessionSummary,
  buildInstructorRegistrationView
} = require('../src/exams/exam-read-domain');

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

const createdAt = new Date('2026-09-20T13:30:00.000Z');
const session = buildExamSession({
  organizationId: 'org_a',
  responsibleInstructorId: 'inst_a',
  targetBelt: 'Azul',
  templateId: 'template_a',
  templateVersionId: 'v0000001',
  priceCents: 12500,
  currency: 'BRL',
  scheduledAt: new Date('2026-10-01T15:00:00.000Z'),
  createdBy: 'inst_a',
  timestamp: createdAt
});
const selected = buildSelectedExamRegistration({
  sessionId: 'session_a',
  organizationId: 'org_a',
  studentId: 'student_a',
  instructorId: 'inst_a',
  currentBelt: 'Branca',
  targetBelt: 'Azul',
  membershipId: 'membership_student_a',
  timestamp: createdAt
});

function registration(status, extras = {}) {
  return validateExamRegistration({
    ...selected,
    status,
    orderId: status === 'selected' || status === 'cancelled' ? null : 'order_a',
    paidAt: ['authorized', 'started', 'submitted', 'passed', 'failed', 'certified'].includes(status)
      ? createdAt
      : null,
    authorizedAt: ['authorized', 'started', 'submitted', 'passed', 'failed', 'certified'].includes(status)
      ? createdAt
      : null,
    attemptId: ['started', 'submitted', 'passed', 'failed', 'certified'].includes(status)
      ? 'attempt_a'
      : null,
    resultId: ['submitted', 'passed', 'failed', 'certified'].includes(status)
      ? 'result_a'
      : null,
    certificateId: status === 'certified' ? 'certificate_a' : null,
    cancelledAt: status === 'cancelled' ? createdAt : null,
    ...extras
  });
}

test('mapeia estados publicos sem expor maquina financeira interna', () => {
  assert.equal(registrationReadState('selected'), 'selected');
  assert.equal(registrationReadState('awaiting_payment'), 'payment_pending');
  assert.equal(registrationReadState('authorized'), 'authorized');
  assert.equal(registrationReadState('cancelled'), 'cancelled');
  assert.equal(registrationReadState('needs_reconciliation'), 'needs_reconciliation');
  assert.equal(registrationReadState('started'), 'started_or_later');
  assert.equal(registrationReadState('certified'), 'started_or_later');

  assert.equal(
    studentExamAcademicState('authorized'),
    'not_started'
  );
  assert.equal(
    studentExamAcademicState('started'),
    'in_progress'
  );
  assert.equal(
    studentExamAcademicState('submitted'),
    'submitted'
  );
  assert.equal(
    studentExamAcademicState('passed'),
    'passed'
  );
  assert.equal(
    studentExamAcademicState('failed'),
    'failed'
  );
});

test('aluno selecionado com vinculo ativo pode iniciar checkout', () => {
  const view = buildStudentExamReadView({
    sessionId: 'session_a',
    session: { ...session, status: 'candidates_selected' },
    registration: selected,
    organizationName: 'Academia A',
    membershipActive: true
  });
  assert.equal(view.state, 'selected');
  assert.equal(view.canStartCheckout, true);
  assert.equal(view.canResumePayment, false);
  assert.equal(view.canStartExam, false);
  assert.equal(view.price.amountCents, 12500);
});

test('sessao sem template oficial bloqueia checkout e retomada', () => {
  const unboundSession = {
    ...session,
    templateId: null,
    templateVersionId: null
  };

  const selectedView =
    buildStudentExamReadView({
      sessionId: 'session_a',
      session: {
        ...unboundSession,
        status: 'candidates_selected'
      },
      registration: selected,
      membershipActive: true
    });

  const pendingView =
    buildStudentExamReadView({
      sessionId: 'session_a',
      session: {
        ...unboundSession,
        status: 'awaiting_payment'
      },
      registration:
        registration('awaiting_payment'),
      membershipActive: true
    });

  assert.equal(
    selectedView.canStartCheckout,
    false
  );

  assert.equal(
    pendingView.canResumePayment,
    false
  );

  assert.equal(
    Object.hasOwn(
      selectedView,
      'templateId'
    ),
    false
  );

  assert.equal(
    Object.hasOwn(
      selectedView,
      'templateVersionId'
    ),
    false
  );
});

test('pagamento pendente pode ser retomado sem liberar prova', () => {
  const view = buildStudentExamReadView({
    sessionId: 'session_a',
    session: { ...session, status: 'awaiting_payment' },
    registration: registration('awaiting_payment'),
    membershipActive: true
  });
  assert.equal(view.state, 'payment_pending');
  assert.equal(view.canStartCheckout, false);
  assert.equal(view.canResumePayment, true);
  assert.equal(view.canStartExam, false);
});

test('vinculo inativo bloqueia checkout e retomada', () => {
  const selectedView = buildStudentExamReadView({
    sessionId: 'session_a',
    session: { ...session, status: 'candidates_selected' },
    registration: selected,
    membershipActive: false
  });
  const pendingView = buildStudentExamReadView({
    sessionId: 'session_a',
    session: { ...session, status: 'awaiting_payment' },
    registration: registration('awaiting_payment'),
    membershipActive: false
  });
  assert.equal(selectedView.canStartCheckout, false);
  assert.equal(pendingView.canResumePayment, false);
});

test('authorized com vinculo e template libera start canonico', () => {
  const view = buildStudentExamReadView({
    registrationId:
      'registration_a',
    sessionId:
      'session_a',
    session: {
      ...session,
      status: 'ready'
    },
    registration:
      registration('authorized'),
    membershipActive:
      true
  });

  assert.equal(
    view.registrationId,
    'registration_a'
  );
  assert.equal(
    view.state,
    'authorized'
  );
  assert.equal(
    view.examState,
    'not_started'
  );
  assert.equal(
    view.canStartExam,
    true
  );
  assert.equal(
    view.canResumeExam,
    false
  );
  assert.equal(
    view.result,
    null
  );
});

test('started preserva state legado e libera resume canonico', () => {
  const view = buildStudentExamReadView({
    registrationId:
      'registration_a',
    sessionId:
      'session_a',
    session: {
      ...session,
      status: 'ready'
    },
    registration:
      registration('started'),
    membershipActive:
      true
  });

  assert.equal(
    view.state,
    'started_or_later'
  );
  assert.equal(
    view.examState,
    'in_progress'
  );
  assert.equal(
    view.canStartCheckout,
    false
  );
  assert.equal(
    view.canResumePayment,
    false
  );
  assert.equal(
    view.canStartExam,
    false
  );
  assert.equal(
    view.canResumeExam,
    true
  );
});

test('authorized com membership inativa nao libera start', () => {
  const view = buildStudentExamReadView({
    registrationId:
      'registration_a',
    sessionId:
      'session_a',
    session: {
      ...session,
      status: 'ready'
    },
    registration:
      registration('authorized'),
    membershipActive:
      false
  });

  assert.equal(
    view.canStartExam,
    false
  );
});

test('passed expoe somente resultado academico sanitizado', () => {
  const resultId =
    examResultDocumentId(
      'attempt_a'
    );

  const passedRegistration =
    registration(
      'passed',
      {
        resultId
      }
    );

  const result =
    validateExamResult({
      resultVersion:
        1,
      attemptId:
        'attempt_a',
      registrationId:
        'registration_a',
      sessionId:
        'session_a',
      organizationId:
        'org_a',
      studentId:
        'student_a',
      templateId:
        'template_a',
      templateVersionId:
        'v0000001',
      targetBelt:
        'Azul',
      scoreBps:
        10000,
      correctCount:
        10,
      totalQuestions:
        10,
      outcome:
        'passed',
      reason:
        'score_passed',
      certificateEligible:
        true,
      finalizedAt:
        createdAt
    });

  const view =
    buildStudentExamReadView({
      registrationId:
        'registration_a',
      sessionId:
        'session_a',
      session: {
        ...session,
        status: 'ready'
      },
      registration:
        passedRegistration,
      membershipActive:
        true,
      resultId,
      result
    });

  assert.equal(
    view.state,
    'started_or_later'
  );
  assert.equal(
    view.examState,
    'passed'
  );
  assert.equal(
    view.canStartExam,
    false
  );
  assert.equal(
    view.canResumeExam,
    false
  );
  assert.equal(
    view.result.resultId,
    resultId
  );
  assert.equal(
    view.result.status,
    'passed'
  );
  assert.equal(
    view.result.scoreBps,
    10000
  );
  assert.equal(
    view.result.certificateEligible,
    true
  );

  const serialized =
    JSON.stringify(view.result);

  for (
    const forbidden of [
      'attemptId',
      'registrationId',
      'sessionId',
      'organizationId',
      'studentId',
      'templateId',
      'templateVersionId',
      'targetBelt',
      'reason',
      'correctAnswer',
      'answers'
    ]
  ) {
    assert.equal(
      serialized.includes(
        forbidden
      ),
      false
    );
  }
});

test('resultado divergente da cadeia canonica falha fechado', () => {
  const resultId =
    examResultDocumentId(
      'attempt_a'
    );

  const passedRegistration =
    registration(
      'passed',
      {
        resultId
      }
    );

  const mismatchedResult =
    validateExamResult({
      resultVersion:
        1,
      attemptId:
        'attempt_a',
      registrationId:
        'registration_other',
      sessionId:
        'session_a',
      organizationId:
        'org_a',
      studentId:
        'student_a',
      templateId:
        'template_a',
      templateVersionId:
        'v0000001',
      targetBelt:
        'Azul',
      scoreBps:
        10000,
      correctCount:
        10,
      totalQuestions:
        10,
      outcome:
        'passed',
      reason:
        'score_passed',
      certificateEligible:
        true,
      finalizedAt:
        createdAt
    });

  assert.throws(
    () =>
      buildStudentExamReadView({
        registrationId:
          'registration_a',
        sessionId:
          'session_a',
        session: {
          ...session,
          status: 'ready'
        },
        registration:
          passedRegistration,
        membershipActive:
          true,
        resultId,
        result:
          mismatchedResult
      }),
    error =>
      error instanceof
        ExamReadDomainError &&
      error.code ===
        'EXAM_READ_CANONICAL_STATE_INVALID'
  );
});

test('view do instrutor nao expoe orderId nem estado academico cru', () => {
  const source = registration('authorized');
  const view = buildInstructorRegistrationView({
    registrationId: 'registration_a',
    registration: source,
    sessionId: 'session_a',
    session: { ...session, status: 'ready' },
    studentName: 'Aluno A'
  });
  assert.equal(view.student.studentId, 'student_a');
  assert.equal(view.authorized, true);
  assert.equal(Object.hasOwn(view, 'orderId'), false);
  assert.equal(Object.hasOwn(view, 'attemptId'), false);
  assert.equal(Object.hasOwn(view, 'resultId'), false);
  assert.equal(Object.hasOwn(view, 'certificateId'), false);
});

test('resumo de sessao expoe apenas produto necessario para UI', () => {
  const view = buildInstructorSessionSummary({
    sessionId: 'session_a',
    session: { ...session, status: 'candidates_selected' },
    organizationName: 'Academia A'
  });
  assert.equal(view.sessionId, 'session_a');
  assert.equal(view.organization.name, 'Academia A');
  assert.equal(view.price.amountCents, 12500);
  assert.equal(view.templateBound, true);
  assert.equal(Object.hasOwn(view, 'financialRuleId'), false);

  const unboundView =
    buildInstructorSessionSummary({
      sessionId: 'session_unbound',
      session: {
        ...session,
        templateId: null,
        templateVersionId: null,
        status: 'candidates_selected'
      },
      organizationName: 'Academia A'
    });

  assert.equal(
    unboundView.templateBound,
    false
  );
});

test('mismatch registration/session falha fechado', () => {
  assert.throws(
    () => buildStudentExamReadView({
      sessionId: 'session_a',
      session,
      registration: { ...selected, organizationId: 'org_b' },
      membershipActive: true
    }),
    error => error instanceof ExamReadDomainError &&
      error.code === 'EXAM_READ_CANONICAL_STATE_INVALID'
  );
});

console.log(`EXAM_READ_DOMAIN_V1_2=${passed}/13`);
if (passed !== 13) process.exitCode = 1;
