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
  ExamReadDomainError,
  registrationReadState,
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
    resultId: ['passed', 'failed', 'certified'].includes(status)
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

test('authorized permanece sem start de prova no Marco 5.7', () => {
  const view = buildStudentExamReadView({
    sessionId: 'session_a',
    session: { ...session, status: 'ready' },
    registration: registration('authorized'),
    membershipActive: true
  });
  assert.equal(view.state, 'authorized');
  assert.equal(view.canStartExam, false);
});

test('estado academico iniciado e reduzido a started_or_later', () => {
  const view = buildStudentExamReadView({
    sessionId: 'session_a',
    session: { ...session, status: 'ready' },
    registration: registration('started'),
    membershipActive: true
  });
  assert.equal(view.state, 'started_or_later');
  assert.equal(view.canStartCheckout, false);
  assert.equal(view.canResumePayment, false);
  assert.equal(view.canStartExam, false);
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
  assert.equal(Object.hasOwn(view, 'financialRuleId'), false);
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

console.log(`EXAM_READ_DOMAIN_V1_2=${passed}/9`);
if (passed !== 9) process.exitCode = 1;
