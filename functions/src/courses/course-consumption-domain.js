'use strict';

const {
  CourseContentDomainError,
  validateModule,
  validateLesson,
  courseContentCounters
} = require('./course-content-domain');

class CourseConsumptionDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CourseConsumptionDomainError';
    this.code = code;
  }
}

function normalizePersistedModule(id, input = {}) {
  try {
    return { id, ...validateModule(input) };
  } catch (error) {
    if (error instanceof CourseContentDomainError) {
      throw new CourseConsumptionDomainError(
        'INVALID_PERSISTED_MODULE',
        'A estrutura persistida do módulo é inválida.'
      );
    }
    throw error;
  }
}

function normalizePersistedLesson(id, input = {}) {
  try {
    return { id, ...validateLesson(input) };
  } catch (error) {
    if (error instanceof CourseContentDomainError) {
      throw new CourseConsumptionDomainError(
        'INVALID_PERSISTED_LESSON',
        'A estrutura persistida da aula é inválida.'
      );
    }
    throw error;
  }
}

function moduleSummaryView(id, input = {}) {
  const module = normalizePersistedModule(id, input);
  return {
    id: module.id,
    title: module.title,
    description: module.description,
    position: module.position,
    lessonCount: module.lessonCount
  };
}

function lessonSummaryView(id, input = {}) {
  const lesson = normalizePersistedLesson(id, input);
  return {
    id: lesson.id,
    moduleId: lesson.moduleId,
    title: lesson.title,
    description: lesson.description,
    position: lesson.position,
    contentType: lesson.contentType,
    durationMinutes: lesson.durationMinutes,
    isPreview: lesson.isPreview
  };
}

function lessonContentView(id, input = {}) {
  const lesson = normalizePersistedLesson(id, input);
  return {
    id: lesson.id,
    moduleId: lesson.moduleId,
    title: lesson.title,
    description: lesson.description,
    position: lesson.position,
    contentType: lesson.contentType,
    durationMinutes: lesson.durationMinutes,
    isPreview: lesson.isPreview,
    videoUrl: lesson.videoUrl,
    body: lesson.body,
    documentUrl: lesson.documentUrl
  };
}

function canAccessPublicPreview({ course = {}, lesson = {} } = {}) {
  let normalizedLesson;
  try {
    normalizedLesson = normalizePersistedLesson('preview-check', lesson);
  } catch (_error) {
    return false;
  }

  return Boolean(
    course.status === 'published' &&
    course.visibility === 'platform' &&
    normalizedLesson.isPreview === true
  );
}

function studentCourseConsumptionView(courseId, course = {}) {
  const counters = courseContentCounters(course);
  return {
    id: courseId,
    title: course.title || null,
    description: course.description || null,
    contentRevision: counters.contentRevision,
    moduleCount: counters.moduleCount,
    lessonCount: counters.lessonCount,
    estimatedDurationMinutes: counters.estimatedDurationMinutes
  };
}

function buildStudentCourseStructure({
  courseId,
  course = {},
  modules = [],
  lessons = []
} = {}) {
  if (course.status !== 'published') {
    throw new CourseConsumptionDomainError(
      'COURSE_NOT_PUBLISHED',
      'Somente curso publicado pode ser consumido.'
    );
  }

  const normalizedModules = modules
    .map(item => moduleSummaryView(item.id, item.data || item))
    .sort((left, right) => (
      left.position - right.position ||
      left.title.localeCompare(right.title, 'pt-BR')
    ));

  const modulesById = new Map(normalizedModules.map(module => [module.id, module]));
  const lessonsByModule = new Map(normalizedModules.map(module => [module.id, []]));

  for (const item of lessons) {
    const lesson = lessonSummaryView(item.id, item.data || item);
    if (!modulesById.has(lesson.moduleId)) {
      throw new CourseConsumptionDomainError(
        'ORPHAN_LESSON',
        'A estrutura persistida contém aula sem módulo válido.'
      );
    }
    lessonsByModule.get(lesson.moduleId).push(lesson);
  }

  for (const list of lessonsByModule.values()) {
    list.sort((left, right) => (
      left.position - right.position ||
      left.title.localeCompare(right.title, 'pt-BR')
    ));
  }

  return {
    course: studentCourseConsumptionView(courseId, course),
    modules: normalizedModules.map(module => ({
      ...module,
      lessons: lessonsByModule.get(module.id)
    }))
  };
}

module.exports = {
  CourseConsumptionDomainError,
  moduleSummaryView,
  lessonSummaryView,
  lessonContentView,
  canAccessPublicPreview,
  studentCourseConsumptionView,
  buildStudentCourseStructure
};
