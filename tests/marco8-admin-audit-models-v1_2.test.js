"use strict";

const assert =
  require("assert");

const {
  AUDIT_OPERATIONAL_VIEW_FIELDS,
  AUDIT_ACTOR_FIELDS,
  AUDIT_TARGET_FIELDS,
  AUDIT_METADATA_ALLOWED_FIELDS,
  AUDIT_METADATA_MAX_JSON_BYTES,
  AdminAuditModelError,
  normalizeCanonicalAuditEvent,
  buildOperationalAuditView
} = require(
  "../functions/src/admin/admin-audit-models"
);

function legacyAudit(
  overrides = {}
) {
  return {
    actorId:
      "admin-legacy",

    actorRole:
      "support_admin",

    action:
      "admin.person.suspended",

    entityType:
      "person",

    entityId:
      "person-1",

    organizationId:
      null,

    before: {
      status:
        "active",

      cpf:
        "12345678901",

      password:
        "do-not-leak"
    },

    after: {
      status:
        "suspended",

      bearerToken:
        "do-not-leak"
    },

    source:
      "function",

    requestId:
      "request-legacy",

    createdAt:
      "2026-09-30T10:00:00.000Z",

    metadata: {
      schemaVersion:
        1,

      unknownNested: {
        secret:
          "do-not-leak"
      }
    },

    ...overrides
  };
}

function main() {
  assert.deepStrictEqual(
    AUDIT_OPERATIONAL_VIEW_FIELDS,
    [
      "auditId",
      "eventType",
      "actor",
      "target",
      "organizationId",
      "source",
      "requestId",
      "createdAt",
      "metadata"
    ]
  );

  assert.deepStrictEqual(
    AUDIT_ACTOR_FIELDS,
    [
      "uid",
      "role"
    ]
  );

  assert.deepStrictEqual(
    AUDIT_TARGET_FIELDS,
    [
      "type",
      "id"
    ]
  );

  assert.ok(
    AUDIT_METADATA_ALLOWED_FIELDS
      .includes(
        "schemaVersion"
      )
  );

  assert.strictEqual(
    AUDIT_METADATA_MAX_JSON_BYTES,
    2048
  );

  const legacy =
    buildOperationalAuditView({
      auditId:
        "audit-legacy",

      audit:
        legacyAudit()
    });

  assert.deepStrictEqual(
    Object.keys(
      legacy
    ),
    AUDIT_OPERATIONAL_VIEW_FIELDS
  );

  assert.deepStrictEqual(
    Object.keys(
      legacy.actor
    ),
    AUDIT_ACTOR_FIELDS
  );

  assert.deepStrictEqual(
    Object.keys(
      legacy.target
    ),
    AUDIT_TARGET_FIELDS
  );

  assert.strictEqual(
    legacy.eventType,
    "admin.person.suspended"
  );

  assert.deepStrictEqual(
    legacy.actor,
    {
      uid:
        "admin-legacy",

      role:
        "support_admin"
    }
  );

  assert.deepStrictEqual(
    legacy.target,
    {
      type:
        "person",

      id:
        "person-1"
    }
  );

  assert.deepStrictEqual(
    legacy.metadata,
    {
      schemaVersion:
        1,

      beforeStatus:
        "active",

      afterStatus:
        "suspended"
    }
  );

  const normalized =
    buildOperationalAuditView({
      auditId:
        "audit-reprocess",

      audit: {
        eventType:
          "admin.webhook.reprocess.requested",

        actorUid:
          "admin-finance",

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

        createdAt:
          "2026-09-30T12:00:00.000Z",

        metadata: {
          schemaVersion:
            1,

          previousStatus:
            "error",

          previousErrorCode:
            "PROVIDER_PAYMENT_VALUE_MISMATCH",

          reprocessCount:
            2,

          rawPayload: {
            secret:
              true
          }
        }
      }
    });

  assert.strictEqual(
    normalized.eventType,
    "admin.webhook.reprocess.requested"
  );

  assert.deepStrictEqual(
    normalized.metadata,
    {
      schemaVersion:
        1,

      previousStatus:
        "error",

      previousErrorCode:
        "PROVIDER_PAYMENT_VALUE_MISMATCH",

      reprocessCount:
        2
    }
  );

  const question =
    buildOperationalAuditView({
      auditId:
        "audit-question",

      audit: {
        actorId:
          "admin-content",

        actorRole:
          "content_admin",

        action:
          "admin.question.updated",

        entityType:
          "question",

        entityId:
          "question-1",

        before: {
          lifecycleStatus:
            "draft",

          revision:
            3,

          statement:
            "secret question body",

          correctAnswer:
            "B"
        },

        after: {
          lifecycleStatus:
            "pending_review",

          revision:
            4,

          statement:
            "changed secret question body",

          options: {
            A:
              "secret"
          }
        },

        source:
          "function",

        requestId:
          "request-question",

        createdAt:
          "2026-09-30T11:00:00.000Z",

        metadata: {
          schemaVersion:
            1,

          operation:
            "update",

          changedFields: [
            "statement",
            "options"
          ],

          moderationReason:
            "do-not-leak"
        }
      }
    });

  assert.deepStrictEqual(
    question.metadata,
    {
      schemaVersion:
        1,

      operation:
        "update",

      changedFields: [
        "statement",
        "options"
      ],

      beforeLifecycleStatus:
        "draft",

      afterLifecycleStatus:
        "pending_review",

      beforeRevision:
        3,

      afterRevision:
        4
    }
  );

  const financial =
    buildOperationalAuditView({
      auditId:
        "audit-financial",

      audit: {
        actorId:
          "system:asaas-webhook",

        actorRole:
          "system",

        action:
          "financial.payment.confirmed",

        entityType:
          "payment_transaction",

        entityId:
          "transaction-1",

        before: {
          orderStatus:
            "pending_payment",

          transactionStatus:
            "pending",

          walletId:
            "wallet-secret",

          amountCents:
            10000
        },

        after: {
          orderStatus:
            "paid",

          transactionStatus:
            "paid",

          providerStatus:
            "RECEIVED",

          recipientShares: [
            {
              walletId:
                "wallet-secret"
            }
          ]
        },

        source:
          "webhook_worker",

        requestId:
          "event-1",

        createdAt:
          "2026-09-30T09:00:00.000Z"
      }
    });

  assert.deepStrictEqual(
    financial.metadata,
    {
      beforeOrderStatus:
        "pending_payment",

      afterOrderStatus:
        "paid",

      beforeTransactionStatus:
        "pending",

      afterTransactionStatus:
        "paid",

      afterProviderStatus:
        "RECEIVED"
    }
  );

  const serialized =
    JSON.stringify({
      legacy,
      normalized,
      question,
      financial
    });

  for (
    const forbidden
    of [
      "\"before\"",
      "\"after\"",
      "12345678901",
      "do-not-leak",
      "secret question body",
      "changed secret question body",
      "wallet-secret",
      "amountCents",
      "recipientShares",
      "correctAnswer",
      "rawPayload",
      "bearerToken",
      "password",
      "moderationReason"
    ]
  ) {
    assert.strictEqual(
      serialized.includes(
        forbidden
      ),
      false,
      `Audit view leaked ${forbidden}`
    );
  }

  assert.throws(
    () =>
      normalizeCanonicalAuditEvent({
        auditId:
          "audit-conflict",

        audit:
          legacyAudit({
            eventType:
              "admin.person.reactivated"
          })
      }),
    error =>
      error instanceof
        AdminAuditModelError &&
      error.code ===
        "ADMIN_AUDIT_ALIAS_CONFLICT"
  );

  assert.throws(
    () =>
      buildOperationalAuditView({
        auditId:
          "audit-invalid-fields",

        audit:
          legacyAudit({
            metadata: {
              changedFields:
                Array.from(
                  {
                    length:
                      26
                  },
                  (
                    _,
                    index
                  ) =>
                    `field${index}`
                )
            }
          })
      }),
    error =>
      error instanceof
        AdminAuditModelError &&
      error.code ===
        "ADMIN_AUDIT_METADATA_INVALID"
  );

  console.log(
    "MARCO8_6D_AUDIT_VIEW_FIELDS=9/9"
  );

  console.log(
    "MARCO8_6D_ACTOR_FIELDS=2/2"
  );

  console.log(
    "MARCO8_6D_TARGET_FIELDS=2/2"
  );

  console.log(
    "MARCO8_6D_LEGACY_ALIASES=4/4"
  );

  console.log(
    "MARCO8_6D_METADATA=SHALLOW_ALLOWLISTED_BOUNDED"
  );

  console.log(
    "MARCO8_6D_RAW_BEFORE_AFTER_EXPOSURE=False"
  );

  console.log(
    "MARCO8_6D_SENSITIVE_FIELD_EXPOSURE=False"
  );

  console.log(
    "MARCO8_6D_AUDIT_MODEL_FAIL_CLOSED=PASSED"
  );

  console.log(
    "MARCO8_6D_ADMIN_AUDIT_MODELS=PASSED"
  );
}

main();
