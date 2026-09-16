'use strict';

const DEFAULT_MODEL = 'gpt-5.6-luna';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';

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

const OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    decision: {
      type: 'string',
      enum: DECISIONS
    },
    riskLevel: {
      type: 'string',
      enum: RISKS
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1
    },
    reasonCodes: {
      type: 'array',
      items: {
        type: 'string',
        maxLength: 80
      },
      maxItems: 12
    },
    summary: {
      type: 'string',
      maxLength: 1000
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

const SYSTEM_INSTRUCTIONS = 'Classifique conformidade de conteúdo para o BJJ Exams. Não avalie qualidade técnica do jiu-jitsu. Use apenas o JSON Schema solicitado. Em dúvida, contexto insuficiente ou baixa confiança, escolha manual_review.';

const POLICY_CONTEXT = `POLÍTICA DE TRIAGEM BJJ EXAMS
- Jiu-jitsu, grappling, competição, treino, defesa pessoal esportiva, quedas e finalizações legítimas não são violação por si só.
- Não julgue se a técnica é correta, eficiente, segura para certa graduação ou pedagogicamente adequada.
- Sinalize: conteúdo sexual/exploratório, ódio/discriminação, assédio grave, fraude/golpe, spam malicioso, incentivo claro a crime, violência fora de contexto esportivo legítimo, alegações médicas/terapêuticas enganosas, tentativa de burlar regras da plataforma e indícios textuais fortes de conteúdo pirateado ou sem autorização.
- needs_changes: problema objetivo e corrigível no texto.
- blocked: violação grave ou claramente incompatível com a plataforma.
- approved: conteúdo pode seguir sem revisão humana.
- manual_review: dúvida relevante, baixa confiança ou contexto insuficiente.`;

function text(value, max = 10000) {
  return String(value ?? '').trim().slice(0, max);
}

function minimalCourseInput(course = {}) {
  return {
    title: text(course.title, 160),
    description: text(course.description, 10000),
    ownerType: text(course.ownerType, 40),
    visibility: text(course.visibility, 40),
    isPaid: course.isPaid === true,
    priceCents: Number.isFinite(Number(course.priceCents))
      ? Math.max(0, Math.trunc(Number(course.priceCents)))
      : 0,
    currency: text(course.currency || 'BRL', 8)
  };
}

function extractOutputText(responseData = {}) {
  if (typeof responseData.output_text === 'string' && responseData.output_text.trim()) {
    return responseData.output_text.trim();
  }

  for (const item of Array.isArray(responseData.output) ? responseData.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        return content.text.trim();
      }
    }
  }

  return '';
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
    provider: 'openai',
    model
  };
}

function createOpenAICourseModerationProvider({
  httpClient,
  apiKey,
  model = DEFAULT_MODEL,
  timeoutMs = 15000
} = {}) {
  if (!httpClient || typeof httpClient.post !== 'function') {
    throw new Error('OpenAI moderation provider: httpClient.post obrigatório.');
  }

  const key = String(apiKey || '').trim();
  if (!key) {
    throw new Error('OpenAI moderation provider: API key ausente.');
  }

  async function moderateCourse(course = {}) {
    const payload = {
      model,
      store: false,
      reasoning: {
        effort: 'none'
      },
      instructions: SYSTEM_INSTRUCTIONS,
      input: `${POLICY_CONTEXT}\n\nCURSO PARA TRIAGEM\n${JSON.stringify(minimalCourseInput(course))}`,
      text: {
        format: {
          type: 'json_schema',
          name: 'bjj_exams_course_moderation',
          strict: true,
          schema: OUTPUT_SCHEMA
        }
      },
      max_output_tokens: 700
    };

    const response = await httpClient.post(
      RESPONSES_URL,
      payload,
      {
        timeout: Number(timeoutMs) || 15000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        }
      }
    );

    const outputText = extractOutputText(response?.data || {});
    if (!outputText) {
      throw new Error('OpenAI moderation provider: resposta sem output estruturado.');
    }

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch (_) {
      throw new Error('OpenAI moderation provider: JSON estruturado inválido.');
    }

    return normalizeResult(parsed, model);
  }

  return Object.freeze({
    provider: 'openai',
    model,
    moderateCourse
  });
}

module.exports = {
  DEFAULT_MODEL,
  RESPONSES_URL,
  OUTPUT_SCHEMA,
  SYSTEM_INSTRUCTIONS,
  POLICY_CONTEXT,
  minimalCourseInput,
  extractOutputText,
  normalizeResult,
  createOpenAICourseModerationProvider
};
