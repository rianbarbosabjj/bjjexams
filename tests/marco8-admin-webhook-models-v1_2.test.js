"use strict";

const assert = require("assert");
const {
  OPERATIONAL_WEBHOOK_VIEW_FIELDS,
  OPERATIONAL_WEBHOOK_PROCESSING_FIELDS,
  OPERATIONAL_WEBHOOK_TIMESTAMP_FIELDS,
  WEBHOOK_EVENT_STATUSES,
  AdminWebhookModelError,
  maskedProviderEventReference,
  normalizeCanonicalWebhookEvent,
  buildOperationalWebhookView
} = require("../functions/src/admin/admin-webhook-models");

function event(overrides = {}) {
  return {
    provider: "asaas",
    providerEventId: "evt_secret_provider_001",
    eventType: "PAYMENT_CONFIRMED",
    status: "processed",
    orderId: "order-1",
    transactionId: "transaction-secret",
    providerPaymentId: "payment-secret",
    providerCustomerId: "customer-secret",
    externalReference: "external-secret",
    billingType: "PIX",
    valueCents: 12345,
    processingAction: "confirm_payment",
    processingReason: "PAYMENT_CONFIRMATION_EVENT",
    deliveryCount: 2,
    receivedAt: "2026-09-30T10:00:00.000Z",
    firstReceivedAt: "2026-09-30T10:00:00.000Z",
    lastReceivedAt: "2026-09-30T10:01:00.000Z",
    processedAt: "2026-09-30T10:02:00.000Z",
    errorCode: null,
    rawPayload: { secret: true },
    authToken: "must-not-leak",
    apiKey: "must-not-leak",
    cpf: "must-not-leak",
    ...overrides
  };
}

function main() {
  assert.deepStrictEqual(OPERATIONAL_WEBHOOK_VIEW_FIELDS, [
    "eventId", "provider", "providerEventRef", "eventType", "status",
    "relatedOrderId", "deliveryCount", "processing", "timestamps"
  ]);
  assert.deepStrictEqual(OPERATIONAL_WEBHOOK_PROCESSING_FIELDS, [
    "action", "result", "errorCode"
  ]);
  assert.deepStrictEqual(OPERATIONAL_WEBHOOK_TIMESTAMP_FIELDS, [
    "receivedAt", "lastReceivedAt", "processedAt"
  ]);
  assert.deepStrictEqual(WEBHOOK_EVENT_STATUSES, [
    "received", "processing", "processed", "ignored", "error"
  ]);

  const normalized = normalizeCanonicalWebhookEvent({
    eventId: "event-doc-1",
    event: event()
  });
  assert.strictEqual(normalized.eventId, "event-doc-1");
  assert.strictEqual(normalized.provider, "asaas");
  assert.strictEqual(normalized.eventType, "PAYMENT_CONFIRMED");
  assert.strictEqual(normalized.status, "processed");
  assert.strictEqual(normalized.relatedOrderId, "order-1");

  const view = buildOperationalWebhookView({
    eventId: "event-doc-1",
    event: event()
  });
  assert.deepStrictEqual(Object.keys(view), OPERATIONAL_WEBHOOK_VIEW_FIELDS);
  assert.deepStrictEqual(Object.keys(view.processing), OPERATIONAL_WEBHOOK_PROCESSING_FIELDS);
  assert.deepStrictEqual(Object.keys(view.timestamps), OPERATIONAL_WEBHOOK_TIMESTAMP_FIELDS);
  assert.strictEqual(view.provider, "asaas");
  assert.strictEqual(
    view.providerEventRef,
    maskedProviderEventReference("evt_secret_provider_001")
  );
  assert.ok(/^\*\*\*[a-f0-9]{12}$/.test(view.providerEventRef));
  assert.strictEqual(view.providerEventRef.includes("evt_secret_provider_001"), false);
  assert.deepStrictEqual(view.processing, {
    action: "confirm_payment",
    result: "processed",
    errorCode: null
  });
  assert.deepStrictEqual(view.timestamps, {
    receivedAt: "2026-09-30T10:00:00.000Z",
    lastReceivedAt: "2026-09-30T10:01:00.000Z",
    processedAt: "2026-09-30T10:02:00.000Z"
  });

  const errorView = buildOperationalWebhookView({
    eventId: "event-error",
    event: event({
      status: "error",
      orderId: null,
      errorCode: "PROVIDER_PAYMENT_VALUE_MISMATCH",
      processedAt: "2026-09-30T10:03:00.000Z"
    })
  });
  assert.strictEqual(errorView.relatedOrderId, null);
  assert.deepStrictEqual(errorView.processing, {
    action: "confirm_payment",
    result: "error",
    errorCode: "PROVIDER_PAYMENT_VALUE_MISMATCH"
  });

  const ignoredView = buildOperationalWebhookView({
    eventId: "event-ignored",
    event: event({
      eventType: "PAYMENT_CREATED",
      status: "ignored",
      processingAction: "ignore"
    })
  });
  assert.strictEqual(ignoredView.processing.result, "ignored");

  const serialized = JSON.stringify({ view, errorView, ignoredView });
  for (const forbidden of [
    "providerPaymentId", "providerCustomerId", "externalReference",
    "billingType", "valueCents", "transactionId", "processingReason",
    "rawPayload", "authToken", "apiKey", "wallet", "financialSnapshot",
    "cpf", "evt_secret_provider_001", "payment-secret",
    "customer-secret", "external-secret"
  ]) {
    assert.strictEqual(
      serialized.includes(forbidden),
      false,
      `OperationalWebhookView leaked ${forbidden}`
    );
  }

  assert.throws(
    () => buildOperationalWebhookView({
      eventId: "event-invalid-provider",
      event: event({ provider: "other" })
    }),
    error => error instanceof AdminWebhookModelError &&
      error.code === "ADMIN_WEBHOOK_PROVIDER_INVALID"
  );

  assert.throws(
    () => buildOperationalWebhookView({
      eventId: "event-invalid-status",
      event: event({ status: "mystery" })
    }),
    error => error instanceof AdminWebhookModelError &&
      error.code === "ADMIN_WEBHOOK_STATUS_INVALID"
  );

  assert.throws(
    () => buildOperationalWebhookView({
      eventId: "event-invalid-delivery",
      event: event({ deliveryCount: 0 })
    }),
    error => error instanceof AdminWebhookModelError &&
      error.code === "ADMIN_WEBHOOK_DELIVERY_COUNT_INVALID"
  );

  assert.throws(
    () => buildOperationalWebhookView({
      eventId: "event-invalid-time",
      event: event({ lastReceivedAt: "2026-09-30T09:59:59.000Z" })
    }),
    error => error instanceof AdminWebhookModelError &&
      error.code === "ADMIN_WEBHOOK_TIMESTAMP_INVALID"
  );

  console.log("MARCO8_6B_WEBHOOK_VIEW_FIELDS=9/9");
  console.log("MARCO8_6B_WEBHOOK_PROCESSING_FIELDS=3/3");
  console.log("MARCO8_6B_WEBHOOK_TIMESTAMP_FIELDS=3/3");
  console.log("MARCO8_6B_WEBHOOK_STATUSES=5/5");
  console.log("MARCO8_6B_PROVIDER_EVENT_REF=MASKED_HASH");
  console.log("MARCO8_6B_SENSITIVE_FIELD_EXPOSURE=False");
  console.log("MARCO8_6B_WEBHOOK_MODEL_FAIL_CLOSED=PASSED");
  console.log("MARCO8_6B_ADMIN_WEBHOOK_MODELS=PASSED");
}

main();
