"use strict";

const assert =
  require("assert");

const {
  ADMIN_LIFECYCLE_SCHEMA_VERSION,
  PERSON_STATUS_WRITE_VALUES,
  ORGANIZATION_STATUS_WRITE_VALUES,
  ADMIN_LIFECYCLE_ACTIONS,
  AdminLifecycleDomainError,
  lifecyclePersistence,
  lifecycleAction,
  resolveLifecycleTransition,
  buildLifecycleAuditEvent
} = require(
  "../functions/src/admin/admin-lifecycle-domain"
);

function expectDomainError(
  operation,
  expectedCode
) {
  let received = null;

  try {
    operation();
  }
  catch (error) {
    received =
      error;
  }

  assert.ok(
    received,
    `Expected ${expectedCode}`
  );

  assert.ok(
    received instanceof
      AdminLifecycleDomainError
  );

  assert.strictEqual(
    received.code,
    expectedCode
  );
}

function main() {
  assert.strictEqual(
    ADMIN_LIFECYCLE_SCHEMA_VERSION,
    1
  );

  assert.deepStrictEqual(
    PERSON_STATUS_WRITE_VALUES,
    {
      active: {
        status:
          "active",

        status_conta:
          "ativo"
      },

      suspended: {
        status:
          "suspended",

        status_conta:
          "suspenso"
      }
    }
  );

  assert.deepStrictEqual(
    ORGANIZATION_STATUS_WRITE_VALUES,
    {
      active: {
        status:
          "ativa"
      },

      suspended: {
        status:
          "suspensa"
      }
    }
  );

  assert.strictEqual(
    ADMIN_LIFECYCLE_ACTIONS
      .person
      .suspended,
    "admin.person.suspended"
  );

  assert.strictEqual(
    ADMIN_LIFECYCLE_ACTIONS
      .organization
      .active,
    "admin.organization.reactivated"
  );

  const suspendPerson =
    resolveLifecycleTransition({
      entityType:
        "person",

      currentStatus:
        "ativo",

      targetStatus:
        "suspended"
    });

  assert.deepStrictEqual(
    suspendPerson,
    {
      entityType:
        "person",

      currentStatus:
        "active",

      targetStatus:
        "suspended",

      action:
        "admin.person.suspended",

      persistence: {
        status:
          "suspended",

        status_conta:
          "suspenso"
      },

      idempotent:
        false
    }
  );

  const reactivatePerson =
    resolveLifecycleTransition({
      entityType:
        "person",

      currentStatus:
        "suspenso",

      targetStatus:
        "active"
    });

  assert.strictEqual(
    reactivatePerson.action,
    "admin.person.reactivated"
  );

  assert.deepStrictEqual(
    reactivatePerson.persistence,
    {
      status:
        "active",

      status_conta:
        "ativo"
    }
  );

  const suspendOrganization =
    resolveLifecycleTransition({
      entityType:
        "organization",

      currentStatus:
        "ativa",

      targetStatus:
        "suspended"
    });

  assert.deepStrictEqual(
    suspendOrganization.persistence,
    {
      status:
        "suspensa"
    }
  );

  assert.strictEqual(
    suspendOrganization.action,
    "admin.organization.suspended"
  );

  const reactivateOrganization =
    resolveLifecycleTransition({
      entityType:
        "organization",

      currentStatus:
        "suspensa",

      targetStatus:
        "active"
    });

  assert.deepStrictEqual(
    reactivateOrganization.persistence,
    {
      status:
        "ativa"
    }
  );

  assert.strictEqual(
    reactivateOrganization.action,
    "admin.organization.reactivated"
  );

  const personReplay =
    resolveLifecycleTransition({
      entityType:
        "person",

      currentStatus:
        "suspended",

      targetStatus:
        "suspenso"
    });

  assert.strictEqual(
    personReplay.idempotent,
    true
  );

  const organizationReplay =
    resolveLifecycleTransition({
      entityType:
        "organization",

      currentStatus:
        "bloqueada",

      targetStatus:
        "suspended"
    });

  assert.strictEqual(
    organizationReplay.idempotent,
    true
  );

  expectDomainError(
    () =>
      resolveLifecycleTransition({
        entityType:
          "person",

        currentStatus:
          "inactive",

        targetStatus:
          "active"
      }),
    "ADMIN_LIFECYCLE_TRANSITION_INVALID"
  );

  expectDomainError(
    () =>
      resolveLifecycleTransition({
        entityType:
          "organization",

        currentStatus:
          "archived",

        targetStatus:
          "active"
      }),
    "ADMIN_LIFECYCLE_TRANSITION_INVALID"
  );

  expectDomainError(
    () =>
      resolveLifecycleTransition({
        entityType:
          "person",

        currentStatus:
          "pending",

        targetStatus:
          "suspended"
      }),
    "ADMIN_LIFECYCLE_TRANSITION_INVALID"
  );

  expectDomainError(
    () =>
      resolveLifecycleTransition({
        entityType:
          "person",

        currentStatus:
          null,

        targetStatus:
          "suspended"
      }),
    "ADMIN_LIFECYCLE_TRANSITION_INVALID"
  );

  expectDomainError(
    () =>
      resolveLifecycleTransition({
        entityType:
          "course",

        currentStatus:
          "active",

        targetStatus:
          "suspended"
      }),
    "ADMIN_LIFECYCLE_ENTITY_INVALID"
  );

  expectDomainError(
    () =>
      resolveLifecycleTransition({
        entityType:
          "person",

        currentStatus:
          "active",

        targetStatus:
          "archived"
      }),
    "ADMIN_LIFECYCLE_TARGET_STATUS_INVALID"
  );

  assert.deepStrictEqual(
    lifecyclePersistence(
      "person",
      "active"
    ),
    {
      status:
        "active",

      status_conta:
        "ativo"
    }
  );

  assert.deepStrictEqual(
    lifecyclePersistence(
      "organization",
      "suspended"
    ),
    {
      status:
        "suspensa"
    }
  );

  assert.strictEqual(
    lifecycleAction(
      "person",
      "active"
    ),
    "admin.person.reactivated"
  );

  const createdAt = {
    serverTimestamp:
      true
  };

  const audit =
    buildLifecycleAuditEvent({
      actorId:
        "admin-1",

      actorRole:
        "platform_admin",

      requestId:
        "request-1",

      entityId:
        "person-1",

      transition:
        suspendPerson,

      createdAt
    });

  assert.deepStrictEqual(
    audit,
    {
      actorId:
        "admin-1",

      actorRole:
        "platform_admin",

      action:
        "admin.person.suspended",

      entityType:
        "person",

      entityId:
        "person-1",

      organizationId:
        null,

      before: {
        status:
          "active"
      },

      after: {
        status:
          "suspended"
      },

      source:
        "function",

      requestId:
        "request-1",

      createdAt,

      metadata: {
        schemaVersion:
          1
      }
    }
  );

  const organizationAudit =
    buildLifecycleAuditEvent({
      actorId:
        "super-admin-1",

      actorRole:
        "super_admin",

      requestId:
        "request-2",

      entityId:
        "org-1",

      transition:
        suspendOrganization,

      createdAt
    });

  assert.strictEqual(
    organizationAudit
      .organizationId,
    "org-1"
  );

  assert.strictEqual(
    organizationAudit
      .entityType,
    "organization"
  );

  assert.deepStrictEqual(
    Object.keys(
      organizationAudit
    ).sort(),
    [
      "action",
      "actorId",
      "actorRole",
      "after",
      "before",
      "createdAt",
      "entityId",
      "entityType",
      "metadata",
      "organizationId",
      "requestId",
      "source"
    ].sort()
  );

  const serialized =
    JSON.stringify({
      audit,
      organizationAudit
    });

  for (
    const forbidden of [
      "password",
      "senha",
      "token",
      "secret",
      "apiKey",
      "cpf",
      "email",
      "customClaims"
    ]
  ) {
    assert.strictEqual(
      serialized.includes(
        forbidden
      ),
      false,
      `Audit leaked ${forbidden}`
    );
  }

  expectDomainError(
    () =>
      buildLifecycleAuditEvent({
        actorId:
          "admin-1",

        actorRole:
          "platform_admin",

        requestId:
          "request-1",

        entityId:
          "person-1",

        transition:
          personReplay,

        createdAt
      }),
    "ADMIN_LIFECYCLE_AUDIT_IDEMPOTENT"
  );

  expectDomainError(
    () =>
      buildLifecycleAuditEvent({
        actorId:
          "admin-1",

        actorRole:
          "platform_admin",

        requestId:
          "request-1",

        entityId:
          "person-1",

        transition: {
          ...suspendPerson,

          action:
            "admin.person.reactivated"
        },

        createdAt
      }),
    "ADMIN_LIFECYCLE_AUDIT_INVALID"
  );

  expectDomainError(
    () =>
      buildLifecycleAuditEvent({
        actorId:
          "admin-1",

        actorRole:
          "platform_admin",

        requestId:
          "",

        entityId:
          "person-1",

        transition:
          suspendPerson,

        createdAt
      }),
    "ADMIN_LIFECYCLE_INPUT_INVALID"
  );

  expectDomainError(
    () =>
      buildLifecycleAuditEvent({
        actorId:
          "admin-1",

        actorRole:
          "platform_admin",

        requestId:
          "request-1",

        entityId:
          "bad/id",

        transition:
          suspendPerson,

        createdAt
      }),
    "ADMIN_LIFECYCLE_INPUT_INVALID"
  );

  console.log(
    "MARCO8_LIFECYCLE_SCHEMA_VERSION=1"
  );

  console.log(
    "MARCO8_PERSON_CANONICAL_STATUS_FIELD=status"
  );

  console.log(
    "MARCO8_PERSON_COMPAT_STATUS_FIELD=status_conta"
  );

  console.log(
    "MARCO8_PERSON_STATUS_WRITE_THROUGH=PASSED"
  );

  console.log(
    "MARCO8_ORGANIZATION_STATUS_FIELD=status"
  );

  console.log(
    "MARCO8_ORGANIZATION_STORAGE_VALUES=ativa_suspensa"
  );

  console.log(
    "MARCO8_LIFECYCLE_TRANSITIONS=active_suspended_only"
  );

  console.log(
    "MARCO8_LIFECYCLE_IDEMPOTENCY=PASSED"
  );

  console.log(
    "MARCO8_LIFECYCLE_INVALID_TRANSITIONS=BLOCKED"
  );

  console.log(
    "MARCO8_AUDIT_COLLECTION_CONTRACT=audit_logs"
  );

  console.log(
    "MARCO8_AUDIT_SOURCE=function"
  );

  console.log(
    "MARCO8_AUDIT_REQUEST_ID=REQUIRED"
  );

  console.log(
    "MARCO8_AUDIT_IDEMPOTENT_REPLAY=NO_NEW_EVENT"
  );

  console.log(
    "MARCO8_AUDIT_SANITIZATION=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_LIFECYCLE_DOMAIN=PASSED"
  );
}

main();
