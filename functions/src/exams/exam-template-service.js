'use strict';

const {
  ExamTemplateDomainError,
  validateExamTemplate,
  buildExamTemplate,
  assertExamTemplateStatusTransition,
  examTemplateVersionDocumentId,
  validateExamTemplateVersion,
  buildDraftExamTemplateVersion,
  assertExamTemplateVersionStatusTransition,
  activateExamTemplateVersion,
  assertExamTemplateVersionContentImmutable
} = require('./exam-template-domain');

const {
  ExamQuestionDomainError,
  examQuestionSnapshotDocumentId,
  validateExamQuestionSnapshot,
  buildExamQuestionSnapshot
} = require('./exam-question-domain');

class ExamTemplateServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamTemplateServiceError';
    this.code = code;
  }
}

const MAX_EXAM_TEMPLATE_QUESTIONS_PER_VERSION = 498;

function text(value, max = 200) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, max);
}

function requiredIdentifier(value, field) {
  const id = text(value, 200);

  if (!id || id.includes('/')) {
    throw new ExamTemplateServiceError(
      'INVALID_EXAM_TEMPLATE_SERVICE_IDENTIFIER',
      `${field} inválido.`
    );
  }

  return id;
}

function assertAllowedFields(
  input,
  allowedFields,
  operation
) {
  if (
    input === null ||
    input === undefined ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    throw new ExamTemplateServiceError(
      'INVALID_EXAM_TEMPLATE_SERVICE_PAYLOAD',
      `${operation} exige objeto válido.`
    );
  }

  const allowed = new Set(allowedFields);

  const forbidden = Object.keys(input)
    .filter(key => !allowed.has(key));

  if (forbidden.length) {
    throw new ExamTemplateServiceError(
      'EXAM_TEMPLATE_FIELDS_NOT_ALLOWED',
      `${operation} contém campos não permitidos: ${forbidden.join(', ')}.`
    );
  }
}

function examTemplateAdminRole(claims = {}) {
  if (claims.super_admin === true) {
    return 'super_admin';
  }

  if (claims.platform_admin === true) {
    return 'platform_admin';
  }

  return null;
}

function assertExamTemplateAdmin(claims = {}) {
  const role = examTemplateAdminRole(claims);

  if (!role) {
    throw new ExamTemplateServiceError(
      'EXAM_TEMPLATE_ADMIN_PERMISSION_REQUIRED',
      'Templates oficiais exigem super_admin ou platform_admin.'
    );
  }

  return role;
}

function translateDomainError(error) {
  if (
    error instanceof ExamTemplateDomainError ||
    error instanceof ExamQuestionDomainError
  ) {
    throw new ExamTemplateServiceError(
      error.code,
      error.message
    );
  }

  throw error;
}

function createExamTemplateService(
  dependencies = {}
) {
  const {
    db,
    clock = () => new Date()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.runTransaction !== 'function'
  ) {
    throw new TypeError(
      'Exam template service exige Firestore válido.'
    );
  }

  function timestamp() {
    const value = clock();

    if (
      value === undefined ||
      value === null ||
      (
        value instanceof Date &&
        Number.isNaN(value.getTime())
      )
    ) {
      throw new ExamTemplateServiceError(
        'INVALID_EXAM_TEMPLATE_SERVICE_CLOCK',
        'Relógio server-side retornou timestamp inválido.'
      );
    }

    return value;
  }

  function actorContext(input = {}) {
    const actorId = requiredIdentifier(
      input.actorId,
      'actorId'
    );

    const role = assertExamTemplateAdmin(
      input.claims || {}
    );

    return {
      actorId,
      role
    };
  }

  function auditPayload({
    actor,
    action,
    entityType,
    entityId,
    before = null,
    after = null,
    createdAt
  }) {
    return {
      actorId: actor.actorId,
      actorRole: actor.role,
      action,
      entityType,
      entityId,
      before,
      after,
      source: 'service',
      requestId: null,
      createdAt
    };
  }

  function validateStoredTemplate(snapshot) {
    if (!snapshot?.exists) {
      throw new ExamTemplateServiceError(
        'EXAM_TEMPLATE_NOT_FOUND',
        'Template de exame não encontrado.'
      );
    }

    try {
      return validateExamTemplate(
        snapshot.data() || {}
      );
    } catch (error) {
      return translateDomainError(error);
    }
  }

  function validateStoredVersion(snapshot) {
    if (!snapshot?.exists) {
      throw new ExamTemplateServiceError(
        'EXAM_TEMPLATE_VERSION_NOT_FOUND',
        'Versão de template não encontrada.'
      );
    }

    try {
      return validateExamTemplateVersion(
        snapshot.data() || {}
      );
    } catch (error) {
      return translateDomainError(error);
    }
  }

  function versionAuditView(version) {
    return {
      templateId: version.templateId,
      version: version.version,
      status: version.status,
      timeLimitMinutes:
        version.timeLimitMinutes,
      passingScoreBps:
        version.passingScoreBps,
      questionCount:
        version.questionCount,
      source: version.source
    };
  }

  function templateAuditView(template) {
    return {
      name: template.name,
      targetBelt: template.targetBelt,
      status: template.status,
      activeVersionId:
        template.activeVersionId
    };
  }

  async function createTemplate(input = {}) {
    const actor = actorContext(input);
    const data = input.data || {};

    assertAllowedFields(
      data,
      [
        'name',
        'targetBelt'
      ],
      'createTemplate'
    );

    const now = timestamp();

    let template;

    try {
      template = buildExamTemplate({
        name: data.name,
        targetBelt: data.targetBelt,
        createdBy: actor.actorId,
        timestamp: now
      });
    } catch (error) {
      return translateDomainError(error);
    }

    const templateRef =
      db.collection('exam_templates').doc();

    const auditRef =
      db.collection('audit_logs').doc();

    await db.runTransaction(async tx => {
      tx.create(
        templateRef,
        template
      );

      tx.create(
        auditRef,
        auditPayload({
          actor,
          action: 'exam.template.created',
          entityType: 'exam_template',
          entityId: templateRef.id,
          before: null,
          after: templateAuditView(template),
          createdAt: now
        })
      );
    });

    return {
      templateId: templateRef.id,
      template
    };
  }

  function buildSnapshots(
    questions,
    now
  ) {
    if (!Array.isArray(questions)) {
      throw new ExamTemplateServiceError(
        'EXAM_TEMPLATE_QUESTIONS_ARRAY_REQUIRED',
        'questions precisa ser array.'
      );
    }

    if (questions.length > MAX_EXAM_TEMPLATE_QUESTIONS_PER_VERSION) {
      throw new ExamTemplateServiceError(
        'EXAM_TEMPLATE_TOO_MANY_QUESTIONS',
        `Uma versão suporta no máximo ${MAX_EXAM_TEMPLATE_QUESTIONS_PER_VERSION} questões.`
      );
    }

    return questions.map(
      (question, index) => {
        assertAllowedFields(
          question,
          [
            'prompt',
            'alternatives',
            'correctAnswer',
            'category',
            'difficulty',
            'media',
            'sourceQuestionId'
          ],
          `questions[${index}]`
        );

        let snapshot;

        try {
          snapshot =
            buildExamQuestionSnapshot({
              ...question,
              timestamp: now
            });
        } catch (error) {
          return translateDomainError(error);
        }

        const snapshotId =
          examQuestionSnapshotDocumentId(
            snapshot.sourceQuestionId
          );

        return {
          snapshotId,
          snapshot
        };
      }
    );
  }

  async function createVersion(input = {}) {
    const actor = actorContext(input);
    const data = input.data || {};

    assertAllowedFields(
      data,
      [
        'templateId',
        'version',
        'timeLimitMinutes',
        'passingScoreBps',
        'source',
        'questions'
      ],
      'createVersion'
    );

    const templateId =
      requiredIdentifier(
        data.templateId,
        'templateId'
      );

    const now = timestamp();

    const snapshots = buildSnapshots(
      data.questions,
      now
    );

    const questionIds = snapshots.map(
      item => item.snapshotId
    );

    let version;
    let versionId;

    try {
      versionId =
        examTemplateVersionDocumentId(
          data.version
        );

      version =
        buildDraftExamTemplateVersion({
          templateId,
          version: data.version,
          timeLimitMinutes:
            data.timeLimitMinutes,
          passingScoreBps:
            data.passingScoreBps,
          questionIds,
          source:
            data.source || 'manual',
          createdBy: actor.actorId,
          timestamp: now
        });
    } catch (error) {
      return translateDomainError(error);
    }

    const templateRef =
      db.doc(
        `exam_templates/${templateId}`
      );

    const versionRef =
      db.doc(
        `exam_templates/${templateId}/versions/${versionId}`
      );

    const questionRefs = snapshots.map(
      item =>
        db.doc(
          `exam_templates/${templateId}` +
          `/versions/${versionId}` +
          `/questions/${item.snapshotId}`
        )
    );

    const auditRef =
      db.collection('audit_logs').doc();

    await db.runTransaction(async tx => {
      const [
        templateSnap,
        versionSnap
      ] = await Promise.all([
        tx.get(templateRef),
        tx.get(versionRef)
      ]);

      const template =
        validateStoredTemplate(templateSnap);

      if (template.status === 'archived') {
        throw new ExamTemplateServiceError(
          'EXAM_TEMPLATE_ARCHIVED',
          'Template arquivado não aceita novas versões.'
        );
      }

      if (versionSnap.exists) {
        throw new ExamTemplateServiceError(
          'EXAM_TEMPLATE_VERSION_ALREADY_EXISTS',
          'Esta versão já existe.'
        );
      }

      tx.create(
        versionRef,
        version
      );

      for (
        let index = 0;
        index < snapshots.length;
        index += 1
      ) {
        tx.create(
          questionRefs[index],
          snapshots[index].snapshot
        );
      }

      tx.create(
        auditRef,
        auditPayload({
          actor,
          action:
            'exam.template.version.created',
          entityType:
            'exam_template_version',
          entityId:
            `${templateId}:${versionId}`,
          before: null,
          after:
            versionAuditView(version),
          createdAt: now
        })
      );
    });

    return {
      templateId,
      versionId,
      version,
      snapshotCount:
        snapshots.length
    };
  }

  async function validateVersionSnapshots(
    tx,
    templateId,
    versionId,
    version
  ) {
    const refs = version.questionIds.map(
      snapshotId =>
        db.doc(
          `exam_templates/${templateId}` +
          `/versions/${versionId}` +
          `/questions/${snapshotId}`
        )
    );

    if (refs.length === 0) {
      return [];
    }

    const docs = await tx.getAll(...refs);
    const snapshots = [];

    for (
      let index = 0;
      index < version.questionIds.length;
      index += 1
    ) {
      const snapshotId =
        version.questionIds[index];

      const snap = docs[index];

      if (!snap.exists) {
        throw new ExamTemplateServiceError(
          'EXAM_TEMPLATE_SNAPSHOT_MISSING',
          'Versão possui snapshot de questão ausente.'
        );
      }

      let snapshot;

      try {
        snapshot =
          validateExamQuestionSnapshot(
            snap.data() || {}
          );
      } catch (error) {
        return translateDomainError(error);
      }

      let expectedSnapshotId;

      try {
        expectedSnapshotId =
          examQuestionSnapshotDocumentId(
            snapshot.sourceQuestionId
          );
      } catch (error) {
        return translateDomainError(error);
      }

      if (expectedSnapshotId !== snapshotId) {
        throw new ExamTemplateServiceError(
          'EXAM_TEMPLATE_SNAPSHOT_ID_MISMATCH',
          'Snapshot não corresponde à identidade determinística.'
        );
      }

      snapshots.push(snapshot);
    }

    return snapshots;
  }

  async function activateVersion(input = {}) {
    const actor = actorContext(input);
    const data = input.data || {};

    assertAllowedFields(
      data,
      [
        'templateId',
        'version'
      ],
      'activateVersion'
    );

    const templateId =
      requiredIdentifier(
        data.templateId,
        'templateId'
      );

    let versionId;

    try {
      versionId =
        examTemplateVersionDocumentId(
          data.version
        );
    } catch (error) {
      return translateDomainError(error);
    }

    const now = timestamp();

    const templateRef =
      db.doc(
        `exam_templates/${templateId}`
      );

    const versionRef =
      db.doc(
        `exam_templates/${templateId}/versions/${versionId}`
      );

    const auditRef =
      db.collection('audit_logs').doc();

    let result = null;

    await db.runTransaction(async tx => {
      const [
        templateSnap,
        versionSnap
      ] = await Promise.all([
        tx.get(templateRef),
        tx.get(versionRef)
      ]);

      const template =
        validateStoredTemplate(templateSnap);

      const version =
        validateStoredVersion(versionSnap);

      if (template.status === 'archived') {
        throw new ExamTemplateServiceError(
          'EXAM_TEMPLATE_ARCHIVED',
          'Template arquivado não pode ativar versões.'
        );
      }

      if (
        version.templateId !==
        templateId
      ) {
        throw new ExamTemplateServiceError(
          'EXAM_TEMPLATE_VERSION_IDENTITY_MISMATCH',
          'Versão pertence a outro template.'
        );
      }

      await validateVersionSnapshots(
        tx,
        templateId,
        versionId,
        version
      );

      if (
        template.activeVersionId ===
          versionId &&
        version.status === 'active'
      ) {
        result = {
          templateId,
          versionId,
          template,
          version,
          alreadyActive: true
        };

        return;
      }

      let previousVersionRef = null;
      let previousVersion = null;

      if (
        template.activeVersionId &&
        template.activeVersionId !==
          versionId
      ) {
        previousVersionRef =
          db.doc(
            `exam_templates/${templateId}` +
            `/versions/${template.activeVersionId}`
          );

        const previousVersionSnap =
          await tx.get(previousVersionRef);

        if (!previousVersionSnap.exists) {
          throw new ExamTemplateServiceError(
            'EXAM_TEMPLATE_PREVIOUS_VERSION_MISSING',
            'activeVersionId aponta para versão inexistente.'
          );
        }

        previousVersion =
          validateStoredVersion(
            previousVersionSnap
          );

        if (
          previousVersion.status !==
          'active'
        ) {
          throw new ExamTemplateServiceError(
            'EXAM_TEMPLATE_PREVIOUS_VERSION_NOT_ACTIVE',
            'activeVersionId precisa apontar para versão ativa.'
          );
        }
      }

      let activeVersion;

      try {
        activeVersion =
          activateExamTemplateVersion(
            version,
            now
          );
      } catch (error) {
        return translateDomainError(error);
      }

      let nextTemplate;

      try {
        assertExamTemplateStatusTransition(
          template.status,
          'active'
        );

        nextTemplate =
          validateExamTemplate({
            ...template,
            status: 'active',
            activeVersionId: versionId,
            updatedAt: now
          });
      } catch (error) {
        return translateDomainError(error);
      }

      if (
        previousVersion &&
        previousVersionRef
      ) {
        let retiredVersion;

        try {
          assertExamTemplateVersionStatusTransition(
            previousVersion.status,
            'retired'
          );

          retiredVersion =
            validateExamTemplateVersion({
              ...previousVersion,
              status: 'retired'
            });

          assertExamTemplateVersionContentImmutable(
            previousVersion,
            retiredVersion
          );
        } catch (error) {
          return translateDomainError(error);
        }

        tx.set(
          previousVersionRef,
          retiredVersion
        );
      }

      tx.set(
        versionRef,
        activeVersion
      );

      tx.set(
        templateRef,
        nextTemplate
      );

      tx.create(
        auditRef,
        auditPayload({
          actor,
          action:
            'exam.template.version.activated',
          entityType:
            'exam_template_version',
          entityId:
            `${templateId}:${versionId}`,
          before: {
            template:
              templateAuditView(template),
            version:
              versionAuditView(version)
          },
          after: {
            template:
              templateAuditView(nextTemplate),
            version:
              versionAuditView(activeVersion),
            previousActiveVersionId:
              template.activeVersionId || null
          },
          createdAt: now
        })
      );

      result = {
        templateId,
        versionId,
        template: nextTemplate,
        version: activeVersion,
        alreadyActive: false
      };
    });

    return result;
  }

  return {
    createTemplate,
    createVersion,
    activateVersion
  };
}

module.exports = {
  MAX_EXAM_TEMPLATE_QUESTIONS_PER_VERSION,
  ExamTemplateServiceError,
  examTemplateAdminRole,
  assertExamTemplateAdmin,
  createExamTemplateService
};