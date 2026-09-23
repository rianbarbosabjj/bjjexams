'use strict';

const assert =
  require('node:assert/strict');

const {
  legacyExamTemplateDocumentId,
  examTemplateVersionDocumentId
} = require('../src/exams/exam-template-domain');

const {
  examQuestionSnapshotDocumentId
} = require('../src/exams/exam-question-domain');

const {
  buildExamTemplateMigrationPlan
} = require('../src/migration/exam-template-v1_2');

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

function question(
  id,
  overrides = {}
) {
  return {
    pergunta:
      `Pergunta ${id}`,

    alternativas: {
      A: 'Resposta A',
      B: 'Resposta B',
      C: 'Resposta C',
      D: 'Resposta D'
    },

    resposta_correta:
      'A',

    dificuldade: 2,

    categoria:
      'Fundamentos',

    status:
      'aprovada',

    ...overrides
  };
}

function fixture(
  overrides = {}
) {
  const legacyConfigs =
    overrides.legacyConfigs ||
    new Map([
      [
        'Azul',
        {
          faixa: 'Azul',
          questoes_ids: [
            'q1',
            'q2'
          ],
          tempo_limite: 60,
          aprovacao_minima: 70
        }
      ]
    ]);

  const legacyQuestions =
    overrides.legacyQuestions ||
    new Map([
      [
        'q1',
        question('q1')
      ],
      [
        'q2',
        question(
          'q2',
          {
            resposta_correta:
              'B'
          }
        )
      ]
    ]);

  const canonicalDocuments =
    overrides.canonicalDocuments ||
    new Map();

  return {
    legacyConfigs,
    legacyQuestions,
    canonicalDocuments
  };
}

function action(
  plan,
  entityType
) {
  return plan.actions.find(
    item =>
      item.entityType ===
      entityType
  );
}

test(
  'mapeia config legado para template versao e snapshots ativos',
  () => {
    const plan =
      buildExamTemplateMigrationPlan(
        fixture()
      );

    assert.equal(
      plan.report.create,
      4
    );

    assert.equal(
      plan.report.inconsistencyCount,
      0
    );

    const template =
      action(
        plan,
        'template'
      );

    const version =
      action(
        plan,
        'template_version'
      );

    assert.equal(
      template.data.status,
      'active'
    );

    assert.equal(
      template.data.targetBelt,
      'Azul'
    );

    assert.equal(
      version.data.status,
      'active'
    );
  }
);

test(
  'converte aprovacao minima percentual em basis points',
  () => {
    const plan =
      buildExamTemplateMigrationPlan(
        fixture()
      );

    const version =
      action(
        plan,
        'template_version'
      );

    assert.equal(
      version.data.passingScoreBps,
      7000
    );
  }
);

test(
  'nota_corte tem precedencia e aceita duas casas percentuais',
  () => {
    const data = fixture();

    data.legacyConfigs.get(
      'Azul'
    ).nota_corte = 75.5;

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    const version =
      action(
        plan,
        'template_version'
      );

    assert.equal(
      version.data.passingScoreBps,
      7550
    );
  }
);

test(
  'campos ausentes preservam defaults legados 60 e 70',
  () => {
    const data = fixture();

    const cfg =
      data.legacyConfigs.get(
        'Azul'
      );

    delete cfg.tempo_limite;
    delete cfg.aprovacao_minima;

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    const version =
      action(
        plan,
        'template_version'
      );

    assert.equal(
      version.data.timeLimitMinutes,
      60
    );

    assert.equal(
      version.data.passingScoreBps,
      7000
    );
  }
);

test(
  'alternativas opcionais vazias sao removidas antes do snapshot',
  () => {
    const data = fixture();

    data.legacyQuestions.set(
      'q1',
      question(
        'q1',
        {
          alternativas: {
            A: 'A',
            B: 'B',
            C: '',
            D: '   '
          }
        }
      )
    );

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    const snapshot =
      plan.actions.find(
        item =>
          item.entityType ===
            'question_snapshot' &&
          item.data.sourceQuestionId ===
            'q1'
      );

    assert.deepEqual(
      snapshot.data.alternatives,
      {
        A: 'A',
        B: 'B'
      }
    );
  }
);

test(
  'questao ausente vira inconsistencia sem plano parcial da faixa',
  () => {
    const data = fixture();

    data.legacyQuestions.delete(
      'q2'
    );

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    assert.equal(
      plan.actions.length,
      0
    );

    assert.equal(
      plan.report.inconsistencyCount,
      1
    );

    assert.equal(
      plan.report.inconsistencies[0].code,
      'LEGACY_EXAM_QUESTION_MISSING'
    );
  }
);

test(
  'questao nao aprovada bloqueia migracao da faixa',
  () => {
    const data = fixture();

    data.legacyQuestions.get(
      'q1'
    ).status = 'pendente';

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    assert.equal(
      plan.actions.length,
      0
    );

    assert.equal(
      plan.report.inconsistencies[0].code,
      'LEGACY_QUESTION_NOT_APPROVED'
    );
  }
);

test(
  'ids de questoes duplicados sao rejeitados',
  () => {
    const data = fixture();

    data.legacyConfigs.get(
      'Azul'
    ).questoes_ids = [
      'q1',
      'q1'
    ];

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    assert.equal(
      plan.actions.length,
      0
    );

    assert.equal(
      plan.report.inconsistencies[0].code,
      'DUPLICATE_LEGACY_EXAM_QUESTION'
    );
  }
);

test(
  'faixa legado fora do contrato vira inconsistencia',
  () => {
    const data = fixture({
      legacyConfigs:
        new Map([
          [
            'Coral',
            {
              questoes_ids: ['q1'],
              tempo_limite: 60,
              aprovacao_minima: 70
            }
          ]
        ]),

      legacyQuestions:
        new Map([
          [
            'q1',
            question('q1')
          ]
        ])
    });

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    assert.equal(
      plan.actions.length,
      0
    );

    assert.equal(
      plan.report.inconsistencies[0].code,
      'INVALID_LEGACY_EXAM_BELT'
    );
  }
);

test(
  'faixa declarada divergente do document id e bloqueada',
  () => {
    const data = fixture();

    data.legacyConfigs.get(
      'Azul'
    ).faixa = 'Roxa';

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    assert.equal(
      plan.actions.length,
      0
    );

    assert.equal(
      plan.report.inconsistencies[0].code,
      'LEGACY_EXAM_BELT_MISMATCH'
    );
  }
);

test(
  'tempo limite invalido vira inconsistencia',
  () => {
    const data = fixture();

    data.legacyConfigs.get(
      'Azul'
    ).tempo_limite = 0;

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    assert.equal(
      plan.report.inconsistencies[0].code,
      'INVALID_LEGACY_EXAM_TIME_LIMIT'
    );
  }
);

test(
  'nota de corte com precisao excessiva e rejeitada',
  () => {
    const data = fixture();

    data.legacyConfigs.get(
      'Azul'
    ).aprovacao_minima =
      70.123;

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    assert.equal(
      plan.report.inconsistencies[0].code,
      'INVALID_LEGACY_EXAM_PASSING_SCORE'
    );
  }
);

test(
  'mais de 498 questoes e bloqueado pelo planner',
  () => {
    const ids =
      Array.from(
        {
          length: 499
        },
        (_, index) =>
          `q_${index}`
      );

    const data = fixture({
      legacyConfigs:
        new Map([
          [
            'Azul',
            {
              faixa: 'Azul',
              questoes_ids: ids,
              tempo_limite: 60,
              aprovacao_minima: 70
            }
          ]
        ])
    });

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    assert.equal(
      plan.report.inconsistencies[0].code,
      'LEGACY_EXAM_TOO_MANY_QUESTIONS'
    );
  }
);

test(
  'ids canonicos e ordem das questoes sao deterministicos',
  () => {
    const plan =
      buildExamTemplateMigrationPlan(
        fixture()
      );

    const templateId =
      legacyExamTemplateDocumentId(
        'Azul'
      );

    const versionId =
      examTemplateVersionDocumentId(
        1
      );

    const version =
      action(
        plan,
        'template_version'
      );

    assert.equal(
      action(
        plan,
        'template'
      ).path,
      `exam_templates/${templateId}`
    );

    assert.equal(
      version.path,
      `exam_templates/${templateId}` +
      `/versions/${versionId}`
    );

    assert.deepEqual(
      version.data.questionIds,
      [
        examQuestionSnapshotDocumentId(
          'q1'
        ),
        examQuestionSnapshotDocumentId(
          'q2'
        )
      ]
    );
  }
);

test(
  'plan hash e deterministico independentemente da ordem dos Maps',
  () => {
    const first =
      buildExamTemplateMigrationPlan(
        fixture()
      );

    const reversedQuestions =
      new Map([
        [
          'q2',
          question(
            'q2',
            {
              resposta_correta:
                'B'
            }
          )
        ],
        [
          'q1',
          question('q1')
        ]
      ]);

    const second =
      buildExamTemplateMigrationPlan(
        fixture({
          legacyQuestions:
            reversedQuestions
        })
      );

    assert.equal(
      first.report.planSha256,
      second.report.planSha256
    );
  }
);

test(
  'segunda execucao semantica vira NO_CHANGE',
  () => {
    const first =
      buildExamTemplateMigrationPlan(
        fixture()
      );

    const canonical =
      new Map(
        first.actions.map(
          item => [
            item.path,
            structuredClone(
              item.data
            )
          ]
        )
      );

    const second =
      buildExamTemplateMigrationPlan(
        fixture({
          canonicalDocuments:
            canonical
        })
      );

    assert.equal(
      second.report.create,
      0
    );

    assert.equal(
      second.report.noChange,
      4
    );

    assert.equal(
      second.report.conflict,
      0
    );

    assert.equal(
      second.report.inconsistencyCount,
      0
    );
  }
);

test(
  'documento canonico divergente nunca e sobrescrito silenciosamente',
  () => {
    const first =
      buildExamTemplateMigrationPlan(
        fixture()
      );

    const canonical =
      new Map(
        first.actions.map(
          item => [
            item.path,
            structuredClone(
              item.data
            )
          ]
        )
      );

    const snapshotEntry =
      [...canonical.entries()]
        .find(
          ([, value]) =>
            value.sourceQuestionId ===
            'q1'
        );

    snapshotEntry[1].prompt =
      'Conteúdo divergente';

    const second =
      buildExamTemplateMigrationPlan(
        fixture({
          canonicalDocuments:
            canonical
        })
      );

    assert.equal(
      second.report.conflict,
      1
    );

    assert.equal(
      second.report.inconsistencyCount,
      1
    );

    assert.equal(
      second.report.inconsistencies[0].code,
      'CANONICAL_EXAM_DOCUMENT_CONFLICT'
    );
  }
);

test(
  'relatorio sanitizado nao expoe gabarito conteudo ou id bruto',
  () => {
    const data = fixture();

    data.legacyQuestions.set(
      'question_secret_raw_id',
      question(
        'question_secret_raw_id',
        {
          pergunta:
            'PROMPT_MUST_NOT_LEAK',

          alternativas: {
            A: 'ANSWER_MUST_NOT_LEAK',
            B: 'B'
          },

          resposta_correta:
            'A'
        }
      )
    );

    data.legacyConfigs.get(
      'Azul'
    ).questoes_ids = [
      'question_secret_raw_id'
    ];

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    const report =
      JSON.stringify(
        plan.report
      );

    for (
      const forbidden of [
        'correctAnswer',
        'resposta_correta',
        'PROMPT_MUST_NOT_LEAK',
        'ANSWER_MUST_NOT_LEAK',
        'question_secret_raw_id'
      ]
    ) {
      assert.equal(
        report.includes(
          forbidden
        ),
        false
      );
    }
  }
);

test(
  'midia HTTPS valida e preservada no snapshot',
  () => {
    const data = fixture();

    data.legacyQuestions.get(
      'q1'
    ).url_imagem =
      'https://example.com/q1.jpg';

    data.legacyQuestions.get(
      'q1'
    ).url_video =
      'https://example.com/q1.mp4';

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    const snapshot =
      plan.actions.find(
        item =>
          item.entityType ===
            'question_snapshot' &&
          item.data.sourceQuestionId ===
            'q1'
      );

    assert.equal(
      snapshot.data.media.imageUrl,
      'https://example.com/q1.jpg'
    );

    assert.equal(
      snapshot.data.media.videoUrl,
      'https://example.com/q1.mp4'
    );
  }
);

test(
  'midia HTTP insegura vira inconsistencia',
  () => {
    const data = fixture();

    data.legacyQuestions.get(
      'q1'
    ).url_imagem =
      'http://example.com/q1.jpg';

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    assert.equal(
      plan.actions.length,
      0
    );

    assert.equal(
      plan.report.inconsistencies[0].code,
      'INVALID_EXAM_QUESTION_MEDIA_URL'
    );
  }
);

test(
  'dificuldade legada fora de 1 a 5 vira inconsistencia',
  () => {
    const data = fixture();

    data.legacyQuestions.get(
      'q1'
    ).dificuldade = 9;

    const plan =
      buildExamTemplateMigrationPlan(
        data
      );

    assert.equal(
      plan.actions.length,
      0
    );

    assert.equal(
      plan.report.inconsistencies[0].code,
      'INVALID_EXAM_QUESTION_DIFFICULTY'
    );
  }
);

test(
  'planner nao altera nenhuma estrutura de entrada',
  () => {
    const data = fixture();

    const beforeConfigs =
      structuredClone(
        data.legacyConfigs
      );

    const beforeQuestions =
      structuredClone(
        data.legacyQuestions
      );

    const beforeCanonical =
      structuredClone(
        data.canonicalDocuments
      );

    buildExamTemplateMigrationPlan(
      data
    );

    assert.deepEqual(
      data.legacyConfigs,
      beforeConfigs
    );

    assert.deepEqual(
      data.legacyQuestions,
      beforeQuestions
    );

    assert.deepEqual(
      data.canonicalDocuments,
      beforeCanonical
    );
  }
);

test(
  'planner nunca planeja update delete ou overwrite silencioso',
  () => {
    const first =
      buildExamTemplateMigrationPlan(
        fixture()
      );

    const canonical =
      new Map(
        first.actions.map(
          item => [
            item.path,
            structuredClone(
              item.data
            )
          ]
        )
      );

    const second =
      buildExamTemplateMigrationPlan(
        fixture({
          canonicalDocuments:
            canonical
        })
      );

    const snapshotEntry =
      [...canonical.entries()]
        .find(
          ([, value]) =>
            value.sourceQuestionId ===
            'q1'
        );

    snapshotEntry[1].prompt =
      'Divergência intencional';

    const third =
      buildExamTemplateMigrationPlan(
        fixture({
          canonicalDocuments:
            canonical
        })
      );

    const operations = [
      ...first.actions,
      ...second.actions,
      ...third.actions
    ].map(
      item => item.operation
    );

    const allowed =
      new Set([
        'CREATE',
        'NO_CHANGE',
        'CONFLICT'
      ]);

    assert.equal(
      operations.every(
        operation =>
          allowed.has(operation)
      ),
      true
    );

    for (
      const forbidden of [
        'DELETE',
        'UPDATE',
        'OVERWRITE',
        'UPSERT'
      ]
    ) {
      assert.equal(
        operations.includes(
          forbidden
        ),
        false
      );
    }
  }
);

console.log(
  `EXAM_TEMPLATE_MIGRATION_PLAN_V1_2=${passed}/23`
);