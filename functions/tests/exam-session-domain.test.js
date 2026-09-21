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
  hasBoundExamTemplate,
  requireBoundExamTemplate,
  bindExamSessionTemplate,
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
    templateId: null,
    templateVersionId: null,
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
  assert.equal(session.templateId, null);
  assert.equal(session.templateVersionId, null);
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

test('sessao legada sem template continua valida', () => {
  const session = validateExamSession(base());

  assert.equal(session.templateId, null);
  assert.equal(session.templateVersionId, null);
  assert.equal(
    hasBoundExamTemplate(session),
    false
  );
});

test('binding parcial de template e rejeitado', () => {
  expectCode(
    'EXAM_SESSION_TEMPLATE_BINDING_INCOMPLETE',
    () =>
      validateExamSession(
        base({
          templateId: 'tpl_1'
        })
      )
  );

  expectCode(
    'EXAM_SESSION_TEMPLATE_BINDING_INCOMPLETE',
    () =>
      validateExamSession(
        base({
          templateVersionId: 'v0000001'
        })
      )
  );
});

test('binding valida identificadores canonicos', () => {
  expectCode(
    'INVALID_EXAM_SESSION_IDENTIFIER',
    () =>
      validateExamSession(
        base({
          templateId: 'tpl/1',
          templateVersionId:
            'v0000001'
        })
      )
  );

  expectCode(
    'INVALID_EXAM_SESSION_IDENTIFIER',
    () =>
      validateExamSession(
        base({
          templateId: 'tpl_1',
          templateVersionId:
            'v/0000001'
        })
      )
  );
});

test('sessao com binding completo preserva template e versao', () => {
  const session =
    validateExamSession(
      base({
        templateId:
          'tpl_azul',
        templateVersionId:
          'v0000001'
      })
    );

  assert.equal(
    session.templateId,
    'tpl_azul'
  );

  assert.equal(
    session.templateVersionId,
    'v0000001'
  );

  assert.equal(
    hasBoundExamTemplate(session),
    true
  );
});

test('binding em draft fixa template e atualiza timestamp', () => {
  const timestamp =
    new Date(
      '2026-09-21T20:00:00.000Z'
    );

  const session =
    bindExamSessionTemplate(
      base(),
      {
        templateId:
          'tpl_azul',
        templateVersionId:
          'v0000001',
        timestamp
      }
    );

  assert.equal(
    session.templateId,
    'tpl_azul'
  );

  assert.equal(
    session.templateVersionId,
    'v0000001'
  );

  assert.equal(
    session.updatedAt,
    timestamp
  );
});

test('binding ainda e permitido em candidates_selected', () => {
  const session =
    bindExamSessionTemplate(
      base({
        status:
          'candidates_selected'
      }),
      {
        templateId:
          'tpl_azul',
        templateVersionId:
          'v0000001',
        timestamp:
          new Date(
            '2026-09-21T20:10:00.000Z'
          )
      }
    );

  assert.equal(
    session.templateId,
    'tpl_azul'
  );
});

test('retry do mesmo binding e idempotente', () => {
  const original =
    base({
      templateId:
        'tpl_azul',
      templateVersionId:
        'v0000001'
    });

  const result =
    bindExamSessionTemplate(
      original,
      {
        templateId:
          'tpl_azul',
        templateVersionId:
          'v0000001'
      }
    );

  assert.deepEqual(
    result,
    validateExamSession(original)
  );
});

test('template congelado nao pode ser substituido', () => {
  expectCode(
    'EXAM_SESSION_TEMPLATE_IMMUTABLE',
    () =>
      bindExamSessionTemplate(
        base({
          templateId:
            'tpl_azul',
          templateVersionId:
            'v0000001'
        }),
        {
          templateId:
            'tpl_azul_2',
          templateVersionId:
            'v0000002'
        }
      )
  );
});

test('binding novo e bloqueado depois do inicio financeiro', () => {
  for (
    const status of [
      'awaiting_payment',
      'ready',
      'cancelled',
      'archived'
    ]
  ) {
    expectCode(
      'EXAM_SESSION_TEMPLATE_BINDING_LOCKED',
      () =>
        bindExamSessionTemplate(
          base({ status }),
          {
            templateId:
              'tpl_azul',
            templateVersionId:
              'v0000001',
            timestamp:
              new Date(
                '2026-09-21T20:20:00.000Z'
              )
          }
        )
    );
  }
});

test('requireBoundExamTemplate impede execucao sem binding', () => {
  expectCode(
    'EXAM_SESSION_TEMPLATE_REQUIRED',
    () =>
      requireBoundExamTemplate(
        base()
      )
  );

  assert.deepEqual(
    requireBoundExamTemplate(
      base({
        templateId:
          'tpl_azul',
        templateVersionId:
          'v0000001'
      })
    ),
    {
      templateId:
        'tpl_azul',
      templateVersionId:
        'v0000001'
    }
  );
});

console.log(`EXAM_SESSION_DOMAIN_V1_2=${passed}/21`);
