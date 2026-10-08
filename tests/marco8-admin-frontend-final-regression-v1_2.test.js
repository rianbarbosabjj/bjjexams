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

const shellApi =
  require(
    "../js/admin-shell-api-v1_2"
  );

const navigationApi =
  require(
    "../js/admin-shell-navigation-v1_2"
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

const routeRuntimeApi =
  require(
    "../js/admin-shell-route-runtime-v1_2"
  );

const operationalRenderer =
  require(
    "../js/admin-shell-operational-renderer-v1_2"
  );

const financeSplitsRenderer =
  require(
    "../js/admin-shell-finance-splits-renderer-v1_2"
  );

const webhooksAuditRenderer =
  require(
    "../js/admin-shell-webhooks-audit-renderer-v1_2"
  );

const observabilityRenderer =
  require(
    "../js/admin-shell-observability-renderer-v1_2"
  );

const bootstrapApi =
  require(
    "../js/admin-shell-bootstrap-v1_2"
  );

const {
  ADMIN_CAPABILITIES,
  ROLE_CAPABILITIES
} = require(
  "../functions/src/admin/admin-access-policy"
);

const {
  PROVIDER_EXTERNAL_HEALTH
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

function assertProductionBlocked(
  operation
) {
  assert.throws(
    operation,
    error =>
      error?.code ===
      "ADMIN_PRODUCTION_BLOCKED"
  );
}

function contextForRole(
  role
) {
  const capabilities =
    ROLE_CAPABILITIES[
      role
    ];

  return Object.freeze({
    userId:
      `final-${role}`,

    displayName:
      role,

    globalRoles:
      Object.freeze([
        role
      ]),

    capabilities,

    surfaceAccess:
      Object.freeze({
        operations:
          capabilities.includes(
            "ops.read"
          ),

        console:
          capabilities.includes(
            "console.read"
          )
      }),

    environment:
      "staging",

    schemaVersion:
      "1.2"
  });
}

function main() {
  const expectedRoutes = [
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
  ];

  assert.deepStrictEqual(
    registryApi
      .knownRoutes(),
    expectedRoutes
  );

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

  const activeRegistry =
    observabilityOverlay
      .observabilityIntegratedRegistry(
        registryApi,
        webhookReprocessOverlay
      );

  assert.deepStrictEqual(
    activeRegistry
      .knownRoutes(),
    expectedRoutes
  );

  assert.deepStrictEqual(
    activeRegistry
      .integratedRoutes(),
    expectedRoutes
  );

  assert.strictEqual(
    activeRegistry
      .ROUTE_DEFINITIONS
      .length,
    14
  );

  const navigationRoutes =
    navigationApi
      .NAVIGATION_ITEMS
      .map(
        item =>
          item.route
      );

  assert.deepStrictEqual(
    navigationRoutes,
    expectedRoutes
  );

  for (
    const item of
    navigationApi
      .NAVIGATION_ITEMS
  ) {
    const contract =
      activeRegistry
        .getRouteDefinition(
          item.route
        );

    assert.ok(
      contract
    );

    assert.strictEqual(
      contract.integrated,
      true
    );

    assert.strictEqual(
      contract.readCapability,
      item.capability
    );

    assert.ok(
      ADMIN_CAPABILITIES
        .includes(
          contract.readCapability
        )
    );

    assert.ok(
      contract.readCapability
        .endsWith(
          ".read"
        )
    );
  }

  const allowedFunctionNames =
    new Set();

  for (
    const contract of
    activeRegistry
      .ROUTE_DEFINITIONS
  ) {
    assert.strictEqual(
      routeApi
        .assertAllowedFunction(
          contract.readFunction
        ),
      contract.readFunction
    );

    allowedFunctionNames.add(
      contract.readFunction
    );

    if (
      contract.detailFunction
    ) {
      assert.strictEqual(
        routeApi
          .assertAllowedFunction(
            contract.detailFunction
          ),
        contract.detailFunction
      );

      allowedFunctionNames.add(
        contract.detailFunction
      );
    }
  }

  assert.strictEqual(
    allowedFunctionNames.size,
    22
  );

  const allActions =
    activeRegistry
      .ROUTE_DEFINITIONS
      .flatMap(
        contract =>
          contract.actions.map(
            action => ({
              routeId:
                contract.routeId,

              action
            })
          )
      );

  assert.strictEqual(
    allActions.length,
    1
  );

  assert.strictEqual(
    allActions[0]
      .routeId,
    "webhooks"
  );

  assert.deepStrictEqual(
    allActions[0]
      .action,
    {
      actionId:
        "reprocess",

      capability:
        "console.webhooks.reprocess",

      functionName:
        "reprocessarWebhookOperacionalV12",

      payloadFields: [
        "eventId",
        "requestId"
      ],

      requiredFields: [
        "eventId",
        "requestId"
      ],

      identifierFields: [
        "eventId",
        "requestId"
      ],

      confirmationRequired:
        true,

      refreshMode:
        "detail",

      refreshIdField:
        "eventId"
    }
  );

  assert.deepStrictEqual(
    routeApi
      .ROUTE_ACTION_FUNCTIONS,
    [
      "reprocessarWebhookOperacionalV12"
    ]
  );

  assert.strictEqual(
    routeApi
      .assertAllowedActionFunction(
        allActions[0]
          .action
          .functionName
      ),
    "reprocessarWebhookOperacionalV12"
  );

  for (
    const routeId of
    expectedRoutes.filter(
      routeId =>
        routeId !==
        "webhooks"
    )
  ) {
    assert.deepStrictEqual(
      activeRegistry
        .getRouteDefinition(
          routeId
        )
        .actions,
      []
    );
  }

  const paginationRoutes =
    activeRegistry
      .ROUTE_DEFINITIONS
      .filter(
        contract =>
          contract.supportsPagination
      )
      .map(
        contract =>
          contract.routeId
      );

  assert.deepStrictEqual(
    paginationRoutes,
    [
      "people",
      "organizations",
      "courses",
      "exams",
      "questions",
      "certificates",
      "orders",
      "webhooks",
      "audit"
    ]
  );

  const detailRoutes =
    activeRegistry
      .ROUTE_DEFINITIONS
      .filter(
        contract =>
          Boolean(
            contract.detailFunction
          )
      )
      .map(
        contract =>
          contract.routeId
      );

  assert.deepStrictEqual(
    detailRoutes,
    [
      "people",
      "organizations",
      "courses",
      "exams",
      "questions",
      "certificates",
      "orders",
      "webhooks"
    ]
  );

  const filterCount =
    activeRegistry
      .ROUTE_DEFINITIONS
      .reduce(
        (
          total,
          contract
        ) =>
          total +
          contract.filters.length,
        0
      );

  assert.strictEqual(
    filterCount,
    28
  );

  const expectedRoutesByRole = {
    super_admin:
      expectedRoutes,

    platform_admin:
      expectedRoutes,

    finance_admin: [
      "orders",
      "finance",
      "splits",
      "webhooks",
      "audit",
      "health"
    ],

    content_admin: [
      "courses",
      "exams",
      "questions",
      "certificates"
    ],

    support_admin: [
      "people",
      "organizations",
      "courses",
      "exams",
      "questions",
      "certificates",
      "orders",
      "audit",
      "security",
      "health"
    ]
  };

  for (
    const [
      role,
      expected
    ] of Object.entries(
      expectedRoutesByRole
    )
  ) {
    assert.deepStrictEqual(
      navigationApi
        .allowedRoutes(
          contextForRole(
            role
          )
        ),
      expected
    );
  }

  const mutationRoles =
    Object.entries(
      ROLE_CAPABILITIES
    )
      .filter(
        ([
          ,
          capabilities
        ]) =>
          capabilities.includes(
            "console.webhooks.reprocess"
          )
      )
      .map(
        ([
          role
        ]) =>
          role
      );

  assert.deepStrictEqual(
    mutationRoles,
    [
      "super_admin",
      "finance_admin"
    ]
  );

  assert.deepStrictEqual(
    routeRuntimeApi
      .ROUTE_STATES,
    {
      loading:
        "route-loading",

      ready:
        "route-ready",

      empty:
        "route-empty",

      error:
        "route-error",

      notIntegrated:
        "route-not-integrated"
    }
  );

  const rendererRoutes = [
    ...operationalRenderer
      .OPERATIONAL_ROUTE_IDS,

    ...financeSplitsRenderer
      .FINANCE_SPLITS_ROUTE_IDS,

    ...webhooksAuditRenderer
      .WEBHOOK_AUDIT_ROUTE_IDS,

    ...observabilityRenderer
      .OBSERVABILITY_ROUTE_IDS
  ];

  assert.deepStrictEqual(
    rendererRoutes,
    expectedRoutes
  );

  assert.strictEqual(
    new Set(
      rendererRoutes
    ).size,
    14
  );

  assert.strictEqual(
    shellApi
      .STAGING_PROJECT_ID,
    "bjj-exams-staging"
  );

  assert.strictEqual(
    bootstrapApi
      .STAGING_PROJECT_ID,
    "bjj-exams-staging"
  );

  assert.strictEqual(
    PROVIDER_EXTERNAL_HEALTH,
    "not_measured"
  );

  assertProductionBlocked(
    () =>
      shellApi
        .resolveShellEnvironment({
          hostname:
            "bjj-exams.web.app"
        })
  );

  assertProductionBlocked(
    () =>
      routeApi
        .routeFunctionUrl(
          "obterSaudeOperacionalV12",
          {
            hostname:
              "bjj-exams.web.app"
          }
        )
  );

  assertProductionBlocked(
    () =>
      routeApi
        .actionFunctionUrl(
          "reprocessarWebhookOperacionalV12",
          {
            hostname:
              "bjj-exams.web.app"
          }
        )
  );

  const html =
    source(
      "admin_shell_v1_2.html"
    );

  const expectedScriptOrder = [
    "js/firebase-runtime-v1_2.js",
    "js/admin-shell-api-v1_2.js",
    "js/admin-shell-navigation-v1_2.js",
    "js/admin-shell-route-api-v1_2.js",
    "js/admin-shell-route-registry-v1_2.js",
    "js/admin-shell-webhook-reprocess-overlay-v1_2.js",
    "js/admin-shell-observability-overlay-v1_2&#46;js",
    "js/admin-shell-route-runtime-v1_2.js",
    "js/admin-shell-operational-renderer-v1_2.js",
    "js/admin-shell-finance-splits-renderer-v1_2.js",
    "js/admin-shell-webhooks-audit-renderer-v1_2.js",
    "js/admin-shell-observability-renderer-v1_2.js",
    "js/admin-shell-controller-v1_2.js",
    "js/admin-shell-bootstrap-v1_2.js"
  ];

  const scriptIndexes =
    expectedScriptOrder
      .map(
        marker =>
          html.indexOf(
            marker
          )
      );

  assert.ok(
    scriptIndexes.every(
      index =>
        index >= 0
    )
  );

  for (
    let index = 1;
    index <
      scriptIndexes.length;
    index += 1
  ) {
    assert.ok(
      scriptIndexes[index] >
      scriptIndexes[
        index - 1
      ]
    );
  }

  for (
    const marker of [
      "observabilityIntegratedRegistry",
      "webhookReprocessIntegratedRegistry",
      "createOperationalRenderer",
      "createFinanceSplitsRenderer",
      "createWebhooksAuditRenderer",
      "createObservabilityRenderer",
      "__bjjAdminShellRouteRuntimeV12",
      "__bjjAdminShellControllerV12"
    ]
  ) {
    assert.ok(
      html.includes(
        marker
      ),
      `Missing final composition marker: ${marker}`
    );
  }

  const clientFiles = [
    "admin_shell_v1_2.html",
    "js/admin-shell-api-v1_2.js",
    "js/admin-shell-navigation-v1_2.js",
    "js/admin-shell-route-api-v1_2.js",
    "js/admin-shell-route-registry-v1_2.js",
    "js/admin-shell-webhook-reprocess-overlay-v1_2.js",
    "js/admin-shell-observability-overlay-v1_2.js",
    "js/admin-shell-route-runtime-v1_2.js",
    "js/admin-shell-operational-renderer-v1_2.js",
    "js/admin-shell-finance-splits-renderer-v1_2.js",
    "js/admin-shell-webhooks-audit-renderer-v1_2.js",
    "js/admin-shell-observability-renderer-v1_2.js",
    "js/admin-shell-controller-v1_2.js",
    "js/admin-shell-bootstrap-v1_2.js"
  ];

  const clientSources =
    clientFiles.map(
      source
    );

  for (
    const forbidden of [
      ".innerHTML",
      "firebase-firestore",
      "getFirestore(",
      "collection(",
      "getDoc(",
      "getDocs(",
      "setDoc(",
      "addDoc(",
      "updateDoc(",
      "deleteDoc(",
      "onSnapshot("
    ]
  ) {
    for (
      const clientSource of
      clientSources
    ) {
      assert.strictEqual(
        clientSource.includes(
          forbidden
        ),
        false,
        `Forbidden client primitive found: ${forbidden}`
      );
    }
  }

  for (
    const forbidden of [
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "CHECKOUT_SECRETS",
      "payment_webhook_events",
      "audit_logs",
      "payment_transactions"
    ]
  ) {
    for (
      const clientSource of
      clientSources
    ) {
      assert.strictEqual(
        clientSource.includes(
          forbidden
        ),
        false,
        `Forbidden client binding/source found: ${forbidden}`
      );
    }
  }

  const reprocessService =
    source(
      "functions/src/admin/admin-webhooks-reprocess-service.js"
    );

  const webhookReadService =
    source(
      "functions/src/admin/admin-webhooks-read-service.js"
    );

  const auditReadService =
    source(
      "functions/src/admin/admin-audit-read-service.js"
    );

  const observabilityService =
    source(
      "functions/src/admin/admin-operational-observability-service.js"
    );

  assert.ok(
    reprocessService.includes(
      "payment_webhook_events"
    )
  );

  assert.ok(
    reprocessService.includes(
      "audit_logs"
    )
  );

  assert.ok(
    webhookReadService.includes(
      "payment_webhook_events"
    )
  );

  assert.ok(
    auditReadService.includes(
      "audit_logs"
    )
  );

  assert.ok(
    observabilityService.includes(
      "aggregate"
    )
  );

  assert.strictEqual(
    observabilityService.includes(
      "providerFactory"
    ),
    false
  );

  assert.strictEqual(
    observabilityService.includes(
      ".set("
    ),
    false
  );

  assert.strictEqual(
    observabilityService.includes(
      ".update("
    ),
    false
  );

  assert.strictEqual(
    observabilityService.includes(
      ".delete("
    ),
    false
  );

  console.log(
    "MARCO8_7G_FINAL_ROUTES=14/14"
  );

  console.log(
    "MARCO8_7G_FINAL_RENDERER_COVERAGE=14/14"
  );

  console.log(
    "MARCO8_7G_READ_FUNCTIONS=22/22"
  );

  console.log(
    "MARCO8_7G_MUTATION_FUNCTIONS=1/1"
  );

  console.log(
    "MARCO8_7G_MUTATION_ROUTE=webhooks"
  );

  console.log(
    "MARCO8_7G_MUTATION_ROLES=2/2"
  );

  console.log(
    "MARCO8_7G_PAGINATION_ROUTES=9/9"
  );

  console.log(
    "MARCO8_7G_DETAIL_ROUTES=8/8"
  );

  console.log(
    "MARCO8_7G_FILTER_FIELDS=28/28"
  );

  console.log(
    "MARCO8_7G_SUPER_ADMIN_ROUTES=14/14"
  );

  console.log(
    "MARCO8_7G_PLATFORM_ADMIN_ROUTES=14/14"
  );

  console.log(
    "MARCO8_7G_FINANCE_ADMIN_ROUTES=6/6"
  );

  console.log(
    "MARCO8_7G_SUPPORT_ADMIN_ROUTES=10/10"
  );

  console.log(
    "MARCO8_7G_CONTENT_ADMIN_ROUTES=4/4"
  );

  console.log(
    "MARCO8_7G_ROUTE_STATES=5/5"
  );

  console.log(
    "MARCO8_7G_SCRIPT_ORDER=14/14"
  );

  console.log(
    "MARCO8_7G_STAGING_PROJECT=VERIFIED"
  );

  console.log(
    "MARCO8_7G_PRODUCTION=BLOCKED"
  );

  console.log(
    "MARCO8_7G_PROVIDER_HEALTH=NOT_MEASURED"
  );

  console.log(
    "MARCO8_7G_DIRECT_FIRESTORE=FORBIDDEN"
  );

  console.log(
    "MARCO8_7G_PROVIDER_SECRETS_CLIENT=FORBIDDEN"
  );

  console.log(
    "MARCO8_7G_PARALLEL_LEDGER_CLIENT=FORBIDDEN"
  );

  console.log(
    "MARCO8_7G_CANONICAL_WEBHOOK_SOURCE=payment_webhook_events"
  );

  console.log(
    "MARCO8_7G_CANONICAL_AUDIT_SOURCE=audit_logs"
  );

  console.log(
    "MARCO8_7G_OBSERVABILITY_WRITES=False"
  );

  console.log(
    "MARCO8_7G_PROVIDER_CALLS_OBSERVABILITY=False"
  );

  console.log(
    "MARCO8_7G_FRONTEND_FINAL_REGRESSION=PASSED"
  );
}

main();
