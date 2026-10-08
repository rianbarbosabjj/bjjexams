"use strict";

const assert =
  require("assert");


const {
  AdminPeopleReadError
} = require(
  "../functions/src/admin/admin-people-read-service"
);

const {
  PEOPLE_READ_CAPABILITY,
  assertOnlyFields,
  requirePeopleReadActor,
  mapPeopleReadError,
  createListPeopleHandler,
  createGetPersonHandler
} = require(
  "../functions/src/admin/admin-people-read-functions"
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
    PEOPLE_READ_CAPABILITY,
    "ops.people.read"
  );

  assert.deepStrictEqual(
    assertOnlyFields(
      {
        limit: 10,
        cursor: "abc",
        profileType:
          "student",
        operationalStatus:
          "active"
      },
      [
        "limit",
        "cursor",
        "profileType",
        "operationalStatus"
      ],
      "People listing"
    ),
    {
      limit: 10,
      cursor: "abc",
      profileType:
        "student",
      operationalStatus:
        "active"
    }
  );

  assert.throws(
    () =>
      assertOnlyFields(
        {
          role:
            "super_admin"
        },
        [
          "limit",
          "cursor",
          "profileType",
          "operationalStatus"
        ],
        "People listing"
      ),
    error =>
      typeof error?.code ===
        "string" &&
      error.code ===
        "invalid-argument" &&
      Array.isArray(
        error.details
          ?.forbiddenFields
      ) &&
      error.details
        .forbiddenFields
        .includes(
          "role"
        )
  );

  const actor =
    requirePeopleReadActor({
      auth:
        supportAuth()
    });

  assert.strictEqual(
    actor.uid,
    "support-1"
  );

  assert.throws(
    () =>
      requirePeopleReadActor({
        auth: null
      }),
    error =>
      typeof error?.code ===
        "string" &&
      error.code ===
        "unauthenticated"
  );

  assert.throws(
    () =>
      requirePeopleReadActor({
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
      error.code ===
        "ADMIN_CAPABILITY_REQUIRED"
  );

  assert.throws(
    () =>
      requirePeopleReadActor({
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
      error.code ===
        "ADMIN_CAPABILITY_REQUIRED"
  );

  let listCalls = 0;
  let getCalls = 0;

  const service = {
    async listPeople(
      input
    ) {
      listCalls += 1;

      assert.deepStrictEqual(
        input,
        {
          limit: 10,
          cursor:
            "cursor-1",

          profileType:
            "student",

          operationalStatus:
            "active"
        }
      );

      return {
        limit: 10,

        items: [
          {
            personId:
              "person-a",

            displayName:
              "Ana"
          }
        ],

        nextCursor:
          "cursor-2"
      };
    },

    async getPerson(
      input
    ) {
      getCalls += 1;

      assert.deepStrictEqual(
        input,
        {
          personId:
            "person-a"
        }
      );

      return {
        person: {
          personId:
            "person-a",

          displayName:
            "Ana"
        }
      };
    }
  };

  const listHandler =
    createListPeopleHandler({
      service
    });

  const getHandler =
    createGetPersonHandler({
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

        profileType:
          "student",

        operationalStatus:
          "active"
      }
    });

  assert.deepStrictEqual(
    listResult,
    {
      ok: true,
      limit: 10,

      items: [
        {
          personId:
            "person-a",

          displayName:
            "Ana"
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
        personId:
          "person-a"
      }
    });

  assert.deepStrictEqual(
    getResult,
    {
      ok: true,

      person: {
        personId:
          "person-a",

        displayName:
          "Ana"
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
            "ops.people.manage"
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
              "ops.people.read"
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
          personId:
            "person-a"
        }
      }),
    "unauthenticated"
  );

  assert.strictEqual(
    getCalls,
    1
  );

  const invalidArgumentError =
    await expectHttpsError(
      async () => {
        mapPeopleReadError(
          new AdminPeopleReadError(
            "ADMIN_PEOPLE_CURSOR_INVALID",
            "invalid cursor"
          )
        );
      },
      "invalid-argument"
    );

  assert.strictEqual(
    invalidArgumentError
      .details
      .domainCode,
    "ADMIN_PEOPLE_CURSOR_INVALID"
  );

  const filterError =
    await expectHttpsError(
      async () => {
        mapPeopleReadError(
          new AdminPeopleReadError(
            "ADMIN_PEOPLE_FILTER_INVALID",
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
    "ADMIN_PEOPLE_FILTER_INVALID"
  );

  const notFoundError =
    await expectHttpsError(
      async () => {
        mapPeopleReadError(
          new AdminPeopleReadError(
            "ADMIN_PERSON_NOT_FOUND",
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
    "ADMIN_PERSON_NOT_FOUND"
  );

  const canonicalError =
    await expectHttpsError(
      async () => {
        mapPeopleReadError(
          new AdminPeopleReadError(
            "ADMIN_PEOPLE_CANONICAL_STATE_INVALID",
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
    "ADMIN_PEOPLE_CANONICAL_STATE_INVALID"
  );

  await expectHttpsError(
    async () => {
      mapPeopleReadError(
        new Error(
          "raw internal details"
        )
      );
    },
    "internal"
  );

  assert.throws(
    () =>
      createListPeopleHandler({
        service: {}
      }),
    TypeError
  );

  assert.throws(
    () =>
      createGetPersonHandler({
        service: {}
      }),
    TypeError
  );

  console.log(
    "MARCO8_PEOPLE_CALLABLE_CAPABILITY=ops.people.read"
  );

  console.log(
    "MARCO8_PEOPLE_CALLABLE_AUTH=PASSED"
  );

  console.log(
    "MARCO8_PEOPLE_CALLABLE_SUPPORT_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_PEOPLE_CALLABLE_FINANCE_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_PEOPLE_CALLABLE_CONTENT_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_PEOPLE_CALLABLE_ORG_ROLE_ESCALATION=BLOCKED"
  );

  console.log(
    "MARCO8_PEOPLE_CALLABLE_CLIENT_CAPABILITY_INPUT=BLOCKED"
  );

  console.log(
    "MARCO8_PEOPLE_CALLABLE_LIST_FIELDS=4/4"
  );

  console.log(
    "MARCO8_PEOPLE_CALLABLE_FILTER_ALLOWLIST=2/2"
  );

  console.log(
    "MARCO8_PEOPLE_CALLABLE_DETAIL_FIELDS=1/1"
  );

  console.log(
    "MARCO8_PEOPLE_CALLABLE_ERROR_MAPPING=PASSED"
  );

  console.log(
    "MARCO8_PEOPLE_READ_CALLABLES=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
