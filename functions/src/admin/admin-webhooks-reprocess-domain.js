"use strict";

const {
  AdminWebhookModelError,
  normalizeCanonicalWebhookEvent,
  webhookTimestampMillis
} = require(
  "./admin-webhook-models"
);

const ADMIN_WEBHOOK_REPROCESS_SCHEMA_VERSION =
  1;

const ADMIN_WEBHOOK_REPROCESS_ACTION =
  "admin.webhook.reprocess.requested";

const ADMIN_WEBHOOK_REPROCESS_TARGET_TYPE =
  "webhook_event";

const WEBHOOK_REPROCESS_IN_FLIGHT_STATUSES =
  Object.freeze([
    "received",
    "processing"
  ]);

const WEBHOOK_REPROCESS_TERMINAL_STATUSES =
  Object.freeze([
    "processed",
    "ignored"
  ]);

class AdminWebhookReprocessDomainError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminWebhookReprocessDomainError";

    this.code =
      code;
  }
}

function requiredReprocessIdentifier(
  value,
  field,
  maxLength = 128
) {
  const normalized =
    typeof value ===
      "string"
      ? value.trim()
      : "";

  if (
    !normalized ||
    normalized.length >
      maxLength ||
    normalized.includes("/")
  ) {
    throw new AdminWebhookReprocessDomainError(
      "ADMIN_WEBHOOK_REPROCESS_INPUT_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function optionalReprocessIdentifier(
  value,
  field,
  maxLength = 128
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return requiredReprocessIdentifier(
    value,
    field,
    maxLength
  );
}

function normalizeReprocessCount(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return 0;
  }

  const count =
    Number(value);

  if (
    !Number.isSafeInteger(
      count
    ) ||
    count < 0
  ) {
    throw new AdminWebhookReprocessDomainError(
      "ADMIN_WEBHOOK_REPROCESS_METADATA_INVALID",
      "Webhook reprocessCount is invalid."
    );
  }

  return count;
}

function normalizeReprocessMetadata(
  event = {}
) {
  const reprocessCount =
    normalizeReprocessCount(
      event.reprocessCount
    );

  const lastReprocessRequestId =
    optionalReprocessIdentifier(
      event.lastReprocessRequestId,
      "lastReprocessRequestId"
    );

  const lastReprocessRequestedBy =
    optionalReprocessIdentifier(
      event.lastReprocessRequestedBy,
      "lastReprocessRequestedBy"
    );

  let lastReprocessRequestedAt =
    null;

  if (
    event.lastReprocessRequestedAt !==
      undefined &&
    event.lastReprocessRequestedAt !==
      null
  ) {
    try {
      webhookTimestampMillis(
        event.lastReprocessRequestedAt,
        "lastReprocessRequestedAt"
      );

      lastReprocessRequestedAt =
        event.lastReprocessRequestedAt;
    }
    catch (error) {
      throw new AdminWebhookReprocessDomainError(
        "ADMIN_WEBHOOK_REPROCESS_METADATA_INVALID",
        "lastReprocessRequestedAt is invalid."
      );
    }
  }

  const hasAnyLastMetadata =
    Boolean(
      lastReprocessRequestId ||
      lastReprocessRequestedBy ||
      lastReprocessRequestedAt
    );

  if (
    reprocessCount === 0 &&
    hasAnyLastMetadata
  ) {
    throw new AdminWebhookReprocessDomainError(
      "ADMIN_WEBHOOK_REPROCESS_METADATA_INVALID",
      "Webhook reprocess metadata is inconsistent."
    );
  }

  if (
    reprocessCount > 0 &&
    (
      !lastReprocessRequestId ||
      !lastReprocessRequestedBy ||
      !lastReprocessRequestedAt
    )
  ) {
    throw new AdminWebhookReprocessDomainError(
      "ADMIN_WEBHOOK_REPROCESS_METADATA_INVALID",
      "Webhook reprocess metadata is incomplete."
    );
  }

  return Object.freeze({
    reprocessCount,
    lastReprocessRequestId,
    lastReprocessRequestedBy,
    lastReprocessRequestedAt
  });
}

function normalizeReprocessableWebhookEvent(
  input = {}
) {
  const eventId =
    requiredReprocessIdentifier(
      input.eventId,
      "eventId",
      255
    );

  const event =
    input.event &&
    typeof input.event ===
      "object" &&
    !Array.isArray(
      input.event
    )
      ? input.event
      : {};

  let canonical;

  try {
    canonical =
      normalizeCanonicalWebhookEvent({
        eventId,
        event
      });
  }
  catch (error) {
    if (
      error instanceof
      AdminWebhookModelError
    ) {
      throw new AdminWebhookReprocessDomainError(
        "ADMIN_WEBHOOK_REPROCESS_CANONICAL_STATE_INVALID",
        "Webhook canonical state is invalid."
      );
    }

    throw error;
  }

  const metadata =
    normalizeReprocessMetadata(
      event
    );

  if (
    canonical.status ===
      "error" &&
    ![
      "confirm_payment",
      "reconcile_reversal"
    ].includes(
      canonical.processingAction
    )
  ) {
    throw new AdminWebhookReprocessDomainError(
      "ADMIN_WEBHOOK_REPROCESS_CANONICAL_STATE_INVALID",
      "Errored webhook has an invalid processing action."
    );
  }

  return Object.freeze({
    canonical,
    metadata
  });
}

function buildWebhookReprocessAuditEvent(
  input = {}
) {
  const actorUid =
    requiredReprocessIdentifier(
      input.actorUid,
      "actorUid"
    );

  const actorRole =
    requiredReprocessIdentifier(
      input.actorRole,
      "actorRole",
      80
    );

  const eventId =
    requiredReprocessIdentifier(
      input.eventId,
      "eventId",
      255
    );

  const requestId =
    requiredReprocessIdentifier(
      input.requestId,
      "requestId"
    );

  const previousStatus =
    String(
      input.previousStatus ||
      ""
    )
      .trim()
      .toLowerCase();

  if (
    previousStatus !==
    "error"
  ) {
    throw new AdminWebhookReprocessDomainError(
      "ADMIN_WEBHOOK_REPROCESS_AUDIT_INVALID",
      "Reprocess audit requires previous status error."
    );
  }

  const previousErrorCode =
    input.previousErrorCode ===
      undefined ||
    input.previousErrorCode ===
      null ||
    input.previousErrorCode ===
      ""
      ? null
      : String(
          input.previousErrorCode
        )
          .trim()
          .slice(
            0,
            120
          );

  const reprocessCount =
    normalizeReprocessCount(
      input.reprocessCount
    );

  if (
    reprocessCount < 1
  ) {
    throw new AdminWebhookReprocessDomainError(
      "ADMIN_WEBHOOK_REPROCESS_AUDIT_INVALID",
      "Reprocess audit requires a positive reprocessCount."
    );
  }

  if (
    input.createdAt ===
      undefined ||
    input.createdAt ===
      null
  ) {
    throw new AdminWebhookReprocessDomainError(
      "ADMIN_WEBHOOK_REPROCESS_AUDIT_INVALID",
      "Reprocess audit requires createdAt."
    );
  }

  return Object.freeze({
    eventType:
      ADMIN_WEBHOOK_REPROCESS_ACTION,

    actorUid,
    actorRole,

    targetType:
      ADMIN_WEBHOOK_REPROCESS_TARGET_TYPE,

    targetId:
      eventId,

    organizationId:
      null,

    source:
      "function",

    requestId,

    createdAt:
      input.createdAt,

    metadata:
      Object.freeze({
        schemaVersion:
          ADMIN_WEBHOOK_REPROCESS_SCHEMA_VERSION,

        previousStatus:
          "error",

        previousErrorCode,

        reprocessCount
      })
  });
}

module.exports = {
  ADMIN_WEBHOOK_REPROCESS_SCHEMA_VERSION,
  ADMIN_WEBHOOK_REPROCESS_ACTION,
  ADMIN_WEBHOOK_REPROCESS_TARGET_TYPE,

  WEBHOOK_REPROCESS_IN_FLIGHT_STATUSES,
  WEBHOOK_REPROCESS_TERMINAL_STATUSES,

  AdminWebhookReprocessDomainError,

  requiredReprocessIdentifier,
  optionalReprocessIdentifier,
  normalizeReprocessCount,
  normalizeReprocessMetadata,
  normalizeReprocessableWebhookEvent,
  buildWebhookReprocessAuditEvent
};
