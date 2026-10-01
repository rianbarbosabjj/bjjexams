"use strict";

(function initAdminShellRouteRegistry(root, factory) {
  const api = factory(root);

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminShellRouteRegistry =
      api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,

  function buildAdminShellRouteRegistry() {
    function definition(
      value
    ) {
      return Object.freeze({
        routeId:
          value.routeId,

        surface:
          value.surface,

        readCapability:
          value.readCapability,

        integrated:
          value.integrated === true,

        readFunction:
          value.readFunction || null,

        detailFunction:
          value.detailFunction || null,

        supportsPagination:
          value.supportsPagination ===
          true,

        listKey:
          value.listKey || null,

        filters:
          Object.freeze([
            ...(value.filters || [])
          ]),

        actions:
          Object.freeze([
            ...(value.actions || [])
          ])
      });
    }

    const ROUTE_DEFINITIONS =
      Object.freeze([
        definition({
          routeId: "people",
          surface: "operations",
          readCapability:
            "ops.people.read"
        }),

        definition({
          routeId: "organizations",
          surface: "operations",
          readCapability:
            "ops.organizations.read"
        }),

        definition({
          routeId: "courses",
          surface: "operations",
          readCapability:
            "ops.courses.read"
        }),

        definition({
          routeId: "exams",
          surface: "operations",
          readCapability:
            "ops.exams.read"
        }),

        definition({
          routeId: "questions",
          surface: "operations",
          readCapability:
            "ops.questions.read"
        }),

        definition({
          routeId: "certificates",
          surface: "operations",
          readCapability:
            "ops.certificates.read"
        }),

        definition({
          routeId: "orders",
          surface: "operations",
          readCapability:
            "ops.orders.read"
        }),

        definition({
          routeId: "finance",
          surface: "console",
          readCapability:
            "console.finance.read"
        }),

        definition({
          routeId: "splits",
          surface: "console",
          readCapability:
            "console.splits.read"
        }),

        definition({
          routeId: "webhooks",
          surface: "console",
          readCapability:
            "console.webhooks.read",
          readFunction:
            "listarWebhooksOperacionaisV12",
          detailFunction:
            "obterWebhookOperacionalV12",
          supportsPagination: true,
          listKey: "items",
          filters: [
            "status",
            "eventType",
            "orderId"
          ]
        }),

        definition({
          routeId: "audit",
          surface: "console",
          readCapability:
            "console.audit.read",
          readFunction:
            "listarAuditoriaOperacionalV12",
          supportsPagination: true,
          listKey: "items",
          filters: [
            "eventType",
            "actorUid",
            "targetType",
            "targetId",
            "organizationId"
          ]
        }),

        definition({
          routeId: "security",
          surface: "console",
          readCapability:
            "console.security.read",
          readFunction:
            "obterSegurancaOperacionalV12"
        }),

        definition({
          routeId: "configuration",
          surface: "console",
          readCapability:
            "console.config.read",
          readFunction:
            "obterConfiguracaoOperacionalV12"
        }),

        definition({
          routeId: "health",
          surface: "console",
          readCapability:
            "console.health.read",
          readFunction:
            "obterSaudeOperacionalV12"
        })
      ]);

    const routeMap =
      new Map(
        ROUTE_DEFINITIONS.map(
          item => [
            item.routeId,
            item
          ]
        )
      );

    function getRouteDefinition(
      routeId
    ) {
      const normalized =
        String(routeId || "")
          .trim();

      return (
        routeMap.get(
          normalized
        ) ||
        null
      );
    }

    function knownRoutes() {
      return Object.freeze(
        ROUTE_DEFINITIONS.map(
          item =>
            item.routeId
        )
      );
    }

    function integratedRoutes() {
      return Object.freeze(
        ROUTE_DEFINITIONS
          .filter(
            item =>
              item.integrated
          )
          .map(
            item =>
              item.routeId
          )
      );
    }

    return Object.freeze({
      ROUTE_DEFINITIONS,
      getRouteDefinition,
      knownRoutes,
      integratedRoutes
    });
  }
);
