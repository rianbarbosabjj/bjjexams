"use strict";

const { FieldPath } = require("firebase-admin/firestore");
const {
  WEBHOOK_EVENT_STATUSES,
  AdminWebhookModelError,
  requiredWebhookIdentifier,
  webhookTimestampMillis,
  normalizeWebhookStatus,
  normalizeWebhookEventType,
  normalizeCanonicalWebhookEvent,
  buildOperationalWebhookView
} = require("./admin-webhook-models");

const WEBHOOK_EVENTS_COLLECTION = "payment_webhook_events";
const DEFAULT_WEBHOOKS_LIMIT = 20;
const MAX_WEBHOOKS_LIMIT = 25;
const WEBHOOK_CURSOR_VERSION = 1;
const WEBHOOK_SCAN_BATCH_SIZE = MAX_WEBHOOKS_LIMIT + 1;
const WEBHOOK_MAX_SCAN_DOCS = WEBHOOK_SCAN_BATCH_SIZE * 10;

class AdminWebhooksReadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AdminWebhooksReadError";
    this.code = code;
  }
}

function readWebhooksLimit(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_WEBHOOKS_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_WEBHOOKS_LIMIT) {
    throw new AdminWebhooksReadError(
      "ADMIN_WEBHOOKS_LIMIT_INVALID",
      `limit must be an integer between 1 and ${MAX_WEBHOOKS_LIMIT}.`
    );
  }
  return parsed;
}

function optionalWebhookStatusFilter(value) {
  if (value === undefined || value === null || value === "") return null;
  try {
    return normalizeWebhookStatus(value);
  } catch (error) {
    if (error instanceof AdminWebhookModelError) {
      throw new AdminWebhooksReadError(
        "ADMIN_WEBHOOKS_FILTER_INVALID",
        "status filter is invalid."
      );
    }
    throw error;
  }
}

function optionalWebhookEventTypeFilter(value) {
  if (value === undefined || value === null || value === "") return null;
  try {
    return normalizeWebhookEventType(value);
  } catch (error) {
    if (error instanceof AdminWebhookModelError) {
      throw new AdminWebhooksReadError(
        "ADMIN_WEBHOOKS_FILTER_INVALID",
        "eventType filter is invalid."
      );
    }
    throw error;
  }
}

function optionalWebhookOrderIdFilter(value) {
  if (value === undefined || value === null || value === "") return null;
  try {
    return requiredWebhookIdentifier(value, "orderId");
  } catch (error) {
    if (error instanceof AdminWebhookModelError) {
      throw new AdminWebhooksReadError(
        "ADMIN_WEBHOOKS_FILTER_INVALID",
        "orderId filter is invalid."
      );
    }
    throw error;
  }
}

function normalizeWebhookFilters(input = {}) {
  return Object.freeze({
    status: optionalWebhookStatusFilter(input.status),
    eventType: optionalWebhookEventTypeFilter(input.eventType),
    orderId: optionalWebhookOrderIdFilter(input.orderId)
  });
}

function matchesWebhookFilters(normalizedEvent, filters = {}) {
  if (filters.status && normalizedEvent.status !== filters.status) return false;
  if (filters.eventType && normalizedEvent.eventType !== filters.eventType) return false;
  if (filters.orderId && normalizedEvent.relatedOrderId !== filters.orderId) return false;
  return true;
}

function encodeWebhookCursor(input = {}) {
  let eventId;
  let receivedAtMillis;
  try {
    eventId = requiredWebhookIdentifier(input.eventId, "eventId");
    receivedAtMillis = webhookTimestampMillis(input.receivedAt, "receivedAt");
  } catch (_) {
    throw new AdminWebhooksReadError(
      "ADMIN_WEBHOOKS_CURSOR_INVALID",
      "cursor is invalid."
    );
  }

  return Buffer.from(
    JSON.stringify({
      v: WEBHOOK_CURSOR_VERSION,
      receivedAtMillis,
      eventId
    }),
    "utf8"
  ).toString("base64url");
}

function decodeWebhookCursor(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 768) {
    throw new AdminWebhooksReadError(
      "ADMIN_WEBHOOKS_CURSOR_INVALID",
      "cursor is invalid."
    );
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    );

    if (
      decoded?.v !== WEBHOOK_CURSOR_VERSION ||
      !Number.isSafeInteger(decoded.receivedAtMillis) ||
      decoded.receivedAtMillis < 0
    ) {
      throw new Error("cursor");
    }

    return Object.freeze({
      receivedAtMillis: decoded.receivedAtMillis,
      eventId: requiredWebhookIdentifier(decoded.eventId, "eventId")
    });
  } catch (_) {
    throw new AdminWebhooksReadError(
      "ADMIN_WEBHOOKS_CURSOR_INVALID",
      "cursor is invalid."
    );
  }
}

function canonicalWebhookStateError(eventId, detail) {
  return new AdminWebhooksReadError(
    "ADMIN_WEBHOOKS_CANONICAL_STATE_INVALID",
    `Webhook ${eventId} has inconsistent canonical state${detail ? `: ${detail}` : "."}`
  );
}

function normalizeWebhookDocument(document) {
  let eventId;
  try {
    eventId = requiredWebhookIdentifier(document?.id, "eventId");
  } catch (_) {
    throw new AdminWebhooksReadError(
      "ADMIN_WEBHOOKS_CANONICAL_STATE_INVALID",
      "Webhook document identifier is invalid."
    );
  }

  try {
    return normalizeCanonicalWebhookEvent({
      eventId,
      event: document?.data?.() || {}
    });
  } catch (error) {
    if (error instanceof AdminWebhookModelError) {
      throw canonicalWebhookStateError(eventId, error.code);
    }
    throw error;
  }
}

function buildWebhookView(normalized) {
  try {
    return buildOperationalWebhookView({
      eventId: normalized.eventId,
      event: {
        provider: normalized.provider,
        providerEventId: normalized.providerEventId,
        eventType: normalized.eventType,
        status: normalized.status,
        orderId: normalized.relatedOrderId,
        deliveryCount: normalized.deliveryCount,
        processingAction: normalized.processingAction,
        errorCode: normalized.errorCode,
        receivedAt: normalized.receivedAt,
        lastReceivedAt: normalized.lastReceivedAt,
        processedAt: normalized.processedAt
      }
    });
  } catch (error) {
    if (error instanceof AdminWebhookModelError) {
      throw canonicalWebhookStateError(normalized.eventId, error.code);
    }
    throw error;
  }
}

function createAdminWebhooksReadService(dependencies = {}) {
  const {
    db,
    documentIdField = FieldPath.documentId()
  } = dependencies;

  if (
    !db ||
    typeof db.collection !== "function" ||
    typeof db.doc !== "function"
  ) {
    throw new TypeError("Admin webhooks read service requires Firestore.");
  }

  async function listWebhooks(input = {}) {
    const limit = readWebhooksLimit(input.limit);
    const filters = normalizeWebhookFilters(input);
    const cursor = decodeWebhookCursor(input.cursor);
    const matched = [];

    let scanAfter = cursor;
    let resumeAfter = cursor;
    let scannedDocs = 0;
    let sourceExhausted = false;
    let hasMoreMatches = false;

    while (
      !sourceExhausted &&
      !hasMoreMatches &&
      scannedDocs < WEBHOOK_MAX_SCAN_DOCS
    ) {
      const remainingBudget = WEBHOOK_MAX_SCAN_DOCS - scannedDocs;
      const batchLimit = Math.min(WEBHOOK_SCAN_BATCH_SIZE, remainingBudget);

      let query = db
        .collection(WEBHOOK_EVENTS_COLLECTION)
        .orderBy("receivedAt", "desc")
        .orderBy(documentIdField, "desc");

      if (scanAfter) {
        query = query.startAfter(
          new Date(scanAfter.receivedAtMillis),
          scanAfter.eventId
        );
      }

      const snapshot = await query.limit(batchLimit).get();
      const documents = Array.isArray(snapshot?.docs) ? snapshot.docs : [];

      if (documents.length === 0) {
        sourceExhausted = true;
        break;
      }

      scannedDocs += documents.length;

      for (const document of documents) {
        const normalized = normalizeWebhookDocument(document);
        const matches = matchesWebhookFilters(normalized, filters);

        if (matches && matched.length >= limit) {
          hasMoreMatches = true;
          break;
        }

        if (matches) matched.push(normalized);

        resumeAfter = Object.freeze({
          receivedAtMillis: normalized.receivedAtMillis,
          eventId: normalized.eventId
        });
      }

      if (hasMoreMatches) break;

      if (documents.length < batchLimit) {
        sourceExhausted = true;
        break;
      }

      scanAfter = resumeAfter;
    }

    const scanLimitReached =
      !sourceExhausted &&
      !hasMoreMatches &&
      scannedDocs >= WEBHOOK_MAX_SCAN_DOCS;

    const shouldContinue = hasMoreMatches || scanLimitReached;
    const items = Object.freeze(matched.map(buildWebhookView));

    return Object.freeze({
      limit,
      items,
      nextCursor:
        shouldContinue && resumeAfter
          ? encodeWebhookCursor({
              eventId: resumeAfter.eventId,
              receivedAt: new Date(resumeAfter.receivedAtMillis)
            })
          : null
    });
  }

  async function getWebhook(input = {}) {
    let eventId;
    try {
      eventId = requiredWebhookIdentifier(input.eventId, "eventId");
    } catch (_) {
      throw new AdminWebhooksReadError(
        "ADMIN_WEBHOOKS_IDENTIFIER_INVALID",
        "eventId is invalid."
      );
    }

    const snapshot = await db
      .doc(`${WEBHOOK_EVENTS_COLLECTION}/${eventId}`)
      .get();

    if (!snapshot || snapshot.exists !== true) {
      throw new AdminWebhooksReadError(
        "ADMIN_WEBHOOK_NOT_FOUND",
        "Webhook event was not found."
      );
    }

    return buildWebhookView(normalizeWebhookDocument(snapshot));
  }

  return Object.freeze({
    listWebhooks,
    getWebhook
  });
}

module.exports = {
  WEBHOOK_EVENTS_COLLECTION,
  DEFAULT_WEBHOOKS_LIMIT,
  MAX_WEBHOOKS_LIMIT,
  WEBHOOK_CURSOR_VERSION,
  WEBHOOK_SCAN_BATCH_SIZE,
  WEBHOOK_MAX_SCAN_DOCS,
  WEBHOOK_EVENT_STATUSES,
  AdminWebhooksReadError,
  readWebhooksLimit,
  optionalWebhookStatusFilter,
  optionalWebhookEventTypeFilter,
  optionalWebhookOrderIdFilter,
  normalizeWebhookFilters,
  matchesWebhookFilters,
  encodeWebhookCursor,
  decodeWebhookCursor,
  canonicalWebhookStateError,
  normalizeWebhookDocument,
  buildWebhookView,
  createAdminWebhooksReadService
};
