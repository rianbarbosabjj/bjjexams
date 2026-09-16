'use strict';

const DEFAULT_MODEL = 'omni-moderation-latest';
const MODERATIONS_URL = 'https://api.openai.com/v1/moderations';

const HIGH_RISK_CATEGORIES = new Set([
  'sexual/minors',
  'hate/threatening',
  'harassment/threatening',
  'self-harm/intent',
  'self-harm/instructions',
  'illicit/violent',
  'violence/graphic'
]);

function text(value, max = 10000) {
  return String(value ?? '').trim().slice(0, max);
}

function minimalCourseInput(course = {}) {
  return {
    title: text(course.title, 160),
    description: text(course.description, 10000)
  };
}

function buildModerationText(course = {}) {
  const input = minimalCourseInput(course);
  return [
    'Contexto: descrição de um curso esportivo de jiu-jitsu/grappling na plataforma BJJ Exams.',
    `Título: ${input.title}`,
    `Descrição: ${input.description}`
  ].join('\n');
}

function reasonCodeForCategory(category) {
  const normalized = String(category || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized ? `OPENAI_MODERATION_${normalized}` : null;
}

function maxCategoryScore(scores = {}) {
  return Object.values(scores || {})
    .map(Number)
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);
}

function normalizeModerationResult(responseData = {}, model = DEFAULT_MODEL) {
  const result = Array.isArray(responseData.results)
    ? responseData.results[0]
    : null;

  if (!result || typeof result.flagged !== 'boolean') {
    throw new Error('OpenAI moderation provider: resposta de moderação inválida.');
  }

  const categories = result.categories && typeof result.categories === 'object'
    ? result.categories
    : {};
  const categoryScores = result.category_scores && typeof result.category_scores === 'object'
    ? result.category_scores
    : {};
  const flaggedCategories = Object.entries(categories)
    .filter(([, flagged]) => flagged === true)
    .map(([category]) => category);
  const maxScore = maxCategoryScore(categoryScores);
  const confidence = result.flagged
    ? Math.max(0, Math.min(1, maxScore))
    : Math.max(0, Math.min(1, 1 - maxScore));
  const highRisk = flaggedCategories.some(category => HIGH_RISK_CATEGORIES.has(category));
  const reasonCodes = flaggedCategories
    .map(reasonCodeForCategory)
    .filter(Boolean);

  return {
    decision: result.flagged ? 'manual_review' : 'approved',
    riskLevel: result.flagged ? (highRisk ? 'high' : 'medium') : 'low',
    confidence,
    reasonCodes,
    summary: result.flagged
      ? 'A moderação automática sinalizou conteúdo que exige revisão humana antes da publicação.'
      : 'Nenhum sinal de segurança relevante foi detectado pela moderação automática.',
    provider: 'openai-moderation',
    model: String(responseData.model || model || DEFAULT_MODEL)
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
    const response = await httpClient.post(
      MODERATIONS_URL,
      {
        model,
        input: buildModerationText(course)
      },
      {
        timeout: Number(timeoutMs) || 15000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        }
      }
    );

    return normalizeModerationResult(response?.data || {}, model);
  }

  return Object.freeze({
    provider: 'openai-moderation',
    model,
    moderateCourse
  });
}

module.exports = {
  DEFAULT_MODEL,
  MODERATIONS_URL,
  HIGH_RISK_CATEGORIES,
  minimalCourseInput,
  buildModerationText,
  reasonCodeForCategory,
  maxCategoryScore,
  normalizeModerationResult,
  createOpenAICourseModerationProvider
};
