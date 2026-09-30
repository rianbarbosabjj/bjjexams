"use strict";

const assert =
  require("assert");

const {
  ADMIN_WEBHOOK_REPROCESS_SCHEMA_VERSION,
  ADMIN_WEBHOOK_REPROCESS_ACTION,
  ADMIN_WEBHOOK_REPROCESS_TARGET_TYPE,
  WEBHOOK_REPROCESS_IN_FLIGHT_STATUSES,
  WEBHOOK_REPROCESS_TERMINAL_STATUSES,
  AdminWebhookReprocessDomainError,
  normalizeReprocessMetadata,
  normalizeReprocessableWebhookEvent,
  buildWebhookReprocessAuditEvent
} = require(
  "../functions/src/admin/admin-webhooks-reprocess-domain"
);

function event(
  overrides = {}
) {
  return {
    provider:
      "asaas",

    providerEventId:
      "provider-event-secret",

    eventType:
      "PAYMENT_RECEIVED",

    status:
      "error",

    orderId:
      "order-1",

    processingAction:
      "confirm_payment",

    deliveryCount:
      1,

    receivedAt:
      "2026-09-30T10:00:00.000Z",

    firstReceivedAt:
      "2026-09-30T10:00:00.000Z",

    lastReceivedAt:
      "2026-09-30T10:01:00.000Z",

    processedAt:
      "2026-09-30T10:02:00.000Z",

    errorCode:
      "PROVIDER_PAYMENT_VALUE_MISMATCH",

    ...overrides
  };
}

function main() {
  assert.strictEqual(
    ADMIN_WEBHOOK_REPROCESS_SCHEMA_VERSION,
    1
  );

  assert.strictEqual(
    ADMIN_WEBHOOK_REPROCESS_ACTION,
    "admin.webhook.reprocess.requested"
  );

  assert.strictEqual(
    ADMIN_WEBHOOK_REPROCESS_TARGET_TYPE,
    "webhook_event"
  );

  assert.deepStrictEqual(
    WEBHOOK_REPROCESS_IN_FLIGHT_STATUSES,
    [
      "received",
      "processing"
    ]
  );

  assert.deepStrictEqual(
    WEBHOOK_REPROCESS_TERMINAL_STATUSES,
    [
      "processed",
      "ignored"
    ]
  );

  assert.deepStrictEqual(
    normalizeReprocessMetadata(
      event()
    ),
    {
      reprocessCount:
        0,

      lastReprocessRequestId:
        null,

      lastReprocessRequestedBy:
        null,

      lastReprocessRequestedAt:
        null
    }
  );

  const normalized =
    normalizeReprocessableWebhookEvent({
      eventId:
        "event-1",

      event:
        event({
          reprocessCount:
            2,

          lastReprocessRequestId:
            "request-previous",

          lastReprocessRequestedBy:
            "admin-previous",

          lastReprocessRequestedAt:
            "2026-09-30T09:00:00.000Z"
        })
    });

  assert.strictEqual(
    normalized.canonical.status,
    "error"
  );

  assert.strictEqual(
    normalized.metadata.reprocessCount,
    2
  );

  assert.strictEqual(
    normalized.metadata.lastReprocessRequestId,
    "request-previous"
  );

  const createdAt =
    new Date(
      "2026-09-30T12:00:00.000Z"
    );

  const audit =
    buildWebhookReprocessAuditEvent({
      actorUid:
        "admin-1",

      actorRole:
        "finance_admin",

      eventId:
        "event-1",

      requestId:
        "request-1",

      previousStatus:
        "error",

      previousErrorCode:
        "PROVIDER_PAYMENT_VALUE_MISMATCH",

      reprocessCount:
        3,

      createdAt
    });

  assert.deepStrictEqual(
    audit,
    {
      eventType:
        "admin.webhook.reprocess.requested",

      actorUid:
        "admin-1",

      actorRole:
        "finance_admin",

      targetType:
        "webhook_event",

      targetId:
        "event-1",

      organizationId:
        null,

      source:
        "function",

      requestId:
        "request-1",

      createdAt,

      metadata: {
        schemaVersion:
          1,

        previousStatus:
          "error",

        previousErrorCode:
          "PROVIDER_PAYMENT_VALUE_MISMATCH",

        reprocessCount:
          3
      }
    }
  );

  const serialized =
    JSON.stringify(
      audit
    );

  for (
    const forbidden
    of [
      "providerEventId",
      "providerPaymentId",
      "providerCustomerId",
      "externalReference",
      "billingType",
      "valueCents",
      "payload",
      "authToken",
      "apiKey",
      "wallet"
    ]
  ) {
    assert.strictEqual(
      serialized.includes(
        forbidden
      ),
      false,
      `Audit leaked ${forbidden}`
    );
  }

  assert.throws(
    () =>
      normalizeReprocessMetadata(
        event({
          reprocessCount:
            1
        })
      ),
    error =>
      error instanceof
        AdminWebhookReprocessDomainError &&
      error.code ===
        "ADMIN_WEBHOOK_REPROCESS_METADATA_INVALID"
  );

  assert.throws(
    () =>
      normalizeReprocessableWebhookEvent({
        eventId:
          "event-ignore-error",

        event:
          event({
            processingAction:
              "ignore"
          })
      }),
    error =>
      error instanceof
        AdminWebhookReprocessDomainError &&
      error.code ===
        "ADMIN_WEBHOOK_REPROCESS_CANONICAL_STATE_INVALID"
  );

  assert.throws(
    () =>
      buildWebhookReprocessAuditEvent({
        actorUid:
          "admin-1",

        actorRole:
          "finance_admin",

        eventId:
          "event-1",

        requestId:
          "request-1",

        previousStatus:
          "processed",

        reprocessCount:
          1,

        createdAt
      }),
    error =>
      error instanceof
        AdminWebhookReprocessDomainError &&
      error.code ===
        "ADMIN_WEBHOOK_REPROCESS_AUDIT_INVALID"
  );

  console.log(
    "MARCO8_6C_REPROCESS_SCHEMA_VERSION=1"
  );

  console.log(
    "MARCO8_6C_REPROCESS_ACTION=admin.webhook.reprocess.requested"
  );

  console.log(
    "MARCO8_6C_IN_FLIGHT_STATUSES=2/2"
  );

  console.log(
    "MARCO8_6C_TERMINAL_STATUSES=2/2"
  );

  console.log(
    "MARCO8_6C_AUDIT_SANITIZED=True"
  );

  console.log(
    "MARCO8_6C_REPROCESS_DOMAIN=PASSED"
  );
}

main();
