'use strict';

const assert = require('node:assert/strict');
const {
  ExamAttemptDomainError,
  examAttemptDocumentId,
  validateExamAttempt,
  assertExamAttemptDocumentIdentity,
  assertExamAttemptStatusTransition,
  buildInProgressExamAttempt,
  markExamAttemptSubmitted,
  assertExamAttemptResumeEligible,
  publicExamAttempt
} = require('../src/exams/exam-attempt-domain');

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
    assert.ok(
      error instanceof ExamAttemptDomainError
    );
    assert.equal(error.code, code);
    return true;
  });
}

const t0 =
  new Date('2026-09-22T12:00:00.000Z');

const t1 =
  new Date('2026-09-22T12:30:00.000Z');

const t2 =
  new Date('2026-09-22T12:10:00.000Z');

function inProgress(overrides = {}) {
  return buildInProgressExamAttempt({
    registrationId: 'registration_1',
    sessionId: 'session_1',
    organizationId: 'org_1',
    studentId: 'student_1',
    templateId: 'template_1',
    templateVersionId: 'v0000001',
    orderedQuestionIds: [
      'question_1',
      'question_2'
    ],
    startedAt: t0,
    expiresAt: t1,
    ...overrides
  });
}

test(
  'attempt id e deterministico pela registration',
  () => {
    const first =
      examAttemptDocumentId(
        'registration_1'
      );

    const second =
      examAttemptDocumentId(
        'registration_1'
      );

    const other =
      examAttemptDocumentId(
        'registration_2'
      );

    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.match(first, /^[a-f0-9]{64}$/);
  }
);

test(
  'build cria tentativa canonica em andamento',
  () => {
    const attempt = inProgress();

    assert.equal(
      attempt.registrationId,
      'registration_1'
    );

    assert.equal(
      attempt.status,
      'in_progress'
    );

    assert.deepEqual(
      attempt.orderedQuestionIds,
      ['question_1', 'question_2']
    );

    assert.equal(
      attempt.startedAt,
      t0
    );

    assert.equal(
      attempt.expiresAt,
      t1
    );

    assert.equal(
      attempt.resultId,
      null
    );
  }
);

test(
  'document identity converge para registration',
  () => {
    const attempt = inProgress();

    const attemptId =
      examAttemptDocumentId(
        attempt.registrationId
      );

    assert.equal(
      assertExamAttemptDocumentIdentity(
        attemptId,
        attempt
      ).registrationId,
      'registration_1'
    );

    expectCode(
      'EXAM_ATTEMPT_ID_MISMATCH',
      () =>
        assertExamAttemptDocumentIdentity(
          examAttemptDocumentId(
            'registration_2'
          ),
          attempt
        )
    );
  }
);

test(
  'identificadores com barra sao rejeitados',
  () => {
    expectCode(
      'INVALID_EXAM_ATTEMPT_IDENTIFIER',
      () =>
        inProgress({
          sessionId: 'bad/session'
        })
    );
  }
);

test(
  'tentativa exige lista de questoes',
  () => {
    expectCode(
      'EXAM_ATTEMPT_QUESTIONS_REQUIRED',
      () =>
        inProgress({
          orderedQuestionIds: []
        })
    );
  }
);

test(
  'ordem de questoes nao aceita duplicata',
  () => {
    expectCode(
      'DUPLICATE_EXAM_ATTEMPT_QUESTION',
      () =>
        inProgress({
          orderedQuestionIds: [
            'question_1',
            'question_1'
          ]
        })
    );
  }
);

test(
  'question id precisa ser identificador valido',
  () => {
    expectCode(
      'INVALID_EXAM_ATTEMPT_IDENTIFIER',
      () =>
        inProgress({
          orderedQuestionIds: [
            'question/1'
          ]
        })
    );
  }
);

test(
  'expiresAt precisa ser posterior ao inicio',
  () => {
    expectCode(
      'INVALID_EXAM_ATTEMPT_EXPIRATION',
      () =>
        inProgress({
          expiresAt: t0
        })
    );
  }
);

test(
  'in progress nao pode carregar resultado',
  () => {
    expectCode(
      'IN_PROGRESS_EXAM_ATTEMPT_RESULT_NOT_ALLOWED',
      () =>
        validateExamAttempt({
          ...inProgress(),
          resultId: 'result_1'
        })
    );
  }
);

test(
  'submitted exige submittedAt e resultId',
  () => {
    expectCode(
      'EXAM_ATTEMPT_TIMESTAMP_REQUIRED',
      () =>
        validateExamAttempt({
          ...inProgress(),
          status: 'submitted',
          resultId: 'result_1'
        })
    );

    expectCode(
      'SUBMITTED_EXAM_ATTEMPT_RESULT_REQUIRED',
      () =>
        validateExamAttempt({
          ...inProgress(),
          status: 'submitted',
          submittedAt: t2,
          updatedAt: t2
        })
    );
  }
);

test(
  'submitted canonico aceita resultado e timestamp',
  () => {
    const attempt =
      validateExamAttempt({
        ...inProgress(),
        status: 'submitted',
        submittedAt: t2,
        resultId: 'result_1',
        updatedAt: t2
      });

    assert.equal(
      attempt.status,
      'submitted'
    );

    assert.equal(
      attempt.resultId,
      'result_1'
    );
  }
);

test(
  'submit transforma tentativa em submitted',
  () => {
    const submitted =
      markExamAttemptSubmitted(
        inProgress(),
        {
          resultId: 'result_1',
          submittedAt: t2
        }
      );

    assert.equal(
      submitted.status,
      'submitted'
    );

    assert.equal(
      submitted.resultId,
      'result_1'
    );

    assert.equal(
      submitted.submittedAt,
      t2
    );

    assert.equal(
      submitted.updatedAt,
      t2
    );
  }
);

test(
  'retry do submit com mesmo resultId e idempotente',
  () => {
    const submitted =
      markExamAttemptSubmitted(
        inProgress(),
        {
          resultId: 'result_1',
          submittedAt: t2
        }
      );

    const retry =
      markExamAttemptSubmitted(
        submitted,
        {
          resultId: 'result_1',
          submittedAt:
            new Date(
              '2026-09-22T12:20:00.000Z'
            )
        }
      );

    assert.equal(
      retry.resultId,
      'result_1'
    );

    assert.equal(
      retry.submittedAt,
      t2
    );

    assert.equal(
      retry.updatedAt,
      t2
    );
  }
);

test(
  'retry do submit rejeita outro resultId',
  () => {
    const submitted =
      markExamAttemptSubmitted(
        inProgress(),
        {
          resultId: 'result_1',
          submittedAt: t2
        }
      );

    expectCode(
      'EXAM_ATTEMPT_RESULT_MISMATCH',
      () =>
        markExamAttemptSubmitted(
          submitted,
          {
            resultId: 'result_2',
            submittedAt: t2
          }
        )
    );
  }
);

test(
  'submit no instante de expiracao e bloqueado',
  () => {
    expectCode(
      'EXAM_ATTEMPT_SUBMISSION_EXPIRED',
      () =>
        markExamAttemptSubmitted(
          inProgress(),
          {
            resultId: 'result_1',
            submittedAt: t1
          }
        )
    );
  }
);

test(
  'submit exige tentativa in progress',
  () => {
    expectCode(
      'EXAM_ATTEMPT_SUBMIT_STATE_REQUIRED',
      () =>
        markExamAttemptSubmitted(
          {
            ...inProgress(),
            status: 'invalidated',
            updatedAt: t2
          },
          {
            resultId: 'result_1',
            submittedAt: t2
          }
        )
    );
  }
);

test(
  'maquina permite in progress para submitted',
  () => {
    assert.equal(
      assertExamAttemptStatusTransition(
        'in_progress',
        'submitted'
      ),
      true
    );
  }
);

test(
  'maquina bloqueia retorno submitted para in progress',
  () => {
    expectCode(
      'INVALID_EXAM_ATTEMPT_TRANSITION',
      () =>
        assertExamAttemptStatusTransition(
          'submitted',
          'in_progress'
        )
    );
  }
);

test(
  'resume e permitido antes da expiracao',
  () => {
    const attempt =
      assertExamAttemptResumeEligible(
        inProgress(),
        {
          now: t2
        }
      );

    assert.equal(
      attempt.status,
      'in_progress'
    );
  }
);

test(
  'resume bloqueia tentativa expirada e view e sanitizada',
  () => {
    expectCode(
      'EXAM_ATTEMPT_EXPIRED',
      () =>
        assertExamAttemptResumeEligible(
          inProgress(),
          {
            now: t1
          }
        )
    );

    const attempt = inProgress();

    const view =
      publicExamAttempt(
        examAttemptDocumentId(
          attempt.registrationId
        ),
        attempt
      );

    assert.equal(
      view.status,
      'in_progress'
    );

    assert.equal(
      Object.hasOwn(
        view,
        'orderedQuestionIds'
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        view,
        'studentId'
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        view,
        'organizationId'
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        view,
        'templateId'
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        view,
        'templateVersionId'
      ),
      false
    );

    assert.equal(
      JSON.stringify(view).includes(
        'correctAnswer'
      ),
      false
    );
  }
);

console.log(
  `EXAM_ATTEMPT_DOMAIN_V1_2=${passed}/20`
);