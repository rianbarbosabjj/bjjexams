'use strict';

const assert =
  require('node:assert/strict');

const {
  ExamResultDomainError,
  examResultDocumentId,
  normalizeAnswerMap,
  scoreExamAnswers,
  validateExamResult,
  buildExamResult,
  assertExamResultDocumentIdentity,
  publicExamResult
} = require('../src/exams/exam-result-domain');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(
      `PASS | ${name}`
    );
  } catch (error) {
    console.error(
      `FAIL | ${name}`
    );
    throw error;
  }
}

function expectCode(
  code,
  fn
) {
  assert.throws(
    fn,
    error => {
      assert.ok(
        error instanceof
          ExamResultDomainError
      );

      assert.equal(
        error.code,
        code
      );

      return true;
    }
  );
}

const finalizedAt =
  new Date(
    '2026-09-22T18:00:00.000Z'
  );

const questionIds = [
  'question_1',
  'question_2',
  'question_3'
];

const answerKey = {
  question_1: 'A',
  question_2: 'B',
  question_3: 'C'
};

function baseResult(
  overrides = {}
) {
  return {
    resultVersion: 1,
    attemptId:
      'attempt_1',
    registrationId:
      'registration_1',
    sessionId:
      'session_1',
    organizationId:
      'organization_1',
    studentId:
      'student_1',
    templateId:
      'template_1',
    templateVersionId:
      'v0000001',
    targetBelt:
      'Azul',
    scoreBps:
      6666,
    correctCount:
      2,
    totalQuestions:
      3,
    outcome:
      'failed',
    reason:
      'score_failed',
    certificateEligible:
      false,
    finalizedAt,
    ...overrides
  };
}

test(
  'result id e deterministico por attempt',
  () => {
    const first =
      examResultDocumentId(
        'attempt_1'
      );

    const second =
      examResultDocumentId(
        'attempt_1'
      );

    const other =
      examResultDocumentId(
        'attempt_2'
      );

    assert.equal(
      first,
      second
    );

    assert.notEqual(
      first,
      other
    );

    assert.match(
      first,
      /^[a-f0-9]{64}$/
    );
  }
);

test(
  'answers normaliza labels e remove ausentes',
  () => {
    assert.deepEqual(
      normalizeAnswerMap({
        question_1:
          ' a ',
        question_2:
          null,
        question_3:
          ''
      }),
      {
        question_1:
          'A'
      }
    );
  }
);

test(
  'answers rejeita label fora de A a D',
  () => {
    expectCode(
      'INVALID_EXAM_ANSWER',
      () =>
        normalizeAnswerMap({
          question_1:
            'E'
        })
    );
  }
);

test(
  'scoring considera resposta ausente incorreta',
  () => {
    const scored =
      scoreExamAnswers({
        questionIds,
        answerKey,
        answers: {
          question_1:
            'A',
          question_2:
            'B'
        },
        passingScoreBps:
          7000
      });

    assert.equal(
      scored.correctCount,
      2
    );

    assert.equal(
      scored.totalQuestions,
      3
    );

    assert.equal(
      scored.scoreBps,
      6666
    );

    assert.equal(
      scored.outcome,
      'failed'
    );

    assert.equal(
      scored.certificateEligible,
      false
    );
  }
);

test(
  'scoring aprova exatamente no threshold',
  () => {
    const scored =
      scoreExamAnswers({
        questionIds: [
          'q1',
          'q2'
        ],
        answerKey: {
          q1: 'A',
          q2: 'B'
        },
        answers: {
          q1: 'A'
        },
        passingScoreBps:
          5000
      });

    assert.equal(
      scored.scoreBps,
      5000
    );

    assert.equal(
      scored.outcome,
      'passed'
    );

    assert.equal(
      scored.certificateEligible,
      true
    );
  }
);

test(
  'scoring rejeita question id estranho',
  () => {
    expectCode(
      'UNKNOWN_EXAM_ANSWER_QUESTION',
      () =>
        scoreExamAnswers({
          questionIds,
          answerKey,
          answers: {
            question_4:
              'A'
          },
          passingScoreBps:
            7000
        })
    );
  }
);

test(
  'scoring rejeita gabarito ausente ou invalido',
  () => {
    expectCode(
      'INVALID_EXAM_ANSWER_KEY',
      () =>
        scoreExamAnswers({
          questionIds,
          answerKey: {
            question_1:
              'A',
            question_2:
              'B'
          },
          answers: {},
          passingScoreBps:
            7000
        })
    );
  }
);

test(
  'build cria resultado canonico failed',
  () => {
    const result =
      buildExamResult({
        attemptId:
          'attempt_1',
        registrationId:
          'registration_1',
        sessionId:
          'session_1',
        organizationId:
          'organization_1',
        studentId:
          'student_1',
        templateId:
          'template_1',
        templateVersionId:
          'v0000001',
        targetBelt:
          'Azul',
        questionIds,
        answerKey,
        answers: {
          question_1:
            'A',
          question_2:
            'B'
        },
        passingScoreBps:
          7000,
        finalizedAt
      });

    assert.equal(
      result.outcome,
      'failed'
    );

    assert.equal(
      result.reason,
      'score_failed'
    );

    assert.equal(
      result.scoreBps,
      6666
    );
  }
);

test(
  'build cria resultado canonico passed',
  () => {
    const result =
      buildExamResult({
        attemptId:
          'attempt_1',
        registrationId:
          'registration_1',
        sessionId:
          'session_1',
        organizationId:
          'organization_1',
        studentId:
          'student_1',
        templateId:
          'template_1',
        templateVersionId:
          'v0000001',
        targetBelt:
          'Azul',
        questionIds,
        answerKey,
        answers: {
          question_1:
            'A',
          question_2:
            'B',
          question_3:
            'C'
        },
        passingScoreBps:
          7000,
        finalizedAt
      });

    assert.equal(
      result.outcome,
      'passed'
    );

    assert.equal(
      result.certificateEligible,
      true
    );

    assert.equal(
      result.scoreBps,
      10000
    );
  }
);

test(
  'resultado rejeita certificate eligibility divergente',
  () => {
    expectCode(
      'EXAM_RESULT_CERTIFICATE_ELIGIBILITY_MISMATCH',
      () =>
        validateExamResult(
          baseResult({
            certificateEligible:
              true
          })
        )
    );
  }
);

test(
  'resultado rejeita correctCount acima do total',
  () => {
    expectCode(
      'INVALID_EXAM_RESULT_NUMBER',
      () =>
        validateExamResult(
          baseResult({
            correctCount:
              4
          })
        )
    );
  }
);

test(
  'document identity converge para attempt',
  () => {
    const result =
      validateExamResult(
        baseResult()
      );

    const resultId =
      examResultDocumentId(
        result.attemptId
      );

    assert.equal(
      assertExamResultDocumentIdentity(
        resultId,
        result
      ).attemptId,
      'attempt_1'
    );

    expectCode(
      'EXAM_RESULT_ID_MISMATCH',
      () =>
        assertExamResultDocumentIdentity(
          examResultDocumentId(
            'attempt_2'
          ),
          result
        )
    );
  }
);

test(
  'view publica expoe apenas resultado academico necessario',
  () => {
    const result =
      validateExamResult(
        baseResult()
      );

    const view =
      publicExamResult(
        examResultDocumentId(
          result.attemptId
        ),
        result
      );

    assert.equal(
      view.status,
      'failed'
    );

    assert.equal(
      view.scoreBps,
      6666
    );

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
        'reason'
      ]
    ) {
      assert.equal(
        Object.hasOwn(
          view,
          forbidden
        ),
        false
      );
    }
  }
);

test(
  'view publica normaliza timestamp persistido para Date',
  () => {
    const timestampLike = {
      toMillis: () =>
        finalizedAt.getTime()
    };

    const result =
      validateExamResult(
        baseResult({
          finalizedAt:
            timestampLike
        })
      );

    const view =
      publicExamResult(
        examResultDocumentId(
          result.attemptId
        ),
        result
      );

    assert.ok(
      view.finalizedAt
        instanceof Date
    );

    assert.equal(
      view.finalizedAt.getTime(),
      finalizedAt.getTime()
    );
  }
);

test(
  'resultado exige reason e timestamp final',
  () => {
    expectCode(
      'EXAM_RESULT_REASON_REQUIRED',
      () =>
        validateExamResult(
          baseResult({
            reason:
              null
          })
        )
    );

    expectCode(
      'EXAM_RESULT_TIMESTAMP_REQUIRED',
      () =>
        validateExamResult(
          baseResult({
            finalizedAt:
              null
          })
        )
    );
  }
);

console.log(
  `EXAM_RESULT_DOMAIN_V1_2=${passed}/15`
);