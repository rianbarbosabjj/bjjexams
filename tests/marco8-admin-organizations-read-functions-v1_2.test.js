"use strict";

const assert =
  require("assert");

const {
  AdminOrganizationsReadError
} = require(
  "../functions/src/admin/admin-organizations-read-service"
);

const {
  ORGANIZATIONS_READ_CAPABILITY,
  assertOnlyFields,
  requireOrganizationsReadActor,
  mapOrganizationsReadError,
  createListOrganizationsHandler,
  createGetOrganizationHandler
} = require(
  "../functions/src/admin/admin-organizations-read-functions"
);

function supportAuth() {
  return {
    uid:
      "support-1",

    token: {
      support_admin:
        true
    }
  };
}

async function expectHttpsError(
  operation,
  expectedCode
) {
  let received = null;

  try {
    await operation();
  }
  catch (error) {
    received =
      error;
  }

  assert.ok(
    received,
    `Expected ${expectedCode}`
  );

  assert.strictEqual(
    typeof received?.code,
    "string"
  );

  assert.strictEqual(
    received.code,
    expectedCode
  );

  return received;
}

async function main() {
  assert.strictEqual(
    ORGANIZATIONS_READ_CAPABILITY,
    "ops.organizations.read"
  );

  assert.deepStrictEqual(
    assertOnlyFields(
      {
        limit: 10,
        cursor:
          "cursor-1",
        status:
          "active",
        nameQuery:
          "alfa"
      },
      [
        "limit",
        "cursor",
        "status",
        "nameQuery"
      ],
      "Organization listing"
    ),
    {
      limit: 10,
      cursor:
        "cursor-1",
      status:
        "active",
      nameQuery:
        "alfa"
    }
  );

  assert.throws(
    () =>
      assertOnlyFields(
        {
          collectionName:
            "usuarios"
        },
        [
          "limit",
          "cursor",
          "status",
          "nameQuery"
        ],
        "Organization listing"
      ),
    error =>
      error?.code ===
        "invalid-argument" &&
      Array.isArray(
        error.details
          ?.forbiddenFields
      ) &&
      error.details
        .forbiddenFields
        .includes(
          "collectionName"
        )
  );

  const actor =
    requireOrganizationsReadActor({
      auth:
        supportAuth()
    });

  assert.strictEqual(
    actor.uid,
    "support-1"
  );

  assert.throws(
    () =>
      requireOrganizationsReadActor({
        auth: null
      }),
    error =>
      error?.code ===
        "unauthenticated"
  );

  assert.throws(
    () =>
      requireOrganizationsReadActor({
        auth: {
          uid:
            "finance-1",

          token: {
            finance_admin:
              true
          }
        }
      }),
    error =>
      error?.code ===
        "ADMIN_CAPABILITY_REQUIRED"
  );

  assert.throws(
    () =>
      requireOrganizationsReadActor({
        auth: {
          uid:
            "content-1",

          token: {
            content_admin:
              true
          }
        }
      }),
    error =>
      error?.code ===
        "ADMIN_CAPABILITY_REQUIRED"
  );

  assert.throws(
    () =>
      requireOrganizationsReadActor({
        auth: {
          uid:
            "org-owner",

          token: {
            organization_role:
              "owner"
          }
        }
      }),
    error =>
      error?.code ===
        "ADMIN_CAPABILITY_REQUIRED"
  );

  let listCalls = 0;
  let getCalls = 0;

  const service = {
    async listOrganizations(
      input
    ) {
      listCalls += 1;

      assert.deepStrictEqual(
        input,
        {
          limit: 10,

          cursor:
            "cursor-1",

          status:
            "active",

          nameQuery:
            "alfa"
        }
      );

      return {
        limit: 10,

        items: [
          {
            organizationId:
              "org-a",

            name:
              "Academia Alfa"
          }
        ],

        nextCursor:
          "cursor-2"
      };
    },

    async getOrganization(
      input
    ) {
      getCalls += 1;

      assert.deepStrictEqual(
        input,
        {
          organizationId:
            "org-a"
        }
      );

      return {
        organization: {
          organizationId:
            "org-a",

          name:
            "Academia Alfa"
        }
      };
    }
  };

  const listHandler =
    createListOrganizationsHandler({
      service
    });

  const getHandler =
    createGetOrganizationHandler({
      service
    });

  const listResult =
    await listHandler({
      auth:
        supportAuth(),

      data: {
        limit: 10,

        cursor:
          "cursor-1",

        status:
          "active",

        nameQuery:
          "alfa"
      }
    });

  assert.deepStrictEqual(
    listResult,
    {
      ok: true,
      limit: 10,

      items: [
        {
          organizationId:
            "org-a",

          name:
            "Academia Alfa"
        }
      ],

      nextCursor:
        "cursor-2"
    }
  );

  assert.strictEqual(
    listCalls,
    1
  );

  const getResult =
    await getHandler({
      auth:
        supportAuth(),

      data: {
        organizationId:
          "org-a"
      }
    });

  assert.deepStrictEqual(
    getResult,
    {
      ok: true,

      organization: {
        organizationId:
          "org-a",

        name:
          "Academia Alfa"
      }
    }
  );

  assert.strictEqual(
    getCalls,
    1
  );

  await expectHttpsError(
    () =>
      listHandler({
        auth:
          supportAuth(),

        data: {
          limit: 10,

          capability:
            "ops.organizations.manage"
        }
      }),
    "invalid-argument"
  );

  assert.strictEqual(
    listCalls,
    1
  );

  await expectHttpsError(
    () =>
      listHandler({
        auth: {
          uid:
            "finance-1",

          token: {
            finance_admin:
              true
          }
        },

        data: {
          limit: 10
        }
      }),
    "permission-denied"
  );

  assert.strictEqual(
    listCalls,
    1
  );

  await expectHttpsError(
    () =>
      listHandler({
        auth: {
          uid:
            "content-1",

          token: {
            content_admin:
              true,

            capability:
              "ops.organizations.read"
          }
        },

        data: {}
      }),
    "permission-denied"
  );

  assert.strictEqual(
    listCalls,
    1
  );

  await expectHttpsError(
    () =>
      getHandler({
        auth: null,

        data: {
          organizationId:
            "org-a"
        }
      }),
    "unauthenticated"
  );

  assert.strictEqual(
    getCalls,
    1
  );

  const filterError =
    await expectHttpsError(
      async () => {
        mapOrganizationsReadError(
          new AdminOrganizationsReadError(
            "ADMIN_ORGANIZATIONS_FILTER_INVALID",
            "invalid filter"
          )
        );
      },
      "invalid-argument"
    );

  assert.strictEqual(
    filterError
      .details
      .domainCode,
    "ADMIN_ORGANIZATIONS_FILTER_INVALID"
  );

  const cursorError =
    await expectHttpsError(
      async () => {
        mapOrganizationsReadError(
          new AdminOrganizationsReadError(
            "ADMIN_ORGANIZATIONS_CURSOR_INVALID",
            "invalid cursor"
          )
        );
      },
      "invalid-argument"
    );

  assert.strictEqual(
    cursorError
      .details
      .domainCode,
    "ADMIN_ORGANIZATIONS_CURSOR_INVALID"
  );

  const notFoundError =
    await expectHttpsError(
      async () => {
        mapOrganizationsReadError(
          new AdminOrganizationsReadError(
            "ADMIN_ORGANIZATION_NOT_FOUND",
            "not found"
          )
        );
      },
      "not-found"
    );

  assert.strictEqual(
    notFoundError
      .details
      .domainCode,
    "ADMIN_ORGANIZATION_NOT_FOUND"
  );

  const canonicalError =
    await expectHttpsError(
      async () => {
        mapOrganizationsReadError(
          new AdminOrganizationsReadError(
            "ADMIN_ORGANIZATIONS_CANONICAL_STATE_INVALID",
            "invalid state"
          )
        );
      },
      "failed-precondition"
    );

  assert.strictEqual(
    canonicalError
      .details
      .domainCode,
    "ADMIN_ORGANIZATIONS_CANONICAL_STATE_INVALID"
  );

  await expectHttpsError(
    async () => {
      mapOrganizationsReadError(
        new Error(
          "raw internal implementation details"
        )
      );
    },
    "internal"
  );

  assert.throws(
    () =>
      createListOrganizationsHandler({
        service: {}
      }),
    TypeError
  );

  assert.throws(
    () =>
      createGetOrganizationHandler({
        service: {}
      }),
    TypeError
  );

  console.log(
    "MARCO8_ORGANIZATION_CALLABLE_CAPABILITY=ops.organizations.read"
  );

  console.log(
    "MARCO8_ORGANIZATION_CALLABLE_AUTH=PASSED"
  );

  console.log(
    "MARCO8_ORGANIZATION_CALLABLE_SUPPORT_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_ORGANIZATION_CALLABLE_FINANCE_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_ORGANIZATION_CALLABLE_CONTENT_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_ORGANIZATION_CALLABLE_ORG_ROLE_ESCALATION=BLOCKED"
  );

  console.log(
    "MARCO8_ORGANIZATION_CALLABLE_CLIENT_CAPABILITY_INPUT=BLOCKED"
  );

  console.log(
    "MARCO8_ORGANIZATION_CALLABLE_LIST_FIELDS=4/4"
  );

  console.log(
    "MARCO8_ORGANIZATION_CALLABLE_DETAIL_FIELDS=1/1"
  );

  console.log(
    "MARCO8_ORGANIZATION_CALLABLE_ERROR_MAPPING=PASSED"
  );

  console.log(
    "MARCO8_ORGANIZATION_READ_CALLABLES=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
