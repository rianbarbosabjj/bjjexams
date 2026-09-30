"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  AUDIT_READ_CAPABILITY,
  requireAuditReadActor,
  createListAuditHandler
} = require(
  "../functions/src/admin/admin-audit-read-functions"
);

const {
  AdminAuditReadError
} = require(
  "../functions/src/admin/admin-audit-read-service"
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

async function main() {
  assert.strictEqual(
    AUDIT_READ_CAPABILITY,
    "console.audit.read"
  );

  for (
    const role
    of [
      "super_admin",
      "platform_admin",
      "finance_admin",
      "support_admin"
    ]
  ) {
    const actor =
      requireAuditReadActor({
        auth:
          auth(
            role
          )
      });

    assert.strictEqual(
      actor.uid,
      `uid-${role}`
    );
  }

  assert.throws(
    () =>
      requireAuditReadActor({
        auth:
          auth(
            "content_admin"
          )
      }),
    error =>
      error.code ===
        "ADMIN_CAPABILITY_REQUIRED"
  );

  const calls = [];

  const service = {
    async listAuditEvents(
      input
    ) {
      calls.push(
        input
      );

      return {
        limit:
          input.limit ||
          20,

        items: [
          {
            auditId:
              "audit-1"
          }
        ],

        nextCursor:
          null
      };
    }
  };

  const handler =
    createListAuditHandler({
      service
    });

  await expectHttpsError(
    () =>
      handler({
        data: {
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
          "content_admin",
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
      handler(
        request(
          "support_admin",
          {
            limit:
              10,

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
        "support_admin",
        {
          limit:
            10,

          cursor:
            "cursor-1",

          eventType:
            "admin.organization.suspended",

          actorUid:
            "admin-org",

          targetType:
            "organization",

          targetId:
            "org-1",

          organizationId:
            "org-1"
        }
      )
    );

  assert.strictEqual(
    result.ok,
    true
  );

  assert.deepStrictEqual(
    calls,
    [
      {
        limit:
          10,

        cursor:
          "cursor-1",

        eventType:
          "admin.organization.suspended",

        actorUid:
          "admin-org",

        targetType:
          "organization",

        targetId:
          "org-1",

        organizationId:
          "org-1"
      }
    ]
  );

  const failingService = {
    async listAuditEvents() {
      throw new AdminAuditReadError(
        "ADMIN_AUDIT_CURSOR_INVALID",
        "cursor invalid"
      );
    }
  };

  await expectHttpsError(
    () =>
      createListAuditHandler({
        service:
          failingService
      })(
        request(
          "support_admin"
        )
      ),
    "invalid-argument"
  );

  const canonicalFailureService = {
    async listAuditEvents() {
      throw new AdminAuditReadError(
        "ADMIN_AUDIT_CANONICAL_STATE_INVALID",
        "canonical invalid"
      );
    }
  };

  await expectHttpsError(
    () =>
      createListAuditHandler({
        service:
          canonicalFailureService
      })(
        request(
          "finance_admin"
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
      "createAdminAuditReadFunctions",
      "const adminAuditReadFunctions =",
      "...adminAuditReadFunctions"
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

  assert.strictEqual(
    mainSource.includes(
      "createAdminAuditReadFunctions({\n        REGION,\n        db,\n        secrets:"
    ),
    false
  );

  console.log(
    "MARCO8_6D_AUDIT_CAPABILITY=console.audit.read"
  );

  console.log(
    "MARCO8_6D_AUDIT_READ_ROLES=4/4"
  );

  console.log(
    "MARCO8_6D_CONTENT_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_6D_AUTH_BEFORE_PAYLOAD=True"
  );

  console.log(
    "MARCO8_6D_CLIENT_AUTHORIZATION_ESCALATION=BLOCKED"
  );

  console.log(
    "MARCO8_6D_LIST_FIELDS=7/7"
  );

  console.log(
    "MARCO8_6D_CALLABLES=1/1"
  );

  console.log(
    "MARCO8_6D_MAIN_COMPOSITION=PASSED"
  );

  console.log(
    "MARCO8_6D_PROVIDER_SECRET_BINDING=False"
  );

  console.log(
    "MARCO8_6D_ADMIN_AUDIT_READ_FUNCTIONS=PASSED"
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
