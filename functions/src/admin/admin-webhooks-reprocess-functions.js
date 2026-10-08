"use strict";

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
  AdminWebhookReprocessDomainError
} = require(
  "./admin-webhooks-reprocess-domain"
);

const {
  AdminWebhooksReprocessServiceError,
  createAdminWebhooksReprocessService
} = require(
  "./admin-webhooks-reprocess-service"
);

const {
  createWebhookWorkerHandler
} = require(
  "../finance/financial-webhook-functions"
);

const WEBHOOKS_REPROCESS_CAPABILITY =
  "console.webhooks.reprocess";

function assertOnlyWebhookReprocessFields(
  data,
  allowedFields,
  operation
) {
  if (
    data !== undefined &&
    data !== null &&
    (
      typeof data !==
        "object" ||
      Array.isArray(
        data
      )
    )
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${operation} payload must be an object.`
    );
  }

  const input =
    data ||
    {};

  const allowed =
    new Set(
      allowedFields
    );

  const forbiddenFields =
    Object
      .keys(
        input
      )
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

function resolveWebhookReprocessActorRole(
  claims
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
      ] ||
      [];

    if (
      capabilities.includes(
        WEBHOOKS_REPROCESS_CAPABILITY
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

function requireWebhookReprocessActor(
  request = {}
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
    WEBHOOKS_REPROCESS_CAPABILITY
  );

  const actorRole =
    resolveWebhookReprocessActorRole(
      claims
    );

  return Object.freeze({
    uid,
    actorRole
  });
}

function mapWebhookReprocessError(
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
      AdminWebhookReprocessDomainError ||
    error instanceof
      AdminWebhooksReprocessServiceError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_WEBHOOK_REPROCESS_FAILED"
      );

    const invalidArgument =
      new Set([
        "ADMIN_WEBHOOK_REPROCESS_INPUT_INVALID"
      ]);

    const notFound =
      new Set([
        "ADMIN_WEBHOOK_REPROCESS_NOT_FOUND"
      ]);

    const failedPrecondition =
      new Set([
        "ADMIN_WEBHOOK_REPROCESS_NOT_ELIGIBLE",
        "ADMIN_WEBHOOK_REPROCESS_IN_FLIGHT",
        "ADMIN_WEBHOOK_REPROCESS_CANONICAL_STATE_INVALID",
        "ADMIN_WEBHOOK_REPROCESS_METADATA_INVALID",
        "ADMIN_WEBHOOK_REPROCESS_TIMESTAMP_INVALID",
        "ADMIN_WEBHOOK_REPROCESS_AUDIT_INVALID",
        "ADMIN_WEBHOOK_REPROCESS_PROCESSING_INCOMPLETE"
      ]);

    let httpsCode =
      "unavailable";

    if (
      invalidArgument.has(
        code
      )
    ) {
      httpsCode =
        "invalid-argument";
    }
    else if (
      notFound.has(
        code
      )
    ) {
      httpsCode =
        "not-found";
    }
    else if (
      failedPrecondition.has(
        code
      )
    ) {
      httpsCode =
        "failed-precondition";
    }

    throw new HttpsError(
      httpsCode,
      error.message,
      {
        domainCode:
          code
      }
    );
  }

  throw new HttpsError(
    "internal",
    "Webhook reprocessing failed."
  );
}

function createReprocessWebhookHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.reprocessWebhook !==
      "function"
  ) {
    throw new TypeError(
      "Webhook reprocess service is required."
    );
  }

  return async function handleReprocessWebhook(
    request = {}
  ) {
    try {
      // Authorization intentionally precedes payload validation.
      const actor =
        requireWebhookReprocessActor(
          request
        );

      const data =
        assertOnlyWebhookReprocessFields(
          request.data,
          [
            "eventId",
            "requestId"
          ],
          "Webhook reprocess"
        );

      const result =
        await service.reprocessWebhook({
          eventId:
            data.eventId,

          requestId:
            data.requestId,

          actorUid:
            actor.uid,

          actorRole:
            actor.actorRole
        });

      return {
        ok:
          true,

        ...result
      };
    }
    catch (error) {
      mapWebhookReprocessError(
        error
      );
    }
  };
}

function createAdminWebhooksReprocessFunctions(
  dependencies = {}
) {
  const {
    REGION,
    db,
    providerFactory,
    secrets = [],
    clock =
      () =>
        new Date()
  } = dependencies;

  if (
    !REGION ||
    typeof REGION !==
      "string" ||
    !db ||
    typeof providerFactory !==
      "function"
  ) {
    throw new TypeError(
      "Admin webhook reprocess functions require REGION, Firestore and providerFactory."
    );
  }

  const workerHandler =
    createWebhookWorkerHandler({
      db,
      providerFactory,
      clock
    });

  const processor =
    async ({
      eventId,
      eventData
    }) =>
      workerHandler({
        params: {
          eventId
        },

        data: {
          data:
            () =>
              eventData
        }
      });

  const service =
    createAdminWebhooksReprocessService({
      db,
      processor,
      clock
    });

  const secretList =
    Array.isArray(
      secrets
    )
      ? secrets.filter(
          Boolean
        )
      : [];

  const options = {
    region:
      REGION,

    ...(
      secretList.length
        ? {
            secrets:
              secretList
          }
        : {}
    )
  };

  const reprocessarWebhookOperacionalV12 =
    onCall(
      options,
      createReprocessWebhookHandler({
        service
      })
    );

  return Object.freeze({
    reprocessarWebhookOperacionalV12
  });
}

module.exports = {
  WEBHOOKS_REPROCESS_CAPABILITY,

  assertOnlyWebhookReprocessFields,
  resolveWebhookReprocessActorRole,
  requireWebhookReprocessActor,
  mapWebhookReprocessError,

  createReprocessWebhookHandler,
  createAdminWebhooksReprocessFunctions
};
