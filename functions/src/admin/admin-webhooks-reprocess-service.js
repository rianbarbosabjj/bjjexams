"use strict";

const {
  AdminWebhookReprocessDomainError,
  requiredReprocessIdentifier,
  normalizeReprocessableWebhookEvent,
  buildWebhookReprocessAuditEvent,
  WEBHOOK_REPROCESS_IN_FLIGHT_STATUSES,
  WEBHOOK_REPROCESS_TERMINAL_STATUSES
} = require(
  "./admin-webhooks-reprocess-domain"
);

const WEBHOOK_EVENTS_COLLECTION =
  "payment_webhook_events";

const AUDIT_LOGS_COLLECTION =
  "audit_logs";

class AdminWebhooksReprocessServiceError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminWebhooksReprocessServiceError";

    this.code =
      code;
  }
}

function requireServiceDate(
  value,
  field
) {
  const date =
    value instanceof Date
      ? value
      : new Date(
          value
        );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new AdminWebhooksReprocessServiceError(
      "ADMIN_WEBHOOK_REPROCESS_TIMESTAMP_INVALID",
      `${field} is invalid.`
    );
  }

  return date;
}

function safeProcessorErrorCode(
  error
) {
  const candidate =
    typeof error?.code ===
      "string"
      ? error.code.trim()
      : "";

  if (
    candidate &&
    /^[A-Z0-9_.:-]{1,120}$/.test(
      candidate
    )
  ) {
    return candidate;
  }

  return "ADMIN_WEBHOOK_REPROCESS_PROCESSING_FAILED";
}

function createAdminWebhooksReprocessService(
  dependencies = {}
) {
  const {
    db,
    processor,
    clock =
      () =>
        new Date()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !==
      "function" ||
    typeof db.collection !==
      "function" ||
    typeof db.runTransaction !==
      "function"
  ) {
    throw new TypeError(
      "Admin webhook reprocess service requires Firestore."
    );
  }

  if (
    typeof processor !==
      "function"
  ) {
    throw new TypeError(
      "Admin webhook reprocess service requires a canonical processor."
    );
  }

  if (
    typeof clock !==
      "function"
  ) {
    throw new TypeError(
      "Admin webhook reprocess service requires a clock."
    );
  }

  async function markProcessingFailure(
    {
      eventId,
      requestId,
      errorCode
    }
  ) {
    const eventRef =
      db.doc(
        `${WEBHOOK_EVENTS_COLLECTION}/${eventId}`
      );

    const now =
      requireServiceDate(
        clock(),
        "clock"
      );

    return db.runTransaction(
      async transaction => {
        const snapshot =
          await transaction.get(
            eventRef
          );

        if (
          !snapshot ||
          snapshot.exists !==
            true
        ) {
          return false;
        }

        const data =
          snapshot.data() ||
          {};

        if (
          data.lastReprocessRequestId !==
            requestId ||
          !WEBHOOK_REPROCESS_IN_FLIGHT_STATUSES
            .includes(
              String(
                data.status ||
                ""
              )
                .trim()
                .toLowerCase()
            )
        ) {
          return false;
        }

        transaction.update(
          eventRef,
          {
            status:
              "error",

            errorCode,

            processedAt:
              now
          }
        );

        return true;
      }
    );
  }

  async function prepareReprocess(
    input = {}
  ) {
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

    const eventRef =
      db.doc(
        `${WEBHOOK_EVENTS_COLLECTION}/${eventId}`
      );

    const auditRef =
      db
        .collection(
          AUDIT_LOGS_COLLECTION
        )
        .doc();

    return db.runTransaction(
      async transaction => {
        const snapshot =
          await transaction.get(
            eventRef
          );

        if (
          !snapshot ||
          snapshot.exists !==
            true
        ) {
          throw new AdminWebhooksReprocessServiceError(
            "ADMIN_WEBHOOK_REPROCESS_NOT_FOUND",
            "Webhook event was not found."
          );
        }

        const rawEvent =
          snapshot.data() ||
          {};

        let normalized;

        try {
          normalized =
            normalizeReprocessableWebhookEvent({
              eventId,
              event:
                rawEvent
            });
        }
        catch (error) {
          if (
            error instanceof
            AdminWebhookReprocessDomainError
          ) {
            throw new AdminWebhooksReprocessServiceError(
              error.code,
              error.message
            );
          }

          throw error;
        }

        const {
          canonical,
          metadata
        } =
          normalized;

        if (
          metadata.lastReprocessRequestId ===
            requestId
        ) {
          return Object.freeze({
            accepted:
              false,

            idempotent:
              true,

            eventId,
            requestId,

            reprocessCount:
              metadata.reprocessCount,

            status:
              canonical.status,

            eventData:
              null,

            auditId:
              null
          });
        }

        if (
          WEBHOOK_REPROCESS_IN_FLIGHT_STATUSES
            .includes(
              canonical.status
            )
        ) {
          throw new AdminWebhooksReprocessServiceError(
            "ADMIN_WEBHOOK_REPROCESS_IN_FLIGHT",
            "Webhook event is already in processing state."
          );
        }

        if (
          WEBHOOK_REPROCESS_TERMINAL_STATUSES
            .includes(
              canonical.status
            )
        ) {
          throw new AdminWebhooksReprocessServiceError(
            "ADMIN_WEBHOOK_REPROCESS_NOT_ELIGIBLE",
            "Webhook event is already terminal."
          );
        }

        if (
          canonical.status !==
          "error"
        ) {
          throw new AdminWebhooksReprocessServiceError(
            "ADMIN_WEBHOOK_REPROCESS_NOT_ELIGIBLE",
            "Webhook event is not eligible for reprocessing."
          );
        }

        const now =
          requireServiceDate(
            clock(),
            "clock"
          );

        const nextReprocessCount =
          metadata.reprocessCount +
          1;

        if (
          !Number.isSafeInteger(
            nextReprocessCount
          )
        ) {
          throw new AdminWebhooksReprocessServiceError(
            "ADMIN_WEBHOOK_REPROCESS_METADATA_INVALID",
            "Webhook reprocess count overflow."
          );
        }

        const auditEvent =
          buildWebhookReprocessAuditEvent({
            actorUid,
            actorRole,
            eventId,
            requestId,

            previousStatus:
              canonical.status,

            previousErrorCode:
              canonical.errorCode,

            reprocessCount:
              nextReprocessCount,

            createdAt:
              now
          });

        const updateData = {
          status:
            "received",

          errorCode:
            null,

          processedAt:
            null,

          reprocessCount:
            nextReprocessCount,

          lastReprocessRequestId:
            requestId,

          lastReprocessRequestedBy:
            actorUid,

          lastReprocessRequestedAt:
            now
        };

        transaction.update(
          eventRef,
          updateData
        );

        transaction.create(
          auditRef,
          auditEvent
        );

        return Object.freeze({
          accepted:
            true,

          idempotent:
            false,

          eventId,
          requestId,

          reprocessCount:
            nextReprocessCount,

          status:
            "received",

          eventData:
            Object.freeze({
              ...rawEvent,
              ...updateData
            }),

          auditId:
            auditRef.id
        });
      }
    );
  }

  async function readFinalEvent(
    eventId
  ) {
    const snapshot =
      await db
        .doc(
          `${WEBHOOK_EVENTS_COLLECTION}/${eventId}`
        )
        .get();

    if (
      !snapshot ||
      snapshot.exists !==
        true
    ) {
      throw new AdminWebhooksReprocessServiceError(
        "ADMIN_WEBHOOK_REPROCESS_NOT_FOUND",
        "Webhook event disappeared after processing."
      );
    }

    return snapshot.data() ||
      {};
  }

  async function reprocessWebhook(
    input = {}
  ) {
    const prepared =
      await prepareReprocess(
        input
      );

    if (
      prepared.idempotent ===
      true
    ) {
      return Object.freeze({
        accepted:
          false,

        idempotent:
          true,

        eventId:
          prepared.eventId,

        requestId:
          prepared.requestId,

        reprocessCount:
          prepared.reprocessCount,

        status:
          prepared.status,

        outcome:
          "idempotent"
      });
    }

    try {
      await processor({
        eventId:
          prepared.eventId,

        eventData:
          prepared.eventData
      });
    }
    catch (error) {
      const errorCode =
        safeProcessorErrorCode(
          error
        );

      await markProcessingFailure({
        eventId:
          prepared.eventId,

        requestId:
          prepared.requestId,

        errorCode
      });

      throw new AdminWebhooksReprocessServiceError(
        "ADMIN_WEBHOOK_REPROCESS_PROCESSING_FAILED",
        `Webhook reprocessing failed: ${errorCode}`
      );
    }

    const finalEvent =
      await readFinalEvent(
        prepared.eventId
      );

    const finalStatus =
      String(
        finalEvent.status ||
        ""
      )
        .trim()
        .toLowerCase();

    if (
      WEBHOOK_REPROCESS_IN_FLIGHT_STATUSES
        .includes(
          finalStatus
        )
    ) {
      await markProcessingFailure({
        eventId:
          prepared.eventId,

        requestId:
          prepared.requestId,

        errorCode:
          "ADMIN_WEBHOOK_REPROCESS_PROCESSING_INCOMPLETE"
      });

      throw new AdminWebhooksReprocessServiceError(
        "ADMIN_WEBHOOK_REPROCESS_PROCESSING_INCOMPLETE",
        "Webhook processor returned without a terminal state."
      );
    }

    if (
      ![
        "processed",
        "error"
      ].includes(
        finalStatus
      )
    ) {
      throw new AdminWebhooksReprocessServiceError(
        "ADMIN_WEBHOOK_REPROCESS_CANONICAL_STATE_INVALID",
        "Webhook finished reprocessing in an invalid state."
      );
    }

    const finalErrorCode =
      finalStatus ===
        "error"
        ? (
            typeof finalEvent.errorCode ===
              "string" &&
            /^[A-Z0-9_.:-]{1,120}$/.test(
              finalEvent.errorCode
            )
              ? finalEvent.errorCode
              : null
          )
        : null;

    return Object.freeze({
      accepted:
        true,

      idempotent:
        false,

      eventId:
        prepared.eventId,

      requestId:
        prepared.requestId,

      reprocessCount:
        prepared.reprocessCount,

      status:
        finalStatus,

      outcome:
        finalStatus,

      errorCode:
        finalErrorCode
    });
  }

  return Object.freeze({
    prepareReprocess,
    markProcessingFailure,
    reprocessWebhook
  });
}

module.exports = {
  WEBHOOK_EVENTS_COLLECTION,
  AUDIT_LOGS_COLLECTION,

  AdminWebhooksReprocessServiceError,

  requireServiceDate,
  safeProcessorErrorCode,
  createAdminWebhooksReprocessService
};
