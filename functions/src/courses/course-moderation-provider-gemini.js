'use strict';

const DEFAULT_MODEL = 'gemini-3.6-flash';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

const DECISIONS = Object.freeze([
  'approved',
  'needs_changes',
  'manual_review',
  'blocked'
]);

const RISKS = Object.freeze([
  'low',
  'medium',
  'high'
]);

// Mantem o schema estritamente no subconjunto documentado para Structured
// Outputs da Interactions API. Limites de tamanho continuam sendo impostos no
// nosso normalizador, sem depender do provedor aceitar keywords extras.
const OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    decision: {
      type: 'string',
      enum: DECISIONS,
      description: 'Decisão canônica da triagem.'
    },
    riskLevel: {
      type: 'string',
      enum: RISKS,
      description: 'Nível de risco de conformidade.'
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Confiança da classificação entre 0 e 1.'
    },
    reasonCodes: {
      type: 'array',
      items: {
        type: 'string'
      },
      maxItems: 12,
      description: 'Códigos curtos e estáveis que justificam a decisão.'
    },
    summary: {
      type: 'string',
      description: 'Resumo curto da decisão para auditoria e eventual revisão humana.'
    }
  },
  required: [
    'decision',
    'riskLevel',
    'confidence',
    'reasonCodes',
    'summary'
  ],
  additionalProperties: false
});

const POLICY_CONTEXT = `Você faz triagem de conformidade de cursos da plataforma BJJ Exams.
Analise somente segurança e conformidade de plataforma; não julgue qualidade técnica, eficiência, graduação ou mérito pedagógico do jiu-jitsu.
Jiu-jitsu, grappling, competição, treino, defesa pessoal esportiva, quedas, estrangulamentos esportivos e finalizações legítimas não são violação por si só.
Use approved quando não houver problema relevante.
Use needs_changes apenas para problema objetivo e corrigível no texto.
Use manual_review quando houver dúvida relevante, contexto insuficiente, possível fraude, spam, alegação médica/terapêutica problemática, possível violação de direitos, assédio, ódio, conteúdo sexual, incentivo a crime, violência fora de contexto esportivo legítimo ou outra questão que exija humano.
Use blocked somente para violação grave e inequívoca; ela continuará sujeita a tratamento humano pela plataforma.
Se a confiança for baixa, prefira manual_review.
Não invente fatos além do título e da descrição fornecidos.`;

function text(value, max = 10000) {
  return String(value ?? '').trim().slice(0, max);
}

function minimalCourseInput(course = {}) {
  return {
    title: text(course.title, 160),
    description: text(course.description, 10000)
  };
}

function buildModerationInput(course = {}) {
  return `${POLICY_CONTEXT}\n\nCURSO PARA TRIAGEM\n${JSON.stringify(minimalCourseInput(course))}`;
}

function extractInteractionOutputText(responseData = {}) {
  if (typeof responseData.output_text === 'string' && responseData.output_text.trim()) {
    return responseData.output_text.trim();
  }

  for (const step of Array.isArray(responseData.steps) ? responseData.steps : []) {
    if (step?.type !== 'model_output') continue;
    for (const content of Array.isArray(step.content) ? step.content : []) {
      if (content?.type === 'text' && typeof content.text === 'string' && content.text.trim()) {
        return content.text.trim();
      }
    }
  }

  return '';
}

function safeMessage(value) {
  return text(value, 300)
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]');
}

function safeProviderDiagnostic(error = {}) {
  const response = error?.response || {};
  const apiError = response?.data?.error || {};
  const httpStatusNumber = Number(response?.status);
  const apiCodeNumber = Number(apiError?.code);

  return {
    provider: 'google-gemini',
    httpStatus: Number.isFinite(httpStatusNumber) ? httpStatusNumber : null,
    apiCode: Number.isFinite(apiCodeNumber) ? apiCodeNumber : null,
    apiStatus: text(apiError?.status, 80) || null,
    errorCode: text(error?.code, 80) || null,
    message: safeMessage(apiError?.message || error?.message) || null
  };
}

function providerFailure(code, message, diagnostic = {}) {
  const error = new Error(message);
  error.code = code;
  error.safeDiagnostic = {
    provider: 'google-gemini',
    ...diagnostic,
    errorCode: code
  };
  return error;
}

function normalizeResult(parsed = {}, model = DEFAULT_MODEL) {
  const decision = DECISIONS.includes(String(parsed.decision || '').trim())
    ? String(parsed.decision).trim()
    : 'manual_review';
  const riskLevel = RISKS.includes(String(parsed.riskLevel || '').trim())
    ? String(parsed.riskLevel).trim()
    : 'high';
  const confidenceNumber = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceNumber)
    ? Math.max(0, Math.min(1, confidenceNumber))
    : 0;
  const reasonCodes = Array.isArray(parsed.reasonCodes)
    ? [...new Set(parsed.reasonCodes.map(value => text(value, 80)).filter(Boolean))].slice(0, 12)
    : [];

  return {
    decision,
    riskLevel,
    confidence,
    reasonCodes,
    summary: text(parsed.summary, 1000) || null,
    provider: 'google-gemini',
    model
  };
}

function createGeminiCourseModerationProvider({
  httpClient,
  apiKey,
  model = DEFAULT_MODEL,
  timeoutMs = 15000
} = {}) {
  if (!httpClient || typeof httpClient.post !== 'function') {
    throw new Error('Gemini moderation provider: httpClient.post obrigatório.');
  }

  const key = String(apiKey || '').trim();
  if (!key) {
    throw new Error('Gemini moderation provider: API key ausente.');
  }

  async function moderateCourse(course = {}) {
    const payload = {
      model,
      store: false,
      input: buildModerationInput(course),
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: OUTPUT_SCHEMA
      }
    };

    let response;
    try {
      response = await httpClient.post(
        INTERACTIONS_URL,
        payload,
        {
          timeout: Number(timeoutMs) || 15000,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key
          }
        }
      );
    } catch (error) {
      throw providerFailure(
        'GEMINI_HTTP_ERROR',
        'Gemini moderation provider: falha na chamada ao provedor.',
        safeProviderDiagnostic(error)
      );
    }

    const responseData = response?.data || {};
    if (responseData.status && responseData.status !== 'completed') {
      throw providerFailure(
        'GEMINI_INTERACTION_NOT_COMPLETED',
        'Gemini moderation provider: interação não concluída.',
        {
          httpStatus: Number(response?.status) || null,
          interactionStatus: text(responseData.status, 80) || null,
          model: text(responseData.model || model, 120) || null
        }
      );
    }

    const outputText = extractInteractionOutputText(responseData);
    if (!outputText) {
      throw providerFailure(
        'GEMINI_EMPTY_OUTPUT',
        'Gemini moderation provider: resposta sem output estruturado.',
        {
          httpStatus: Number(response?.status) || null,
          interactionStatus: text(responseData.status, 80) || null,
          model: text(responseData.model || model, 120) || null
        }
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch (_) {
      throw providerFailure(
        'GEMINI_INVALID_JSON',
        'Gemini moderation provider: JSON estruturado inválido.',
        {
          httpStatus: Number(response?.status) || null,
          interactionStatus: text(responseData.status, 80) || null,
          model: text(responseData.model || model, 120) || null
        }
      );
    }

    return normalizeResult(parsed, String(responseData.model || model));
  }

  return Object.freeze({
    provider: 'google-gemini',
    model,
    moderateCourse
  });
}

module.exports = {
  DEFAULT_MODEL,
  INTERACTIONS_URL,
  OUTPUT_SCHEMA,
  POLICY_CONTEXT,
  minimalCourseInput,
  buildModerationInput,
  extractInteractionOutputText,
  safeProviderDiagnostic,
  normalizeResult,
  createGeminiCourseModerationProvider
};
