'use strict';

const assert = require('assert');
const {
  PUBLICATION_SNAPSHOT_VERSION,
  MODERATION_SCOPE_VERSION,
  buildPublicationSnapshot,
  publicationFingerprint,
  buildStructuralModerationInput
} = require('../functions/src/courses/course-publication-snapshot');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

const baseCourse = {
  title: 'Curso de guarda',
  description: 'Estrutura completa para estudo de guarda no jiu-jitsu.',
  ownerType: 'user',
  ownerId: 'uid-123',
  instructorIds: ['uid-456', 'uid-123'],
  visibility: 'platform',
  organizationId: 'team-1',
  isPaid: true,
  priceCents: 14990,
  currency: 'brl',
  contentRevision: 7,
  updatedAt: { seconds: 999 }
};

const modules = [
  {
    id: 'm2',
    title: 'Aplicações',
    description: 'Módulo B',
    position: 2,
    lessonCount: 1,
    updatedAt: { seconds: 5 }
  },
  {
    id: 'm1',
    title: 'Fundamentos',
    description: 'Módulo A',
    position: 1,
    lessonCount: 2,
    updatedAt: { seconds: 4 }
  }
];

const lessons = [
  {
    id: 'l3',
    moduleId: 'm2',
    title: 'Material complementar',
    description: 'PDF de apoio',
    position: 1,
    contentType: 'document',
    durationMinutes: 3,
    isPreview: false,
    documentUrl: 'https://example.com/material.pdf'
  },
  {
    id: 'l2',
    moduleId: 'm1',
    title: 'Resumo conceitual',
    description: 'Texto de apoio',
    position: 2,
    contentType: 'text',
    durationMinutes: 5,
    isPreview: false,
    body: 'Conteúdo integral da aula textual.'
  },
  {
    id: 'l1',
    moduleId: 'm1',
    title: 'Introdução',
    description: 'Vídeo inicial',
    position: 1,
    contentType: 'video',
    durationMinutes: 12,
    isPreview: true,
    videoUrl: 'https://example.com/video'
  }
];

test('snapshot canonico usa versao explicita e ordenacao deterministica', () => {
  const snapshot = buildPublicationSnapshot({ course: baseCourse, modules, lessons });
  assert.strictEqual(snapshot.version, PUBLICATION_SNAPSHOT_VERSION);
  assert.deepStrictEqual(snapshot.modules.map(item => item.id), ['m1', 'm2']);
  assert.deepStrictEqual(snapshot.lessons.map(item => item.id), ['l1', 'l2', 'l3']);
});

test('fingerprint independe da ordem de leitura das subcolecoes', () => {
  const first = publicationFingerprint({ course: baseCourse, modules, lessons });
  const second = publicationFingerprint({
    course: { ...baseCourse },
    modules: [...modules].reverse(),
    lessons: [...lessons].reverse()
  });
  assert.strictEqual(first.hash, second.hash);
  assert.strictEqual(first.contentRevision, 7);
});

test('timestamps e contadores denormalizados nao alteram o hash', () => {
  const first = publicationFingerprint({ course: baseCourse, modules, lessons });
  const second = publicationFingerprint({
    course: {
      ...baseCourse,
      updatedAt: { seconds: 123456 },
      moduleCount: 99,
      lessonCount: 99,
      estimatedDurationMinutes: 999
    },
    modules: modules.map(item => ({
      ...item,
      lessonCount: 999,
      updatedAt: { seconds: 999 }
    })),
    lessons
  });
  assert.strictEqual(first.hash, second.hash);
});

test('mudanca estrutural ou de conteudo altera o fingerprint', () => {
  const original = publicationFingerprint({ course: baseCourse, modules, lessons }).hash;

  const changedModule = publicationFingerprint({
    course: baseCourse,
    modules: modules.map(item => item.id === 'm1' ? { ...item, title: 'Fundamentos revisados' } : item),
    lessons
  }).hash;

  const changedBody = publicationFingerprint({
    course: baseCourse,
    modules,
    lessons: lessons.map(item => item.id === 'l2' ? { ...item, body: 'Novo conteúdo textual.' } : item)
  }).hash;

  const changedUrl = publicationFingerprint({
    course: baseCourse,
    modules,
    lessons: lessons.map(item => item.id === 'l1' ? { ...item, videoUrl: 'https://example.com/video-2' } : item)
  }).hash;

  const changedPosition = publicationFingerprint({
    course: baseCourse,
    modules,
    lessons: lessons.map(item => item.id === 'l1' ? { ...item, position: 3 } : item)
  }).hash;

  assert.notStrictEqual(changedModule, original);
  assert.notStrictEqual(changedBody, original);
  assert.notStrictEqual(changedUrl, original);
  assert.notStrictEqual(changedPosition, original);
});

test('moderacao recebe somente textos estruturais e tipo da aula', () => {
  const snapshot = buildPublicationSnapshot({ course: baseCourse, modules, lessons });
  const input = buildStructuralModerationInput(snapshot);
  const serialized = JSON.stringify(input);

  assert.strictEqual(input.scopeVersion, MODERATION_SCOPE_VERSION);
  assert.strictEqual(input.title, 'Curso de guarda');
  assert.strictEqual(input.modules[0].title, 'Fundamentos');
  assert.strictEqual(input.modules[0].lessons[0].title, 'Introdução');
  assert.strictEqual(input.modules[0].lessons[1].contentType, 'text');

  assert.ok(!serialized.includes('uid-123'));
  assert.ok(!serialized.includes('uid-456'));
  assert.ok(!serialized.includes('team-1'));
  assert.ok(!serialized.includes('14990'));
  assert.ok(!serialized.includes('example.com/video'));
  assert.ok(!serialized.includes('example.com/material.pdf'));
  assert.ok(!serialized.includes('Conteúdo integral da aula textual.'));
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

console.log(`COURSE_PUBLICATION_SNAPSHOT_V1_2=${passed}/${cases.length}`);
