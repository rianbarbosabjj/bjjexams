'use strict';

const assert =
  require('node:assert/strict');

const {
  initializeApp,
  deleteApp
} = require('firebase-admin/app');

const {
  getFirestore
} = require('firebase-admin/firestore');

const {
  legacyExamTemplateDocumentId,
  examTemplateVersionDocumentId
} = require('../src/exams/exam-template-domain');

const {
  examQuestionSnapshotDocumentId
} = require('../src/exams/exam-question-domain');

const {
  ExamTemplateMigrationExecutorError,
  runExamTemplateMigration
} = require('../src/migration/exam-template-v1_2-emulator-executor');

function assertLocalHost(
  name,
  value
) {
  if (
    !value ||
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(
      value
    )
  ) {
    throw new Error(
      `${name} nao e local: ${value || '<EMPTY>'}`
    );
  }
}

assertLocalHost(
  'FIRESTORE_EMULATOR_HOST',
  process.env
    .FIRESTORE_EMULATOR_HOST
);

const projectId =
  'demo-bjj-exams-gate1db';

const app =
  initializeApp(
    {
      projectId
    },
    `gate1db-${process.pid}-${Date.now()}`
  );

const db =
  getFirestore(app);

const fixedTime =
  new Date(
    '2026-09-21T18:00:00.000Z'
  );

let passed = 0;

async function test(
  name,
  fn
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

    console.error(
      error.stack || error
    );

    process.exitCode = 1;
  }
}

function expectExecutorCode(
  code
) {
  return error => (
    error instanceof
      ExamTemplateMigrationExecutorError &&
    error.code === code
  );
}

async function seedLegacy() {
  await db.doc(
    'config_exames/Azul'
  ).set({
    faixa: 'Azul',

    questoes_ids: [
      'question_secret_raw_id',
      'q2'
    ],

    tempo_limite: 60,

    aprovacao_minima: 70
  });

  await db.doc(
    'questoes/question_secret_raw_id'
  ).set({
    pergunta:
      'PROMPT_MUST_NOT_LEAK',

    alternativas: {
      A:
        'ANSWER_MUST_NOT_LEAK',
      B:
        'Resposta B',
      C:
        'Resposta C',
      D:
        'Resposta D'
    },

    resposta_correta:
      'A',

    dificuldade: 2,

    categoria:
      'Fundamentos',

    status:
      'aprovada'
  });

  await db.doc(
    'questoes/q2'
  ).set({
    pergunta:
      'Pergunta pública 2',

    alternativas: {
      A: 'Resposta A',
      B: 'Resposta B',
      C: 'Resposta C',
      D: 'Resposta D'
    },

    resposta_correta:
      'B',

    dificuldade: 3,

    categoria:
      'Regras',

    status:
      'aprovada'
  });
}

async function legacyRaw() {
  const config =
    await db.doc(
      'config_exames/Azul'
    ).get();

  const q1 =
    await db.doc(
      'questoes/question_secret_raw_id'
    ).get();

  const q2 =
    await db.doc(
      'questoes/q2'
    ).get();

  return {
    config:
      config.data(),
    q1:
      q1.data(),
    q2:
      q2.data()
  };
}

async function canonicalTargetCount() {
  const templateId =
    legacyExamTemplateDocumentId(
      'Azul'
    );

  const versionId =
    examTemplateVersionDocumentId(
      1
    );

  const paths = [
    `exam_templates/${templateId}`,

    `exam_templates/${templateId}` +
      `/versions/${versionId}`,

    `exam_templates/${templateId}` +
      `/versions/${versionId}` +
      `/questions/${
        examQuestionSnapshotDocumentId(
          'question_secret_raw_id'
        )
      }`,

    `exam_templates/${templateId}` +
      `/versions/${versionId}` +
      `/questions/${
        examQuestionSnapshotDocumentId(
          'q2'
        )
      }`
  ];

  const snapshots =
    await db.getAll(
      ...paths.map(
        path => db.doc(path)
      )
    );

  return snapshots.filter(
    snap => snap.exists
  ).length;
}

async function main() {
  try {
    await seedLegacy();

    const legacyBefore =
      await legacyRaw();

    await test(
      'executor bloqueia ids de staging e producao mesmo com emulator',
      async () => {
        await assert.rejects(
          () =>
            runExamTemplateMigration({
              db,
              projectId:
                'bjj-exams',
              mode: 'dry-run'
            }),
          expectExecutorCode(
            'EXAM_MIGRATION_REMOTE_PROJECT_BLOCKED'
          )
        );

        await assert.rejects(
          () =>
            runExamTemplateMigration({
              db,
              projectId:
                'bjj-exams-staging',
              mode: 'dry-run'
            }),
          expectExecutorCode(
            'EXAM_MIGRATION_REMOTE_PROJECT_BLOCKED'
          )
        );
      }
    );

    let dryRun;

    await test(
      'dry-run calcula plano e executa zero writes',
      async () => {
        assert.equal(
          await canonicalTargetCount(),
          0
        );

        dryRun =
          await runExamTemplateMigration({
            db,
            projectId,
            mode: 'dry-run'
          });

        assert.equal(
          dryRun.planned.create,
          4
        );

        assert.equal(
          dryRun.planned.noChange,
          0
        );

        assert.equal(
          dryRun.planned.conflict,
          0
        );

        assert.equal(
          dryRun.planned
            .inconsistencyCount,
          0
        );

        assert.equal(
          dryRun.counts
            .canonicalTargetsBefore,
          0
        );

        assert.equal(
          dryRun.counts
            .canonicalTargetsAfter,
          0
        );

        assert.equal(
          dryRun.writesPerformed,
          0
        );

        assert.equal(
          dryRun.batchesCommitted,
          0
        );

        assert.equal(
          await canonicalTargetCount(),
          0
        );
      }
    );

    await test(
      'relatorio do executor nao vaza gabarito prompt ou id legado',
      async () => {
        const serialized =
          JSON.stringify(
            dryRun
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
            serialized.includes(
              forbidden
            ),
            false
          );
        }
      }
    );

    let applied;

    await test(
      'apply local cria quatro documentos canonicos em batch atomico',
      async () => {
        applied =
          await runExamTemplateMigration({
            db,
            projectId,
            mode: 'apply',
            clock:
              () =>
                new Date(
                  fixedTime.getTime()
                )
          });

        assert.equal(
          applied.planned.create,
          4
        );

        assert.equal(
          applied.writesPerformed,
          4
        );

        assert.equal(
          applied.batchesCommitted,
          1
        );

        assert.equal(
          applied.counts
            .canonicalTargetsBefore,
          0
        );

        assert.equal(
          applied.counts
            .canonicalTargetsAfter,
          4
        );

        assert.equal(
          applied.after.create,
          0
        );

        assert.equal(
          applied.after.noChange,
          4
        );

        assert.equal(
          await canonicalTargetCount(),
          4
        );
      }
    );

    await test(
      'documentos aplicados possuem timestamps e gabarito permanece server-only',
      async () => {
        const templateId =
          legacyExamTemplateDocumentId(
            'Azul'
          );

        const versionId =
          examTemplateVersionDocumentId(
            1
          );

        const snapshotId =
          examQuestionSnapshotDocumentId(
            'question_secret_raw_id'
          );

        const [
          template,
          version,
          question
        ] = await db.getAll(
          db.doc(
            `exam_templates/${templateId}`
          ),

          db.doc(
            `exam_templates/${templateId}` +
            `/versions/${versionId}`
          ),

          db.doc(
            `exam_templates/${templateId}` +
            `/versions/${versionId}` +
            `/questions/${snapshotId}`
          )
        );

        assert.equal(
          template.data()
            .createdAt.toMillis(),
          fixedTime.getTime()
        );

        assert.equal(
          template.data()
            .updatedAt.toMillis(),
          fixedTime.getTime()
        );

        assert.equal(
          version.data()
            .createdAt.toMillis(),
          fixedTime.getTime()
        );

        assert.equal(
          version.data()
            .activatedAt.toMillis(),
          fixedTime.getTime()
        );

        assert.equal(
          question.data()
            .createdAt.toMillis(),
          fixedTime.getTime()
        );

        assert.equal(
          question.data()
            .correctAnswer,
          'A'
        );
      }
    );

    await test(
      'apply nao altera nenhuma fonte legada',
      async () => {
        const legacyAfter =
          await legacyRaw();

        assert.deepEqual(
          legacyAfter,
          legacyBefore
        );

        assert.equal(
          applied.legacyFingerprintBefore,
          applied.legacyFingerprintAfter
        );
      }
    );

    await test(
      'segunda execucao converte tudo em NO_CHANGE',
      async () => {
        const secondDryRun =
          await runExamTemplateMigration({
            db,
            projectId,
            mode: 'dry-run'
          });

        assert.equal(
          secondDryRun.planned.create,
          0
        );

        assert.equal(
          secondDryRun.planned.noChange,
          4
        );

        assert.equal(
          secondDryRun.writesPerformed,
          0
        );

        const secondApply =
          await runExamTemplateMigration({
            db,
            projectId,
            mode: 'apply',
            clock:
              () =>
                new Date(
                  '2026-09-21T19:00:00.000Z'
                )
          });

        assert.equal(
          secondApply.planned.create,
          0
        );

        assert.equal(
          secondApply.planned.noChange,
          4
        );

        assert.equal(
          secondApply.writesPerformed,
          0
        );

        assert.equal(
          secondApply.batchesCommitted,
          0
        );

        assert.equal(
          secondApply.counts
            .canonicalTargetsBefore,
          4
        );

        assert.equal(
          secondApply.counts
            .canonicalTargetsAfter,
          4
        );
      }
    );

    await test(
      'conflito canonico aparece no dry-run e bloqueia apply sem overwrite',
      async () => {
        const templateId =
          legacyExamTemplateDocumentId(
            'Azul'
          );

        const versionId =
          examTemplateVersionDocumentId(
            1
          );

        const snapshotId =
          examQuestionSnapshotDocumentId(
            'question_secret_raw_id'
          );

        const ref =
          db.doc(
            `exam_templates/${templateId}` +
            `/versions/${versionId}` +
            `/questions/${snapshotId}`
          );

        await ref.update({
          prompt:
            'DIVERGENCIA_CANONICA_INTENCIONAL'
        });

        const conflictDryRun =
          await runExamTemplateMigration({
            db,
            projectId,
            mode: 'dry-run'
          });

        assert.equal(
          conflictDryRun.planned.create,
          0
        );

        assert.equal(
          conflictDryRun.planned.conflict,
          1
        );

        assert.equal(
          conflictDryRun.planned
            .inconsistencyCount,
          1
        );

        assert.equal(
          conflictDryRun.writesPerformed,
          0
        );

        await assert.rejects(
          () =>
            runExamTemplateMigration({
              db,
              projectId,
              mode: 'apply'
            }),
          expectExecutorCode(
            'EXAM_TEMPLATE_MIGRATION_BLOCKED_BY_INCONSISTENCIES'
          )
        );

        const afterBlocked =
          await ref.get();

        assert.equal(
          afterBlocked.data().prompt,
          'DIVERGENCIA_CANONICA_INTENCIONAL'
        );

        assert.equal(
          await canonicalTargetCount(),
          4
        );
      }
    );

    console.log(
      `EXAM_TEMPLATE_MIGRATION_EMULATOR_V1_2=${passed}/8`
    );

    if (passed !== 8) {
      process.exitCode = 1;
    }
  } finally {
    await deleteApp(app);
  }
}

main().catch(async error => {
  console.error(
    error.stack || error
  );

  process.exitCode = 1;

  try {
    await deleteApp(app);
  } catch (_) {}
});