'use strict';

const {
  isActiveMembership,
  membershipRole,
  canApplyOfficialExam
} = require('../auth/organization-membership');
const {
  ExamSessionDomainError,
  buildExamSession,
  validateExamSession,
  assertExamSessionStatusTransition,
  bindExamSessionTemplate
} = require('./exam-session-domain');
const {
  ExamRegistrationDomainError,
  examRegistrationDocumentId,
  buildSelectedExamRegistration,
  validateExamRegistration
} = require('./exam-registration-domain');
const {
  ExamTemplateDomainError,
  validateExamTemplate,
  validateExamTemplateVersion,
  examTemplateVersionDocumentId
} = require('./exam-template-domain');

class ExamSelectionServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamSelectionServiceError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function requiredIdentifier(value, field) {
  const id = text(value, 200);
  if (!id || id.includes('/')) {
    throw new ExamSelectionServiceError(
      'INVALID_EXAM_SELECTION_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return id;
}

function membershipOrganizationId(membership = {}) {
  return text(
    membership.organizationId || membership.organizacao_id,
    200
  );
}

function membershipUserId(membership = {}) {
  return text(
    membership.userId || membership.usuario_id,
    200
  );
}

function organizationIsUsable(data = {}) {
  const status = String(data.status || '').trim().toLowerCase();
  return !['inactive', 'inativa', 'suspended', 'suspensa', 'archived', 'arquivada'].includes(status);
}

function registrationIdentityMatches(registration, expected) {
  return (
    registration.sessionId === expected.sessionId &&
    registration.organizationId === expected.organizationId &&
    registration.studentId === expected.studentId &&
    registration.instructorId === expected.instructorId &&
    registration.membershipId === expected.membershipId &&
    registration.targetBelt === expected.targetBelt
  );
}

function validateStoredOfficialTemplate(snapshot) {
  if (!snapshot?.exists) {
    throw new ExamSelectionServiceError(
      'EXAM_TEMPLATE_NOT_FOUND',
      'Template oficial de exame não encontrado.'
    );
  }

  try {
    return validateExamTemplate(
      snapshot.data() || {}
    );
  } catch (error) {
    if (
      error instanceof
      ExamTemplateDomainError
    ) {
      throw new ExamSelectionServiceError(
        'EXAM_TEMPLATE_INVALID',
        'Template oficial persistido está inconsistente.'
      );
    }

    throw error;
  }
}

function validateStoredOfficialTemplateVersion(
  snapshot
) {
  if (!snapshot?.exists) {
    throw new ExamSelectionServiceError(
      'EXAM_TEMPLATE_VERSION_NOT_FOUND',
      'Versão oficial do template não encontrada.'
    );
  }

  try {
    const version =
      validateExamTemplateVersion(
        snapshot.data() || {}
      );

    const expectedDocumentId =
      examTemplateVersionDocumentId(
        version.version
      );

    if (
      snapshot.id !==
      expectedDocumentId
    ) {
      throw new ExamSelectionServiceError(
        'EXAM_TEMPLATE_VERSION_DOCUMENT_ID_MISMATCH',
        'Identidade documental da versão oficial está inconsistente.'
      );
    }

    return version;
  } catch (error) {
    if (
      error instanceof
      ExamTemplateDomainError
    ) {
      throw new ExamSelectionServiceError(
        'EXAM_TEMPLATE_VERSION_INVALID',
        'Versão oficial persistida está inconsistente.'
      );
    }

    throw error;
  }
}

function createExamSelectionService(dependencies = {}) {
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
    throw new TypeError('Exam selection service exige Firestore válido.');
  }

  function timestamp() {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new ExamSelectionServiceError(
        'INVALID_EXAM_SELECTION_CLOCK',
        'Relógio do serviço retornou timestamp inválido.'
      );
    }
    return date;
  }

  async function membershipsForUserInTransaction(tx, userId) {
    const snap = await tx.get(
      db.collection('vinculos_organizacao')
        .where('usuario_id', '==', userId)
        .limit(100)
    );
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  function actorExamMembership(memberships, actorId, organizationId) {
    const membership = memberships.find(item => (
      membershipUserId(item) === actorId &&
      membershipOrganizationId(item) === organizationId &&
      isActiveMembership(item) &&
      canApplyOfficialExam(item)
    ));

    if (!membership) {
      throw new ExamSelectionServiceError(
        'EXAM_ACTOR_MEMBERSHIP_REQUIRED',
        'O usuário não possui permissão ativa para aplicar exame nesta organização.'
      );
    }
    return membership;
  }

  function studentMembership(memberships, studentId, organizationId) {
    const membership = memberships.find(item => (
      membershipUserId(item) === studentId &&
      membershipOrganizationId(item) === organizationId &&
      isActiveMembership(item) &&
      membershipRole(item) === 'student'
    ));

    if (!membership) {
      throw new ExamSelectionServiceError(
        'EXAM_STUDENT_MEMBERSHIP_REQUIRED',
        'O aluno precisa possuir vínculo ativo na mesma organização da sessão.'
      );
    }
    return membership;
  }

  async function createSession(input = {}) {
    const actorId = requiredIdentifier(input.actorId, 'actorId');
    const data = input.data || {};
    const organizationId = requiredIdentifier(data.organizationId, 'organizationId');
    const sessionRef = db.collection('exam_sessions').doc();
    const auditRef = db.collection('audit_logs').doc();
    const now = timestamp();
    let result = null;

    await db.runTransaction(async tx => {
      const organizationRef = db.doc(`organizacoes/${organizationId}`);
      const [organizationSnap, memberships] = await Promise.all([
        tx.get(organizationRef),
        membershipsForUserInTransaction(tx, actorId)
      ]);

      if (!organizationSnap.exists) {
        throw new ExamSelectionServiceError(
          'EXAM_ORGANIZATION_NOT_FOUND',
          'Organização não encontrada.'
        );
      }
      if (!organizationIsUsable(organizationSnap.data() || {})) {
        throw new ExamSelectionServiceError(
          'EXAM_ORGANIZATION_NOT_ACTIVE',
          'Organização não está ativa para novas sessões de exame.'
        );
      }

      const actorMembership = actorExamMembership(
        memberships,
        actorId,
        organizationId
      );

      let session;
      try {
        session = buildExamSession({
          organizationId,
          responsibleInstructorId: actorId,
          targetBelt: data.targetBelt,
          priceCents: data.priceCents,
          currency: 'BRL',
          financialRuleId: null,
          scheduledAt: data.scheduledAt ?? null,
          createdBy: actorId,
          timestamp: now
        });
      } catch (error) {
        if (error instanceof ExamSessionDomainError) throw error;
        throw error;
      }

      tx.create(sessionRef, session);
      tx.create(auditRef, {
        actorId,
        actorRole: membershipRole(actorMembership) || 'instructor',
        action: 'exam.session.created',
        entityType: 'exam_session',
        entityId: sessionRef.id,
        before: null,
        after: {
          organizationId: session.organizationId,
          responsibleInstructorId: session.responsibleInstructorId,
          targetBelt: session.targetBelt,
          status: session.status,
          priceCents: session.priceCents,
          currency: session.currency
        },
        source: 'service',
        requestId: null,
        createdAt: now
      });

      result = { sessionId: sessionRef.id, session };
    });

    return result;
  }

  async function bindTemplateToSession(input = {}) {
    const actorId =
      requiredIdentifier(
        input.actorId,
        'actorId'
      );

    const data =
      input.data || {};

    const sessionId =
      requiredIdentifier(
        data.sessionId,
        'sessionId'
      );

    const templateId =
      requiredIdentifier(
        data.templateId,
        'templateId'
      );

    const sessionRef =
      db.doc(
        `exam_sessions/${sessionId}`
      );

    const templateRef =
      db.doc(
        `exam_templates/${templateId}`
      );

    const auditRef =
      db.collection(
        'audit_logs'
      ).doc();

    const now =
      timestamp();

    let result = null;

    await db.runTransaction(
      async tx => {
        const [
          sessionSnap,
          actorMemberships
        ] = await Promise.all([
          tx.get(sessionRef),
          membershipsForUserInTransaction(
            tx,
            actorId
          )
        ]);

        if (!sessionSnap.exists) {
          throw new ExamSelectionServiceError(
            'EXAM_SESSION_NOT_FOUND',
            'Sessão de exame não encontrada.'
          );
        }

        let session;

        try {
          session =
            validateExamSession(
              sessionSnap.data() || {}
            );
        } catch (error) {
          throw new ExamSelectionServiceError(
            'EXAM_SESSION_INVALID',
            'Sessão de exame persistida está inconsistente.'
          );
        }

        const actorMembership =
          actorExamMembership(
            actorMemberships,
            actorId,
            session.organizationId
          );

        if (
          session.templateId &&
          session.templateId !==
            templateId
        ) {
          throw new ExamSelectionServiceError(
            'EXAM_SESSION_TEMPLATE_IMMUTABLE',
            'Template oficial da sessão já foi congelado.'
          );
        }

        const templateSnap =
          await tx.get(
            templateRef
          );

        const template =
          validateStoredOfficialTemplate(
            templateSnap
          );

        if (
          template.targetBelt !==
          session.targetBelt
        ) {
          throw new ExamSelectionServiceError(
            'EXAM_TEMPLATE_BELT_MISMATCH',
            'Template oficial não corresponde à faixa da sessão.'
          );
        }

        /*
         * Retry de sessão já vinculada:
         * usa deliberadamente a versão congelada na sessão,
         * e não a versão ativa atual do template.
         */
        if (
          session.templateId &&
          session.templateVersionId
        ) {
          const boundVersionRef =
            db.doc(
              `exam_templates/${templateId}` +
              `/versions/${session.templateVersionId}`
            );

          const boundVersionSnap =
            await tx.get(
              boundVersionRef
            );

          const boundVersion =
            validateStoredOfficialTemplateVersion(
              boundVersionSnap
            );

          if (
            boundVersion.templateId !==
            templateId
          ) {
            throw new ExamSelectionServiceError(
              'EXAM_TEMPLATE_VERSION_IDENTITY_MISMATCH',
              'Versão congelada pertence a outro template.'
            );
          }

          if (
            ![
              'active',
              'retired'
            ].includes(
              boundVersion.status
            )
          ) {
            throw new ExamSelectionServiceError(
              'EXAM_BOUND_TEMPLATE_VERSION_NOT_PUBLISHED',
              'Versão congelada não está publicada.'
            );
          }

          result = {
            bound: true,
            alreadyBound: true,
            sessionId,
            templateId,
            templateVersionId:
              session.templateVersionId,
            session
          };

          return;
        }

        if (
          template.status !==
          'active'
        ) {
          throw new ExamSelectionServiceError(
            'EXAM_TEMPLATE_NOT_ACTIVE',
            'Somente template oficial ativo pode ser vinculado.'
          );
        }

        const templateVersionId =
          template.activeVersionId;

        if (!templateVersionId) {
          throw new ExamSelectionServiceError(
            'EXAM_TEMPLATE_ACTIVE_VERSION_REQUIRED',
            'Template oficial ativo não possui versão ativa.'
          );
        }

        const versionRef =
          db.doc(
            `exam_templates/${templateId}` +
            `/versions/${templateVersionId}`
          );

        const versionSnap =
          await tx.get(
            versionRef
          );

        const version =
          validateStoredOfficialTemplateVersion(
            versionSnap
          );

        if (
          version.templateId !==
          templateId
        ) {
          throw new ExamSelectionServiceError(
            'EXAM_TEMPLATE_VERSION_IDENTITY_MISMATCH',
            'Versão ativa pertence a outro template.'
          );
        }

        if (
          version.status !==
          'active'
        ) {
          throw new ExamSelectionServiceError(
            'EXAM_TEMPLATE_VERSION_NOT_ACTIVE',
            'Versão selecionada pelo template não está ativa.'
          );
        }

        let nextSession;

        try {
          nextSession =
            bindExamSessionTemplate(
              session,
              {
                templateId,
                templateVersionId,
                timestamp: now
              }
            );
        } catch (error) {
          if (
            error instanceof
            ExamSessionDomainError
          ) {
            throw new ExamSelectionServiceError(
              error.code,
              error.message
            );
          }

          throw error;
        }

        tx.update(
          sessionRef,
          {
            templateId:
              nextSession.templateId,

            templateVersionId:
              nextSession.templateVersionId,

            updatedAt:
              nextSession.updatedAt
          }
        );

        tx.create(
          auditRef,
          {
            actorId,
            actorRole:
              membershipRole(
                actorMembership
              ) ||
              'instructor',

            action:
              'exam.session.template_bound',

            entityType:
              'exam_session',

            entityId:
              sessionId,

            before: {
              status:
                session.status,

              targetBelt:
                session.targetBelt,

              templateId:
                session.templateId,

              templateVersionId:
                session.templateVersionId
            },

            after: {
              status:
                nextSession.status,

              targetBelt:
                nextSession.targetBelt,

              templateId:
                nextSession.templateId,

              templateVersionId:
                nextSession.templateVersionId
            },

            source:
              'service',

            requestId:
              null,

            createdAt:
              now
          }
        );

        result = {
          bound: true,
          alreadyBound: false,
          sessionId,
          templateId,
          templateVersionId,
          session:
            nextSession
        };
      }
    );

    return result;
  }

  async function selectCandidate(input = {}) {
    const actorId = requiredIdentifier(input.actorId, 'actorId');
    const data = input.data || {};
    const sessionId = requiredIdentifier(data.sessionId, 'sessionId');
    const studentId = requiredIdentifier(data.studentId, 'studentId');
    const sessionRef = db.doc(`exam_sessions/${sessionId}`);
    const studentRef = db.doc(`usuarios/${studentId}`);
    const legacyStudentRef = db.doc(`alunos/${studentId}`);
    const registrationId = examRegistrationDocumentId({ sessionId, studentId });
    const registrationRef = db.doc(`exam_registrations/${registrationId}`);
    const auditRef = db.collection('audit_logs').doc();
    const now = timestamp();
    let result = null;

    await db.runTransaction(async tx => {
      const [
        sessionSnap,
        studentSnap,
        legacyStudentSnap,
        registrationSnap,
        actorMemberships,
        studentMemberships
      ] = await Promise.all([
        tx.get(sessionRef),
        tx.get(studentRef),
        tx.get(legacyStudentRef),
        tx.get(registrationRef),
        membershipsForUserInTransaction(tx, actorId),
        membershipsForUserInTransaction(tx, studentId)
      ]);

      if (!sessionSnap.exists) {
        throw new ExamSelectionServiceError(
          'EXAM_SESSION_NOT_FOUND',
          'Sessão de exame não encontrada.'
        );
      }

      let session;
      try {
        session = validateExamSession(sessionSnap.data() || {});
      } catch (error) {
        throw new ExamSelectionServiceError(
          'EXAM_SESSION_INVALID',
          'Sessão de exame persistida está inconsistente.'
        );
      }

      if (!['draft', 'candidates_selected', 'awaiting_payment'].includes(session.status)) {
        throw new ExamSelectionServiceError(
          'EXAM_SESSION_NOT_SELECTABLE',
          'Sessão não aceita novos candidatos neste estado.'
        );
      }

      const actorMembership = actorExamMembership(
        actorMemberships,
        actorId,
        session.organizationId
      );
      const candidateMembership = studentMembership(
        studentMemberships,
        studentId,
        session.organizationId
      );

      if (!studentSnap.exists && !legacyStudentSnap.exists) {
        throw new ExamSelectionServiceError(
          'EXAM_STUDENT_PROFILE_NOT_FOUND',
          'Perfil do aluno não encontrado.'
        );
      }

      const profile = studentSnap.exists
        ? studentSnap.data() || {}
        : legacyStudentSnap.data() || {};
      const currentBelt = profile.faixa_atual || profile.faixa || null;

      const expectedIdentity = {
        sessionId,
        organizationId: session.organizationId,
        studentId,
        instructorId: session.responsibleInstructorId,
        membershipId: candidateMembership.id,
        targetBelt: session.targetBelt
      };

      if (registrationSnap.exists) {
        let existing;
        try {
          existing = validateExamRegistration(registrationSnap.data() || {});
        } catch (error) {
          throw new ExamSelectionServiceError(
            'EXAM_REGISTRATION_INVALID',
            'Registration existente está inconsistente.'
          );
        }
        if (!registrationIdentityMatches(existing, expectedIdentity)) {
          throw new ExamSelectionServiceError(
            'EXAM_REGISTRATION_CONFLICT',
            'Registration existente conflita com a sessão ou o aluno solicitado.'
          );
        }
        result = {
          created: false,
          registrationId,
          registration: existing,
          sessionId,
          session
        };
        return;
      }

      let registration;
      try {
        registration = buildSelectedExamRegistration({
          ...expectedIdentity,
          currentBelt,
          timestamp: now
        });
      } catch (error) {
        if (error instanceof ExamRegistrationDomainError || error instanceof ExamSessionDomainError) {
          throw error;
        }
        throw error;
      }

      let nextSession = session;
      if (session.status === 'draft') {
        assertExamSessionStatusTransition('draft', 'candidates_selected');
        nextSession = validateExamSession({
          ...session,
          status: 'candidates_selected',
          updatedAt: now
        });
        tx.set(sessionRef, nextSession);
      }

      tx.create(registrationRef, registration);
      tx.create(auditRef, {
        actorId,
        actorRole: membershipRole(actorMembership) || 'instructor',
        action: 'exam.registration.selected',
        entityType: 'exam_registration',
        entityId: registrationId,
        before: null,
        after: {
          sessionId,
          organizationId: registration.organizationId,
          studentId,
          instructorId: registration.instructorId,
          currentBelt: registration.currentBelt,
          targetBelt: registration.targetBelt,
          status: registration.status
        },
        source: 'service',
        requestId: null,
        createdAt: now
      });

      result = {
        created: true,
        registrationId,
        registration,
        sessionId,
        session: nextSession
      };
    });

    return result;
  }

  return {
    createSession,
    bindTemplateToSession,
    selectCandidate
  };
}

module.exports = {
  ExamSelectionServiceError,
  membershipOrganizationId,
  membershipUserId,
  organizationIsUsable,
  createExamSelectionService
};
