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
  AdminExamModelError
} = require(
  "./admin-exam-models"
);

const {
  AdminExamsReadError,
  createAdminExamsReadService
} = require(
  "./admin-exams-read-service"
);

const EXAMS_READ_CAPABILITY =
  "ops.exams.read";

function assertOnlyFields(
  data,
  allowedFields,
  operation
) {
  const input =
    data &&
    typeof data ===
      "object" &&
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

function requireExamsReadActor(
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
    EXAMS_READ_CAPABILITY
  );

  return Object.freeze({
    uid,
    claims
  });
}

function mapExamsReadError(
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
    AdminExamsReadError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_EXAMS_READ_FAILED"
      );

    const invalidArgument =
      new Set([
        "ADMIN_EXAMS_IDENTIFIER_INVALID",
        "ADMIN_EXAMS_LIMIT_INVALID",
        "ADMIN_EXAMS_FILTER_INVALID",
        "ADMIN_EXAMS_CURSOR_INVALID"
      ]);

    const notFound =
      new Set([
        "ADMIN_EXAM_NOT_FOUND"
      ]);

    const failedPrecondition =
      new Set([
        "ADMIN_EXAMS_BATCH_UNAVAILABLE",
        "ADMIN_EXAMS_AGGREGATE_INVALID",
        "ADMIN_EXAMS_AGGREGATE_UNAVAILABLE"
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

  if (
    error instanceof
    AdminExamModelError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_EXAM_MODEL_INVALID"
      );

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
    "Operational exams could not be loaded."
  );
}

function createListExamsHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.listExams !==
      "function"
  ) {
    throw new TypeError(
      "Exam list service is required."
    );
  }

  return async function handleListExams(
    request = {}
  ) {
    try {
      // Authenticate/authorize before processing client filters.
      requireExamsReadActor(
        request
      );

      const data =
        assertOnlyFields(
          request.data,
          [
            "limit",
            "cursor",
            "status",
            "organizationId",
            "targetBelt"
          ],
          "Exam listing"
        );

      const result =
        await service
          .listExams({
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
      mapExamsReadError(
        error
      );
    }
  };
}

function createGetExamHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.getExam !==
      "function"
  ) {
    throw new TypeError(
      "Exam detail service is required."
    );
  }

  return async function handleGetExam(
    request = {}
  ) {
    try {
      // Authenticate/authorize before processing sessionId.
      requireExamsReadActor(
        request
      );

      const data =
        assertOnlyFields(
          request.data,
          [
            "sessionId"
          ],
          "Exam detail"
        );

      const result =
        await service
          .getExam({
            sessionId:
              data.sessionId
          });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapExamsReadError(
        error
      );
    }
  };
}

function createAdminExamsReadFunctions(
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
      "Admin exam read functions require REGION and Firestore."
    );
  }

  const service =
    createAdminExamsReadService({
      db
    });

  const listarExamesOperacionaisV12 =
    onCall(
      {
        region:
          REGION
      },
      createListExamsHandler({
        service
      })
    );

  const obterExameOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createGetExamHandler({
        service
      })
    );

  return Object.freeze({
    listarExamesOperacionaisV12,
    obterExameOperacionalV12
  });
}

module.exports = {
  EXAMS_READ_CAPABILITY,

  assertOnlyFields,
  requireExamsReadActor,
  mapExamsReadError,

  createListExamsHandler,
  createGetExamHandler,
  createAdminExamsReadFunctions
};