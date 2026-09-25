"use strict";

const assert =
  require("assert");

const {
  SECTION_DEFINITIONS,
  NAVIGATION_ITEMS,
  buildNavigation,
  allowedRoutes,
  canNavigateTo,
  firstAllowedRoute
} = require(
  "../js/admin-shell-navigation-v1_2"
);

function context(
  capabilities,
  surfaceAccess = {}
) {
  return {
    userId: "test-user",
    displayName: "Test",
    globalRoles: [
      "test_role"
    ],
    capabilities:
      [...capabilities],
    surfaceAccess: {
      operations:
        surfaceAccess.operations ===
          true,
      console:
        surfaceAccess.console ===
          true
    },
    environment: "staging",
    schemaVersion: "1.2"
  };
}

assert.strictEqual(
  SECTION_DEFINITIONS.length,
  2
);

assert.strictEqual(
  NAVIGATION_ITEMS.length,
  14
);

const superContext =
  context(
    [
      "ops.read",
      "ops.people.read",
      "ops.organizations.read",
      "ops.courses.read",
      "ops.exams.read",
      "ops.questions.read",
      "ops.certificates.read",
      "ops.orders.read",

      "console.read",
      "console.finance.read",
      "console.splits.read",
      "console.webhooks.read",
      "console.audit.read",
      "console.security.read",
      "console.config.read",
      "console.health.read"
    ],
    {
      operations: true,
      console: true
    }
  );

const superNavigation =
  buildNavigation(
    superContext
  );

assert.strictEqual(
  superNavigation.length,
  2
);

assert.deepStrictEqual(
  allowedRoutes(
    superContext
  ),
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

const supportContext =
  context(
    [
      "ops.read",
      "ops.people.read",
      "ops.organizations.read",
      "ops.courses.read",
      "ops.exams.read",
      "ops.questions.read",
      "ops.certificates.read",
      "ops.orders.read",

      "console.read",
      "console.audit.read",
      "console.security.read",
      "console.health.read"
    ],
    {
      operations: true,
      console: true
    }
  );

assert.deepStrictEqual(
  allowedRoutes(
    supportContext
  ),
  [
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
);

assert.strictEqual(
  canNavigateTo(
    supportContext,
    "audit"
  ),
  true
);

assert.strictEqual(
  canNavigateTo(
    supportContext,
    "finance"
  ),
  false
);

assert.strictEqual(
  canNavigateTo(
    supportContext,
    "configuration"
  ),
  false
);

const financeContext =
  context(
    [
      "ops.read",
      "ops.orders.read",

      "console.read",
      "console.finance.read",
      "console.splits.read",
      "console.webhooks.read",
      "console.audit.read",
      "console.health.read"
    ],
    {
      operations: true,
      console: true
    }
  );

assert.deepStrictEqual(
  allowedRoutes(
    financeContext
  ),
  [
    "orders",
    "finance",
    "splits",
    "webhooks",
    "audit",
    "health"
  ]
);

assert.strictEqual(
  firstAllowedRoute(
    financeContext
  ),
  "orders"
);

const contentContext =
  context(
    [
      "ops.read",
      "ops.courses.read",
      "ops.exams.read",
      "ops.questions.read",
      "ops.certificates.read"
    ],
    {
      operations: true,
      console: false
    }
  );

const contentNavigation =
  buildNavigation(
    contentContext
  );

assert.strictEqual(
  contentNavigation.length,
  1
);

assert.strictEqual(
  contentNavigation[0].id,
  "operations"
);

assert.deepStrictEqual(
  allowedRoutes(
    contentContext
  ),
  [
    "courses",
    "exams",
    "questions",
    "certificates"
  ]
);

const platformContext =
  context(
    [
      "ops.read",
      "ops.people.read",
      "ops.organizations.read",
      "ops.courses.read",
      "ops.exams.read",
      "ops.questions.read",
      "ops.certificates.read",
      "ops.orders.read",

      "console.read",
      "console.finance.read",
      "console.splits.read",
      "console.webhooks.read",
      "console.audit.read",
      "console.security.read",
      "console.config.read",
      "console.health.read"
    ],
    {
      operations: true,
      console: true
    }
  );

assert.strictEqual(
  canNavigateTo(
    platformContext,
    "configuration"
  ),
  true
);

assert.strictEqual(
  canNavigateTo(
    platformContext,
    "people"
  ),
  true
);

const forgedSurfaceContext =
  context(
    [
      "console.read",
      "console.audit.read"
    ],
    {
      operations: false,
      console: false
    }
  );

assert.deepStrictEqual(
  allowedRoutes(
    forgedSurfaceContext
  ),
  []
);

const missingShellCapability =
  context(
    [
      "console.audit.read"
    ],
    {
      console: true
    }
  );

assert.deepStrictEqual(
  allowedRoutes(
    missingShellCapability
  ),
  []
);

const shellOnlyContext =
  context(
    [
      "ops.read",
      "console.read"
    ],
    {
      operations: true,
      console: true
    }
  );

assert.deepStrictEqual(
  buildNavigation(
    shellOnlyContext
  ),
  []
);

assert.strictEqual(
  firstAllowedRoute(
    shellOnlyContext
  ),
  null
);

assert.strictEqual(
  canNavigateTo(
    superContext,
    "unknown-route"
  ),
  false
);

assert.deepStrictEqual(
  buildNavigation(null),
  []
);

console.log(
  "MARCO8_ADMIN_NAV_SECTIONS=2/2"
);

console.log(
  "MARCO8_ADMIN_NAV_ITEMS=14/14"
);

console.log(
  "MARCO8_ADMIN_NAV_OPS_CONSOLE_SEPARATION=PASSED"
);

console.log(
  "MARCO8_ADMIN_NAV_SUPPORT_READ_ONLY=PASSED"
);

console.log(
  "MARCO8_ADMIN_NAV_FINANCE_SCOPE=PASSED"
);

console.log(
  "MARCO8_ADMIN_NAV_CONTENT_SCOPE=PASSED"
);

console.log(
  "MARCO8_ADMIN_NAV_PLATFORM_SCOPE=PASSED"
);

console.log(
  "MARCO8_ADMIN_NAV_SURFACE_GATE=PASSED"
);

console.log(
  "MARCO8_ADMIN_NAV_UNKNOWN_ROUTE=BLOCKED"
);

console.log(
  "MARCO8_ADMIN_NAVIGATION_MODEL=PASSED"
);
