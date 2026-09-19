'use strict';

const assert = require('node:assert/strict');

const {
  FinancialWebhookDomainError,
  paymentWebhookEventDocumentId,
  providerMoneyToCents,
  isEligiblePaymentConfirmationEvent,
  isFinancialReversalEvent,
  classifyWebhookEvent,
  normalizeAsaasWebhookEvent,
  sanitizeWebhookEventProjection,
  webhookEventIdentityMatches,
  verifyWebhookAuthToken
} = require('../src/finance/financial-webhook-domain');

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function confirmedPayload(overrides = {}) {
  return {
    id: 'evt_confirm_001',
    event: 'PAYMENT_CONFIRMED',
    dateCreated: '2026-09-18 17:30:00',
    payment: {
      id: 'pay_001',
      customer: 'cus_001',
      value: 10,
      billingType: 'PIX',
      status: 'CONFIRMED',
      externalReference: 'BJJEX-V12-ORDER-order_001',
      email: 'nao-persistir@example.test',
      ...overrides.payment
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'payment')
    )
  };
}

(() => {
  test('event document id e deterministico e hexadecimal', () => {
    const first = paymentWebhookEventDocumentId({
      providerEventId: 'evt_abc&123'
    });
    const second = paymentWebhookEventDocumentId({
      providerEventId: 'evt_abc&123'
    });
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
  });

  test('event document id muda quando event id muda', () => {
    const a = paymentWebhookEventDocumentId({ providerEventId: 'evt_a' });
    const b = paymentWebhookEventDocumentId({ providerEventId: 'evt_b' });
    assert.notEqual(a, b);
  });

  test('provider diferente de asaas falha fechado', () => {
    assert.throws(
      () => paymentWebhookEventDocumentId({
        provider: 'outro',
        providerEventId: 'evt_a'
      }),
      error => error instanceof FinancialWebhookDomainError &&
        error.code === 'UNSUPPORTED_WEBHOOK_PROVIDER'
    );
  });

  test('normaliza PAYMENT_CONFIRMED para confirm_payment', () => {
    const event = normalizeAsaasWebhookEvent(confirmedPayload());
    assert.equal(event.provider, 'asaas');
    assert.equal(event.providerEventType, 'PAYMENT_CONFIRMED');
    assert.equal(event.providerPaymentId, 'pay_001');
    assert.equal(event.providerPaymentStatus, 'CONFIRMED');
    assert.equal(event.externalReference, 'BJJEX-V12-ORDER-order_001');
    assert.equal(event.billingType, 'PIX');
    assert.equal(event.valueCents, 1000);
    assert.equal(event.processingAction, 'confirm_payment');
  });

  test('normaliza PAYMENT_RECEIVED para confirm_payment', () => {
    const event = normalizeAsaasWebhookEvent(confirmedPayload({
      id: 'evt_received_001',
      event: 'payment_received',
      payment: { status: 'received' }
    }));
    assert.equal(event.providerEventType, 'PAYMENT_RECEIVED');
    assert.equal(event.providerPaymentStatus, 'RECEIVED');
    assert.equal(event.processingAction, 'confirm_payment');
  });

  test('PAYMENT_CREATED fica fora do fulfillment v1.2', () => {
    const classification = classifyWebhookEvent('PAYMENT_CREATED');
    assert.deepEqual(classification, {
      action: 'ignore',
      reason: 'PAYMENT_EVENT_OUT_OF_SCOPE'
    });
  });

  test('refund entra no worker de reversoes do Marco 5.5', () => {
    const classification = classifyWebhookEvent('PAYMENT_REFUNDED');
    assert.deepEqual(classification, {
      action: 'reconcile_reversal',
      reason: 'PAYMENT_REVERSAL_EVENT'
    });
    assert.equal(isFinancialReversalEvent('payment_refunded'), true);
    assert.equal(isFinancialReversalEvent('PAYMENT_CHARGEBACK_REQUESTED'), true);
  });

  test('evento nao financeiro pode ser projetado sem payment', () => {
    const event = normalizeAsaasWebhookEvent({
      id: 'evt_other_1',
      event: 'ACCOUNT_STATUS_CHANGED'
    });
    assert.equal(event.providerPaymentId, null);
    assert.equal(event.processingAction, 'ignore');
    assert.equal(event.processingReason, 'NON_PAYMENT_EVENT_OUT_OF_SCOPE');
  });

  test('evento PAYMENT sem objeto payment e rejeitado', () => {
    assert.throws(
      () => normalizeAsaasWebhookEvent({
        id: 'evt_bad',
        event: 'PAYMENT_RECEIVED'
      }),
      error => error instanceof FinancialWebhookDomainError &&
        error.code === 'PAYMENT_WEBHOOK_OBJECT_REQUIRED'
    );
  });

  test('evento PAYMENT exige payment.id', () => {
    assert.throws(
      () => normalizeAsaasWebhookEvent({
        id: 'evt_bad_2',
        event: 'PAYMENT_CREATED',
        payment: { value: 1 }
      }),
      error => error instanceof FinancialWebhookDomainError &&
        error.code === 'INVALID_WEBHOOK_TEXT'
    );
  });

  test('money number vira centavos inteiros', () => {
    assert.equal(providerMoneyToCents(10.25), 1025);
  });

  test('money string vira centavos inteiros', () => {
    assert.equal(providerMoneyToCents('10.20'), 1020);
    assert.equal(providerMoneyToCents('10.2'), 1020);
  });

  test('money com mais de duas casas e rejeitado', () => {
    assert.throws(
      () => providerMoneyToCents('10.205'),
      error => error instanceof FinancialWebhookDomainError &&
        error.code === 'INVALID_PROVIDER_MONEY'
    );
  });

  test('money negativo e rejeitado', () => {
    assert.throws(
      () => providerMoneyToCents(-1),
      error => error instanceof FinancialWebhookDomainError &&
        error.code === 'INVALID_PROVIDER_MONEY'
    );
  });

  test('projection sanitizada nao carrega campos pessoais extras', () => {
    const projection = sanitizeWebhookEventProjection(confirmedPayload());
    assert.equal('email' in projection, false);
    assert.equal('cpfCnpj' in projection, false);
    assert.equal('payload' in projection, false);
    assert.deepEqual(Object.keys(projection).sort(), [
      'billingType',
      'externalReference',
      'processingAction',
      'processingReason',
      'provider',
      'providerCustomerId',
      'providerEventCreatedAt',
      'providerEventId',
      'providerEventType',
      'providerPaymentId',
      'providerPaymentStatus',
      'valueCents'
    ].sort());
  });

  test('identity match aceita a mesma entrega normalizada', () => {
    const event = normalizeAsaasWebhookEvent(confirmedPayload());
    assert.equal(webhookEventIdentityMatches(event, { ...event }), true);
  });

  test('identity match detecta providerPaymentId divergente', () => {
    const event = normalizeAsaasWebhookEvent(confirmedPayload());
    assert.equal(webhookEventIdentityMatches(event, {
      ...event,
      providerPaymentId: 'pay_other'
    }), false);
  });

  test('identity match detecta valor divergente', () => {
    const event = normalizeAsaasWebhookEvent(confirmedPayload());
    assert.equal(webhookEventIdentityMatches(event, {
      ...event,
      valueCents: 999
    }), false);
  });

  test('eventos CONFIRMED e RECEIVED sao elegiveis', () => {
    assert.equal(isEligiblePaymentConfirmationEvent('PAYMENT_CONFIRMED'), true);
    assert.equal(isEligiblePaymentConfirmationEvent('payment_received'), true);
    assert.equal(isEligiblePaymentConfirmationEvent('PAYMENT_CREATED'), false);
  });

  test('auth token usa igualdade exata e nao aceita mismatch', () => {
    const expected = 'a'.repeat(40);
    assert.equal(verifyWebhookAuthToken(expected, expected), true);
    assert.equal(verifyWebhookAuthToken('b'.repeat(40), expected), false);
    assert.equal(verifyWebhookAuthToken('short', expected), false);
    assert.equal(verifyWebhookAuthToken('', expected), false);
  });

  console.log(`FINANCIAL_WEBHOOK_DOMAIN_V1_2=${passed}/20`);
  if (passed !== 20) process.exitCode = 1;
})();
