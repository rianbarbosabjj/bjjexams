"use strict";

(function initAdminShellWebhookReprocessOverlay(root, factory) {
  const api = factory();

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminShellWebhookReprocessOverlay =
      api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,

  function buildAdminShellWebhookReprocessOverlay() {
    const WEBHOOK_REPROCESS_ACTION =
      Object.freeze({
        actionId:
          "reprocess",

        capability:
          "console.webhooks.reprocess",

        functionName:
          "reprocessarWebhookOperacionalV12",

        payloadFields:
          Object.freeze([
            "eventId",
            "requestId"
          ]),

        requiredFields:
          Object.freeze([
            "eventId",
            "requestId"
          ]),

        identifierFields:
          Object.freeze([
            "eventId",
            "requestId"
          ]),

        confirmationRequired:
          true,

        refreshMode:
          "detail",

        refreshIdField:
          "eventId"
      });

    function webhookReprocessIntegratedRegistry(
      routeRegistry
    ) {
      if (
        !routeRegistry ||
        typeof routeRegistry
          .webhooksAuditIntegratedRegistry !==
          "function"
      ) {
        throw new TypeError(
          "Webhook reprocess overlay requires the read-only Webhooks/Audit registry."
        );
      }

      const readonlyRegistry =
        routeRegistry
          .webhooksAuditIntegratedRegistry();

      const activeDefinitions =
        Object.freeze(
          readonlyRegistry
            .ROUTE_DEFINITIONS
            .map(
              item =>
                item.routeId ===
                  "webhooks"
                  ? Object.freeze({
                      ...item,

                      actions:
                        Object.freeze([
                          WEBHOOK_REPROCESS_ACTION
                        ])
                    })
                  : item
            )
        );

      const activeMap =
        new Map(
          activeDefinitions.map(
            item => [
              item.routeId,
              item
            ]
          )
        );

      return Object.freeze({
        ROUTE_DEFINITIONS:
          activeDefinitions,

        getRouteDefinition(
          routeId
        ) {
          const normalized =
            String(
              routeId || ""
            ).trim();

          return (
            activeMap.get(
              normalized
            ) ||
            null
          );
        },

        knownRoutes() {
          return Object.freeze(
            activeDefinitions.map(
              item =>
                item.routeId
            )
          );
        },

        integratedRoutes() {
          return Object.freeze([
            ...readonlyRegistry
              .integratedRoutes()
          ]);
        }
      });
    }

    return Object.freeze({
      WEBHOOK_REPROCESS_ACTION,
      webhookReprocessIntegratedRegistry
    });
  }
);
