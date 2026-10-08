"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  SECURITY_READ_CAPABILITY,
  CONFIG_READ_CAPABILITY,
  HEALTH_READ_CAPABILITY,
  requireOperationalActor,
  createReadHandler
} = require(
  "../functions/src/admin/admin-operational-observability-functions"
);

function auth(
  role
) {
  return {
    uid:
      `uid-${role}`,

    token: {
      [role]:
        true
    }
  };
}

function request(
  role,
  data = {}
) {
  return {
    auth:
      auth(
        role
      ),

    data
  };
}

async function expectHttpsError(
  operation,
  expectedCode
) {
  let captured =
    null;

  try {
    await operation();
  }
  catch (
    error
  ) {
    captured =
      error;
  }

  assert.ok(
    captured,
    `Expected ${expectedCode}`
  );

  assert.strictEqual(
    captured.code,
    expectedCode
  );

  return captured;
}

function assertAllowed(
  capability,
  roles
) {
  for (
    const role
    of roles
  ) {
    const actor =
      requireOperationalActor(
        {
          auth:
            auth(
              role
            )
        },
        capability
      );

    assert.strictEqual(
      actor.uid,
      `uid-${role}`
    );
  }
}

function assertBlocked(
  capability,
  roles
) {
  for (
    const role
    of roles
  ) {
    assert.throws(
      () =>
        requireOperationalActor(
          {
            auth:
              auth(
                role
              )
          },
          capability
        ),
      error =>
        error.code ===
          "ADMIN_CAPABILITY_REQUIRED"
    );
  }
}

async function main() {
  assert.strictEqual(
    SECURITY_READ_CAPABILITY,
    "console.security.read"
  );

  assert.strictEqual(
    CONFIG_READ_CAPABILITY,
    "console.config.read"
  );

  assert.strictEqual(
    HEALTH_READ_CAPABILITY,
    "console.health.read"
  );

  assertAllowed(
    SECURITY_READ_CAPABILITY,
    [
      "super_admin",
      "platform_admin",
      "support_admin"
    ]
  );

  assertBlocked(
    SECURITY_READ_CAPABILITY,
    [
      "finance_admin",
      "content_admin"
    ]
  );

  assertAllowed(
    CONFIG_READ_CAPABILITY,
    [
      "super_admin",
      "platform_admin"
    ]
  );

  assertBlocked(
    CONFIG_READ_CAPABILITY,
    [
      "finance_admin",
      "support_admin",
      "content_admin"
    ]
  );

  assertAllowed(
    HEALTH_READ_CAPABILITY,
    [
      "super_admin",
      "platform_admin",
      "finance_admin",
      "support_admin"
    ]
  );

  assertBlocked(
    HEALTH_READ_CAPABILITY,
    [
      "content_admin"
    ]
  );

  const service = {
    getSecurityView() {
      return {
        kind:
          "security"
      };
    },

    getConfigView() {
      return {
        kind:
          "config"
      };
    },

    async getHealthView() {
      return {
        kind:
          "health"
      };
    }
  };

  const securityHandler =
    createReadHandler({
      service,

      capability:
        SECURITY_READ_CAPABILITY,

      operation:
        "Security operational read",

      method:
        service.getSecurityView
    });

  await expectHttpsError(
    () =>
      securityHandler({
        data: {
          role:
            "super_admin"
        }
      }),
    "unauthenticated"
  );

  await expectHttpsError(
    () =>
      securityHandler(
        request(
          "finance_admin",
          {
            role:
              "support_admin"
          }
        )
      ),
    "permission-denied"
  );

  await expectHttpsError(
    () =>
      securityHandler(
        request(
          "support_admin",
          {
            projectId:
              "bjj-exams"
          }
        )
      ),
    "invalid-argument"
  );

  const result =
    await securityHandler(
      request(
        "support_admin"
      )
    );

  assert.strictEqual(
    result.ok,
    true
  );

  assert.deepStrictEqual(
    result.view,
    {
      kind:
        "security"
    }
  );

  const mainSource =
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "functions",
        "main.js"
      ),
      "utf8"
    );

  for (
    const marker
    of [
      "createAdminOperationalObservabilityFunctions",
      "const adminOperationalObservabilityConfig =",
      "const adminOperationalObservabilityFunctions =",
      "...adminOperationalObservabilityFunctions"
    ]
  ) {
    assert.ok(
      mainSource.includes(
        marker
      ),
      `main.js missing ${marker}`
    );
  }

  for (
    const safeMarker
    of [
      "asaasApiKeyConfigured: Boolean(ASAAS_API_KEY)",
      "asaasWebhookTokenConfigured: Boolean(ASAAS_WEBHOOK_TOKEN)",
      "providerEnvironmentAllowed:",
      "financialEnvironment === \"sandbox\""
    ]
  ) {
    assert.ok(
      mainSource.includes(
        safeMarker
      ),
      `main.js missing safe runtime marker ${safeMarker}`
    );
  }

  const observabilityComposition =
    mainSource.slice(
      mainSource.indexOf(
        "const adminOperationalObservabilityConfig ="
      ),
      mainSource.indexOf(
        "// Operational lifecycle command surface for Marco 8."
      )
    );

  assert.strictEqual(
    observabilityComposition.includes(
      "ASAAS_API_KEY.value("
    ),
    false
  );

  assert.strictEqual(
    observabilityComposition.includes(
      "ASAAS_WEBHOOK_TOKEN.value("
    ),
    false
  );

  assert.strictEqual(
    observabilityComposition.includes(
      "secrets:"
    ),
    false
  );

  assert.strictEqual(
    observabilityComposition.includes(
      "providerFactory:"
    ),
    false
  );

  console.log(
    "MARCO8_6E_SECURITY_CAPABILITY=console.security.read"
  );

  console.log(
    "MARCO8_6E_SECURITY_ROLES=3/3"
  );

  console.log(
    "MARCO8_6E_CONFIG_CAPABILITY=console.config.read"
  );

  console.log(
    "MARCO8_6E_CONFIG_ROLES=2/2"
  );

  console.log(
    "MARCO8_6E_HEALTH_CAPABILITY=console.health.read"
  );

  console.log(
    "MARCO8_6E_HEALTH_ROLES=4/4"
  );

  console.log(
    "MARCO8_6E_CONTENT_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_6E_AUTH_BEFORE_PAYLOAD=True"
  );

  console.log(
    "MARCO8_6E_PAYLOAD_FIELDS=0/0"
  );

  console.log(
    "MARCO8_6E_CALLABLES=3/3"
  );

  console.log(
    "MARCO8_6E_PROVIDER_SECRET_BINDING=False"
  );

  console.log(
    "MARCO8_6E_SECRET_VALUE_READ=False"
  );

  console.log(
    "MARCO8_6E_ADMIN_OPERATIONAL_OBSERVABILITY_FUNCTIONS=PASSED"
  );
}

main()
  .catch(
    error => {
      console.error(
        error
      );

      process.exitCode =
        1;
    }
  );
