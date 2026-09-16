'use strict';

const assert = require('assert');
const {
  DEFAULT_MODEL,
  MODERATIONS_URL,
  minimalCourseInput,
  buildModerationText,
  normalizeModerationResult,
  createOpenAICourseModerationProvider
} = require('../functions/src/courses/course-moderation-provider-openai');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('envia somente titulo e descricao para a moderacao', () => {
  assert.deepStrictEqual(
    minimalCourseInput({
      title: 'Curso de guarda',
      description: 'Descrição válida',
      ownerType: 'user',
      visibility: 'platform',
      isPaid: true,
      priceCents: 14940,
      currency: 'BRL',
      ownerId: 'uid-secreto',
      instructorIds: ['uid-secreto'],
      email: 'nao-enviar@example.com'
    }),
    {
      title: 'Curso de guarda',
      description: 'Descrição válida'
    }
  );
});

test('input esclarece contexto esportivo do jiu-jitsu', () => {
  const input = buildModerationText({
    title: 'Finalizações esportivas',
    description: 'Técnicas de chave de braço para competição de jiu-jitsu.'
  });
  assert.ok(input.includes('curso esportivo de jiu-jitsu/grappling'));
  assert.ok(input.includes('Finalizações esportivas'));
  assert.ok(input.includes('chave de braço'));
});

test('usa endpoint gratuito de moderacao com omni-moderation-latest', async () => {
  let call = null;
  const provider = createOpenAICourseModerationProvider({
    apiKey: 'test-key',
    httpClient: {
      async post(url, payload, options) {
        call = { url, payload, options };
        return {
          data: {
            model: DEFAULT_MODEL,
            results: [{
              flagged: false,
              categories: { violence: false, hate: false },
              category_scores: { violence: 0.04, hate: 0.001 }
            }]
          }
        };
      }
    }
  });

  const result = await provider.moderateCourse({
    title: 'Passagem de guarda',
    description: 'Curso esportivo de jiu-jitsu com fundamentos de passagem de guarda.'
  });

  assert.strictEqual(call.url, MODERATIONS_URL);
  assert.strictEqual(call.payload.model, DEFAULT_MODEL);
  assert.ok(typeof call.payload.input === 'string');
  assert.strictEqual(call.options.headers.Authorization, 'Bearer test-key');
  assert.strictEqual(result.decision, 'approved');
  assert.strictEqual(result.provider, 'openai-moderation');
  assert.ok(result.confidence >= 0.8);
});

test('conteudo sinalizado nunca e publicado automaticamente pelo adapter', () => {
  const result = normalizeModerationResult({
    model: DEFAULT_MODEL,
    results: [{
      flagged: true,
      categories: { violence: true, hate: false },
      category_scores: { violence: 0.91, hate: 0.01 }
    }]
  });

  assert.strictEqual(result.decision, 'manual_review');
  assert.strictEqual(result.riskLevel, 'medium');
  assert.ok(result.reasonCodes.includes('OPENAI_MODERATION_VIOLENCE'));
});

test('categoria grave sinalizada recebe risco alto e revisao humana', () => {
  const result = normalizeModerationResult({
    model: DEFAULT_MODEL,
    results: [{
      flagged: true,
      categories: { 'sexual/minors': true },
      category_scores: { 'sexual/minors': 0.97 }
    }]
  });

  assert.strictEqual(result.decision, 'manual_review');
  assert.strictEqual(result.riskLevel, 'high');
  assert.ok(result.reasonCodes.includes('OPENAI_MODERATION_SEXUAL_MINORS'));
});

test('score proximo do limiar reduz confianca para fallback humano da politica', () => {
  const result = normalizeModerationResult({
    model: DEFAULT_MODEL,
    results: [{
      flagged: false,
      categories: { violence: false },
      category_scores: { violence: 0.31 }
    }]
  });

  assert.strictEqual(result.decision, 'approved');
  assert.ok(result.confidence < 0.8);
});

test('resposta sem resultado de moderacao falha fechado por excecao do adapter', async () => {
  const provider = createOpenAICourseModerationProvider({
    apiKey: 'test-key',
    httpClient: {
      async post() {
        return { data: {} };
      }
    }
  });

  await assert.rejects(
    () => provider.moderateCourse({ title: 'Curso' }),
    /resposta de moderação inválida/
  );
});

test('adapter nao inicializa sem chave', () => {
  assert.throws(
    () => createOpenAICourseModerationProvider({
      apiKey: '',
      httpClient: { post() {} }
    }),
    /API key ausente/
  );
});

(async () => {
  let passed = 0;
  for (const item of cases) {
    try {
      await item.fn();
      passed += 1;
      console.log(`PASS | ${item.name}`);
    } catch (error) {
      console.error(`FAIL | ${item.name}`);
      console.error(error);
      process.exitCode = 1;
    }
  }
  console.log(`COURSE_MODERATION_OPENAI_PROVIDER_V1_2=${passed}/${cases.length}`);
})();
