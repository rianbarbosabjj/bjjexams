'use strict';

const assert =
  require('node:assert/strict');

const {
  STAGING_PROJECT,
  ExamTemplateStagingPreflightError,
  validateStagingPreflightArguments,
  assertStagingReadOnlyEnvironment,
  canonicalFingerprint,
  buildStagingPreflightReport,
  runExamTemplateStagingPreflight
} = require('../src/migration/exam-template-v1_2-staging-preflight');

const cases = [];

function test(
  name,
  fn
) {
  cases.push({
    name,
    fn
  });
}

async function run() {
  if (cases.length !== 11) {
    throw new Error(
      `Expected 11 test cases, found ${cases.length}.`
    );
  }

  let passed = 0;

  for (
    const {
      name,
      fn
    }
    of cases
  ) {
    try {
      await fn();

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

  console.log(
    `EXAM_TEMPLATE_STAGING_PREFLIGHT_V1_2=${passed}/11`
  );

  if (passed !== 11) {
    throw new Error(
      `Expected 11 passing tests, found ${passed}.`
    );
  }
}

function expectCode(code) {
  return error => (
    error instanceof
      ExamTemplateStagingPreflightError &&
    error.code === code
  );
}

function fakeState(
  overrides = {}
) {
  const actionSecret =
    'RAW_SECRET_MUST_NOT_LEAK';

  return {
    legacyConfigs:
      new Map([
        [
          'Azul',
          {
            faixa: 'Azul'
          }
        ]
      ]),

    legacyQuestions:
      new Map(),

    referencedQuestionIds:
      [
        'question_secret_raw_id'
      ],

    canonicalDocuments:
      new Map(),

    legacyFingerprint:
      'legacy-fingerprint-1',

    canonicalFingerprint:
      canonicalFingerprint(
        new Map()
      ),

    plan: {
      migrationId:
        'legacy-exam-template-v1_2',

      actions: [
        {
          operation:
            'CREATE',

          entityType:
            'template',

          path:
            'exam_templates/template-secret',

          data: {
            name:
              'Exame Azul'
          }
        },

        {
          operation:
            'CREATE',

          entityType:
            'template_version',

          path:
            'exam_templates/template-secret/versions/v0000001',

          data: {
            passingScoreBps:
              7000
          }
        },

        {
          operation:
            'CREATE',

          entityType:
            'question_snapshot',

          path:
            'exam_templates/template-secret/versions/v0000001/questions/question_secret_raw_id',

          data: {
            prompt:
              actionSecret,

            correctAnswer:
              'A'
          }
        }
      ],

      report: {
        planSha256:
          'plan-sha-1',

        create: 3,
        noChange: 0,
        conflict: 0,

        inconsistencyCount:
          0,

        inconsistencies:
          []
      }
    },

    ...overrides
  };
}

test(
  'CLI aceita apenas dry-run staging exato',
  () => {
    const result =
      validateStagingPreflightArguments({
        args: [
          '--dry-run',
          '--project=bjj-exams-staging'
        ],

        env: {}
      });

    assert.equal(
      result.projectId,
      STAGING_PROJECT
    );

    assert.equal(
      result.mode,
      'dry-run'
    );
  }
);

test(
  'CLI exige dry-run',
  () => {
    assert.throws(
      () =>
        validateStagingPreflightArguments({
          args: [
            '--project=bjj-exams-staging'
          ],
          env: {}
        }),
      expectCode(
        'STAGING_PREFLIGHT_DRY_RUN_REQUIRED'
      )
    );
  }
);

test(
  'CLI bloqueia apply e argumentos extras',
  () => {
    assert.throws(
      () =>
        validateStagingPreflightArguments({
          args: [
            '--dry-run',
            '--project=bjj-exams-staging',
            '--apply'
          ],
          env: {}
        }),
      expectCode(
        'STAGING_PREFLIGHT_ARGUMENT_BLOCKED'
      )
    );
  }
);

test(
  'producao e projeto diferente de staging sao bloqueados',
  () => {
    assert.throws(
      () =>
        assertStagingReadOnlyEnvironment({
          projectId:
            'bjj-exams',
          firestoreHost: null,
          authHost: null
        }),
      expectCode(
        'STAGING_PREFLIGHT_PRODUCTION_BLOCKED'
      )
    );

    assert.throws(
      () =>
        assertStagingReadOnlyEnvironment({
          projectId:
            'outro-projeto',
          firestoreHost: null,
          authHost: null
        }),
      expectCode(
        'STAGING_PREFLIGHT_PROJECT_BLOCKED'
      )
    );
  }
);

test(
  'variaveis de emulator sao bloqueadas',
  () => {
    assert.throws(
      () =>
        assertStagingReadOnlyEnvironment({
          projectId:
            STAGING_PROJECT,
          firestoreHost:
            '127.0.0.1:8080',
          authHost: null
        }),
      expectCode(
        'STAGING_PREFLIGHT_EMULATOR_VARIABLES_BLOCKED'
      )
    );
  }
);

test(
  'relatorio estavel e sanitizado',
  () => {
    const first =
      fakeState();

    const second =
      fakeState();

    const report =
      buildStagingPreflightReport({
        projectId:
          STAGING_PROJECT,
        first,
        second
      });

    assert.equal(
      report.planned.create,
      3
    );

    assert.equal(
      report.planned
        .createByEntity
        .templates,
      1
    );

    assert.equal(
      report.planned
        .createByEntity
        .versions,
      1
    );

    assert.equal(
      report.planned
        .createByEntity
        .questionSnapshots,
      1
    );

    assert.equal(
      report.stagingWritesAttempted,
      false
    );

    assert.equal(
      report.applyCapability,
      false
    );

    assert.equal(
      report.productionAccess,
      false
    );

    const serialized =
      JSON.stringify(report);

    for (
      const forbidden of [
        'RAW_SECRET_MUST_NOT_LEAK',
        'correctAnswer',
        'question_secret_raw_id',
        'template-secret'
      ]
    ) {
      assert.equal(
        serialized.includes(
          forbidden
        ),
        false
      );
    }
  }
);

test(
  'mudanca de plano entre leituras bloqueia preflight',
  () => {
    const first =
      fakeState();

    const second =
      fakeState({
        plan: {
          ...fakeState().plan,

          report: {
            ...fakeState()
              .plan.report,

            planSha256:
              'changed-plan'
          }
        }
      });

    assert.throws(
      () =>
        buildStagingPreflightReport({
          projectId:
            STAGING_PROJECT,
          first,
          second
        }),
      expectCode(
        'STAGING_PREFLIGHT_PLAN_CHANGED'
      )
    );
  }
);

test(
  'mudanca de fonte legada entre leituras bloqueia preflight',
  () => {
    const first =
      fakeState();

    const second =
      fakeState({
        legacyFingerprint:
          'changed-source'
      });

    assert.throws(
      () =>
        buildStagingPreflightReport({
          projectId:
            STAGING_PROJECT,
          first,
          second
        }),
      expectCode(
        'STAGING_PREFLIGHT_SOURCE_CHANGED'
      )
    );
  }
);

test(
  'mudanca de quantidade de alvos canonicos bloqueia preflight',
  () => {
    const first =
      fakeState();

    const second =
      fakeState({
        canonicalDocuments:
          new Map([
            [
              'exam_templates/x',
              {}
            ]
          ]),

        canonicalFingerprint:
          canonicalFingerprint(
            new Map([
              [
                'exam_templates/x',
                {}
              ]
            ])
          )
      });

    assert.throws(
      () =>
        buildStagingPreflightReport({
          projectId:
            STAGING_PROJECT,
          first,
          second
        }),
      expectCode(
        'STAGING_PREFLIGHT_TARGET_CHANGED'
      )
    );
  }
);

test(
  'mudanca de conteudo canonico com mesma quantidade bloqueia preflight',
  () => {
    const firstDocuments =
      new Map([
        [
          'exam_templates/x',
          {
            status: 'active',
            value: 1
          }
        ]
      ]);

    const secondDocuments =
      new Map([
        [
          'exam_templates/x',
          {
            status: 'active',
            value: 2
          }
        ]
      ]);

    const first =
      fakeState({
        canonicalDocuments:
          firstDocuments,

        canonicalFingerprint:
          canonicalFingerprint(
            firstDocuments
          )
      });

    const second =
      fakeState({
        canonicalDocuments:
          secondDocuments,

        canonicalFingerprint:
          canonicalFingerprint(
            secondDocuments
          )
      });

    assert.equal(
      first.canonicalDocuments.size,
      second.canonicalDocuments.size
    );

    assert.throws(
      () =>
        buildStagingPreflightReport({
          projectId:
            STAGING_PROJECT,
          first,
          second
        }),
      expectCode(
        'STAGING_PREFLIGHT_TARGET_CHANGED'
      )
    );
  }
);

test(
  'runner executa exatamente duas leituras e nao possui capacidade de apply',
  async () => {
    let calls = 0;

    const state =
      fakeState();

    const fakeDb = {
      collection() {},
      doc() {}
    };

    const report =
      await runExamTemplateStagingPreflight({
        db:
          fakeDb,

        projectId:
          STAGING_PROJECT,

        environment: {
          firestoreHost: null,
          authHost: null
        },

        loadState:
          async () => {
            calls += 1;

            return fakeState({
              legacyFingerprint:
                state.legacyFingerprint
            });
          }
      });

    assert.equal(
      calls,
      2
    );

    assert.equal(
      report.applyCapability,
      false
    );

    assert.equal(
      report.stagingWritesAttempted,
      false
    );

    assert.equal(
      report.productionAccess,
      false
    );
  }
);

run().catch(error => {
  console.error(
    error.stack || error
  );

  process.exitCode = 1;
});