'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  PUBLICATION_SNAPSHOT_VERSION,
  MODERATION_SCOPE_VERSION,
  samePublicationFingerprint,
  buildPublicationSnapshot,
  buildStructuralModerationInput
} = require('../functions/src/courses/course-publication-snapshot');
const {
  minimalCourseInput
} = require('../functions/src/courses/course-moderation-provider-gemini');

const root = path.resolve(__dirname, '..');
const submission = fs.readFileSync(
  path.join(root, 'functions/src/courses/course-moderation-submission-functions.js'),
  'utf8'
);

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('fingerprint exige hash versao e contentRevision iguais', () => {
  const expected = {
    version: PUBLICATION_SNAPSHOT_VERSION,
    hash: 'abc123',
    contentRevision: 7
  };

  assert.strictEqual(samePublicationFingerprint(expected, { ...expected }), true);
  assert.strictEqual(
    samePublicationFingerprint(expected, { ...expected, contentRevision: 8 }),
    false
  );
  assert.strictEqual(
    samePublicationFingerprint(expected, { ...expected, hash: 'def456' }),
    false
  );
  assert.strictEqual(
    samePublicationFingerprint(expected, { ...expected, version: 'legacy-v1' }),
    false
  );
});

test('payload estrutural nao envia posicoes urls corpo integral ou identificadores', () => {
  const snapshot = buildPublicationSnapshot({
    course: {
      title: 'Curso estrutural',
      description: 'Descrição estrutural suficiente para triagem.',
      ownerType: 'user',
      ownerId: 'uid-sensitive',
      priceCents: 9990,
      contentRevision: 3
    },
    modules: [{
      id: 'm1',
      title: 'Módulo um',
      description: 'Descrição do módulo',
      position: 9
    }],
    lessons: [{
      id: 'l1',
      moduleId: 'm1',
      title: 'Aula um',
      description: 'Descrição da aula',
      position: 8,
      contentType: 'text',
      body: 'Corpo integral que não deve sair.',
      videoUrl: 'https://example.com/private-video',
      documentUrl: 'https://example.com/private.pdf'
    }]
  });

  const input = buildStructuralModerationInput(snapshot);
  const serialized = JSON.stringify(input);

  assert.strictEqual(input.scopeVersion, MODERATION_SCOPE_VERSION);
  assert.ok(serialized.includes('Módulo um'));
  assert.ok(serialized.includes('Aula um'));
  assert.ok(serialized.includes('text'));
  assert.ok(!serialized.includes('uid-sensitive'));
  assert.ok(!serialized.includes('9990'));
  assert.ok(!serialized.includes('position'));
  assert.ok(!serialized.includes('example.com'));
  assert.ok(!serialized.includes('Corpo integral que não deve sair.'));
});

test('adapter Gemini preserva somente contrato estrutural permitido', () => {
  const input = minimalCourseInput({
    scopeVersion: MODERATION_SCOPE_VERSION,
    title: 'Curso',
    description: 'Descrição',
    ownerId: 'uid-sensitive',
    priceCents: 12345,
    modules: [{
      title: 'Módulo',
      description: 'Descrição módulo',
      position: 99,
      privateField: 'segredo',
      lessons: [{
        title: 'Aula',
        description: 'Descrição aula',
        contentType: 'video',
        position: 88,
        videoUrl: 'https://example.com/video',
        body: 'não enviar'
      }]
    }]
  });

  assert.deepStrictEqual(input, {
    title: 'Curso',
    description: 'Descrição',
    scopeVersion: MODERATION_SCOPE_VERSION,
    modules: [{
      title: 'Módulo',
      description: 'Descrição módulo',
      lessons: [{
        title: 'Aula',
        description: 'Descrição aula',
        contentType: 'video'
      }]
    }]
  });
});

test('submissao usa snapshot canonico e nao hash local legado', () => {
  assert.ok(submission.includes("require('./course-publication-snapshot')"));
  assert.ok(submission.includes('publicationFingerprint'));
  assert.ok(submission.includes('buildStructuralModerationInput'));
  assert.ok(submission.includes('publicationStateInTransaction'));
  assert.ok(!submission.includes('function contentFingerprint('));
});

test('lock de review captura modulos e aulas na mesma transacao', () => {
  assert.ok(submission.includes("tx.get(courseRef.collection('modules'))"));
  assert.ok(submission.includes("tx.get(courseRef.collection('lessons'))"));
  const stateIndex = submission.indexOf('await publicationStateInTransaction(tx, courseRef, course)');
  const lockIndex = submission.indexOf("status: 'review'");
  assert.ok(stateIndex >= 0 && lockIndex > stateIndex);
});

test('submissao persiste hash versionado revisao e escopo de moderacao', () => {
  assert.ok(submission.includes('contentHash: submittedFingerprint.hash'));
  assert.ok(submission.includes('contentHashVersion: submittedFingerprint.version'));
  assert.ok(submission.includes('contentRevision: submittedFingerprint.contentRevision'));
  assert.ok(submission.includes('moderationScopeVersion: MODERATION_SCOPE_VERSION'));
});

test('conclusao da triagem invalida alteracao de hash ou revisao', () => {
  assert.ok(submission.includes('contentChangedDuringModeration'));
  assert.ok(submission.includes('samePublicationFingerprint(submittedFingerprint, currentState.fingerprint)'));
  assert.ok(submission.includes('samePublicationFingerprint(submittedFingerprint, pendingFingerprint)'));
  assert.ok(submission.includes('CONTENT_CHANGED_DURING_MODERATION'));
});

test('override humano nao publica conteudo diferente do que foi triado', () => {
  assert.ok(submission.includes("if (targetStatus === 'published')"));
  assert.ok(submission.includes('fingerprintFromModeration(existing.moderation || {})'));
  assert.ok(submission.includes('samePublicationFingerprint(reviewedFingerprint, currentState.fingerprint)'));
  assert.ok(submission.includes('O conteúdo atual não corresponde à versão triada.'));
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

console.log(`COURSE_PUBLICATION_FINGERPRINT_WORKFLOW_V1_2=${passed}/${cases.length}`);
