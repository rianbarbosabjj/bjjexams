"use strict";

const assert =
  require("assert");

const {
  AdminAccessPolicyError
} = require(
  "../functions/src/admin/admin-access-policy"
);

const {
  AdminLifecycleDomainError
} = require(
  "../functions/src/admin/admin-lifecycle-domain"
);

const {
  AdminLifecycleServiceError
} = require(
  "../functions/src/admin/admin-lifecycle-service"
);

const {
  PEOPLE_MANAGE_CAPABILITY,
  ORGANIZATIONS_MANAGE_CAPABILITY,
  LIFECYCLE_COMMANDS,
  assertOnlyFields,
  resolveActorRoleForCapability,
  requireLifecycleActor,
  createServerRequestId,
  mapLifecycleCommandError,
  createLifecycleCommandHandler
} = require(
  "../functions/src/admin/admin-lifecycle-functions"
);

function platformAuth() {
  return {
    uid:
      "platform-admin-1",

    token: {
      platform_admin:
        true
    }
  };
}

function superAuth() {
  return {
    uid:
      "super-admin-1",

    token: {
      super_admin:
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
    PEOPLE_MANAGE_CAPABILITY,
    "ops.people.manage"
  );

  assert.strictEqual(
    ORGANIZATIONS_MANAGE_CAPABILITY,
    "ops.organizations.manage"
  );

  assert.deepStrictEqual(
    LIFECYCLE_COMMANDS
      .suspenderPessoaOperacionalV12,
    {
      capability:
        "ops.people.manage",

      entityType:
        "person",

      targetStatus:
        "suspended",

      idField:
        "personId",

      operation:
        "Suspend operational person"
    }
  );

  assert.deepStrictEqual(
    LIFECYCLE_COMMANDS
      .reativarOrganizacaoOperacionalV12,
    {
      capability:
        "ops.organizations.manage",

      entityType:
        "organization",

      targetStatus:
        "active",

      idField:
        "organizationId",

      operation:
        "Reactivate operational organization"
    }
  );

  // Signed-role derivation only.

  assert.strictEqual(
    resolveActorRoleForCapability(
      {
        platform_admin:
          true
      },
      PEOPLE_MANAGE_CAPABILITY
    ),
    "platform_admin"
  );

  assert.strictEqual(
    resolveActorRoleForCapability(
      {
        super_admin:
          true,
        platform_admin:
          true
      },
      ORGANIZATIONS_MANAGE_CAPABILITY
    ),
    "super_admin"
  );

  assert.throws(
    () =>
      resolveActorRoleForCapability(
        {
          support_admin:
            true,
          capability:
            "ops.people.manage"
        },
        PEOPLE_MANAGE_CAPABILITY
      ),
    error =>
      error instanceof
        AdminAccessPolicyError &&
      error.code ===
        "ADMIN_CAPABILITY_REQUIRED"
  );

  // Actor authentication/authorization.

  assert.deepStrictEqual(
    requireLifecycleActor(
      {
        auth:
          platformAuth()
      },
      PEOPLE_MANAGE_CAPABILITY
    ),
    {
      uid:
        "platform-admin-1",

      actorRole:
        "platform_admin"
    }
  );

  assert.throws(
    () =>
      requireLifecycleActor(
        {
          auth: null
        },
        PEOPLE_MANAGE_CAPABILITY
      ),
    error =>
      error?.code ===
        "unauthenticated"
  );

  for (
    const token
    of [
      {
        support_admin:
          true
      },
      {
        finance_admin:
          true
      },
      {
        content_admin:
          true
      },
      {
        organization_role:
          "owner"
      }
    ]
  ) {
    assert.throws(
      () =>
        requireLifecycleActor(
          {
            auth: {
              uid:
                "blocked-actor",
              token
            }
          },
          PEOPLE_MANAGE_CAPABILITY
        ),
      error =>
        error?.code ===
          "ADMIN_CAPABILITY_REQUIRED"
    );
  }

  // Strict payload allow-list.

  assert.deepStrictEqual(
    assertOnlyFields(
      {
        personId:
          "person-1"
      },
      [
        "personId"
      ],
      "Suspend operational person"
    ),
    {
      personId:
        "person-1"
    }
  );

  assert.throws(
    () =>
      assertOnlyFields(
        [
          "person-1"
        ],
        [
          "personId"
        ],
        "Suspend operational person"
      ),
    error =>
      error?.code ===
        "invalid-argument"
  );

  assert.throws(
    () =>
      assertOnlyFields(
        {
          personId:
            "person-1",

          actorRole:
            "super_admin",

          entityType:
            "organization",

          targetStatus:
            "active",

          requestId:
            "client-request",

          capability:
            "ops.people.manage"
        },
        [
          "personId"
        ],
        "Suspend operational person"
      ),
    error =>
      error?.code ===
        "invalid-argument" &&
      [
        "actorRole",
        "capability",
        "entityType",
        "requestId",
        "targetStatus"
      ].every(
        field =>
          error.details
            ?.forbiddenFields
            ?.includes(
              field
            )
      )
  );

  // Server request IDs.

  assert.strictEqual(
    createServerRequestId(
      () =>
        "server-request-1"
    ),
    "server-request-1"
  );

  assert.throws(
    () =>
      createServerRequestId(
        () =>
          "bad/request"
      ),
    error =>
      error?.code ===
        "internal"
  );

  // Four command handlers.

  const calls = [];

  const service = {
    async mutateLifecycle(
      input
    ) {
      calls.push(
        input
      );

      return {
        changed:
          true,

        idempotent:
          false,

        entityType:
          input.entityType,

        entityId:
          input.entityId,

        status:
          input.targetStatus,

        auditId:
          `audit-${calls.length}`
      };
    }
  };

  let requestSequence = 0;

  function requestIdFactory() {
    requestSequence += 1;

    return (
      `server-request-${requestSequence}`
    );
  }

  const suspendPerson =
    createLifecycleCommandHandler({
      service,

      command:
        LIFECYCLE_COMMANDS
          .suspenderPessoaOperacionalV12,

      requestIdFactory
    });

  const reactivatePerson =
    createLifecycleCommandHandler({
      service,

      command:
        LIFECYCLE_COMMANDS
          .reativarPessoaOperacionalV12,

      requestIdFactory
    });

  const suspendOrganization =
    createLifecycleCommandHandler({
      service,

      command:
        LIFECYCLE_COMMANDS
          .suspenderOrganizacaoOperacionalV12,

      requestIdFactory
    });

  const reactivateOrganization =
    createLifecycleCommandHandler({
      service,

      command:
        LIFECYCLE_COMMANDS
          .reativarOrganizacaoOperacionalV12,

      requestIdFactory
    });

  const result1 =
    await suspendPerson({
      auth:
        platformAuth(),

      data: {
        personId:
          "person-1"
      }
    });

  assert.strictEqual(
    result1.ok,
    true
  );

  const result2 =
    await reactivatePerson({
      auth:
        platformAuth(),

      data: {
        personId:
          "person-2"
      }
    });

  assert.strictEqual(
    result2.status,
    "active"
  );

  const result3 =
    await suspendOrganization({
      auth:
        superAuth(),

      data: {
        organizationId:
          "org-1"
      }
    });

  assert.strictEqual(
    result3.status,
    "suspended"
  );

  const result4 =
    await reactivateOrganization({
      auth:
        superAuth(),

      data: {
        organizationId:
          "org-2"
      }
    });

  assert.strictEqual(
    result4.status,
    "active"
  );

  assert.deepStrictEqual(
    calls,
    [
      {
        entityType:
          "person",

        entityId:
          "person-1",

        targetStatus:
          "suspended",

        actorId:
          "platform-admin-1",

        actorRole:
          "platform_admin",

        requestId:
          "server-request-1"
      },

      {
        entityType:
          "person",

        entityId:
          "person-2",

        targetStatus:
          "active",

        actorId:
          "platform-admin-1",

        actorRole:
          "platform_admin",

        requestId:
          "server-request-2"
      },

      {
        entityType:
          "organization",

        entityId:
          "org-1",

        targetStatus:
          "suspended",

        actorId:
          "super-admin-1",

        actorRole:
          "super_admin",

        requestId:
          "server-request-3"
      },

      {
        entityType:
          "organization",

        entityId:
          "org-2",

        targetStatus:
          "active",

        actorId:
          "super-admin-1",

        actorRole:
          "super_admin",

        requestId:
          "server-request-4"
      }
    ]
  );

  // Authorization happens before payload inspection.

  const callsBeforeUnauth =
    calls.length;

  await expectHttpsError(
    () =>
      suspendPerson({
        auth: null,

        data: {
          actorRole:
            "super_admin"
        }
      }),
    "unauthenticated"
  );

  assert.strictEqual(
    calls.length,
    callsBeforeUnauth
  );

  // Client cannot forge a capability in signed token either.

  await expectHttpsError(
    () =>
      suspendPerson({
        auth: {
          uid:
            "support-1",

          token: {
            support_admin:
              true,

            capability:
              "ops.people.manage"
          }
        },

        data: {
          personId:
            "person-1"
        }
      }),
    "permission-denied"
  );

  assert.strictEqual(
    calls.length,
    callsBeforeUnauth
  );

  // Client cannot control audit/server fields.

  await expectHttpsError(
    () =>
      suspendPerson({
        auth:
          platformAuth(),

        data: {
          personId:
            "person-1",

          actorId:
            "another-user",

          actorRole:
            "super_admin",

          requestId:
            "client-request",

          entityType:
            "organization",

          targetStatus:
            "active"
        }
      }),
    "invalid-argument"
  );

  assert.strictEqual(
    calls.length,
    callsBeforeUnauth
  );

  // Error mapping.

  const inputError =
    await expectHttpsError(
      async () => {
        mapLifecycleCommandError(
          new AdminLifecycleDomainError(
            "ADMIN_LIFECYCLE_INPUT_INVALID",
            "invalid input"
          )
        );
      },
      "invalid-argument"
    );

  assert.strictEqual(
    inputError
      .details
      .domainCode,
    "ADMIN_LIFECYCLE_INPUT_INVALID"
  );

  const transitionError =
    await expectHttpsError(
      async () => {
        mapLifecycleCommandError(
          new AdminLifecycleDomainError(
            "ADMIN_LIFECYCLE_TRANSITION_INVALID",
            "invalid transition"
          )
        );
      },
      "failed-precondition"
    );

  assert.strictEqual(
    transitionError
      .details
      .domainCode,
    "ADMIN_LIFECYCLE_TRANSITION_INVALID"
  );

  const notFoundError =
    await expectHttpsError(
      async () => {
        mapLifecycleCommandError(
          new AdminLifecycleServiceError(
            "ADMIN_LIFECYCLE_TARGET_NOT_FOUND",
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
    "ADMIN_LIFECYCLE_TARGET_NOT_FOUND"
  );

  await expectHttpsError(
    async () => {
      mapLifecycleCommandError(
        new Error(
          "raw internal details"
        )
      );
    },
    "internal"
  );

  // Invalid server request ID must not reach service.

  const badRequestIdHandler =
    createLifecycleCommandHandler({
      service,

      command:
        LIFECYCLE_COMMANDS
          .suspenderPessoaOperacionalV12,

      requestIdFactory() {
        return "bad/request";
      }
    });

  const callsBeforeBadRequestId =
    calls.length;

  await expectHttpsError(
    () =>
      badRequestIdHandler({
        auth:
          platformAuth(),

        data: {
          personId:
            "person-x"
        }
      }),
    "internal"
  );

  assert.strictEqual(
    calls.length,
    callsBeforeBadRequestId
  );

  assert.throws(
    () =>
      createLifecycleCommandHandler({
        service: {}
      }),
    TypeError
  );

  console.log(
    "MARCO8_LIFECYCLE_CALLABLES=4/4"
  );

  console.log(
    "MARCO8_PEOPLE_MANAGE_CAPABILITY=ops.people.manage"
  );

  console.log(
    "MARCO8_ORGANIZATIONS_MANAGE_CAPABILITY=ops.organizations.manage"
  );

  console.log(
    "MARCO8_LIFECYCLE_PLATFORM_ADMIN_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_LIFECYCLE_SUPER_ADMIN_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_LIFECYCLE_SUPPORT_ADMIN_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_LIFECYCLE_FINANCE_ADMIN_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_LIFECYCLE_CONTENT_ADMIN_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_LIFECYCLE_ORG_ROLE_ESCALATION=BLOCKED"
  );

  console.log(
    "MARCO8_LIFECYCLE_AUTH_BEFORE_PAYLOAD=PASSED"
  );

  console.log(
    "MARCO8_LIFECYCLE_ACTOR_ID_SOURCE=request.auth.uid"
  );

  console.log(
    "MARCO8_LIFECYCLE_ACTOR_ROLE_SOURCE=signed_global_claims"
  );

  console.log(
    "MARCO8_LIFECYCLE_REQUEST_ID_SOURCE=server"
  );

  console.log(
    "MARCO8_LIFECYCLE_CLIENT_ENTITY_TYPE=BLOCKED"
  );

  console.log(
    "MARCO8_LIFECYCLE_CLIENT_TARGET_STATUS=BLOCKED"
  );

  console.log(
    "MARCO8_LIFECYCLE_CLIENT_ACTOR_ROLE=BLOCKED"
  );

  console.log(
    "MARCO8_LIFECYCLE_CLIENT_REQUEST_ID=BLOCKED"
  );

  console.log(
    "MARCO8_LIFECYCLE_ERROR_MAPPING=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_LIFECYCLE_FUNCTIONS=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
