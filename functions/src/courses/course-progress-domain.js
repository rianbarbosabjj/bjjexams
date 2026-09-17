'use strict';

class CourseProgressDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CourseProgressDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function integer(value, field, { min = 0, allowNull = false } = {}) {
  if ((value === undefined || value === null || value === '') && allowNull) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new CourseProgressDomainError(
      'INVALID_PROGRESS_NUMBER',
      `${field} deve ser um inteiro maior ou igual a ${min}.`
    );
  }
  return number;
}

function normalizeContentRevision(value) {
  return integer(value ?? 0, 'contentRevision', { min: 0 });
}

function calculateProgressPercent(completedLessonCount, totalLessonCount) {
  const completed = integer(completedLessonCount, 'completedLessonCount', { min: 0 });
  const total = integer(totalLessonCount, 'totalLessonCount', { min: 1 });

  if (completed > total) {
    throw new CourseProgressDomainError(
      'PROGRESS_COUNT_EXCEEDS_TOTAL',
      'A quantidade de aulas concluídas excede o total do curso.'
    );
  }

  return Math.round(((completed / total) * 100) * 100) / 100;
}

function normalizeLessonProgress(input = {}) {
  return {
    courseId: text(input.courseId),
    userId: text(input.userId),
    lessonId: text(input.lessonId),
    status: text(input.status, 40)?.toLowerCase() || null,
    contentRevision: normalizeContentRevision(input.contentRevision),
    completedAt: input.completedAt ?? null,
    updatedAt: input.updatedAt ?? null
  };
}

function validateLessonProgress(input = {}, expected = {}) {
  const progress = normalizeLessonProgress(input);

  if (!progress.courseId || !progress.userId || !progress.lessonId) {
    throw new CourseProgressDomainError(
      'PROGRESS_IDENTITY_REQUIRED',
      'Progresso de aula exige curso, usuário e aula.'
    );
  }

  if ([progress.courseId, progress.userId, progress.lessonId].some(value => value.includes('/'))) {
    throw new CourseProgressDomainError(
      'INVALID_PROGRESS_IDENTITY',
      'Identidade do progresso de aula inválida.'
    );
  }

  if (progress.status !== 'completed') {
    throw new CourseProgressDomainError(
      'INVALID_LESSON_PROGRESS_STATUS',
      'O progresso persistido da aula precisa estar concluído.'
    );
  }

  if (!progress.completedAt) {
    throw new CourseProgressDomainError(
      'LESSON_COMPLETION_TIMESTAMP_REQUIRED',
      'Aula concluída precisa possuir completedAt.'
    );
  }

  const expectedCourseId = text(expected.courseId);
  const expectedUserId = text(expected.userId);
  const expectedLessonId = text(expected.lessonId);
  const expectedRevision = expected.contentRevision === undefined
    ? null
    : normalizeContentRevision(expected.contentRevision);

  if (expectedCourseId && progress.courseId !== expectedCourseId) {
    throw new CourseProgressDomainError(
      'PROGRESS_IDENTITY_MISMATCH',
      'Progresso não corresponde ao curso esperado.'
    );
  }
  if (expectedUserId && progress.userId !== expectedUserId) {
    throw new CourseProgressDomainError(
      'PROGRESS_IDENTITY_MISMATCH',
      'Progresso não corresponde ao usuário esperado.'
    );
  }
  if (expectedLessonId && progress.lessonId !== expectedLessonId) {
    throw new CourseProgressDomainError(
      'PROGRESS_IDENTITY_MISMATCH',
      'Progresso não corresponde à aula esperada.'
    );
  }
  if (expectedRevision !== null && progress.contentRevision !== expectedRevision) {
    throw new CourseProgressDomainError(
      'PROGRESS_CONTENT_REVISION_MISMATCH',
      'Progresso pertence a uma revisão diferente do conteúdo.'
    );
  }

  return progress;
}

function normalizeEnrollmentProgressState(
  enrollment = {},
  { totalLessonCount, contentRevision } = {}
) {
  const total = integer(totalLessonCount, 'totalLessonCount', { min: 1 });
  const revision = normalizeContentRevision(contentRevision);
  const persistedPercent = Number(enrollment.progressPercent ?? 0);

  if (!Number.isFinite(persistedPercent) || persistedPercent < 0 || persistedPercent > 100) {
    throw new CourseProgressDomainError(
      'INVALID_PROGRESS_PERCENT',
      'Percentual de progresso persistido inválido.'
    );
  }

  let completedLessonCount;
  if (
    enrollment.completedLessonCount === undefined ||
    enrollment.completedLessonCount === null ||
    enrollment.completedLessonCount === ''
  ) {
    if (persistedPercent !== 0 || enrollment.status === 'completed') {
      throw new CourseProgressDomainError(
        'PROGRESS_AGGREGATE_INCONSISTENT',
        'A matrícula possui progresso sem contador de aulas concluídas.'
      );
    }
    completedLessonCount = 0;
  } else {
    completedLessonCount = integer(
      enrollment.completedLessonCount,
      'completedLessonCount',
      { min: 0 }
    );
  }

  const expectedPercent = calculateProgressPercent(completedLessonCount, total);
  if (Math.abs(expectedPercent - persistedPercent) > 0.001) {
    throw new CourseProgressDomainError(
      'PROGRESS_AGGREGATE_INCONSISTENT',
      'Contador e percentual de progresso da matrícula são incompatíveis.'
    );
  }

  const progressContentRevision = (
    enrollment.progressContentRevision === undefined ||
    enrollment.progressContentRevision === null ||
    enrollment.progressContentRevision === ''
  )
    ? null
    : normalizeContentRevision(enrollment.progressContentRevision);

  if (progressContentRevision !== null && progressContentRevision !== revision) {
    throw new CourseProgressDomainError(
      'PROGRESS_CONTENT_REVISION_MISMATCH',
      'A matrícula possui progresso de outra revisão do conteúdo.'
    );
  }

  if (completedLessonCount > 0 && progressContentRevision === null) {
    throw new CourseProgressDomainError(
      'PROGRESS_CONTENT_REVISION_REQUIRED',
      'Matrícula com progresso precisa registrar a revisão do conteúdo.'
    );
  }

  const courseCompleted = completedLessonCount === total;
  if (courseCompleted && enrollment.status !== 'completed') {
    throw new CourseProgressDomainError(
      'PROGRESS_AGGREGATE_INCONSISTENT',
      'Progresso integral exige matrícula concluída.'
    );
  }
  if (!courseCompleted && enrollment.status === 'completed') {
    throw new CourseProgressDomainError(
      'PROGRESS_AGGREGATE_INCONSISTENT',
      'Matrícula concluída exige progresso integral.'
    );
  }
  if (courseCompleted && !enrollment.completedAt) {
    throw new CourseProgressDomainError(
      'COURSE_COMPLETION_TIMESTAMP_REQUIRED',
      'Matrícula concluída precisa possuir completedAt.'
    );
  }

  return {
    completedLessonCount,
    totalLessonCount: total,
    progressPercent: expectedPercent,
    progressContentRevision,
    contentRevision: revision,
    courseCompleted,
    completedAt: enrollment.completedAt ?? null,
    status: enrollment.status || null
  };
}

function nextProgressAggregate({
  completedLessonCount,
  totalLessonCount,
  alreadyCompleted = false
} = {}) {
  const current = integer(completedLessonCount, 'completedLessonCount', { min: 0 });
  const total = integer(totalLessonCount, 'totalLessonCount', { min: 1 });
  const nextCount = alreadyCompleted ? current : current + 1;
  const progressPercent = calculateProgressPercent(nextCount, total);

  return {
    completedLessonCount: nextCount,
    totalLessonCount: total,
    progressPercent,
    courseCompleted: nextCount === total
  };
}

function buildLessonProgress({
  courseId,
  userId,
  lessonId,
  contentRevision,
  timestamp
} = {}) {
  const normalizedCourseId = text(courseId);
  const normalizedUserId = text(userId);
  const normalizedLessonId = text(lessonId);

  if (!normalizedCourseId || !normalizedUserId || !normalizedLessonId || !timestamp) {
    throw new CourseProgressDomainError(
      'PROGRESS_BUILD_INPUT_REQUIRED',
      'Dados obrigatórios ausentes para registrar o progresso da aula.'
    );
  }

  if ([normalizedCourseId, normalizedUserId, normalizedLessonId].some(value => value.includes('/'))) {
    throw new CourseProgressDomainError(
      'INVALID_PROGRESS_IDENTITY',
      'Identidade do progresso de aula inválida.'
    );
  }

  return {
    courseId: normalizedCourseId,
    userId: normalizedUserId,
    lessonId: normalizedLessonId,
    status: 'completed',
    contentRevision: normalizeContentRevision(contentRevision),
    completedAt: timestamp,
    updatedAt: timestamp
  };
}

function buildCourseProgressView({
  enrollmentId,
  courseId,
  enrollment = {},
  totalLessonCount,
  contentRevision,
  completedLessonIds = []
} = {}) {
  const normalizedEnrollmentId = text(enrollmentId);
  const normalizedCourseId = text(courseId);
  if (!normalizedEnrollmentId || !normalizedCourseId) {
    throw new CourseProgressDomainError(
      'PROGRESS_IDENTITY_REQUIRED',
      'Curso e matrícula são obrigatórios para consultar progresso.'
    );
  }

  const state = normalizeEnrollmentProgressState(enrollment, {
    totalLessonCount,
    contentRevision
  });
  const ids = [...new Set((completedLessonIds || []).map(value => text(value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

  if (ids.length !== state.completedLessonCount) {
    throw new CourseProgressDomainError(
      'PROGRESS_DETAIL_AGGREGATE_MISMATCH',
      'Detalhe por aula e agregado da matrícula são incompatíveis.'
    );
  }

  return {
    courseId: normalizedCourseId,
    enrollmentId: normalizedEnrollmentId,
    status: enrollment.status || null,
    completedLessonCount: state.completedLessonCount,
    totalLessonCount: state.totalLessonCount,
    progressPercent: state.progressPercent,
    courseCompleted: state.courseCompleted,
    completedAt: enrollment.completedAt ?? null,
    completedLessonIds: ids
  };
}

module.exports = {
  CourseProgressDomainError,
  calculateProgressPercent,
  normalizeLessonProgress,
  validateLessonProgress,
  normalizeEnrollmentProgressState,
  nextProgressAggregate,
  buildLessonProgress,
  buildCourseProgressView
};
