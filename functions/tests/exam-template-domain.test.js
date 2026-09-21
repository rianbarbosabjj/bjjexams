'use strict';

const assert = require('node:assert/strict');

const {
  ExamTemplateDomainError,
  validateExamTemplate,
  buildExamTemplate,
  assertExamTemplateStatusTransition,
  examTemplateVersionDocumentId,
  legacyExamTemplateDocumentId,
  validateExamTemplateVersion,
  buildDraftExamTemplateVersion,
  assertExamTemplateVersionStatusTransition,
  activateExamTemplateVersion,
  assertExamTemplateVersionContentImmutable
} = require('../src/exams/exam-template-domain');

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
      error instanceof ExamTemplateDomainError
    );
    assert.equal(error.code, code);
    return true;
  });
}

const timestamp =
  new Date('2026-09-21T12:00:00.000Z');

function templateBase(overrides = {}) {
  return {
    name: 'Exame Oficial Faixa Azul',
    targetBelt: 'Azul',
    status: 'draft',
    activeVersionId: null,
    createdBy: 'admin_1',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function versionBase(overrides = {}) {
  return {
    templateId: 'template_1',
    version: 1,
    status: 'draft',
    timeLimitMinutes: 60,
    passingScoreBps: 7000,
    questionCount: 2,
    questionIds: [
      'question_1',
      'question_2'
    ],
    source: 'manual',
    createdBy: 'admin_1',
    createdAt: timestamp,
    activatedAt: null,
    ...overrides
  };
}

test(
  'build cria template draft sem versao ativa',
  () => {
    const template = buildExamTemplate({
      name: 'Exame Faixa Azul',
      targetBelt: 'azul',
      createdBy: 'admin_1',
      timestamp
    });

    assert.equal(template.status, 'draft');
    assert.equal(template.targetBelt, 'Azul');
    assert.equal(template.activeVersionId, null);
    assert.equal(template.createdAt, timestamp);
  }
);

test(
  'template ativo exige activeVersionId',
  () => {
    expectCode(
      'ACTIVE_EXAM_TEMPLATE_VERSION_REQUIRED',
      () => validateExamTemplate(
        templateBase({
          status: 'active'
        })
      )
    );
  }
);

test(
  'template rejeita faixa fora do contrato',
  () => {
    expectCode(
      'INVALID_EXAM_TEMPLATE_BELT',
      () => validateExamTemplate(
        templateBase({
          targetBelt: 'Coral'
        })
      )
    );
  }
);

test(
  'maquina de template permite draft para active',
  () => {
    assert.equal(
      assertExamTemplateStatusTransition(
        'draft',
        'active'
      ),
      true
    );
  }
);

test(
  'template arquivado nao volta para active',
  () => {
    expectCode(
      'INVALID_EXAM_TEMPLATE_TRANSITION',
      () => assertExamTemplateStatusTransition(
        'archived',
        'active'
      )
    );
  }
);

test(
  'id de versao e deterministico e ordenavel',
  () => {
    assert.equal(
      examTemplateVersionDocumentId(1),
      'v0000001'
    );

    assert.equal(
      examTemplateVersionDocumentId(12),
      'v0000012'
    );
  }
);

test(
  'id legado e deterministico por faixa',
  () => {
    const first =
      legacyExamTemplateDocumentId('Azul');

    const second =
      legacyExamTemplateDocumentId(' azul ');

    const other =
      legacyExamTemplateDocumentId('Roxa');

    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.equal(first.length, 64);
  }
);

test(
  'versao draft valida preserva configuracao',
  () => {
    const version =
      validateExamTemplateVersion(
        versionBase()
      );

    assert.equal(version.version, 1);
    assert.equal(version.timeLimitMinutes, 60);
    assert.equal(version.passingScoreBps, 7000);
    assert.equal(version.questionCount, 2);
  }
);

test(
  'versao rejeita numero invalido',
  () => {
    for (const value of [0, -1, 1.5]) {
      expectCode(
        'INVALID_EXAM_TEMPLATE_NUMBER',
        () => validateExamTemplateVersion(
          versionBase({
            version: value
          })
        )
      );
    }
  }
);

test(
  'versao rejeita duracao invalida',
  () => {
    for (const value of [0, -1, 1441]) {
      expectCode(
        'INVALID_EXAM_TEMPLATE_NUMBER',
        () => validateExamTemplateVersion(
          versionBase({
            timeLimitMinutes: value
          })
        )
      );
    }
  }
);

test(
  'versao rejeita passing score invalido',
  () => {
    for (
      const value of [0, -1, 10001, 7000.5]
    ) {
      expectCode(
        'INVALID_EXAM_TEMPLATE_PASSING_SCORE',
        () => validateExamTemplateVersion(
          versionBase({
            passingScoreBps: value
          })
        )
      );
    }
  }
);

test(
  'versao rejeita questoes duplicadas',
  () => {
    expectCode(
      'DUPLICATE_EXAM_TEMPLATE_QUESTION',
      () => validateExamTemplateVersion(
        versionBase({
          questionIds: [
            'question_1',
            'question_1'
          ]
        })
      )
    );
  }
);

test(
  'questionCount precisa bater com questionIds',
  () => {
    expectCode(
      'EXAM_TEMPLATE_QUESTION_COUNT_MISMATCH',
      () => validateExamTemplateVersion(
        versionBase({
          questionCount: 3
        })
      )
    );
  }
);

test(
  'versao draft nao pode nascer ativada',
  () => {
    expectCode(
      'DRAFT_EXAM_TEMPLATE_VERSION_ACTIVATED',
      () => validateExamTemplateVersion(
        versionBase({
          activatedAt: timestamp
        })
      )
    );
  }
);

test(
  'versao active exige questoes',
  () => {
    expectCode(
      'ACTIVE_EXAM_TEMPLATE_QUESTIONS_REQUIRED',
      () => validateExamTemplateVersion(
        versionBase({
          status: 'active',
          questionCount: 0,
          questionIds: [],
          activatedAt: timestamp
        })
      )
    );
  }
);

test(
  'build cria versao draft com contagem derivada',
  () => {
    const version =
      buildDraftExamTemplateVersion({
        templateId: 'template_1',
        version: 2,
        timeLimitMinutes: 45,
        passingScoreBps: 7500,
        questionIds: [
          'question_a',
          'question_b',
          'question_c'
        ],
        source: 'manual',
        createdBy: 'admin_1',
        timestamp
      });

    assert.equal(version.status, 'draft');
    assert.equal(version.questionCount, 3);
    assert.equal(version.activatedAt, null);
  }
);

test(
  'ativacao fixa timestamp e estado active',
  () => {
    const draft =
      buildDraftExamTemplateVersion({
        templateId: 'template_1',
        version: 1,
        timeLimitMinutes: 60,
        passingScoreBps: 7000,
        questionIds: [
          'question_1',
          'question_2'
        ],
        createdBy: 'admin_1',
        timestamp
      });

    const activatedAt =
      new Date('2026-09-21T13:00:00.000Z');

    const active =
      activateExamTemplateVersion(
        draft,
        activatedAt
      );

    assert.equal(active.status, 'active');
    assert.equal(
      active.activatedAt,
      activatedAt
    );
  }
);

test(
  'versao active nao pode voltar para draft',
  () => {
    expectCode(
      'INVALID_EXAM_TEMPLATE_VERSION_TRANSITION',
      () =>
        assertExamTemplateVersionStatusTransition(
          'active',
          'draft'
        )
    );
  }
);

test(
  'versao publicada pode apenas mudar estado sem mudar conteudo',
  () => {
    const active =
      validateExamTemplateVersion({
        ...versionBase(),
        status: 'active',
        activatedAt: timestamp
      });

    const retired = {
      ...active,
      status: 'retired'
    };

    assert.equal(
      assertExamTemplateVersionContentImmutable(
        active,
        retired
      ),
      true
    );
  }
);

test(
  'versao publicada bloqueia alteracao de questoes',
  () => {
    const active =
      validateExamTemplateVersion({
        ...versionBase(),
        status: 'active',
        activatedAt: timestamp
      });

    expectCode(
      'IMMUTABLE_EXAM_TEMPLATE_VERSION',
      () =>
        assertExamTemplateVersionContentImmutable(
          active,
          {
            ...active,
            questionIds: [
              'question_1',
              'question_3'
            ]
          }
        )
    );
  }
);

test(
  'id de versao permanece ordenavel em todo intervalo suportado',
  () => {
    const versions = [
      1,
      9,
      10,
      9999,
      10000,
      100000,
      1000000
    ];

    const ids = versions.map(
      examTemplateVersionDocumentId
    );

    assert.deepEqual(
      [...ids].sort(),
      ids
    );
  }
);

test(
  'ativacao repetida preserva activatedAt original',
  () => {
    const activatedAt =
      new Date('2026-09-21T13:00:00.000Z');

    const active =
      validateExamTemplateVersion({
        ...versionBase(),
        status: 'active',
        activatedAt
      });

    const retried =
      activateExamTemplateVersion(
        active,
        new Date('2026-09-21T14:00:00.000Z')
      );

    assert.equal(
      retried.activatedAt,
      activatedAt
    );
  }
);

test(
  'versao publicada bloqueia alteracao de passing score',
  () => {
    const active =
      validateExamTemplateVersion({
        ...versionBase(),
        status: 'active',
        activatedAt: timestamp
      });

    expectCode(
      'IMMUTABLE_EXAM_TEMPLATE_VERSION',
      () =>
        assertExamTemplateVersionContentImmutable(
          active,
          {
            ...active,
            passingScoreBps: 7500
          }
        )
    );
  }
);

console.log(
  `EXAM_TEMPLATE_DOMAIN_V1_2=${passed}/23`
);