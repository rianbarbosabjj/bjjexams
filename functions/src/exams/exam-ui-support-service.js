'use strict';

const {
  isActiveMembership,
  membershipRole,
  canApplyOfficialExam
} = require('../auth/organization-membership');
const {
  organizationIsUsable
} = require('./exam-selection-service');
const {
  requireBelt
} = require('./exam-session-domain');

const DEFAULT_ELIGIBLE_STUDENT_LIMIT = 50;
const MAX_ELIGIBLE_STUDENT_LIMIT = 100;
const MAX_ORGANIZATION_MEMBERSHIPS = 250;

class ExamUiSupportServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamUiSupportServiceError';
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
    throw new ExamUiSupportServiceError(
      'INVALID_EXAM_UI_SUPPORT_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return id;
}

function readLimit(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_ELIGIBLE_STUDENT_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_ELIGIBLE_STUDENT_LIMIT) {
    throw new ExamUiSupportServiceError(
      'INVALID_EXAM_UI_SUPPORT_LIMIT',
      `limit precisa ser inteiro entre 1 e ${MAX_ELIGIBLE_STUDENT_LIMIT}.`
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

function profileName(profile = {}) {
  return text(profile.nome || profile.name || profile.nome_completo, 160);
}

function profileBelt(profile = {}) {
  try {
    return requireBelt(profile.faixa_atual || profile.faixa || null, 'currentBelt');
  } catch (_error) {
    return null;
  }
}

function createExamUiSupportService(dependencies = {}) {
  const { db } = dependencies;
  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.getAll !== 'function'
  ) {
    throw new TypeError('Exam UI support service exige Firestore válido.');
  }

  async function membershipsForUser(userId) {
    const snap = await db.collection('vinculos_organizacao')
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
      throw new ExamUiSupportServiceError(
        'EXAM_UI_SUPPORT_PERMISSION_REQUIRED',
        'O usuário não possui permissão ativa para selecionar candidatos nesta organização.'
      );
    }
    return membership;
  }

  async function listEligibleStudents(input = {}) {
    const actorId = requiredIdentifier(input.actorId, 'actorId');
    const organizationId = requiredIdentifier(input.organizationId, 'organizationId');
    const limit = readLimit(input.limit);

    const [organizationSnap] = await Promise.all([
      db.doc(`organizacoes/${organizationId}`).get(),
      requireInstructorAccess(actorId, organizationId)
    ]);

    if (!organizationSnap.exists) {
      throw new ExamUiSupportServiceError(
        'EXAM_UI_SUPPORT_ORGANIZATION_NOT_FOUND',
        'Organização não encontrada.'
      );
    }
    if (!organizationIsUsable(organizationSnap.data() || {})) {
      throw new ExamUiSupportServiceError(
        'EXAM_UI_SUPPORT_ORGANIZATION_NOT_ACTIVE',
        'Organização não está ativa para seleção de candidatos.'
      );
    }

    const membershipSnap = await db.collection('vinculos_organizacao')
      .where('organizacao_id', '==', organizationId)
      .limit(MAX_ORGANIZATION_MEMBERSHIPS)
      .get();

    const memberships = membershipSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => (
        membershipOrganizationId(item) === organizationId &&
        isActiveMembership(item) &&
        membershipRole(item) === 'student'
      ));

    if (!memberships.length) {
      return Object.freeze({
        organizationId,
        limit,
        items: Object.freeze([])
      });
    }

    const refs = [];
    const seen = new Set();
    for (const membership of memberships) {
      const studentId = membershipUserId(membership);
      if (!studentId) continue;
      for (const path of [`usuarios/${studentId}`, `alunos/${studentId}`]) {
        if (!seen.has(path)) {
          seen.add(path);
          refs.push(db.doc(path));
        }
      }
    }

    const profileSnaps = refs.length ? await db.getAll(...refs) : [];
    const profilesByPath = new Map(
      profileSnaps.map(snap => [snap.ref.path, snap.exists ? snap.data() || {} : null])
    );

    const items = [];
    for (const membership of memberships) {
      const studentId = membershipUserId(membership);
      if (!studentId) continue;
      const profile =
        profilesByPath.get(`usuarios/${studentId}`) ||
        profilesByPath.get(`alunos/${studentId}`) ||
        null;
      if (!profile) continue;
      const currentBelt = profileBelt(profile);
      if (!currentBelt) continue;
      items.push(Object.freeze({
        studentId,
        name: profileName(profile) || 'Aluno',
        currentBelt
      }));
    }

    items.sort((left, right) => (
      left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' }) ||
      left.studentId.localeCompare(right.studentId)
    ));

    return Object.freeze({
      organizationId,
      limit,
      items: Object.freeze(items.slice(0, limit))
    });
  }

  return Object.freeze({
    listEligibleStudents
  });
}

module.exports = {
  DEFAULT_ELIGIBLE_STUDENT_LIMIT,
  MAX_ELIGIBLE_STUDENT_LIMIT,
  MAX_ORGANIZATION_MEMBERSHIPS,
  ExamUiSupportServiceError,
  requiredIdentifier,
  readLimit,
  membershipOrganizationId,
  membershipUserId,
  profileName,
  profileBelt,
  createExamUiSupportService
};
