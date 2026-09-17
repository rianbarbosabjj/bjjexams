'use strict';

const assert = require('assert');
const {
  CourseProgressDomainError,
  calculateProgressPercent,
  validateLessonProgress,
  normalizeEnrollmentProgressState,
  nextProgressAggregate,
  buildLessonProgress,
  buildCourseProgressView
} = require('../functions/src/courses/course-progress-domain');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function expectDomainCode(code, fn) {
  assert.throws(fn, error => (
    error instanceof CourseProgressDomainError && error.code === code
  ));
}

const ts = { _seconds: 1, _nanoseconds: 0 };

test('percentual agregado usa duas casas decimais', () => {
  assert.strictEqual(calculateProgressPercent(2, 3), 66.67);
});

test('percentual integral chega exatamente a cem', () => {
  assert.strictEqual(calculateProgressPercent(4, 4), 100);
});

test('contador concluido nunca pode exceder total', () => {
  expectDomainCode('PROGRESS_COUNT_EXCEEDS_TOTAL', () =>
    calculateProgressPercent(5, 4)
  );
});

test('matricula sem progresso novo normaliza contador zero', () => {
  const state = normalizeEnrollmentProgressState({
    status: 'active',
    progressPercent: 0,
    completedAt: null
  }, {
    totalLessonCount: 4,
    contentRevision: 7
  });
  assert.strictEqual(state.completedLessonCount, 0);
  assert.strictEqual(state.progressPercent, 0);
  assert.strictEqual(state.progressContentRevision, null);
});

test('percentual persistido sem contador falha fechado', () => {
  expectDomainCode('PROGRESS_AGGREGATE_INCONSISTENT', () =>
    normalizeEnrollmentProgressState({
      status: 'active',
      progressPercent: 25
    }, {
      totalLessonCount: 4,
      contentRevision: 7
    })
  );
});

test('contador e percentual divergentes falham fechado', () => {
  expectDomainCode('PROGRESS_AGGREGATE_INCONSISTENT', () =>
    normalizeEnrollmentProgressState({
      status: 'active',
      progressPercent: 20,
      completedLessonCount: 1,
      progressContentRevision: 7
    }, {
      totalLessonCount: 4,
      contentRevision: 7
    })
  );
});

test('revisao divergente do progresso falha fechado', () => {
  expectDomainCode('PROGRESS_CONTENT_REVISION_MISMATCH', () =>
    normalizeEnrollmentProgressState({
      status: 'active',
      progressPercent: 25,
      completedLessonCount: 1,
      progressContentRevision: 6
    }, {
      totalLessonCount: 4,
      contentRevision: 7
    })
  );
});

test('progresso de aula preserva identidade e revisao', () => {
  const built = buildLessonProgress({
    courseId: 'course-1',
    userId: 'user-1',
    lessonId: 'lesson-1',
    contentRevision: 7,
    timestamp: ts
  });
  const progress = validateLessonProgress(built, {
    courseId: 'course-1',
    userId: 'user-1',
    lessonId: 'lesson-1',
    contentRevision: 7
  });
  assert.strictEqual(progress.status, 'completed');
  assert.strictEqual(progress.contentRevision, 7);
});

test('progresso de aula com identidade trocada falha fechado', () => {
  expectDomainCode('PROGRESS_IDENTITY_MISMATCH', () =>
    validateLessonProgress({
      courseId: 'course-1',
      userId: 'other-user',
      lessonId: 'lesson-1',
      status: 'completed',
      contentRevision: 7,
      completedAt: ts
    }, {
      courseId: 'course-1',
      userId: 'user-1',
      lessonId: 'lesson-1',
      contentRevision: 7
    })
  );
});

test('replay idempotente nao incrementa contador', () => {
  const next = nextProgressAggregate({
    completedLessonCount: 2,
    totalLessonCount: 4,
    alreadyCompleted: true
  });
  assert.strictEqual(next.completedLessonCount, 2);
  assert.strictEqual(next.progressPercent, 50);
  assert.strictEqual(next.courseCompleted, false);
});

test('ultima aula conclui agregado do curso', () => {
  const next = nextProgressAggregate({
    completedLessonCount: 3,
    totalLessonCount: 4,
    alreadyCompleted: false
  });
  assert.strictEqual(next.completedLessonCount, 4);
  assert.strictEqual(next.progressPercent, 100);
  assert.strictEqual(next.courseCompleted, true);
});

test('visao de progresso exige detalhe compativel com agregado', () => {
  const enrollment = {
    status: 'active',
    progressPercent: 50,
    completedLessonCount: 2,
    progressContentRevision: 7,
    completedAt: null
  };

  const view = buildCourseProgressView({
    enrollmentId: 'enrollment-1',
    courseId: 'course-1',
    enrollment,
    totalLessonCount: 4,
    contentRevision: 7,
    completedLessonIds: ['lesson-2', 'lesson-1']
  });
  assert.deepStrictEqual(view.completedLessonIds, ['lesson-1', 'lesson-2']);
  assert.strictEqual(view.progressPercent, 50);

  expectDomainCode('PROGRESS_DETAIL_AGGREGATE_MISMATCH', () =>
    buildCourseProgressView({
      enrollmentId: 'enrollment-1',
      courseId: 'course-1',
      enrollment,
      totalLessonCount: 4,
      contentRevision: 7,
      completedLessonIds: ['lesson-1']
    })
  );
});

let passed = 0;
for (const item of cases) {
  try {
    item.fn();
    passed += 1;
    console.log(`PASS | ${item.name}`);
  } catch (error) {
    console.error(`FAIL | ${item.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log(`COURSE_PROGRESS_DOMAIN_V1_2=${passed}/${cases.length}`);
