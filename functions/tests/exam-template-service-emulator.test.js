'use strict';

const assert = require('node:assert/strict');

const {
  initializeApp,
  deleteApp
} = require('firebase-admin/app');

const {
  getFirestore
} = require('firebase-admin/firestore');

const {
  MAX_EXAM_TEMPLATE_QUESTIONS_PER_VERSION,
  ExamTemplateServiceError,
  createExamTemplateService
} = require('../src/exams/exam-template-service');

function assertLocal(name, value) {
  if (
    !value ||
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)
  ) {
    throw new Error(
      `${name} nao e local: ${value || '<EMPTY>'}`
    );
  }
}

assertLocal(
  'FIRESTORE_EMULATOR_HOST',
  process.env.FIRESTORE_EMULATOR_HOST
);

const projectId =
  'demo-bjj-exams-gate1c';

const app = initializeApp(
  {
    projectId
  },
  `exam-template-service-${process.pid}-${Date.now()}`
);

const db = getFirestore(app);

let now =
  new Date(
    '2026-09-21T15:00:00.000Z'
  );

const service =
  createExamTemplateService({
    db,
    clock: () =>
      new Date(now.getTime())
  });

const superAdmin = {
  super_admin: true
};

const platformAdmin = {
  platform_admin: true
};

let passed = 0;

async function test(name, fn) {
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

function expectServiceCode(code) {
  return error => (
    error instanceof
      ExamTemplateServiceError &&
    error.code === code
  );
}

function questions(prefix) {
  return [
    {
      prompt:
        `Pergunta ${prefix} 1`,
      alternatives: {
        A: 'SERVER_ONLY_ANSWER_SECRET',
        B: 'Resposta B',
        C: 'Resposta C',
        D: 'Resposta D'
      },
      correctAnswer: 'A',
      category: 'Fundamentos',
      difficulty: 2,
      media: null,
      sourceQuestionId:
        `${prefix}_question_1`
    },
    {
      prompt:
        `Pergunta ${prefix} 2`,
      alternatives: {
        A: 'Resposta A',
        B: 'Resposta correta',
        C: 'Resposta C',
        D: 'Resposta D'
      },
      correctAnswer: 'B',
      category: 'Regras',
      difficulty: 3,
      media: null,
      sourceQuestionId:
        `${prefix}_question_2`
    }
  ];
}

async function countAudit(action) {
  const snap =
    await db
      .collection('audit_logs')
      .where('action', '==', action)
      .get();

  return snap.size;
}

async function main() {
  let templateId;
  let version1;
  let version2;

  try {
    await test(
      'usuario sem role administrativa nao cria template',
      async () => {
        await assert.rejects(
          () =>
            service.createTemplate({
              actorId: 'user_1',
              claims: {},
              data: {
                name: 'Exame Azul',
                targetBelt: 'Azul'
              }
            }),
          expectServiceCode(
            'EXAM_TEMPLATE_ADMIN_PERMISSION_REQUIRED'
          )
        );
      }
    );

    await test(
      'super_admin cria template draft e audit',
      async () => {
        const result =
          await service.createTemplate({
            actorId: 'admin_super',
            claims: superAdmin,
            data: {
              name:
                'Exame Oficial Faixa Azul',
              targetBelt: 'Azul'
            }
          });

        templateId =
          result.templateId;

        assert.ok(templateId);

        assert.equal(
          result.template.status,
          'draft'
        );

        assert.equal(
          result.template.activeVersionId,
          null
        );

        const persisted =
          await db
            .doc(
              `exam_templates/${templateId}`
            )
            .get();

        assert.equal(
          persisted.exists,
          true
        );

        assert.equal(
          persisted.data().targetBelt,
          'Azul'
        );

        assert.equal(
          await countAudit(
            'exam.template.created'
          ),
          1
        );
      }
    );

    await test(
      'service rejeita campos administrativos injetados',
      async () => {
        await assert.rejects(
          () =>
            service.createTemplate({
              actorId: 'admin_super',
              claims: superAdmin,
              data: {
                name: 'Outro',
                targetBelt: 'Roxa',
                status: 'active'
              }
            }),
          expectServiceCode(
            'EXAM_TEMPLATE_FIELDS_NOT_ALLOWED'
          )
        );
      }
    );

    await test(
      'platform_admin cria versao draft e snapshots server-only',
      async () => {
        version1 =
          await service.createVersion({
            actorId:
              'admin_platform',
            claims:
              platformAdmin,
            data: {
              templateId,
              version: 1,
              timeLimitMinutes: 60,
              passingScoreBps: 7000,
              source: 'manual',
              questions:
                questions('v1')
            }
          });

        assert.equal(
          version1.versionId,
          'v0000001'
        );

        assert.equal(
          version1.snapshotCount,
          2
        );

        assert.equal(
          version1.version.status,
          'draft'
        );

        const firstQuestionId =
          version1.version
            .questionIds[0];

        const firstQuestion =
          await db.doc(
            `exam_templates/${templateId}` +
            `/versions/${version1.versionId}` +
            `/questions/${firstQuestionId}`
          ).get();

        assert.equal(
          firstQuestion.exists,
          true
        );

        assert.equal(
          firstQuestion.data()
            .correctAnswer,
          'A'
        );
      }
    );

    await test(
      'service rejeita campo desconhecido em questao',
      async () => {
        const invalid =
          questions('invalid');

        invalid[0].providerSecret =
          'never';

        await assert.rejects(
          () =>
            service.createVersion({
              actorId: 'admin_super',
              claims: superAdmin,
              data: {
                templateId,
                version: 9,
                timeLimitMinutes: 60,
                passingScoreBps: 7000,
                source: 'manual',
                questions: invalid
              }
            }),
          expectServiceCode(
            'EXAM_TEMPLATE_FIELDS_NOT_ALLOWED'
          )
        );
      }
    );

    await test(
      'service respeita limite atomico de 498 questoes',
      async () => {
        assert.equal(
          MAX_EXAM_TEMPLATE_QUESTIONS_PER_VERSION,
          498
        );

        await assert.rejects(
          () =>
            service.createVersion({
              actorId: 'admin_super',
              claims: superAdmin,
              data: {
                templateId,
                version: 8,
                timeLimitMinutes: 60,
                passingScoreBps: 7000,
                source: 'manual',
                questions:
                  new Array(
                    MAX_EXAM_TEMPLATE_QUESTIONS_PER_VERSION + 1
                  ).fill(null)
              }
            }),
          expectServiceCode(
            'EXAM_TEMPLATE_TOO_MANY_QUESTIONS'
          )
        );
      }
    );

    await test(
      'mesma versao nao pode ser criada duas vezes',
      async () => {
        await assert.rejects(
          () =>
            service.createVersion({
              actorId: 'admin_super',
              claims: superAdmin,
              data: {
                templateId,
                version: 1,
                timeLimitMinutes: 60,
                passingScoreBps: 7000,
                source: 'manual',
                questions:
                  questions('v1')
              }
            }),
          expectServiceCode(
            'EXAM_TEMPLATE_VERSION_ALREADY_EXISTS'
          )
        );
      }
    );

    await test(
      'snapshot ausente impede ativacao sem efeito parcial',
      async () => {
        version2 =
          await service.createVersion({
            actorId:
              'admin_super',
            claims:
              superAdmin,
            data: {
              templateId,
              version: 2,
              timeLimitMinutes: 55,
              passingScoreBps: 7500,
              source: 'manual',
              questions:
                questions('v2')
            }
          });

        const missingId =
          version2.version
            .questionIds[0];

        await db.doc(
          `exam_templates/${templateId}` +
          `/versions/${version2.versionId}` +
          `/questions/${missingId}`
        ).delete();

        await assert.rejects(
          () =>
            service.activateVersion({
              actorId: 'admin_super',
              claims: superAdmin,
              data: {
                templateId,
                version: 2
              }
            }),
          expectServiceCode(
            'EXAM_TEMPLATE_SNAPSHOT_MISSING'
          )
        );

        const template =
          await db.doc(
            `exam_templates/${templateId}`
          ).get();

        const storedVersion =
          await db.doc(
            `exam_templates/${templateId}` +
            `/versions/${version2.versionId}`
          ).get();

        assert.equal(
          template.data()
            .activeVersionId,
          null
        );

        assert.equal(
          storedVersion.data().status,
          'draft'
        );
      }
    );

    await test(
      'ativacao de v1 e transacional e torna template active',
      async () => {
        now =
          new Date(
            '2026-09-21T15:10:00.000Z'
          );

        const activated =
          await service.activateVersion({
            actorId: 'admin_super',
            claims: superAdmin,
            data: {
              templateId,
              version: 1
            }
          });

        assert.equal(
          activated.alreadyActive,
          false
        );

        assert.equal(
          activated.version.status,
          'active'
        );

        assert.equal(
          activated.template.status,
          'active'
        );

        assert.equal(
          activated.template
            .activeVersionId,
          'v0000001'
        );
      }
    );

    await test(
      'retry da ativacao e idempotente e nao duplica audit',
      async () => {
        const before =
          await countAudit(
            'exam.template.version.activated'
          );

        now =
          new Date(
            '2026-09-21T15:20:00.000Z'
          );

        const again =
          await service.activateVersion({
            actorId:
              'admin_platform',
            claims:
              platformAdmin,
            data: {
              templateId,
              version: 1
            }
          });

        assert.equal(
          again.alreadyActive,
          true
        );

        const after =
          await countAudit(
            'exam.template.version.activated'
          );

        assert.equal(
          after,
          before
        );
      }
    );

    await test(
      'nova versao ativa aposenta versao anterior atomicamente',
      async () => {
        const version3 =
          await service.createVersion({
            actorId:
              'admin_platform',
            claims:
              platformAdmin,
            data: {
              templateId,
              version: 3,
              timeLimitMinutes: 50,
              passingScoreBps: 8000,
              source: 'manual',
              questions:
                questions('v3')
            }
          });

        now =
          new Date(
            '2026-09-21T15:30:00.000Z'
          );

        const activated =
          await service.activateVersion({
            actorId:
              'admin_platform',
            claims:
              platformAdmin,
            data: {
              templateId,
              version: 3
            }
          });

        assert.equal(
          activated.template
            .activeVersionId,
          version3.versionId
        );

        const old =
          await db.doc(
            `exam_templates/${templateId}` +
            `/versions/${version1.versionId}`
          ).get();

        const current =
          await db.doc(
            `exam_templates/${templateId}` +
            `/versions/${version3.versionId}`
          ).get();

        assert.equal(
          old.data().status,
          'retired'
        );

        assert.equal(
          current.data().status,
          'active'
        );
      }
    );

    await test(
      'audit nunca recebe gabarito nem conteudo secreto',
      async () => {
        const audits =
          await db
            .collection('audit_logs')
            .get();

        const serialized =
          JSON.stringify(
            audits.docs.map(
              doc => doc.data()
            )
          );

        assert.equal(
          serialized.includes(
            'correctAnswer'
          ),
          false
        );

        assert.equal(
          serialized.includes(
            'resposta_correta'
          ),
          false
        );

        assert.equal(
          serialized.includes(
            'SERVER_ONLY_ANSWER_SECRET'
          ),
          false
        );
      }
    );

    console.log(
      `EXAM_TEMPLATE_SERVICE_EMULATOR_V1_2=${passed}/12`
    );

    if (passed !== 12) {
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