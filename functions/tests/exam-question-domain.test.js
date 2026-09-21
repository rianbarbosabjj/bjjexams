'use strict';

const assert = require('node:assert/strict');

const {
  EXAM_QUESTION_SNAPSHOT_VERSION,
  ExamQuestionDomainError,
  examQuestionSnapshotDocumentId,
  validateExamQuestionSnapshot,
  buildExamQuestionSnapshot,
  publicExamQuestion,
  assertExamQuestionSnapshotImmutable
} = require('../src/exams/exam-question-domain');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    throw error;
  }
}

function expectCode(code, fn) {
  assert.throws(fn, error => {
    assert.ok(
      error instanceof ExamQuestionDomainError
    );
    assert.equal(error.code, code);
    return true;
  });
}

const timestamp =
  new Date('2026-09-21T14:00:00.000Z');

function base(overrides = {}) {
  return {
    snapshotVersion:
      EXAM_QUESTION_SNAPSHOT_VERSION,
    prompt:
      'Qual é a principal função da guarda?',
    alternatives: {
      A: 'Controlar distância',
      B: 'Imobilizar em pé',
      C: 'Evitar todo contato',
      D: 'Encerrar a luta automaticamente'
    },
    correctAnswer: 'A',
    category: 'Fundamentos',
    difficulty: 2,
    media: {
      imageUrl:
        'https://example.com/question.jpg',
      videoUrl:
        'https://example.com/question.mp4'
    },
    sourceQuestionId: 'legacy_question_1',
    createdAt: timestamp,
    ...overrides
  };
}

test(
  'build cria snapshot canonico e normaliza gabarito',
  () => {
    const snapshot =
      buildExamQuestionSnapshot({
        prompt: '  Pergunta oficial?  ',
        alternatives: {
          a: ' Opção A ',
          B: 'Opção B'
        },
        correctAnswer: ' a ',
        category: ' Regras ',
        difficulty: 1,
        media: null,
        sourceQuestionId: 'q_1',
        timestamp
      });

    assert.equal(
      snapshot.snapshotVersion,
      1
    );

    assert.equal(
      snapshot.prompt,
      'Pergunta oficial?'
    );

    assert.equal(
      snapshot.correctAnswer,
      'A'
    );

    assert.deepEqual(
      snapshot.alternatives,
      {
        A: 'Opção A',
        B: 'Opção B'
      }
    );
  }
);

test(
  'snapshot exige prompt',
  () => {
    expectCode(
      'EXAM_QUESTION_TEXT_REQUIRED',
      () =>
        validateExamQuestionSnapshot(
          base({
            prompt: ' '
          })
        )
    );
  }
);

test(
  'snapshot exige pelo menos duas alternativas',
  () => {
    expectCode(
      'EXAM_QUESTION_ALTERNATIVES_REQUIRED',
      () =>
        validateExamQuestionSnapshot(
          base({
            alternatives: {
              A: 'Única'
            },
            correctAnswer: 'A'
          })
        )
    );
  }
);

test(
  'snapshot rejeita label fora de A a D',
  () => {
    expectCode(
      'INVALID_EXAM_QUESTION_ALTERNATIVE_LABEL',
      () =>
        validateExamQuestionSnapshot(
          base({
            alternatives: {
              A: 'A',
              B: 'B',
              E: 'E'
            }
          })
        )
    );
  }
);

test(
  'snapshot rejeita labels duplicadas apos normalizacao',
  () => {
    expectCode(
      'DUPLICATE_EXAM_QUESTION_ALTERNATIVE',
      () =>
        validateExamQuestionSnapshot(
          base({
            alternatives: {
              A: 'Primeira',
              a: 'Duplicada',
              B: 'Segunda'
            }
          })
        )
    );
  }
);

test(
  'gabarito precisa apontar para alternativa existente',
  () => {
    expectCode(
      'EXAM_QUESTION_CORRECT_ANSWER_NOT_PRESENT',
      () =>
        validateExamQuestionSnapshot(
          base({
            alternatives: {
              A: 'A',
              B: 'B'
            },
            correctAnswer: 'C'
          })
        )
    );
  }
);

test(
  'difficulty aceita somente inteiro entre 1 e 5',
  () => {
    for (const value of [
      0,
      6,
      1.5
    ]) {
      expectCode(
        'INVALID_EXAM_QUESTION_DIFFICULTY',
        () =>
          validateExamQuestionSnapshot(
            base({
              difficulty: value
            })
          )
      );
    }
  }
);

test(
  'categoria vazia assume Geral',
  () => {
    const snapshot =
      validateExamQuestionSnapshot(
        base({
          category: ' '
        })
      );

    assert.equal(
      snapshot.category,
      'Geral'
    );
  }
);

test(
  'media https e preservada',
  () => {
    const snapshot =
      validateExamQuestionSnapshot(
        base()
      );

    assert.equal(
      snapshot.media.imageUrl,
      'https://example.com/question.jpg'
    );

    assert.equal(
      snapshot.media.videoUrl,
      'https://example.com/question.mp4'
    );
  }
);

test(
  'media rejeita protocolo nao https',
  () => {
    expectCode(
      'INVALID_EXAM_QUESTION_MEDIA_URL',
      () =>
        validateExamQuestionSnapshot(
          base({
            media: {
              imageUrl:
                'javascript:alert(1)',
              videoUrl: null
            }
          })
        )
    );
  }
);

test(
  'media rejeita campos desconhecidos',
  () => {
    expectCode(
      'INVALID_EXAM_QUESTION_MEDIA_FIELD',
      () =>
        validateExamQuestionSnapshot(
          base({
            media: {
              imageUrl: null,
              videoUrl: null,
              secretUrl:
                'https://example.com/secret'
            }
          })
        )
    );
  }
);

test(
  'id de snapshot e deterministico por sourceQuestionId',
  () => {
    const first =
      examQuestionSnapshotDocumentId(
        'legacy_q_1'
      );

    const second =
      examQuestionSnapshotDocumentId(
        'legacy_q_1'
      );

    const other =
      examQuestionSnapshotDocumentId(
        'legacy_q_2'
      );

    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.equal(first.length, 64);
  }
);

test(
  'snapshot exige schema version atual',
  () => {
    expectCode(
      'INVALID_EXAM_QUESTION_SNAPSHOT_VERSION',
      () =>
        validateExamQuestionSnapshot(
          base({
            snapshotVersion: 2
          })
        )
    );
  }
);

test(
  'projecao publica usa allowlist minima',
  () => {
    const publicQuestion =
      publicExamQuestion(
        'snapshot_1',
        base()
      );

    assert.deepEqual(
      Object.keys(publicQuestion).sort(),
      [
        'alternatives',
        'id',
        'media',
        'prompt'
      ]
    );

    assert.equal(
      publicQuestion.id,
      'snapshot_1'
    );
  }
);

test(
  'projecao publica nunca expoe gabarito ou metadados internos',
  () => {
    const publicQuestion =
      publicExamQuestion(
        'snapshot_1',
        {
          ...base(),
          providerSecret: 'never-leak',
          internalScore: 9999
        }
      );

    const serialized =
      JSON.stringify(publicQuestion);

    const forbidden = [
      'correctAnswer',
      'resposta_correta',
      'sourceQuestionId',
      'createdAt',
      'snapshotVersion',
      'providerSecret',
      'internalScore'
    ];

    for (const field of forbidden) {
      assert.equal(
        serialized.includes(field),
        false
      );
    }

    assert.equal(
      serialized.includes('never-leak'),
      false
    );
  }
);

test(
  'snapshot identico satisfaz imutabilidade',
  () => {
    assert.equal(
      assertExamQuestionSnapshotImmutable(
        base(),
        {
          ...base()
        }
      ),
      true
    );
  }
);

test(
  'snapshot bloqueia troca de gabarito',
  () => {
    expectCode(
      'IMMUTABLE_EXAM_QUESTION_SNAPSHOT',
      () =>
        assertExamQuestionSnapshotImmutable(
          base(),
          {
            ...base(),
            correctAnswer: 'B'
          }
        )
    );
  }
);

test(
  'snapshot bloqueia alteracao de alternativa',
  () => {
    expectCode(
      'IMMUTABLE_EXAM_QUESTION_SNAPSHOT',
      () =>
        assertExamQuestionSnapshotImmutable(
          base(),
          {
            ...base(),
            alternatives: {
              ...base().alternatives,
              A: 'Conteúdo alterado'
            }
          }
        )
    );
  }
);


test(
  'alternativas sao canonizadas na ordem A a D',
  () => {
    const first =
      validateExamQuestionSnapshot(
        base({
          alternatives: {
            D: 'D',
            B: 'B',
            A: 'A',
            C: 'C'
          }
        })
      );

    assert.deepEqual(
      Object.keys(first.alternatives),
      [
        'A',
        'B',
        'C',
        'D'
      ]
    );

    const second = {
      ...first,
      alternatives: {
        C: 'C',
        A: 'A',
        D: 'D',
        B: 'B'
      }
    };

    assert.equal(
      assertExamQuestionSnapshotImmutable(
        first,
        second
      ),
      true
    );
  }
);

test(
  'media rejeita credenciais embutidas em URL',
  () => {
    expectCode(
      'INVALID_EXAM_QUESTION_MEDIA_URL',
      () =>
        validateExamQuestionSnapshot(
          base({
            media: {
              imageUrl:
                'https://user:password@example.com/question.jpg',
              videoUrl: null
            }
          })
        )
    );
  }
);
console.log(
  `EXAM_QUESTION_DOMAIN_V1_2=${passed}/20`
);