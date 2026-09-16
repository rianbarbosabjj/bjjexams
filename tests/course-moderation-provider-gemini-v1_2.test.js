'use strict';

const assert = require('assert');
const {
  DEFAULT_MODEL,
  INTERACTIONS_URL,
  API_REVISION,
  OUTPUT_SCHEMA,
  minimalCourseInput,
  buildModerationInput,
  extractInteractionOutputText,
  safeProviderDiagnostic,
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

test('usa Gemini Interactions API com structured output e sem persistencia de interacao', async () => {
  let call = null;
  const provider = createGeminiCourseModerationProvider({
    apiKey: 'test-key',
    httpClient: {
      async post(url, payload, options) {
        call = { url, payload, options };
        return {
          status: 200,
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
  assert.strictEqual(call.payload.store, false);
  assert.strictEqual(call.payload.response_format.mime_type, 'application/json');
  assert.strictEqual(call.payload.response_format.schema.type, 'object');
  assert.strictEqual(call.options.headers['x-goog-api-key'], 'test-key');
  assert.strictEqual(result.decision, 'approved');
  assert.strictEqual(result.provider, 'google-gemini');
  assert.strictEqual(result.model, DEFAULT_MODEL);
});

test('envia revisao atual da Interactions API no header', async () => {
  let headers = null;
  const provider = createGeminiCourseModerationProvider({
    apiKey: 'test-key',
    httpClient: {
      async post(_url, _payload, options) {
        headers = options.headers;
        return {
          status: 200,
          data: {
            model: DEFAULT_MODEL,
            status: 'completed',
            output_text: JSON.stringify({
              decision: 'approved',
              riskLevel: 'low',
              confidence: 0.99,
              reasonCodes: [],
              summary: 'Sem sinal relevante.'
            })
          }
        };
      }
    }
  });

  await provider.moderateCourse({
    title: 'Curso de guarda',
    description: 'Descrição suficiente para o teste do header da API.'
  });

  assert.strictEqual(API_REVISION, '2026-05-20');
  assert.strictEqual(headers['Api-Revision'], API_REVISION);
});

test('schema evita keywords de string fora do subconjunto estruturado usado no MVP', () => {
  assert.strictEqual(OUTPUT_SCHEMA.properties.summary.maxLength, undefined);
  assert.strictEqual(OUTPUT_SCHEMA.properties.reasonCodes.items.maxLength, undefined);
  assert.strictEqual(OUTPUT_SCHEMA.properties.reasonCodes.maxItems, 12);
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

test('erro HTTP do Gemini vira diagnostico sanitizado sem expor chave', async () => {
  const provider = createGeminiCourseModerationProvider({
    apiKey: 'AIzaEXEMPLO_SUPER_SECRETO_123456789',
    httpClient: {
      async post() {
        const error = new Error('Request failed');
        error.code = 'ERR_BAD_REQUEST';
        error.response = {
          status: 400,
          data: {
            error: {
              code: 400,
              status: 'INVALID_ARGUMENT',
              message: 'Invalid schema; key=AIzaEXEMPLO_SUPER_SECRETO_123456789'
            }
          }
        };
        throw error;
      }
    }
  });

  await assert.rejects(
    async () => {
      try {
        await provider.moderateCourse({ title: 'Curso', description: 'Descrição suficiente para teste.' });
      } catch (error) {
        assert.strictEqual(error.code, 'GEMINI_HTTP_ERROR');
        assert.strictEqual(error.safeDiagnostic.httpStatus, 400);
        assert.strictEqual(error.safeDiagnostic.apiStatus, 'INVALID_ARGUMENT');
        assert.ok(!JSON.stringify(error.safeDiagnostic).includes('AIzaEXEMPLO_SUPER_SECRETO_123456789'));
        throw error;
      }
    },
    /falha na chamada ao provedor/
  );
});

test('sanitizador preserva somente metadados operacionais uteis', () => {
  const diagnostic = safeProviderDiagnostic({
    code: 'ECONNABORTED',
    message: 'timeout',
    response: {
      status: 503,
      data: {
        error: {
          code: 503,
          status: 'UNAVAILABLE',
          message: 'Service unavailable'
        }
      }
    }
  });

  assert.deepStrictEqual(diagnostic, {
    provider: 'google-gemini',
    httpStatus: 503,
    apiCode: 503,
    apiStatus: 'UNAVAILABLE',
    errorCode: 'ECONNABORTED',
    message: 'Service unavailable'
  });
});

test('resposta sem output falha fechado por excecao do adapter', async () => {
  const provider = createGeminiCourseModerationProvider({
    apiKey: 'test-key',
    httpClient: {
      async post() {
        return { status: 200, data: { status: 'completed', steps: [] } };
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
          status: 200,
          data: {
            status: 'completed',
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
