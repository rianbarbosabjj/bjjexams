"use strict";

const {
  onCall,
  HttpsError
} = require("firebase-functions/v2/https");

const {
  AdminAccessPolicyError,
  requireAdminCapability
} = require("./admin-access-policy");

const {
  AdminWebhookModelError
} = require("./admin-webhook-models");

const {
  AdminWebhooksReadError,
  createAdminWebhooksReadService
} = require("./admin-webhooks-read-service");

const WEBHOOKS_READ_CAPABILITY =
  "console.webhooks.read";

function assertOnlyWebhookFields(data, allowedFields, operation) {
  const input =
    data && typeof data === "object" && !Array.isArray(data)
      ? data
      : {};

  const allowed = new Set(allowedFields);
  const forbiddenFields = Object.keys(input)
    .filter(field => !allowed.has(field))
    .sort();

  if (forbiddenFields.length > 0) {
    throw new HttpsError(
      "invalid-argument",
      `${operation} contains unsupported fields.`,
      { forbiddenFields }
    );
  }

  return input;
}

function requireWebhooksReadActor(request = {}) {
  const uid =
    typeof request.auth?.uid === "string"
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
    typeof request.auth.token === "object" &&
    !Array.isArray(request.auth.token)
      ? request.auth.token
      : {};

  requireAdminCapability(
    claims,
    WEBHOOKS_READ_CAPABILITY
  );

  return Object.freeze({ uid, claims });
}

function mapWebhooksReadError(error) {
  if (error instanceof HttpsError) throw error;

  if (error instanceof AdminAccessPolicyError) {
    throw new HttpsError(
      "permission-denied",
      "Administrative permission is required.",
      { domainCode: error.code }
    );
  }

  if (error instanceof AdminWebhooksReadError) {
    const code = String(error.code || "ADMIN_WEBHOOKS_READ_FAILED");
    const invalidArgument = new Set([
      "ADMIN_WEBHOOKS_IDENTIFIER_INVALID",
      "ADMIN_WEBHOOKS_LIMIT_INVALID",
      "ADMIN_WEBHOOKS_FILTER_INVALID",
      "ADMIN_WEBHOOKS_CURSOR_INVALID"
    ]);
    const notFound = new Set([
      "ADMIN_WEBHOOK_NOT_FOUND"
    ]);
    const failedPrecondition = new Set([
      "ADMIN_WEBHOOKS_CANONICAL_STATE_INVALID"
    ]);

    let httpsCode = "unavailable";
    if (invalidArgument.has(code)) httpsCode = "invalid-argument";
    else if (notFound.has(code)) httpsCode = "not-found";
    else if (failedPrecondition.has(code)) httpsCode = "failed-precondition";

    throw new HttpsError(
      httpsCode,
      error.message,
      { domainCode: code }
    );
  }

  if (error instanceof AdminWebhookModelError) {
    throw new HttpsError(
      "failed-precondition",
      error.message,
      {
        domainCode: String(
          error.code || "ADMIN_WEBHOOK_MODEL_INVALID"
        )
      }
    );
  }

  throw new HttpsError(
    "internal",
    "Operational webhooks could not be loaded."
  );
}

function createListWebhooksHandler(dependencies = {}) {
  const { service } = dependencies;
  if (!service || typeof service.listWebhooks !== "function") {
    throw new TypeError("Webhook list service is required.");
  }

  return async function handleListWebhooks(request = {}) {
    try {
      requireWebhooksReadActor(request);

      const data = assertOnlyWebhookFields(
        request.data,
        ["limit", "cursor", "status", "eventType", "orderId"],
        "Webhook listing"
      );

      const result = await service.listWebhooks({
        limit: data.limit,
        cursor: data.cursor,
        status: data.status,
        eventType: data.eventType,
        orderId: data.orderId
      });

      return { ok: true, ...result };
    } catch (error) {
      mapWebhooksReadError(error);
    }
  };
}

function createGetWebhookHandler(dependencies = {}) {
  const { service } = dependencies;
  if (!service || typeof service.getWebhook !== "function") {
    throw new TypeError("Webhook detail service is required.");
  }

  return async function handleGetWebhook(request = {}) {
    try {
      requireWebhooksReadActor(request);

      const data = assertOnlyWebhookFields(
        request.data,
        ["eventId"],
        "Webhook detail"
      );

      const webhook = await service.getWebhook({
        eventId: data.eventId
      });

      return { ok: true, webhook };
    } catch (error) {
      mapWebhooksReadError(error);
    }
  };
}

function createAdminWebhooksReadFunctions(dependencies = {}) {
  const { REGION, db } = dependencies;
  if (!REGION || typeof REGION !== "string" || !db) {
    throw new TypeError(
      "Admin webhook read functions require REGION and Firestore."
    );
  }

  const service = createAdminWebhooksReadService({ db });

  const listarWebhooksOperacionaisV12 = onCall(
    { region: REGION },
    createListWebhooksHandler({ service })
  );

  const obterWebhookOperacionalV12 = onCall(
    { region: REGION },
    createGetWebhookHandler({ service })
  );

  return Object.freeze({
    listarWebhooksOperacionaisV12,
    obterWebhookOperacionalV12
  });
}

module.exports = {
  WEBHOOKS_READ_CAPABILITY,
  assertOnlyWebhookFields,
  requireWebhooksReadActor,
  mapWebhooksReadError,
  createListWebhooksHandler,
  createGetWebhookHandler,
  createAdminWebhooksReadFunctions
};
