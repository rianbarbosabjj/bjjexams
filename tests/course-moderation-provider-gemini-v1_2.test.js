'use strict';

const assert = require('assert');
const {
  DEFAULT_MODEL,
  INTERACTIONS_URL,
  minimalCourseInput,
  buildModerationInput,
  extractInteractionOutputText,
  normalizeResult,
  createGeminiCourseModerationProvider
} = require('../functions/src/courses/course-moderation-provider-gemini');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('envia somente titulo e descricao para o Gemini', () => {
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

test('prompt preserva contexto esportivo e evita julgamento tecnico', () => {
  const input = buildModerationInput({
    title: 'Finalizações esportivas',
    description: 'Técnicas de chave de braço para competição de jiu-jitsu.'
  });
  assert.ok(input.includes('Jiu-jitsu, grappling'));
  assert.ok(input.includes('não julgue qualidade técnica'));
  assert.ok(input.includes('Finalizações esportivas'));
  assert.ok(input.includes('chave de braço'));
});

test('usa Gemini Interactions API com structured output', async () => {
  let call = null;
  const provider = createGeminiCourseModerationProvider({
    apiKey: 'test-key',
    httpClient: {
      async post(url, payload, options) {
        call = { url, payload, options };
        return {
          data: {
            model: DEFAULT_MODEL,
            status: 'completed',
            steps: [{
              type: 'model_output',
              content: [{
                type: 'text',
                text: JSON.stringify({
                  decision: 'approved',
                  riskLevel: 'low',
                  confidence: 0.96,
                  reasonCodes: [],
                  summary: 'Sem sinal relevante.'
                })
              }]
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

  assert.strictEqual(call.url, INTERACTIONS_URL);
  assert.strictEqual(call.payload.model, DEFAULT_MODEL);
  assert.strictEqual(call.payload.response_format.mime_type, 'application/json');
  assert.strictEqual(call.payload.response_format.schema.type, 'object');
  assert.strictEqual(call.options.headers['x-goog-api-key'], 'test-key');
  assert.strictEqual(result.decision, 'approved');
  assert.strictEqual(result.provider, 'google-gemini');
  assert.strictEqual(result.model, DEFAULT_MODEL);
});

test('extrai output_text direto quando disponivel', () => {
  const json = JSON.stringify({ decision: 'manual_review' });
  assert.strictEqual(extractInteractionOutputText({ output_text: json }), json);
});

test('decisao invalida falha fechado para manual review', () => {
  const result = normalizeResult({
    decision: 'inventada',
    riskLevel: 'banana',
    confidence: 'nao-numero',
    reasonCodes: ['UNKNOWN'],
    summary: 'Teste.'
  });

  assert.strictEqual(result.decision, 'manual_review');
  assert.strictEqual(result.riskLevel, 'high');
  assert.strictEqual(result.confidence, 0);
});

test('blocked continua sujeito a politica canonica humana', () => {
  const result = normalizeResult({
    decision: 'blocked',
    riskLevel: 'high',
    confidence: 0.99,
    reasonCodes: ['SEVERE_POLICY_VIOLATION'],
    summary: 'Violação grave.'
  });

  assert.strictEqual(result.decision, 'blocked');
  assert.strictEqual(result.riskLevel, 'high');
  assert.strictEqual(result.provider, 'google-gemini');
});

test('resposta sem output falha fechado por excecao do adapter', async () => {
  const provider = createGeminiCourseModerationProvider({
    apiKey: 'test-key',
    httpClient: {
      async post() {
        return { data: { status: 'completed', steps: [] } };
      }
    }
  });

  await assert.rejects(
    () => provider.moderateCourse({ title: 'Curso' }),
    /resposta sem output estruturado/
  );
});

test('json invalido do Gemini gera erro para fallback humano', async () => {
  const provider = createGeminiCourseModerationProvider({
    apiKey: 'test-key',
    httpClient: {
      async post() {
        return {
          data: {
            steps: [{ type: 'model_output', content: [{ type: 'text', text: '{nao-json' }] }]
          }
        };
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
    () => createGeminiCourseModerationProvider({
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
  console.log(`COURSE_MODERATION_GEMINI_PROVIDER_V1_2=${passed}/${cases.length}`);
})();
