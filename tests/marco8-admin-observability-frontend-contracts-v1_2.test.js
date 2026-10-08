"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

require(
  "../js/admin-shell-api-v1_2"
);

const routeApi =
  require(
    "../js/admin-shell-route-api-v1_2"
  );

const registryApi =
  require(
    "../js/admin-shell-route-registry-v1_2"
  );

const webhookReprocessOverlay =
  require(
    "../js/admin-shell-webhook-reprocess-overlay-v1_2"
  );

const observabilityOverlay =
  require(
    "../js/admin-shell-observability-overlay-v1_2"
  );

const {
  ROLE_CAPABILITIES
} = require(
  "../functions/src/admin/admin-access-policy"
);

const {
  SECURITY_READ_CAPABILITY,
  CONFIG_READ_CAPABILITY,
  HEALTH_READ_CAPABILITY,
  assertEmptyOperationalPayload
} = require(
  "../functions/src/admin/admin-operational-observability-functions"
);

const {
  SECURITY_OPERATIONAL_VIEW_FIELDS,
  CONFIG_OPERATIONAL_VIEW_FIELDS,
  HEALTH_OPERATIONAL_VIEW_FIELDS,
  PROVIDER_EXTERNAL_HEALTH,
  buildSecurityOperationalView,
  buildConfigOperationalView,
  buildHealthOperationalView
} = require(
  "../functions/src/admin/admin-operational-observability-models"
);

const ROOT =
  path.resolve(
    __dirname,
    ".."
  );

function source(
  relativePath
) {
  return fs
    .readFileSync(
      path.join(
        ROOT,
        relativePath
      ),
      "utf8"
    )
    .replace(
      /\r\n/g,
      "\n"
    );
}

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
      "revision-f1",

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

function main() {
  assert.deepStrictEqual(
    observabilityOverlay
      .OBSERVABILITY_ROUTE_IDS,
    [
      "security",
      "configuration",
      "health"
    ]
  );

  assert.deepStrictEqual(
    routeApi
      .ROUTE_READ_FUNCTIONS,
    [
      "listarWebhooksOperacionaisV12",
      "obterWebhookOperacionalV12",
      "listarAuditoriaOperacionalV12",
      "obterSegurancaOperacionalV12",
      "obterConfiguracaoOperacionalV12",
      "obterSaudeOperacionalV12"
    ]
  );

  for (
    const functionName of [
      "obterSegurancaOperacionalV12",
      "obterConfiguracaoOperacionalV12",
      "obterSaudeOperacionalV12"
    ]
  ) {
    assert.strictEqual(
      routeApi
        .assertAllowedFunction(
          functionName
        ),
      functionName
    );

    assert.throws(
      () =>
        routeApi
          .assertAllowedActionFunction(
            functionName
          ),
      error =>
        error?.code ===
          "ADMIN_ROUTE_ACTION_FUNCTION_NOT_ALLOWED"
    );
  }

  assert.deepStrictEqual(
    registryApi
      .integratedRoutes(),
    []
  );

  const e1Registry =
    registryApi
      .webhooksAuditIntegratedRegistry();

  assert.strictEqual(
    e1Registry
      .integratedRoutes()
      .length,
    11
  );

  for (
    const routeId of [
      "security",
      "configuration",
      "health"
    ]
  ) {
    assert.strictEqual(
      e1Registry
        .getRouteDefinition(
          routeId
        )
        .integrated,
      false
    );
  }

  const e3Registry =
    webhookReprocessOverlay
      .webhookReprocessIntegratedRegistry(
        registryApi
      );

  assert.strictEqual(
    e3Registry
      .integratedRoutes()
      .length,
    11
  );

  assert.strictEqual(
    e3Registry
      .getRouteDefinition(
        "webhooks"
      )
      .actions
      .length,
    1
  );

  const activeRegistry =
    observabilityOverlay
      .observabilityIntegratedRegistry(
        registryApi,
        webhookReprocessOverlay
      );

  assert.strictEqual(
    activeRegistry
      .knownRoutes()
      .length,
    14
  );

  assert.strictEqual(
    activeRegistry
      .integratedRoutes()
      .length,
    14
  );

  assert.deepStrictEqual(
    activeRegistry
      .integratedRoutes(),
    [
      "people",
      "organizations",
      "courses",
      "exams",
      "questions",
      "certificates",
      "orders",
      "finance",
      "splits",
      "webhooks",
      "audit",
      "security",
      "configuration",
      "health"
    ]
  );

  assert.strictEqual(
    activeRegistry
      .getRouteDefinition(
        "webhooks"
      )
      .actions
      .length,
    1
  );

  for (
    const [
      routeId,
      capability,
      functionName
    ] of [
      [
        "security",
        "console.security.read",
        "obterSegurancaOperacionalV12"
      ],
      [
        "configuration",
        "console.config.read",
        "obterConfiguracaoOperacionalV12"
      ],
      [
        "health",
        "console.health.read",
        "obterSaudeOperacionalV12"
      ]
    ]
  ) {
    const contract =
      activeRegistry
        .getRouteDefinition(
          routeId
        );

    assert.strictEqual(
      contract.integrated,
      true
    );

    assert.strictEqual(
      contract.surface,
      "console"
    );

    assert.strictEqual(
      contract.readCapability,
      capability
    );

    assert.strictEqual(
      contract.readFunction,
      functionName
    );

    assert.strictEqual(
      contract.detailFunction,
      null
    );

    assert.strictEqual(
      contract.supportsPagination,
      false
    );

    assert.deepStrictEqual(
      contract.filters,
      []
    );

    assert.deepStrictEqual(
      contract.actions,
      []
    );
  }

  assert.strictEqual(
    SECURITY_READ_CAPABILITY,
    "console.security.read"
  );

  assert.strictEqual(
    CONFIG_READ_CAPABILITY,
    "console.config.read"
  );

  assert.strictEqual(
    HEALTH_READ_CAPABILITY,
    "console.health.read"
  );

  const roleMatrix = {
    security: {
      allowed: [
        "super_admin",
        "platform_admin",
        "support_admin"
      ],
      blocked: [
        "finance_admin",
        "content_admin"
      ]
    },

    configuration: {
      allowed: [
        "super_admin",
        "platform_admin"
      ],
      blocked: [
        "finance_admin",
        "support_admin",
        "content_admin"
      ]
    },

    health: {
      allowed: [
        "super_admin",
        "platform_admin",
        "finance_admin",
        "support_admin"
      ],
      blocked: [
        "content_admin"
      ]
    }
  };

  const capabilities = {
    security:
      "console.security.read",

    configuration:
      "console.config.read",

    health:
      "console.health.read"
  };

  for (
    const [
      routeId,
      matrix
    ] of Object.entries(
      roleMatrix
    )
  ) {
    const capability =
      capabilities[
        routeId
      ];

    for (
      const role of
      matrix.allowed
    ) {
      assert.ok(
        ROLE_CAPABILITIES[
          role
        ].includes(
          capability
        )
      );
    }

    for (
      const role of
      matrix.blocked
    ) {
      assert.strictEqual(
        ROLE_CAPABILITIES[
          role
        ].includes(
          capability
        ),
        false
      );
    }
  }

  assert.deepStrictEqual(
    assertEmptyOperationalPayload(
      {},
      "F1"
    ),
    {}
  );

  assert.throws(
    () =>
      assertEmptyOperationalPayload(
        {
          role:
            "super_admin"
        },
        "F1"
      ),
    error =>
      error?.code ===
        "invalid-argument"
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

  assert.deepStrictEqual(
    security.alerts,
    {
      status:
        "unsupported",

      items:
        null
    }
  );

  assert.strictEqual(
    security
      .protections
      .secretValuesExposed,
    false
  );

  assert.strictEqual(
    security
      .protections
      .providerHealthPing,
    false
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
    operationalConfig
      .provider
      .externalHealth,
    PROVIDER_EXTERNAL_HEALTH
  );

  assert.strictEqual(
    PROVIDER_EXTERNAL_HEALTH,
    "not_measured"
  );

  assert.strictEqual(
    operationalConfig
      .features
      .configReadOnly,
    true
  );

  assert.strictEqual(
    operationalConfig
      .features
      .configMutationEnabled,
    false
  );

  assert.strictEqual(
    operationalConfig
      .features
      .providerHealthPing,
    false
  );

  const health =
    buildHealthOperationalView(
      config(),
      {
        firestoreReachable:
          false,

        webhookCounts:
          null,

        reversalCounts:
          null
      }
    );

  assert.deepStrictEqual(
    Object.keys(
      health
    ),
    HEALTH_OPERATIONAL_VIEW_FIELDS
  );

  assert.strictEqual(
    health
      .firestore
      .reachable,
    false
  );

  assert.strictEqual(
    health
      .firestore
      .queryMode,
    "aggregate_count"
  );

  assert.strictEqual(
    health
      .provider
      .externalHealth,
    "not_measured"
  );

  assert.strictEqual(
    health
      .webhooks
      .status,
    "unavailable"
  );

  assert.strictEqual(
    health
      .reconciliation
      .status,
    "unavailable"
  );

  assert.strictEqual(
    health
      .incidents
      .status,
    "unavailable"
  );

  const registrySource =
    source(
      "js/admin-shell-route-registry-v1_2.js"
    );

  const actionOverlaySource =
    source(
      "js/admin-shell-webhook-reprocess-overlay-v1_2.js"
    );

  const observabilityOverlaySource =
    source(
      "js/admin-shell-observability-overlay-v1_2.js"
    );

  const htmlSource =
    source(
      "admin_shell_v1_2.html"
    );

  assert.strictEqual(
    registrySource.includes(
      "observabilityIntegratedRegistry"
    ),
    false
  );

  assert.strictEqual(
    actionOverlaySource.includes(
      "obterSegurancaOperacionalV12"
    ),
    false
  );

  assert.strictEqual(
    actionOverlaySource.includes(
      "obterConfiguracaoOperacionalV12"
    ),
    false
  );

  assert.strictEqual(
    actionOverlaySource.includes(
      "obterSaudeOperacionalV12"
    ),
    false
  );

  for (
    const marker of [
      "security",
      "configuration",
      "health"
    ]
  ) {
    assert.ok(
      observabilityOverlaySource
        .includes(
          `"${marker}"`
        )
    );
  }

  assert.strictEqual(
    htmlSource.includes(
      "admin-shell-observability-overlay-v1_2.js"
    ),
    false
  );

  for (
    const forbidden of [
      "innerHTML",
      "firebase-firestore",
      "getFirestore(",
      "collection(",
      "getDoc(",
      "getDocs(",
      "setDoc(",
      "addDoc(",
      "updateDoc(",
      "deleteDoc(",
      "onSnapshot(",
      "CHECKOUT_SECRETS",
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "providerFactory",
      "configMutationEnabled: true"
    ]
  ) {
    assert.strictEqual(
      observabilityOverlaySource
        .includes(
          forbidden
        ),
      false
    );
  }

  console.log(
    "MARCO8_7F1_OBSERVABILITY_ROUTES=3/3"
  );

  console.log(
    "MARCO8_7F1_ACTIVE_ROUTES=14/14"
  );

  console.log(
    "MARCO8_7F1_PREVIOUS_OVERLAY=11/14"
  );

  console.log(
    "MARCO8_7F1_WEBHOOK_ACTION_PRESERVED=1/1"
  );

  console.log(
    "MARCO8_7F1_OBSERVABILITY_ACTIONS=0/3"
  );

  console.log(
    "MARCO8_7F1_READ_CALLABLES=3/3"
  );

  console.log(
    "MARCO8_7F1_PAYLOAD_FIELDS=0/0"
  );

  console.log(
    "MARCO8_7F1_SECURITY_ROLES=3/3"
  );

  console.log(
    "MARCO8_7F1_CONFIG_ROLES=2/2"
  );

  console.log(
    "MARCO8_7F1_HEALTH_ROLES=4/4"
  );

  console.log(
    "MARCO8_7F1_ALERTS=UNSUPPORTED"
  );

  console.log(
    "MARCO8_7F1_HEALTH_UNAVAILABLE=EXPLICIT"
  );

  console.log(
    "MARCO8_7F1_PROVIDER_HEALTH=NOT_MEASURED"
  );

  console.log(
    "MARCO8_7F1_CONFIG_MUTATION=False"
  );

  console.log(
    "MARCO8_7F1_AGGREGATE_QUERY_MODE=PASSED"
  );

  console.log(
    "MARCO8_7F1_FROZEN_REGISTRY=UNCHANGED"
  );

  console.log(
    "MARCO8_7F1_E3_ACTION_OVERLAY=UNCHANGED"
  );

  console.log(
    "MARCO8_7F1_HTML_ACTIVATION=False"
  );

  console.log(
    "MARCO8_7F1_DIRECT_FIRESTORE=FORBIDDEN"
  );

  console.log(
    "MARCO8_7F1_PROVIDER_SECRET_BINDING=False"
  );

  console.log(
    "MARCO8_7F1_OBSERVABILITY_FRONTEND_CONTRACTS=PASSED"
  );
}

main();
