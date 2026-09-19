'use strict';

const assert = require('node:assert/strict');
const {
  FinancialReversalDomainError,
  classifyFinancialReversalEvent,
  resolveFinancialReversalTransition,
  resolveEnrollmentReversalPolicy,
  grantsCourseEntitlement
} = require('../src/finance/financial-reversal-domain');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

function transition(eventType, orderStatus, transactionStatus, extra = {}) {
  return resolveFinancialReversalTransition({
    eventType,
    orderStatus,
    transactionStatus,
    ...extra
  });
}

function enrollment(overrides = {}) {
  return {
    courseId: 'course-1',
    userId: 'student-1',
    source: 'order',
    orderId: 'order-1',
    status: 'active',
    progressPercent: 35,
    startedAt: '2026-09-18T12:00:00Z',
    completedAt: null,
    createdAt: '2026-09-18T12:00:00Z',
    updatedAt: '2026-09-18T12:00:00Z',
    ...overrides
  };
}

test('PAYMENT_DELETED classifica cancelamento pré-pagamento', () => {
  const result = classifyFinancialReversalEvent('PAYMENT_DELETED');
  assert.equal(result.action, 'cancel');
  assert.equal(result.mutatesFinancialState, true);
  assert.equal(result.revokesEntitlement, false);
});

test('PAYMENT_REFUNDED classifica refund final', () => {
  const result = classifyFinancialReversalEvent('payment_refunded');
  assert.equal(result.eventType, 'PAYMENT_REFUNDED');
  assert.equal(result.action, 'refund');
  assert.equal(result.revokesEntitlement, true);
});

test('refund parcial exige reconciliação e não revoga acesso automaticamente', () => {
  const result = classifyFinancialReversalEvent('PAYMENT_PARTIALLY_REFUNDED');
  assert.equal(result.action, 'partial_refund_review');
  assert.equal(result.mutatesFinancialState, false);
  assert.equal(result.requiresReview, true);
});

test('refund em andamento não muda estado final', () => {
  const result = classifyFinancialReversalEvent('PAYMENT_REFUND_IN_PROGRESS');
  assert.equal(result.action, 'refund_pending');
  assert.equal(result.mutatesFinancialState, false);
});

test('chargeback solicitado revoga entitlement imediatamente', () => {
  const result = classifyFinancialReversalEvent('PAYMENT_CHARGEBACK_REQUESTED');
  assert.equal(result.action, 'chargeback');
  assert.equal(result.revokesEntitlement, true);
});

test('disputa de chargeback é progresso e não restaura acesso', () => {
  const result = classifyFinancialReversalEvent('PAYMENT_CHARGEBACK_DISPUTE');
  assert.equal(result.action, 'chargeback_progress');
  assert.equal(result.mutatesFinancialState, false);
  assert.equal(result.revokesEntitlement, true);
});

test('aguardando reversão de chargeback não restaura acesso sozinho', () => {
  const result = classifyFinancialReversalEvent('PAYMENT_AWAITING_CHARGEBACK_REVERSAL');
  assert.equal(result.action, 'chargeback_reversal_pending');
  assert.equal(result.mutatesFinancialState, false);
});

test('evento positivo permanece ambíguo até considerar estado canônico', () => {
  const result = classifyFinancialReversalEvent('PAYMENT_RECEIVED');
  assert.equal(result.action, 'positive_payment');
  assert.equal(result.mutatesFinancialState, false);
});

test('evento desconhecido fica fora do escopo', () => {
  const result = classifyFinancialReversalEvent('PAYMENT_OVERDUE');
  assert.equal(result.action, 'ignore');
});

test('cancelamento converte pending_payment/pending em cancelled', () => {
  const result = transition('PAYMENT_DELETED', 'pending_payment', 'pending');
  assert.equal(result.orderStatus, 'cancelled');
  assert.equal(result.transactionStatus, 'cancelled');
  assert.equal(result.noop, false);
});

test('reentrega de cancelamento é idempotente', () => {
  const result = transition('PAYMENT_DELETED', 'cancelled', 'cancelled');
  assert.equal(result.idempotent, true);
  assert.equal(result.reason, 'ALREADY_CANCELLED');
});

test('PAYMENT_DELETED não cancela cobrança já paga', () => {
  assert.throws(
    () => transition('PAYMENT_DELETED', 'paid', 'paid'),
    error => error instanceof FinancialReversalDomainError && error.code === 'PAYMENT_NOT_CANCELLABLE'
  );
});

test('refund converte paid/paid em refunded', () => {
  const result = transition('PAYMENT_REFUNDED', 'paid', 'paid');
  assert.equal(result.orderStatus, 'refunded');
  assert.equal(result.transactionStatus, 'refunded');
});

test('refund após chargeback finaliza como refunded', () => {
  const result = transition('PAYMENT_REFUNDED', 'chargeback', 'chargeback');
  assert.equal(result.orderStatus, 'refunded');
  assert.equal(result.transactionStatus, 'refunded');
});

test('reentrega de refund é idempotente', () => {
  const result = transition('PAYMENT_REFUNDED', 'refunded', 'refunded');
  assert.equal(result.idempotent, true);
  assert.equal(result.reason, 'ALREADY_REFUNDED');
});

test('chargeback converte paid/paid em chargeback', () => {
  const result = transition('PAYMENT_CHARGEBACK_REQUESTED', 'paid', 'paid');
  assert.equal(result.orderStatus, 'chargeback');
  assert.equal(result.transactionStatus, 'chargeback');
});

test('reentrega de chargeback é idempotente', () => {
  const result = transition('PAYMENT_CHARGEBACK_REQUESTED', 'chargeback', 'chargeback');
  assert.equal(result.idempotent, true);
});

test('refund final tem precedência sobre chargeback entregue fora de ordem', () => {
  const result = transition('PAYMENT_CHARGEBACK_REQUESTED', 'refunded', 'refunded');
  assert.equal(result.orderStatus, 'refunded');
  assert.equal(result.noop, true);
  assert.equal(result.reason, 'REFUND_FINAL_PRECEDENCE');
});

test('evento positivo não restaura chargeback sem autorização contextual', () => {
  assert.throws(
    () => transition('PAYMENT_RECEIVED', 'chargeback', 'chargeback'),
    error => error.code === 'CHARGEBACK_RECOVERY_NOT_AUTHORIZED'
  );
});

test('chargeback pode ser restaurado para paid somente com autorização contextual', () => {
  const result = transition(
    'PAYMENT_RECEIVED',
    'chargeback',
    'chargeback',
    { chargebackRecoveryAuthorized: true }
  );
  assert.equal(result.action, 'chargeback_recovered');
  assert.equal(result.orderStatus, 'paid');
  assert.equal(result.transactionStatus, 'paid');
  assert.equal(result.restoresEntitlement, true);
});

test('evento positivo em paid delega ao fluxo 5.4', () => {
  const result = transition('PAYMENT_RECEIVED', 'paid', 'paid');
  assert.equal(result.delegated, true);
  assert.equal(result.reason, 'DELEGATE_POSITIVE_PAYMENT_TO_MARCO_5_4');
});

test('estado financeiro inconsistente falha fechado', () => {
  assert.throws(
    () => transition('PAYMENT_REFUNDED', 'paid', 'pending'),
    error => error.code === 'FINANCIAL_REVERSAL_STATE_MISMATCH'
  );
});

test('refund revoga enrollment ativo sem apagar progresso', () => {
  const result = resolveEnrollmentReversalPolicy({
    action: 'refund',
    enrollment: enrollment({ progressPercent: 62 })
  });
  assert.equal(result.targetStatus, 'refunded');
  assert.equal(result.entitlementGranted, false);
  assert.equal(result.preserveCompletionHistory, true);
});

test('refund de curso concluído preserva histórico e revoga entitlement', () => {
  const result = resolveEnrollmentReversalPolicy({
    action: 'refund',
    enrollment: enrollment({
      status: 'completed',
      progressPercent: 100,
      completedAt: '2026-09-18T13:00:00Z'
    })
  });
  assert.equal(result.targetStatus, 'refunded');
  assert.equal(result.entitlementGranted, false);
  assert.equal(result.preserveCompletionHistory, true);
});

test('chargeback revoga enrollment ativo em status próprio', () => {
  const result = resolveEnrollmentReversalPolicy({
    action: 'chargeback',
    enrollment: enrollment()
  });
  assert.equal(result.targetStatus, 'chargeback');
  assert.equal(result.entitlementGranted, false);
});

test('refund final prevalece sobre enrollment já em chargeback', () => {
  const result = resolveEnrollmentReversalPolicy({
    action: 'refund',
    enrollment: enrollment({ status: 'chargeback' })
  });
  assert.equal(result.targetStatus, 'refunded');
});

test('recuperação de chargeback restaura active quando curso não estava concluído', () => {
  const result = resolveEnrollmentReversalPolicy({
    action: 'chargeback_recovered',
    enrollment: enrollment({ status: 'chargeback', progressPercent: 42 })
  });
  assert.equal(result.targetStatus, 'active');
  assert.equal(result.entitlementGranted, true);
});

test('recuperação de chargeback restaura completed quando há conclusão histórica', () => {
  const result = resolveEnrollmentReversalPolicy({
    action: 'chargeback_recovered',
    enrollment: enrollment({
      status: 'chargeback',
      progressPercent: 100,
      completedAt: '2026-09-18T13:00:00Z'
    })
  });
  assert.equal(result.targetStatus, 'completed');
});

test('cancelamento pré-pagamento exige ausência de enrollment', () => {
  const result = resolveEnrollmentReversalPolicy({ action: 'cancel', enrollment: null });
  assert.equal(result.targetStatus, null);
  assert.equal(result.idempotent, true);
  assert.throws(
    () => resolveEnrollmentReversalPolicy({ action: 'cancel', enrollment: enrollment() }),
    error => error.code === 'CANCELLED_PAYMENT_HAS_ENTITLEMENT'
  );
});

test('reversão financeira não altera enrollment free/admin_grant', () => {
  assert.throws(
    () => resolveEnrollmentReversalPolicy({
      action: 'refund',
      enrollment: enrollment({ source: 'free', orderId: null })
    }),
    error => error.code === 'REVERSAL_ORDER_ENROLLMENT_REQUIRED'
  );
});

test('somente active/completed concedem entitlement', () => {
  assert.equal(grantsCourseEntitlement('active'), true);
  assert.equal(grantsCourseEntitlement('completed'), true);
  assert.equal(grantsCourseEntitlement('refunded'), false);
  assert.equal(grantsCourseEntitlement('chargeback'), false);
  assert.equal(grantsCourseEntitlement('cancelled'), false);
});

let passed = 0;
for (const item of cases) {
  try {
    item.fn();
    passed += 1;
    console.log(`PASS | ${item.name}`);
  } catch (error) {
    console.error(`FAIL | ${item.name}`);
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}

console.log(`FINANCIAL_REVERSAL_DOMAIN_V1_2=${passed}/${cases.length}`);
if (passed !== cases.length) process.exitCode = 1;
