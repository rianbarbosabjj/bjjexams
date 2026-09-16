'use strict';

const assert = require('assert');
const {
  DEFAULT_MODEL,
  RESPONSES_URL,
  minimalCourseInput,
  createOpenAICourseModerationProvider
} = require('../functions/src/courses/course-moderation-provider-openai');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('envia somente campos minimos do curso para o provedor', () => {
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
      description: 'Descrição válida',
      ownerType: 'user',
      visibility: 'platform',
      isPaid: true,
      priceCents: 14940,
      currency: 'BRL'
    }
  );
});

test('usa Responses API com schema estruturado e store false', async () => {
  let call = null;
  const provider = createOpenAICourseModerationProvider({
    apiKey: 'test-key',
    httpClient: {
      async post(url, payload, options) {
        call = { url, payload, options };
        return {
          data: {
            output_text: JSON.stringify({
              decision: 'approved',
              riskLevel: 'low',
              confidence: 0.98,
              reasonCodes: [],
              summary: 'Sem sinal relevante.'
            })
          }
        };
      }
    }
  });

  const result = await provider.moderateCourse({
    title: 'Passagem de guarda',
    description: 'Curso esportivo de jiu-jitsu com fundamentos de passagem de guarda.',
    isPaid: false
  });

  assert.strictEqual(call.url, RESPONSES_URL);
  assert.strictEqual(call.payload.model, DEFAULT_MODEL);
  assert.strictEqual(call.payload.store, false);
  assert.strictEqual(call.payload.text.format.type, 'json_schema');
  assert.strictEqual(call.options.headers.Authorization, 'Bearer test-key');
  assert.strictEqual(result.decision, 'approved');
  assert.strictEqual(result.provider, 'openai');
});

test('resposta sem output falha fechado por excecao do adapter', async () => {
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
    /resposta sem output estruturado/
  );
});

test('json invalido do provedor gera erro para fallback humano', async () => {
  const provider = createOpenAICourseModerationProvider({
    apiKey: 'test-key',
    httpClient: {
      async post() {
        return { data: { output_text: '{nao-json' } };
      }
    }
  });

  await assert.rejects(
    () => provider.moderateCourse({ title: 'Curso' }),
    /JSON estruturado inválido/
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
