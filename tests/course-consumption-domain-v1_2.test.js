'use strict';

const assert = require('assert');
const {
  CourseConsumptionDomainError,
  lessonSummaryView,
  lessonContentView,
  canAccessPublicPreview,
  buildStudentCourseStructure
} = require('../functions/src/courses/course-consumption-domain');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

function lesson(overrides = {}) {
  return {
    moduleId: 'module-a',
    title: 'Aula de guarda',
    description: 'Descrição',
    position: 0,
    contentType: 'video',
    durationMinutes: 12,
    isPreview: false,
    videoUrl: 'https://example.com/video.mp4',
    body: null,
    documentUrl: null,
    ...overrides
  };
}

function module(overrides = {}) {
  return {
    title: 'Fundamentos',
    description: 'Base técnica',
    position: 0,
    lessonCount: 1,
    ...overrides
  };
}

test('preview publico exige curso publicado da plataforma e aula marcada', () => {
  assert.equal(canAccessPublicPreview({
    course: { status: 'published', visibility: 'platform' },
    lesson: lesson({ isPreview: true })
  }), true);

  assert.equal(canAccessPublicPreview({
    course: { status: 'draft', visibility: 'platform' },
    lesson: lesson({ isPreview: true })
  }), false);

  assert.equal(canAccessPublicPreview({
    course: { status: 'published', visibility: 'organization' },
    lesson: lesson({ isPreview: true })
  }), false);

  assert.equal(canAccessPublicPreview({
    course: { status: 'published', visibility: 'private' },
    lesson: lesson({ isPreview: true })
  }), false);
});

test('aula sem flag de preview nunca abre publicamente', () => {
  assert.equal(canAccessPublicPreview({
    course: { status: 'published', visibility: 'platform' },
    lesson: lesson({ isPreview: false })
  }), false);
});

test('resumo de aula nunca inclui payload integral', () => {
  const summary = lessonSummaryView('lesson-1', lesson({
    contentType: 'text',
    videoUrl: null,
    body: 'conteúdo protegido',
    documentUrl: null
  }));

  assert.equal(summary.id, 'lesson-1');
  assert.equal(summary.contentType, 'text');
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'body'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'videoUrl'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'documentUrl'), false);
});

test('visao integral preserva somente payload compativel com o tipo', () => {
  const view = lessonContentView('lesson-1', lesson({
    contentType: 'text',
    videoUrl: 'https://example.com/ignored.mp4',
    body: 'conteúdo protegido',
    documentUrl: 'https://example.com/ignored.pdf'
  }));

  assert.equal(view.body, 'conteúdo protegido');
  assert.equal(view.videoUrl, null);
  assert.equal(view.documentUrl, null);
});

test('estrutura do aluno agrupa e ordena modulos e aulas', () => {
  const result = buildStudentCourseStructure({
    courseId: 'course-1',
    course: {
      status: 'published',
      title: 'Curso',
      description: 'Descrição',
      contentRevision: 3,
      moduleCount: 2,
      lessonCount: 2,
      estimatedDurationMinutes: 20
    },
    modules: [
      { id: 'module-b', data: module({ title: 'Segundo', position: 2 }) },
      { id: 'module-a', data: module({ title: 'Primeiro', position: 1 }) }
    ],
    lessons: [
      { id: 'lesson-b', data: lesson({ moduleId: 'module-b', title: 'B aula', position: 2 }) },
      { id: 'lesson-a', data: lesson({ moduleId: 'module-a', title: 'A aula', position: 1 }) }
    ]
  });

  assert.deepEqual(result.modules.map(item => item.id), ['module-a', 'module-b']);
  assert.deepEqual(result.modules[0].lessons.map(item => item.id), ['lesson-a']);
  assert.deepEqual(result.modules[1].lessons.map(item => item.id), ['lesson-b']);
  assert.equal(result.course.contentRevision, 3);
});

test('estrutura publicada falha fechado quando existe aula orfa', () => {
  assert.throws(
    () => buildStudentCourseStructure({
      courseId: 'course-1',
      course: { status: 'published' },
      modules: [{ id: 'module-a', data: module() }],
      lessons: [{ id: 'lesson-1', data: lesson({ moduleId: 'missing-module' }) }]
    }),
    error => error instanceof CourseConsumptionDomainError && error.code === 'ORPHAN_LESSON'
  );
});

test('estrutura de curso nao publicado falha fechado', () => {
  assert.throws(
    () => buildStudentCourseStructure({
      courseId: 'course-1',
      course: { status: 'suspended' },
      modules: [],
      lessons: []
    }),
    error => error instanceof CourseConsumptionDomainError && error.code === 'COURSE_NOT_PUBLISHED'
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

console.log(`COURSE_CONSUMPTION_DOMAIN_V1_2=${passed}/${cases.length}`);
