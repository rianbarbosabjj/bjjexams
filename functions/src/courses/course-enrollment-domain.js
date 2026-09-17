'use strict';

const crypto = require('crypto');
const { isActiveMembership } = require('../auth/organization-membership');

const ENROLLMENT_SOURCES = Object.freeze([
  'free',
  'order',
  'admin_grant'
]);

const ENROLLMENT_STATUSES = Object.freeze([
  'active',
  'completed',
  'cancelled',
  'refunded'
]);

const ENTITLEMENT_GRANTING_STATUSES = Object.freeze([
  'active',
  'completed'
]);

class CourseEnrollmentDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CourseEnrollmentDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function normalizeToken(value) {
  const normalized = text(value, 80);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeProgressPercent(value) {
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number)) return Number.NaN;
  return Math.round(number * 100) / 100;
}

function enrollmentDocumentId(courseId, userId) {
  const course = text(courseId, 200);
  const user = text(userId, 200);

  if (!course || !user || course.includes('/') || user.includes('/')) {
    throw new CourseEnrollmentDomainError(
      'INVALID_ENROLLMENT_KEY',
      'Curso e usuário válidos são obrigatórios para identificar a matrícula.'
    );
  }

  return crypto
    .createHash('sha256')
    .update(`course-enrollment-v1:${course}:${user}`)
    .digest('hex');
}

function normalizeEnrollmentInput(input = {}) {
  return {
    courseId: text(input.courseId, 200),
    userId: text(input.userId, 200),
    source: normalizeToken(input.source),
    orderId: text(input.orderId, 200),
    status: normalizeToken(input.status),
    progressPercent: normalizeProgressPercent(input.progressPercent),
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null
  };
}

function validateEnrollment(input = {}) {
  const enrollment = normalizeEnrollmentInput(input);

  if (!enrollment.courseId || !enrollment.userId) {
    throw new CourseEnrollmentDomainError(
      'ENROLLMENT_IDENTITY_REQUIRED',
      'Matrícula exige courseId e userId.'
    );
  }

  if (!ENROLLMENT_SOURCES.includes(enrollment.source)) {
    throw new CourseEnrollmentDomainError(
      'INVALID_ENROLLMENT_SOURCE',
      'Fonte de matrícula inválida.'
    );
  }

  if (!ENROLLMENT_STATUSES.includes(enrollment.status)) {
    throw new CourseEnrollmentDomainError(
      'INVALID_ENROLLMENT_STATUS',
      'Status de matrícula inválido.'
    );
  }

  if (
    !Number.isFinite(enrollment.progressPercent) ||
    enrollment.progressPercent < 0 ||
    enrollment.progressPercent > 100
  ) {
    throw new CourseEnrollmentDomainError(
      'INVALID_PROGRESS_PERCENT',
      'progressPercent deve estar entre 0 e 100.'
    );
  }

  if (enrollment.source === 'order' && !enrollment.orderId) {
    throw new CourseEnrollmentDomainError(
      'ORDER_REQUIRED',
      'Matrícula originada de pedido exige orderId.'
    );
  }

  if (enrollment.source !== 'order' && enrollment.orderId) {
    throw new CourseEnrollmentDomainError(
      'ORDER_NOT_ALLOWED',
      'orderId somente pode ser usado em matrícula originada de pedido.'
    );
  }

  return enrollment;
}

function membershipMatchesCourse(course = {}, membership = {}) {
  return Boolean(
    course.visibility === 'organization' &&
    course.organizationId &&
    isActiveMembership(membership) &&
    String(membership.organizationId || membership.organizacao_id || '') === String(course.organizationId)
  );
}

function assertCanSelfEnrollFreeCourse({ course = {}, membership = null } = {}) {
  if (course.status !== 'published') {
    throw new CourseEnrollmentDomainError(
      'COURSE_NOT_AVAILABLE',
      'Somente cursos publicados podem receber matrícula.'
    );
  }

  if (course.visibility === 'private') {
    throw new CourseEnrollmentDomainError(
      'PRIVATE_COURSE_REQUIRES_GRANT',
      'Curso privado exige concessão explícita de acesso.'
    );
  }

  if (course.visibility === 'organization') {
    if (!membershipMatchesCourse(course, membership || {})) {
      throw new CourseEnrollmentDomainError(
        'ORGANIZATION_MEMBERSHIP_REQUIRED',
        'Este curso exige vínculo ativo com a organização responsável.'
      );
    }
  } else if (course.visibility !== 'platform') {
    throw new CourseEnrollmentDomainError(
      'COURSE_NOT_AVAILABLE',
      'Curso indisponível para matrícula.'
    );
  }

  if (course.isPaid === true || Number(course.priceCents || 0) > 0) {
    throw new CourseEnrollmentDomainError(
      'PAYMENT_REQUIRED',
      'Este curso exige pagamento confirmado antes da liberação do acesso.'
    );
  }

  return true;
}

function buildFreeEnrollment({ courseId, userId, createdAt = null } = {}) {
  const enrollment = {
    courseId: text(courseId, 200),
    userId: text(userId, 200),
    source: 'free',
    orderId: null,
    status: 'active',
    progressPercent: 0,
    startedAt: createdAt,
    completedAt: null,
    createdAt,
    updatedAt: createdAt
  };

  return validateEnrollment(enrollment);
}

function resolveCourseEntitlement({ course = {}, enrollment = null, membership = null } = {}) {
  if (course.status !== 'published') {
    return { granted: false, reason: 'COURSE_NOT_PUBLISHED' };
  }

  if (!enrollment) {
    return { granted: false, reason: 'ENROLLMENT_REQUIRED' };
  }

  let normalized;
  try {
    normalized = validateEnrollment(enrollment);
  } catch (_error) {
    return { granted: false, reason: 'INVALID_ENROLLMENT' };
  }

  if (!ENTITLEMENT_GRANTING_STATUSES.includes(normalized.status)) {
    return { granted: false, reason: 'ENROLLMENT_INACTIVE' };
  }

  if (course.visibility === 'organization') {
    if (!membershipMatchesCourse(course, membership || {})) {
      return { granted: false, reason: 'ORGANIZATION_MEMBERSHIP_REQUIRED' };
    }
  } else if (course.visibility === 'private') {
    if (!['order', 'admin_grant'].includes(normalized.source)) {
      return { granted: false, reason: 'PRIVATE_COURSE_GRANT_REQUIRED' };
    }
  } else if (course.visibility !== 'platform') {
    return { granted: false, reason: 'COURSE_NOT_AVAILABLE' };
  }

  if (course.isPaid === true || Number(course.priceCents || 0) > 0) {
    if (!['order', 'admin_grant'].includes(normalized.source)) {
      return { granted: false, reason: 'PAYMENT_ENTITLEMENT_REQUIRED' };
    }
  }

  return {
    granted: true,
    reason: 'ENTITLED',
    enrollmentStatus: normalized.status,
    source: normalized.source
  };
}

module.exports = {
  ENROLLMENT_SOURCES,
  ENROLLMENT_STATUSES,
  ENTITLEMENT_GRANTING_STATUSES,
  CourseEnrollmentDomainError,
  enrollmentDocumentId,
  normalizeEnrollmentInput,
  validateEnrollment,
  membershipMatchesCourse,
  assertCanSelfEnrollFreeCourse,
  buildFreeEnrollment,
  resolveCourseEntitlement
};
