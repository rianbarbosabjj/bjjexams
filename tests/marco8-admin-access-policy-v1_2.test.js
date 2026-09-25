"use strict";

const assert = require("assert");

const {
  ADMIN_CAPABILITIES,
  ROLE_CAPABILITIES,
  AdminAccessPolicyError,
  resolveExplicitGlobalRoles,
  resolveAdminCapabilities,
  resolveAdministrativeAccess,
  hasAdminCapability,
  requireAdminCapability
} = require(
  "../functions/src/admin/admin-access-policy"
);

function expectPolicyError(
  operation,
  expectedCode
) {
  assert.throws(
    operation,
    error =>
      error instanceof AdminAccessPolicyError &&
      error.code === expectedCode
  );
}

assert.strictEqual(
  ADMIN_CAPABILITIES.length,
  26
);

assert.deepStrictEqual(
  Object.keys(ROLE_CAPABILITIES),
  [
    "super_admin",
    "platform_admin",
    "finance_admin",
    "content_admin",
    "support_admin"
  ]
);

assert.deepStrictEqual(
  resolveExplicitGlobalRoles({
    platform_admin: true,
    student: true,
    arbitrary_role: true
  }),
  [
    "platform_admin"
  ]
);

const superAccess =
  resolveAdministrativeAccess({
    super_admin: true
  });

assert.deepStrictEqual(
  superAccess.globalRoles,
  [
    "super_admin"
  ]
);

assert.strictEqual(
  superAccess.capabilities.length,
  26
);

assert.strictEqual(
  superAccess.surfaceAccess.operations,
  true
);

assert.strictEqual(
  superAccess.surfaceAccess.console,
  true
);

const platformCapabilities =
  resolveAdminCapabilities({
    platform_admin: true
  });

assert.ok(
  platformCapabilities.includes(
    "ops.people.manage"
  )
);

assert.ok(
  platformCapabilities.includes(
    "console.config.manage"
  )
);

assert.ok(
  !platformCapabilities.includes(
    "console.finance.manage"
  )
);

const financeCapabilities =
  resolveAdminCapabilities({
    finance_admin: true
  });

assert.ok(
  financeCapabilities.includes(
    "console.finance.manage"
  )
);

assert.ok(
  financeCapabilities.includes(
    "console.webhooks.reprocess"
  )
);

assert.ok(
  !financeCapabilities.includes(
    "ops.people.manage"
  )
);

const contentCapabilities =
  resolveAdminCapabilities({
    content_admin: true
  });

assert.ok(
  contentCapabilities.includes(
    "ops.courses.manage"
  )
);

assert.ok(
  contentCapabilities.includes(
    "ops.questions.manage"
  )
);

assert.ok(
  !contentCapabilities.includes(
    "console.finance.read"
  )
);

const supportCapabilities =
  resolveAdminCapabilities({
    support_admin: true
  });

assert.ok(
  supportCapabilities.includes(
    "ops.people.read"
  )
);

assert.ok(
  supportCapabilities.includes(
    "console.health.read"
  )
);

assert.ok(
  !supportCapabilities.includes(
    "ops.people.manage"
  )
);

assert.strictEqual(
  hasAdminCapability(
    {
      finance_admin: true
    },
    "console.finance.manage"
  ),
  true
);

assert.strictEqual(
  hasAdminCapability(
    {
      finance_admin: true
    },
    "ops.people.manage"
  ),
  false
);

assert.strictEqual(
  hasAdminCapability(
    {
      super_admin: true
    },
    "ops.certificates.manage"
  ),
  true
);

assert.strictEqual(
  hasAdminCapability(
    {
      platform_admin: true
    },
    "unknown.capability"
  ),
  false
);

assert.strictEqual(
  requireAdminCapability(
    {
      content_admin: true
    },
    "ops.questions.manage"
  ),
  true
);

expectPolicyError(
  () =>
    resolveAdministrativeAccess({}),
  "ADMIN_ROLE_REQUIRED"
);

expectPolicyError(
  () =>
    resolveAdministrativeAccess({
      owner: true,
      manager: true,
      instructor: true
    }),
  "ADMIN_ROLE_REQUIRED"
);

expectPolicyError(
  () =>
    requireAdminCapability(
      {
        support_admin: true
      },
      "ops.people.manage"
    ),
  "ADMIN_CAPABILITY_REQUIRED"
);

expectPolicyError(
  () =>
    requireAdminCapability(
      {
        super_admin: true
      },
      "arbitrary.permission"
    ),
  "UNKNOWN_ADMIN_CAPABILITY"
);

const mixedAccess =
  resolveAdministrativeAccess({
    content_admin: true,
    support_admin: true
  });

assert.deepStrictEqual(
  mixedAccess.globalRoles,
  [
    "content_admin",
    "support_admin"
  ]
);

assert.ok(
  mixedAccess.capabilities.includes(
    "ops.questions.manage"
  )
);

assert.ok(
  mixedAccess.capabilities.includes(
    "console.health.read"
  )
);

console.log("MARCO8_ADMIN_CAPABILITIES=26/26");
console.log("MARCO8_GLOBAL_ROLE_POLICY=5/5");
console.log("MARCO8_SUPER_ADMIN_POLICY=PASSED");
console.log("MARCO8_PLATFORM_ADMIN_POLICY=PASSED");
console.log("MARCO8_FINANCE_ADMIN_POLICY=PASSED");
console.log("MARCO8_CONTENT_ADMIN_POLICY=PASSED");
console.log("MARCO8_SUPPORT_ADMIN_POLICY=PASSED");
console.log("MARCO8_ORG_ROLE_ESCALATION=BLOCKED");
console.log("MARCO8_UNKNOWN_CAPABILITY=BLOCKED");
console.log("MARCO8_FAIL_CLOSED=PASSED");
console.log("MARCO8_ADMIN_ACCESS_POLICY=PASSED");
