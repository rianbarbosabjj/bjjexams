'use strict';

const {
  isActiveMembership,
  membershipRole,
  canApplyOfficialExam
} = require('../auth/organization-membership');
const {
  ExamReadDomainError,
  buildStudentExamReadView,
  buildInstructorSessionSummary,
  buildInstructorRegistrationView
} = require('./exam-read-domain');
const {
  validateExamSession
} = require('./exam-session-domain');
const {
  validateExamRegistration
} = require('./exam-registration-domain');

const DEFAULT_EXAM_READ_LIMIT = 20;
const MAX_EXAM_READ_LIMIT = 50;
const MAX_SESSION_CANDIDATES = 100;

class ExamReadServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamReadServiceError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function requiredIdentifier(value, field) {
  const normalized = text(value, 200);
  if (!normalized || normalized.includes('/')) {
    throw new ExamReadServiceError(
      'INVALID_EXAM_READ_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return normalized;
}

function readLimit(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_EXAM_READ_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_EXAM_READ_LIMIT) {
    throw new ExamReadServiceError(
      'INVALID_EXAM_READ_LIMIT',
      `limit precisa ser inteiro entre 1 e ${MAX_EXAM_READ_LIMIT}.`
    );
  }
  return parsed;
}

function membershipOrganizationId(membership = {}) {
  return text(membership.organizationId || membership.organizacao_id, 200);
}

function membershipUserId(membership = {}) {
  return text(membership.userId || membership.usuario_id, 200);
}

function organizationName(input = {}) {
  return text(input.nome || input.name || input.razao_social || input.nome_fantasia, 160);
}

function studentName(input = {}) {
  return text(input.nome || input.name || input.nome_completo, 160);
}

function wrapDomainError(error) {
  if (error instanceof ExamReadServiceError) return error;
  if (error instanceof ExamReadDomainError) {
    return new ExamReadServiceError(error.code, error.message);
  }
  return error;
}

function createExamReadService(dependencies = {}) {
  const { db } = dependencies;
  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.getAll !== 'function'
  ) {
    throw new TypeError('Exam read service exige Firestore válido.');
  }

  async function membershipsForUser(userId) {
    const snap = await db
      .collection('vinculos_organizacao')
      .where('usuario_id', '==', userId)
      .limit(100)
      .get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async function requireInstructorAccess(actorId, organizationId) {
    const memberships = await membershipsForUser(actorId);
    const membership = memberships.find(item => (
      membershipUserId(item) === actorId &&
      membershipOrganizationId(item) === organizationId &&
      isActiveMembership(item) &&
      canApplyOfficialExam(item)
    ));
    if (!membership) {
      throw new ExamReadServiceError(
        'EXAM_READ_PERMISSION_REQUIRED',
        'O usuário não possui permissão ativa para consultar exames desta organização.'
      );
    }
    return membership;
  }

  function studentMembershipActive(memberships, registration) {
    return memberships.some(item => (
      item.id === registration.membershipId &&
      membershipUserId(item) === registration.studentId &&
      membershipOrganizationId(item) === registration.organizationId &&
      isActiveMembership(item) &&
      membershipRole(item) === 'student'
    ));
  }

  function normalizeSession(snapshot, label = 'sessão') {
    try {
      return validateExamSession(snapshot || {});
    } catch (_error) {
      throw new ExamReadServiceError(
        'EXAM_READ_CANONICAL_STATE_INVALID',
        `${label} possui estado canônico inconsistente.`
      );
    }
  }

  function normalizeRegistration(snapshot, label = 'registration') {
    try {
      return validateExamRegistration(snapshot || {});
    } catch (_error) {
      throw new ExamReadServiceError(
        'EXAM_READ_CANONICAL_STATE_INVALID',
        `${label} possui estado canônico inconsistente.`
      );
    }
  }

  async function loadOrganization(organizationId) {
    const snap = await db.doc(`organizacoes/${organizationId}`).get();
    if (!snap.exists) {
      throw new ExamReadServiceError(
        'EXAM_READ_ORGANIZATION_NOT_FOUND',
        'Organização da sessão não foi encontrada.'
      );
    }
    return snap.data() || {};
  }

  async function listInstructorSessions(input = {}) {
    const actorId = requiredIdentifier(input.actorId, 'actorId');
    const organizationId = requiredIdentifier(input.organizationId, 'organizationId');
    const limit = readLimit(input.limit);

    await requireInstructorAccess(actorId, organizationId);
    const [org, sessionSnap] = await Promise.all([
      loadOrganization(organizationId),
      db.collection('exam_sessions')
        .where('organizationId', '==', organizationId)
        .orderBy('updatedAt', 'desc')
        .limit(limit)
        .get()
    ]);

    const items = sessionSnap.docs.map(doc => {
      const session = normalizeSession(doc.data() || {}, `Sessão ${doc.id}`);
      if (session.organizationId !== organizationId) {
        throw new ExamReadServiceError(
          'EXAM_READ_CANONICAL_STATE_INVALID',
          'Sessão retornada não pertence à organização solicitada.'
        );
      }
      try {
        return buildInstructorSessionSummary({
          sessionId: doc.id,
          session,
          organizationName: organizationName(org)
        });
      } catch (error) {
        throw wrapDomainError(error);
      }
    });

    return Object.freeze({
      organizationId,
      limit,
      items: Object.freeze(items)
    });
  }

  async function getInstructorSession(input = {}) {
    const actorId = requiredIdentifier(input.actorId, 'actorId');
    const sessionId = requiredIdentifier(input.sessionId, 'sessionId');
    const sessionSnap = await db.doc(`exam_sessions/${sessionId}`).get();
    if (!sessionSnap.exists) {
      throw new ExamReadServiceError(
        'EXAM_READ_SESSION_NOT_FOUND',
        'Sessão de exame não encontrada.'
      );
    }

    const session = normalizeSession(sessionSnap.data() || {}, `Sessão ${sessionId}`);
    await requireInstructorAccess(actorId, session.organizationId);

    const [org, registrationSnap] = await Promise.all([
      loadOrganization(session.organizationId),
      db.collection('exam_registrations')
        .where('sessionId', '==', sessionId)
        .orderBy('updatedAt', 'desc')
        .limit(MAX_SESSION_CANDIDATES)
        .get()
    ]);

    const registrations = registrationSnap.docs.map(doc => ({
      id: doc.id,
      registration: normalizeRegistration(doc.data() || {}, `Registration ${doc.id}`)
    }));

    const profileRefs = [];
    const seen = new Set();
    for (const entry of registrations) {
      const userPath = `usuarios/${entry.registration.studentId}`;
      const legacyPath = `alunos/${entry.registration.studentId}`;
      if (!seen.has(userPath)) {
        seen.add(userPath);
        profileRefs.push(db.doc(userPath));
      }
      if (!seen.has(legacyPath)) {
        seen.add(legacyPath);
        profileRefs.push(db.doc(legacyPath));
      }
    }
    const profileSnaps = profileRefs.length ? await db.getAll(...profileRefs) : [];
    const profilesByPath = new Map(
      profileSnaps.map(snap => [snap.ref.path, snap.exists ? snap.data() || {} : null])
    );

    const candidates = registrations.map(entry => {
      const registration = entry.registration;
      if (
        registration.sessionId !== sessionId ||
        registration.organizationId !== session.organizationId
      ) {
        throw new ExamReadServiceError(
          'EXAM_READ_CANONICAL_STATE_INVALID',
          'Registration retornada não pertence à sessão solicitada.'
        );
      }
      const profile =
        profilesByPath.get(`usuarios/${registration.studentId}`) ||
        profilesByPath.get(`alunos/${registration.studentId}`) ||
        {};
      try {
        return buildInstructorRegistrationView({
          registrationId: entry.id,
          registration,
          sessionId,
          session,
          studentName: studentName(profile)
        });
      } catch (error) {
        throw wrapDomainError(error);
      }
    });

    let sessionView;
    try {
      sessionView = buildInstructorSessionSummary({
        sessionId,
        session,
        organizationName: organizationName(org)
      });
    } catch (error) {
      throw wrapDomainError(error);
    }

    return Object.freeze({
      session: sessionView,
      candidates: Object.freeze(candidates),
      candidateLimit: MAX_SESSION_CANDIDATES
    });
  }

  async function listStudentExams(input = {}) {
    const actorId = requiredIdentifier(input.actorId, 'actorId');
    const limit = readLimit(input.limit);
    const [registrationSnap, memberships] = await Promise.all([
      db.collection('exam_registrations')
        .where('studentId', '==', actorId)
        .orderBy('updatedAt', 'desc')
        .limit(limit)
        .get(),
      membershipsForUser(actorId)
    ]);

    if (registrationSnap.empty) {
      return Object.freeze({ limit, items: Object.freeze([]) });
    }

    const registrations = registrationSnap.docs.map(doc => ({
      id: doc.id,
      registration: normalizeRegistration(doc.data() || {}, `Registration ${doc.id}`)
    }));

    for (const entry of registrations) {
      if (entry.registration.studentId !== actorId) {
        throw new ExamReadServiceError(
          'EXAM_READ_CANONICAL_STATE_INVALID',
          'Consulta de aluno retornou registration de outro usuário.'
        );
      }
    }

    const refs = [];
    const seen = new Set();
    for (const entry of registrations) {
      const sessionPath = `exam_sessions/${entry.registration.sessionId}`;
      const orgPath = `organizacoes/${entry.registration.organizationId}`;

      const paths = [
        sessionPath,
        orgPath
      ];

      if (
        entry.registration.resultId
      ) {
        paths.push(
          `exam_results/${entry.registration.resultId}`
        );
      }

      if (
        entry.registration.certificateId
      ) {
        paths.push(
          `exam_certificates/${entry.registration.certificateId}`
        );
      }

      for (const path of paths) {
        if (!seen.has(path)) {
          seen.add(path);
          refs.push(db.doc(path));
        }
      }
    }
    const snaps = refs.length ? await db.getAll(...refs) : [];
    const byPath = new Map(
      snaps.map(snap => [snap.ref.path, snap.exists ? snap.data() || {} : null])
    );

    const items = registrations.map(entry => {
      const registration = entry.registration;
      const sessionData = byPath.get(`exam_sessions/${registration.sessionId}`);
      if (!sessionData) {
        throw new ExamReadServiceError(
          'EXAM_READ_SESSION_NOT_FOUND',
          'Sessão vinculada à registration não foi encontrada.'
        );
      }
      const orgData = byPath.get(`organizacoes/${registration.organizationId}`);
      if (!orgData) {
        throw new ExamReadServiceError(
          'EXAM_READ_ORGANIZATION_NOT_FOUND',
          'Organização vinculada à registration não foi encontrada.'
        );
      }
      const session = normalizeSession(
        sessionData,
        `Sessão ${registration.sessionId}`
      );

      let resultData = null;

      if (registration.resultId) {
        resultData =
          byPath.get(
            `exam_results/${registration.resultId}`
          );

        if (!resultData) {
          throw new ExamReadServiceError(
            'EXAM_READ_RESULT_NOT_FOUND',
            'Resultado vinculado à registration não foi encontrado.'
          );
        }
      }

      let certificateData = null;

      if (
        registration.certificateId
      ) {
        certificateData =
          byPath.get(
            `exam_certificates/${registration.certificateId}`
          );

        if (!certificateData) {
          throw new ExamReadServiceError(
            'EXAM_READ_CERTIFICATE_NOT_FOUND',
            'Certificado vinculado à registration não foi encontrado.'
          );
        }
      }
      try {
        return buildStudentExamReadView({
          registrationId:
            entry.id,
          sessionId:
            registration.sessionId,
          session,
          registration,
          organizationName:
            organizationName(orgData),
          membershipActive:
            studentMembershipActive(
              memberships,
              registration
            ),
          resultId:
            registration.resultId,
          result:
            resultData,
          certificateId:
            registration.certificateId,
          certificate:
            certificateData
        });
      } catch (error) {
        throw wrapDomainError(error);
      }
    });

    return Object.freeze({
      limit,
      items: Object.freeze(items)
    });
  }

  return Object.freeze({
    listInstructorSessions,
    getInstructorSession,
    listStudentExams
  });
}

module.exports = {
  DEFAULT_EXAM_READ_LIMIT,
  MAX_EXAM_READ_LIMIT,
  MAX_SESSION_CANDIDATES,
  ExamReadServiceError,
  requiredIdentifier,
  readLimit,
  membershipOrganizationId,
  membershipUserId,
  organizationName,
  studentName,
  createExamReadService
};
