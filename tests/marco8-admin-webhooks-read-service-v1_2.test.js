"use strict";

const assert = require("assert");
const {
  WEBHOOK_EVENTS_COLLECTION,
  DEFAULT_WEBHOOKS_LIMIT,
  MAX_WEBHOOKS_LIMIT,
  WEBHOOK_CURSOR_VERSION,
  WEBHOOK_SCAN_BATCH_SIZE,
  WEBHOOK_MAX_SCAN_DOCS,
  AdminWebhooksReadError,
  readWebhooksLimit,
  normalizeWebhookFilters,
  encodeWebhookCursor,
  decodeWebhookCursor,
  createAdminWebhooksReadService
} = require("../functions/src/admin/admin-webhooks-read-service");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDocumentSnapshot {
  constructor(reference, value) {
    this.ref = reference;
    this.id = reference.id;
    this.exists = value !== undefined;
    this.value = value;
  }
  data() {
    return this.exists ? clone(this.value) : undefined;
  }
}

class FakeDocumentReference {
  constructor(db, pathValue) {
    this.db = db;
    this.path = pathValue;
    this.id = pathValue.split("/").pop();
  }
  async get() {
    this.db.readOperations.push({ kind: "doc.get", path: this.path });
    return this.db.snapshot(this.path);
  }
}

class FakeQuery {
  constructor(db, collectionName, state = {}) {
    this.db = db;
    this.collectionName = collectionName;
    this.ordering = state.ordering || [];
    this.after = state.after || null;
    this.limitValue = state.limitValue ?? null;
  }
  clone(patch = {}) {
    return new FakeQuery(this.db, this.collectionName, {
      ordering: patch.ordering ?? this.ordering,
      after: patch.after ?? this.after,
      limitValue: patch.limitValue ?? this.limitValue
    });
  }
  orderBy(field, direction = "asc") {
    return this.clone({
      ordering: [...this.ordering, { field, direction }]
    });
  }
  startAfter(receivedAt, eventId) {
    return this.clone({
      after: {
        receivedAtMillis: new Date(receivedAt).getTime(),
        eventId: String(eventId)
      }
    });
  }
  limit(value) {
    return this.clone({ limitValue: Number(value) });
  }
  async get() {
    this.db.readOperations.push({
      kind: "query.get",
      collection: this.collectionName,
      ordering: this.ordering.map(item => ({
        field: String(item.field),
        direction: item.direction
      })),
      after: this.after ? { ...this.after } : null,
      limit: this.limitValue
    });

    let entries = this.db.entriesForCollection(this.collectionName)
      .sort((left, right) => {
        const leftMillis = new Date(left.value.receivedAt).getTime();
        const rightMillis = new Date(right.value.receivedAt).getTime();
        if (leftMillis !== rightMillis) return rightMillis - leftMillis;
        return right.id.localeCompare(left.id);
      });

    if (this.after) {
      entries = entries.filter(entry => {
        const millis = new Date(entry.value.receivedAt).getTime();
        if (millis < this.after.receivedAtMillis) return true;
        if (millis > this.after.receivedAtMillis) return false;
        return entry.id.localeCompare(this.after.eventId) < 0;
      });
    }

    if (Number.isSafeInteger(this.limitValue)) {
      entries = entries.slice(0, this.limitValue);
    }

    return {
      docs: entries.map(entry =>
        this.db.snapshot(`${this.collectionName}/${entry.id}`)
      )
    };
  }
}

class FakeDb {
  constructor(seed = {}) {
    this.records = new Map(Object.entries(clone(seed)));
    this.readOperations = [];
    this.writeOperations = [];
  }
  doc(pathValue) {
    return new FakeDocumentReference(this, pathValue);
  }
  collection(name) {
    return new FakeQuery(this, name);
  }
  snapshot(pathValue) {
    const value = this.records.has(pathValue)
      ? this.records.get(pathValue)
      : undefined;
    return new FakeDocumentSnapshot(
      new FakeDocumentReference(this, pathValue),
      value
    );
  }
  entriesForCollection(name) {
    const prefix = `${name}/`;
    return Array.from(this.records.entries())
      .filter(([pathValue]) =>
        pathValue.startsWith(prefix) &&
        !pathValue.slice(prefix.length).includes("/")
      )
      .map(([pathValue, value]) => ({
        id: pathValue.slice(prefix.length),
        value: clone(value)
      }));
  }
}

function webhook({
  providerEventId,
  eventType,
  status,
  orderId,
  receivedAt,
  processingAction,
  errorCode = null,
  deliveryCount = 1
}) {
  return {
    provider: "asaas",
    providerEventId,
    eventType,
    status,
    orderId,
    transactionId: "transaction-secret",
    providerPaymentId: "provider-payment-secret",
    providerCustomerId: "provider-customer-secret",
    externalReference: "external-reference-secret",
    billingType: "PIX",
    valueCents: 10000,
    processingAction,
    processingReason: "test",
    deliveryCount,
    receivedAt,
    firstReceivedAt: receivedAt,
    lastReceivedAt: receivedAt,
    processedAt: ["processed", "ignored", "error"].includes(status)
      ? receivedAt
      : null,
    errorCode
  };
}

function seed() {
  return {
    "payment_webhook_events/event-c": webhook({
      providerEventId: "evt-c",
      eventType: "PAYMENT_CONFIRMED",
      status: "processed",
      orderId: "order-c",
      receivedAt: "2026-09-30T10:03:00.000Z",
      processingAction: "confirm_payment",
      deliveryCount: 3
    }),
    "payment_webhook_events/event-b": webhook({
      providerEventId: "evt-b",
      eventType: "PAYMENT_REFUNDED",
      status: "error",
      orderId: "order-b",
      receivedAt: "2026-09-30T10:02:00.000Z",
      processingAction: "reconcile_reversal",
      errorCode: "REVERSAL_RECONCILIATION_REQUIRED"
    }),
    "payment_webhook_events/event-a": webhook({
      providerEventId: "evt-a",
      eventType: "PAYMENT_CREATED",
      status: "ignored",
      orderId: null,
      receivedAt: "2026-09-30T10:01:00.000Z",
      processingAction: "ignore"
    })
  };
}

async function main() {
  assert.strictEqual(WEBHOOK_EVENTS_COLLECTION, "payment_webhook_events");
  assert.strictEqual(DEFAULT_WEBHOOKS_LIMIT, 20);
  assert.strictEqual(MAX_WEBHOOKS_LIMIT, 25);
  assert.strictEqual(WEBHOOK_CURSOR_VERSION, 1);
  assert.strictEqual(WEBHOOK_SCAN_BATCH_SIZE, 26);
  assert.strictEqual(WEBHOOK_MAX_SCAN_DOCS, 260);
  assert.strictEqual(readWebhooksLimit(), 20);
  assert.strictEqual(readWebhooksLimit(25), 25);
  assert.throws(
    () => readWebhooksLimit(26),
    error => error instanceof AdminWebhooksReadError &&
      error.code === "ADMIN_WEBHOOKS_LIMIT_INVALID"
  );

  assert.deepStrictEqual(
    normalizeWebhookFilters({
      status: " ERROR ",
      eventType: " payment_refunded ",
      orderId: " order-b "
    }),
    {
      status: "error",
      eventType: "PAYMENT_REFUNDED",
      orderId: "order-b"
    }
  );

  const cursor = encodeWebhookCursor({
    eventId: "event-c",
    receivedAt: "2026-09-30T10:03:00.000Z"
  });
  assert.deepStrictEqual(decodeWebhookCursor(cursor), {
    receivedAtMillis: Date.parse("2026-09-30T10:03:00.000Z"),
    eventId: "event-c"
  });
  assert.throws(
    () => decodeWebhookCursor("not-a-valid-cursor"),
    error => error instanceof AdminWebhooksReadError &&
      error.code === "ADMIN_WEBHOOKS_CURSOR_INVALID"
  );

  const db = new FakeDb(seed());
  const service = createAdminWebhooksReadService({
    db,
    documentIdField: "__name__"
  });

  const firstPage = await service.listWebhooks({ limit: 1 });
  assert.strictEqual(firstPage.items.length, 1);
  assert.strictEqual(firstPage.items[0].eventId, "event-c");
  assert.ok(firstPage.nextCursor);

  const secondPage = await service.listWebhooks({
    limit: 1,
    cursor: firstPage.nextCursor
  });
  assert.strictEqual(secondPage.items.length, 1);
  assert.strictEqual(secondPage.items[0].eventId, "event-b");
  assert.ok(secondPage.nextCursor);

  const thirdPage = await service.listWebhooks({
    limit: 1,
    cursor: secondPage.nextCursor
  });
  assert.strictEqual(thirdPage.items.length, 1);
  assert.strictEqual(thirdPage.items[0].eventId, "event-a");
  assert.strictEqual(thirdPage.nextCursor, null);

  const filtered = await service.listWebhooks({
    status: "error",
    eventType: "payment_refunded",
    orderId: "order-b"
  });
  assert.deepStrictEqual(
    filtered.items.map(item => item.eventId),
    ["event-b"]
  );

  const detail = await service.getWebhook({ eventId: "event-b" });
  assert.strictEqual(detail.eventId, "event-b");
  assert.deepStrictEqual(detail.processing, {
    action: "reconcile_reversal",
    result: "error",
    errorCode: "REVERSAL_RECONCILIATION_REQUIRED"
  });

  const serialized = JSON.stringify({
    firstPage,
    secondPage,
    thirdPage,
    filtered,
    detail
  });
  for (const forbidden of [
    "providerPaymentId", "providerCustomerId", "externalReference",
    "billingType", "valueCents", "transactionId", "provider-payment-secret",
    "provider-customer-secret", "external-reference-secret"
  ]) {
    assert.strictEqual(
      serialized.includes(forbidden),
      false,
      `Webhook read service leaked ${forbidden}`
    );
  }

  assert.strictEqual(db.writeOperations.length, 0);
  assert.ok(db.readOperations.every(operation =>
    operation.kind === "doc.get" ||
    (operation.kind === "query.get" &&
      operation.collection === "payment_webhook_events")
  ));

  await assert.rejects(
    () => service.getWebhook({ eventId: "missing" }),
    error => error instanceof AdminWebhooksReadError &&
      error.code === "ADMIN_WEBHOOK_NOT_FOUND"
  );

  const invalidDb = new FakeDb({
    "payment_webhook_events/broken": webhook({
      providerEventId: "evt-broken",
      eventType: "PAYMENT_CONFIRMED",
      status: "mystery",
      orderId: "order-broken",
      receivedAt: "2026-09-30T11:00:00.000Z",
      processingAction: "confirm_payment"
    })
  });

  const invalidService = createAdminWebhooksReadService({
    db: invalidDb,
    documentIdField: "__name__"
  });

  await assert.rejects(
    () => invalidService.listWebhooks(),
    error => error instanceof AdminWebhooksReadError &&
      error.code === "ADMIN_WEBHOOKS_CANONICAL_STATE_INVALID"
  );

  console.log("MARCO8_6B_WEBHOOK_COLLECTION=payment_webhook_events");
  console.log("MARCO8_6B_WEBHOOK_LIMITS=PASSED");
  console.log("MARCO8_6B_WEBHOOK_FILTERS=PASSED");
  console.log("MARCO8_6B_WEBHOOK_CURSOR=PASSED");
  console.log("MARCO8_6B_WEBHOOK_ORDERING=RECEIVED_AT_DESC_ID_DESC");
  console.log("MARCO8_6B_BOUNDED_SCAN=PASSED");
  console.log("MARCO8_6B_DETAIL_LOOKUP=PASSED");
  console.log("MARCO8_6B_CANONICAL_FAIL_CLOSED=PASSED");
  console.log("MARCO8_6B_SENSITIVE_FIELDS_EXPOSURE=False");
  console.log("MARCO8_6B_FIRESTORE_WRITES=False");
  console.log("MARCO8_6B_PROVIDER_DEPENDENCY=False");
  console.log("MARCO8_6B_ADMIN_WEBHOOKS_READ_SERVICE=PASSED");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
