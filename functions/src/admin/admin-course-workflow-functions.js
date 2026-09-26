"use strict";

const {
  randomUUID
} = require(
  "crypto"
);

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
  AdminCourseWorkflowDomainError
} = require(
  "./admin-course-workflow-domain"
);

const {
  AdminCourseWorkflowServiceError,
  createAdminCourseWorkflowService
} = require(
  "./admin-course-workflow-service"
);

const COURSES_MANAGE_CAPABILITY =
  "ops.courses.manage";

const COURSE_WORKFLOW_COMMANDS =
  Object.freeze({
    suspenderCursoOperacionalV12:
      Object.freeze({
        capability:
          COURSES_MANAGE_CAPABILITY,

        targetStatus:
          "suspended",

        operation:
          "Suspend operational course"
      }),

    reativarCursoOperacionalV12:
      Object.freeze({
        capability:
          COURSES_MANAGE_CAPABILITY,

        targetStatus:
          "published",

        operation:
          "Reactivate operational course"
      })
  });

function assertOnlyCourseWorkflowFields(
  data,
  operation
) {
  if (
    data !== undefined &&
    data !== null &&
    (
      typeof data !==
        "object" ||
      Array.isArray(data)
    )
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${operation} payload must be an object.`
    );
  }

  const input =
    data || {};

  const allowed =
    new Set([
      "courseId"
    ]);

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

function resolveCourseWorkflowActorRole(
  claims,
  capability
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
      ] || [];

    if (
      capabilities.includes(
        capability
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

function requireCourseWorkflowActor(
  request = {},
  capability =
    COURSES_MANAGE_CAPABILITY
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

  const actorRole =
    resolveCourseWorkflowActorRole(
      claims,
      capability
    );

  return Object.freeze({
    uid,
    actorRole
  });
}

function createCourseWorkflowRequestId(
  requestIdFactory =
    randomUUID
) {
  if (
    typeof requestIdFactory !==
      "function"
  ) {
    throw new TypeError(
      "Course workflow request ID factory must be a function."
    );
  }

  let generated;

  try {
    generated =
      requestIdFactory();
  }
  catch (_) {
    throw new HttpsError(
      "internal",
      "Administrative request ID could not be generated."
    );
  }

  const requestId =
    typeof generated ===
      "string"
      ? generated.trim()
      : "";

  if (
    !requestId ||
    requestId.length > 128 ||
    requestId.includes("/")
  ) {
    throw new HttpsError(
      "internal",
      "Administrative request ID could not be generated."
    );
  }

  return requestId;
}

function mapCourseWorkflowCommandError(
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
    AdminCourseWorkflowDomainError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_COURSE_WORKFLOW_DOMAIN_FAILED"
      );

    if (
      code ===
      "ADMIN_COURSE_WORKFLOW_INPUT_INVALID"
    ) {
      throw new HttpsError(
        "invalid-argument",
        error.message,
        {
          domainCode:
            code
        }
      );
    }

    if (
      [
        "ADMIN_COURSE_WORKFLOW_STATUS_INVALID",
        "ADMIN_COURSE_WORKFLOW_COURSE_INVALID",
        "ADMIN_COURSE_WORKFLOW_TRANSITION_INVALID"
      ].includes(
        code
      )
    ) {
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
      "Course workflow operation could not be completed.",
      {
        domainCode:
          code
      }
    );
  }

  if (
    error instanceof
    AdminCourseWorkflowServiceError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_COURSE_WORKFLOW_SERVICE_FAILED"
      );

    if (
      code ===
      "ADMIN_COURSE_WORKFLOW_TARGET_NOT_FOUND"
    ) {
      throw new HttpsError(
        "not-found",
        error.message,
        {
          domainCode:
            code
        }
      );
    }

    throw new HttpsError(
      "internal",
      "Course workflow operation could not be completed.",
      {
        domainCode:
          code
      }
    );
  }

  throw new HttpsError(
    "internal",
    "Course workflow operation could not be completed."
  );
}

function createCourseWorkflowCommandHandler(
  dependencies = {}
) {
  const {
    service,
    command,

    requestIdFactory =
      randomUUID
  } = dependencies;

  if (
    !service ||
    typeof service
      .mutateCourseWorkflow !==
      "function"
  ) {
    throw new TypeError(
      "Course workflow mutation service is required."
    );
  }

  if (
    !command ||
    typeof command !==
      "object" ||
    !command.capability ||
    !command.targetStatus ||
    !command.operation
  ) {
    throw new TypeError(
      "Course workflow command descriptor is required."
    );
  }

  if (
    typeof requestIdFactory !==
      "function"
  ) {
    throw new TypeError(
      "Course workflow request ID factory must be a function."
    );
  }

  return async function handleCourseWorkflowCommand(
    request = {}
  ) {
    try {
      // Authentication and authorization happen before payload processing.
      const actor =
        requireCourseWorkflowActor(
          request,
          command.capability
        );

      const data =
        assertOnlyCourseWorkflowFields(
          request.data,
          command.operation
        );

      const requestId =
        createCourseWorkflowRequestId(
          requestIdFactory
        );

      const result =
        await service
          .mutateCourseWorkflow({
            courseId:
              data.courseId,

            targetStatus:
              command.targetStatus,

            actorId:
              actor.uid,

            actorRole:
              actor.actorRole,

            requestId
          });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapCourseWorkflowCommandError(
        error
      );
    }
  };
}

function createAdminCourseWorkflowFunctions(
  dependencies = {}
) {
  const {
    REGION,
    db,

    requestIdFactory =
      randomUUID
  } = dependencies;

  if (
    !REGION ||
    typeof REGION !==
      "string" ||
    !db
  ) {
    throw new TypeError(
      "Admin course workflow functions require REGION and Firestore."
    );
  }

  const service =
    createAdminCourseWorkflowService({
      db
    });

  const suspenderCursoOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createCourseWorkflowCommandHandler({
        service,

        command:
          COURSE_WORKFLOW_COMMANDS
            .suspenderCursoOperacionalV12,

        requestIdFactory
      })
    );

  const reativarCursoOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createCourseWorkflowCommandHandler({
        service,

        command:
          COURSE_WORKFLOW_COMMANDS
            .reativarCursoOperacionalV12,

        requestIdFactory
      })
    );

  return Object.freeze({
    suspenderCursoOperacionalV12,
    reativarCursoOperacionalV12
  });
}

module.exports = {
  COURSES_MANAGE_CAPABILITY,
  COURSE_WORKFLOW_COMMANDS,

  assertOnlyCourseWorkflowFields,
  resolveCourseWorkflowActorRole,
  requireCourseWorkflowActor,
  createCourseWorkflowRequestId,
  mapCourseWorkflowCommandError,

  createCourseWorkflowCommandHandler,
  createAdminCourseWorkflowFunctions
};
