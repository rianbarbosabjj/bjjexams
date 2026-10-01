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

        detailIdField:
          value.detailIdField || null,

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
            "ops.people.read",
          readFunction:
            "listarPessoasOperacionaisV12",
          detailFunction:
            "obterPessoaOperacionalV12",
          detailIdField:
            "personId",
          supportsPagination: true,
          listKey: "items",
          filters: [
            "profileType",
            "operationalStatus"
          ]
        }),

        definition({
          routeId: "organizations",
          surface: "operations",
          readCapability:
            "ops.organizations.read",
          readFunction:
            "listarOrganizacoesOperacionaisV12",
          detailFunction:
            "obterOrganizacaoOperacionalV12",
          detailIdField:
            "organizationId",
          supportsPagination: true,
          listKey: "items",
          filters: [
            "status",
            "nameQuery"
          ]
        }),

        definition({
          routeId: "courses",
          surface: "operations",
          readCapability:
            "ops.courses.read",
          readFunction:
            "listarCursosOperacionaisV12",
          detailFunction:
            "obterCursoOperacionalV12",
          detailIdField:
            "courseId",
          supportsPagination: true,
          listKey: "items",
          filters: [
            "workflowStatus",
            "ownerType",
            "visibility",
            "moderationStatus"
          ]
        }),

        definition({
          routeId: "exams",
          surface: "operations",
          readCapability:
            "ops.exams.read",
          readFunction:
            "listarExamesOperacionaisV12",
          detailFunction:
            "obterExameOperacionalV12",
          detailIdField:
            "sessionId",
          supportsPagination: true,
          listKey: "items",
          filters: [
            "status",
            "organizationId",
            "targetBelt"
          ]
        }),

        definition({
          routeId: "questions",
          surface: "operations",
          readCapability:
            "ops.questions.read",
          readFunction:
            "listarQuestoesOperacionaisV12",
          detailFunction:
            "obterQuestaoOperacionalV12",
          detailIdField:
            "questionId",
          supportsPagination: true,
          listKey: "items",
          filters: [
            "lifecycleStatus",
            "difficulty",
            "category"
          ]
        }),

        definition({
          routeId: "certificates",
          surface: "operations",
          readCapability:
            "ops.certificates.read",
          readFunction:
            "listarCertificadosOperacionaisV12",
          detailFunction:
            "obterCertificadoOperacionalV12",
          detailIdField:
            "certificateId",
          supportsPagination: true,
          listKey: "items",
          filters: [
            "status",
            "organizationId",
            "targetBelt"
          ]
        }),

        definition({
          routeId: "orders",
          surface: "operations",
          readCapability:
            "ops.orders.read",
          readFunction:
            "listarPedidosOperacionaisV12",
          detailFunction:
            "obterPedidoOperacionalV12",
          detailIdField:
            "orderId",
          supportsPagination: true,
          listKey: "items",
          filters: [
            "productType",
            "orderStatus"
          ]
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
