"use strict";

const assert = require("assert");

const {
  ADMIN_CONTEXT_SCHEMA_VERSION,
  buildAdminContextView,
  createAdminContextHandler
} = require(
  "../functions/src/admin/admin-context-functions"
);

async function expectHttpsError(
  operation,
  expectedCode,
  expectedDomainCode = null
) {
  let received = null;

  try {
    await operation();
  }
  catch (error) {
    received = error;
  }

  assert.ok(
    received,
    `Expected ${expectedCode}`
  );

  assert.strictEqual(
    received.code,
    expectedCode
  );

  if (expectedDomainCode) {
    assert.strictEqual(
      received.details?.domainCode,
      expectedDomainCode
    );
  }
}

async function main() {

assert.strictEqual(
  ADMIN_CONTEXT_SCHEMA_VERSION,
  "1.2"
);

const superView =
  buildAdminContextView({
    uid: "user-super",
    claims: {
      super_admin: true,
      name: "  Super User  ",
      email: "private@example.com",
      arbitrary_secret: "do-not-return"
    },
    environment: "staging"
  });

assert.deepStrictEqual(
  Object.keys(superView),
  [
    "userId",
    "displayName",
    "globalRoles",
    "capabilities",
    "surfaceAccess",
    "environment",
    "schemaVersion"
  ]
);

assert.strictEqual(
  superView.userId,
  "user-super"
);

assert.strictEqual(
  superView.displayName,
  "Super User"
);

assert.deepStrictEqual(
  superView.globalRoles,
  [
    "super_admin"
  ]
);

assert.strictEqual(
  superView.capabilities.length,
  26
);

assert.deepStrictEqual(
  superView.surfaceAccess,
  {
    operations: true,
    console: true
  }
);

assert.strictEqual(
  superView.environment,
  "staging"
);

assert.strictEqual(
  superView.schemaVersion,
  "1.2"
);

assert.strictEqual(
  Object.prototype.hasOwnProperty.call(
    superView,
    "email"
  ),
  false
);

assert.strictEqual(
  Object.prototype.hasOwnProperty.call(
    superView,
    "arbitrary_secret"
  ),
  false
);

const contentView =
  buildAdminContextView({
    uid: "user-content",
    claims: {
      content_admin: true
    },
    environment: "demo"
  });

assert.deepStrictEqual(
  contentView.globalRoles,
  [
    "content_admin"
  ]
);

assert.strictEqual(
  contentView.surfaceAccess.operations,
  true
);

assert.strictEqual(
  contentView.surfaceAccess.console,
  false
);

assert.strictEqual(
  contentView.displayName,
  null
);

const supportView =
  buildAdminContextView({
    uid: "user-support",
    claims: {
      support_admin: true
    },
    environment: "staging"
  });

assert.deepStrictEqual(
  supportView.globalRoles,
  [
    "support_admin"
  ]
);

assert.strictEqual(
  supportView.surfaceAccess.operations,
  true
);

assert.strictEqual(
  supportView.surfaceAccess.console,
  true
);

assert.ok(
  supportView.capabilities.includes(
    "console.audit.read"
  )
);

assert.ok(
  supportView.capabilities.includes(
    "console.security.read"
  )
);

assert.ok(
  supportView.capabilities.includes(
    "console.health.read"
  )
);

assert.ok(
  !supportView.capabilities.includes(
    "console.finance.manage"
  )
);

const financeView =
  buildAdminContextView({
    uid: "user-finance",
    claims: {
      finance_admin: true,
      support_admin: true
    },
    environment: "staging"
  });

assert.ok(
  financeView.capabilities.includes(
    "console.finance.manage"
  )
);

assert.ok(
  financeView.capabilities.includes(
    "ops.people.read"
  )
);

const handler =
  createAdminContextHandler({
    environment: "staging"
  });

const result =
  await handler({
    data: {},
    auth: {
      uid: "platform-user",
      token: {
        platform_admin: true,
        name: "Platform Admin",
        email: "hidden@example.com"
      }
    }
  });

assert.strictEqual(
  result.ok,
  true
);

assert.strictEqual(
  result.context.userId,
  "platform-user"
);

assert.strictEqual(
  result.context.displayName,
  "Platform Admin"
);

assert.ok(
  result.context.capabilities.includes(
    "ops.people.manage"
  )
);

assert.ok(
  !result.context.capabilities.includes(
    "console.finance.manage"
  )
);

assert.strictEqual(
  Object.prototype.hasOwnProperty.call(
    result.context,
    "email"
  ),
  false
);

await expectHttpsError(
  () =>
    handler({
      data: {}
    }),
  "unauthenticated"
);

await expectHttpsError(
  () =>
    handler({
      data: {},
      auth: {
        uid: "org-owner",
        token: {
          owner: true,
          manager: true
        }
      }
    }),
  "permission-denied",
  "ADMIN_ROLE_REQUIRED"
);

await expectHttpsError(
  () =>
    handler({
      data: {
        role: "super_admin"
      },
      auth: {
        uid: "support-user",
        token: {
          support_admin: true
        }
      }
    }),
  "invalid-argument"
);

await expectHttpsError(
  () =>
    handler({
      data: {
        capabilities: [
          "console.finance.manage"
        ]
      },
      auth: {
        uid: "content-user",
        token: {
          content_admin: true
        }
      }
    }),
  "invalid-argument"
);

console.log("MARCO8_ADMIN_CONTEXT_SCHEMA=1.2");
console.log("MARCO8_ADMIN_CONTEXT_FIELDS=7/7");
console.log("MARCO8_ADMIN_CONTEXT_SANITIZATION=PASSED");
console.log("MARCO8_ADMIN_CONTEXT_AUTH=PASSED");
console.log("MARCO8_ADMIN_CONTEXT_ROLE_ESCALATION=BLOCKED");
console.log("MARCO8_ADMIN_CONTEXT_CLIENT_ROLE_INPUT=BLOCKED");
console.log("MARCO8_ADMIN_CONTEXT_CLIENT_CAPABILITY_INPUT=BLOCKED");
console.log("MARCO8_ADMIN_CONTEXT_FAIL_CLOSED=PASSED");
console.log("MARCO8_SUPPORT_CONSOLE_SURFACE=PASSED");
console.log("MARCO8_ADMIN_CONTEXT_HANDLER=PASSED");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
