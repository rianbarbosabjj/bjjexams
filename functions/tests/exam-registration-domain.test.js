'use strict';

const assert = require('node:assert/strict');
const {
  ExamRegistrationDomainError,
  examRegistrationDocumentId,
  validateExamRegistration,
  assertExamRegistrationStatusTransition,
  buildSelectedExamRegistration,
  assertRegistrationCheckoutEligible,
  markRegistrationAwaitingPayment,
  authorizePaidExamRegistration,
  markRegistrationStarted,
  markRegistrationSubmitted,
  markRegistrationOutcome,
  markRegistrationCertified,
  resetRegistrationAfterPendingCancellation,
  cancelAuthorizedRegistrationAfterRefund,
  markRegistrationNeedsReconciliation
} = require('../src/exams/exam-registration-domain');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    throw error;
  }
}

function expectCode(code, fn) {
  assert.throws(fn, error => {
    assert.ok(error instanceof ExamRegistrationDomainError);
    assert.equal(error.code, code);
    return true;
  });
}

const t0 = new Date('2026-09-20T02:00:00.000Z');
const t1 = new Date('2026-09-20T02:05:00.000Z');
const t2 = new Date('2026-09-20T02:10:00.000Z');

function selected(overrides = {}) {
  return buildSelectedExamRegistration({
    sessionId: 'session_1',
    organizationId: 'org_1',
    studentId: 'student_1',
    instructorId: 'prof_1',
    currentBelt: 'Branca',
    targetBelt: 'Azul',
    membershipId: 'membership_1',
    timestamp: t0,
    ...overrides
  });
}

function pending(orderId = 'order_1') {
  return markRegistrationAwaitingPayment(selected(), {
    orderId,
    updatedAt: t1
  });
}

function authorized(orderId = 'order_1') {
  return authorizePaidExamRegistration(pending(orderId), {
    orderId,
    paidAt: t2
  });
}

function started() {
  return markRegistrationStarted(
    authorized(),
    {
      attemptId: 'attempt_1',
      startedAt:
        new Date(
          '2026-09-20T02:15:00.000Z'
        )
    }
  );
}

test('registration id e deterministico por sessao e aluno', () => {
  const first = examRegistrationDocumentId({
    sessionId: 'session_1',
    studentId: 'student_1'
  });
  const second = examRegistrationDocumentId({
    sessionId: 'session_1',
    studentId: 'student_1'
  });
  const other = examRegistrationDocumentId({
    sessionId: 'session_1',
    studentId: 'student_2'
  });
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('build selected cria identidade canonica sem pedido financeiro', () => {
  const registration = selected();
  assert.equal(registration.status, 'selected');
  assert.equal(registration.orderId, null);
  assert.equal(registration.studentId, 'student_1');
  assert.equal(registration.targetBelt, 'Azul');
});

test('registration exige membership e identidades validas', () => {
  expectCode('INVALID_EXAM_REGISTRATION_IDENTIFIER', () =>
    selected({ membershipId: 'bad/id' })
  );
  expectCode('INVALID_EXAM_REGISTRATION_IDENTIFIER', () =>
    selected({ organizationId: '' })
  );
});

test('selected nao pode carregar orderId ativo', () => {
  expectCode('SELECTED_REGISTRATION_ORDER_NOT_ALLOWED', () =>
    validateExamRegistration({
      ...selected(),
      orderId: 'order_1'
    })
  );
});

test('awaiting_payment exige orderId', () => {
  expectCode('EXAM_REGISTRATION_ORDER_REQUIRED', () =>
    validateExamRegistration({
      ...selected(),
      status: 'awaiting_payment'
    })
  );
});

test('checkout transforma selected em awaiting_payment', () => {
  const registration = pending();
  assert.equal(registration.status, 'awaiting_payment');
  assert.equal(registration.orderId, 'order_1');
});

test('retry do mesmo checkout e idempotente para o mesmo orderId', () => {
  const registration = markRegistrationAwaitingPayment(pending(), {
    orderId: 'order_1',
    updatedAt: t2
  });
  assert.equal(registration.status, 'awaiting_payment');
  assert.equal(registration.orderId, 'order_1');
  assert.equal(registration.updatedAt, t2);
});

test('pending nao pode ser religado silenciosamente a outro pedido', () => {
  expectCode('EXAM_REGISTRATION_ORDER_MISMATCH', () =>
    markRegistrationAwaitingPayment(pending('order_1'), {
      orderId: 'order_2',
      updatedAt: t2
    })
  );
});

test('pagamento confirmado autoriza exatamente o pedido vinculado', () => {
  const registration = authorized();
  assert.equal(registration.status, 'authorized');
  assert.equal(registration.orderId, 'order_1');
  assert.equal(registration.paidAt, t2);
  assert.equal(registration.authorizedAt, t2);
});

test('confirmacao duplicada do mesmo pagamento e idempotente', () => {
  const registration = authorizePaidExamRegistration(authorized(), {
    orderId: 'order_1',
    paidAt: new Date('2026-09-20T02:20:00.000Z')
  });
  assert.equal(registration.status, 'authorized');
  assert.equal(registration.paidAt, t2);
});

test('pagamento de outro orderId nao autoriza registration', () => {
  expectCode('EXAM_REGISTRATION_ORDER_MISMATCH', () =>
    authorizePaidExamRegistration(pending('order_1'), {
      orderId: 'order_2',
      paidAt: t2
    })
  );
});

test('cancelamento pending retorna registration a selected para recompra', () => {
  const registration = resetRegistrationAfterPendingCancellation(pending(), {
    orderId: 'order_1',
    updatedAt: t2
  });
  assert.equal(registration.status, 'selected');
  assert.equal(registration.orderId, null);
  assert.equal(assertRegistrationCheckoutEligible(registration).status, 'selected');
});

test('refund antes de iniciar cancela authorization mas preserva orderId historico', () => {
  const registration = cancelAuthorizedRegistrationAfterRefund(authorized(), {
    orderId: 'order_1',
    cancelledAt: new Date('2026-09-20T02:30:00.000Z')
  });
  assert.equal(registration.status, 'cancelled');
  assert.equal(registration.orderId, 'order_1');
  assert.ok(registration.cancelledAt);
});

test('registration com atividade academica nao aceita refund automatico', () => {
  const inconsistentAcademicActivity = {
    ...authorized(),
    attemptId: 'attempt_1'
  };
  expectCode('EXAM_REGISTRATION_REFUND_RECONCILIATION_REQUIRED', () =>
    cancelAuthorizedRegistrationAfterRefund(inconsistentAcademicActivity, {
      orderId: 'order_1',
      cancelledAt: t2
    })
  );
});

test('chargeback ou refund tardio pode marcar reconciliacao', () => {
  const registration = markRegistrationNeedsReconciliation(authorized(), {
    orderId: 'order_1',
    updatedAt: new Date('2026-09-20T02:40:00.000Z')
  });
  assert.equal(registration.status, 'needs_reconciliation');
  assert.equal(registration.orderId, 'order_1');
});

test('needs_reconciliation bloqueia novo checkout automatico', () => {
  const registration = markRegistrationNeedsReconciliation(authorized(), {
    orderId: 'order_1',
    updatedAt: t2
  });
  expectCode('EXAM_REGISTRATION_NOT_CHECKOUT_ELIGIBLE', () =>
    assertRegistrationCheckoutEligible(registration)
  );
});

test('maquina de estados bloqueia salto selected para authorized', () => {
  expectCode('INVALID_EXAM_REGISTRATION_TRANSITION', () =>
    assertExamRegistrationStatusTransition('selected', 'authorized')
  );
});

test('authorized inicia exatamente uma tentativa', () => {
  const startedAt =
    new Date('2026-09-20T02:15:00.000Z');

  const registration =
    markRegistrationStarted(
      authorized(),
      {
        attemptId: 'attempt_1',
        startedAt
      }
    );

  assert.equal(
    registration.status,
    'started'
  );

  assert.equal(
    registration.attemptId,
    'attempt_1'
  );

  assert.equal(
    registration.updatedAt,
    startedAt
  );
});

test('retry do start com mesmo attemptId e idempotente', () => {
  const startedAt =
    new Date('2026-09-20T02:15:00.000Z');

  const started =
    markRegistrationStarted(
      authorized(),
      {
        attemptId: 'attempt_1',
        startedAt
      }
    );

  const retry =
    markRegistrationStarted(
      started,
      {
        attemptId: 'attempt_1',
        startedAt:
          new Date(
            '2026-09-20T02:20:00.000Z'
          )
      }
    );

  assert.equal(
    retry.status,
    'started'
  );

  assert.equal(
    retry.attemptId,
    'attempt_1'
  );

  assert.equal(
    retry.updatedAt,
    startedAt
  );
});

test('retry do start nao aceita outro attemptId', () => {
  const started =
    markRegistrationStarted(
      authorized(),
      {
        attemptId: 'attempt_1',
        startedAt: t2
      }
    );

  expectCode(
    'EXAM_REGISTRATION_ATTEMPT_MISMATCH',
    () =>
      markRegistrationStarted(
        started,
        {
          attemptId: 'attempt_2',
          startedAt: t2
        }
      )
  );
});

test('start exige registration authorized', () => {
  expectCode(
    'EXAM_REGISTRATION_START_STATE_REQUIRED',
    () =>
      markRegistrationStarted(
        selected(),
        {
          attemptId: 'attempt_1',
          startedAt: t2
        }
      )
  );
});

test('authorized com estado academico previo falha fechado', () => {
  expectCode(
    'EXAM_REGISTRATION_ACADEMIC_STATE_EXISTS',
    () =>
      markRegistrationStarted(
        {
          ...authorized(),
          attemptId: 'attempt_rogue'
        },
        {
          attemptId: 'attempt_1',
          startedAt: t2
        }
      )
  );
});

test('estado submitted exige resultId', () => {
  expectCode(
    'EXAM_REGISTRATION_RESULT_REQUIRED',
    () =>
      validateExamRegistration({
        ...started(),
        status: 'submitted',
        resultId: null
      })
  );
});

test('started registra submissao com resultId', () => {
  const submittedAt =
    new Date(
      '2026-09-20T02:20:00.000Z'
    );

  const registration =
    markRegistrationSubmitted(
      started(),
      {
        resultId: 'result_1',
        submittedAt
      }
    );

  assert.equal(
    registration.status,
    'submitted'
  );

  assert.equal(
    registration.resultId,
    'result_1'
  );

  assert.equal(
    registration.updatedAt,
    submittedAt
  );
});

test('retry da submissao com mesmo resultId e idempotente', () => {
  const submittedAt =
    new Date(
      '2026-09-20T02:20:00.000Z'
    );

  const submitted =
    markRegistrationSubmitted(
      started(),
      {
        resultId: 'result_1',
        submittedAt
      }
    );

  const retry =
    markRegistrationSubmitted(
      submitted,
      {
        resultId: 'result_1',
        submittedAt:
          new Date(
            '2026-09-20T02:25:00.000Z'
          )
      }
    );

  assert.equal(
    retry.status,
    'submitted'
  );

  assert.equal(
    retry.resultId,
    'result_1'
  );

  assert.equal(
    retry.updatedAt,
    submittedAt
  );
});

test('retry da submissao rejeita outro resultId', () => {
  const submitted =
    markRegistrationSubmitted(
      started(),
      {
        resultId: 'result_1',
        submittedAt:
          new Date(
            '2026-09-20T02:20:00.000Z'
          )
      }
    );

  expectCode(
    'EXAM_REGISTRATION_RESULT_MISMATCH',
    () =>
      markRegistrationSubmitted(
        submitted,
        {
          resultId: 'result_2',
          submittedAt:
            new Date(
              '2026-09-20T02:20:00.000Z'
            )
        }
      )
  );
});

test('submitted resolve resultado passed', () => {
  const finalizedAt =
    new Date(
      '2026-09-20T02:25:00.000Z'
    );

  const submitted =
    markRegistrationSubmitted(
      started(),
      {
        resultId: 'result_1',
        submittedAt:
          new Date(
            '2026-09-20T02:20:00.000Z'
          )
      }
    );

  const passed =
    markRegistrationOutcome(
      submitted,
      {
        resultId: 'result_1',
        outcome: 'passed',
        finalizedAt
      }
    );

  assert.equal(
    passed.status,
    'passed'
  );

  assert.equal(
    passed.resultId,
    'result_1'
  );

  assert.equal(
    passed.updatedAt,
    finalizedAt
  );
});

test('submitted resolve resultado failed', () => {
  const submitted =
    markRegistrationSubmitted(
      started(),
      {
        resultId: 'result_1',
        submittedAt:
          new Date(
            '2026-09-20T02:20:00.000Z'
          )
      }
    );

  const failed =
    markRegistrationOutcome(
      submitted,
      {
        resultId: 'result_1',
        outcome: 'failed',
        finalizedAt:
          new Date(
            '2026-09-20T02:25:00.000Z'
          )
      }
    );

  assert.equal(
    failed.status,
    'failed'
  );

  assert.equal(
    failed.resultId,
    'result_1'
  );
});

test('outcome exige submitted e nao troca estado final', () => {
  expectCode(
    'EXAM_REGISTRATION_OUTCOME_STATE_REQUIRED',
    () =>
      markRegistrationOutcome(
        started(),
        {
          resultId: 'result_1',
          outcome: 'passed',
          finalizedAt:
            new Date(
              '2026-09-20T02:25:00.000Z'
            )
        }
      )
  );

  const submitted =
    markRegistrationSubmitted(
      started(),
      {
        resultId: 'result_1',
        submittedAt:
          new Date(
            '2026-09-20T02:20:00.000Z'
          )
      }
    );

  const passed =
    markRegistrationOutcome(
      submitted,
      {
        resultId: 'result_1',
        outcome: 'passed',
        finalizedAt:
          new Date(
            '2026-09-20T02:25:00.000Z'
          )
      }
    );

  expectCode(
    'EXAM_REGISTRATION_OUTCOME_STATE_REQUIRED',
    () =>
      markRegistrationOutcome(
        passed,
        {
          resultId: 'result_1',
          outcome: 'failed',
          finalizedAt:
            new Date(
              '2026-09-20T02:30:00.000Z'
            )
        }
      )
  );
});

test('estado started exige attemptId', () => {
  expectCode('EXAM_REGISTRATION_ATTEMPT_REQUIRED', () =>
    validateExamRegistration({
      ...authorized(),
      status: 'started'
    })
  );
});

test('estado passed exige resultId e certified exige certificateId', () => {
  expectCode('EXAM_REGISTRATION_RESULT_REQUIRED', () =>
    validateExamRegistration({
      ...authorized(),
      status: 'passed',
      attemptId: 'attempt_1'
    })
  );

  expectCode('EXAM_REGISTRATION_CERTIFICATE_REQUIRED', () =>
    validateExamRegistration({
      ...authorized(),
      status: 'certified',
      attemptId: 'attempt_1',
      resultId: 'result_1'
    })
  );
});

function finalRegistrationForCertificate(
  outcome = 'passed'
) {
  const submitted =
    markRegistrationSubmitted(
      started(),
      {
        resultId:
          'result_1',
        submittedAt:
          new Date(
            '2026-09-20T02:20:00.000Z'
          )
      }
    );

  return markRegistrationOutcome(
    submitted,
    {
      resultId:
        'result_1',
      outcome,
      finalizedAt:
        new Date(
          '2026-09-20T02:25:00.000Z'
        )
    }
  );
}

test(
  'passed transiciona para certified preservando cadeia canonica',
  () => {
    const source =
      finalRegistrationForCertificate(
        'passed'
      );

    const certifiedAt =
      new Date(
        '2026-09-20T02:30:00.000Z'
      );

    const certified =
      markRegistrationCertified(
        source,
        {
          certificateId:
            'certificate_1',
          certifiedAt
        }
      );

    assert.equal(
      certified.status,
      'certified'
    );

    assert.equal(
      certified.certificateId,
      'certificate_1'
    );

    assert.equal(
      certified.resultId,
      source.resultId
    );

    assert.equal(
      certified.attemptId,
      source.attemptId
    );

    assert.equal(
      certified.orderId,
      source.orderId
    );

    assert.equal(
      certified.updatedAt,
      certifiedAt
    );
  }
);

test(
  'retry certified com mesmo certificateId e idempotente',
  () => {
    const certifiedAt =
      new Date(
        '2026-09-20T02:30:00.000Z'
      );

    const certified =
      markRegistrationCertified(
        finalRegistrationForCertificate(
          'passed'
        ),
        {
          certificateId:
            'certificate_1',
          certifiedAt
        }
      );

    const retry =
      markRegistrationCertified(
        certified,
        {
          certificateId:
            'certificate_1',
          certifiedAt:
            new Date(
              '2026-09-20T02:35:00.000Z'
            )
        }
      );

    assert.equal(
      retry.status,
      'certified'
    );

    assert.equal(
      retry.certificateId,
      'certificate_1'
    );

    assert.equal(
      retry.updatedAt,
      certifiedAt
    );
  }
);

test(
  'retry certified rejeita outro certificateId',
  () => {
    const certified =
      markRegistrationCertified(
        finalRegistrationForCertificate(
          'passed'
        ),
        {
          certificateId:
            'certificate_1',
          certifiedAt:
            new Date(
              '2026-09-20T02:30:00.000Z'
            )
        }
      );

    expectCode(
      'EXAM_REGISTRATION_CERTIFICATE_MISMATCH',
      () =>
        markRegistrationCertified(
          certified,
          {
            certificateId:
              'certificate_2',
            certifiedAt:
              new Date(
                '2026-09-20T02:35:00.000Z'
              )
          }
        )
    );
  }
);

test(
  'failed nao pode transicionar para certified',
  () => {
    expectCode(
      'EXAM_REGISTRATION_CERTIFY_STATE_REQUIRED',
      () =>
        markRegistrationCertified(
          finalRegistrationForCertificate(
            'failed'
          ),
          {
            certificateId:
              'certificate_1',
            certifiedAt:
              new Date(
                '2026-09-20T02:30:00.000Z'
              )
          }
        )
    );
  }
);

test(
  'submitted nao pode transicionar diretamente para certified',
  () => {
    const submitted =
      markRegistrationSubmitted(
        started(),
        {
          resultId:
            'result_1',
          submittedAt:
            new Date(
              '2026-09-20T02:20:00.000Z'
            )
        }
      );

    expectCode(
      'EXAM_REGISTRATION_CERTIFY_STATE_REQUIRED',
      () =>
        markRegistrationCertified(
          submitted,
          {
            certificateId:
              'certificate_1',
            certifiedAt:
              new Date(
                '2026-09-20T02:30:00.000Z'
              )
          }
        )
    );
  }
);

test(
  'needs_reconciliation nao pode transicionar para certified',
  () => {
    const reconciliation =
      markRegistrationNeedsReconciliation(
        finalRegistrationForCertificate(
          'passed'
        ),
        {
          orderId:
            'order_1',
          updatedAt:
            new Date(
              '2026-09-20T02:30:00.000Z'
            )
        }
      );

    expectCode(
      'EXAM_REGISTRATION_CERTIFY_STATE_REQUIRED',
      () =>
        markRegistrationCertified(
          reconciliation,
          {
            certificateId:
              'certificate_1',
            certifiedAt:
              new Date(
                '2026-09-20T02:35:00.000Z'
              )
          }
        )
    );
  }
);

console.log(
  `EXAM_REGISTRATION_DOMAIN_V1_2=${passed}/37`
);

if (passed !== 37) {
  process.exitCode = 1;
}
