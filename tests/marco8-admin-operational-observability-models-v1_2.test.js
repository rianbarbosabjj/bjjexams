"use strict";

const assert =
  require("assert");

const {
  OPERATIONAL_CONTRACT_VERSION,
  SECURITY_OPERATIONAL_VIEW_FIELDS,
  CONFIG_OPERATIONAL_VIEW_FIELDS,
  HEALTH_OPERATIONAL_VIEW_FIELDS,
  PROVIDER_EXTERNAL_HEALTH,
  AdminOperationalObservabilityModelError,
  buildSecurityOperationalView,
  buildConfigOperationalView,
  buildHealthOperationalView
} = require(
  "../functions/src/admin/admin-operational-observability-models"
);

function config(
  overrides = {}
) {
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
      "revision-abc123",

    adminRuntimeAllowed:
      true,

    providerEnvironmentAllowed:
      true,

    asaasApiKeyConfigured:
      true,

    asaasWebhookTokenConfigured:
      true,

    ...overrides
  };
}

function limits() {
  return {
    webhookDefaultLimit:
      20,

    webhookMaxLimit:
      25,

    webhookMaxScanDocs:
      260,

    auditDefaultLimit:
      20,

    auditMaxLimit:
      25,

    auditMaxScanDocs:
      260,

    auditMetadataMaxJsonBytes:
      2048
  };
}

function health() {
  return {
    firestoreReachable:
      true,

    webhookCounts: {
      total:
        20,

      received:
        2,

      processing:
        1,

      processed:
        14,

      ignored:
        1,

      error:
        2
    },

    reversalCounts: {
      executing:
        1,

      awaitingWebhook:
        3,

      providerRejected:
        1,

      needsReconciliation:
        2
    }
  };
}

function main() {
  assert.strictEqual(
    OPERATIONAL_CONTRACT_VERSION,
    "1.2"
  );

  assert.deepStrictEqual(
    SECURITY_OPERATIONAL_VIEW_FIELDS,
    [
      "environment",
      "region",
      "runtime",
      "gates",
      "bindings",
      "protections",
      "alerts"
    ]
  );

  assert.deepStrictEqual(
    CONFIG_OPERATIONAL_VIEW_FIELDS,
    [
      "contractVersion",
      "region",
      "environment",
      "provider",
      "limits",
      "features"
    ]
  );

  assert.deepStrictEqual(
    HEALTH_OPERATIONAL_VIEW_FIELDS,
    [
      "environment",
      "firestore",
      "runtime",
      "functions",
      "provider",
      "webhooks",
      "reconciliation",
      "incidents"
    ]
  );

  const security =
    buildSecurityOperationalView(
      config()
    );

  assert.deepStrictEqual(
    Object.keys(
      security
    ),
    SECURITY_OPERATIONAL_VIEW_FIELDS
  );

  assert.strictEqual(
    security.runtime.nodeMajor,
    22
  );

  assert.strictEqual(
    security.gates.adminRuntimeAllowed,
    true
  );

  assert.strictEqual(
    security.bindings.asaasApiKeyConfigured,
    true
  );

  assert.strictEqual(
    security.protections.secretValuesExposed,
    false
  );

  assert.strictEqual(
    security.protections.providerHealthPing,
    false
  );

  assert.deepStrictEqual(
    security.alerts,
    {
      status:
        "unsupported",

      items:
        null
    }
  );

  const operationalConfig =
    buildConfigOperationalView(
      config(),
      limits()
    );

  assert.deepStrictEqual(
    Object.keys(
      operationalConfig
    ),
    CONFIG_OPERATIONAL_VIEW_FIELDS
  );

  assert.strictEqual(
    operationalConfig.provider.externalHealth,
    PROVIDER_EXTERNAL_HEALTH
  );

  assert.deepStrictEqual(
    operationalConfig.limits,
    {
      webhooks: {
        defaultLimit:
          20,

        maxLimit:
          25,

        maxScanDocs:
          260
      },

      audit: {
        defaultLimit:
          20,

        maxLimit:
          25,

        maxScanDocs:
          260,

        metadataMaxJsonBytes:
          2048
      }
    }
  );

  assert.strictEqual(
    operationalConfig.features.configReadOnly,
    true
  );

  assert.strictEqual(
    operationalConfig.features.configMutationEnabled,
    false
  );

  const healthView =
    buildHealthOperationalView(
      config(),
      health()
    );

  assert.deepStrictEqual(
    Object.keys(
      healthView
    ),
    HEALTH_OPERATIONAL_VIEW_FIELDS
  );

  assert.strictEqual(
    healthView.firestore.reachable,
    true
  );

  assert.strictEqual(
    healthView.provider.externalHealth,
    "not_measured"
  );

  assert.strictEqual(
    healthView.webhooks.counts.error,
    2
  );

  assert.strictEqual(
    healthView.reconciliation.counts.needsReconciliation,
    2
  );

  assert.deepStrictEqual(
    healthView.incidents,
    {
      status:
        "derived",

      total:
        5,

      webhookErrors:
        2,

      reconciliationRequired:
        3
    }
  );

  const unavailable =
    buildHealthOperationalView(
      config({
        revision:
          null
      }),
      {
        firestoreReachable:
          false,

        webhookCounts:
          null,

        reversalCounts:
          null
      }
    );

  assert.strictEqual(
    unavailable.runtime.revision,
    null
  );

  assert.strictEqual(
    unavailable.webhooks.status,
    "unavailable"
  );

  assert.strictEqual(
    unavailable.reconciliation.status,
    "unavailable"
  );

  assert.strictEqual(
    unavailable.incidents.total,
    null
  );

  const serialized =
    JSON.stringify({
      security,
      operationalConfig,
      healthView
    });

  for (
    const forbidden
    of [
      "$aact_hmlg_",
      "$aact_prod_",
      "webhook-secret-value",
      "api-key-value",
      "recipientShares",
      "walletId",
      "platformFeeBps",
      "cpf",
      "password",
      "bearerToken",
      "rawPayload",
      "iamPolicy"
    ]
  ) {
    assert.strictEqual(
      serialized.includes(
        forbidden
      ),
      false,
      `Operational observability leaked ${forbidden}`
    );
  }

  assert.throws(
    () =>
      buildSecurityOperationalView(
        config({
          adminEnvironment:
            "production"
        })
      ),
    error =>
      error instanceof
        AdminOperationalObservabilityModelError &&
      error.code ===
        "ADMIN_OPERATIONAL_ENVIRONMENT_INVALID"
  );

  assert.throws(
    () =>
      buildConfigOperationalView(
        config({
          financialEnvironment:
            "production"
        }),
        limits()
      ),
    error =>
      error instanceof
        AdminOperationalObservabilityModelError &&
      error.code ===
        "ADMIN_OPERATIONAL_FINANCIAL_ENVIRONMENT_INVALID"
  );

  console.log(
    "MARCO8_6E_SECURITY_VIEW_FIELDS=7/7"
  );

  console.log(
    "MARCO8_6E_CONFIG_VIEW_FIELDS=6/6"
  );

  console.log(
    "MARCO8_6E_HEALTH_VIEW_FIELDS=8/8"
  );

  console.log(
    "MARCO8_6E_NODE_MAJOR=22"
  );

  console.log(
    "MARCO8_6E_SECRET_VALUES_EXPOSED=False"
  );

  console.log(
    "MARCO8_6E_CONFIG_MUTATION=False"
  );

  console.log(
    "MARCO8_6E_PROVIDER_HEALTH=NOT_MEASURED"
  );

  console.log(
    "MARCO8_6E_PRODUCTION_MODEL=BLOCKED"
  );

  console.log(
    "MARCO8_6E_OPERATIONAL_OBSERVABILITY_MODELS=PASSED"
  );
}

main();
