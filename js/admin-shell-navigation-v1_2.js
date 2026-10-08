"use strict";

(function initAdminShellNavigation(root, factory) {
  const api = factory(root);

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminShellNavigation = api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,

  function buildAdminShellNavigation(root) {
    const SECTION_DEFINITIONS =
      Object.freeze([
        Object.freeze({
          id: "operations",
          label: "Painel Operacional",
          requiredCapability: "ops.read",
          surfaceKey: "operations"
        }),

        Object.freeze({
          id: "console",
          label: "Console",
          requiredCapability: "console.read",
          surfaceKey: "console"
        })
      ]);

    const NAVIGATION_ITEMS =
      Object.freeze([
        Object.freeze({
          id: "people",
          section: "operations",
          label: "Pessoas",
          capability: "ops.people.read",
          route: "people"
        }),

        Object.freeze({
          id: "organizations",
          section: "operations",
          label: "Organizacoes",
          capability: "ops.organizations.read",
          route: "organizations"
        }),

        Object.freeze({
          id: "courses",
          section: "operations",
          label: "Cursos",
          capability: "ops.courses.read",
          route: "courses"
        }),

        Object.freeze({
          id: "exams",
          section: "operations",
          label: "Exames",
          capability: "ops.exams.read",
          route: "exams"
        }),

        Object.freeze({
          id: "questions",
          section: "operations",
          label: "Banco de Questoes",
          capability: "ops.questions.read",
          route: "questions"
        }),

        Object.freeze({
          id: "certificates",
          section: "operations",
          label: "Certificados",
          capability: "ops.certificates.read",
          route: "certificates"
        }),

        Object.freeze({
          id: "orders",
          section: "operations",
          label: "Pedidos",
          capability: "ops.orders.read",
          route: "orders"
        }),

        Object.freeze({
          id: "finance",
          section: "console",
          label: "Financeiro",
          capability: "console.finance.read",
          route: "finance"
        }),

        Object.freeze({
          id: "splits",
          section: "console",
          label: "Splits",
          capability: "console.splits.read",
          route: "splits"
        }),

        Object.freeze({
          id: "webhooks",
          section: "console",
          label: "Webhooks",
          capability: "console.webhooks.read",
          route: "webhooks"
        }),

        Object.freeze({
          id: "audit",
          section: "console",
          label: "Auditoria",
          capability: "console.audit.read",
          route: "audit"
        }),

        Object.freeze({
          id: "security",
          section: "console",
          label: "Seguranca",
          capability: "console.security.read",
          route: "security"
        }),

        Object.freeze({
          id: "configuration",
          section: "console",
          label: "Configuracoes",
          capability: "console.config.read",
          route: "configuration"
        }),

        Object.freeze({
          id: "health",
          section: "console",
          label: "Saude",
          capability: "console.health.read",
          route: "health"
        })
      ]);

    function hasCapability(
      context,
      capability
    ) {
      return Boolean(
        context &&
        Array.isArray(
          context.capabilities
        ) &&
        context.capabilities.includes(
          capability
        )
      );
    }

    function hasSurfaceAccess(
      context,
      surfaceKey
    ) {
      return Boolean(
        context &&
        context.surfaceAccess &&
        context.surfaceAccess[
          surfaceKey
        ] === true
      );
    }

    function sectionAllowed(
      context,
      section
    ) {
      return (
        hasSurfaceAccess(
          context,
          section.surfaceKey
        ) &&
        hasCapability(
          context,
          section.requiredCapability
        )
      );
    }

    function itemAllowed(
      context,
      item
    ) {
      return hasCapability(
        context,
        item.capability
      );
    }

    function buildNavigation(
      context
    ) {
      if (
        !context ||
        typeof context !== "object" ||
        Array.isArray(context)
      ) {
        return Object.freeze([]);
      }

      const sections = [];

      for (
        const section of
        SECTION_DEFINITIONS
      ) {
        if (
          !sectionAllowed(
            context,
            section
          )
        ) {
          continue;
        }

        const items =
          NAVIGATION_ITEMS
            .filter(
              item =>
                item.section ===
                  section.id &&
                itemAllowed(
                  context,
                  item
                )
            )
            .map(
              item =>
                Object.freeze({
                  id: item.id,
                  label: item.label,
                  route: item.route,
                  capability:
                    item.capability
                })
            );

        if (
          items.length === 0
        ) {
          continue;
        }

        sections.push(
          Object.freeze({
            id: section.id,
            label: section.label,
            items:
              Object.freeze(
                items
              )
          })
        );
      }

      return Object.freeze(
        sections
      );
    }

    function allowedRoutes(
      context
    ) {
      return Object.freeze(
        buildNavigation(context)
          .flatMap(
            section =>
              section.items.map(
                item =>
                  item.route
              )
          )
      );
    }

    function canNavigateTo(
      context,
      route
    ) {
      const normalized =
        String(route || "")
          .trim();

      if (!normalized) {
        return false;
      }

      return allowedRoutes(
        context
      ).includes(
        normalized
      );
    }

    function firstAllowedRoute(
      context
    ) {
      const routes =
        allowedRoutes(
          context
        );

      return routes.length > 0
        ? routes[0]
        : null;
    }

    return Object.freeze({
      SECTION_DEFINITIONS,
      NAVIGATION_ITEMS,
      hasCapability,
      hasSurfaceAccess,
      sectionAllowed,
      itemAllowed,
      buildNavigation,
      allowedRoutes,
      canNavigateTo,
      firstAllowedRoute
    });
  }
);
