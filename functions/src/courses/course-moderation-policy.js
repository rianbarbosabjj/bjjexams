'use strict';

const MODERATION_DECISIONS = Object.freeze([
  'approved',
  'needs_changes',
  'manual_review',
  'blocked'
]);

const MODERATION_RISK_LEVELS = Object.freeze([
  'low',
  'medium',
  'high'
]);

const POLICY_VERSION = 'course-content-v1';
const RESPONSIBILITY_TERMS_VERSION = 'course-content-responsibility-v1';

function normalizeDecision(value) {
  const decision = String(value || '').trim().toLowerCase();
  return MODERATION_DECISIONS.includes(decision) ? decision : null;
}

function normalizeRiskLevel(value) {
  const risk = String(value || '').trim().toLowerCase();
  return MODERATION_RISK_LEVELS.includes(risk) ? risk : 'high';
}

function resolveAutomationOutcome({
  responsibilityAccepted = false,
  providerDecision = null,
  providerRiskLevel = 'high',
  providerReasonCodes = []
} = {}) {
  const reasonCodes = Array.isArray(providerReasonCodes)
    ? [...new Set(providerReasonCodes.map(value => String(value || '').trim()).filter(Boolean))]
    : [];

  if (responsibilityAccepted !== true) {
    return {
      decision: 'manual_review',
      targetStatus: 'review',
      requiresHumanReview: true,
      reasonCodes: [...new Set(['RESPONSIBILITY_NOT_ACCEPTED', ...reasonCodes])]
    };
  }

  const decision = normalizeDecision(providerDecision);
  const riskLevel = normalizeRiskLevel(providerRiskLevel);

  if (!decision) {
    return {
      decision: 'manual_review',
      targetStatus: 'review',
      requiresHumanReview: true,
      reasonCodes: [...new Set(['AUTOMATION_RESULT_INVALID', ...reasonCodes])]
    };
  }

  if (decision === 'approved' && riskLevel === 'high') {
    return {
      decision: 'manual_review',
      targetStatus: 'review',
      requiresHumanReview: true,
      reasonCodes: [...new Set(['HIGH_RISK_REQUIRES_HUMAN', ...reasonCodes])]
    };
  }

  if (decision === 'approved') {
    return {
      decision: 'approved',
      targetStatus: 'published',
      requiresHumanReview: false,
      reasonCodes
    };
  }

  if (decision === 'needs_changes') {
    return {
      decision: 'needs_changes',
      targetStatus: 'draft',
      requiresHumanReview: false,
      reasonCodes
    };
  }

  if (decision === 'blocked') {
    return {
      decision: 'blocked',
      targetStatus: 'review',
      requiresHumanReview: true,
      reasonCodes
    };
  }

  return {
    decision: 'manual_review',
    targetStatus: 'review',
    requiresHumanReview: true,
    reasonCodes
  };
}

function canonicalModerationSnapshot({
  mode = 'ai',
  status = 'manual_review',
  riskLevel = 'high',
  requiresHumanReview = true,
  reasonCodes = [],
  summary = null,
  provider = null,
  model = null,
  checkedBy = 'system'
} = {}) {
  return {
    mode: String(mode || 'ai'),
    status: normalizeDecision(status) || 'manual_review',
    riskLevel: normalizeRiskLevel(riskLevel),
    requiresHumanReview: requiresHumanReview === true,
    reasonCodes: Array.isArray(reasonCodes)
      ? [...new Set(reasonCodes.map(value => String(value || '').trim()).filter(Boolean))]
      : [],
    summary: summary == null ? null : String(summary).trim().slice(0, 1200),
    policyVersion: POLICY_VERSION,
    provider: provider == null ? null : String(provider).trim(),
    model: model == null ? null : String(model).trim(),
    checkedBy: String(checkedBy || 'system')
  };
}

module.exports = {
  MODERATION_DECISIONS,
  MODERATION_RISK_LEVELS,
  POLICY_VERSION,
  RESPONSIBILITY_TERMS_VERSION,
  normalizeDecision,
  normalizeRiskLevel,
  resolveAutomationOutcome,
  canonicalModerationSnapshot
};
