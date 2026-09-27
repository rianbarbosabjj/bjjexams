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
  AdminCertificateModelError
} = require(
  "./admin-certificate-models"
);

const {
  AdminCertificatesReadError,
  createAdminCertificatesReadService
} = require(
  "./admin-certificates-read-service"
);

const CERTIFICATES_READ_CAPABILITY =
  "ops.certificates.read";

function assertOnlyCertificateFields(
  data,
  allowedFields,
  operation
) {
  const input =
    data &&
    typeof data ===
      "object" &&
    !Array.isArray(
      data
    )
      ? data
      : {};

  const allowed =
    new Set(
      allowedFields
    );

  const forbiddenFields =
    Object.keys(
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

function requireCertificatesReadActor(
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
    CERTIFICATES_READ_CAPABILITY
  );

  return Object.freeze({
    uid,
    claims
  });
}

function mapCertificatesReadError(
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
      AdminCertificatesReadError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_CERTIFICATES_READ_FAILED"
      );

    const invalidArgument =
      new Set([
        "ADMIN_CERTIFICATES_IDENTIFIER_INVALID",
        "ADMIN_CERTIFICATES_LIMIT_INVALID",
        "ADMIN_CERTIFICATES_FILTER_INVALID",
        "ADMIN_CERTIFICATES_CURSOR_INVALID"
      ]);

    const notFound =
      new Set([
        "ADMIN_CERTIFICATE_NOT_FOUND"
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
      AdminCertificateModelError
  ) {
    throw new HttpsError(
      "failed-precondition",
      error.message,
      {
        domainCode:
          String(
            error.code ||
            "ADMIN_CERTIFICATE_MODEL_INVALID"
          )
      }
    );
  }

  throw new HttpsError(
    "internal",
    "Operational certificates could not be loaded."
  );
}

function createListCertificatesHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.listCertificates !==
      "function"
  ) {
    throw new TypeError(
      "Certificate list service is required."
    );
  }

  return async function handleListCertificates(
    request = {}
  ) {
    try {
      requireCertificatesReadActor(
        request
      );

      const data =
        assertOnlyCertificateFields(
          request.data,
          [
            "limit",
            "cursor",
            "status",
            "organizationId",
            "targetBelt"
          ],
          "Certificate listing"
        );

      const result =
        await service
          .listCertificates({
            limit:
              data.limit,

            cursor:
              data.cursor,

            status:
              data.status,

            organizationId:
              data.organizationId,

            targetBelt:
              data.targetBelt
          });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapCertificatesReadError(
        error
      );
    }
  };
}

function createGetCertificateHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.getCertificate !==
      "function"
  ) {
    throw new TypeError(
      "Certificate detail service is required."
    );
  }

  return async function handleGetCertificate(
    request = {}
  ) {
    try {
      requireCertificatesReadActor(
        request
      );

      const data =
        assertOnlyCertificateFields(
          request.data,
          [
            "certificateId"
          ],
          "Certificate detail"
        );

      const certificate =
        await service
          .getCertificate({
            certificateId:
              data.certificateId
          });

      return {
        ok: true,
        certificate
      };
    }
    catch (error) {
      mapCertificatesReadError(
        error
      );
    }
  };
}

function createAdminCertificatesReadFunctions(
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
      "Admin certificate read functions require REGION and Firestore."
    );
  }

  const service =
    createAdminCertificatesReadService({
      db
    });

  const listarCertificadosOperacionaisV12 =
    onCall(
      {
        region:
          REGION
      },
      createListCertificatesHandler({
        service
      })
    );

  const obterCertificadoOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createGetCertificateHandler({
        service
      })
    );

  return Object.freeze({
    listarCertificadosOperacionaisV12,
    obterCertificadoOperacionalV12
  });
}

module.exports = {
  CERTIFICATES_READ_CAPABILITY,

  assertOnlyCertificateFields,
  requireCertificatesReadActor,
  mapCertificatesReadError,

  createListCertificatesHandler,
  createGetCertificateHandler,
  createAdminCertificatesReadFunctions
};