'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const {
  ExamSessionDomainError
} = require('./exam-session-domain');
const {
  ExamRegistrationDomainError
} = require('./exam-registration-domain');
const {
  ExamSelectionServiceError,
  createExamSelectionService
} = require('./exam-selection-service');

function createExamSelectionFunctions(dependencies = {}) {
  const { REGION, db } = dependencies;
  if (!REGION || !db) {
    throw new Error('Exam selection functions: infraestrutura obrigatória ausente.');
  }

  const service = createExamSelectionService({ db });

  function requireAuth(request) {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Faça login para continuar.');
    }
    return uid;
  }

  function assertAllowedFields(data, allowedFields, operation) {
    const allowed = new Set(allowedFields);
    const extra = Object.keys(data || {}).filter(field => !allowed.has(field));
    if (extra.length) {
      throw new HttpsError(
        'invalid-argument',
        `${operation} contém campos não permitidos: ${extra.join(', ')}.`
      );
    }
  }

  function parseIdentifier(value, label) {
    const id = String(value || '').trim();
    if (!id || id.length > 200 || id.includes('/')) {
      throw new HttpsError('invalid-argument', `${label} inválido.`);
    }
    return id;
  }

  function parseScheduledAt(value) {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      throw new HttpsError('invalid-argument', 'scheduledAt inválido.');
    }
    return date;
  }

  function throwMapped(error) {
    if (
      !(error instanceof ExamSelectionServiceError) &&
      !(error instanceof ExamSessionDomainError) &&
      !(error instanceof ExamRegistrationDomainError)
    ) {
      throw error;
    }

    const code = error.code || 'EXAM_SELECTION_FAILED';
    const permission = new Set([
      'EXAM_ACTOR_MEMBERSHIP_REQUIRED',
      'EXAM_STUDENT_MEMBERSHIP_REQUIRED'
    ]);
    const notFound = new Set([
      'EXAM_ORGANIZATION_NOT_FOUND',
      'EXAM_SESSION_NOT_FOUND',
      'EXAM_STUDENT_PROFILE_NOT_FOUND'
    ]);
    const failedPrecondition = new Set([
      'EXAM_ORGANIZATION_NOT_ACTIVE',
      'EXAM_SESSION_NOT_SELECTABLE',
      'EXAM_SESSION_INVALID',
      'EXAM_REGISTRATION_INVALID',
      'EXAM_REGISTRATION_CONFLICT'
    ]);

    let httpsCode = 'invalid-argument';
    if (permission.has(code)) httpsCode = 'permission-denied';
    else if (notFound.has(code)) httpsCode = 'not-found';
    else if (failedPrecondition.has(code)) httpsCode = 'failed-precondition';

    throw new HttpsError(
      httpsCode,
      error.message,
      { domainCode: code }
    );
  }

  function sessionView(id, session = {}) {
    return {
      id,
      organizationId: session.organizationId,
      responsibleInstructorId: session.responsibleInstructorId,
      targetBelt: session.targetBelt,
      status: session.status,
      priceCents: session.priceCents,
      currency: session.currency,
      scheduledAt: session.scheduledAt || null,
      createdAt: session.createdAt || null,
      updatedAt: session.updatedAt || null
    };
  }

  function registrationView(id, registration = {}) {
    return {
      id,
      sessionId: registration.sessionId,
      organizationId: registration.organizationId,
      studentId: registration.studentId,
      instructorId: registration.instructorId,
      currentBelt: registration.currentBelt,
      targetBelt: registration.targetBelt,
      status: registration.status,
      selectedAt: registration.selectedAt || null,
      updatedAt: registration.updatedAt || null
    };
  }

  const criarSessaoExameFaixaV12 = onCall(
    { region: REGION },
    async request => {
      const actorId = requireAuth(request);
      const data = request.data || {};
      assertAllowedFields(
        data,
        ['organizationId', 'targetBelt', 'priceCents', 'scheduledAt'],
        'Criação de sessão de exame'
      );

      const input = {
        organizationId: parseIdentifier(data.organizationId, 'organizationId'),
        targetBelt: data.targetBelt,
        priceCents: data.priceCents,
        scheduledAt: parseScheduledAt(data.scheduledAt)
      };

      try {
        const result = await service.createSession({ actorId, data: input });
        return {
          ok: true,
          session: sessionView(result.sessionId, result.session)
        };
      } catch (error) {
        throwMapped(error);
      }
    }
  );

  const selecionarAlunoExameFaixaV12 = onCall(
    { region: REGION },
    async request => {
      const actorId = requireAuth(request);
      const data = request.data || {};
      assertAllowedFields(
        data,
        ['sessionId', 'studentId'],
        'Seleção de candidato para exame'
      );

      const input = {
        sessionId: parseIdentifier(data.sessionId, 'sessionId'),
        studentId: parseIdentifier(data.studentId, 'studentId')
      };

      try {
        const result = await service.selectCandidate({ actorId, data: input });
        return {
          ok: true,
          created: result.created,
          session: sessionView(result.sessionId, result.session),
          registration: registrationView(
            result.registrationId,
            result.registration
          )
        };
      } catch (error) {
        throwMapped(error);
      }
    }
  );

  return {
    criarSessaoExameFaixaV12,
    selecionarAlunoExameFaixaV12
  };
}

module.exports = {
  createExamSelectionFunctions
};
