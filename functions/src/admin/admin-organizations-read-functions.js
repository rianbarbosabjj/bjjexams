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
  AdminOrganizationsReadError,
  createAdminOrganizationsReadService
} = require(
  "./admin-organizations-read-service"
);

const ORGANIZATIONS_READ_CAPABILITY =
  "ops.organizations.read";

function assertOnlyFields(
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

function requireOrganizationsReadActor(
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
    ORGANIZATIONS_READ_CAPABILITY
  );

  return Object.freeze({
    uid,
    claims
  });
}

function mapOrganizationsReadError(
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
    AdminOrganizationsReadError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_ORGANIZATIONS_READ_FAILED"
      );

    const invalidArgument =
      new Set([
        "ADMIN_ORGANIZATION_IDENTIFIER_INVALID",
        "ADMIN_ORGANIZATIONS_LIMIT_INVALID",
        "ADMIN_ORGANIZATIONS_FILTER_INVALID",
        "ADMIN_ORGANIZATIONS_CURSOR_INVALID"
      ]);

    const notFound =
      new Set([
        "ADMIN_ORGANIZATION_NOT_FOUND"
      ]);

    const failedPrecondition =
      new Set([
        "ADMIN_ORGANIZATIONS_BATCH_INVALID",
        "ADMIN_ORGANIZATIONS_CANONICAL_STATE_INVALID"
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
    "Operational organizations could not be loaded."
  );
}

function createListOrganizationsHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.listOrganizations !==
      "function"
  ) {
    throw new TypeError(
      "Organization list service is required."
    );
  }

  return async function handleListOrganizations(
    request = {}
  ) {
    try {
      const data =
        assertOnlyFields(
          request.data,
          [
            "limit",
            "cursor",
            "status",
            "nameQuery"
          ],
          "Organization listing"
        );

      requireOrganizationsReadActor(
        request
      );

      const result =
        await service
          .listOrganizations({
            limit:
              data.limit,

            cursor:
              data.cursor,

            status:
              data.status,

            nameQuery:
              data.nameQuery
          });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapOrganizationsReadError(
        error
      );
    }
  };
}

function createGetOrganizationHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.getOrganization !==
      "function"
  ) {
    throw new TypeError(
      "Organization detail service is required."
    );
  }

  return async function handleGetOrganization(
    request = {}
  ) {
    try {
      const data =
        assertOnlyFields(
          request.data,
          [
            "organizationId"
          ],
          "Organization detail"
        );

      requireOrganizationsReadActor(
        request
      );

      const result =
        await service
          .getOrganization({
            organizationId:
              data.organizationId
          });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapOrganizationsReadError(
        error
      );
    }
  };
}

function createAdminOrganizationsReadFunctions(
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
      "Admin organization read functions require REGION and Firestore."
    );
  }

  const service =
    createAdminOrganizationsReadService({
      db
    });

  const listarOrganizacoesOperacionaisV12 =
    onCall(
      {
        region:
          REGION
      },
      createListOrganizationsHandler({
        service
      })
    );

  const obterOrganizacaoOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createGetOrganizationHandler({
        service
      })
    );

  return Object.freeze({
    listarOrganizacoesOperacionaisV12,
    obterOrganizacaoOperacionalV12
  });
}

module.exports = {
  ORGANIZATIONS_READ_CAPABILITY,

  assertOnlyFields,
  requireOrganizationsReadActor,
  mapOrganizationsReadError,

  createListOrganizationsHandler,
  createGetOrganizationHandler,
  createAdminOrganizationsReadFunctions
};
