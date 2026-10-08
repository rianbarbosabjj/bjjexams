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
  AdminCoursesReadError,
  createAdminCoursesReadService
} = require(
  "./admin-courses-read-service"
);

const COURSES_READ_CAPABILITY =
  "ops.courses.read";

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

function requireCoursesReadActor(
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
    COURSES_READ_CAPABILITY
  );

  return Object.freeze({
    uid,
    claims
  });
}

function mapCoursesReadError(
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
    AdminCoursesReadError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_COURSES_READ_FAILED"
      );

    const invalidArgument =
      new Set([
        "ADMIN_COURSES_IDENTIFIER_INVALID",
        "ADMIN_COURSES_LIMIT_INVALID",
        "ADMIN_COURSES_FILTER_INVALID",
        "ADMIN_COURSES_CURSOR_INVALID"
      ]);

    const notFound =
      new Set([
        "ADMIN_COURSE_NOT_FOUND"
      ]);

    const failedPrecondition =
      new Set([
        "ADMIN_COURSES_BATCH_INVALID",
        "ADMIN_COURSES_CANONICAL_STATE_INVALID",
        "ADMIN_COURSES_AGGREGATE_INVALID",
        "ADMIN_COURSES_AGGREGATE_UNAVAILABLE"
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
    "Operational courses could not be loaded."
  );
}

function createListCoursesHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.listCourses !==
      "function"
  ) {
    throw new TypeError(
      "Course list service is required."
    );
  }

  return async function handleListCourses(
    request = {}
  ) {
    try {
      // Authenticate/authorize before processing client filters.
      requireCoursesReadActor(
        request
      );

      const data =
        assertOnlyFields(
          request.data,
          [
            "limit",
            "cursor",
            "workflowStatus",
            "ownerType",
            "visibility",
            "moderationStatus"
          ],
          "Course listing"
        );

      const result =
        await service
          .listCourses({
            limit:
              data.limit,

            cursor:
              data.cursor,

            workflowStatus:
              data.workflowStatus,

            ownerType:
              data.ownerType,

            visibility:
              data.visibility,

            moderationStatus:
              data.moderationStatus
          });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapCoursesReadError(
        error
      );
    }
  };
}

function createGetCourseHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.getCourse !==
      "function"
  ) {
    throw new TypeError(
      "Course detail service is required."
    );
  }

  return async function handleGetCourse(
    request = {}
  ) {
    try {
      // Authenticate/authorize before processing courseId.
      requireCoursesReadActor(
        request
      );

      const data =
        assertOnlyFields(
          request.data,
          [
            "courseId"
          ],
          "Course detail"
        );

      const result =
        await service
          .getCourse({
            courseId:
              data.courseId
          });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapCoursesReadError(
        error
      );
    }
  };
}

function createAdminCoursesReadFunctions(
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
      "Admin course read functions require REGION and Firestore."
    );
  }

  const service =
    createAdminCoursesReadService({
      db
    });

  const listarCursosOperacionaisV12 =
    onCall(
      {
        region:
          REGION
      },
      createListCoursesHandler({
        service
      })
    );

  const obterCursoOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createGetCourseHandler({
        service
      })
    );

  return Object.freeze({
    listarCursosOperacionaisV12,
    obterCursoOperacionalV12
  });
}

module.exports = {
  COURSES_READ_CAPABILITY,

  assertOnlyFields,
  requireCoursesReadActor,
  mapCoursesReadError,

  createListCoursesHandler,
  createGetCourseHandler,
  createAdminCoursesReadFunctions
};
