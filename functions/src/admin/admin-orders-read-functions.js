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
  AdminOrderModelError
} = require("./admin-order-models");

const {
  AdminOrdersReadError,
  createAdminOrdersReadService
} = require("./admin-orders-read-service");

const ORDERS_READ_CAPABILITY =
  "ops.orders.read";

function assertOnlyOrderFields(
  data,
  allowedFields,
  operation
) {
  const input =
    data &&
    typeof data === "object" &&
    !Array.isArray(data)
      ? data
      : {};

  const allowed =
    new Set(allowedFields);

  const forbiddenFields =
    Object.keys(input)
      .filter(
        field =>
          !allowed.has(field)
      )
      .sort();

  if (
    forbiddenFields.length > 0
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

function requireOrdersReadActor(
  request = {}
) {
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
    ORDERS_READ_CAPABILITY
  );

  return Object.freeze({
    uid,
    claims
  });
}

function mapOrdersReadError(
  error
) {
  if (
    error instanceof HttpsError
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
      AdminOrdersReadError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_ORDERS_READ_FAILED"
      );

    const invalidArgument =
      new Set([
        "ADMIN_ORDERS_IDENTIFIER_INVALID",
        "ADMIN_ORDERS_LIMIT_INVALID",
        "ADMIN_ORDERS_FILTER_INVALID",
        "ADMIN_ORDERS_CURSOR_INVALID"
      ]);

    const notFound =
      new Set([
        "ADMIN_ORDER_NOT_FOUND"
      ]);

    const failedPrecondition =
      new Set([
        "ADMIN_ORDERS_BATCH_INVALID",
        "ADMIN_ORDERS_REVERSAL_BATCH_INVALID",
        "ADMIN_ORDERS_CANONICAL_STATE_INVALID"
      ]);

    let httpsCode =
      "unavailable";

    if (
      invalidArgument.has(code)
    ) {
      httpsCode =
        "invalid-argument";
    }
    else if (
      notFound.has(code)
    ) {
      httpsCode =
        "not-found";
    }
    else if (
      failedPrecondition.has(code)
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

  if (
    error instanceof
      AdminOrderModelError
  ) {
    throw new HttpsError(
      "failed-precondition",
      error.message,
      {
        domainCode:
          String(
            error.code ||
            "ADMIN_ORDER_MODEL_INVALID"
          )
      }
    );
  }

  throw new HttpsError(
    "internal",
    "Operational orders could not be loaded."
  );
}

function createListOrdersHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.listOrders !==
      "function"
  ) {
    throw new TypeError(
      "Order list service is required."
    );
  }

  return async function handleListOrders(
    request = {}
  ) {
    try {
      // Authenticate/authorize before processing client filters.
      requireOrdersReadActor(
        request
      );

      const data =
        assertOnlyOrderFields(
          request.data,
          [
            "limit",
            "cursor",
            "productType",
            "orderStatus"
          ],
          "Order listing"
        );

      const result =
        await service.listOrders({
          limit:
            data.limit,

          cursor:
            data.cursor,

          productType:
            data.productType,

          orderStatus:
            data.orderStatus
        });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapOrdersReadError(
        error
      );
    }
  };
}

function createGetOrderHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.getOrder !==
      "function"
  ) {
    throw new TypeError(
      "Order detail service is required."
    );
  }

  return async function handleGetOrder(
    request = {}
  ) {
    try {
      // Authenticate/authorize before processing orderId.
      requireOrdersReadActor(
        request
      );

      const data =
        assertOnlyOrderFields(
          request.data,
          [
            "orderId"
          ],
          "Order detail"
        );

      const order =
        await service.getOrder({
          orderId:
            data.orderId
        });

      return {
        ok: true,
        order
      };
    }
    catch (error) {
      mapOrdersReadError(
        error
      );
    }
  };
}

function createAdminOrdersReadFunctions(
  dependencies = {}
) {
  const {
    REGION,
    db
  } = dependencies;

  if (
    !REGION ||
    typeof REGION !== "string" ||
    !db
  ) {
    throw new TypeError(
      "Admin order read functions require REGION and Firestore."
    );
  }

  const service =
    createAdminOrdersReadService({
      db
    });

  const listarPedidosOperacionaisV12 =
    onCall(
      {
        region:
          REGION
      },
      createListOrdersHandler({
        service
      })
    );

  const obterPedidoOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createGetOrderHandler({
        service
      })
    );

  return Object.freeze({
    listarPedidosOperacionaisV12,
    obterPedidoOperacionalV12
  });
}

module.exports = {
  ORDERS_READ_CAPABILITY,

  assertOnlyOrderFields,
  requireOrdersReadActor,
  mapOrdersReadError,

  createListOrdersHandler,
  createGetOrderHandler,
  createAdminOrdersReadFunctions
};
