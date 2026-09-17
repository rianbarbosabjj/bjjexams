'use strict';

const crypto = require('crypto');

const PUBLICATION_SNAPSHOT_VERSION = 'course-publication-v2';
const MODERATION_SCOPE_VERSION = 'course-structural-text-v1';

function text(value, max = 100000) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function boolean(value) {
  return value === true;
}

function canonicalCourseMetadata(course = {}) {
  return {
    title: text(course.title, 160),
    description: text(course.description, 10000),
    ownerType: text(course.ownerType, 40),
    ownerId: text(course.ownerId, 160),
    instructorIds: Array.isArray(course.instructorIds)
      ? [...new Set(course.instructorIds.map(value => text(value, 160)).filter(Boolean))].sort()
      : [],
    visibility: text(course.visibility, 40),
    organizationId: text(course.organizationId, 160),
    isPaid: boolean(course.isPaid),
    priceCents: Math.max(0, integer(course.priceCents, 0)),
    currency: text(course.currency, 12)?.toUpperCase() || 'BRL'
  };
}

function canonicalModule(id, module = {}) {
  return {
    id: text(id, 160),
    title: text(module.title, 160),
    description: text(module.description, 2000),
    position: integer(module.position, 0)
  };
}

function canonicalLesson(id, lesson = {}) {
  return {
    id: text(id, 160),
    moduleId: text(lesson.moduleId, 160),
    title: text(lesson.title, 160),
    description: text(lesson.description, 4000),
    position: integer(lesson.position, 0),
    contentType: text(lesson.contentType, 40),
    durationMinutes: Math.max(0, integer(lesson.durationMinutes, 0)),
    isPreview: boolean(lesson.isPreview),
    videoUrl: text(lesson.videoUrl, 2000),
    body: text(lesson.body, 100000),
    documentUrl: text(lesson.documentUrl, 2000)
  };
}

function normalizeEntries(entries = [], mapper) {
  return (Array.isArray(entries) ? entries : []).map(entry => {
    if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'data')) {
      return mapper(entry.id, entry.data || {});
    }
    return mapper(entry?.id, entry || {});
  });
}

function compareByPositionThenId(left, right) {
  return left.position - right.position || String(left.id || '').localeCompare(String(right.id || ''));
}

function buildPublicationSnapshot({ course = {}, modules = [], lessons = [] } = {}) {
  const canonicalModules = normalizeEntries(modules, canonicalModule)
    .sort(compareByPositionThenId);

  const moduleRank = new Map(canonicalModules.map((module, index) => [module.id, index]));
  const canonicalLessons = normalizeEntries(lessons, canonicalLesson)
    .sort((left, right) => {
      const leftRank = moduleRank.has(left.moduleId) ? moduleRank.get(left.moduleId) : Number.MAX_SAFE_INTEGER;
      const rightRank = moduleRank.has(right.moduleId) ? moduleRank.get(right.moduleId) : Number.MAX_SAFE_INTEGER;
      return (
        leftRank - rightRank ||
        String(left.moduleId || '').localeCompare(String(right.moduleId || '')) ||
        left.position - right.position ||
        String(left.id || '').localeCompare(String(right.id || ''))
      );
    });

  return {
    version: PUBLICATION_SNAPSHOT_VERSION,
    course: canonicalCourseMetadata(course),
    modules: canonicalModules,
    lessons: canonicalLessons
  };
}

function hashPublicationSnapshot(snapshot = {}) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');
}

function publicationFingerprint(input = {}) {
  const snapshot = buildPublicationSnapshot(input);
  return {
    version: PUBLICATION_SNAPSHOT_VERSION,
    contentRevision: Math.max(0, integer(input?.course?.contentRevision, 0)),
    hash: hashPublicationSnapshot(snapshot),
    snapshot
  };
}

function buildStructuralModerationInput(snapshot = {}) {
  const modules = Array.isArray(snapshot.modules) ? snapshot.modules : [];
  const lessons = Array.isArray(snapshot.lessons) ? snapshot.lessons : [];

  return {
    scopeVersion: MODERATION_SCOPE_VERSION,
    title: text(snapshot?.course?.title, 160),
    description: text(snapshot?.course?.description, 10000),
    modules: modules.map(module => ({
      title: text(module.title, 160),
      description: text(module.description, 2000),
      position: integer(module.position, 0),
      lessons: lessons
        .filter(lesson => lesson.moduleId === module.id)
        .map(lesson => ({
          title: text(lesson.title, 160),
          description: text(lesson.description, 4000),
          position: integer(lesson.position, 0),
          contentType: text(lesson.contentType, 40)
        }))
    }))
  };
}

module.exports = {
  PUBLICATION_SNAPSHOT_VERSION,
  MODERATION_SCOPE_VERSION,
  canonicalCourseMetadata,
  buildPublicationSnapshot,
  hashPublicationSnapshot,
  publicationFingerprint,
  buildStructuralModerationInput
};
