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
  assertExamSessionStatusTransition
} = require('./exam-session-domain');
const {
  ExamRegistrationDomainError,
  examRegistrationDocumentId,
  buildSelectedExamRegistration,
  validateExamRegistration
} = require('./exam-registration-domain');

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
