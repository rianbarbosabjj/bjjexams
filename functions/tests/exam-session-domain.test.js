'use strict';

const assert = require('node:assert/strict');
const {
  BELT_EXAM_PRODUCT_TYPE,
  BELT_EXAM_CURRENCY,
  ExamSessionDomainError,
  normalizeBelt,
  validateExamSession,
  assertExamSessionStatusTransition,
  buildExamSession,
  examSessionFinancialProductContext
} = require('../src/exams/exam-session-domain');

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
    assert.ok(error instanceof ExamSessionDomainError);
    assert.equal(error.code, code);
    return true;
  });
}

function base(overrides = {}) {
  return {
    organizationId: 'org_1',
    responsibleInstructorId: 'prof_1',
    targetBelt: 'Azul',
    status: 'draft',
    priceCents: 15000,
    currency: 'BRL',
    financialRuleId: null,
    scheduledAt: null,
    createdBy: 'prof_1',
    createdAt: new Date('2026-09-20T02:00:00.000Z'),
    updatedAt: new Date('2026-09-20T02:00:00.000Z'),
    ...overrides
  };
}

test('normaliza faixa oficial sem depender de caixa', () => {
  assert.equal(normalizeBelt(' azul '), 'Azul');
  assert.equal(normalizeBelt('CINZA E BRANCA'), 'Cinza e Branca');
});

test('sessao valida preserva preco inteiro em centavos', () => {
  const session = validateExamSession(base());
  assert.equal(session.priceCents, 15000);
  assert.equal(session.currency, BELT_EXAM_CURRENCY);
  assert.equal(session.targetBelt, 'Azul');
});

test('sessao rejeita faixa fora do contrato', () => {
  expectCode('INVALID_EXAM_BELT', () =>
    validateExamSession(base({ targetBelt: 'Coral' }))
  );
});

test('sessao rejeita preco zero, fracionario ou inseguro', () => {
  for (const priceCents of [0, -1, 10.5, Number.MAX_SAFE_INTEGER + 1]) {
    expectCode('INVALID_EXAM_SESSION_PRICE', () =>
      validateExamSession(base({ priceCents }))
    );
  }
});

test('sessao rejeita moeda fora de BRL', () => {
  expectCode('INVALID_EXAM_SESSION_CURRENCY', () =>
    validateExamSession(base({ currency: 'USD' }))
  );
});

test('sessao exige organizacao, instrutor e criador validos', () => {
  expectCode('INVALID_EXAM_SESSION_IDENTIFIER', () =>
    validateExamSession(base({ organizationId: 'org/1' }))
  );
  expectCode('INVALID_EXAM_SESSION_IDENTIFIER', () =>
    validateExamSession(base({ responsibleInstructorId: '' }))
  );
  expectCode('INVALID_EXAM_SESSION_IDENTIFIER', () =>
    validateExamSession(base({ createdBy: null }))
  );
});

test('build cria sessao draft com timestamps server-side fornecidos', () => {
  const timestamp = new Date('2026-09-20T03:00:00.000Z');
  const session = buildExamSession({
    organizationId: 'org_1',
    responsibleInstructorId: 'prof_1',
    targetBelt: 'Roxa',
    priceCents: 20000,
    createdBy: 'prof_1',
    timestamp
  });
  assert.equal(session.status, 'draft');
  assert.equal(session.createdAt, timestamp);
  assert.equal(session.updatedAt, timestamp);
});

test('maquina de estados permite fluxo comercial progressivo', () => {
  assert.equal(assertExamSessionStatusTransition('draft', 'candidates_selected'), true);
  assert.equal(assertExamSessionStatusTransition('candidates_selected', 'awaiting_payment'), true);
  assert.equal(assertExamSessionStatusTransition('awaiting_payment', 'ready'), true);
  assert.equal(assertExamSessionStatusTransition('ready', 'archived'), true);
});

test('maquina de estados bloqueia reabertura de sessao arquivada', () => {
  expectCode('INVALID_EXAM_SESSION_TRANSITION', () =>
    assertExamSessionStatusTransition('archived', 'draft')
  );
});

test('contexto financeiro usa belt_exam e a sessao como produto', () => {
  const product = examSessionFinancialProductContext(
    'session_1',
    base({
      status: 'candidates_selected',
      financialRuleId: 'rule_exam_1'
    })
  );
  assert.deepEqual(product, {
    productType: BELT_EXAM_PRODUCT_TYPE,
    productId: 'session_1',
    financialRuleId: 'rule_exam_1',
    ownerType: 'organization',
    ownerId: 'org_1',
    currency: 'BRL',
    amountCents: 15000
  });
});

test('sessao cancelada ou arquivada nao origina produto financeiro', () => {
  for (const status of ['cancelled', 'archived']) {
    expectCode('EXAM_SESSION_NOT_SALEABLE', () =>
      examSessionFinancialProductContext('session_1', base({ status }))
    );
  }
});

console.log(`EXAM_SESSION_DOMAIN_V1_2=${passed}/11`);
