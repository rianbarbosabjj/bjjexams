'use strict';

const BELT_EXAM_PRODUCT_TYPE = 'belt_exam';
const BELT_EXAM_CURRENCY = 'BRL';

const OFFICIAL_BELTS = Object.freeze([
  'Branca',
  'Cinza e Branca',
  'Cinza',
  'Cinza e Preta',
  'Amarela e Branca',
  'Amarela',
  'Amarela e Preta',
  'Laranja e Branca',
  'Laranja',
  'Laranja e Preta',
  'Verde e Branca',
  'Verde',
  'Verde e Preta',
  'Azul',
  'Roxa',
  'Marrom',
  'Preta'
]);

const EXAM_SESSION_STATUSES = Object.freeze([
  'draft',
  'candidates_selected',
  'awaiting_payment',
  'ready',
  'cancelled',
  'archived'
]);

const EXAM_SESSION_STATUS_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['draft', 'candidates_selected', 'cancelled', 'archived']),
  candidates_selected: Object.freeze([
    'candidates_selected',
    'awaiting_payment',
    'ready',
    'cancelled',
    'archived'
  ]),
  awaiting_payment: Object.freeze([
    'awaiting_payment',
    'ready',
    'cancelled',
    'archived'
  ]),
  ready: Object.freeze(['ready', 'cancelled', 'archived']),
  cancelled: Object.freeze(['cancelled', 'archived']),
  archived: Object.freeze(['archived'])
});

class ExamSessionDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamSessionDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function requiredIdentifier(value, field) {
  const id = text(value, 200);
  if (!id || id.includes('/')) {
    throw new ExamSessionDomainError(
      'INVALID_EXAM_SESSION_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return id;
}

function normalizeBelt(value) {
  const raw = text(value, 80);
  if (!raw) return null;
  const lowered = raw.toLocaleLowerCase('pt-BR');
  return OFFICIAL_BELTS.find(
    belt => belt.toLocaleLowerCase('pt-BR') === lowered
  ) || null;
}

function requireBelt(value, field = 'targetBelt') {
  const belt = normalizeBelt(value);
  if (!belt) {
    throw new ExamSessionDomainError(
      'INVALID_EXAM_BELT',
      `${field} precisa ser uma faixa oficial suportada.`
    );
  }
  return belt;
}

function requirePriceCents(value) {
  const priceCents = Number(value);
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) {
    throw new ExamSessionDomainError(
      'INVALID_EXAM_SESSION_PRICE',
      'priceCents precisa ser inteiro positivo.'
    );
  }
  return priceCents;
}

function requireTimestamp(value, field) {
  if (value === undefined || value === null) {
    throw new ExamSessionDomainError(
      'EXAM_SESSION_TIMESTAMP_REQUIRED',
      `${field} é obrigatório.`
    );
  }
  return value;
}

function normalizeExamSession(input = {}) {
  return {
    organizationId: text(input.organizationId, 200),
    responsibleInstructorId: text(input.responsibleInstructorId, 200),
    targetBelt: normalizeBelt(input.targetBelt),
    status: text(input.status, 40)?.toLowerCase() || null,
    priceCents: Number(input.priceCents),
    currency: (text(input.currency, 10) || BELT_EXAM_CURRENCY).toUpperCase(),
    financialRuleId: text(input.financialRuleId, 200),
    scheduledAt: input.scheduledAt ?? null,
    createdBy: text(input.createdBy, 200),
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null
  };
}

function validateExamSession(input = {}) {
  const session = normalizeExamSession(input);

  session.organizationId = requiredIdentifier(
    session.organizationId,
    'organizationId'
  );
  session.responsibleInstructorId = requiredIdentifier(
    session.responsibleInstructorId,
    'responsibleInstructorId'
  );
  session.createdBy = requiredIdentifier(session.createdBy, 'createdBy');
  session.targetBelt = requireBelt(session.targetBelt);
  session.priceCents = requirePriceCents(session.priceCents);

  if (!EXAM_SESSION_STATUSES.includes(session.status)) {
    throw new ExamSessionDomainError(
      'INVALID_EXAM_SESSION_STATUS',
      'Status da sessão de exame inválido.'
    );
  }

  if (session.currency !== BELT_EXAM_CURRENCY) {
    throw new ExamSessionDomainError(
      'INVALID_EXAM_SESSION_CURRENCY',
      'Sessão de exame aceita somente BRL no contrato atual.'
    );
  }

  if (session.financialRuleId) {
    requiredIdentifier(session.financialRuleId, 'financialRuleId');
  }

  requireTimestamp(session.createdAt, 'createdAt');
  requireTimestamp(session.updatedAt, 'updatedAt');

  return session;
}

function assertExamSessionStatusTransition(fromInput, toInput) {
  const from = text(fromInput, 40)?.toLowerCase() || null;
  const to = text(toInput, 40)?.toLowerCase() || null;

  if (!EXAM_SESSION_STATUSES.includes(from) || !EXAM_SESSION_STATUSES.includes(to)) {
    throw new ExamSessionDomainError(
      'INVALID_EXAM_SESSION_STATUS',
      'Transição usa status de sessão inválido.'
    );
  }

  if (!EXAM_SESSION_STATUS_TRANSITIONS[from].includes(to)) {
    throw new ExamSessionDomainError(
      'INVALID_EXAM_SESSION_TRANSITION',
      `Sessão não pode transicionar de ${from} para ${to}.`
    );
  }

  return true;
}

function buildExamSession(input = {}) {
  const now = requireTimestamp(input.timestamp, 'timestamp');
  return validateExamSession({
    organizationId: input.organizationId,
    responsibleInstructorId: input.responsibleInstructorId,
    targetBelt: input.targetBelt,
    status: input.status || 'draft',
    priceCents: input.priceCents,
    currency: input.currency || BELT_EXAM_CURRENCY,
    financialRuleId: input.financialRuleId || null,
    scheduledAt: input.scheduledAt ?? null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now
  });
}

function examSessionFinancialProductContext(sessionIdInput, sessionInput = {}) {
  const sessionId = requiredIdentifier(sessionIdInput, 'sessionId');
  const session = validateExamSession(sessionInput);

  if (['cancelled', 'archived'].includes(session.status)) {
    throw new ExamSessionDomainError(
      'EXAM_SESSION_NOT_SALEABLE',
      'Sessão cancelada ou arquivada não pode originar produto financeiro.'
    );
  }

  return {
    productType: BELT_EXAM_PRODUCT_TYPE,
    productId: sessionId,
    financialRuleId: session.financialRuleId,
    ownerType: 'organization',
    ownerId: session.organizationId,
    currency: session.currency,
    amountCents: session.priceCents
  };
}

module.exports = {
  BELT_EXAM_PRODUCT_TYPE,
  BELT_EXAM_CURRENCY,
  OFFICIAL_BELTS,
  EXAM_SESSION_STATUSES,
  EXAM_SESSION_STATUS_TRANSITIONS,
  ExamSessionDomainError,
  normalizeBelt,
  requireBelt,
  normalizeExamSession,
  validateExamSession,
  assertExamSessionStatusTransition,
  buildExamSession,
  examSessionFinancialProductContext
};
