'use strict';

const crypto = require('crypto');
const {
  requireBelt
} = require('./exam-session-domain');

const EXAM_TEMPLATE_STATUSES = Object.freeze([
  'draft',
  'active',
  'archived'
]);

const EXAM_TEMPLATE_STATUS_TRANSITIONS = Object.freeze({
  draft: Object.freeze([
    'draft',
    'active',
    'archived'
  ]),
  active: Object.freeze([
    'active',
    'archived'
  ]),
  archived: Object.freeze([
    'archived'
  ])
});

const EXAM_TEMPLATE_VERSION_STATUSES = Object.freeze([
  'draft',
  'active',
  'retired'
]);

const EXAM_TEMPLATE_VERSION_STATUS_TRANSITIONS = Object.freeze({
  draft: Object.freeze([
    'draft',
    'active',
    'retired'
  ]),
  active: Object.freeze([
    'active',
    'retired'
  ]),
  retired: Object.freeze([
    'retired'
  ])
});

class ExamTemplateDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamTemplateDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;

  const normalized = String(value).trim();

  if (!normalized) return null;

  return normalized.slice(0, max);
}

function requiredText(value, field, max = 200) {
  const normalized = text(value, max);

  if (!normalized) {
    throw new ExamTemplateDomainError(
      'EXAM_TEMPLATE_TEXT_REQUIRED',
      `${field} Ã© obrigatÃ³rio.`
    );
  }

  return normalized;
}

function requiredIdentifier(value, field) {
  const id = text(value, 200);

  if (!id || id.includes('/')) {
    throw new ExamTemplateDomainError(
      'INVALID_EXAM_TEMPLATE_IDENTIFIER',
      `${field} invÃ¡lido.`
    );
  }

  return id;
}

function optionalIdentifier(value, field) {
  const id = text(value, 200);

  if (id === null) return null;

  return requiredIdentifier(id, field);
}

function requiredTimestamp(value, field) {
  if (value === undefined || value === null) {
    throw new ExamTemplateDomainError(
      'EXAM_TEMPLATE_TIMESTAMP_REQUIRED',
      `${field} Ã© obrigatÃ³rio.`
    );
  }

  return value;
}

function timestampIdentity(value) {
  if (value === undefined || value === null) return null;

  if (typeof value.toMillis === 'function') {
    return String(value.toMillis());
  }

  if (value instanceof Date) {
    return String(value.getTime());
  }

  return String(value);
}

function positiveSafeInteger(value, field, max) {
  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    number > max
  ) {
    throw new ExamTemplateDomainError(
      'INVALID_EXAM_TEMPLATE_NUMBER',
      `${field} invÃ¡lido.`
    );
  }

  return number;
}

function nonNegativeSafeInteger(value, field, max) {
  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < 0 ||
    number > max
  ) {
    throw new ExamTemplateDomainError(
      'INVALID_EXAM_TEMPLATE_NUMBER',
      `${field} invÃ¡lido.`
    );
  }

  return number;
}

function passingScoreBps(value) {
  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    number > 10000
  ) {
    throw new ExamTemplateDomainError(
      'INVALID_EXAM_TEMPLATE_PASSING_SCORE',
      'passingScoreBps precisa ser inteiro entre 1 e 10000.'
    );
  }

  return number;
}

function normalizeQuestionIds(value) {
  if (!Array.isArray(value)) return [];

  return value.map(item => text(item, 200));
}

function validateQuestionIds(value) {
  const questionIds = normalizeQuestionIds(value);
  const normalized = [];

  for (const questionId of questionIds) {
    normalized.push(
      requiredIdentifier(questionId, 'questionId')
    );
  }

  if (new Set(normalized).size !== normalized.length) {
    throw new ExamTemplateDomainError(
      'DUPLICATE_EXAM_TEMPLATE_QUESTION',
      'Uma versÃ£o de prova nÃ£o pode repetir a mesma questÃ£o.'
    );
  }

  return normalized;
}

function normalizeExamTemplate(input = {}) {
  return {
    name: text(input.name, 160),
    targetBelt: input.targetBelt ?? null,
    status: text(input.status, 40)?.toLowerCase() || null,
    activeVersionId: text(input.activeVersionId, 200),
    createdBy: text(input.createdBy, 200),
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null
  };
}

function validateExamTemplate(input = {}) {
  const template = normalizeExamTemplate(input);

  template.name = requiredText(
    template.name,
    'name',
    160
  );

  try {
    template.targetBelt = requireBelt(
      template.targetBelt,
      'targetBelt'
    );
  } catch (error) {
    throw new ExamTemplateDomainError(
      'INVALID_EXAM_TEMPLATE_BELT',
      'targetBelt precisa ser uma faixa oficial suportada.'
    );
  }

  if (!EXAM_TEMPLATE_STATUSES.includes(template.status)) {
    throw new ExamTemplateDomainError(
      'INVALID_EXAM_TEMPLATE_STATUS',
      'Status do template de exame invÃ¡lido.'
    );
  }

  template.activeVersionId = optionalIdentifier(
    template.activeVersionId,
    'activeVersionId'
  );

  template.createdBy = requiredIdentifier(
    template.createdBy,
    'createdBy'
  );

  requiredTimestamp(
    template.createdAt,
    'createdAt'
  );

  requiredTimestamp(
    template.updatedAt,
    'updatedAt'
  );

  if (
    template.status === 'active' &&
    !template.activeVersionId
  ) {
    throw new ExamTemplateDomainError(
      'ACTIVE_EXAM_TEMPLATE_VERSION_REQUIRED',
      'Template ativo exige activeVersionId.'
    );
  }

  return template;
}

function buildExamTemplate(input = {}) {
  const timestamp = requiredTimestamp(
    input.timestamp,
    'timestamp'
  );

  return validateExamTemplate({
    name: input.name,
    targetBelt: input.targetBelt,
    status: 'draft',
    activeVersionId: null,
    createdBy: input.createdBy,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function assertExamTemplateStatusTransition(
  fromInput,
  toInput
) {
  const from =
    text(fromInput, 40)?.toLowerCase() || null;

  const to =
    text(toInput, 40)?.toLowerCase() || null;

  if (
    !EXAM_TEMPLATE_STATUSES.includes(from) ||
    !EXAM_TEMPLATE_STATUSES.includes(to)
  ) {
    throw new ExamTemplateDomainError(
      'INVALID_EXAM_TEMPLATE_STATUS',
      'TransiÃ§Ã£o usa status de template invÃ¡lido.'
    );
  }

  if (
    !EXAM_TEMPLATE_STATUS_TRANSITIONS[from].includes(to)
  ) {
    throw new ExamTemplateDomainError(
      'INVALID_EXAM_TEMPLATE_TRANSITION',
      `Template nÃ£o pode transicionar de ${from} para ${to}.`
    );
  }

  return true;
}

function requireVersionNumber(value) {
  return positiveSafeInteger(
    value,
    'version',
    1000000
  );
}

function examTemplateVersionDocumentId(versionInput) {
  const version = requireVersionNumber(versionInput);

  return `v${String(version).padStart(7, '0')}`;
}

function legacyExamTemplateDocumentId(targetBeltInput) {
  let targetBelt;

  try {
    targetBelt = requireBelt(
      targetBeltInput,
      'targetBelt'
    );
  } catch (error) {
    throw new ExamTemplateDomainError(
      'INVALID_EXAM_TEMPLATE_BELT',
      'targetBelt precisa ser uma faixa oficial suportada.'
    );
  }

  return crypto
    .createHash('sha256')
    .update(
      `legacy-exam-template-v1:${targetBelt.toLocaleLowerCase('pt-BR')}`
    )
    .digest('hex');
}

function normalizeExamTemplateVersion(input = {}) {
  return {
    templateId: text(input.templateId, 200),
    version: Number(input.version),
    status: text(input.status, 40)?.toLowerCase() || null,
    timeLimitMinutes: Number(input.timeLimitMinutes),
    passingScoreBps: Number(input.passingScoreBps),
    questionCount: Number(input.questionCount),
    questionIds: normalizeQuestionIds(input.questionIds),
    source: text(input.source, 80),
    createdBy: text(input.createdBy, 200),
    createdAt: input.createdAt ?? null,
    activatedAt: input.activatedAt ?? null
  };
}

function validateExamTemplateVersion(input = {}) {
  const version = normalizeExamTemplateVersion(input);

  version.templateId = requiredIdentifier(
    version.templateId,
    'templateId'
  );

  version.version = requireVersionNumber(
    version.version
  );

  if (
    !EXAM_TEMPLATE_VERSION_STATUSES.includes(
      version.status
    )
  ) {
    throw new ExamTemplateDomainError(
      'INVALID_EXAM_TEMPLATE_VERSION_STATUS',
      'Status da versÃ£o de template invÃ¡lido.'
    );
  }

  version.timeLimitMinutes = positiveSafeInteger(
    version.timeLimitMinutes,
    'timeLimitMinutes',
    1440
  );

  version.passingScoreBps = passingScoreBps(
    version.passingScoreBps
  );

  version.questionCount = nonNegativeSafeInteger(
    version.questionCount,
    'questionCount',
    500
  );

  version.questionIds = validateQuestionIds(
    version.questionIds
  );

  if (
    version.questionCount !==
    version.questionIds.length
  ) {
    throw new ExamTemplateDomainError(
      'EXAM_TEMPLATE_QUESTION_COUNT_MISMATCH',
      'questionCount precisa corresponder a questionIds.'
    );
  }

  version.source = requiredText(
    version.source,
    'source',
    80
  );

  version.createdBy = requiredIdentifier(
    version.createdBy,
    'createdBy'
  );

  requiredTimestamp(
    version.createdAt,
    'createdAt'
  );

  if (
    version.status === 'draft' &&
    version.activatedAt !== null
  ) {
    throw new ExamTemplateDomainError(
      'DRAFT_EXAM_TEMPLATE_VERSION_ACTIVATED',
      'VersÃ£o draft nÃ£o pode possuir activatedAt.'
    );
  }

  if (version.status === 'active') {
    if (version.questionCount <= 0) {
      throw new ExamTemplateDomainError(
        'ACTIVE_EXAM_TEMPLATE_QUESTIONS_REQUIRED',
        'VersÃ£o ativa precisa possuir questÃµes.'
      );
    }

    requiredTimestamp(
      version.activatedAt,
      'activatedAt'
    );
  }

  return version;
}

function buildDraftExamTemplateVersion(input = {}) {
  const timestamp = requiredTimestamp(
    input.timestamp,
    'timestamp'
  );

  const questionIds = Array.isArray(input.questionIds)
    ? input.questionIds
    : [];

  return validateExamTemplateVersion({
    templateId: input.templateId,
    version: input.version,
    status: 'draft',
    timeLimitMinutes: input.timeLimitMinutes,
    passingScoreBps: input.passingScoreBps,
    questionCount: questionIds.length,
    questionIds,
    source: input.source || 'manual',
    createdBy: input.createdBy,
    createdAt: timestamp,
    activatedAt: null
  });
}

function assertExamTemplateVersionStatusTransition(
  fromInput,
  toInput
) {
  const from =
    text(fromInput, 40)?.toLowerCase() || null;

  const to =
    text(toInput, 40)?.toLowerCase() || null;

  if (
    !EXAM_TEMPLATE_VERSION_STATUSES.includes(from) ||
    !EXAM_TEMPLATE_VERSION_STATUSES.includes(to)
  ) {
    throw new ExamTemplateDomainError(
      'INVALID_EXAM_TEMPLATE_VERSION_STATUS',
      'TransiÃ§Ã£o usa status de versÃ£o invÃ¡lido.'
    );
  }

  if (
    !EXAM_TEMPLATE_VERSION_STATUS_TRANSITIONS[
      from
    ].includes(to)
  ) {
    throw new ExamTemplateDomainError(
      'INVALID_EXAM_TEMPLATE_VERSION_TRANSITION',
      `VersÃ£o nÃ£o pode transicionar de ${from} para ${to}.`
    );
  }

  return true;
}

function activateExamTemplateVersion(
  versionInput,
  timestamp
) {
  const version =
    validateExamTemplateVersion(versionInput);

  assertExamTemplateVersionStatusTransition(
    version.status,
    'active'
  );

  if (version.status === 'active') {
    return version;
  }

  return validateExamTemplateVersion({
    ...version,
    status: 'active',
    activatedAt: requiredTimestamp(
      timestamp,
      'timestamp'
    )
  });
}

function assertExamTemplateVersionContentImmutable(
  previousInput,
  nextInput
) {
  const previous =
    validateExamTemplateVersion(previousInput);

  const next =
    validateExamTemplateVersion(nextInput);

  if (
    !['active', 'retired'].includes(
      previous.status
    )
  ) {
    return true;
  }

  const scalarFields = [
    'templateId',
    'version',
    'timeLimitMinutes',
    'passingScoreBps',
    'questionCount',
    'source',
    'createdBy'
  ];

  for (const field of scalarFields) {
    if (previous[field] !== next[field]) {
      throw new ExamTemplateDomainError(
        'IMMUTABLE_EXAM_TEMPLATE_VERSION',
        `VersÃ£o publicada nÃ£o permite alterar ${field}.`
      );
    }
  }

  if (
    timestampIdentity(previous.createdAt) !==
    timestampIdentity(next.createdAt)
  ) {
    throw new ExamTemplateDomainError(
      'IMMUTABLE_EXAM_TEMPLATE_VERSION',
      'VersÃ£o publicada nÃ£o permite alterar createdAt.'
    );
  }

  if (
    timestampIdentity(previous.activatedAt) !==
    timestampIdentity(next.activatedAt)
  ) {
    throw new ExamTemplateDomainError(
      'IMMUTABLE_EXAM_TEMPLATE_VERSION',
      'VersÃ£o publicada nÃ£o permite alterar activatedAt.'
    );
  }

  if (
    previous.questionIds.length !==
    next.questionIds.length
  ) {
    throw new ExamTemplateDomainError(
      'IMMUTABLE_EXAM_TEMPLATE_VERSION',
      'VersÃ£o publicada nÃ£o permite alterar questionIds.'
    );
  }

  for (
    let index = 0;
    index < previous.questionIds.length;
    index += 1
  ) {
    if (
      previous.questionIds[index] !==
      next.questionIds[index]
    ) {
      throw new ExamTemplateDomainError(
        'IMMUTABLE_EXAM_TEMPLATE_VERSION',
        'VersÃ£o publicada nÃ£o permite alterar questionIds.'
      );
    }
  }

  return true;
}

module.exports = {
  EXAM_TEMPLATE_STATUSES,
  EXAM_TEMPLATE_STATUS_TRANSITIONS,
  EXAM_TEMPLATE_VERSION_STATUSES,
  EXAM_TEMPLATE_VERSION_STATUS_TRANSITIONS,
  ExamTemplateDomainError,
  normalizeExamTemplate,
  validateExamTemplate,
  buildExamTemplate,
  assertExamTemplateStatusTransition,
  examTemplateVersionDocumentId,
  legacyExamTemplateDocumentId,
  normalizeExamTemplateVersion,
  validateExamTemplateVersion,
  buildDraftExamTemplateVersion,
  assertExamTemplateVersionStatusTransition,
  activateExamTemplateVersion,
  assertExamTemplateVersionContentImmutable
};