'use strict';

const assert = require('assert');
const policy = require('../functions/src/courses/course-moderation-policy');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('approved publica automaticamente somente com aceite de responsabilidade', () => {
  assert.deepStrictEqual(
    policy.resolveAutomationOutcome({
      responsibilityAccepted: true,
      providerDecision: 'approved',
      providerRiskLevel: 'low',
      providerConfidence: 0.98
    }),
    {
      decision: 'approved',
      targetStatus: 'published',
      requiresHumanReview: false,
      reasonCodes: []
    }
  );
});

test('sem aceite de responsabilidade nunca publica automaticamente', () => {
  const result = policy.resolveAutomationOutcome({
    responsibilityAccepted: false,
    providerDecision: 'approved',
    providerRiskLevel: 'low',
    providerConfidence: 0.99
  });
  assert.strictEqual(result.decision, 'manual_review');
  assert.strictEqual(result.targetStatus, 'review');
  assert.strictEqual(result.requiresHumanReview, true);
  assert.ok(result.reasonCodes.includes('RESPONSIBILITY_NOT_ACCEPTED'));
});

test('needs_changes devolve para rascunho', () => {
  const result = policy.resolveAutomationOutcome({
    responsibilityAccepted: true,
    providerDecision: 'needs_changes',
    providerRiskLevel: 'medium',
    providerConfidence: 0.92
  });
  assert.strictEqual(result.targetStatus, 'draft');
  assert.strictEqual(result.requiresHumanReview, false);
});

test('erro ou decisao desconhecida falha fechado para revisao humana', () => {
  for (const decision of [null, '', 'unknown', 'error']) {
    const result = policy.resolveAutomationOutcome({
      responsibilityAccepted: true,
      providerDecision: decision,
      providerRiskLevel: 'low',
      providerConfidence: 0.99
    });
    assert.strictEqual(result.decision, 'manual_review');
    assert.strictEqual(result.targetStatus, 'review');
    assert.strictEqual(result.requiresHumanReview, true);
  }
});

test('risco alto exige revisao humana mesmo se provedor sugerir approved', () => {
  const result = policy.resolveAutomationOutcome({
    responsibilityAccepted: true,
    providerDecision: 'approved',
    providerRiskLevel: 'high',
    providerConfidence: 0.99
  });
  assert.strictEqual(result.decision, 'manual_review');
  assert.strictEqual(result.targetStatus, 'review');
  assert.strictEqual(result.requiresHumanReview, true);
  assert.ok(result.reasonCodes.includes('HIGH_RISK_REQUIRES_HUMAN'));
});

test('baixa confianca exige revisao humana mesmo com approved', () => {
  const result = policy.resolveAutomationOutcome({
    responsibilityAccepted: true,
    providerDecision: 'approved',
    providerRiskLevel: 'low',
    providerConfidence: 0.62
  });
  assert.strictEqual(result.decision, 'manual_review');
  assert.strictEqual(result.targetStatus, 'review');
  assert.strictEqual(result.requiresHumanReview, true);
  assert.ok(result.reasonCodes.includes('LOW_AUTOMATION_CONFIDENCE'));
});

test('blocked permanece fora do catalogo e exige humano', () => {
  const result = policy.resolveAutomationOutcome({
    responsibilityAccepted: true,
    providerDecision: 'blocked',
    providerRiskLevel: 'high',
    providerConfidence: 0.97
  });
  assert.strictEqual(result.decision, 'blocked');
  assert.strictEqual(result.targetStatus, 'review');
  assert.strictEqual(result.requiresHumanReview, true);
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

console.log(`COURSE_MODERATION_POLICY_V1_2=${passed}/${cases.length}`);
