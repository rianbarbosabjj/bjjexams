'use strict';

const crypto =
  require('node:crypto');

const {
  validateExamTemplate,
  validateExamTemplateVersion
} = require('../exams/exam-template-domain');

const {
  validateExamQuestionSnapshot
} = require('../exams/exam-question-domain');

const {
  buildExamTemplateMigrationPlan,
  stableJson
} = require('./exam-template-v1_2');

const LOCAL_PROJECT_PATTERN =
  /^demo-[a-z0-9-]+$/;

const MAX_FIRESTORE_BATCH_WRITES =
  500;

class ExamTemplateMigrationExecutorError
  extends Error {
  constructor(code, message) {
    super(message);
    this.name =
      'ExamTemplateMigrationExecutorError';
    this.code = code;
  }
}

function assertLocalEmulator(
  projectId
) {
  const host =
    process.env
      .FIRESTORE_EMULATOR_HOST;

  if (
    !host ||
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(
      host
    )
  ) {
    throw new ExamTemplateMigrationExecutorError(
      'EXAM_MIGRATION_EMULATOR_REQUIRED',
      'Executor exige Firestore Emulator local.'
    );
  }

  if (
    projectId === 'bjj-exams' ||
    projectId === 'bjj-exams-staging'
  ) {
    throw new ExamTemplateMigrationExecutorError(
      'EXAM_MIGRATION_REMOTE_PROJECT_BLOCKED',
      'Projeto remoto é proibido neste executor.'
    );
  }

  if (
    !LOCAL_PROJECT_PATTERN.test(
      String(projectId || '')
    )
  ) {
    throw new ExamTemplateMigrationExecutorError(
      'EXAM_MIGRATION_DEMO_PROJECT_REQUIRED',
      'Executor aceita somente projectId demo-* local.'
    );
  }

  return true;
}

async function readCollection(
  db,
  collectionName
) {
  const snapshot =
    await db
      .collection(collectionName)
      .get();

  return new Map(
    snapshot.docs.map(
      doc => [
        doc.id,
        doc.data() || {}
      ]
    )
  );
}

function collectReferencedQuestionIds(
  legacyConfigs
) {
  const ids = new Set();

  for (
    const config
    of legacyConfigs.values()
  ) {
    const values =
      Array.isArray(
        config?.questoes_ids
      )
        ? config.questoes_ids
        : [];

    for (const raw of values) {
      if (
        raw === undefined ||
        raw === null
      ) {
        continue;
      }

      const id =
        String(raw).trim();

      if (
        id &&
        !id.includes('/')
      ) {
        ids.add(id);
      }
    }
  }

  return [...ids].sort();
}

async function readDocumentsById(
  db,
  collectionName,
  ids
) {
  const result = new Map();

  for (
    let offset = 0;
    offset < ids.length;
    offset += 200
  ) {
    const chunk =
      ids.slice(
        offset,
        offset + 200
      );

    const refs =
      chunk.map(
        id =>
          db.doc(
            `${collectionName}/${id}`
          )
      );

    if (refs.length === 0) {
      continue;
    }

    const snapshots =
      await db.getAll(...refs);

    for (
      let index = 0;
      index < snapshots.length;
      index += 1
    ) {
      const snap =
        snapshots[index];

      if (snap.exists) {
        result.set(
          chunk[index],
          snap.data() || {}
        );
      }
    }
  }

  return result;
}

async function readCanonicalDocuments(
  db,
  paths
) {
  const result = new Map();

  const uniquePaths =
    [...new Set(paths)].sort();

  for (
    let offset = 0;
    offset < uniquePaths.length;
    offset += 200
  ) {
    const chunk =
      uniquePaths.slice(
        offset,
        offset + 200
      );

    const refs =
      chunk.map(
        path => db.doc(path)
      );

    if (refs.length === 0) {
      continue;
    }

    const snapshots =
      await db.getAll(...refs);

    for (
      let index = 0;
      index < snapshots.length;
      index += 1
    ) {
      const snap =
        snapshots[index];

      if (snap.exists) {
        result.set(
          chunk[index],
          snap.data() || {}
        );
      }
    }
  }

  return result;
}

function relevantConfigView(
  value = {}
) {
  return {
    faixa:
      value.faixa ?? null,

    questoes_ids:
      Array.isArray(
        value.questoes_ids
      )
        ? [...value.questoes_ids]
        : value.questoes_ids ?? null,

    tempo_limite:
      value.tempo_limite ?? null,

    nota_corte:
      value.nota_corte ?? null,

    aprovacao_minima:
      value.aprovacao_minima ?? null
  };
}

function relevantQuestionView(
  value = {}
) {
  return {
    pergunta:
      value.pergunta ?? null,

    alternativas:
      value.alternativas || null,

    resposta_correta:
      value.resposta_correta ?? null,

    dificuldade:
      value.dificuldade ?? null,

    categoria:
      value.categoria ?? null,

    status:
      value.status ?? null,

    url_imagem:
      value.url_imagem ?? null,

    url_video:
      value.url_video ?? null
  };
}

function fingerprintLegacy(
  legacyConfigs,
  legacyQuestions
) {
  const payload = {
    configs:
      [...legacyConfigs.entries()]
        .sort(
          ([a], [b]) =>
            a.localeCompare(b)
        )
        .map(
          ([id, value]) => [
            id,
            relevantConfigView(
              value
            )
          ]
        ),

    questions:
      [...legacyQuestions.entries()]
        .sort(
          ([a], [b]) =>
            a.localeCompare(b)
        )
        .map(
          ([id, value]) => [
            id,
            relevantQuestionView(
              value
            )
          ]
        )
  };

  return crypto
    .createHash('sha256')
    .update(
      stableJson(payload)
    )
    .digest('hex');
}

async function loadMigrationState(
  db
) {
  const legacyConfigs =
    await readCollection(
      db,
      'config_exames'
    );

  const referencedQuestionIds =
    collectReferencedQuestionIds(
      legacyConfigs
    );

  const legacyQuestions =
    await readDocumentsById(
      db,
      'questoes',
      referencedQuestionIds
    );

  const discoveryPlan =
    buildExamTemplateMigrationPlan({
      legacyConfigs,
      legacyQuestions,
      canonicalDocuments:
        new Map()
    });

  const targetPaths =
    discoveryPlan.actions.map(
      action => action.path
    );

  const canonicalDocuments =
    await readCanonicalDocuments(
      db,
      targetPaths
    );

  const plan =
    buildExamTemplateMigrationPlan({
      legacyConfigs,
      legacyQuestions,
      canonicalDocuments
    });

  return {
    legacyConfigs,
    legacyQuestions,
    referencedQuestionIds,
    canonicalDocuments,
    plan,
    legacyFingerprint:
      fingerprintLegacy(
        legacyConfigs,
        legacyQuestions
      )
  };
}

function templateIdFromPath(
  path
) {
  const parts =
    String(path).split('/');

  if (
    parts.length < 2 ||
    parts[0] !==
      'exam_templates' ||
    !parts[1]
  ) {
    throw new ExamTemplateMigrationExecutorError(
      'INVALID_CANONICAL_EXAM_PATH',
      'Path canônico inválido.'
    );
  }

  return parts[1];
}

function requireApplyTimestamp(
  value
) {
  if (
    !(value instanceof Date) ||
    Number.isNaN(
      value.getTime()
    )
  ) {
    throw new ExamTemplateMigrationExecutorError(
      'INVALID_EXAM_MIGRATION_CLOCK',
      'Clock local de teste retornou timestamp inválido.'
    );
  }

  return value;
}

function materializeAction(
  action,
  timestamp
) {
  if (
    action.entityType ===
    'template'
  ) {
    return validateExamTemplate({
      ...action.data,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  if (
    action.entityType ===
    'template_version'
  ) {
    return validateExamTemplateVersion({
      ...action.data,
      createdAt: timestamp,
      activatedAt: timestamp
    });
  }

  if (
    action.entityType ===
    'question_snapshot'
  ) {
    return validateExamQuestionSnapshot({
      ...action.data,
      createdAt: timestamp
    });
  }

  throw new ExamTemplateMigrationExecutorError(
    'UNSUPPORTED_EXAM_MIGRATION_ENTITY',
    'Tipo de entidade não suportado.'
  );
}

function prepareCreateGroups({
  db,
  plan,
  timestamp
}) {
  const groups =
    new Map();

  for (
    const action
    of plan.actions
  ) {
    if (
      action.operation !==
      'CREATE'
    ) {
      continue;
    }

    const templateId =
      templateIdFromPath(
        action.path
      );

    if (
      !groups.has(templateId)
    ) {
      groups.set(
        templateId,
        []
      );
    }

    groups.get(
      templateId
    ).push({
      path:
        action.path,

      ref:
        db.doc(action.path),

      payload:
        materializeAction(
          action,
          timestamp
        )
    });
  }

  const prepared =
    [...groups.entries()]
      .sort(
        ([a], [b]) =>
          a.localeCompare(b)
      )
      .map(
        ([templateId, actions]) => {
          actions.sort(
            (a, b) =>
              a.path.localeCompare(
                b.path
              )
          );

          if (
            actions.length >
            MAX_FIRESTORE_BATCH_WRITES
          ) {
            throw new ExamTemplateMigrationExecutorError(
              'EXAM_MIGRATION_BATCH_LIMIT_EXCEEDED',
              `Template ${templateId} excede limite atômico.`
            );
          }

          return {
            templateId,
            actions
          };
        }
      );

  return prepared;
}

function summary({
  mode,
  projectId,
  before,
  after,
  writesPerformed,
  batchesCommitted
}) {
  return {
    mode,
    projectId,

    migrationId:
      before.plan.migrationId,

    planSha256:
      before.plan.report
        .planSha256,

    planned: {
      create:
        before.plan.report.create,

      noChange:
        before.plan.report.noChange,

      conflict:
        before.plan.report.conflict,

      inconsistencyCount:
        before.plan.report
          .inconsistencyCount
    },

    counts: {
      legacyConfigs:
        before.legacyConfigs.size,

      referencedQuestions:
        before.referencedQuestionIds
          .length,

      canonicalTargetsBefore:
        before.canonicalDocuments.size,

      canonicalTargetsAfter:
        after.canonicalDocuments.size
    },

    writesPerformed,
    batchesCommitted,

    legacyFingerprintBefore:
      before.legacyFingerprint,

    legacyFingerprintAfter:
      after.legacyFingerprint,

    after: {
      create:
        after.plan.report.create,

      noChange:
        after.plan.report.noChange,

      conflict:
        after.plan.report.conflict,

      inconsistencyCount:
        after.plan.report
          .inconsistencyCount
    },

    inconsistencies:
      before.plan.report
        .inconsistencies
        .map(
          item => ({ ...item })
        )
  };
}

function assertStablePreflight(
  first,
  second
) {
  if (
    first.plan.report.planSha256 !==
    second.plan.report.planSha256
  ) {
    throw new ExamTemplateMigrationExecutorError(
      'EXAM_MIGRATION_PLAN_CHANGED',
      'Plano mudou entre leituras de preflight.'
    );
  }

  if (
    first.legacyFingerprint !==
    second.legacyFingerprint
  ) {
    throw new ExamTemplateMigrationExecutorError(
      'EXAM_MIGRATION_SOURCE_CHANGED',
      'Fonte legada mudou entre leituras de preflight.'
    );
  }

  if (
    first.canonicalDocuments.size !==
    second.canonicalDocuments.size
  ) {
    throw new ExamTemplateMigrationExecutorError(
      'EXAM_MIGRATION_TARGET_CHANGED',
      'Alvos canônicos mudaram entre leituras de preflight.'
    );
  }
}

async function runExamTemplateMigration({
  db,
  projectId,
  mode = 'dry-run',
  clock = () => new Date()
} = {}) {
  if (
    !db ||
    typeof db.collection !==
      'function' ||
    typeof db.doc !==
      'function' ||
    typeof db.batch !==
      'function'
  ) {
    throw new TypeError(
      'Firestore válido é obrigatório.'
    );
  }

  assertLocalEmulator(
    projectId
  );

  if (
    mode !== 'dry-run' &&
    mode !== 'apply'
  ) {
    throw new ExamTemplateMigrationExecutorError(
      'INVALID_EXAM_MIGRATION_MODE',
      'Mode precisa ser dry-run ou apply.'
    );
  }

  const first =
    await loadMigrationState(
      db
    );

  const second =
    await loadMigrationState(
      db
    );

  assertStablePreflight(
    first,
    second
  );

  if (mode === 'dry-run') {
    const after =
      await loadMigrationState(
        db
      );

    assertStablePreflight(
      second,
      after
    );

    return summary({
      mode,
      projectId,
      before: second,
      after,
      writesPerformed: 0,
      batchesCommitted: 0
    });
  }

  if (
    second.plan.report
      .inconsistencyCount > 0 ||
    second.plan.report.conflict > 0
  ) {
    throw new ExamTemplateMigrationExecutorError(
      'EXAM_TEMPLATE_MIGRATION_BLOCKED_BY_INCONSISTENCIES',
      'Apply bloqueado por inconsistências ou conflitos.'
    );
  }

  const timestamp =
    requireApplyTimestamp(
      clock()
    );

  const groups =
    prepareCreateGroups({
      db,
      plan:
        second.plan,
      timestamp
    });

  let writesPerformed = 0;
  let batchesCommitted = 0;

  for (const group of groups) {
    const batch =
      db.batch();

    for (
      const prepared
      of group.actions
    ) {
      batch.create(
        prepared.ref,
        prepared.payload
      );
    }

    if (
      group.actions.length > 0
    ) {
      await batch.commit();

      writesPerformed +=
        group.actions.length;

      batchesCommitted += 1;
    }
  }

  const after =
    await loadMigrationState(
      db
    );

  if (
    second.legacyFingerprint !==
    after.legacyFingerprint
  ) {
    throw new ExamTemplateMigrationExecutorError(
      'EXAM_MIGRATION_LEGACY_SOURCE_MUTATED',
      'Fonte legada mudou durante apply.'
    );
  }

  if (
    after.plan.report.create !== 0 ||
    after.plan.report.conflict !== 0 ||
    after.plan.report
      .inconsistencyCount !== 0
  ) {
    throw new ExamTemplateMigrationExecutorError(
      'EXAM_MIGRATION_POST_APPLY_VERIFICATION_FAILED',
      'Estado pós-apply não é idempotente.'
    );
  }

  return summary({
    mode,
    projectId,
    before: second,
    after,
    writesPerformed,
    batchesCommitted
  });
}

module.exports = {
  MAX_FIRESTORE_BATCH_WRITES,
  ExamTemplateMigrationExecutorError,
  assertLocalEmulator,
  collectReferencedQuestionIds,
  fingerprintLegacy,
  materializeAction,
  runExamTemplateMigration
};