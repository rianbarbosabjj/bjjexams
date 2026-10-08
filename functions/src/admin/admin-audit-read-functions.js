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
  AdminAuditModelError
} = require(
  "./admin-audit-models"
);

const {
  AdminAuditReadError,
  createAdminAuditReadService
} = require(
  "./admin-audit-read-service"
);

const AUDIT_READ_CAPABILITY =
  "console.audit.read";

function assertOnlyAuditFields(
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

function requireAuditReadActor(
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
    AUDIT_READ_CAPABILITY
  );

  return Object.freeze({
    uid
  });
}

function mapAuditReadError(
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
      AdminAuditReadError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_AUDIT_READ_FAILED"
      );

    const invalidArgument =
      new Set([
        "ADMIN_AUDIT_LIMIT_INVALID",
        "ADMIN_AUDIT_FILTER_INVALID",
        "ADMIN_AUDIT_CURSOR_INVALID"
      ]);

    const failedPrecondition =
      new Set([
        "ADMIN_AUDIT_CANONICAL_STATE_INVALID"
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

  if (
    error instanceof
      AdminAuditModelError
  ) {
    throw new HttpsError(
      "failed-precondition",
      error.message,
      {
        domainCode:
          String(
            error.code ||
            "ADMIN_AUDIT_MODEL_INVALID"
          )
      }
    );
  }

  throw new HttpsError(
    "internal",
    "Operational audit events could not be loaded."
  );
}

function createListAuditHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.listAuditEvents !==
      "function"
  ) {
    throw new TypeError(
      "Audit list service is required."
    );
  }

  return async function handleListAudit(
    request = {}
  ) {
    try {
      // Authentication and capability checks precede filter parsing.
      requireAuditReadActor(
        request
      );

      const data =
        assertOnlyAuditFields(
          request.data,
          [
            "limit",
            "cursor",
            "eventType",
            "actorUid",
            "targetType",
            "targetId",
            "organizationId"
          ],
          "Audit listing"
        );

      const result =
        await service.listAuditEvents({
          limit:
            data.limit,

          cursor:
            data.cursor,

          eventType:
            data.eventType,

          actorUid:
            data.actorUid,

          targetType:
            data.targetType,

          targetId:
            data.targetId,

          organizationId:
            data.organizationId
        });

      return {
        ok:
          true,

        ...result
      };
    }
    catch (
      error
    ) {
      mapAuditReadError(
        error
      );
    }
  };
}

function createAdminAuditReadFunctions(
  dependencies = {}
) {
  const {
    REGION,
    db
  } = dependencies;

  if (
    !REGION ||
    typeof REGION !==
      "string" ||
    !db
  ) {
    throw new TypeError(
      "Admin audit read functions require REGION and Firestore."
    );
  }

  const service =
    createAdminAuditReadService({
      db
    });

  const listarAuditoriaOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createListAuditHandler({
        service
      })
    );

  return Object.freeze({
    listarAuditoriaOperacionalV12
  });
}

module.exports = {
  AUDIT_READ_CAPABILITY,

  assertOnlyAuditFields,
  requireAuditReadActor,
  mapAuditReadError,

  createListAuditHandler,
  createAdminAuditReadFunctions
};
