"use strict";

const assert =
  require("assert");

const {
  AdminLifecycleDomainError
} = require(
  "../functions/src/admin/admin-lifecycle-domain"
);

const {
  LIFECYCLE_COLLECTIONS,
  AdminLifecycleServiceError,
  readCurrentLifecycleStatus,
  lifecycleEntityPath,
  createAdminLifecycleService
} = require(
  "../functions/src/admin/admin-lifecycle-service"
);

function clone(
  value
) {
  return JSON.parse(
    JSON.stringify(
      value
    )
  );
}

function createFakeFirestore(
  initialDocuments = {}
) {
  const documents =
    new Map(
      Object.entries(
        initialDocuments
      )
    );

  const audits =
    new Map();

  const events = [];

  let auditSequence = 0;
  let transactionCount = 0;

  function makeRef(
    path,
    id = null
  ) {
    return {
      path,
      id:
        id ||
        path
          .split("/")
          .pop()
    };
  }

  const db = {
    events,
    documents,
    audits,

    doc(path) {
      events.push({
        type:
          "db-doc",
        path
      });

      return makeRef(
        path
      );
    },

    collection(name) {
      assert.strictEqual(
        name,
        "audit_logs"
      );

      events.push({
        type:
          "db-collection",
        name
      });

      return {
        doc() {
          auditSequence += 1;

          const id =
            `audit-${auditSequence}`;

          return makeRef(
            `audit_logs/${id}`,
            id
          );
        }
      };
    },

    async runTransaction(
      operation
    ) {
      transactionCount += 1;

      events.push({
        type:
          "transaction-start",
        number:
          transactionCount
      });

      const pendingUpdates =
        [];

      const pendingCreates =
        [];

      const transaction = {
        async get(ref) {
          events.push({
            type:
              "tx-get",
            path:
              ref.path
          });

          if (
            !documents.has(
              ref.path
            )
          ) {
            return {
              exists:
                false,

              data() {
                return undefined;
              }
            };
          }

          return {
            exists:
              true,

            data() {
              return clone(
                documents.get(
                  ref.path
                )
              );
            }
          };
        },

        update(
          ref,
          data
        ) {
          events.push({
            type:
              "tx-update",
            path:
              ref.path,
            data
          });

          pendingUpdates.push({
            ref,
            data
          });
        },

        create(
          ref,
          data
        ) {
          events.push({
            type:
              "tx-create",
            path:
              ref.path,
            data
          });

          pendingCreates.push({
            ref,
            data
          });
        }
      };

      const result =
        await operation(
          transaction
        );

      for (
        const pending
        of pendingUpdates
      ) {
        const current =
          documents.get(
            pending.ref.path
          ) ||
          {};

        documents.set(
          pending.ref.path,
          {
            ...current,
            ...pending.data
          }
        );
      }

      for (
        const pending
        of pendingCreates
      ) {
        if (
          audits.has(
            pending.ref.path
          )
        ) {
          throw new Error(
            "duplicate audit create"
          );
        }

        audits.set(
          pending.ref.path,
          pending.data
        );
      }

      events.push({
        type:
          "transaction-commit"
      });

      return result;
    }
  };

  return db;
}

async function expectError(
  operation,
  ErrorType,
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

  assert.ok(
    received instanceof
      ErrorType
  );

  assert.strictEqual(
    received.code,
    expectedCode
  );

  return received;
}

async function main() {
  assert.deepStrictEqual(
    LIFECYCLE_COLLECTIONS,
    {
      person:
        "usuarios",

      organization:
        "organizacoes"
    }
  );

  assert.strictEqual(
    readCurrentLifecycleStatus(
      "person",
      {
        status:
          "active",

        status_conta:
          "suspenso"
      }
    ),
    "suspenso"
  );

  assert.strictEqual(
    readCurrentLifecycleStatus(
      "person",
      {
        status:
          "active"
      }
    ),
    "active"
  );

  assert.strictEqual(
    readCurrentLifecycleStatus(
      "organization",
      {
        status:
          "suspensa"
      }
    ),
    "suspensa"
  );

  assert.strictEqual(
    lifecycleEntityPath(
      "person",
      "person-1"
    ),
    "usuarios/person-1"
  );

  assert.strictEqual(
    lifecycleEntityPath(
      "organization",
      "org-1"
    ),
    "organizacoes/org-1"
  );

  const timestamp1 = {
    serverTimestamp:
      1
  };

  const db =
    createFakeFirestore({
      "usuarios/person-1": {
        nome:
          "Pessoa Um",

        email:
          "pessoa@example.com",

        cpf:
          "must-not-enter-audit",

        status_conta:
          "ativo"
      },

      "usuarios/person-2": {
        nome:
          "Pessoa Dois",

        status:
          "suspended",

        status_conta:
          "suspenso"
      },

      "organizacoes/org-1": {
        nome:
          "Academia Um",

        status:
          "ativa",

        asaas_wallet_id:
          "must-not-enter-audit"
      },

      "organizacoes/org-2": {
        nome:
          "Academia Dois",

        status:
          "suspensa"
      },

      "usuarios/person-inactive": {
        status:
          "inactive",

        status_conta:
          "inativo"
      }
    });

  let timestampCalls = 0;

  const service =
    createAdminLifecycleService({
      db,

      serverTimestamp() {
        timestampCalls += 1;

        return timestamp1;
      }
    });

  // PERSON SUSPEND

  const personSuspend =
    await service.mutateLifecycle({
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
        "request-person-suspend-1"
    });

  assert.deepStrictEqual(
    personSuspend,
    {
      changed:
        true,

      idempotent:
        false,

      entityType:
        "person",

      entityId:
        "person-1",

      status:
        "suspended",

      auditId:
        "audit-1"
    }
  );

  const personAfter =
    db.documents.get(
      "usuarios/person-1"
    );

  assert.strictEqual(
    personAfter.status,
    "suspended"
  );

  assert.strictEqual(
    personAfter.status_conta,
    "suspenso"
  );

  assert.strictEqual(
    personAfter.updatedAt,
    timestamp1
  );

  assert.strictEqual(
    personAfter.nome,
    "Pessoa Um"
  );

  const personAudit =
    db.audits.get(
      "audit_logs/audit-1"
    );

  assert.strictEqual(
    personAudit.action,
    "admin.person.suspended"
  );

  assert.strictEqual(
    personAudit.actorId,
    "platform-admin-1"
  );

  assert.strictEqual(
    personAudit.actorRole,
    "platform_admin"
  );

  assert.strictEqual(
    personAudit.entityType,
    "person"
  );

  assert.strictEqual(
    personAudit.entityId,
    "person-1"
  );

  assert.strictEqual(
    personAudit.organizationId,
    null
  );

  assert.strictEqual(
    personAudit.requestId,
    "request-person-suspend-1"
  );

  assert.strictEqual(
    personAudit.createdAt,
    timestamp1
  );

  assert.deepStrictEqual(
    personAudit.before,
    {
      status:
        "active"
    }
  );

  assert.deepStrictEqual(
    personAudit.after,
    {
      status:
        "suspended"
    }
  );

  // IDEMPOTENT PERSON REPLAY

  const eventsBeforeReplay =
    db.events.length;

  const auditsBeforeReplay =
    db.audits.size;

  const replay =
    await service.mutateLifecycle({
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
        "request-person-suspend-replay"
    });

  assert.deepStrictEqual(
    replay,
    {
      changed:
        false,

      idempotent:
        true,

      entityType:
        "person",

      entityId:
        "person-1",

      status:
        "suspended",

      auditId:
        null
    }
  );

  assert.strictEqual(
    db.audits.size,
    auditsBeforeReplay
  );

  const replayEvents =
    db.events.slice(
      eventsBeforeReplay
    );

  assert.strictEqual(
    replayEvents.some(
      event =>
        event.type ===
        "tx-update"
    ),
    false
  );

  assert.strictEqual(
    replayEvents.some(
      event =>
        event.type ===
        "tx-create"
    ),
    false
  );

  // PERSON REACTIVATE

  const personReactivate =
    await service.mutateLifecycle({
      entityType:
        "person",

      entityId:
        "person-2",

      targetStatus:
        "active",

      actorId:
        "super-admin-1",

      actorRole:
        "super_admin",

      requestId:
        "request-person-reactivate-1"
    });

  assert.strictEqual(
    personReactivate.changed,
    true
  );

  assert.strictEqual(
    db.documents
      .get(
        "usuarios/person-2"
      )
      .status,
    "active"
  );

  assert.strictEqual(
    db.documents
      .get(
        "usuarios/person-2"
      )
      .status_conta,
    "ativo"
  );

  // ORGANIZATION SUSPEND

  const organizationSuspend =
    await service.mutateLifecycle({
      entityType:
        "organization",

      entityId:
        "org-1",

      targetStatus:
        "suspended",

      actorId:
        "platform-admin-1",

      actorRole:
        "platform_admin",

      requestId:
        "request-org-suspend-1"
    });

  assert.strictEqual(
    organizationSuspend.changed,
    true
  );

  assert.strictEqual(
    db.documents
      .get(
        "organizacoes/org-1"
      )
      .status,
    "suspensa"
  );

  assert.strictEqual(
    organizationSuspend.status,
    "suspended"
  );

  // ORGANIZATION REACTIVATE

  const organizationReactivate =
    await service.mutateLifecycle({
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
        "request-org-reactivate-1"
    });

  assert.strictEqual(
    organizationReactivate.changed,
    true
  );

  assert.strictEqual(
    db.documents
      .get(
        "organizacoes/org-2"
      )
      .status,
    "ativa"
  );

  // AUDIT SANITIZATION

  const serializedAudits =
    JSON.stringify(
      Array.from(
        db.audits.values()
      )
    );

  for (
    const forbidden of [
      "Pessoa Um",
      "pessoa@example.com",
      "must-not-enter-audit",
      "asaas_wallet_id",
      "cpf",
      "password",
      "senha",
      "token",
      "secret"
    ]
  ) {
    assert.strictEqual(
      serializedAudits.includes(
        forbidden
      ),
      false,
      `Audit leaked ${forbidden}`
    );
  }

  // INVALID TRANSITION MUST NOT WRITE

  const writesBeforeInvalid =
    db.events.filter(
      event =>
        event.type ===
          "tx-update" ||
        event.type ===
          "tx-create"
    ).length;

  await expectError(
    () =>
      service.mutateLifecycle({
        entityType:
          "person",

        entityId:
          "person-inactive",

        targetStatus:
          "active",

        actorId:
          "platform-admin-1",

        actorRole:
          "platform_admin",

        requestId:
          "request-invalid-1"
      }),
    AdminLifecycleDomainError,
    "ADMIN_LIFECYCLE_TRANSITION_INVALID"
  );

  const writesAfterInvalid =
    db.events.filter(
      event =>
        event.type ===
          "tx-update" ||
        event.type ===
          "tx-create"
    ).length;

  assert.strictEqual(
    writesAfterInvalid,
    writesBeforeInvalid
  );

  // MISSING TARGET MUST NOT WRITE

  const auditsBeforeMissing =
    db.audits.size;

  await expectError(
    () =>
      service.mutateLifecycle({
        entityType:
          "organization",

        entityId:
          "missing-org",

        targetStatus:
          "suspended",

        actorId:
          "platform-admin-1",

        actorRole:
          "platform_admin",

        requestId:
          "request-missing-1"
      }),
    AdminLifecycleServiceError,
    "ADMIN_LIFECYCLE_TARGET_NOT_FOUND"
  );

  assert.strictEqual(
    db.audits.size,
    auditsBeforeMissing
  );

  // INVALID INPUT MUST FAIL BEFORE TRANSACTION

  const transactionStartsBeforeInvalidInput =
    db.events.filter(
      event =>
        event.type ===
          "transaction-start"
    ).length;

  await expectError(
    () =>
      service.mutateLifecycle({
        entityType:
          "person",

        entityId:
          "bad/id",

        targetStatus:
          "suspended",

        actorId:
          "platform-admin-1",

        actorRole:
          "platform_admin",

        requestId:
          "request-invalid-id"
      }),
    AdminLifecycleDomainError,
    "ADMIN_LIFECYCLE_INPUT_INVALID"
  );

  const transactionStartsAfterInvalidInput =
    db.events.filter(
      event =>
        event.type ===
          "transaction-start"
    ).length;

  assert.strictEqual(
    transactionStartsAfterInvalidInput,
    transactionStartsBeforeInvalidInput
  );

  // ATOMIC WRITE PATTERN

  const updateEvents =
    db.events.filter(
      event =>
        event.type ===
        "tx-update"
    );

  const createEvents =
    db.events.filter(
      event =>
        event.type ===
        "tx-create"
    );

  assert.strictEqual(
    updateEvents.length,
    4
  );

  assert.strictEqual(
    createEvents.length,
    4
  );

  assert.ok(
    createEvents.every(
      event =>
        event.path.startsWith(
          "audit_logs/"
        )
    )
  );

  assert.strictEqual(
    timestampCalls,
    4
  );

  assert.throws(
    () =>
      createAdminLifecycleService({
        db: {}
      }),
    TypeError
  );

  console.log(
    "MARCO8_LIFECYCLE_COLLECTIONS=usuarios_organizacoes"
  );

  console.log(
    "MARCO8_LIFECYCLE_TRANSACTION=PASSED"
  );

  console.log(
    "MARCO8_PERSON_STATUS_WRITE_THROUGH=PASSED"
  );

  console.log(
    "MARCO8_ORGANIZATION_STATUS_PERSISTENCE=PASSED"
  );

  console.log(
    "MARCO8_LIFECYCLE_AUDIT_ATOMICITY=PASSED"
  );

  console.log(
    "MARCO8_LIFECYCLE_AUDIT_COLLECTION=audit_logs"
  );

  console.log(
    "MARCO8_LIFECYCLE_SERVER_TIMESTAMP=PASSED"
  );

  console.log(
    "MARCO8_LIFECYCLE_IDEMPOTENT_REPLAY=NO_WRITE_NO_AUDIT"
  );

  console.log(
    "MARCO8_LIFECYCLE_INVALID_TRANSITION=NO_WRITE"
  );

  console.log(
    "MARCO8_LIFECYCLE_NOT_FOUND=NO_WRITE"
  );

  console.log(
    "MARCO8_LIFECYCLE_AUDIT_SANITIZATION=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_LIFECYCLE_SERVICE=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
