"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  WEBHOOKS_REPROCESS_CAPABILITY,
  requireWebhookReprocessActor,
  createReprocessWebhookHandler
} = require(
  "../functions/src/admin/admin-webhooks-reprocess-functions"
);

const {
  AdminWebhooksReprocessServiceError
} = require(
  "../functions/src/admin/admin-webhooks-reprocess-service"
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
  catch (error) {
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

async function main() {
  assert.strictEqual(
    WEBHOOKS_REPROCESS_CAPABILITY,
    "console.webhooks.reprocess"
  );

  for (
    const role
    of [
      "super_admin",
      "finance_admin"
    ]
  ) {
    const actor =
      requireWebhookReprocessActor({
        auth:
          auth(
            role
          )
      });

    assert.strictEqual(
      actor.uid,
      `uid-${role}`
    );

    assert.strictEqual(
      actor.actorRole,
      role
    );
  }

  for (
    const role
    of [
      "platform_admin",
      "support_admin",
      "content_admin"
    ]
  ) {
    assert.throws(
      () =>
        requireWebhookReprocessActor({
          auth:
            auth(
              role
            )
        }),
      error =>
        error.code ===
          "ADMIN_CAPABILITY_REQUIRED"
    );
  }

  const calls =
    [];

  const service = {
    async reprocessWebhook(
      input
    ) {
      calls.push(
        input
      );

      return {
        accepted:
          true,

        idempotent:
          false,

        eventId:
          input.eventId,

        requestId:
          input.requestId,

        reprocessCount:
          1,

        status:
          "processed",

        outcome:
          "processed",

        errorCode:
          null
      };
    }
  };

  const handler =
    createReprocessWebhookHandler({
      service
    });

  await expectHttpsError(
    () =>
      handler({
        data: {
          eventId:
            "event-1",

          requestId:
            "request-1",

          role:
            "super_admin"
        }
      }),
    "unauthenticated"
  );

  await expectHttpsError(
    () =>
      handler(
        request(
          "platform_admin",
          {
            eventId:
              "event-1",

            requestId:
              "request-1",

            role:
              "finance_admin"
          }
        )
      ),
    "permission-denied"
  );

  await expectHttpsError(
    () =>
      handler(
        request(
          "finance_admin",
          {
            eventId:
              "event-1",

            requestId:
              "request-1",

            role:
              "super_admin"
          }
        )
      ),
    "invalid-argument"
  );

  const result =
    await handler(
      request(
        "finance_admin",
        {
          eventId:
            "event-1",

          requestId:
            "request-1"
        }
      )
    );

  assert.strictEqual(
    result.ok,
    true
  );

  assert.strictEqual(
    result.status,
    "processed"
  );

  assert.deepStrictEqual(
    calls,
    [
      {
        eventId:
          "event-1",

        requestId:
          "request-1",

        actorUid:
          "uid-finance_admin",

        actorRole:
          "finance_admin"
      }
    ]
  );

  const failingService = {
    async reprocessWebhook() {
      throw new AdminWebhooksReprocessServiceError(
        "ADMIN_WEBHOOK_REPROCESS_IN_FLIGHT",
        "in flight"
      );
    }
  };

  await expectHttpsError(
    () =>
      createReprocessWebhookHandler({
        service:
          failingService
      })(
        request(
          "finance_admin",
          {
            eventId:
              "event-1",

            requestId:
              "request-2"
          }
        )
      ),
    "failed-precondition"
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
      'createAdminWebhooksReprocessFunctions',
      'const adminWebhooksReprocessFunctions =',
      'providerFactory: checkoutProviderFactory',
      'secrets: checkoutSecrets',
      '...adminWebhooksReprocessFunctions'
    ]
  ) {
    assert.ok(
      mainSource.includes(
        marker
      ),
      `main.js missing ${marker}`
    );
  }

  assert.ok(
    mainSource.includes(
      "adminRuntimeAllowed"
    )
  );

  const functionsSource =
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "functions",
        "src",
        "admin",
        "admin-webhooks-reprocess-functions.js"
      ),
      "utf8"
    );

  assert.ok(
    functionsSource.includes(
      "createWebhookWorkerHandler"
    )
  );

  assert.ok(
    functionsSource.includes(
      "eventData"
    )
  );

  assert.strictEqual(
    functionsSource.includes(
      "ASAAS_WEBHOOK_TOKEN"
    ),
    false
  );

  console.log(
    "MARCO8_6C_REPROCESS_CAPABILITY=console.webhooks.reprocess"
  );

  console.log(
    "MARCO8_6C_REPROCESS_ROLES=2/2"
  );

  console.log(
    "MARCO8_6C_PLATFORM_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_6C_SUPPORT_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_6C_CONTENT_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_6C_AUTH_BEFORE_PAYLOAD=True"
  );

  console.log(
    "MARCO8_6C_PAYLOAD_FIELDS=2/2"
  );

  console.log(
    "MARCO8_6C_SHARED_WORKER=createWebhookWorkerHandler"
  );

  console.log(
    "MARCO8_6C_PROVIDER_FACTORY=EXISTING"
  );

  console.log(
    "MARCO8_6C_PROVIDER_SECRET=CHECKOUT_SECRETS_ONLY"
  );

  console.log(
    "MARCO8_6C_ADMIN_REPROCESS_FUNCTIONS=PASSED"
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
