'use strict';

const crypto = require('crypto');

const WEBHOOK_PROVIDER = 'asaas';
const WEBHOOK_AUTH_HEADER = 'asaas-access-token';
const PAYMENT_CONFIRMATION_EVENTS = Object.freeze([
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED'
]);
const PAYMENT_REVERSAL_EVENTS = Object.freeze([
  'PAYMENT_DELETED',
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_REFUND_DENIED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL'
]);
// Alias mantido por compatibilidade com consumidores do contrato 5.4.
// No Marco 5.5 esses eventos deixam de ser deferidos e passam ao worker de reversoes.
const PAYMENT_REVERSAL_EVENTS_DEFERRED = PAYMENT_REVERSAL_EVENTS;
const WEBHOOK_EVENT_STATUSES = Object.freeze([
  'received',
  'processing',
  'processed',
  'ignored',
  'error'
]);

class FinancialWebhookDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialWebhookDomainError';
    this.code = code;
  }
}

function requiredText(value, field, max = 255) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > max) {
    throw new FinancialWebhookDomainError(
      'INVALID_WEBHOOK_TEXT',
      `${field} inválido.`
    );
  }
  return normalized;
}

function optionalText(value, max = 255) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) {
    throw new FinancialWebhookDomainError(
      'INVALID_WEBHOOK_TEXT',
      'Campo textual do webhook excede o limite permitido.'
    );
  }
  return normalized;
}

function normalizeUpper(value, max = 80) {
  const normalized = optionalText(value, max);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeProvider(value = WEBHOOK_PROVIDER) {
  const provider = requiredText(value, 'provider', 40).toLowerCase();
  if (provider !== WEBHOOK_PROVIDER) {
    throw new FinancialWebhookDomainError(
      'UNSUPPORTED_WEBHOOK_PROVIDER',
      'Webhook financeiro v1.2 aceita somente provider asaas.'
    );
  }
  return provider;
}

function paymentWebhookEventDocumentId({
  provider = WEBHOOK_PROVIDER,
  providerEventId
} = {}) {
  const canonicalProvider = normalizeProvider(provider);
  const eventId = requiredText(providerEventId, 'providerEventId', 255);
  return crypto
    .createHash('sha256')
    .update(`payment-webhook-event-v1:${canonicalProvider}:${eventId}`)
    .digest('hex');
}

function providerMoneyToCents(value, field = 'payment.value') {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'string') {
    const raw = value.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
      throw new FinancialWebhookDomainError(
        'INVALID_PROVIDER_MONEY',
        `${field} precisa possuir no máximo duas casas decimais.`
      );
    }
    const [whole, fraction = ''] = raw.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(cents) || cents < 0) {
      throw new FinancialWebhookDomainError(
        'INVALID_PROVIDER_MONEY',
        `${field} está fora da faixa monetária segura.`
      );
    }
    return cents;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new FinancialWebhookDomainError(
      'INVALID_PROVIDER_MONEY',
      `${field} inválido.`
    );
  }

  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (
    !Number.isSafeInteger(cents) ||
    Math.abs(scaled - cents) > 1e-7
  ) {
    throw new FinancialWebhookDomainError(
      'INVALID_PROVIDER_MONEY',
      `${field} precisa possuir no máximo duas casas decimais.`
    );
  }
  return cents;
}

function isEligiblePaymentConfirmationEvent(eventType) {
  const canonical = normalizeUpper(eventType, 80);
  return PAYMENT_CONFIRMATION_EVENTS.includes(canonical);
}

function isFinancialReversalEvent(eventType) {
  const canonical = normalizeUpper(eventType, 80);
  return PAYMENT_REVERSAL_EVENTS.includes(canonical);
}

function classifyWebhookEvent(eventType) {
  const canonical = requiredText(eventType, 'event', 80).toUpperCase();

  if (PAYMENT_CONFIRMATION_EVENTS.includes(canonical)) {
    return {
      action: 'confirm_payment',
      reason: 'PAYMENT_CONFIRMATION_EVENT'
    };
  }

  if (PAYMENT_REVERSAL_EVENTS.includes(canonical)) {
    return {
      action: 'reconcile_reversal',
      reason: 'PAYMENT_REVERSAL_EVENT'
    };
  }

  return {
    action: 'ignore',
    reason: canonical.startsWith('PAYMENT_')
      ? 'PAYMENT_EVENT_OUT_OF_SCOPE'
      : 'NON_PAYMENT_EVENT_OUT_OF_SCOPE'
  };
}

function normalizeAsaasWebhookEvent(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new FinancialWebhookDomainError(
      'INVALID_WEBHOOK_ENVELOPE',
      'Envelope do webhook precisa ser um objeto JSON.'
    );
  }

  const providerEventId = requiredText(payload.id, 'id', 255);
  const providerEventType = requiredText(payload.event, 'event', 80).toUpperCase();
  const classification = classifyWebhookEvent(providerEventType);
  const payment = payload.payment && typeof payload.payment === 'object' && !Array.isArray(payload.payment)
    ? payload.payment
    : null;

  if (providerEventType.startsWith('PAYMENT_') && !payment) {
    throw new FinancialWebhookDomainError(
      'PAYMENT_WEBHOOK_OBJECT_REQUIRED',
      'Evento de pagamento exige objeto payment.'
    );
  }

  const providerPaymentId = payment
    ? requiredText(payment.id, 'payment.id', 255)
    : null;

  return {
    provider: WEBHOOK_PROVIDER,
    providerEventId,
    providerEventType,
    providerEventCreatedAt: optionalText(payload.dateCreated, 80),
    providerPaymentId,
    providerPaymentStatus: payment ? normalizeUpper(payment.status, 80) : null,
    providerCustomerId: payment ? optionalText(payment.customer, 255) : null,
    externalReference: payment ? optionalText(payment.externalReference, 255) : null,
    billingType: payment ? normalizeUpper(payment.billingType, 40) : null,
    valueCents: payment ? providerMoneyToCents(payment.value) : null,
    processingAction: classification.action,
    processingReason: classification.reason
  };
}

function sanitizeWebhookEventProjection(payload = {}) {
  return normalizeAsaasWebhookEvent(payload);
}

function webhookEventIdentityMatches(existing = {}, incoming = {}) {
  return Boolean(
    existing && incoming &&
    String(existing.provider || '') === String(incoming.provider || '') &&
    String(existing.providerEventId || '') === String(incoming.providerEventId || '') &&
    String(existing.providerEventType || '') === String(incoming.providerEventType || '') &&
    String(existing.providerPaymentId || '') === String(incoming.providerPaymentId || '') &&
    String(existing.externalReference || '') === String(incoming.externalReference || '') &&
    Number(existing.valueCents ?? -1) === Number(incoming.valueCents ?? -1)
  );
}

function verifyWebhookAuthToken(receivedToken, expectedToken) {
  const received = String(receivedToken ?? '');
  const expected = String(expectedToken ?? '');

  if (!received || !expected || received.length !== expected.length) {
    return false;
  }

  const left = Buffer.from(received, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  WEBHOOK_PROVIDER,
  WEBHOOK_AUTH_HEADER,
  PAYMENT_CONFIRMATION_EVENTS,
  PAYMENT_REVERSAL_EVENTS,
  PAYMENT_REVERSAL_EVENTS_DEFERRED,
  WEBHOOK_EVENT_STATUSES,
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
};
