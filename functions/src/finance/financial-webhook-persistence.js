'use strict';

const {
  WEBHOOK_EVENT_STATUSES,
  FinancialWebhookDomainError,
  paymentWebhookEventDocumentId,
  sanitizeWebhookEventProjection,
  webhookEventIdentityMatches
} = require('./financial-webhook-domain');

class FinancialWebhookPersistenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialWebhookPersistenceError';
    this.code = code;
  }
}

function requireDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new FinancialWebhookPersistenceError(
      'INVALID_WEBHOOK_TIMESTAMP',
      `${field} inválido.`
    );
  }
  return date;
}

function eventIdentityFromStored(input = {}) {
  return {
    provider: input.provider,
    providerEventId: input.providerEventId,
    providerEventType: input.eventType,
    providerPaymentId: input.providerPaymentId,
    externalReference: input.externalReference,
    valueCents: input.valueCents
  };
}

function fullProjectionMatches(existing = {}, incoming = {}) {
  if (!webhookEventIdentityMatches(eventIdentityFromStored(existing), incoming)) {
    return false;
  }

  return Boolean(
    String(existing.providerEventCreatedAt || '') === String(incoming.providerEventCreatedAt || '') &&
    String(existing.providerPaymentStatus || '') === String(incoming.providerPaymentStatus || '') &&
    String(existing.providerCustomerId || '') === String(incoming.providerCustomerId || '') &&
    String(existing.billingType || '') === String(incoming.billingType || '') &&
    String(existing.processingAction || '') === String(incoming.processingAction || '') &&
    String(existing.processingReason || '') === String(incoming.processingReason || '')
  );
}

function initialStatusForProjection(projection = {}) {
  return projection.processingAction === 'ignore'
    ? 'ignored'
    : 'received';
}

function createInitialWebhookEventDocument({ projection, receivedAt }) {
  const status = initialStatusForProjection(projection);
  if (!WEBHOOK_EVENT_STATUSES.includes(status)) {
    throw new FinancialWebhookPersistenceError(
      'INVALID_WEBHOOK_EVENT_STATUS',
      'Status inicial do evento financeiro inválido.'
    );
  }

  return {
    provider: projection.provider,
    providerEventId: projection.providerEventId,
    providerPaymentId: projection.providerPaymentId,
    eventType: projection.providerEventType,
    status,
    orderId: null,
    transactionId: null,
    providerEventCreatedAt: projection.providerEventCreatedAt,
    providerPaymentStatus: projection.providerPaymentStatus,
    providerCustomerId: projection.providerCustomerId,
    externalReference: projection.externalReference,
    billingType: projection.billingType,
    valueCents: projection.valueCents,
    processingAction: projection.processingAction,
    processingReason: projection.processingReason,
    deliveryCount: 1,
    receivedAt,
    firstReceivedAt: receivedAt,
    lastReceivedAt: receivedAt,
    processedAt: status === 'ignored' ? receivedAt : null,
    errorCode: null
  };
}

function validateExistingWebhookEvent(input = {}) {
  const status = String(input.status || '').trim().toLowerCase();
  if (!WEBHOOK_EVENT_STATUSES.includes(status)) {
    throw new FinancialWebhookPersistenceError(
      'INVALID_WEBHOOK_EVENT_STATUS',
      'Evento financeiro persistido possui status inválido.'
    );
  }

  const deliveryCount = Number(input.deliveryCount);
  if (!Number.isSafeInteger(deliveryCount) || deliveryCount < 1) {
    throw new FinancialWebhookPersistenceError(
      'INVALID_WEBHOOK_DELIVERY_COUNT',
      'Evento financeiro persistido possui deliveryCount inválido.'
    );
  }

  if (!input.receivedAt || !input.firstReceivedAt || !input.lastReceivedAt) {
    throw new FinancialWebhookPersistenceError(
      'WEBHOOK_EVENT_TIMESTAMPS_REQUIRED',
      'Evento financeiro persistido exige timestamps de recebimento.'
    );
  }

  return {
    ...input,
    status,
    deliveryCount
  };
}

function createFinancialWebhookPersistence(dependencies = {}) {
  const {
    db,
    clock = () => new Date()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.runTransaction !== 'function'
  ) {
    throw new TypeError('Webhook persistence exige Firestore válido.');
  }

  async function registerWebhookEvent({ payload } = {}) {
    let projection;
    try {
      projection = sanitizeWebhookEventProjection(payload);
    } catch (error) {
      if (error instanceof FinancialWebhookDomainError) throw error;
      throw new FinancialWebhookPersistenceError(
        'INVALID_WEBHOOK_EVENT',
        'Não foi possível normalizar o evento financeiro.'
      );
    }

    const eventId = paymentWebhookEventDocumentId({
      provider: projection.provider,
      providerEventId: projection.providerEventId
    });
    const eventRef = db.doc(`payment_webhook_events/${eventId}`);
    const now = requireDate(clock(), 'clock');

    return db.runTransaction(async tx => {
      const snap = await tx.get(eventRef);

      if (!snap.exists) {
        const document = createInitialWebhookEventDocument({
          projection,
          receivedAt: now
        });
        tx.create(eventRef, document);
        return {
          eventId,
          created: true,
          duplicate: false,
          status: document.status,
          processingAction: document.processingAction,
          deliveryCount: 1
        };
      }

      const existing = validateExistingWebhookEvent(snap.data());
      if (!fullProjectionMatches(existing, projection)) {
        throw new FinancialWebhookPersistenceError(
          'WEBHOOK_EVENT_REDELIVERY_MISMATCH',
          'Reentrega do webhook diverge do evento financeiro já persistido.'
        );
      }

      const nextDeliveryCount = existing.deliveryCount + 1;
      tx.update(eventRef, {
        deliveryCount: nextDeliveryCount,
        lastReceivedAt: now
      });

      return {
        eventId,
        created: false,
        duplicate: true,
        status: existing.status,
        processingAction: existing.processingAction,
        deliveryCount: nextDeliveryCount
      };
    });
  }

  return {
    registerWebhookEvent
  };
}

module.exports = {
  FinancialWebhookPersistenceError,
  eventIdentityFromStored,
  fullProjectionMatches,
  initialStatusForProjection,
  createInitialWebhookEventDocument,
  validateExistingWebhookEvent,
  createFinancialWebhookPersistence
};
