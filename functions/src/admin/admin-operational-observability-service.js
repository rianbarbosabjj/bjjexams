"use strict";

const {
  WEBHOOK_EVENTS_COLLECTION,
  DEFAULT_WEBHOOKS_LIMIT,
  MAX_WEBHOOKS_LIMIT,
  WEBHOOK_MAX_SCAN_DOCS
} = require(
  "./admin-webhooks-read-service"
);

const {
  AUDIT_LOGS_COLLECTION,
  DEFAULT_AUDIT_LIMIT,
  MAX_AUDIT_LIMIT,
  AUDIT_MAX_SCAN_DOCS
} = require(
  "./admin-audit-read-service"
);

const {
  AUDIT_METADATA_MAX_JSON_BYTES
} = require(
  "./admin-audit-models"
);

const {
  REVERSAL_REQUESTS_COLLECTION
} = require(
  "../finance/financial-reversal-admin-service"
);

const {
  AdminOperationalObservabilityModelError,
  normalizeOperationalRuntimeConfig,
  buildSecurityOperationalView,
  buildConfigOperationalView,
  buildHealthOperationalView
} = require(
  "./admin-operational-observability-models"
);

const WEBHOOK_HEALTH_STATUSES =
  Object.freeze([
    "received",
    "processing",
    "processed",
    "ignored",
    "error"
  ]);

const REVERSAL_HEALTH_STATUSES =
  Object.freeze([
    "executing",
    "awaiting_webhook",
    "provider_rejected",
    "needs_reconciliation"
  ]);

class AdminOperationalObservabilityServiceError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminOperationalObservabilityServiceError";

    this.code =
      code;
  }
}

function requireAggregateCount(
  snapshot,
  field
) {
  const data =
    snapshot &&
    typeof snapshot.data ===
      "function"
      ? snapshot.data()
      : null;

  const count =
    Number(
      data?.count
    );

  if (
    !Number.isSafeInteger(
      count
    ) ||
    count < 0
  ) {
    throw new AdminOperationalObservabilityServiceError(
      "ADMIN_OPERATIONAL_HEALTH_AGGREGATE_INVALID",
      `${field} aggregate count is invalid.`
    );
  }

  return count;
}

async function aggregateCount(
  query,
  field
) {
  if (
    !query ||
    typeof query.count !==
      "function"
  ) {
    throw new AdminOperationalObservabilityServiceError(
      "ADMIN_OPERATIONAL_HEALTH_AGGREGATE_UNAVAILABLE",
      `${field} aggregate query is unavailable.`
    );
  }

  const aggregate =
    query.count();

  if (
    !aggregate ||
    typeof aggregate.get !==
      "function"
  ) {
    throw new AdminOperationalObservabilityServiceError(
      "ADMIN_OPERATIONAL_HEALTH_AGGREGATE_UNAVAILABLE",
      `${field} aggregate query is unavailable.`
    );
  }

  const snapshot =
    await aggregate.get();

  return requireAggregateCount(
    snapshot,
    field
  );
}

function createAdminOperationalObservabilityService(
  dependencies = {}
) {
  const {
    db,
    config
  } = dependencies;

  if (
    !db ||
    typeof db.collection !==
      "function"
  ) {
    throw new TypeError(
      "Operational observability service requires Firestore."
    );
  }

  let runtimeConfig;

  try {
    const normalized =
      normalizeOperationalRuntimeConfig(
        config
      );

    // Keep only safe canonical runtime facts while preserving the
    // input shape expected by the read-model builders. Builders consume
    // nodeVersion and derive nodeMajor themselves.
    runtimeConfig =
      Object.freeze({
        contractVersion:
          normalized.contractVersion,

        adminEnvironment:
          normalized.adminEnvironment,

        financialEnvironment:
          normalized.financialEnvironment,

        region:
          normalized.region,

        nodeVersion:
          String(
            normalized.nodeMajor
          ),

        revision:
          normalized.revision,

        adminRuntimeAllowed:
          normalized.adminRuntimeAllowed,

        providerEnvironmentAllowed:
          normalized.providerEnvironmentAllowed,

        asaasApiKeyConfigured:
          normalized.asaasApiKeyConfigured,

        asaasWebhookTokenConfigured:
          normalized.asaasWebhookTokenConfigured
      });
  }
  catch (
    error
  ) {
    if (
      error instanceof
      AdminOperationalObservabilityModelError
    ) {
      throw new AdminOperationalObservabilityServiceError(
        error.code,
        error.message
      );
    }

    throw error;
  }

  const limits =
    Object.freeze({
      webhookDefaultLimit:
        DEFAULT_WEBHOOKS_LIMIT,

      webhookMaxLimit:
        MAX_WEBHOOKS_LIMIT,

      webhookMaxScanDocs:
        WEBHOOK_MAX_SCAN_DOCS,

      auditDefaultLimit:
        DEFAULT_AUDIT_LIMIT,

      auditMaxLimit:
        MAX_AUDIT_LIMIT,

      auditMaxScanDocs:
        AUDIT_MAX_SCAN_DOCS,

      auditMetadataMaxJsonBytes:
        AUDIT_METADATA_MAX_JSON_BYTES
    });

  function getSecurityView() {
    return buildSecurityOperationalView(
      runtimeConfig
    );
  }

  function getConfigView() {
    return buildConfigOperationalView(
      runtimeConfig,
      limits
    );
  }

  async function readHealthCounts() {
    try {
      const webhookBase =
        db.collection(
          WEBHOOK_EVENTS_COLLECTION
        );

      const reversalBase =
        db.collection(
          REVERSAL_REQUESTS_COLLECTION
        );

      const values =
        await Promise.all([
          aggregateCount(
            webhookBase,
            "webhooks.total"
          ),

          ...WEBHOOK_HEALTH_STATUSES
            .map(
              status =>
                aggregateCount(
                  webhookBase.where(
                    "status",
                    "==",
                    status
                  ),
                  `webhooks.${status}`
                )
            ),

          ...REVERSAL_HEALTH_STATUSES
            .map(
              status =>
                aggregateCount(
                  reversalBase.where(
                    "status",
                    "==",
                    status
                  ),
                  `reconciliation.${status}`
                )
            )
        ]);

      return Object.freeze({
        firestoreReachable:
          true,

        webhookCounts:
          Object.freeze({
            total:
              values[0],

            received:
              values[1],

            processing:
              values[2],

            processed:
              values[3],

            ignored:
              values[4],

            error:
              values[5]
          }),

        reversalCounts:
          Object.freeze({
            executing:
              values[6],

            awaitingWebhook:
              values[7],

            providerRejected:
              values[8],

            needsReconciliation:
              values[9]
          })
      });
    }
    catch (
      error
    ) {
      return Object.freeze({
        firestoreReachable:
          false,

        webhookCounts:
          null,

        reversalCounts:
          null
      });
    }
  }

  async function getHealthView() {
    const health =
      await readHealthCounts();

    return buildHealthOperationalView(
      runtimeConfig,
      health
    );
  }

  return Object.freeze({
    getSecurityView,
    getConfigView,
    getHealthView,
    readHealthCounts
  });
}

module.exports = {
  WEBHOOK_HEALTH_STATUSES,
  REVERSAL_HEALTH_STATUSES,

  AdminOperationalObservabilityServiceError,

  requireAggregateCount,
  aggregateCount,
  createAdminOperationalObservabilityService
};
