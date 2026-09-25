"use strict";

const {
  randomUUID
} = require(
  "crypto"
);

const {
  onCall,
  HttpsError
} = require(
  "firebase-functions/v2/https"
);

const {
  ROLE_CAPABILITIES,
  AdminAccessPolicyError,
  resolveExplicitGlobalRoles,
  requireAdminCapability
} = require(
  "./admin-access-policy"
);

const {
  AdminLifecycleDomainError
} = require(
  "./admin-lifecycle-domain"
);

const {
  AdminLifecycleServiceError,
  createAdminLifecycleService
} = require(
  "./admin-lifecycle-service"
);

const PEOPLE_MANAGE_CAPABILITY =
  "ops.people.manage";

const ORGANIZATIONS_MANAGE_CAPABILITY =
  "ops.organizations.manage";

const LIFECYCLE_COMMANDS =
  Object.freeze({
    suspenderPessoaOperacionalV12:
      Object.freeze({
        capability:
          PEOPLE_MANAGE_CAPABILITY,

        entityType:
          "person",

        targetStatus:
          "suspended",

        idField:
          "personId",

        operation:
          "Suspend operational person"
      }),

    reativarPessoaOperacionalV12:
      Object.freeze({
        capability:
          PEOPLE_MANAGE_CAPABILITY,

        entityType:
          "person",

        targetStatus:
          "active",

        idField:
          "personId",

        operation:
          "Reactivate operational person"
      }),

    suspenderOrganizacaoOperacionalV12:
      Object.freeze({
        capability:
          ORGANIZATIONS_MANAGE_CAPABILITY,

        entityType:
          "organization",

        targetStatus:
          "suspended",

        idField:
          "organizationId",

        operation:
          "Suspend operational organization"
      }),

    reativarOrganizacaoOperacionalV12:
      Object.freeze({
        capability:
          ORGANIZATIONS_MANAGE_CAPABILITY,

        entityType:
          "organization",

        targetStatus:
          "active",

        idField:
          "organizationId",

        operation:
          "Reactivate operational organization"
      })
  });

function assertOnlyFields(
  data,
  allowedFields,
  operation
) {
  if (
    data !== undefined &&
    data !== null &&
    (
      typeof data !== "object" ||
      Array.isArray(data)
    )
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${operation} payload must be an object.`
    );
  }

  const input =
    data || {};

  const allowed =
    new Set(
      allowedFields
    );

  const forbiddenFields =
    Object.keys(input)
      .filter(
        field =>
          !allowed.has(
            field
          )
      )
      .sort();

  if (
    forbiddenFields.length >
    0
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${operation} contains unsupported fields.`,
      {
        forbiddenFields
      }
    );
  }

  return input;
}

function resolveActorRoleForCapability(
  claims,
  capability
) {
  const roles =
    resolveExplicitGlobalRoles(
      claims
    );

  for (
    const role
    of roles
  ) {
    const capabilities =
      ROLE_CAPABILITIES[
        role
      ] || [];

    if (
      capabilities.includes(
        capability
      )
    ) {
      return role;
    }
  }

  throw new AdminAccessPolicyError(
    "ADMIN_CAPABILITY_REQUIRED",
    "Required administrative capability is missing."
  );
}

function requireLifecycleActor(
  request,
  capability
) {
  const uid =
    typeof request?.auth?.uid ===
      "string"
      ? request.auth.uid.trim()
      : "";

  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "Authentication is required."
    );
  }

  const claims =
    request?.auth?.token &&
    typeof request.auth.token ===
      "object" &&
    !Array.isArray(
      request.auth.token
    )
      ? request.auth.token
      : {};

  requireAdminCapability(
    claims,
    capability
  );

  const actorRole =
    resolveActorRoleForCapability(
      claims,
      capability
    );

  return Object.freeze({
    uid,
    actorRole
  });
}

function createServerRequestId(
  requestIdFactory =
    randomUUID
) {
  if (
    typeof requestIdFactory !==
      "function"
  ) {
    throw new TypeError(
      "Request ID factory must be a function."
    );
  }

  let generated;

  try {
    generated =
      requestIdFactory();
  }
  catch (error) {
    throw new HttpsError(
      "internal",
      "Administrative request ID could not be generated."
    );
  }

  const requestId =
    typeof generated ===
      "string"
      ? generated.trim()
      : "";

  if (
    !requestId ||
    requestId.length > 128 ||
    requestId.includes("/")
  ) {
    throw new HttpsError(
      "internal",
      "Administrative request ID could not be generated."
    );
  }

  return requestId;
}

function mapLifecycleCommandError(
  error
) {
  if (
    error instanceof
    HttpsError
  ) {
    throw error;
  }

  if (
    error instanceof
    AdminAccessPolicyError
  ) {
    throw new HttpsError(
      "permission-denied",
      "Administrative permission is required.",
      {
        domainCode:
          error.code
      }
    );
  }

  if (
    error instanceof
    AdminLifecycleDomainError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_LIFECYCLE_DOMAIN_FAILED"
      );

    if (
      [
        "ADMIN_LIFECYCLE_INPUT_INVALID",
        "ADMIN_LIFECYCLE_ENTITY_INVALID",
        "ADMIN_LIFECYCLE_TARGET_STATUS_INVALID"
      ].includes(
        code
      )
    ) {
      throw new HttpsError(
        "invalid-argument",
        error.message,
        {
          domainCode:
            code
        }
      );
    }

    if (
      code ===
      "ADMIN_LIFECYCLE_TRANSITION_INVALID"
    ) {
      throw new HttpsError(
        "failed-precondition",
        error.message,
        {
          domainCode:
            code
        }
      );
    }

    throw new HttpsError(
      "internal",
      "Lifecycle operation could not be completed.",
      {
        domainCode:
          code
      }
    );
  }

  if (
    error instanceof
    AdminLifecycleServiceError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_LIFECYCLE_SERVICE_FAILED"
      );

    if (
      code ===
      "ADMIN_LIFECYCLE_TARGET_NOT_FOUND"
    ) {
      throw new HttpsError(
        "not-found",
        error.message,
        {
          domainCode:
            code
        }
      );
    }

    throw new HttpsError(
      "internal",
      "Lifecycle operation could not be completed.",
      {
        domainCode:
          code
      }
    );
  }

  throw new HttpsError(
    "internal",
    "Lifecycle operation could not be completed."
  );
}

function createLifecycleCommandHandler(
  dependencies = {}
) {
  const {
    service,
    command,

    requestIdFactory =
      randomUUID
  } = dependencies;

  if (
    !service ||
    typeof service.mutateLifecycle !==
      "function"
  ) {
    throw new TypeError(
      "Lifecycle mutation service is required."
    );
  }

  if (
    !command ||
    typeof command !==
      "object" ||
    !command.capability ||
    !command.entityType ||
    !command.targetStatus ||
    !command.idField ||
    !command.operation
  ) {
    throw new TypeError(
      "Lifecycle command descriptor is required."
    );
  }

  if (
    typeof requestIdFactory !==
      "function"
  ) {
    throw new TypeError(
      "Request ID factory must be a function."
    );
  }

  return async function handleLifecycleCommand(
    request = {}
  ) {
    try {
      // Authenticate/authorize before inspecting client payload.
      const actor =
        requireLifecycleActor(
          request,
          command.capability
        );

      const data =
        assertOnlyFields(
          request.data,
          [
            command.idField
          ],
          command.operation
        );

      const requestId =
        createServerRequestId(
          requestIdFactory
        );

      const result =
        await service
          .mutateLifecycle({
            entityType:
              command.entityType,

            entityId:
              data[
                command.idField
              ],

            targetStatus:
              command.targetStatus,

            actorId:
              actor.uid,

            actorRole:
              actor.actorRole,

            requestId
          });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapLifecycleCommandError(
        error
      );
    }
  };
}

function createAdminLifecycleFunctions(
  dependencies = {}
) {
  const {
    REGION,
    db,

    requestIdFactory =
      randomUUID
  } = dependencies;

  if (
    !REGION ||
    typeof REGION !== "string" ||
    !db
  ) {
    throw new TypeError(
      "Admin lifecycle functions require REGION and Firestore."
    );
  }

  const service =
    createAdminLifecycleService({
      db
    });

  const suspenderPessoaOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createLifecycleCommandHandler({
        service,

        command:
          LIFECYCLE_COMMANDS
            .suspenderPessoaOperacionalV12,

        requestIdFactory
      })
    );

  const reativarPessoaOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createLifecycleCommandHandler({
        service,

        command:
          LIFECYCLE_COMMANDS
            .reativarPessoaOperacionalV12,

        requestIdFactory
      })
    );

  const suspenderOrganizacaoOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createLifecycleCommandHandler({
        service,

        command:
          LIFECYCLE_COMMANDS
            .suspenderOrganizacaoOperacionalV12,

        requestIdFactory
      })
    );

  const reativarOrganizacaoOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createLifecycleCommandHandler({
        service,

        command:
          LIFECYCLE_COMMANDS
            .reativarOrganizacaoOperacionalV12,

        requestIdFactory
      })
    );

  return Object.freeze({
    suspenderPessoaOperacionalV12,
    reativarPessoaOperacionalV12,
    suspenderOrganizacaoOperacionalV12,
    reativarOrganizacaoOperacionalV12
  });
}

module.exports = {
  PEOPLE_MANAGE_CAPABILITY,
  ORGANIZATIONS_MANAGE_CAPABILITY,
  LIFECYCLE_COMMANDS,

  assertOnlyFields,
  resolveActorRoleForCapability,
  requireLifecycleActor,
  createServerRequestId,
  mapLifecycleCommandError,

  createLifecycleCommandHandler,
  createAdminLifecycleFunctions
};
