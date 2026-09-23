'use strict';

const crypto =
  require('node:crypto');

const {
  buildExamTemplateMigrationPlan,
  stableJson
} = require('./exam-template-v1_2');

const STAGING_PROJECT =
  'bjj-exams-staging';

class ExamTemplateStagingPreflightError
  extends Error {
  constructor(code, message) {
    super(message);
    this.name =
      'ExamTemplateStagingPreflightError';
    this.code = code;
  }
}

function parseNamedArgument(
  args,
  name
) {
  const exact =
    `--${name}`;

  const prefix =
    `${exact}=`;

  for (const value of args) {
    if (value === exact) {
      return true;
    }

    if (
      typeof value === 'string' &&
      value.startsWith(prefix)
    ) {
      return value.slice(
        prefix.length
      );
    }
  }

  return null;
}

function assertStagingReadOnlyEnvironment({
  projectId,
  firestoreHost =
    process.env
      .FIRESTORE_EMULATOR_HOST,
  authHost =
    process.env
      .FIREBASE_AUTH_EMULATOR_HOST
} = {}) {
  if (projectId === 'bjj-exams') {
    throw new ExamTemplateStagingPreflightError(
      'STAGING_PREFLIGHT_PRODUCTION_BLOCKED',
      'Produção é proibida neste preflight.'
    );
  }

  if (
    projectId !==
    STAGING_PROJECT
  ) {
    throw new ExamTemplateStagingPreflightError(
      'STAGING_PREFLIGHT_PROJECT_BLOCKED',
      'Preflight permitido apenas em staging.'
    );
  }

  if (
    firestoreHost ||
    authHost
  ) {
    throw new ExamTemplateStagingPreflightError(
      'STAGING_PREFLIGHT_EMULATOR_VARIABLES_BLOCKED',
      'Variáveis de emulator não podem estar presentes.'
    );
  }

  return true;
}

function validateStagingPreflightArguments({
  args = [],
  env = process.env
} = {}) {
  const allowed =
    new Set([
      '--dry-run',
      `--project=${STAGING_PROJECT}`
    ]);

  const unsupported =
    args.filter(
      value =>
        !allowed.has(value)
    );

  if (unsupported.length > 0) {
    throw new ExamTemplateStagingPreflightError(
      'STAGING_PREFLIGHT_ARGUMENT_BLOCKED',
      'Argumento não permitido no preflight.'
    );
  }

  if (
    parseNamedArgument(
      args,
      'apply'
    ) !== null
  ) {
    throw new ExamTemplateStagingPreflightError(
      'STAGING_PREFLIGHT_APPLY_BLOCKED',
      '--apply é proibido no preflight.'
    );
  }

  if (
    parseNamedArgument(
      args,
      'dry-run'
    ) !== true
  ) {
    throw new ExamTemplateStagingPreflightError(
      'STAGING_PREFLIGHT_DRY_RUN_REQUIRED',
      '--dry-run é obrigatório.'
    );
  }

  const projectId =
    parseNamedArgument(
      args,
      'project'
    );

  assertStagingReadOnlyEnvironment({
    projectId,
    firestoreHost:
      env
        .FIRESTORE_EMULATOR_HOST,
    authHost:
      env
        .FIREBASE_AUTH_EMULATOR_HOST
  });

  return {
    projectId,
    mode: 'dry-run'
  };
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
  const ids =
    new Set();

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
  const result =
    new Map();

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
      const snapshot =
        snapshots[index];

      if (snapshot.exists) {
        result.set(
          chunk[index],
          snapshot.data() || {}
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
  const result =
    new Map();

  const unique =
    [...new Set(paths)]
      .sort();

  for (
    let offset = 0;
    offset < unique.length;
    offset += 200
  ) {
    const chunk =
      unique.slice(
        offset,
        offset + 200
      );

    const refs =
      chunk.map(
        path =>
          db.doc(path)
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
      const snapshot =
        snapshots[index];

      if (snapshot.exists) {
        result.set(
          chunk[index],
          snapshot.data() || {}
        );
      }
    }
  }

  return result;
}

function configFingerprintView(
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

function questionFingerprintView(
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

function legacyFingerprint(
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
            configFingerprintView(
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
            questionFingerprintView(
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

function canonicalFingerprintValue(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value ?? null;
  }

  if (value instanceof Date) {
    return {
      __type: 'Date',
      value:
        value.toISOString()
    };
  }

  if (
    typeof value === 'object' &&
    typeof value.toMillis ===
      'function'
  ) {
    return {
      __type: 'TimestampMillis',
      value:
        value.toMillis()
    };
  }

  if (Array.isArray(value)) {
    return value.map(
      canonicalFingerprintValue
    );
  }

  if (
    typeof value === 'object'
  ) {
    return Object.keys(value)
      .sort()
      .reduce(
        (result, key) => {
          if (
            value[key] !==
            undefined
          ) {
            result[key] =
              canonicalFingerprintValue(
                value[key]
              );
          }

          return result;
        },
        {}
      );
  }

  return value;
}

function canonicalFingerprint(
  canonicalDocuments
) {
  const payload =
    [...canonicalDocuments.entries()]
      .sort(
        ([left], [right]) =>
          left.localeCompare(right)
      )
      .map(
        ([path, value]) => [
          path,
          canonicalFingerprintValue(
            value
          )
        ]
      );

  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(payload)
    )
    .digest('hex');
}

async function loadStagingMigrationState(
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
      action =>
        action.path
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
      legacyFingerprint(
        legacyConfigs,
        legacyQuestions
      ),

    canonicalFingerprint:
      canonicalFingerprint(
        canonicalDocuments
      )
  };
}

function assertStableReadOnlyState(
  first,
  second
) {
  if (
    first.plan.report
      .planSha256 !==
    second.plan.report
      .planSha256
  ) {
    throw new ExamTemplateStagingPreflightError(
      'STAGING_PREFLIGHT_PLAN_CHANGED',
      'Plano mudou entre leituras.'
    );
  }

  if (
    first.legacyFingerprint !==
    second.legacyFingerprint
  ) {
    throw new ExamTemplateStagingPreflightError(
      'STAGING_PREFLIGHT_SOURCE_CHANGED',
      'Fonte legada mudou entre leituras.'
    );
  }

  if (
    first.canonicalDocuments
      .size !==
      second.canonicalDocuments
        .size ||
    first.canonicalFingerprint !==
      second.canonicalFingerprint
  ) {
    throw new ExamTemplateStagingPreflightError(
      'STAGING_PREFLIGHT_TARGET_CHANGED',
      'Estado canônico mudou entre leituras.'
    );
  }

  return true;
}

function countByEntity(
  actions,
  operation
) {
  const result = {
    templates: 0,
    versions: 0,
    questionSnapshots: 0
  };

  for (const action of actions) {
    if (
      action.operation !==
      operation
    ) {
      continue;
    }

    if (
      action.entityType ===
      'template'
    ) {
      result.templates += 1;
    } else if (
      action.entityType ===
      'template_version'
    ) {
      result.versions += 1;
    } else if (
      action.entityType ===
      'question_snapshot'
    ) {
      result.questionSnapshots += 1;
    }
  }

  return result;
}

function inconsistencyCodeCounts(
  inconsistencies = []
) {
  const counts = {};

  for (
    const item
    of inconsistencies
  ) {
    const code =
      String(
        item?.code ||
        'UNKNOWN'
      );

    counts[code] =
      (counts[code] || 0) + 1;
  }

  return Object.keys(counts)
    .sort()
    .reduce(
      (result, key) => {
        result[key] =
          counts[key];

        return result;
      },
      {}
    );
}

function buildStagingPreflightReport({
  projectId,
  first,
  second
}) {
  assertStagingReadOnlyEnvironment({
    projectId,
    firestoreHost: null,
    authHost: null
  });

  assertStableReadOnlyState(
    first,
    second
  );

  const report =
    second.plan.report;

  const actions =
    second.plan.actions;

  return {
    formatVersion: 1,

    migrationId:
      second.plan.migrationId,

    mode:
      'STAGING_DRY_RUN',

    projectId,

    planSha256:
      report.planSha256,

    counts: {
      legacyConfigs:
        second.legacyConfigs.size,

      referencedQuestions:
        second.referencedQuestionIds
          .length,

      canonicalTargetsFirst:
        first.canonicalDocuments.size,

      canonicalTargetsSecond:
        second.canonicalDocuments.size
    },

    planned: {
      create:
        report.create,

      noChange:
        report.noChange,

      conflict:
        report.conflict,

      inconsistencyCount:
        report.inconsistencyCount,

      createByEntity:
        countByEntity(
          actions,
          'CREATE'
        ),

      noChangeByEntity:
        countByEntity(
          actions,
          'NO_CHANGE'
        ),

      conflictByEntity:
        countByEntity(
          actions,
          'CONFLICT'
        )
    },

    inconsistencyCodes:
      inconsistencyCodeCounts(
        report.inconsistencies
      ),

    sourceStable: true,
    targetStable: true,

    stagingWritesAttempted:
      false,

    applyCapability:
      false,

    productionAccess:
      false,

    applyReady:
      (
        report.conflict === 0 &&
        report.inconsistencyCount === 0
      )
  };
}

async function runExamTemplateStagingPreflight({
  db,
  projectId,
  environment = {},
  loadState =
    loadStagingMigrationState
} = {}) {
  if (
    !db ||
    typeof db.collection !==
      'function' ||
    typeof db.doc !==
      'function'
  ) {
    throw new TypeError(
      'Firestore válido é obrigatório.'
    );
  }

  assertStagingReadOnlyEnvironment({
    projectId,

    firestoreHost:
      environment.firestoreHost ??
      process.env
        .FIRESTORE_EMULATOR_HOST,

    authHost:
      environment.authHost ??
      process.env
        .FIREBASE_AUTH_EMULATOR_HOST
  });

  const first =
    await loadState(db);

  const second =
    await loadState(db);

  return buildStagingPreflightReport({
    projectId,
    first,
    second
  });
}

module.exports = {
  STAGING_PROJECT,
  ExamTemplateStagingPreflightError,
  parseNamedArgument,
  assertStagingReadOnlyEnvironment,
  validateStagingPreflightArguments,
  collectReferencedQuestionIds,
  legacyFingerprint,
  canonicalFingerprintValue,
  canonicalFingerprint,
  loadStagingMigrationState,
  assertStableReadOnlyState,
  countByEntity,
  inconsistencyCodeCounts,
  buildStagingPreflightReport,
  runExamTemplateStagingPreflight
};