"use strict";

const OPERATIONAL_CONTRACT_VERSION =
  "1.2";

const SECURITY_OPERATIONAL_VIEW_FIELDS =
  Object.freeze([
    "environment",
    "region",
    "runtime",
    "gates",
    "bindings",
    "protections",
    "alerts"
  ]);

const CONFIG_OPERATIONAL_VIEW_FIELDS =
  Object.freeze([
    "contractVersion",
    "region",
    "environment",
    "provider",
    "limits",
    "features"
  ]);

const HEALTH_OPERATIONAL_VIEW_FIELDS =
  Object.freeze([
    "environment",
    "firestore",
    "runtime",
    "functions",
    "provider",
    "webhooks",
    "reconciliation",
    "incidents"
  ]);

const OPERATIONAL_PROVIDER =
  "asaas";

const PROVIDER_EXTERNAL_HEALTH =
  "not_measured";

class AdminOperationalObservabilityModelError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminOperationalObservabilityModelError";

    this.code =
      code;
  }
}

function requiredText(
  value,
  field,
  maxLength = 160
) {
  const normalized =
    typeof value ===
      "string"
      ? value.trim()
      : "";

  if (
    !normalized ||
    normalized.length >
      maxLength
  ) {
    throw new AdminOperationalObservabilityModelError(
      "ADMIN_OPERATIONAL_OBSERVABILITY_INPUT_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function normalizeAdminEnvironment(
  value
) {
  const normalized =
    requiredText(
      value,
      "adminEnvironment",
      40
    )
      .toLowerCase();

  if (
    ![
      "staging",
      "demo-emulator"
    ].includes(
      normalized
    )
  ) {
    throw new AdminOperationalObservabilityModelError(
      "ADMIN_OPERATIONAL_ENVIRONMENT_INVALID",
      "Administrative environment is invalid."
    );
  }

  return normalized;
}

function normalizeFinancialEnvironment(
  value
) {
  const normalized =
    requiredText(
      value,
      "financialEnvironment",
      40
    )
      .toLowerCase();

  if (
    normalized !==
      "sandbox"
  ) {
    throw new AdminOperationalObservabilityModelError(
      "ADMIN_OPERATIONAL_FINANCIAL_ENVIRONMENT_INVALID",
      "Administrative observability requires sandbox financial environment."
    );
  }

  return normalized;
}

function normalizeRegion(
  value
) {
  const normalized =
    requiredText(
      value,
      "region",
      80
    );

  if (
    !/^[a-z0-9-]+$/.test(
      normalized
    )
  ) {
    throw new AdminOperationalObservabilityModelError(
      "ADMIN_OPERATIONAL_REGION_INVALID",
      "Function region is invalid."
    );
  }

  return normalized;
}

function normalizeNodeMajor(
  value
) {
  const source =
    requiredText(
      value,
      "nodeVersion",
      80
    );

  const major =
    Number(
      source.split(
        "."
      )[0]
    );

  if (
    !Number.isSafeInteger(
      major
    ) ||
    major < 1 ||
    major > 1000
  ) {
    throw new AdminOperationalObservabilityModelError(
      "ADMIN_OPERATIONAL_NODE_VERSION_INVALID",
      "Node runtime version is invalid."
    );
  }

  return major;
}

function normalizeRevision(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const normalized =
    String(
      value
    )
      .trim();

  if (
    !normalized ||
    normalized.length >
      160 ||
    !/^[A-Za-z0-9._-]+$/.test(
      normalized
    )
  ) {
    return null;
  }

  return normalized;
}

function requireBoolean(
  value,
  field
) {
  if (
    typeof value !==
      "boolean"
  ) {
    throw new AdminOperationalObservabilityModelError(
      "ADMIN_OPERATIONAL_BOOLEAN_INVALID",
      `${field} must be boolean.`
    );
  }

  return value;
}

function safeCount(
  value,
  field
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number =
    Number(value);

  if (
    !Number.isSafeInteger(
      number
    ) ||
    number < 0
  ) {
    throw new AdminOperationalObservabilityModelError(
      "ADMIN_OPERATIONAL_COUNT_INVALID",
      `${field} is invalid.`
    );
  }

  return number;
}

function normalizeOperationalRuntimeConfig(
  input = {}
) {
  const contractVersion =
    input.contractVersion ===
      undefined ||
    input.contractVersion ===
      null
      ? OPERATIONAL_CONTRACT_VERSION
      : requiredText(
          input.contractVersion,
          "contractVersion",
          20
        );

  if (
    contractVersion !==
      OPERATIONAL_CONTRACT_VERSION
  ) {
    throw new AdminOperationalObservabilityModelError(
      "ADMIN_OPERATIONAL_CONTRACT_INVALID",
      "Operational contract version is invalid."
    );
  }

  const adminEnvironment =
    normalizeAdminEnvironment(
      input.adminEnvironment
    );

  const financialEnvironment =
    normalizeFinancialEnvironment(
      input.financialEnvironment
    );

  const region =
    normalizeRegion(
      input.region
    );

  const nodeMajor =
    normalizeNodeMajor(
      input.nodeVersion
    );

  const revision =
    normalizeRevision(
      input.revision
    );

  const adminRuntimeAllowed =
    requireBoolean(
      input.adminRuntimeAllowed,
      "adminRuntimeAllowed"
    );

  const providerEnvironmentAllowed =
    requireBoolean(
      input.providerEnvironmentAllowed,
      "providerEnvironmentAllowed"
    );

  const asaasApiKeyConfigured =
    requireBoolean(
      input.asaasApiKeyConfigured,
      "asaasApiKeyConfigured"
    );

  const asaasWebhookTokenConfigured =
    requireBoolean(
      input.asaasWebhookTokenConfigured,
      "asaasWebhookTokenConfigured"
    );

  if (
    adminRuntimeAllowed !==
      true
  ) {
    throw new AdminOperationalObservabilityModelError(
      "ADMIN_OPERATIONAL_RUNTIME_GATE_INVALID",
      "Administrative observability cannot be composed when admin runtime is disabled."
    );
  }

  return Object.freeze({
    contractVersion,
    adminEnvironment,
    financialEnvironment,
    region,
    nodeMajor,
    revision,
    adminRuntimeAllowed,
    providerEnvironmentAllowed,
    asaasApiKeyConfigured,
    asaasWebhookTokenConfigured
  });
}

function buildSecurityOperationalView(
  configInput = {}
) {
  const config =
    normalizeOperationalRuntimeConfig(
      configInput
    );

  return Object.freeze({
    environment:
      Object.freeze({
        admin:
          config.adminEnvironment,

        financial:
          config.financialEnvironment
      }),

    region:
      config.region,

    runtime:
      Object.freeze({
        nodeMajor:
          config.nodeMajor,

        revision:
          config.revision
      }),

    gates:
      Object.freeze({
        adminRuntimeAllowed:
          config.adminRuntimeAllowed,

        providerEnvironmentAllowed:
          config.providerEnvironmentAllowed
      }),

    bindings:
      Object.freeze({
        asaasApiKeyConfigured:
          config.asaasApiKeyConfigured,

        asaasWebhookTokenConfigured:
          config.asaasWebhookTokenConfigured
      }),

    protections:
      Object.freeze({
        productionAdminExportBlocked:
          true,

        directBrowserAdminCollectionsBlocked:
          true,

        secretValuesExposed:
          false,

        providerHealthPing:
          false
      }),

    alerts:
      Object.freeze({
        status:
          "unsupported",

        items:
          null
      })
  });
}

function buildConfigOperationalView(
  configInput = {},
  limitsInput = {}
) {
  const config =
    normalizeOperationalRuntimeConfig(
      configInput
    );

  const webhookDefaultLimit =
    safeCount(
      limitsInput.webhookDefaultLimit,
      "webhookDefaultLimit"
    );

  const webhookMaxLimit =
    safeCount(
      limitsInput.webhookMaxLimit,
      "webhookMaxLimit"
    );

  const webhookMaxScanDocs =
    safeCount(
      limitsInput.webhookMaxScanDocs,
      "webhookMaxScanDocs"
    );

  const auditDefaultLimit =
    safeCount(
      limitsInput.auditDefaultLimit,
      "auditDefaultLimit"
    );

  const auditMaxLimit =
    safeCount(
      limitsInput.auditMaxLimit,
      "auditMaxLimit"
    );

  const auditMaxScanDocs =
    safeCount(
      limitsInput.auditMaxScanDocs,
      "auditMaxScanDocs"
    );

  const auditMetadataMaxJsonBytes =
    safeCount(
      limitsInput.auditMetadataMaxJsonBytes,
      "auditMetadataMaxJsonBytes"
    );

  for (
    const [
      field,
      value
    ]
    of Object.entries({
      webhookDefaultLimit,
      webhookMaxLimit,
      webhookMaxScanDocs,
      auditDefaultLimit,
      auditMaxLimit,
      auditMaxScanDocs,
      auditMetadataMaxJsonBytes
    })
  ) {
    if (
      value ===
      null
    ) {
      throw new AdminOperationalObservabilityModelError(
        "ADMIN_OPERATIONAL_LIMITS_INVALID",
        `${field} is required.`
      );
    }
  }

  return Object.freeze({
    contractVersion:
      config.contractVersion,

    region:
      config.region,

    environment:
      Object.freeze({
        admin:
          config.adminEnvironment,

        financial:
          config.financialEnvironment
      }),

    provider:
      Object.freeze({
        name:
          OPERATIONAL_PROVIDER,

        allowedByEnvironment:
          config.providerEnvironmentAllowed,

        externalHealth:
          PROVIDER_EXTERNAL_HEALTH
      }),

    limits:
      Object.freeze({
        webhooks:
          Object.freeze({
            defaultLimit:
              webhookDefaultLimit,

            maxLimit:
              webhookMaxLimit,

            maxScanDocs:
              webhookMaxScanDocs
          }),

        audit:
          Object.freeze({
            defaultLimit:
              auditDefaultLimit,

            maxLimit:
              auditMaxLimit,

            maxScanDocs:
              auditMaxScanDocs,

            metadataMaxJsonBytes:
              auditMetadataMaxJsonBytes
          })
      }),

    features:
      Object.freeze({
        configReadOnly:
          true,

        configMutationEnabled:
          false,

        providerHealthPing:
          false,

        productionAdminExport:
          false
      })
  });
}

function buildHealthOperationalView(
  configInput = {},
  healthInput = {}
) {
  const config =
    normalizeOperationalRuntimeConfig(
      configInput
    );

  const firestoreReachable =
    requireBoolean(
      healthInput.firestoreReachable,
      "firestoreReachable"
    );

  const webhookCounts =
    healthInput.webhookCounts &&
    typeof healthInput.webhookCounts ===
      "object" &&
    !Array.isArray(
      healthInput.webhookCounts
    )
      ? healthInput.webhookCounts
      : null;

  const reversalCounts =
    healthInput.reversalCounts &&
    typeof healthInput.reversalCounts ===
      "object" &&
    !Array.isArray(
      healthInput.reversalCounts
    )
      ? healthInput.reversalCounts
      : null;

  const countsAvailable =
    firestoreReachable &&
    webhookCounts !==
      null &&
    reversalCounts !==
      null;

  let normalizedWebhooks =
    null;

  let normalizedReversals =
    null;

  let incidents =
    null;

  if (
    countsAvailable
  ) {
    normalizedWebhooks =
      Object.freeze({
        total:
          safeCount(
            webhookCounts.total,
            "webhooks.total"
          ),

        received:
          safeCount(
            webhookCounts.received,
            "webhooks.received"
          ),

        processing:
          safeCount(
            webhookCounts.processing,
            "webhooks.processing"
          ),

        processed:
          safeCount(
            webhookCounts.processed,
            "webhooks.processed"
          ),

        ignored:
          safeCount(
            webhookCounts.ignored,
            "webhooks.ignored"
          ),

        error:
          safeCount(
            webhookCounts.error,
            "webhooks.error"
          )
      });

    normalizedReversals =
      Object.freeze({
        executing:
          safeCount(
            reversalCounts.executing,
            "reconciliation.executing"
          ),

        awaitingWebhook:
          safeCount(
            reversalCounts.awaitingWebhook,
            "reconciliation.awaitingWebhook"
          ),

        providerRejected:
          safeCount(
            reversalCounts.providerRejected,
            "reconciliation.providerRejected"
          ),

        needsReconciliation:
          safeCount(
            reversalCounts.needsReconciliation,
            "reconciliation.needsReconciliation"
          )
      });

    for (
      const [
        field,
        value
      ]
      of Object.entries({
        ...normalizedWebhooks,
        ...normalizedReversals
      })
    ) {
      if (
        value ===
        null
      ) {
        throw new AdminOperationalObservabilityModelError(
          "ADMIN_OPERATIONAL_HEALTH_INVALID",
          `${field} is required when health counts are available.`
        );
      }
    }

    const reconciliationRequired =
      normalizedReversals
        .providerRejected +
      normalizedReversals
        .needsReconciliation;

    const totalIncidents =
      normalizedWebhooks.error +
      reconciliationRequired;

    incidents =
      Object.freeze({
        status:
          "derived",

        total:
          totalIncidents,

        webhookErrors:
          normalizedWebhooks.error,

        reconciliationRequired
      });
  }

  return Object.freeze({
    environment:
      Object.freeze({
        admin:
          config.adminEnvironment,

        financial:
          config.financialEnvironment
      }),

    firestore:
      Object.freeze({
        reachable:
          firestoreReachable,

        queryMode:
          "aggregate_count"
      }),

    runtime:
      Object.freeze({
        nodeMajor:
          config.nodeMajor,

        revision:
          config.revision
      }),

    functions:
      Object.freeze({
        adminRuntimeAllowed:
          config.adminRuntimeAllowed,

        security:
          "enabled",

        config:
          "enabled",

        health:
          "enabled"
      }),

    provider:
      Object.freeze({
        name:
          OPERATIONAL_PROVIDER,

        allowedByEnvironment:
          config.providerEnvironmentAllowed,

        externalHealth:
          PROVIDER_EXTERNAL_HEALTH
      }),

    webhooks:
      Object.freeze({
        status:
          countsAvailable
            ? "available"
            : "unavailable",

        counts:
          normalizedWebhooks
      }),

    reconciliation:
      Object.freeze({
        status:
          countsAvailable
            ? "available"
            : "unavailable",

        counts:
          normalizedReversals
      }),

    incidents:
      incidents ||
      Object.freeze({
        status:
          "unavailable",

        total:
          null,

        webhookErrors:
          null,

        reconciliationRequired:
          null
      })
  });
}

module.exports = {
  OPERATIONAL_CONTRACT_VERSION,

  SECURITY_OPERATIONAL_VIEW_FIELDS,
  CONFIG_OPERATIONAL_VIEW_FIELDS,
  HEALTH_OPERATIONAL_VIEW_FIELDS,

  OPERATIONAL_PROVIDER,
  PROVIDER_EXTERNAL_HEALTH,

  AdminOperationalObservabilityModelError,

  requiredText,
  normalizeAdminEnvironment,
  normalizeFinancialEnvironment,
  normalizeRegion,
  normalizeNodeMajor,
  normalizeRevision,
  requireBoolean,
  safeCount,

  normalizeOperationalRuntimeConfig,
  buildSecurityOperationalView,
  buildConfigOperationalView,
  buildHealthOperationalView
};
