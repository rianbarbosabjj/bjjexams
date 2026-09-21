'use strict';

const crypto = require('crypto');

const {
  requireBelt
} = require('../exams/exam-session-domain');

const {
  legacyExamTemplateDocumentId,
  examTemplateVersionDocumentId,
  buildExamTemplate,
  validateExamTemplate,
  buildDraftExamTemplateVersion,
  activateExamTemplateVersion
} = require('../exams/exam-template-domain');

const {
  examQuestionSnapshotDocumentId,
  buildExamQuestionSnapshot
} = require('../exams/exam-question-domain');

const {
  MAX_EXAM_TEMPLATE_QUESTIONS_PER_VERSION
} = require('../exams/exam-template-service');

const EXAM_TEMPLATE_MIGRATION_ID =
  'legacy-exam-template-v1_2';

const EXAM_TEMPLATE_MIGRATION_ACTOR =
  'exam-template-migration-v1_2';

const EXAM_TEMPLATE_MIGRATION_SOURCE =
  'legacy_config_exames';

const VALIDATION_TIMESTAMP =
  new Date('1970-01-01T00:00:00.000Z');

class ExamTemplateMigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamTemplateMigrationError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, max);
}

function requireMap(value, field) {
  if (!(value instanceof Map)) {
    throw new ExamTemplateMigrationError(
      'EXAM_TEMPLATE_MIGRATION_MAP_REQUIRED',
      `${field} precisa ser Map.`
    );
  }

  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    return Object.keys(value)
      .sort()
      .reduce(
        (result, key) => {
          result[key] =
            canonicalize(value[key]);

          return result;
        },
        {}
      );
  }

  return value;
}

function stableJson(value) {
  return JSON.stringify(
    canonicalize(value)
  );
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex');
}

function opaqueRef(namespace, value) {
  return sha256(
    `${namespace}:${String(value)}`
  ).slice(0, 16);
}

function configured(value) {
  return (
    value !== undefined &&
    value !== null &&
    String(value).trim() !== ''
  );
}

function issue({
  code,
  targetBelt = null,
  configId = null,
  questionId = null,
  entityPath = null
}) {
  const result = {
    code,
    targetBelt:
      targetBelt || null
  };

  if (configId !== null) {
    result.configRef =
      opaqueRef(
        'legacy-config',
        configId
      );
  }

  if (questionId !== null) {
    result.questionRef =
      opaqueRef(
        'legacy-question',
        questionId
      );
  }

  if (entityPath !== null) {
    result.entityRef =
      opaqueRef(
        'canonical-entity',
        entityPath
      );
  }

  return result;
}

function requireTimeLimit(value) {
  if (!configured(value)) {
    return 60;
  }

  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    number > 1440
  ) {
    throw new ExamTemplateMigrationError(
      'INVALID_LEGACY_EXAM_TIME_LIMIT',
      'tempo_limite legado inválido.'
    );
  }

  return number;
}

function requirePassingScoreBps(
  config = {}
) {
  let raw = 70;

  if (configured(config.nota_corte)) {
    raw = config.nota_corte;
  } else if (
    configured(
      config.aprovacao_minima
    )
  ) {
    raw =
      config.aprovacao_minima;
  }

  const percentage =
    Number(raw);

  if (
    !Number.isFinite(percentage) ||
    percentage <= 0 ||
    percentage > 100
  ) {
    throw new ExamTemplateMigrationError(
      'INVALID_LEGACY_EXAM_PASSING_SCORE',
      'Nota de corte legada inválida.'
    );
  }

  const scaled =
    percentage * 100;

  const bps =
    Math.round(scaled);

  if (
    !Number.isSafeInteger(bps) ||
    Math.abs(scaled - bps) >
      0.0000001
  ) {
    throw new ExamTemplateMigrationError(
      'INVALID_LEGACY_EXAM_PASSING_SCORE',
      'Nota de corte legada excede precisão suportada.'
    );
  }

  return bps;
}

function requireLegacyQuestionIds(
  value
) {
  if (!Array.isArray(value)) {
    throw new ExamTemplateMigrationError(
      'LEGACY_EXAM_QUESTION_IDS_REQUIRED',
      'questoes_ids precisa ser array.'
    );
  }

  if (value.length === 0) {
    throw new ExamTemplateMigrationError(
      'LEGACY_EXAM_QUESTIONS_REQUIRED',
      'Configuração legada não possui questões.'
    );
  }

  if (
    value.length >
    MAX_EXAM_TEMPLATE_QUESTIONS_PER_VERSION
  ) {
    throw new ExamTemplateMigrationError(
      'LEGACY_EXAM_TOO_MANY_QUESTIONS',
      'Configuração legada excede limite canônico.'
    );
  }

  const normalized =
    value.map(item => {
      const id = text(item, 200);

      if (!id || id.includes('/')) {
        throw new ExamTemplateMigrationError(
          'INVALID_LEGACY_EXAM_QUESTION_ID',
          'questoes_ids contém identificador inválido.'
        );
      }

      return id;
    });

  if (
    new Set(normalized).size !==
    normalized.length
  ) {
    throw new ExamTemplateMigrationError(
      'DUPLICATE_LEGACY_EXAM_QUESTION',
      'Configuração legada repete questão.'
    );
  }

  return normalized;
}

function cleanLegacyAlternatives(
  value
) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return value;
  }

  const cleaned = {};

  for (
    const [label, raw]
    of Object.entries(value)
  ) {
    const normalized =
      text(raw, 1200);

    if (normalized) {
      cleaned[label] =
        normalized;
    }
  }

  return cleaned;
}

function buildLegacyQuestionSnapshot({
  questionId,
  question
}) {
  if (
    !question ||
    typeof question !== 'object' ||
    Array.isArray(question)
  ) {
    throw new ExamTemplateMigrationError(
      'INVALID_LEGACY_QUESTION_DOCUMENT',
      'Documento legado de questão inválido.'
    );
  }

  const status =
    text(question.status, 40)
      ?.toLocaleLowerCase('pt-BR') ||
    null;

  if (status !== 'aprovada') {
    throw new ExamTemplateMigrationError(
      'LEGACY_QUESTION_NOT_APPROVED',
      'Questão referenciada não está aprovada.'
    );
  }

  const snapshot =
    buildExamQuestionSnapshot({
      prompt:
        question.pergunta,

      alternatives:
        cleanLegacyAlternatives(
          question.alternativas
        ),

      correctAnswer:
        question.resposta_correta,

      category:
        question.categoria,

      difficulty:
        question.dificuldade,

      media: {
        imageUrl:
          text(
            question.url_imagem,
            2000
          ),

        videoUrl:
          text(
            question.url_video,
            2000
          )
      },

      sourceQuestionId:
        questionId,

      timestamp:
        VALIDATION_TIMESTAMP
    });

  return {
    snapshotVersion:
      snapshot.snapshotVersion,

    prompt:
      snapshot.prompt,

    alternatives: {
      ...snapshot.alternatives
    },

    correctAnswer:
      snapshot.correctAnswer,

    category:
      snapshot.category,

    difficulty:
      snapshot.difficulty,

    media: {
      imageUrl:
        snapshot.media.imageUrl,

      videoUrl:
        snapshot.media.videoUrl
    },

    sourceQuestionId:
      snapshot.sourceQuestionId
  };
}

function buildDesiredTemplate({
  targetBelt,
  activeVersionId
}) {
  const draft =
    buildExamTemplate({
      name:
        `Exame Oficial Faixa ${targetBelt}`,

      targetBelt,

      createdBy:
        EXAM_TEMPLATE_MIGRATION_ACTOR,

      timestamp:
        VALIDATION_TIMESTAMP
    });

  const active =
    validateExamTemplate({
      ...draft,

      status: 'active',

      activeVersionId,

      updatedAt:
        VALIDATION_TIMESTAMP
    });

  return {
    name:
      active.name,

    targetBelt:
      active.targetBelt,

    status:
      active.status,

    activeVersionId:
      active.activeVersionId,

    createdBy:
      EXAM_TEMPLATE_MIGRATION_ACTOR
  };
}

function buildDesiredVersion({
  templateId,
  versionNumber,
  timeLimitMinutes,
  passingScoreBps,
  questionIds
}) {
  const draft =
    buildDraftExamTemplateVersion({
      templateId,

      version:
        versionNumber,

      timeLimitMinutes,

      passingScoreBps,

      questionIds,

      source:
        EXAM_TEMPLATE_MIGRATION_SOURCE,

      createdBy:
        EXAM_TEMPLATE_MIGRATION_ACTOR,

      timestamp:
        VALIDATION_TIMESTAMP
    });

  const active =
    activateExamTemplateVersion(
      draft,
      VALIDATION_TIMESTAMP
    );

  return {
    templateId:
      active.templateId,

    version:
      active.version,

    status:
      active.status,

    timeLimitMinutes:
      active.timeLimitMinutes,

    passingScoreBps:
      active.passingScoreBps,

    questionCount:
      active.questionCount,

    questionIds:
      [...active.questionIds],

    source:
      active.source,

    createdBy:
      EXAM_TEMPLATE_MIGRATION_ACTOR
  };
}

function comparisonView(
  entityType,
  input = {}
) {
  if (entityType === 'template') {
    return {
      name:
        input.name ?? null,

      targetBelt:
        input.targetBelt ?? null,

      status:
        input.status ?? null,

      activeVersionId:
        input.activeVersionId ?? null,

      createdBy:
        input.createdBy ?? null
    };
  }

  if (
    entityType ===
    'template_version'
  ) {
    return {
      templateId:
        input.templateId ?? null,

      version:
        Number(input.version),

      status:
        input.status ?? null,

      timeLimitMinutes:
        Number(
          input.timeLimitMinutes
        ),

      passingScoreBps:
        Number(
          input.passingScoreBps
        ),

      questionCount:
        Number(
          input.questionCount
        ),

      questionIds:
        Array.isArray(
          input.questionIds
        )
          ? [...input.questionIds]
          : [],

      source:
        input.source ?? null,

      createdBy:
        input.createdBy ?? null
    };
  }

  if (
    entityType ===
    'question_snapshot'
  ) {
    return {
      snapshotVersion:
        Number(
          input.snapshotVersion
        ),

      prompt:
        input.prompt ?? null,

      alternatives:
        input.alternatives || {},

      correctAnswer:
        input.correctAnswer ?? null,

      category:
        input.category ?? null,

      difficulty:
        Number(input.difficulty),

      media: {
        imageUrl:
          input.media?.imageUrl ??
          null,

        videoUrl:
          input.media?.videoUrl ??
          null
      },

      sourceQuestionId:
        input.sourceQuestionId ??
        null
    };
  }

  throw new ExamTemplateMigrationError(
    'INVALID_MIGRATION_ENTITY_TYPE',
    'Tipo de entidade de migração inválido.'
  );
}

function classifyAction({
  entityType,
  path,
  data,
  canonicalDocuments
}) {
  if (
    !canonicalDocuments.has(path)
  ) {
    return 'CREATE';
  }

  const existing =
    comparisonView(
      entityType,
      canonicalDocuments.get(path) || {}
    );

  const desired =
    comparisonView(
      entityType,
      data
    );

  if (
    stableJson(existing) ===
    stableJson(desired)
  ) {
    return 'NO_CHANGE';
  }

  return 'CONFLICT';
}

function operationCounts(actions) {
  return actions.reduce(
    (counts, action) => {
      counts[
        action.operation
      ] += 1;

      return counts;
    },
    {
      CREATE: 0,
      NO_CHANGE: 0,
      CONFLICT: 0
    }
  );
}

function buildExamTemplateMigrationPlan(
  input = {}
) {
  const legacyConfigs =
    requireMap(
      input.legacyConfigs,
      'legacyConfigs'
    );

  const legacyQuestions =
    requireMap(
      input.legacyQuestions,
      'legacyQuestions'
    );

  const canonicalDocuments =
    input.canonicalDocuments ===
      undefined
      ? new Map()
      : requireMap(
          input.canonicalDocuments,
          'canonicalDocuments'
        );

  const actions = [];
  const inconsistencies = [];
  const seenBelts = new Set();

  const configEntries =
    [...legacyConfigs.entries()]
      .sort(
        ([a], [b]) =>
          String(a).localeCompare(
            String(b)
          )
      );

  for (
    const [configIdRaw, rawConfig]
    of configEntries
  ) {
    const configId =
      text(configIdRaw, 200);

    const config =
      rawConfig &&
      typeof rawConfig === 'object' &&
      !Array.isArray(rawConfig)
        ? rawConfig
        : {};

    let targetBelt;

    try {
      targetBelt =
        requireBelt(
          configId,
          'legacyConfigId'
        );
    } catch (_) {
      inconsistencies.push(
        issue({
          code:
            'INVALID_LEGACY_EXAM_BELT',
          configId
        })
      );

      continue;
    }

    if (
      seenBelts.has(targetBelt)
    ) {
      inconsistencies.push(
        issue({
          code:
            'DUPLICATE_LEGACY_BELT_CONFIG',
          targetBelt,
          configId
        })
      );

      continue;
    }

    seenBelts.add(targetBelt);

    if (configured(config.faixa)) {
      let declaredBelt;

      try {
        declaredBelt =
          requireBelt(
            config.faixa,
            'config.faixa'
          );
      } catch (_) {
        inconsistencies.push(
          issue({
            code:
              'INVALID_LEGACY_DECLARED_BELT',
            targetBelt,
            configId
          })
        );

        continue;
      }

      if (
        declaredBelt !==
        targetBelt
      ) {
        inconsistencies.push(
          issue({
            code:
              'LEGACY_EXAM_BELT_MISMATCH',
            targetBelt,
            configId
          })
        );

        continue;
      }
    }

    let sourceQuestionIds;
    let timeLimitMinutes;
    let passingScoreBps;

    try {
      sourceQuestionIds =
        requireLegacyQuestionIds(
          config.questoes_ids
        );

      timeLimitMinutes =
        requireTimeLimit(
          config.tempo_limite
        );

      passingScoreBps =
        requirePassingScoreBps(
          config
        );
    } catch (error) {
      inconsistencies.push(
        issue({
          code:
            error?.code ||
            'INVALID_LEGACY_EXAM_CONFIG',
          targetBelt,
          configId
        })
      );

      continue;
    }

    const issueCountBefore =
      inconsistencies.length;

    const snapshots = [];

    for (
      const sourceQuestionId
      of sourceQuestionIds
    ) {
      if (
        !legacyQuestions.has(
          sourceQuestionId
        )
      ) {
        inconsistencies.push(
          issue({
            code:
              'LEGACY_EXAM_QUESTION_MISSING',
            targetBelt,
            configId,
            questionId:
              sourceQuestionId
          })
        );

        continue;
      }

      try {
        const snapshot =
          buildLegacyQuestionSnapshot({
            questionId:
              sourceQuestionId,

            question:
              legacyQuestions.get(
                sourceQuestionId
              )
          });

        const snapshotId =
          examQuestionSnapshotDocumentId(
            sourceQuestionId
          );

        snapshots.push({
          sourceQuestionId,
          snapshotId,
          snapshot
        });
      } catch (error) {
        inconsistencies.push(
          issue({
            code:
              error?.code ||
              'INVALID_LEGACY_QUESTION',
            targetBelt,
            configId,
            questionId:
              sourceQuestionId
          })
        );
      }
    }

    if (
      inconsistencies.length !==
      issueCountBefore
    ) {
      continue;
    }

    const templateId =
      legacyExamTemplateDocumentId(
        targetBelt
      );

    const versionId =
      examTemplateVersionDocumentId(
        1
      );

    const snapshotIds =
      snapshots.map(
        item => item.snapshotId
      );

    const templateData =
      buildDesiredTemplate({
        targetBelt,
        activeVersionId:
          versionId
      });

    const versionData =
      buildDesiredVersion({
        templateId,
        versionNumber: 1,
        timeLimitMinutes,
        passingScoreBps,
        questionIds:
          snapshotIds
      });

    const desired = [
      {
        entityType:
          'template',

        path:
          `exam_templates/${templateId}`,

        data:
          templateData
      },

      {
        entityType:
          'template_version',

        path:
          `exam_templates/${templateId}` +
          `/versions/${versionId}`,

        data:
          versionData
      },

      ...snapshots.map(
        item => ({
          entityType:
            'question_snapshot',

          path:
            `exam_templates/${templateId}` +
            `/versions/${versionId}` +
            `/questions/${item.snapshotId}`,

          data:
            item.snapshot
        })
      )
    ];

    for (const item of desired) {
      const operation =
        classifyAction({
          ...item,
          canonicalDocuments
        });

      actions.push({
        operation,
        entityType:
          item.entityType,
        path:
          item.path,
        data:
          item.data
      });

      if (
        operation === 'CONFLICT'
      ) {
        inconsistencies.push(
          issue({
            code:
              'CANONICAL_EXAM_DOCUMENT_CONFLICT',
            targetBelt,
            configId,
            entityPath:
              item.path
          })
        );
      }
    }
  }

  actions.sort(
    (a, b) =>
      a.path.localeCompare(b.path)
  );

  const counts =
    operationCounts(actions);

  const fingerprintPayload = {
    migrationId:
      EXAM_TEMPLATE_MIGRATION_ID,

    timestampPolicy:
      'SERVER_APPLY_SINGLE_TIMESTAMP',

    actions,

    inconsistencies
  };

  const planSha256 =
    sha256(
      stableJson(
        fingerprintPayload
      )
    );

  const report = {
    migrationId:
      EXAM_TEMPLATE_MIGRATION_ID,

    timestampPolicy:
      'SERVER_APPLY_SINGLE_TIMESTAMP',

    legacyConfigCount:
      legacyConfigs.size,

    create:
      counts.CREATE,

    noChange:
      counts.NO_CHANGE,

    conflict:
      counts.CONFLICT,

    inconsistencyCount:
      inconsistencies.length,

    inconsistencies:
      inconsistencies.map(
        item => ({ ...item })
      ),

    planSha256
  };

  return {
    migrationId:
      EXAM_TEMPLATE_MIGRATION_ID,

    timestampPolicy:
      'SERVER_APPLY_SINGLE_TIMESTAMP',

    actions,

    inconsistencies,

    report
  };
}

module.exports = {
  EXAM_TEMPLATE_MIGRATION_ID,
  EXAM_TEMPLATE_MIGRATION_ACTOR,
  EXAM_TEMPLATE_MIGRATION_SOURCE,
  ExamTemplateMigrationError,
  canonicalize,
  stableJson,
  opaqueRef,
  requireTimeLimit,
  requirePassingScoreBps,
  requireLegacyQuestionIds,
  cleanLegacyAlternatives,
  buildLegacyQuestionSnapshot,
  buildExamTemplateMigrationPlan
};