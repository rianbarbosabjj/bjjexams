"use strict";

const assert =
  require("assert");

const {
  WEBHOOK_HEALTH_STATUSES,
  REVERSAL_HEALTH_STATUSES,
  createAdminOperationalObservabilityService
} = require(
  "../functions/src/admin/admin-operational-observability-service"
);

class FakeAggregateSnapshot {
  constructor(
    count
  ) {
    this.countValue =
      count;
  }

  data() {
    return {
      count:
        this.countValue
    };
  }
}

class FakeAggregateQuery {
  constructor(
    db,
    descriptor
  ) {
    this.db =
      db;

    this.descriptor =
      descriptor;
  }

  async get() {
    this.db.readOperations
      .push({
        kind:
          "aggregate_count",

        collection:
          this.descriptor.collection,

        field:
          this.descriptor.field,

        operator:
          this.descriptor.operator,

        value:
          this.descriptor.value
      });

    if (
      this.db.failAggregates
    ) {
      throw new Error(
        "simulated-firestore-error-secret"
      );
    }

    const count =
      this.db.resolveCount(
        this.descriptor
      );

    return new FakeAggregateSnapshot(
      count
    );
  }
}

class FakeQuery {
  constructor(
    db,
    collection,
    filter = null
  ) {
    this.db =
      db;

    this.collectionName =
      collection;

    this.filter =
      filter;
  }

  where(
    field,
    operator,
    value
  ) {
    return new FakeQuery(
      this.db,
      this.collectionName,
      {
        field,
        operator,
        value
      }
    );
  }

  count() {
    return new FakeAggregateQuery(
      this.db,
      {
        collection:
          this.collectionName,

        field:
          this.filter?.field ||
          null,

        operator:
          this.filter?.operator ||
          null,

        value:
          this.filter?.value ||
          null
      }
    );
  }
}

class FakeDb {
  constructor(
    counts,
    {
      failAggregates =
        false
    } = {}
  ) {
    this.counts =
      counts;

    this.failAggregates =
      failAggregates;

    this.readOperations =
      [];

    this.writeOperations =
      [];

    this.providerCalls =
      [];
  }

  collection(
    name
  ) {
    return new FakeQuery(
      this,
      name
    );
  }

  resolveCount(
    descriptor
  ) {
    if (
      descriptor.collection ===
        "payment_webhook_events"
    ) {
      if (
        descriptor.field ===
          null
      ) {
        return this.counts
          .webhooks
          .total;
      }

      return this.counts
        .webhooks[
          descriptor.value
        ] ??
        0;
    }

    if (
      descriptor.collection ===
        "financial_reversal_requests"
    ) {
      return this.counts
        .reversals[
          descriptor.value
        ] ??
        0;
    }

    throw new Error(
      `Unexpected collection ${descriptor.collection}`
    );
  }
}

function config() {
  return {
    contractVersion:
      "1.2",

    adminEnvironment:
      "staging",

    financialEnvironment:
      "sandbox",

    region:
      "southamerica-east1",

    nodeVersion:
      "22.23.2",

    revision:
      "revision-service",

    adminRuntimeAllowed:
      true,

    providerEnvironmentAllowed:
      true,

    asaasApiKeyConfigured:
      true,

    asaasWebhookTokenConfigured:
      true
  };
}

async function main() {
  assert.deepStrictEqual(
    WEBHOOK_HEALTH_STATUSES,
    [
      "received",
      "processing",
      "processed",
      "ignored",
      "error"
    ]
  );

  assert.deepStrictEqual(
    REVERSAL_HEALTH_STATUSES,
    [
      "executing",
      "awaiting_webhook",
      "provider_rejected",
      "needs_reconciliation"
    ]
  );

  const db =
    new FakeDb({
      webhooks: {
        total:
          30,

        received:
          2,

        processing:
          1,

        processed:
          23,

        ignored:
          1,

        error:
          3
      },

      reversals: {
        executing:
          1,

        awaiting_webhook:
          2,

        provider_rejected:
          1,

        needs_reconciliation:
          2
      }
    });

  const service =
    createAdminOperationalObservabilityService({
      db,
      config:
        config()
    });

  const security =
    service.getSecurityView();

  const operationalConfig =
    service.getConfigView();

  const health =
    await service.getHealthView();

  assert.strictEqual(
    security.environment.admin,
    "staging"
  );

  assert.strictEqual(
    operationalConfig.limits.webhooks.maxLimit,
    25
  );

  assert.strictEqual(
    operationalConfig.limits.audit.maxLimit,
    25
  );

  assert.strictEqual(
    operationalConfig.limits.audit.metadataMaxJsonBytes,
    2048
  );

  assert.strictEqual(
    health.firestore.reachable,
    true
  );

  assert.deepStrictEqual(
    health.webhooks.counts,
    {
      total:
        30,

      received:
        2,

      processing:
        1,

      processed:
        23,

      ignored:
        1,

      error:
        3
    }
  );

  assert.deepStrictEqual(
    health.reconciliation.counts,
    {
      executing:
        1,

      awaitingWebhook:
        2,

      providerRejected:
        1,

      needsReconciliation:
        2
    }
  );

  assert.deepStrictEqual(
    health.incidents,
    {
      status:
        "derived",

      total:
        6,

      webhookErrors:
        3,

      reconciliationRequired:
        3
    }
  );

  assert.strictEqual(
    db.readOperations.length,
    10
  );

  assert.ok(
    db.readOperations.every(
      operation =>
        operation.kind ===
          "aggregate_count"
    )
  );

  assert.strictEqual(
    db.writeOperations.length,
    0
  );

  assert.strictEqual(
    db.providerCalls.length,
    0
  );

  const collections =
    new Set(
      db.readOperations.map(
        operation =>
          operation.collection
      )
    );

  assert.deepStrictEqual(
    [
      ...collections
    ].sort(),
    [
      "financial_reversal_requests",
      "payment_webhook_events"
    ]
  );

  const failedDb =
    new FakeDb(
      {
        webhooks: {
          total:
            0
        },

        reversals: {}
      },
      {
        failAggregates:
          true
      }
    );

  const failedService =
    createAdminOperationalObservabilityService({
      db:
        failedDb,

      config:
        config()
    });

  const degraded =
    await failedService
      .getHealthView();

  assert.strictEqual(
    degraded.firestore.reachable,
    false
  );

  assert.strictEqual(
    degraded.webhooks.counts,
    null
  );

  assert.strictEqual(
    degraded.reconciliation.counts,
    null
  );

  assert.strictEqual(
    degraded.incidents.total,
    null
  );

  const serialized =
    JSON.stringify(
      degraded
    );

  assert.strictEqual(
    serialized.includes(
      "simulated-firestore-error-secret"
    ),
    false
  );

  console.log(
    "MARCO8_6E_HEALTH_COLLECTIONS=2/2"
  );

  console.log(
    "MARCO8_6E_HEALTH_AGGREGATES=10/10"
  );

  console.log(
    "MARCO8_6E_FIRESTORE_FAILURE=SANITIZED_DEGRADED"
  );

  console.log(
    "MARCO8_6E_FIRESTORE_WRITES=False"
  );

  console.log(
    "MARCO8_6E_PROVIDER_CALLS=False"
  );

  console.log(
    "MARCO8_6E_FINANCIAL_CONFIG_DUPLICATION=False"
  );

  console.log(
    "MARCO8_6E_OPERATIONAL_OBSERVABILITY_SERVICE=PASSED"
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
