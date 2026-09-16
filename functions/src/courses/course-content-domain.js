"use strict";

const COURSE_CONTENT_TYPES = Object.freeze([
  "video",
  "text",
  "document"
]);

class CourseContentDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CourseContentDomainError";
    this.code = code;
  }
}

function text(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function integer(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function boolean(value) {
  return value === true;
}

function httpsUrl(value, field) {
  const normalized = text(value);
  if (!normalized) return null;
  if (normalized.length > 2000) {
    throw new CourseContentDomainError(
      "INVALID_URL",
      `${field} excede 2000 caracteres.`
    );
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch (_) {
    throw new CourseContentDomainError(
      "INVALID_URL",
      `${field} precisa ser uma URL valida.`
    );
  }

  if (parsed.protocol !== "https:") {
    throw new CourseContentDomainError(
      "INVALID_URL",
      `${field} precisa usar HTTPS.`
    );
  }

  return parsed.toString();
}

function validatePosition(value) {
  const position = integer(value, 0);
  if (!Number.isInteger(position) || position < 0 || position > 9999) {
    throw new CourseContentDomainError(
      "INVALID_POSITION",
      "position precisa ser um inteiro entre 0 e 9999."
    );
  }
  return position;
}

function normalizeModuleInput(input = {}) {
  return {
    title: text(input.title),
    description: text(input.description),
    position: validatePosition(input.position),
    lessonCount: Math.max(0, integer(input.lessonCount, 0))
  };
}

function validateModule(input = {}) {
  const module = normalizeModuleInput(input);

  if (!module.title || module.title.length < 3) {
    throw new CourseContentDomainError(
      "INVALID_MODULE_TITLE",
      "O modulo precisa de um titulo com pelo menos 3 caracteres."
    );
  }
  if (module.title.length > 160) {
    throw new CourseContentDomainError(
      "INVALID_MODULE_TITLE",
      "O titulo do modulo excede 160 caracteres."
    );
  }
  if (module.description && module.description.length > 2000) {
    throw new CourseContentDomainError(
      "INVALID_MODULE_DESCRIPTION",
      "A descricao do modulo excede 2000 caracteres."
    );
  }
  if (!Number.isInteger(module.lessonCount)) {
    throw new CourseContentDomainError(
      "INVALID_LESSON_COUNT",
      "lessonCount invalido."
    );
  }

  return module;
}

function normalizeLessonInput(input = {}) {
  const contentType = String(input.contentType || "").trim().toLowerCase();
  const durationMinutes = integer(input.durationMinutes, 0);

  return {
    moduleId: text(input.moduleId),
    title: text(input.title),
    description: text(input.description),
    position: validatePosition(input.position),
    contentType,
    durationMinutes,
    isPreview: boolean(input.isPreview),
    videoUrl: httpsUrl(input.videoUrl, "videoUrl"),
    body: text(input.body),
    documentUrl: httpsUrl(input.documentUrl, "documentUrl")
  };
}

function validateLesson(input = {}) {
  const lesson = normalizeLessonInput(input);

  if (!lesson.moduleId) {
    throw new CourseContentDomainError(
      "MODULE_REQUIRED",
      "A aula precisa pertencer a um modulo."
    );
  }
  if (!lesson.title || lesson.title.length < 3) {
    throw new CourseContentDomainError(
      "INVALID_LESSON_TITLE",
      "A aula precisa de um titulo com pelo menos 3 caracteres."
    );
  }
  if (lesson.title.length > 160) {
    throw new CourseContentDomainError(
      "INVALID_LESSON_TITLE",
      "O titulo da aula excede 160 caracteres."
    );
  }
  if (lesson.description && lesson.description.length > 4000) {
    throw new CourseContentDomainError(
      "INVALID_LESSON_DESCRIPTION",
      "A descricao da aula excede 4000 caracteres."
    );
  }
  if (!COURSE_CONTENT_TYPES.includes(lesson.contentType)) {
    throw new CourseContentDomainError(
      "INVALID_CONTENT_TYPE",
      "contentType precisa ser video, text ou document."
    );
  }
  if (
    !Number.isInteger(lesson.durationMinutes) ||
    lesson.durationMinutes < 0 ||
    lesson.durationMinutes > 1440
  ) {
    throw new CourseContentDomainError(
      "INVALID_DURATION",
      "durationMinutes precisa ser um inteiro entre 0 e 1440."
    );
  }
  if (lesson.body && lesson.body.length > 100000) {
    throw new CourseContentDomainError(
      "INVALID_LESSON_BODY",
      "O texto da aula excede 100000 caracteres."
    );
  }

  if (lesson.contentType === "video" && !lesson.videoUrl) {
    throw new CourseContentDomainError(
      "VIDEO_URL_REQUIRED",
      "Aula em video exige videoUrl HTTPS."
    );
  }
  if (lesson.contentType === "text" && !lesson.body) {
    throw new CourseContentDomainError(
      "LESSON_BODY_REQUIRED",
      "Aula em texto exige conteudo textual."
    );
  }
  if (lesson.contentType === "document" && !lesson.documentUrl) {
    throw new CourseContentDomainError(
      "DOCUMENT_URL_REQUIRED",
      "Aula em documento exige documentUrl HTTPS."
    );
  }

  if (lesson.contentType !== "video") lesson.videoUrl = null;
  if (lesson.contentType !== "text") lesson.body = null;
  if (lesson.contentType !== "document") lesson.documentUrl = null;

  return lesson;
}

function nextContentRevision(course = {}) {
  const current = integer(course.contentRevision, 0);
  if (!Number.isInteger(current) || current < 0) return 1;
  return current + 1;
}

function courseContentCounters(course = {}) {
  return {
    contentRevision: Math.max(0, integer(course.contentRevision, 0) || 0),
    moduleCount: Math.max(0, integer(course.moduleCount, 0) || 0),
    lessonCount: Math.max(0, integer(course.lessonCount, 0) || 0),
    estimatedDurationMinutes: Math.max(
      0,
      integer(course.estimatedDurationMinutes, 0) || 0
    )
  };
}

module.exports = {
  COURSE_CONTENT_TYPES,
  CourseContentDomainError,
  normalizeModuleInput,
  validateModule,
  normalizeLessonInput,
  validateLesson,
  nextContentRevision,
  courseContentCounters
};
