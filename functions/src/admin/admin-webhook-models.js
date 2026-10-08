"use strict";

const crypto = require("node:crypto");
const {
  WEBHOOK_PROVIDER,
  WEBHOOK_EVENT_STATUSES
} = require("../finance/financial-webhook-domain");

const OPERATIONAL_WEBHOOK_VIEW_FIELDS = Object.freeze([
  "eventId",
  "provider",
  "providerEventRef",
  "eventType",
  "status",
  "relatedOrderId",
  "deliveryCount",
  "processing",
  "timestamps"
]);

const OPERATIONAL_WEBHOOK_PROCESSING_FIELDS = Object.freeze([
  "action",
  "result",
  "errorCode"
]);

const OPERATIONAL_WEBHOOK_TIMESTAMP_FIELDS = Object.freeze([
  "receivedAt",
  "lastReceivedAt",
  "processedAt"
]);

const WEBHOOK_PROCESSING_ACTIONS = Object.freeze([
  "confirm_payment",
  "reconcile_reversal",
  "ignore"
]);

const WEBHOOK_PROCESSING_RESULTS = Object.freeze({
  received: "pending",
  processing: "processing",
  processed: "processed",
  ignored: "ignored",
  error: "error"
});

class AdminWebhookModelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AdminWebhookModelError";
    this.code = code;
  }
}

function cleanWebhookText(value, maxLength = 255) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new AdminWebhookModelError(
      "ADMIN_WEBHOOK_TEXT_INVALID",
      "Webhook text exceeds the allowed size."
    );
  }
  return normalized;
}

function requiredWebhookText(value, field, maxLength = 255) {
  const normalized = cleanWebhookText(value, maxLength);
  if (!normalized) {
    throw new AdminWebhookModelError(
      "ADMIN_WEBHOOK_FIELD_REQUIRED",
      `${field} is required.`
    );
  }
  return normalized;
}

function requiredWebhookIdentifier(value, field) {
  const normalized = requiredWebhookText(value, field, 255);
  if (normalized.includes("/")) {
    throw new AdminWebhookModelError(
      "ADMIN_WEBHOOK_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }
  return normalized;
}

function optionalWebhookIdentifier(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return requiredWebhookIdentifier(value, field);
}

function webhookTimestampMillis(value, field, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw new AdminWebhookModelError(
      "ADMIN_WEBHOOK_TIMESTAMP_INVALID",
      `${field} is required.`
    );
  }

  if (typeof value.toMillis === "function") {
    const millis = value.toMillis();
    if (Number.isFinite(millis)) return millis;
  }

  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  if (!Number.isFinite(millis)) {
    throw new AdminWebhookModelError(
      "ADMIN_WEBHOOK_TIMESTAMP_INVALID",
      `${field} is invalid.`
    );
  }
  return millis;
}

function normalizeWebhookStatus(value) {
  const status = requiredWebhookText(value, "status", 40).toLowerCase();
  if (!WEBHOOK_EVENT_STATUSES.includes(status)) {
    throw new AdminWebhookModelError(
      "ADMIN_WEBHOOK_STATUS_INVALID",
      "Webhook status is invalid."
    );
  }
  return status;
}

function normalizeWebhookEventType(value) {
  return requiredWebhookText(value, "eventType", 80).toUpperCase();
}

function normalizeWebhookProcessingAction(value) {
  const action = requiredWebhookText(
    value,
    "processingAction",
    80
  ).toLowerCase();

  if (!WEBHOOK_PROCESSING_ACTIONS.includes(action)) {
    throw new AdminWebhookModelError(
      "ADMIN_WEBHOOK_PROCESSING_ACTION_INVALID",
      "Webhook processing action is invalid."
    );
  }
  return action;
}

function maskedProviderEventReference(providerEventId) {
  const canonicalId = requiredWebhookText(
    providerEventId,
    "providerEventId",
    255
  );

  const digest = crypto
    .createHash("sha256")
    .update(`admin-webhook-ref-v1:${canonicalId}`, "utf8")
    .digest("hex");

  return `***${digest.slice(0, 12)}`;
}

function normalizeCanonicalWebhookEvent(input = {}) {
  const safe = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};

  const eventId = requiredWebhookIdentifier(safe.eventId, "eventId");
  const event = safe.event && typeof safe.event === "object" && !Array.isArray(safe.event)
    ? safe.event
    : {};

  const provider = requiredWebhookText(event.provider, "provider", 40).toLowerCase();
  if (provider !== WEBHOOK_PROVIDER) {
    throw new AdminWebhookModelError(
      "ADMIN_WEBHOOK_PROVIDER_INVALID",
      "Webhook provider is invalid."
    );
  }

  const providerEventId = requiredWebhookText(
    event.providerEventId,
    "providerEventId",
    255
  );
  const eventType = normalizeWebhookEventType(event.eventType);
  const status = normalizeWebhookStatus(event.status);
  const relatedOrderId = optionalWebhookIdentifier(event.orderId, "orderId");
  const deliveryCount = Number(event.deliveryCount);

  if (!Number.isSafeInteger(deliveryCount) || deliveryCount < 1) {
    throw new AdminWebhookModelError(
      "ADMIN_WEBHOOK_DELIVERY_COUNT_INVALID",
      "Webhook deliveryCount is invalid."
    );
  }

  const processingAction = normalizeWebhookProcessingAction(
    event.processingAction
  );
  const errorCode = cleanWebhookText(event.errorCode, 120);

  const receivedAtMillis = webhookTimestampMillis(event.receivedAt, "receivedAt");
  const lastReceivedAtMillis = webhookTimestampMillis(
    event.lastReceivedAt,
    "lastReceivedAt"
  );

  if (lastReceivedAtMillis < receivedAtMillis) {
    throw new AdminWebhookModelError(
      "ADMIN_WEBHOOK_TIMESTAMP_INVALID",
      "lastReceivedAt precedes receivedAt."
    );
  }

  const processedAtMillis = webhookTimestampMillis(
    event.processedAt,
    "processedAt",
    { required: false }
  );

  if (processedAtMillis !== null && processedAtMillis < receivedAtMillis) {
    throw new AdminWebhookModelError(
      "ADMIN_WEBHOOK_TIMESTAMP_INVALID",
      "processedAt precedes receivedAt."
    );
  }

  return Object.freeze({
    eventId,
    provider,
    providerEventId,
    eventType,
    status,
    relatedOrderId,
    deliveryCount,
    processingAction,
    errorCode,
    receivedAt: event.receivedAt,
    lastReceivedAt: event.lastReceivedAt,
    processedAt: event.processedAt ?? null,
    receivedAtMillis,
    lastReceivedAtMillis,
    processedAtMillis
  });
}

function buildOperationalWebhookView(input = {}) {
  const normalized = normalizeCanonicalWebhookEvent(input);

  return Object.freeze({
    eventId: normalized.eventId,
    provider: normalized.provider,
    providerEventRef: maskedProviderEventReference(normalized.providerEventId),
    eventType: normalized.eventType,
    status: normalized.status,
    relatedOrderId: normalized.relatedOrderId,
    deliveryCount: normalized.deliveryCount,
    processing: Object.freeze({
      action: normalized.processingAction,
      result: WEBHOOK_PROCESSING_RESULTS[normalized.status],
      errorCode: normalized.errorCode
    }),
    timestamps: Object.freeze({
      receivedAt: normalized.receivedAt,
      lastReceivedAt: normalized.lastReceivedAt,
      processedAt: normalized.processedAt
    })
  });
}

module.exports = {
  OPERATIONAL_WEBHOOK_VIEW_FIELDS,
  OPERATIONAL_WEBHOOK_PROCESSING_FIELDS,
  OPERATIONAL_WEBHOOK_TIMESTAMP_FIELDS,
  WEBHOOK_PROCESSING_ACTIONS,
  WEBHOOK_PROCESSING_RESULTS,
  WEBHOOK_PROVIDER,
  WEBHOOK_EVENT_STATUSES,
  AdminWebhookModelError,
  cleanWebhookText,
  requiredWebhookText,
  requiredWebhookIdentifier,
  optionalWebhookIdentifier,
  webhookTimestampMillis,
  normalizeWebhookStatus,
  normalizeWebhookEventType,
  normalizeWebhookProcessingAction,
  maskedProviderEventReference,
  normalizeCanonicalWebhookEvent,
  buildOperationalWebhookView
};
