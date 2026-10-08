"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const routeApi =
  require(
    "../js/admin-shell-route-api-v1_2"
  );

const registryApi =
  require(
    "../js/admin-shell-route-registry-v1_2"
  );

const runtimeApi =
  require(
    "../js/admin-shell-route-runtime-v1_2"
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

async function main() {
  for (
    const readFunction of [
      "listarWebhooksOperacionaisV12",
      "obterWebhookOperacionalV12",
      "listarAuditoriaOperacionalV12"
    ]
  ) {
    assert.ok(
      routeApi
        .ROUTE_READ_FUNCTIONS
        .includes(
          readFunction
        )
    );

    assert.strictEqual(
      routeApi
        .assertAllowedFunction(
          readFunction
        ),
      readFunction
    );
  }

  assert.throws(
    () =>
      routeApi
        .assertAllowedFunction(
          "reprocessarWebhookOperacionalV12"
        ),
    error =>
      error?.code ===
        "ADMIN_ROUTE_FUNCTION_NOT_ALLOWED"
  );

  assert.deepStrictEqual(
    registryApi
      .integratedRoutes(),
    []
  );

  assert.deepStrictEqual(
    registryApi
      .operationalIntegratedRegistry()
      .integratedRoutes(),
    [
      "people",
      "organizations",
      "courses",
      "exams",
      "questions",
      "certificates",
      "orders"
    ]
  );

  assert.deepStrictEqual(
    registryApi
      .financeSplitsIntegratedRegistry()
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
      "splits"
    ]
  );

  assert.deepStrictEqual(
    registryApi
      .WEBHOOK_AUDIT_ROUTE_IDS,
    [
      "webhooks",
      "audit"
    ]
  );

  const webhooks =
    registryApi
      .getRouteDefinition(
        "webhooks"
      );

  assert.strictEqual(
    webhooks.readCapability,
    "console.webhooks.read"
  );

  assert.strictEqual(
    webhooks.readFunction,
    "listarWebhooksOperacionaisV12"
  );

  assert.strictEqual(
    webhooks.detailFunction,
    "obterWebhookOperacionalV12"
  );

  assert.strictEqual(
    webhooks.detailIdField,
    "eventId"
  );

  assert.strictEqual(
    webhooks.supportsPagination,
    true
  );

  assert.strictEqual(
    webhooks.listKey,
    "items"
  );

  assert.deepStrictEqual(
    webhooks.filters,
    [
      "status",
      "eventType",
      "orderId"
    ]
  );

  assert.deepStrictEqual(
    webhooks.actions,
    []
  );

  const audit =
    registryApi
      .getRouteDefinition(
        "audit"
      );

  assert.strictEqual(
    audit.readCapability,
    "console.audit.read"
  );

  assert.strictEqual(
    audit.readFunction,
    "listarAuditoriaOperacionalV12"
  );

  assert.strictEqual(
    audit.detailFunction,
    null
  );

  assert.strictEqual(
    audit.detailIdField,
    null
  );

  assert.strictEqual(
    audit.supportsPagination,
    true
  );

  assert.strictEqual(
    audit.listKey,
    "items"
  );

  assert.deepStrictEqual(
    audit.filters,
    [
      "eventType",
      "actorUid",
      "targetType",
      "targetId",
      "organizationId"
    ]
  );

  assert.deepStrictEqual(
    audit.actions,
    []
  );

  const activeRegistry =
    registryApi
      .webhooksAuditIntegratedRegistry();

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
      "audit"
    ]
  );

  for (
    const routeId of [
      "security",
      "configuration",
      "health"
    ]
  ) {
    assert.strictEqual(
      activeRegistry
        .getRouteDefinition(
          routeId
        )
        .integrated,
      false
    );
  }

  const context = {
    capabilities: [
      "console.webhooks.read",
      "console.audit.read"
    ]
  };

  const calls = [];

  const runtime =
    runtimeApi
      .createRouteRuntime({
        registry:
          activeRegistry,

        navigationApi: {
          canNavigateTo(
            receivedContext,
            routeId
          ) {
            assert.strictEqual(
              receivedContext,
              context
            );

            return (
              routeId ===
                "webhooks" ||
              routeId ===
                "audit"
            );
          }
        },

        routeApi: {
          async callRouteAuthenticated(
            functionName,
            payload,
            options
          ) {
            calls.push({
              functionName,
              payload,
              options
            });

            if (
              functionName ===
                "listarWebhooksOperacionaisV12"
            ) {
              return {
                ok:
                  true,

                limit:
                  payload.limit ||
                  20,

                items:
                  payload.cursor
                    ? [
                        {
                          eventId:
                            "event-2"
                        }
                      ]
                    : [
                        {
                          eventId:
                            "event-1"
                        }
                      ],

                nextCursor:
                  payload.cursor
                    ? null
                    : "opaque-webhook-cursor"
              };
            }

            if (
              functionName ===
                "obterWebhookOperacionalV12"
            ) {
              return {
                ok:
                  true,

                webhook: {
                  eventId:
                    payload.eventId
                }
              };
            }

            if (
              functionName ===
                "listarAuditoriaOperacionalV12"
            ) {
              return {
                ok:
                  true,

                limit:
                  payload.limit ||
                  20,

                items:
                  payload.cursor
                    ? [
                        {
                          auditId:
                            "audit-2"
                        }
                      ]
                    : [
                        {
                          auditId:
                            "audit-1"
                        }
                      ],

                nextCursor:
                  payload.cursor
                    ? null
                    : "opaque-audit-cursor"
              };
            }

            throw new Error(
              `Unexpected function ${functionName}`
            );
          }
        }
      });

  runtime.setSession({
    context,
    idToken:
      "mock-token",
    hostname:
      "localhost"
  });

  const webhookList =
    await runtime.activate(
      "webhooks",
      {
        payload: {
          limit:
            10,

          status:
            "error",

          eventType:
            "PAYMENT_REFUNDED",

          orderId:
            "order-1"
        }
      }
    );

  assert.strictEqual(
    webhookList.state,
    "route-ready"
  );

  assert.strictEqual(
    calls[0]
      .functionName,
    "listarWebhooksOperacionaisV12"
  );

  assert.deepStrictEqual(
    calls[0]
      .payload,
    {
      limit:
        10,

      status:
        "error",

      eventType:
        "PAYMENT_REFUNDED",

      orderId:
        "order-1"
    }
  );

  const webhookNext =
    await runtime
      .loadNextPage(
        "webhooks"
      );

  assert.strictEqual(
    webhookNext.state,
    "route-ready"
  );

  assert.deepStrictEqual(
    calls[1]
      .payload,
    {
      limit:
        10,

      status:
        "error",

      eventType:
        "PAYMENT_REFUNDED",

      orderId:
        "order-1",

      cursor:
        "opaque-webhook-cursor"
    }
  );

  assert.deepStrictEqual(
    webhookNext
      .data
      .items,
    [
      {
        eventId:
          "event-1"
      },

      {
        eventId:
          "event-2"
      }
    ]
  );

  const webhookDetail =
    await runtime
      .loadDetail(
        "webhooks",
        "event-1"
      );

  assert.strictEqual(
    webhookDetail.state,
    "route-ready"
  );

  assert.strictEqual(
    webhookDetail.mode,
    "detail"
  );

  assert.strictEqual(
    calls[2]
      .functionName,
    "obterWebhookOperacionalV12"
  );

  assert.deepStrictEqual(
    calls[2]
      .payload,
    {
      eventId:
        "event-1"
    }
  );

  const callsBeforeRestore =
    calls.length;

  const restoredWebhooks =
    runtime
      .restoreList(
        "webhooks"
      );

  assert.strictEqual(
    restoredWebhooks.state,
    "route-ready"
  );

  assert.strictEqual(
    calls.length,
    callsBeforeRestore
  );

  const auditList =
    await runtime.activate(
      "audit",
      {
        payload: {
          limit:
            12,

          eventType:
            "admin.webhook.reprocess.requested",

          actorUid:
            "admin-1",

          targetType:
            "webhook_event",

          targetId:
            "event-1",

          organizationId:
            "org-1"
        }
      }
    );

  assert.strictEqual(
    auditList.state,
    "route-ready"
  );

  assert.strictEqual(
    calls[3]
      .functionName,
    "listarAuditoriaOperacionalV12"
  );

  assert.deepStrictEqual(
    calls[3]
      .payload,
    {
      limit:
        12,

      eventType:
        "admin.webhook.reprocess.requested",

      actorUid:
        "admin-1",

      targetType:
        "webhook_event",

      targetId:
        "event-1",

      organizationId:
        "org-1"
    }
  );

  const auditNext =
    await runtime
      .loadNextPage(
        "audit"
      );

  assert.strictEqual(
    auditNext.state,
    "route-ready"
  );

  assert.deepStrictEqual(
    calls[4]
      .payload,
    {
      limit:
        12,

      eventType:
        "admin.webhook.reprocess.requested",

      actorUid:
        "admin-1",

      targetType:
        "webhook_event",

      targetId:
        "event-1",

      organizationId:
        "org-1",

      cursor:
        "opaque-audit-cursor"
    }
  );

  const callsBeforeInvalid =
    calls.length;

  const invalidFilter =
    await runtime
      .applyFilters(
        "webhooks",
        {
          provider:
            "asaas"
        }
      );

  assert.strictEqual(
    invalidFilter.state,
    "route-error"
  );

  assert.strictEqual(
    invalidFilter.errorCode,
    "ROUTE_FILTER_NOT_ALLOWED"
  );

  assert.strictEqual(
    calls.length,
    callsBeforeInvalid
  );

  const auditDetail =
    await runtime
      .loadDetail(
        "audit",
        "audit-1"
      );

  assert.strictEqual(
    auditDetail.state,
    "route-error"
  );

  assert.strictEqual(
    auditDetail.errorCode,
    "ROUTE_DETAIL_NOT_AVAILABLE"
  );

  assert.strictEqual(
    calls.length,
    callsBeforeInvalid
  );

  const registrySource =
    source(
      "js/admin-shell-route-registry-v1_2.js"
    );

  const runtimeSource =
    source(
      "js/admin-shell-route-runtime-v1_2.js"
    );

  const routeApiSource =
    source(
      "js/admin-shell-route-api-v1_2.js"
    );

  for (
    const forbidden of [
      "firebase-firestore",
      "getFirestore(",
      "getDocs(",
      "setDoc(",
      "addDoc(",
      "updateDoc(",
      "deleteDoc(",
      "onSnapshot("
    ]
  ) {
    for (
      const clientSource of [
        registrySource,
        runtimeSource,
        routeApiSource
      ]
    ) {
      assert.strictEqual(
        clientSource.includes(
          forbidden
        ),
        false
      );
    }
  }

  assert.strictEqual(
    registrySource.includes(
      "reprocessarWebhookOperacionalV12"
    ),
    false
  );

  console.log(
    "MARCO8_7E1_READ_CALLABLES=3/3"
  );

  console.log(
    "MARCO8_7E1_BASE_REGISTRY=0/14"
  );

  console.log(
    "MARCO8_7E1_OPERATIONAL_OVERLAY=7/7"
  );

  console.log(
    "MARCO8_7E1_FINANCE_SPLITS_OVERLAY=9/14"
  );

  console.log(
    "MARCO8_7E1_WEBHOOK_AUDIT_OVERLAY=11/14"
  );

  console.log(
    "MARCO8_7E1_OTHER_CONSOLE_ROUTES=0/3"
  );

  console.log(
    "MARCO8_7E1_WEBHOOK_FILTERS=3/3"
  );

  console.log(
    "MARCO8_7E1_AUDIT_FILTERS=5/5"
  );

  console.log(
    "MARCO8_7E1_WEBHOOK_PAGINATION=PASSED"
  );

  console.log(
    "MARCO8_7E1_WEBHOOK_DETAIL=PASSED"
  );

  console.log(
    "MARCO8_7E1_WEBHOOK_LIST_RESTORE_NO_CALL=PASSED"
  );

  console.log(
    "MARCO8_7E1_AUDIT_PAGINATION=PASSED"
  );

  console.log(
    "MARCO8_7E1_UNSUPPORTED_FILTER=BLOCKED"
  );

  console.log(
    "MARCO8_7E1_REPROCESS_FRONTEND=BLOCKED"
  );

  console.log(
    "MARCO8_7E1_DIRECT_FIRESTORE=FORBIDDEN"
  );

  console.log(
    "MARCO8_7E1_WEBHOOK_AUDIT_FRONTEND_CONTRACTS=PASSED"
  );
}

main().catch(
  error => {
    console.error(
      error
    );

    process.exitCode =
      1;
  }
);
