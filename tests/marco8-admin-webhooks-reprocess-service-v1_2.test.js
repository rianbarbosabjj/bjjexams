"use strict";

const assert =
  require("assert");

const {
  AdminWebhooksReprocessServiceError,
  createAdminWebhooksReprocessService
} = require(
  "../functions/src/admin/admin-webhooks-reprocess-service"
);

function clone(
  value
) {
  if (
    value === undefined
  ) {
    return undefined;
  }

  return JSON.parse(
    JSON.stringify(
      value
    )
  );
}

class FakeSnapshot {
  constructor(
    ref,
    value
  ) {
    this.ref =
      ref;

    this.id =
      ref.id;

    this.exists =
      value !==
      undefined;

    this.value =
      value;
  }

  data() {
    return this.exists
      ? clone(
          this.value
        )
      : undefined;
  }
}

class FakeRef {
  constructor(
    db,
    path
  ) {
    this.db =
      db;

    this.path =
      path;

    this.id =
      path
        .split("/")
        .pop();
  }

  async get() {
    return this.db.snapshot(
      this.path
    );
  }
}

class FakeCollectionRef {
  constructor(
    db,
    name
  ) {
    this.db =
      db;

    this.name =
      name;
  }

  doc() {
    this.db.sequence +=
      1;

    return new FakeRef(
      this.db,
      `${this.name}/auto-${this.db.sequence}`
    );
  }
}

class FakeTransaction {
  constructor(
    db
  ) {
    this.db =
      db;

    this.pending =
      [];
  }

  async get(
    ref
  ) {
    return this.db.snapshot(
      ref.path
    );
  }

  update(
    ref,
    patch
  ) {
    this.pending.push({
      kind:
        "update",

      path:
        ref.path,

      patch:
        clone(
          patch
        )
    });
  }

  create(
    ref,
    value
  ) {
    this.pending.push({
      kind:
        "create",

      path:
        ref.path,

      value:
        clone(
          value
        )
    });
  }

  commit() {
    for (
      const operation
      of this.pending
    ) {
      if (
        operation.kind ===
        "update"
      ) {
        if (
          !this.db.records.has(
            operation.path
          )
        ) {
          throw new Error(
            `Missing update target ${operation.path}`
          );
        }

        this.db.records.set(
          operation.path,
          {
            ...this.db.records.get(
              operation.path
            ),

            ...operation.patch
          }
        );
      }
      else if (
        operation.kind ===
        "create"
      ) {
        if (
          this.db.records.has(
            operation.path
          )
        ) {
          throw new Error(
            `Create conflict ${operation.path}`
          );
        }

        this.db.records.set(
          operation.path,
          operation.value
        );
      }
    }
  }
}

class FakeDb {
  constructor(
    seed = {}
  ) {
    this.records =
      new Map(
        Object.entries(
          clone(
            seed
          )
        )
      );

    this.sequence =
      0;
  }

  doc(
    path
  ) {
    return new FakeRef(
      this,
      path
    );
  }

  collection(
    name
  ) {
    return new FakeCollectionRef(
      this,
      name
    );
  }

  snapshot(
    path
  ) {
    return new FakeSnapshot(
      new FakeRef(
        this,
        path
      ),

      this.records.has(
        path
      )
        ? this.records.get(
            path
          )
        : undefined
    );
  }

  async runTransaction(
    handler
  ) {
    const transaction =
      new FakeTransaction(
        this
      );

    const result =
      await handler(
        transaction
      );

    transaction.commit();

    return result;
  }

  audits() {
    return Array
      .from(
        this.records.entries()
      )
      .filter(
        ([path]) =>
          path.startsWith(
            "audit_logs/"
          )
      )
      .map(
        ([path, value]) => ({
          path,
          value:
            clone(
              value
            )
        })
      );
  }
}

function webhook(
  overrides = {}
) {
  return {
    provider:
      "asaas",

    providerEventId:
      "provider-event-1",

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

async function expectServiceError(
  factory,
  code
) {
  let captured =
    null;

  try {
    await factory();
  }
  catch (error) {
    captured =
      error;
  }

  assert.ok(
    captured
  );

  assert.ok(
    captured instanceof
      AdminWebhooksReprocessServiceError
  );

  assert.strictEqual(
    captured.code,
    code
  );

  return captured;
}

async function main() {
  const db =
    new FakeDb({
      "payment_webhook_events/event-success":
        webhook(),

      "payment_webhook_events/event-received":
        webhook({
          status:
            "received",

          errorCode:
            null,

          processedAt:
            null
        }),

      "payment_webhook_events/event-processed":
        webhook({
          status:
            "processed",

          errorCode:
            null
        }),

      "payment_webhook_events/event-ignored":
        webhook({
          status:
            "ignored",

          processingAction:
            "ignore",

          errorCode:
            null
        }),

      "payment_webhook_events/event-failure":
        webhook({
          providerEventId:
            "provider-event-failure"
        }),

      "payment_webhook_events/event-bad-meta":
        webhook({
          reprocessCount:
            1
        })
    });

  const processorCalls =
    [];

  const service =
    createAdminWebhooksReprocessService({
      db,

      clock:
        () =>
          new Date(
            "2026-09-30T12:00:00.000Z"
          ),

      processor:
        async ({
          eventId,
          eventData
        }) => {
          processorCalls.push({
            eventId,
            status:
              eventData.status
          });

          if (
            eventId ===
            "event-failure"
          ) {
            const error =
              new Error(
                "Provider unavailable"
              );

            error.code =
              "PROVIDER_PAYMENT_UNAVAILABLE";

            throw error;
          }

          const current =
            db.records.get(
              `payment_webhook_events/${eventId}`
            );

          db.records.set(
            `payment_webhook_events/${eventId}`,
            {
              ...current,

              status:
                "processed",

              errorCode:
                null,

              processedAt:
                "2026-09-30T12:00:01.000Z"
            }
          );

          return {
            processed:
              true
          };
        }
    });

  const first =
    await service.reprocessWebhook({
      eventId:
        "event-success",

      requestId:
        "request-1",

      actorUid:
        "admin-1",

      actorRole:
        "finance_admin"
    });

  assert.deepStrictEqual(
    first,
    {
      accepted:
        true,

      idempotent:
        false,

      eventId:
        "event-success",

      requestId:
        "request-1",

      reprocessCount:
        1,

      status:
        "processed",

      outcome:
        "processed",

      errorCode:
        null
    }
  );

  assert.strictEqual(
    processorCalls.length,
    1
  );

  const stored =
    db.records.get(
      "payment_webhook_events/event-success"
    );

  assert.strictEqual(
    stored.reprocessCount,
    1
  );

  assert.strictEqual(
    stored.lastReprocessRequestId,
    "request-1"
  );

  assert.strictEqual(
    stored.lastReprocessRequestedBy,
    "admin-1"
  );

  assert.strictEqual(
    stored.status,
    "processed"
  );

  const audits =
    db.audits();

  assert.strictEqual(
    audits.length,
    1
  );

  assert.strictEqual(
    audits[0].value.eventType,
    "admin.webhook.reprocess.requested"
  );

  assert.strictEqual(
    audits[0].value.actorUid,
    "admin-1"
  );

  assert.strictEqual(
    audits[0].value.actorRole,
    "finance_admin"
  );

  assert.strictEqual(
    audits[0].value.requestId,
    "request-1"
  );

  assert.deepStrictEqual(
    audits[0].value.metadata,
    {
      schemaVersion:
        1,

      previousStatus:
        "error",

      previousErrorCode:
        "PROVIDER_PAYMENT_VALUE_MISMATCH",

      reprocessCount:
        1
    }
  );

  const replay =
    await service.reprocessWebhook({
      eventId:
        "event-success",

      requestId:
        "request-1",

      actorUid:
        "admin-1",

      actorRole:
        "finance_admin"
    });

  assert.strictEqual(
    replay.idempotent,
    true
  );

  assert.strictEqual(
    replay.outcome,
    "idempotent"
  );

  assert.strictEqual(
    processorCalls.length,
    1
  );

  assert.strictEqual(
    db.audits().length,
    1
  );

  await expectServiceError(
    () =>
      service.reprocessWebhook({
        eventId:
          "event-success",

        requestId:
          "request-2",

        actorUid:
          "admin-1",

        actorRole:
          "finance_admin"
      }),
    "ADMIN_WEBHOOK_REPROCESS_NOT_ELIGIBLE"
  );

  await expectServiceError(
    () =>
      service.reprocessWebhook({
        eventId:
          "event-received",

        requestId:
          "request-received",

        actorUid:
          "admin-1",

        actorRole:
          "finance_admin"
      }),
    "ADMIN_WEBHOOK_REPROCESS_IN_FLIGHT"
  );

  await expectServiceError(
    () =>
      service.reprocessWebhook({
        eventId:
          "event-processed",

        requestId:
          "request-processed",

        actorUid:
          "admin-1",

        actorRole:
          "finance_admin"
      }),
    "ADMIN_WEBHOOK_REPROCESS_NOT_ELIGIBLE"
  );

  await expectServiceError(
    () =>
      service.reprocessWebhook({
        eventId:
          "event-ignored",

        requestId:
          "request-ignored",

        actorUid:
          "admin-1",

        actorRole:
          "finance_admin"
      }),
    "ADMIN_WEBHOOK_REPROCESS_NOT_ELIGIBLE"
  );

  await expectServiceError(
    () =>
      service.reprocessWebhook({
        eventId:
          "missing",

        requestId:
          "request-missing",

        actorUid:
          "admin-1",

        actorRole:
          "finance_admin"
      }),
    "ADMIN_WEBHOOK_REPROCESS_NOT_FOUND"
  );

  await expectServiceError(
    () =>
      service.reprocessWebhook({
        eventId:
          "event-bad-meta",

        requestId:
          "request-bad-meta",

        actorUid:
          "admin-1",

        actorRole:
          "finance_admin"
      }),
    "ADMIN_WEBHOOK_REPROCESS_METADATA_INVALID"
  );

  await expectServiceError(
    () =>
      service.reprocessWebhook({
        eventId:
          "event-failure",

        requestId:
          "request-failure",

        actorUid:
          "admin-1",

        actorRole:
          "finance_admin"
      }),
    "ADMIN_WEBHOOK_REPROCESS_PROCESSING_FAILED"
  );

  const failedEvent =
    db.records.get(
      "payment_webhook_events/event-failure"
    );

  assert.strictEqual(
    failedEvent.status,
    "error"
  );

  assert.strictEqual(
    failedEvent.errorCode,
    "PROVIDER_PAYMENT_UNAVAILABLE"
  );

  assert.strictEqual(
    failedEvent.reprocessCount,
    1
  );

  assert.strictEqual(
    failedEvent.lastReprocessRequestId,
    "request-failure"
  );

  const failedReplay =
    await service.reprocessWebhook({
      eventId:
        "event-failure",

      requestId:
        "request-failure",

      actorUid:
        "admin-1",

      actorRole:
        "finance_admin"
    });

  assert.strictEqual(
    failedReplay.idempotent,
    true
  );

  const failedNewRequestProcessorCallsBefore =
    processorCalls.length;

  await expectServiceError(
    () =>
      service.reprocessWebhook({
        eventId:
          "event-failure",

        requestId:
          "request-failure-2",

        actorUid:
          "admin-1",

        actorRole:
          "finance_admin"
      }),
    "ADMIN_WEBHOOK_REPROCESS_PROCESSING_FAILED"
  );

  assert.strictEqual(
    processorCalls.length,
    failedNewRequestProcessorCallsBefore +
      1
  );

  console.log(
    "MARCO8_6C_CANONICAL_SOURCE=payment_webhook_events"
  );

  console.log(
    "MARCO8_6C_AUDIT_SOURCE=audit_logs"
  );

  console.log(
    "MARCO8_6C_ERROR_ONLY=True"
  );

  console.log(
    "MARCO8_6C_ERROR_TO_RECEIVED=TRANSACTIONAL"
  );

  console.log(
    "MARCO8_6C_IDEMPOTENCY=CANONICAL_EVENT_METADATA"
  );

  console.log(
    "MARCO8_6C_SAME_REQUEST_SECOND_PROCESS=False"
  );

  console.log(
    "MARCO8_6C_FAILURE_OBSERVABLE=True"
  );

  console.log(
    "MARCO8_6C_NEW_REQUEST_AFTER_FAILURE=True"
  );

  console.log(
    "MARCO8_6C_AUDIT_APPEND_ONLY=True"
  );

  console.log(
    "MARCO8_6C_REPROCESS_SERVICE=PASSED"
  );
}

main()
  .catch(
    error => {
      console.error(
        error
      );

      process.exitCode =
        1;
    }
  );
