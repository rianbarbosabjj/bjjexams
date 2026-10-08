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

const overlayApi =
  require(
    "../js/admin-shell-webhook-reprocess-overlay-v1_2"
  );

const rendererApi =
  require(
    "../js/admin-shell-webhooks-audit-renderer-v1_2"
  );

const {
  ROLE_CAPABILITIES
} = require(
  "../functions/src/admin/admin-access-policy"
);

const {
  ADMIN_WEBHOOK_REPROCESS_SCHEMA_VERSION,
  ADMIN_WEBHOOK_REPROCESS_ACTION,
  ADMIN_WEBHOOK_REPROCESS_TARGET_TYPE,
  buildWebhookReprocessAuditEvent
} = require(
  "../functions/src/admin/admin-webhooks-reprocess-domain"
);

const {
  OPERATIONAL_WEBHOOK_VIEW_FIELDS,
  buildOperationalWebhookView
} = require(
  "../functions/src/admin/admin-webhook-models"
);

const {
  AUDIT_OPERATIONAL_VIEW_FIELDS,
  AUDIT_METADATA_ALLOWED_FIELDS,
  buildOperationalAuditView
} = require(
  "../functions/src/admin/admin-audit-models"
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

function main() {
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

  assert.deepStrictEqual(
    routeApi
      .ROUTE_ACTION_FUNCTIONS,
    [
      "reprocessarWebhookOperacionalV12"
    ]
  );

  assert.strictEqual(
    routeApi
      .ROUTE_READ_FUNCTIONS
      .includes(
        "reprocessarWebhookOperacionalV12"
      ),
    false
  );

  assert.strictEqual(
    routeApi
      .ROUTE_ACTION_FUNCTIONS
      .includes(
        "listarWebhooksOperacionaisV12"
      ),
    false
  );

  assertProductionBlocked(
    () =>
      routeApi
        .routeFunctionUrl(
          "listarWebhooksOperacionaisV12",
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

  assert.deepStrictEqual(
    registryApi
      .integratedRoutes(),
    []
  );

  const readOnlyRegistry =
    registryApi
      .webhooksAuditIntegratedRegistry();

  assert.strictEqual(
    readOnlyRegistry
      .integratedRoutes()
      .length,
    11
  );

  assert.deepStrictEqual(
    readOnlyRegistry
      .getRouteDefinition(
        "webhooks"
      )
      .actions,
    []
  );

  assert.deepStrictEqual(
    readOnlyRegistry
      .getRouteDefinition(
        "audit"
      )
      .actions,
    []
  );

  for (
    const routeId of [
      "security",
      "configuration",
      "health"
    ]
  ) {
    assert.strictEqual(
      readOnlyRegistry
        .getRouteDefinition(
          routeId
        )
        .integrated,
      false
    );
  }

  const actionRegistry =
    overlayApi
      .webhookReprocessIntegratedRegistry(
        registryApi
      );

  assert.strictEqual(
    actionRegistry
      .integratedRoutes()
      .length,
    11
  );

  const webhookAction =
    actionRegistry
      .getRouteDefinition(
        "webhooks"
      )
      .actions[0];

  assert.deepStrictEqual(
    webhookAction,
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
    actionRegistry
      .getRouteDefinition(
        "audit"
      )
      .actions,
    []
  );

  for (
    const role of [
      "super_admin",
      "finance_admin"
    ]
  ) {
    assert.ok(
      ROLE_CAPABILITIES[
        role
      ].includes(
        "console.webhooks.reprocess"
      )
    );
  }

  for (
    const role of [
      "platform_admin",
      "support_admin",
      "content_admin"
    ]
  ) {
    assert.strictEqual(
      ROLE_CAPABILITIES[
        role
      ].includes(
        "console.webhooks.reprocess"
      ),
      false
    );
  }

  for (
    const role of [
      "super_admin",
      "platform_admin",
      "finance_admin"
    ]
  ) {
    assert.ok(
      ROLE_CAPABILITIES[
        role
      ].includes(
        "console.webhooks.read"
      )
    );
  }

  assert.strictEqual(
    ROLE_CAPABILITIES
      .support_admin
      .includes(
        "console.webhooks.read"
      ),
    false
  );

  for (
    const role of [
      "super_admin",
      "platform_admin",
      "finance_admin",
      "support_admin"
    ]
  ) {
    assert.ok(
      ROLE_CAPABILITIES[
        role
      ].includes(
        "console.audit.read"
      )
    );
  }

  assert.strictEqual(
    ROLE_CAPABILITIES
      .content_admin
      .includes(
        "console.audit.read"
      ),
    false
  );

  assert.strictEqual(
    ADMIN_WEBHOOK_REPROCESS_SCHEMA_VERSION,
    1
  );

  assert.strictEqual(
    ADMIN_WEBHOOK_REPROCESS_ACTION,
    "admin.webhook.reprocess.requested"
  );

  assert.strictEqual(
    ADMIN_WEBHOOK_REPROCESS_TARGET_TYPE,
    "webhook_event"
  );

  const receivedAt =
    new Date(
      "2026-10-05T20:00:00.000Z"
    );

  const webhookView =
    buildOperationalWebhookView({
      eventId:
        "event-e4",

      event: {
        provider:
          "asaas",

        providerEventId:
          "provider-event-sensitive-id",

        eventType:
          "PAYMENT_RECEIVED",

        status:
          "error",

        orderId:
          "order-e4",

        deliveryCount:
          2,

        processingAction:
          "confirm_payment",

        errorCode:
          "PROVIDER_PAYMENT_UNAVAILABLE",

        receivedAt,

        lastReceivedAt:
          receivedAt,

        processedAt:
          receivedAt
      }
    });

  assert.deepStrictEqual(
    Object.keys(
      webhookView
    ),
    OPERATIONAL_WEBHOOK_VIEW_FIELDS
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        webhookView,
        "providerEventId"
      ),
    false
  );

  assert.ok(
    webhookView
      .providerEventRef
      .startsWith(
        "***"
      )
  );

  assert.strictEqual(
    webhookView
      .providerEventRef
      .includes(
        "provider-event-sensitive-id"
      ),
    false
  );

  const webhookDetail =
    rendererApi
      .buildWebhookDetailViewModel({
        webhook: {
          ...webhookView,

          rawPayload: {
            secret:
              "must-not-render"
          },

          providerEventId:
            "must-not-render"
        }
      });

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        webhookDetail,
        "rawPayload"
      ),
    false
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        webhookDetail,
        "providerEventId"
      ),
    false
  );

  const auditEvent =
    buildWebhookReprocessAuditEvent({
      actorUid:
        "admin-e4",

      actorRole:
        "finance_admin",

      eventId:
        "event-e4",

      requestId:
        "request-e4",

      previousStatus:
        "error",

      previousErrorCode:
        "PROVIDER_PAYMENT_UNAVAILABLE",

      reprocessCount:
        3,

      createdAt:
        receivedAt
    });

  assert.deepStrictEqual(
    auditEvent
      .metadata,
    {
      schemaVersion:
        1,

      previousStatus:
        "error",

      previousErrorCode:
        "PROVIDER_PAYMENT_UNAVAILABLE",

      reprocessCount:
        3
    }
  );

  const auditView =
    buildOperationalAuditView({
      auditId:
        "audit-e4",

      audit: {
        ...auditEvent,

        before: {
          status:
            "error",

          secret:
            "must-not-render"
        },

        after: {
          status:
            "received",

          secret:
            "must-not-render"
        },

        metadata: {
          ...auditEvent
            .metadata,

          unsupportedSecret:
            "must-not-render"
        }
      }
    });

  assert.deepStrictEqual(
    Object.keys(
      auditView
    ),
    AUDIT_OPERATIONAL_VIEW_FIELDS
  );

  assert.strictEqual(
    auditView.eventType,
    "admin.webhook.reprocess.requested"
  );

  assert.deepStrictEqual(
    auditView.actor,
    {
      uid:
        "admin-e4",

      role:
        "finance_admin"
    }
  );

  assert.deepStrictEqual(
    auditView.target,
    {
      type:
        "webhook_event",

      id:
        "event-e4"
    }
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        auditView.metadata,
        "unsupportedSecret"
      ),
    false
  );

  for (
    const key of
    Object.keys(
      auditView.metadata
    )
  ) {
    assert.ok(
      AUDIT_METADATA_ALLOWED_FIELDS
        .includes(
          key
        )
    );
  }

  const auditListModel =
    rendererApi
      .buildAuditListViewModel({
        items: [
          {
            ...auditView,

            before: {
              secret:
                "must-not-render"
            },

            after: {
              secret:
                "must-not-render"
            }
          }
        ],

        nextCursor:
          "opaque-e4"
      });

  assert.strictEqual(
    auditListModel
      .hasNext,
    true
  );

  assert.strictEqual(
    auditListModel
      .items
      .length,
    1
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        auditListModel
          .items[0],
        "before"
      ),
    false
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        auditListModel
          .items[0],
        "after"
      ),
    false
  );

  assert.ok(
    auditListModel
      .items[0]
      .metadata
      .includes(
        "reprocessCount=3"
      )
  );

  const registrySource =
    source(
      "js/admin-shell-route-registry-v1_2.js"
    );

  const overlaySource =
    source(
      "js/admin-shell-webhook-reprocess-overlay-v1_2.js"
    );

  const apiSource =
    source(
      "js/admin-shell-route-api-v1_2.js"
    );

  const runtimeSource =
    source(
      "js/admin-shell-route-runtime-v1_2.js"
    );

  const rendererSource =
    source(
      "js/admin-shell-webhooks-audit-renderer-v1_2.js"
    );

  const htmlSource =
    source(
      "admin_shell_v1_2.html"
    );

  const reprocessFunctionsSource =
    source(
      "functions/src/admin/admin-webhooks-reprocess-functions.js"
    );

  const reprocessServiceSource =
    source(
      "functions/src/admin/admin-webhooks-reprocess-service.js"
    );

  const webhookReadServiceSource =
    source(
      "functions/src/admin/admin-webhooks-read-service.js"
    );

  const auditReadServiceSource =
    source(
      "functions/src/admin/admin-audit-read-service.js"
    );

  assert.strictEqual(
    registrySource.includes(
      "reprocessarWebhookOperacionalV12"
    ),
    false
  );

  assert.strictEqual(
    registrySource.includes(
      "console.webhooks.reprocess"
    ),
    false
  );

  assert.ok(
    overlaySource.includes(
      "reprocessarWebhookOperacionalV12"
    )
  );

  assert.ok(
    overlaySource.includes(
      "console.webhooks.reprocess"
    )
  );

  assert.strictEqual(
    rendererSource.includes(
      "providerEventId"
    ),
    false
  );

  assert.strictEqual(
    rendererSource.includes(
      "rawPayload"
    ),
    false
  );

  assert.ok(
    reprocessFunctionsSource.includes(
      "createWebhookWorkerHandler"
    )
  );

  assert.ok(
    reprocessServiceSource.includes(
      "payment_webhook_events"
    )
  );

  assert.ok(
    reprocessServiceSource.includes(
      "audit_logs"
    )
  );

  assert.ok(
    webhookReadServiceSource.includes(
      "payment_webhook_events"
    )
  );

  assert.ok(
    auditReadServiceSource.includes(
      "audit_logs"
    )
  );

  const clientSources = [
    apiSource,
    registrySource,
    overlaySource,
    runtimeSource,
    rendererSource,
    htmlSource
  ];

  for (
    const forbidden of [
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
        false
      );
    }
  }

  for (
    const forbidden of [
      "CHECKOUT_SECRETS",
      "ASAAS_API_KEY",
      "payment_webhook_events",
      "audit_logs"
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
        false
      );
    }
  }

  const scriptOrder =
    [
      "js/admin-shell-route-api-v1_2.js",
      "js/admin-shell-route-registry-v1_2.js",
      "js/admin-shell-webhook-reprocess-overlay-v1_2.js",
      "js/admin-shell-route-runtime-v1_2.js",
      "js/admin-shell-webhooks-audit-renderer-v1_2.js",
      "js/admin-shell-controller-v1_2.js"
    ]
      .map(
        marker =>
          htmlSource.indexOf(
            marker
          )
      );

  assert.ok(
    scriptOrder.every(
      index =>
        index >= 0
    )
  );

  for (
    let i = 1;
    i < scriptOrder.length;
    i += 1
  ) {
    assert.ok(
      scriptOrder[i] >
        scriptOrder[
          i - 1
        ]
    );
  }

  assert.ok(
    apiSource.includes(
      "ROUTE_ACTION_FUNCTIONS"
    )
  );

  assert.ok(
    runtimeSource.includes(
      "confirmationRequired"
    )
  );

  assert.ok(
    runtimeSource.includes(
      "actionInFlight"
    )
  );

  assert.ok(
    runtimeSource.includes(
      "ROUTE_ACTION_SUCCESS_UNCONFIRMED"
    )
  );

  assert.ok(
    runtimeSource.includes(
      "loadDetail("
    )
  );

  console.log(
    "MARCO8_7E4_ACTIVE_ROUTES=11/14"
  );

  console.log(
    "MARCO8_7E4_OTHER_CONSOLE_ROUTES=0/3"
  );

  console.log(
    "MARCO8_7E4_READ_ACTION_ALLOWLISTS=6+1"
  );

  console.log(
    "MARCO8_7E4_FROZEN_REGISTRY=UNCHANGED"
  );

  console.log(
    "MARCO8_7E4_ACTION_OVERLAY=ISOLATED"
  );

  console.log(
    "MARCO8_7E4_WEBHOOK_READ_ROLES=3/3"
  );

  console.log(
    "MARCO8_7E4_AUDIT_READ_ROLES=4/4"
  );

  console.log(
    "MARCO8_7E4_REPROCESS_ROLES=2/2"
  );

  console.log(
    "MARCO8_7E4_REPROCESS_PAYLOAD_FIELDS=2/2"
  );

  console.log(
    "MARCO8_7E4_CONFIRMATION_REQUIRED=PASSED"
  );

  console.log(
    "MARCO8_7E4_DUPLICATE_ACTION_LOCK=PASSED"
  );

  console.log(
    "MARCO8_7E4_BACKEND_SUCCESS_REQUIRED=PASSED"
  );

  console.log(
    "MARCO8_7E4_DETAIL_REFRESH=PASSED"
  );

  console.log(
    "MARCO8_7E4_CANONICAL_WEBHOOK_SOURCE=payment_webhook_events"
  );

  console.log(
    "MARCO8_7E4_CANONICAL_AUDIT_SOURCE=audit_logs"
  );

  console.log(
    "MARCO8_7E4_SHARED_WORKER=PASSED"
  );

  console.log(
    "MARCO8_7E4_WEBHOOK_SAFE_PROJECTION=PASSED"
  );

  console.log(
    "MARCO8_7E4_AUDIT_SAFE_PROJECTION=PASSED"
  );

  console.log(
    "MARCO8_7E4_REPROCESS_AUDIT_EVENT=PASSED"
  );

  console.log(
    "MARCO8_7E4_SCRIPT_ORDER=PASSED"
  );

  console.log(
    "MARCO8_7E4_DIRECT_FIRESTORE=FORBIDDEN"
  );

  console.log(
    "MARCO8_7E4_PROVIDER_SECRETS_CLIENT=FORBIDDEN"
  );

  console.log(
    "MARCO8_7E4_PARALLEL_LEDGER=FORBIDDEN"
  );

  console.log(
    "MARCO8_7E4_PRODUCTION=BLOCKED"
  );

  console.log(
    "MARCO8_7E4_WEBHOOKS_AUDIT_INTEGRATION=PASSED"
  );
}

main();
