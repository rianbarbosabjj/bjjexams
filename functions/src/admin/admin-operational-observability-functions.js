"use strict";

const {
  onCall,
  HttpsError
} = require(
  "firebase-functions/v2/https"
);

const {
  AdminAccessPolicyError,
  requireAdminCapability
} = require(
  "./admin-access-policy"
);

const {
  AdminOperationalObservabilityModelError
} = require(
  "./admin-operational-observability-models"
);

const {
  AdminOperationalObservabilityServiceError,
  createAdminOperationalObservabilityService
} = require(
  "./admin-operational-observability-service"
);

const SECURITY_READ_CAPABILITY =
  "console.security.read";

const CONFIG_READ_CAPABILITY =
  "console.config.read";

const HEALTH_READ_CAPABILITY =
  "console.health.read";

function assertEmptyOperationalPayload(
  data,
  operation
) {
  if (
    data === undefined ||
    data === null
  ) {
    return {};
  }

  if (
    typeof data !==
      "object" ||
    Array.isArray(
      data
    )
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${operation} payload must be an object.`
    );
  }

  const fields =
    Object.keys(
      data
    );

  if (
    fields.length >
      0
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${operation} does not accept client fields.`,
      {
        forbiddenFields:
          fields.sort()
      }
    );
  }

  return {};
}

function requireOperationalActor(
  request = {},
  capability
) {
  const uid =
    typeof request.auth?.uid ===
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
    request.auth?.token &&
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

  return Object.freeze({
    uid
  });
}

function mapOperationalObservabilityError(
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
      AdminOperationalObservabilityModelError ||
    error instanceof
      AdminOperationalObservabilityServiceError
  ) {
    throw new HttpsError(
      "failed-precondition",
      error.message,
      {
        domainCode:
          String(
            error.code ||
            "ADMIN_OPERATIONAL_OBSERVABILITY_FAILED"
          )
      }
    );
  }

  throw new HttpsError(
    "internal",
    "Operational observability could not be loaded."
  );
}

function createReadHandler(
  dependencies = {}
) {
  const {
    service,
    capability,
    operation,
    method
  } = dependencies;

  if (
    !service ||
    typeof method !==
      "function"
  ) {
    throw new TypeError(
      "Operational observability handler requires a service method."
    );
  }

  return async function handleOperationalRead(
    request = {}
  ) {
    try {
      // Authentication and capability checks intentionally precede payload validation.
      requireOperationalActor(
        request,
        capability
      );

      assertEmptyOperationalPayload(
        request.data,
        operation
      );

      const view =
        await method.call(
          service
        );

      return {
        ok:
          true,

        view
      };
    }
    catch (
      error
    ) {
      mapOperationalObservabilityError(
        error
      );
    }
  };
}

function createAdminOperationalObservabilityFunctions(
  dependencies = {}
) {
  const {
    REGION,
    db,
    config
  } = dependencies;

  if (
    !REGION ||
    typeof REGION !==
      "string" ||
    !db ||
    !config
  ) {
    throw new TypeError(
      "Admin operational observability functions require REGION, Firestore and safe runtime config."
    );
  }

  const service =
    createAdminOperationalObservabilityService({
      db,
      config
    });

  const obterSegurancaOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createReadHandler({
        service,
        capability:
          SECURITY_READ_CAPABILITY,
        operation:
          "Security operational read",
        method:
          service.getSecurityView
      })
    );

  const obterConfiguracaoOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createReadHandler({
        service,
        capability:
          CONFIG_READ_CAPABILITY,
        operation:
          "Config operational read",
        method:
          service.getConfigView
      })
    );

  const obterSaudeOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createReadHandler({
        service,
        capability:
          HEALTH_READ_CAPABILITY,
        operation:
          "Health operational read",
        method:
          service.getHealthView
      })
    );

  return Object.freeze({
    obterSegurancaOperacionalV12,
    obterConfiguracaoOperacionalV12,
    obterSaudeOperacionalV12
  });
}

module.exports = {
  SECURITY_READ_CAPABILITY,
  CONFIG_READ_CAPABILITY,
  HEALTH_READ_CAPABILITY,

  assertEmptyOperationalPayload,
  requireOperationalActor,
  mapOperationalObservabilityError,

  createReadHandler,
  createAdminOperationalObservabilityFunctions
};
