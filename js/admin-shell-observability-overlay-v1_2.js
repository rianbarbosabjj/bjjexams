"use strict";

(function initAdminShellObservabilityOverlay(root, factory) {
  const api = factory();

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminShellObservabilityOverlay =
      api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,

  function buildAdminShellObservabilityOverlay() {
    const OBSERVABILITY_ROUTE_IDS =
      Object.freeze([
        "security",
        "configuration",
        "health"
      ]);

    function observabilityIntegratedRegistry(
      routeRegistry,
      webhookReprocessOverlay
    ) {
      if (
        !routeRegistry ||
        typeof routeRegistry
          .webhooksAuditIntegratedRegistry !==
          "function"
      ) {
        throw new TypeError(
          "Observability overlay requires the read-only route registry."
        );
      }

      if (
        !webhookReprocessOverlay ||
        typeof webhookReprocessOverlay
          .webhookReprocessIntegratedRegistry !==
          "function"
      ) {
        throw new TypeError(
          "Observability overlay requires the controlled webhook action overlay."
        );
      }

      const previousRegistry =
        webhookReprocessOverlay
          .webhookReprocessIntegratedRegistry(
            routeRegistry
          );

      const integratedSet =
        new Set([
          ...previousRegistry
            .integratedRoutes(),
          ...OBSERVABILITY_ROUTE_IDS
        ]);

      const activeDefinitions =
        Object.freeze(
          previousRegistry
            .ROUTE_DEFINITIONS
            .map(
              item =>
                integratedSet.has(
                  item.routeId
                )
                  ? Object.freeze({
                      ...item,
                      integrated:
                        true
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
            ...activeDefinitions
              .filter(
                item =>
                  item.integrated
              )
              .map(
                item =>
                  item.routeId
              )
          ]);
        }
      });
    }

    return Object.freeze({
      OBSERVABILITY_ROUTE_IDS,
      observabilityIntegratedRegistry
    });
  }
);
