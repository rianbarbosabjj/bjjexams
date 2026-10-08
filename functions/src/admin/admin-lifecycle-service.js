"use strict";

const {
  FieldValue
} = require(
  "firebase-admin/firestore"
);

const {
  AdminLifecycleDomainError,
  requiredIdentifier,
  requiredText,
  normalizeLifecycleEntityType,
  resolveLifecycleTransition,
  buildLifecycleAuditEvent
} = require(
  "./admin-lifecycle-domain"
);

const LIFECYCLE_COLLECTIONS =
  Object.freeze({
    person:
      "usuarios",

    organization:
      "organizacoes"
  });

class AdminLifecycleServiceError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminLifecycleServiceError";

    this.code =
      code;
  }
}

function readCurrentLifecycleStatus(
  entityType,
  data = {}
) {
  const safeData =
    data &&
    typeof data === "object" &&
    !Array.isArray(data)
      ? data
      : {};

  if (
    entityType ===
    "person"
  ) {
    return (
      safeData.status_conta ||
      safeData.status ||
      safeData.operationalStatus ||
      safeData.status_vinculo ||
      null
    );
  }

  return (
    safeData.status ||
    null
  );
}

function lifecycleEntityPath(
  entityType,
  entityId
) {
  const normalizedType =
    normalizeLifecycleEntityType(
      entityType
    );

  const normalizedId =
    requiredIdentifier(
      entityId,
      "entityId"
    );

  return (
    `${LIFECYCLE_COLLECTIONS[normalizedType]}/${normalizedId}`
  );
}

function createAdminLifecycleService(
  dependencies = {}
) {
  const {
    db,

    serverTimestamp =
      () =>
        FieldValue.serverTimestamp()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !==
      "function" ||
    typeof db.collection !==
      "function" ||
    typeof db.runTransaction !==
      "function"
  ) {
    throw new TypeError(
      "Admin lifecycle service requires Firestore."
    );
  }

  if (
    typeof serverTimestamp !==
    "function"
  ) {
    throw new TypeError(
      "Admin lifecycle service requires a server timestamp factory."
    );
  }

  async function mutateLifecycle(
    input = {}
  ) {
    const entityType =
      normalizeLifecycleEntityType(
        input.entityType
      );

    const entityId =
      requiredIdentifier(
        input.entityId,
        "entityId"
      );

    const actorId =
      requiredIdentifier(
        input.actorId,
        "actorId"
      );

    const actorRole =
      requiredText(
        input.actorRole,
        "actorRole",
        80
      );

    const requestId =
      requiredIdentifier(
        input.requestId,
        "requestId"
      );

    const targetPath =
      lifecycleEntityPath(
        entityType,
        entityId
      );

    const targetRef =
      db.doc(
        targetPath
      );

    const auditRef =
      db
        .collection(
          "audit_logs"
        )
        .doc();

    return db.runTransaction(
      async transaction => {
        const snapshot =
          await transaction.get(
            targetRef
          );

        if (
          !snapshot ||
          snapshot.exists !==
            true
        ) {
          throw new AdminLifecycleServiceError(
            "ADMIN_LIFECYCLE_TARGET_NOT_FOUND",
            "Lifecycle target was not found."
          );
        }

        const currentData =
          snapshot.data() ||
          {};

        const currentStatus =
          readCurrentLifecycleStatus(
            entityType,
            currentData
          );

        const transition =
          resolveLifecycleTransition({
            entityType,
            currentStatus,

            targetStatus:
              input.targetStatus
          });

        if (
          transition.idempotent ===
          true
        ) {
          return Object.freeze({
            changed:
              false,

            idempotent:
              true,

            entityType,
            entityId,

            status:
              transition.targetStatus,

            auditId:
              null
          });
        }

        const timestamp =
          serverTimestamp();

        if (
          timestamp ===
            undefined ||
          timestamp ===
            null
        ) {
          throw new AdminLifecycleServiceError(
            "ADMIN_LIFECYCLE_TIMESTAMP_INVALID",
            "Server timestamp could not be created."
          );
        }

        const updateData = {
          ...transition.persistence,

          updatedAt:
            timestamp
        };

        const auditEvent =
          buildLifecycleAuditEvent({
            actorId,
            actorRole,
            requestId,
            entityId,
            transition,

            createdAt:
              timestamp
          });

        transaction.update(
          targetRef,
          updateData
        );

        transaction.create(
          auditRef,
          auditEvent
        );

        return Object.freeze({
          changed:
            true,

          idempotent:
            false,

          entityType,
          entityId,

          status:
            transition.targetStatus,

          auditId:
            auditRef.id
        });
      }
    );
  }

  return Object.freeze({
    mutateLifecycle
  });
}

module.exports = {
  LIFECYCLE_COLLECTIONS,

  AdminLifecycleServiceError,
  AdminLifecycleDomainError,

  readCurrentLifecycleStatus,
  lifecycleEntityPath,

  createAdminLifecycleService
};
