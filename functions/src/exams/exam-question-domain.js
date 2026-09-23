'use strict';

const crypto = require('crypto');

const EXAM_QUESTION_SNAPSHOT_VERSION = 1;

const EXAM_QUESTION_ALTERNATIVE_LABELS = Object.freeze([
  'A',
  'B',
  'C',
  'D'
]);

class ExamQuestionDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamQuestionDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, max);
}

function requiredText(value, field, max) {
  const normalized = text(value, max);

  if (!normalized) {
    throw new ExamQuestionDomainError(
      'EXAM_QUESTION_TEXT_REQUIRED',
      `${field} é obrigatório.`
    );
  }

  return normalized;
}

function requiredIdentifier(value, field) {
  const id = text(value, 200);

  if (!id || id.includes('/')) {
    throw new ExamQuestionDomainError(
      'INVALID_EXAM_QUESTION_IDENTIFIER',
      `${field} inválido.`
    );
  }

  return id;
}

function requiredTimestamp(value, field) {
  if (value === undefined || value === null) {
    throw new ExamQuestionDomainError(
      'EXAM_QUESTION_TIMESTAMP_REQUIRED',
      `${field} é obrigatório.`
    );
  }

  return value;
}

function timestampIdentity(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value.toMillis === 'function') {
    return String(value.toMillis());
  }

  if (value instanceof Date) {
    return String(value.getTime());
  }

  return String(value);
}

function requireDifficulty(value) {
  const difficulty = Number(value);

  if (
    !Number.isSafeInteger(difficulty) ||
    difficulty < 1 ||
    difficulty > 5
  ) {
    throw new ExamQuestionDomainError(
      'INVALID_EXAM_QUESTION_DIFFICULTY',
      'difficulty precisa ser inteiro entre 1 e 5.'
    );
  }

  return difficulty;
}

function normalizeAlternativeLabel(value) {
  const label = text(value, 10);

  if (!label) {
    return null;
  }

  return label.toUpperCase();
}

function validateAlternatives(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    throw new ExamQuestionDomainError(
      'INVALID_EXAM_QUESTION_ALTERNATIVES',
      'alternatives precisa ser um objeto.'
    );
  }

  const collected = {};

  for (const [rawLabel, rawValue] of Object.entries(input)) {
    const label = normalizeAlternativeLabel(rawLabel);

    if (!EXAM_QUESTION_ALTERNATIVE_LABELS.includes(label)) {
      throw new ExamQuestionDomainError(
        'INVALID_EXAM_QUESTION_ALTERNATIVE_LABEL',
        `Alternativa ${rawLabel} não é suportada.`
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        collected,
        label
      )
    ) {
      throw new ExamQuestionDomainError(
        'DUPLICATE_EXAM_QUESTION_ALTERNATIVE',
        `Alternativa ${label} está duplicada.`
      );
    }

    collected[label] = requiredText(
      rawValue,
      `alternatives.${label}`,
      1200
    );
  }

  if (Object.keys(collected).length < 2) {
    throw new ExamQuestionDomainError(
      'EXAM_QUESTION_ALTERNATIVES_REQUIRED',
      'A questão precisa possuir pelo menos duas alternativas.'
    );
  }

  const normalized = {};

  for (const label of EXAM_QUESTION_ALTERNATIVE_LABELS) {
    if (
      Object.prototype.hasOwnProperty.call(
        collected,
        label
      )
    ) {
      normalized[label] = collected[label];
    }
  }

  return normalized;
}

function requireCorrectAnswer(
  value,
  alternatives
) {
  const answer = normalizeAlternativeLabel(value);

  if (
    !answer ||
    !EXAM_QUESTION_ALTERNATIVE_LABELS.includes(answer)
  ) {
    throw new ExamQuestionDomainError(
      'INVALID_EXAM_QUESTION_CORRECT_ANSWER',
      'correctAnswer inválido.'
    );
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      alternatives,
      answer
    )
  ) {
    throw new ExamQuestionDomainError(
      'EXAM_QUESTION_CORRECT_ANSWER_NOT_PRESENT',
      'correctAnswer precisa apontar para uma alternativa existente.'
    );
  }

  return answer;
}

function safeHttpsUrl(value, field) {
  const raw = text(value, 2000);

  if (!raw) {
    return null;
  }

  let parsed;

  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new ExamQuestionDomainError(
      'INVALID_EXAM_QUESTION_MEDIA_URL',
      `${field} inválida.`
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new ExamQuestionDomainError(
      'INVALID_EXAM_QUESTION_MEDIA_URL',
      `${field} precisa usar HTTPS.`
    );
  }

  if (parsed.username || parsed.password) {
    throw new ExamQuestionDomainError(
      'INVALID_EXAM_QUESTION_MEDIA_URL',
      `${field} não pode conter credenciais.`
    );
  }

  return parsed.toString();
}

function normalizeMedia(input = {}) {
  if (
    input === null ||
    input === undefined
  ) {
    return {
      imageUrl: null,
      videoUrl: null
    };
  }

  if (
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    throw new ExamQuestionDomainError(
      'INVALID_EXAM_QUESTION_MEDIA',
      'media precisa ser objeto.'
    );
  }

  const allowedKeys = new Set([
    'imageUrl',
    'videoUrl'
  ]);

  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      throw new ExamQuestionDomainError(
        'INVALID_EXAM_QUESTION_MEDIA_FIELD',
        `Campo de media não suportado: ${key}.`
      );
    }
  }

  return {
    imageUrl: safeHttpsUrl(
      input.imageUrl,
      'media.imageUrl'
    ),
    videoUrl: safeHttpsUrl(
      input.videoUrl,
      'media.videoUrl'
    )
  };
}

function examQuestionSnapshotDocumentId(
  sourceQuestionIdInput
) {
  const sourceQuestionId = requiredIdentifier(
    sourceQuestionIdInput,
    'sourceQuestionId'
  );

  return crypto
    .createHash('sha256')
    .update(
      `exam-question-snapshot-v1:${sourceQuestionId}`
    )
    .digest('hex');
}

function normalizeExamQuestionSnapshot(
  input = {}
) {
  return {
    snapshotVersion: Number(
      input.snapshotVersion
    ),
    prompt: text(input.prompt, 4000),
    alternatives: input.alternatives,
    correctAnswer: input.correctAnswer ?? null,
    category: text(input.category, 120),
    difficulty: Number(input.difficulty),
    media: input.media ?? null,
    sourceQuestionId: text(
      input.sourceQuestionId,
      200
    ),
    createdAt: input.createdAt ?? null
  };
}

function validateExamQuestionSnapshot(
  input = {}
) {
  const question =
    normalizeExamQuestionSnapshot(input);

  if (
    question.snapshotVersion !==
    EXAM_QUESTION_SNAPSHOT_VERSION
  ) {
    throw new ExamQuestionDomainError(
      'INVALID_EXAM_QUESTION_SNAPSHOT_VERSION',
      'snapshotVersion inválido.'
    );
  }

  question.prompt = requiredText(
    question.prompt,
    'prompt',
    4000
  );

  question.alternatives = validateAlternatives(
    question.alternatives
  );

  question.correctAnswer = requireCorrectAnswer(
    question.correctAnswer,
    question.alternatives
  );

  question.category =
    question.category || 'Geral';

  question.difficulty = requireDifficulty(
    question.difficulty
  );

  question.media = normalizeMedia(
    question.media
  );

  question.sourceQuestionId =
    requiredIdentifier(
      question.sourceQuestionId,
      'sourceQuestionId'
    );

  requiredTimestamp(
    question.createdAt,
    'createdAt'
  );

  return question;
}

function buildExamQuestionSnapshot(
  input = {}
) {
  const createdAt = requiredTimestamp(
    input.timestamp,
    'timestamp'
  );

  return validateExamQuestionSnapshot({
    snapshotVersion:
      EXAM_QUESTION_SNAPSHOT_VERSION,
    prompt: input.prompt,
    alternatives: input.alternatives,
    correctAnswer: input.correctAnswer,
    category: input.category,
    difficulty: input.difficulty,
    media: input.media,
    sourceQuestionId: input.sourceQuestionId,
    createdAt
  });
}

function publicExamQuestion(
  snapshotIdInput,
  snapshotInput
) {
  const id = requiredIdentifier(
    snapshotIdInput,
    'snapshotId'
  );

  const snapshot =
    validateExamQuestionSnapshot(
      snapshotInput
    );

  return {
    id,
    prompt: snapshot.prompt,
    alternatives: {
      ...snapshot.alternatives
    },
    media: {
      imageUrl: snapshot.media.imageUrl,
      videoUrl: snapshot.media.videoUrl
    }
  };
}

function assertExamQuestionSnapshotImmutable(
  previousInput,
  nextInput
) {
  const previous =
    validateExamQuestionSnapshot(
      previousInput
    );

  const next =
    validateExamQuestionSnapshot(
      nextInput
    );

  const scalarFields = [
    'snapshotVersion',
    'prompt',
    'correctAnswer',
    'category',
    'difficulty',
    'sourceQuestionId'
  ];

  for (const field of scalarFields) {
    if (previous[field] !== next[field]) {
      throw new ExamQuestionDomainError(
        'IMMUTABLE_EXAM_QUESTION_SNAPSHOT',
        `Snapshot não permite alterar ${field}.`
      );
    }
  }

  if (
    timestampIdentity(previous.createdAt) !==
    timestampIdentity(next.createdAt)
  ) {
    throw new ExamQuestionDomainError(
      'IMMUTABLE_EXAM_QUESTION_SNAPSHOT',
      'Snapshot não permite alterar createdAt.'
    );
  }

  const previousAlternatives =
    JSON.stringify(previous.alternatives);

  const nextAlternatives =
    JSON.stringify(next.alternatives);

  if (
    previousAlternatives !==
    nextAlternatives
  ) {
    throw new ExamQuestionDomainError(
      'IMMUTABLE_EXAM_QUESTION_SNAPSHOT',
      'Snapshot não permite alterar alternatives.'
    );
  }

  const previousMedia =
    JSON.stringify(previous.media);

  const nextMedia =
    JSON.stringify(next.media);

  if (previousMedia !== nextMedia) {
    throw new ExamQuestionDomainError(
      'IMMUTABLE_EXAM_QUESTION_SNAPSHOT',
      'Snapshot não permite alterar media.'
    );
  }

  return true;
}

module.exports = {
  EXAM_QUESTION_SNAPSHOT_VERSION,
  EXAM_QUESTION_ALTERNATIVE_LABELS,
  ExamQuestionDomainError,
  validateAlternatives,
  normalizeMedia,
  examQuestionSnapshotDocumentId,
  normalizeExamQuestionSnapshot,
  validateExamQuestionSnapshot,
  buildExamQuestionSnapshot,
  publicExamQuestion,
  assertExamQuestionSnapshotImmutable
};