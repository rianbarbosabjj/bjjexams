'use strict';

const crypto = require('crypto');

const EXAM_RESULT_VERSION = 1;

const EXAM_RESULT_OUTCOMES =
  Object.freeze([
    'passed',
    'failed'
  ]);

class ExamResultDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamResultDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized
    ? normalized.slice(0, max)
    : null;
}

function requiredIdentifier(
  value,
  field
) {
  const id =
    text(value, 200);

  if (
    !id ||
    id.includes('/')
  ) {
    throw new ExamResultDomainError(
      'INVALID_EXAM_RESULT_IDENTIFIER',
      `${field} inválido.`
    );
  }

  return id;
}

function requiredTimestamp(
  value,
  field
) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new ExamResultDomainError(
      'EXAM_RESULT_TIMESTAMP_REQUIRED',
      `${field} é obrigatório.`
    );
  }

  let millis =
    Number.NaN;

  if (value instanceof Date) {
    millis =
      value.getTime();
  } else if (
    value &&
    typeof value.toMillis ===
      'function'
  ) {
    millis =
      Number(
        value.toMillis()
      );
  } else if (
    value &&
    typeof value.toDate ===
      'function'
  ) {
    const date =
      value.toDate();

    if (
      date instanceof Date
    ) {
      millis =
        date.getTime();
    }
  }

  if (!Number.isFinite(millis)) {
    throw new ExamResultDomainError(
      'INVALID_EXAM_RESULT_TIMESTAMP',
      `${field} inválido.`
    );
  }

  return value;
}

function integerInRange(
  value,
  field,
  min,
  max
) {
  const number =
    Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  ) {
    throw new ExamResultDomainError(
      'INVALID_EXAM_RESULT_NUMBER',
      `${field} inválido.`
    );
  }

  return number;
}

function examResultDocumentId(
  attemptIdInput
) {
  const attemptId =
    requiredIdentifier(
      attemptIdInput,
      'attemptId'
    );

  return crypto
    .createHash('sha256')
    .update(
      `exam-result-v1:${attemptId}`
    )
    .digest('hex');
}

function normalizeAnswerMap(
  answersInput
) {
  if (
    answersInput === undefined ||
    answersInput === null
  ) {
    return {};
  }

  if (
    typeof answersInput !==
      'object' ||
    Array.isArray(answersInput)
  ) {
    throw new ExamResultDomainError(
      'INVALID_EXAM_ANSWERS',
      'answers precisa ser objeto.'
    );
  }

  const normalized = {};

  for (
    const [
      questionIdInput,
      answerInput
    ] of Object.entries(
      answersInput
    )
  ) {
    const questionId =
      requiredIdentifier(
        questionIdInput,
        'questionId'
      );

    if (
      answerInput === undefined ||
      answerInput === null ||
      String(answerInput)
        .trim() === ''
    ) {
      continue;
    }

    const answer =
      String(answerInput)
        .trim()
        .toUpperCase();

    if (
      !/^[A-D]$/.test(answer)
    ) {
      throw new ExamResultDomainError(
        'INVALID_EXAM_ANSWER',
        `Resposta inválida para ${questionId}.`
      );
    }

    normalized[questionId] =
      answer;
  }

  return normalized;
}

function scoreExamAnswers(
  input = {}
) {
  const questionIds =
    input.questionIds;

  const answerKey =
    input.answerKey;

  const passingScoreBps =
    integerInRange(
      input.passingScoreBps,
      'passingScoreBps',
      0,
      10000
    );

  if (
    !Array.isArray(questionIds) ||
    questionIds.length === 0
  ) {
    throw new ExamResultDomainError(
      'EXAM_RESULT_QUESTIONS_REQUIRED',
      'Scoring exige questões.'
    );
  }

  if (
    !answerKey ||
    typeof answerKey !==
      'object' ||
    Array.isArray(answerKey)
  ) {
    throw new ExamResultDomainError(
      'INVALID_EXAM_ANSWER_KEY',
      'answerKey inválido.'
    );
  }

  const orderedQuestionIds = [];
  const seen = new Set();

  for (
    const questionIdInput of
      questionIds
  ) {
    const questionId =
      requiredIdentifier(
        questionIdInput,
        'questionId'
      );

    if (seen.has(questionId)) {
      throw new ExamResultDomainError(
        'DUPLICATE_EXAM_RESULT_QUESTION',
        'questionIds não pode possuir duplicatas.'
      );
    }

    seen.add(questionId);
    orderedQuestionIds.push(
      questionId
    );
  }

  const answers =
    normalizeAnswerMap(
      input.answers
    );

  for (
    const submittedQuestionId of
      Object.keys(answers)
  ) {
    if (
      !seen.has(
        submittedQuestionId
      )
    ) {
      throw new ExamResultDomainError(
        'UNKNOWN_EXAM_ANSWER_QUESTION',
        `Resposta enviada para questão fora da tentativa: ${submittedQuestionId}.`
      );
    }
  }

  let correctCount = 0;

  for (
    const questionId of
      orderedQuestionIds
  ) {
    const expected =
      String(
        answerKey[questionId] ||
        ''
      )
        .trim()
        .toUpperCase();

    if (
      !/^[A-D]$/.test(expected)
    ) {
      throw new ExamResultDomainError(
        'INVALID_EXAM_ANSWER_KEY',
        `Gabarito inválido para ${questionId}.`
      );
    }

    if (
      answers[questionId] ===
        expected
    ) {
      correctCount += 1;
    }
  }

  const totalQuestions =
    orderedQuestionIds.length;

  const scoreBps =
    Math.floor(
      (
        correctCount *
        10000
      ) /
      totalQuestions
    );

  const outcome =
    scoreBps >=
      passingScoreBps
      ? 'passed'
      : 'failed';

  return {
    scoreBps,
    correctCount,
    totalQuestions,
    outcome,
    certificateEligible:
      outcome === 'passed'
  };
}

function normalizeExamResult(
  input = {}
) {
  return {
    resultVersion:
      Number(
        input.resultVersion
      ),
    attemptId:
      text(
        input.attemptId,
        200
      ),
    registrationId:
      text(
        input.registrationId,
        200
      ),
    sessionId:
      text(
        input.sessionId,
        200
      ),
    organizationId:
      text(
        input.organizationId,
        200
      ),
    studentId:
      text(
        input.studentId,
        200
      ),
    templateId:
      text(
        input.templateId,
        200
      ),
    templateVersionId:
      text(
        input.templateVersionId,
        200
      ),
    targetBelt:
      text(
        input.targetBelt,
        40
      ),
    scoreBps:
      Number(
        input.scoreBps
      ),
    correctCount:
      Number(
        input.correctCount
      ),
    totalQuestions:
      Number(
        input.totalQuestions
      ),
    outcome:
      text(
        input.outcome,
        40
      )?.toLowerCase() ||
      null,
    reason:
      text(
        input.reason,
        120
      ),
    certificateEligible:
      input.certificateEligible,
    finalizedAt:
      input.finalizedAt ?? null
  };
}

function validateExamResult(
  input = {}
) {
  const result =
    normalizeExamResult(
      input
    );

  if (
    result.resultVersion !==
      EXAM_RESULT_VERSION
  ) {
    throw new ExamResultDomainError(
      'INVALID_EXAM_RESULT_VERSION',
      'resultVersion inválido.'
    );
  }

  result.attemptId =
    requiredIdentifier(
      result.attemptId,
      'attemptId'
    );

  result.registrationId =
    requiredIdentifier(
      result.registrationId,
      'registrationId'
    );

  result.sessionId =
    requiredIdentifier(
      result.sessionId,
      'sessionId'
    );

  result.organizationId =
    requiredIdentifier(
      result.organizationId,
      'organizationId'
    );

  result.studentId =
    requiredIdentifier(
      result.studentId,
      'studentId'
    );

  result.templateId =
    requiredIdentifier(
      result.templateId,
      'templateId'
    );

  result.templateVersionId =
    requiredIdentifier(
      result.templateVersionId,
      'templateVersionId'
    );

  result.targetBelt =
    requiredIdentifier(
      result.targetBelt,
      'targetBelt'
    );

  result.scoreBps =
    integerInRange(
      result.scoreBps,
      'scoreBps',
      0,
      10000
    );

  result.totalQuestions =
    integerInRange(
      result.totalQuestions,
      'totalQuestions',
      1,
      500
    );

  result.correctCount =
    integerInRange(
      result.correctCount,
      'correctCount',
      0,
      result.totalQuestions
    );

  if (
    !EXAM_RESULT_OUTCOMES.includes(
      result.outcome
    )
  ) {
    throw new ExamResultDomainError(
      'INVALID_EXAM_RESULT_OUTCOME',
      'outcome inválido.'
    );
  }

  if (
    typeof
      result.certificateEligible !==
      'boolean'
  ) {
    throw new ExamResultDomainError(
      'INVALID_EXAM_RESULT_CERTIFICATE_ELIGIBILITY',
      'certificateEligible precisa ser boolean.'
    );
  }

  if (
    result.certificateEligible !==
      (
        result.outcome ===
          'passed'
      )
  ) {
    throw new ExamResultDomainError(
      'EXAM_RESULT_CERTIFICATE_ELIGIBILITY_MISMATCH',
      'Elegibilidade de certificado não corresponde ao resultado.'
    );
  }

  result.finalizedAt =
    requiredTimestamp(
      result.finalizedAt,
      'finalizedAt'
    );

  if (!result.reason) {
    throw new ExamResultDomainError(
      'EXAM_RESULT_REASON_REQUIRED',
      'reason é obrigatório.'
    );
  }

  return result;
}

function buildExamResult(
  input = {}
) {
  const score =
    scoreExamAnswers({
      questionIds:
        input.questionIds,
      answerKey:
        input.answerKey,
      answers:
        input.answers,
      passingScoreBps:
        input.passingScoreBps
    });

  return validateExamResult({
    resultVersion:
      EXAM_RESULT_VERSION,
    attemptId:
      input.attemptId,
    registrationId:
      input.registrationId,
    sessionId:
      input.sessionId,
    organizationId:
      input.organizationId,
    studentId:
      input.studentId,
    templateId:
      input.templateId,
    templateVersionId:
      input.templateVersionId,
    targetBelt:
      input.targetBelt,
    scoreBps:
      score.scoreBps,
    correctCount:
      score.correctCount,
    totalQuestions:
      score.totalQuestions,
    outcome:
      score.outcome,
    reason:
      score.outcome ===
        'passed'
        ? 'score_passed'
        : 'score_failed',
    certificateEligible:
      score.certificateEligible,
    finalizedAt:
      input.finalizedAt
  });
}

function assertExamResultDocumentIdentity(
  resultIdInput,
  resultInput
) {
  const resultId =
    requiredIdentifier(
      resultIdInput,
      'resultId'
    );

  const result =
    validateExamResult(
      resultInput
    );

  const expected =
    examResultDocumentId(
      result.attemptId
    );

  if (
    resultId !== expected
  ) {
    throw new ExamResultDomainError(
      'EXAM_RESULT_ID_MISMATCH',
      'resultId não corresponde à tentativa.'
    );
  }

  return result;
}

function publicExamResult(
  resultIdInput,
  resultInput
) {
  const result =
    assertExamResultDocumentIdentity(
      resultIdInput,
      resultInput
    );

  return {
    resultId:
      requiredIdentifier(
        resultIdInput,
        'resultId'
      ),
    status:
      result.outcome,
    scoreBps:
      result.scoreBps,
    correctCount:
      result.correctCount,
    totalQuestions:
      result.totalQuestions,
    certificateEligible:
      result.certificateEligible,
    finalizedAt:
      result.finalizedAt
  };
}

module.exports = {
  EXAM_RESULT_VERSION,
  EXAM_RESULT_OUTCOMES,
  ExamResultDomainError,
  examResultDocumentId,
  normalizeAnswerMap,
  scoreExamAnswers,
  normalizeExamResult,
  validateExamResult,
  buildExamResult,
  assertExamResultDocumentIdentity,
  publicExamResult
};