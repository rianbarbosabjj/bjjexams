"use strict";

const {
  normalizeOperationalStatus
} = require(
  "./admin-directory-models"
);

const ADMIN_LIFECYCLE_SCHEMA_VERSION = 1;

const ADMIN_LIFECYCLE_ENTITY_TYPES =
  Object.freeze([
    "person",
    "organization"
  ]);

const ADMIN_LIFECYCLE_TARGET_STATUSES =
  Object.freeze([
    "active",
    "suspended"
  ]);

const PERSON_STATUS_WRITE_VALUES =
  Object.freeze({
    active:
      Object.freeze({
        status:
          "active",

        status_conta:
          "ativo"
      }),

    suspended:
      Object.freeze({
        status:
          "suspended",

        status_conta:
          "suspenso"
      })
  });

const ORGANIZATION_STATUS_WRITE_VALUES =
  Object.freeze({
    active:
      Object.freeze({
        status:
          "ativa"
      }),

    suspended:
      Object.freeze({
        status:
          "suspensa"
      })
  });

const ADMIN_LIFECYCLE_ACTIONS =
  Object.freeze({
    person:
      Object.freeze({
        active:
          "admin.person.reactivated",

        suspended:
          "admin.person.suspended"
      }),

    organization:
      Object.freeze({
        active:
          "admin.organization.reactivated",

        suspended:
          "admin.organization.suspended"
      })
  });

class AdminLifecycleDomainError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminLifecycleDomainError";

    this.code =
      code;
  }
}

function requiredText(
  value,
  field,
  maxLength = 200
) {
  if (
    typeof value !== "string"
  ) {
    throw new AdminLifecycleDomainError(
      "ADMIN_LIFECYCLE_INPUT_INVALID",
      `${field} is required.`
    );
  }

  const normalized =
    value.trim();

  if (
    !normalized ||
    normalized.length >
      maxLength
  ) {
    throw new AdminLifecycleDomainError(
      "ADMIN_LIFECYCLE_INPUT_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function requiredIdentifier(
  value,
  field
) {
  const normalized =
    requiredText(
      value,
      field,
      128
    );

  if (
    normalized.includes("/")
  ) {
    throw new AdminLifecycleDomainError(
      "ADMIN_LIFECYCLE_INPUT_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function normalizeLifecycleEntityType(
  value
) {
  const normalized =
    requiredText(
      value,
      "entityType",
      40
    )
      .toLowerCase();

  if (
    !ADMIN_LIFECYCLE_ENTITY_TYPES
      .includes(
        normalized
      )
  ) {
    throw new AdminLifecycleDomainError(
      "ADMIN_LIFECYCLE_ENTITY_INVALID",
      "Lifecycle entity is invalid."
    );
  }

  return normalized;
}

function normalizeLifecycleTargetStatus(
  value
) {
  const normalized =
    normalizeOperationalStatus(
      value
    );

  if (
    !ADMIN_LIFECYCLE_TARGET_STATUSES
      .includes(
        normalized
      )
  ) {
    throw new AdminLifecycleDomainError(
      "ADMIN_LIFECYCLE_TARGET_STATUS_INVALID",
      "Lifecycle target status must be active or suspended."
    );
  }

  return normalized;
}

function lifecyclePersistence(
  entityType,
  targetStatus
) {
  const type =
    normalizeLifecycleEntityType(
      entityType
    );

  const target =
    normalizeLifecycleTargetStatus(
      targetStatus
    );

  const source =
    type === "person"
      ? PERSON_STATUS_WRITE_VALUES
      : ORGANIZATION_STATUS_WRITE_VALUES;

  return Object.freeze({
    ...source[target]
  });
}

function lifecycleAction(
  entityType,
  targetStatus
) {
  const type =
    normalizeLifecycleEntityType(
      entityType
    );

  const target =
    normalizeLifecycleTargetStatus(
      targetStatus
    );

  return ADMIN_LIFECYCLE_ACTIONS[
    type
  ][
    target
  ];
}

function resolveLifecycleTransition(
  input = {}
) {
  const entityType =
    normalizeLifecycleEntityType(
      input.entityType
    );

  const currentStatus =
    normalizeOperationalStatus(
      input.currentStatus
    );

  const targetStatus =
    normalizeLifecycleTargetStatus(
      input.targetStatus
    );

  if (
    currentStatus ===
    targetStatus
  ) {
    return Object.freeze({
      entityType,
      currentStatus,
      targetStatus,

      action:
        lifecycleAction(
          entityType,
          targetStatus
        ),

      persistence:
        lifecyclePersistence(
          entityType,
          targetStatus
        ),

      idempotent:
        true
    });
  }

  const allowed =
    (
      currentStatus ===
        "active" &&
      targetStatus ===
        "suspended"
    ) ||
    (
      currentStatus ===
        "suspended" &&
      targetStatus ===
        "active"
    );

  if (!allowed) {
    throw new AdminLifecycleDomainError(
      "ADMIN_LIFECYCLE_TRANSITION_INVALID",
      `Transition from ${currentStatus} to ${targetStatus} is not allowed.`
    );
  }

  return Object.freeze({
    entityType,
    currentStatus,
    targetStatus,

    action:
      lifecycleAction(
        entityType,
        targetStatus
      ),

    persistence:
      lifecyclePersistence(
        entityType,
        targetStatus
      ),

    idempotent:
      false
  });
}

function buildLifecycleAuditEvent(
  input = {}
) {
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

  const entityId =
    requiredIdentifier(
      input.entityId,
      "entityId"
    );

  const transition =
    input.transition;

  if (
    !transition ||
    typeof transition !==
      "object" ||
    Array.isArray(
      transition
    )
  ) {
    throw new AdminLifecycleDomainError(
      "ADMIN_LIFECYCLE_AUDIT_INVALID",
      "Lifecycle transition is required for audit."
    );
  }

  const entityType =
    normalizeLifecycleEntityType(
      transition.entityType
    );

  const beforeStatus =
    normalizeOperationalStatus(
      transition.currentStatus
    );

  const afterStatus =
    normalizeLifecycleTargetStatus(
      transition.targetStatus
    );

  const expectedAction =
    lifecycleAction(
      entityType,
      afterStatus
    );

  if (
    transition.action !==
    expectedAction
  ) {
    throw new AdminLifecycleDomainError(
      "ADMIN_LIFECYCLE_AUDIT_INVALID",
      "Lifecycle audit action does not match transition."
    );
  }

  if (
    transition.idempotent ===
    true
  ) {
    throw new AdminLifecycleDomainError(
      "ADMIN_LIFECYCLE_AUDIT_IDEMPOTENT",
      "Idempotent lifecycle replay must not create a new audit event."
    );
  }

  if (
    input.createdAt ===
      undefined ||
    input.createdAt ===
      null
  ) {
    throw new AdminLifecycleDomainError(
      "ADMIN_LIFECYCLE_AUDIT_INVALID",
      "Audit createdAt is required."
    );
  }

  return Object.freeze({
    actorId,
    actorRole,

    action:
      expectedAction,

    entityType,
    entityId,

    organizationId:
      entityType ===
        "organization"
        ? entityId
        : null,

    before:
      Object.freeze({
        status:
          beforeStatus
      }),

    after:
      Object.freeze({
        status:
          afterStatus
      }),

    source:
      "function",

    requestId,

    createdAt:
      input.createdAt,

    metadata:
      Object.freeze({
        schemaVersion:
          ADMIN_LIFECYCLE_SCHEMA_VERSION
      })
  });
}

module.exports = {
  ADMIN_LIFECYCLE_SCHEMA_VERSION,

  ADMIN_LIFECYCLE_ENTITY_TYPES,
  ADMIN_LIFECYCLE_TARGET_STATUSES,

  PERSON_STATUS_WRITE_VALUES,
  ORGANIZATION_STATUS_WRITE_VALUES,
  ADMIN_LIFECYCLE_ACTIONS,

  AdminLifecycleDomainError,

  requiredText,
  requiredIdentifier,

  normalizeLifecycleEntityType,
  normalizeLifecycleTargetStatus,

  lifecyclePersistence,
  lifecycleAction,
  resolveLifecycleTransition,
  buildLifecycleAuditEvent
};
