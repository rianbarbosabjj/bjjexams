"use strict";

const {
  onCall,
  HttpsError
} = require("firebase-functions/v2/https");

const {
  AdminAccessPolicyError,
  resolveAdministrativeAccess
} = require("./admin-access-policy");

const ADMIN_CONTEXT_SCHEMA_VERSION = "1.2";

function normalizeDisplayName(claims = {}) {
  const value =
    typeof claims.name === "string"
      ? claims.name.trim()
      : "";

  return value || null;
}

function assertEmptyPayload(data) {
  if (
    data === undefined ||
    data === null
  ) {
    return {};
  }

  if (
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Invalid administrative context request."
    );
  }

  const fields =
    Object.keys(data);

  if (fields.length > 0) {
    throw new HttpsError(
      "invalid-argument",
      "Administrative context does not accept input fields.",
      {
        forbiddenFields: fields.sort()
      }
    );
  }

  return data;
}

function requireAuthenticatedActor(request = {}) {
  const uid =
    request.auth?.uid;

  if (
    !uid ||
    typeof uid !== "string" ||
    !uid.trim()
  ) {
    throw new HttpsError(
      "unauthenticated",
      "Authentication is required."
    );
  }

  return {
    uid: uid.trim(),
    claims:
      request.auth?.token &&
      typeof request.auth.token === "object"
        ? request.auth.token
        : {}
  };
}

function buildAdminContextView({
  uid,
  claims = {},
  environment
} = {}) {
  if (
    !uid ||
    typeof uid !== "string" ||
    !uid.trim()
  ) {
    throw new TypeError(
      "A valid administrative user id is required."
    );
  }

  if (
    !environment ||
    typeof environment !== "string" ||
    !environment.trim()
  ) {
    throw new TypeError(
      "A valid runtime environment is required."
    );
  }

  const access =
    resolveAdministrativeAccess(claims);

  return {
    userId: uid.trim(),
    displayName:
      normalizeDisplayName(claims),

    globalRoles:
      [...access.globalRoles],

    capabilities:
      [...access.capabilities],

    surfaceAccess: {
      operations:
        access.surfaceAccess.operations === true,

      console:
        access.surfaceAccess.console === true
    },

    environment:
      environment.trim(),

    schemaVersion:
      ADMIN_CONTEXT_SCHEMA_VERSION
  };
}

function mapAdminContextError(error) {
  if (error instanceof HttpsError) {
    throw error;
  }

  if (
    error instanceof AdminAccessPolicyError
  ) {
    if (
      error.code ===
      "ADMIN_ROLE_REQUIRED"
    ) {
      throw new HttpsError(
        "permission-denied",
        "Administrative access is not available for this account.",
        {
          domainCode:
            "ADMIN_ROLE_REQUIRED"
        }
      );
    }

    if (
      error.code ===
      "ADMIN_CAPABILITY_REQUIRED" ||
      error.code ===
      "UNKNOWN_ADMIN_CAPABILITY"
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
  }

  throw new HttpsError(
    "internal",
    "Administrative context could not be resolved."
  );
}

function createAdminContextHandler({
  environment
} = {}) {
  if (
    !environment ||
    typeof environment !== "string"
  ) {
    throw new TypeError(
      "Admin context environment is required."
    );
  }

  return async function handleAdminContext(
    request = {}
  ) {
    try {
      assertEmptyPayload(
        request.data
      );

      const actor =
        requireAuthenticatedActor(
          request
        );

      return {
        ok: true,

        context:
          buildAdminContextView({
            uid: actor.uid,
            claims: actor.claims,
            environment
          })
      };
    }
    catch (error) {
      mapAdminContextError(error);
    }
  };
}

function createAdminContextFunctions(
  dependencies = {}
) {
  const {
    REGION,
    environment
  } = dependencies;

  if (
    !REGION ||
    typeof REGION !== "string"
  ) {
    throw new TypeError(
      "Admin context REGION is required."
    );
  }

  const handler =
    createAdminContextHandler({
      environment
    });

  const obterContextoAdministrativoV12 =
    onCall(
      {
        region: REGION
      },
      handler
    );

  return {
    obterContextoAdministrativoV12
  };
}

module.exports = {
  ADMIN_CONTEXT_SCHEMA_VERSION,
  normalizeDisplayName,
  assertEmptyPayload,
  requireAuthenticatedActor,
  buildAdminContextView,
  mapAdminContextError,
  createAdminContextHandler,
  createAdminContextFunctions
};
