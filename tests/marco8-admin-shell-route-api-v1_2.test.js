"use strict";

const assert = require("assert");

require(
  "../js/admin-shell-api-v1_2"
);

const {
  ROUTE_READ_FUNCTIONS,
  FORBIDDEN_CLIENT_FIELDS,
  AdminShellRouteApiError,
  assertAllowedFunction,
  normalizePayload,
  routeFunctionUrl,
  callRouteAuthenticated
} = require(
  "../js/admin-shell-route-api-v1_2"
);

function expectError(
  operation,
  code
) {
  assert.throws(
    operation,
    error =>
      error instanceof
        AdminShellRouteApiError &&
      error.code ===
        code
  );
}

async function expectAsyncError(
  operation,
  code
) {
  let received = null;

  try {
    await operation();
  }
  catch (error) {
    received = error;
  }

  assert.ok(received);
  assert.ok(
    received instanceof
      AdminShellRouteApiError
  );
  assert.strictEqual(
    received.code,
    code
  );

  return received;
}

async function main() {
  assert.deepStrictEqual(
    [...ROUTE_READ_FUNCTIONS],
    [
      "listarWebhooksOperacionaisV12",
      "obterWebhookOperacionalV12",
      "listarAuditoriaOperacionalV12",
      "obterSegurancaOperacionalV12",
      "obterConfiguracaoOperacionalV12",
      "obterSaudeOperacionalV12"
    ]
  );

  assert.strictEqual(
    ROUTE_READ_FUNCTIONS.length,
    6
  );

  assert.ok(
    FORBIDDEN_CLIENT_FIELDS.includes(
      "role"
    )
  );

  assert.ok(
    FORBIDDEN_CLIENT_FIELDS.includes(
      "capability"
    )
  );

  assert.strictEqual(
    assertAllowedFunction(
      "obterSaudeOperacionalV12"
    ),
    "obterSaudeOperacionalV12"
  );

  expectError(
    () =>
      assertAllowedFunction(
        "adminWriteAnything"
      ),
    "ADMIN_ROUTE_FUNCTION_NOT_ALLOWED"
  );

  expectError(
    () =>
      normalizePayload({
        role: "super_admin"
      }),
    "ADMIN_ROUTE_PAYLOAD_FORBIDDEN"
  );

  expectError(
    () =>
      normalizePayload([]),
    "ADMIN_ROUTE_PAYLOAD_INVALID"
  );

  assert.strictEqual(
    routeFunctionUrl(
      "obterSaudeOperacionalV12",
      {
        hostname:
          "localhost"
      }
    ),
    "https://" +
      "southamerica-east1-" +
      "bjj-exams-staging" +
      ".cloudfunctions.net/" +
      "obterSaudeOperacionalV12"
  );

  assert.throws(
    () =>
      routeFunctionUrl(
        "obterSaudeOperacionalV12",
        {
          hostname:
            "bjj-exams.web.app"
        }
      ),
    error =>
      error?.code ===
      "ADMIN_PRODUCTION_BLOCKED"
  );

  await expectAsyncError(
    () =>
      callRouteAuthenticated(
        "obterSaudeOperacionalV12",
        {},
        {
          hostname:
            "localhost"
        }
      ),
    "ADMIN_ROUTE_TOKEN_REQUIRED"
  );

  let receivedUrl = null;
  let receivedOptions = null;

  const result =
    await callRouteAuthenticated(
      "listarWebhooksOperacionaisV12",
      {
        limit: 20,
        status: "error"
      },
      {
        hostname:
          "localhost",

        idToken:
          "route-token",

        async fetchImpl(
          url,
          options
        ) {
          receivedUrl = url;
          receivedOptions =
            options;

          return {
            ok: true,
            status: 200,

            async json() {
              return {
                result: {
                  ok: true,
                  items: []
                }
              };
            }
          };
        }
      }
    );

  assert.strictEqual(
    result.ok,
    true
  );

  assert.ok(
    receivedUrl.endsWith(
      "/listarWebhooksOperacionaisV12"
    )
  );

  assert.strictEqual(
    receivedOptions.method,
    "POST"
  );

  assert.strictEqual(
    receivedOptions
      .headers
      .Authorization,
    "Bearer route-token"
  );

  assert.deepStrictEqual(
    JSON.parse(
      receivedOptions.body
    ),
    {
      data: {
        limit: 20,
        status: "error"
      }
    }
  );

  const failed =
    await expectAsyncError(
      () =>
        callRouteAuthenticated(
          "obterSaudeOperacionalV12",
          {},
          {
            hostname:
              "localhost",

            idToken:
              "route-token",

            async fetchImpl() {
              return {
                ok: false,
                status: 403,

                async json() {
                  return {
                    error: {
                      status:
                        "PERMISSION_DENIED",

                      message:
                        "sensitive backend text",

                      details: {
                        secret:
                          "must-not-pass"
                      }
                    }
                  };
                }
              };
            }
          }
        ),
      "ADMIN_ROUTE_CALL_FAILED"
    );

  assert.deepStrictEqual(
    failed.details,
    {
      httpStatus: 403,
      callableStatus:
        "PERMISSION_DENIED"
    }
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        failed.details,
        "secret"
      ),
    false
  );

  console.log(
    "MARCO8_7B1_ROUTE_READ_ALLOWLIST=6/6"
  );

  console.log(
    "MARCO8_7B1_ROUTE_UNKNOWN_FUNCTION=BLOCKED"
  );

  console.log(
    "MARCO8_7B1_ROUTE_AUTHORITY_FIELDS=BLOCKED"
  );

  console.log(
    "MARCO8_7B1_ROUTE_TOKEN_REQUIRED=PASSED"
  );

  console.log(
    "MARCO8_7B1_ROUTE_PRODUCTION=BLOCKED"
  );

  console.log(
    "MARCO8_7B1_ROUTE_CALL=PASSED"
  );

  console.log(
    "MARCO8_7B1_ROUTE_ERROR_SANITIZATION=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
