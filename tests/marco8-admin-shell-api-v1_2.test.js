"use strict";

const assert =
  require("assert");

const {
  REGION,
  STAGING_PROJECT_ID,
  CONTEXT_FUNCTION,
  AdminShellApiError,
  resolveShellEnvironment,
  functionUrl,
  normalizeContext,
  callAuthenticated,
  getAdminContext,
  hasCapability
} = require(
  "../js/admin-shell-api-v1_2"
);

function expectError(
  operation,
  expectedCode
) {
  assert.throws(
    operation,
    error =>
      error instanceof
        AdminShellApiError &&
      error.code ===
        expectedCode
  );
}

async function expectAsyncError(
  operation,
  expectedCode
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

  assert.ok(
    received instanceof
      AdminShellApiError
  );

  assert.strictEqual(
    received.code,
    expectedCode
  );
}

async function main() {
  assert.strictEqual(
    REGION,
    "southamerica-east1"
  );

  assert.strictEqual(
    STAGING_PROJECT_ID,
    "bjj-exams-staging"
  );

  assert.strictEqual(
    CONTEXT_FUNCTION,
    "obterContextoAdministrativoV12"
  );

  const staging =
    resolveShellEnvironment({
      hostname:
        "bjj-exams-staging.web.app"
    });

  assert.deepStrictEqual(
    staging,
    {
      environment:
        "staging",

      projectId:
        "bjj-exams-staging",

      local:
        false
    }
  );

  const localhost =
    resolveShellEnvironment({
      hostname:
        "localhost"
    });

  assert.strictEqual(
    localhost.environment,
    "staging"
  );

  assert.strictEqual(
    localhost.local,
    true
  );

  expectError(
    () =>
      resolveShellEnvironment({
        hostname:
          "bjj-exams.web.app"
      }),
    "ADMIN_PRODUCTION_BLOCKED"
  );

  expectError(
    () =>
      resolveShellEnvironment({
        hostname:
          "preview.example.com"
      }),
    "ADMIN_HOST_NOT_ALLOWED"
  );

  assert.strictEqual(
    functionUrl(
      CONTEXT_FUNCTION,
      {
        hostname:
          "localhost"
      }
    ),
    "https://" +
      "southamerica-east1-" +
      "bjj-exams-staging" +
      ".cloudfunctions.net/" +
      "obterContextoAdministrativoV12"
  );

  expectError(
    () =>
      functionUrl(
        "adminWriteAnything",
        {
          hostname:
            "localhost"
        }
      ),
    "ADMIN_FUNCTION_NOT_ALLOWED"
  );

  const context =
    normalizeContext({
      userId:
        "admin-1",

      displayName:
        " Admin User ",

      globalRoles: [
        "support_admin",
        "support_admin"
      ],

      capabilities: [
        "ops.read",
        "console.read",
        "console.audit.read"
      ],

      surfaceAccess: {
        operations: true,
        console: true
      },

      environment:
        "staging",

      schemaVersion:
        "1.2",

      secret:
        "must-not-pass"
    });

  assert.deepStrictEqual(
    Object.keys(context),
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
    context.displayName,
    "Admin User"
  );

  assert.deepStrictEqual(
    [...context.globalRoles],
    [
      "support_admin"
    ]
  );

  assert.strictEqual(
    context.surfaceAccess.console,
    true
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        context,
        "secret"
      ),
    false
  );

  assert.strictEqual(
    hasCapability(
      context,
      "console.audit.read"
    ),
    true
  );

  assert.strictEqual(
    hasCapability(
      context,
      "console.finance.manage"
    ),
    false
  );

  expectError(
    () =>
      normalizeContext({
        userId:
          "admin-1",

        globalRoles: [
          "support_admin"
        ],

        capabilities: [
          "console.read"
        ],

        surfaceAccess: {
          console: true
        },

        environment:
          "production",

        schemaVersion:
          "1.2"
      }),
    "ADMIN_CONTEXT_ENVIRONMENT_BLOCKED"
  );

  expectError(
    () =>
      normalizeContext({
        userId:
          "admin-1",

        globalRoles: [
          "support_admin"
        ],

        capabilities: [
          "console.read"
        ],

        environment:
          "staging",

        schemaVersion:
          "2.0"
      }),
    "ADMIN_CONTEXT_SCHEMA_UNSUPPORTED"
  );

  await expectAsyncError(
    () =>
      callAuthenticated(
        CONTEXT_FUNCTION,
        {},
        {
          hostname:
            "localhost"
        }
      ),
    "ADMIN_TOKEN_REQUIRED"
  );

  await expectAsyncError(
    () =>
      callAuthenticated(
        CONTEXT_FUNCTION,
        {
          role:
            "super_admin"
        },
        {
          hostname:
            "localhost",

          idToken:
            "token"
        }
      ),
    "ADMIN_BOOTSTRAP_PAYLOAD_REJECTED"
  );

  let receivedUrl = null;
  let receivedOptions = null;

  const fakeFetch =
    async (
      url,
      options
    ) => {
      receivedUrl =
        url;

      receivedOptions =
        options;

      return {
        ok: true,
        status: 200,

        async json() {
          return {
            result: {
              ok: true,

              context: {
                userId:
                  "support-1",

                displayName:
                  "Support",

                globalRoles: [
                  "support_admin"
                ],

                capabilities: [
                  "ops.read",
                  "console.read",
                  "console.audit.read",
                  "console.security.read",
                  "console.health.read"
                ],

                surfaceAccess: {
                  operations:
                    true,

                  console:
                    true
                },

                environment:
                  "staging",

                schemaVersion:
                  "1.2"
              }
            }
          };
        }
      };
    };

  const fetchedContext =
    await getAdminContext({
      hostname:
        "localhost",

      idToken:
        "test-token",

      fetchImpl:
        fakeFetch
    });

  assert.strictEqual(
    receivedUrl,
    functionUrl(
      CONTEXT_FUNCTION,
      {
        hostname:
          "localhost"
      }
    )
  );

  assert.strictEqual(
    receivedOptions.method,
    "POST"
  );

  assert.strictEqual(
    receivedOptions.headers
      .Authorization,
    "Bearer test-token"
  );

  assert.deepStrictEqual(
    JSON.parse(
      receivedOptions.body
    ),
    {
      data: {}
    }
  );

  assert.strictEqual(
    fetchedContext.userId,
    "support-1"
  );

  assert.strictEqual(
    fetchedContext
      .surfaceAccess
      .operations,
    true
  );

  assert.strictEqual(
    fetchedContext
      .surfaceAccess
      .console,
    true
  );

  assert.strictEqual(
    hasCapability(
      fetchedContext,
      "console.health.read"
    ),
    true
  );

  console.log(
    "MARCO8_ADMIN_SHELL_ALLOWED_FUNCTIONS=1/1"
  );

  console.log(
    "MARCO8_ADMIN_SHELL_STAGING=ALLOWED"
  );

  console.log(
    "MARCO8_ADMIN_SHELL_LOCAL=ALLOWED"
  );

  console.log(
    "MARCO8_ADMIN_SHELL_PRODUCTION=BLOCKED"
  );

  console.log(
    "MARCO8_ADMIN_SHELL_UNKNOWN_HOST=BLOCKED"
  );

  console.log(
    "MARCO8_ADMIN_SHELL_TOKEN_REQUIRED=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_SHELL_CLIENT_ROLE_INPUT=BLOCKED"
  );

  console.log(
    "MARCO8_ADMIN_SHELL_CONTEXT_SANITIZATION=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_SHELL_BOOTSTRAP=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
