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
  AdminQuestionModelError
} = require(
  "./admin-question-models"
);

const {
  AdminQuestionsReadError,
  createAdminQuestionsReadService
} = require(
  "./admin-questions-read-service"
);

const {
  AdminQuestionWriteDomainError
} = require(
  "./admin-question-write-domain"
);

const {
  AdminQuestionWriteServiceError,
  createAdminQuestionWriteService
} = require(
  "./admin-question-write-service"
);

const QUESTIONS_READ_CAPABILITY =
  "ops.questions.read";

const QUESTIONS_MANAGE_CAPABILITY =
  "ops.questions.manage";

const QUESTION_CALLABLE_NAMES =
  Object.freeze([
    "listarQuestoesOperacionaisV12",
    "obterQuestaoOperacionalV12",
    "obterQuestaoEdicaoOperacionalV12",
    "criarQuestaoOperacionalV12",
    "atualizarQuestaoOperacionalV12",
    "moderarQuestaoOperacionalV12",
    "arquivarQuestaoOperacionalV12",
    "importarQuestoesOperacionaisV12"
  ]);

function assertOnlyQuestionFields(
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

function resolveQuestionActorRole(
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

function requireQuestionActor(
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

  const actorRole =
    resolveQuestionActorRole(
      claims,
      capability
    );

  return Object.freeze({
    uid,
    actorRole
  });
}

function createQuestionRequestId(
  requestIdFactory =
    randomUUID
) {
  if (
    typeof requestIdFactory !==
    "function"
  ) {
    throw new TypeError(
      "Question request ID factory must be a function."
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

function mapQuestionCallableError(
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
    AdminQuestionsReadError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_QUESTIONS_READ_FAILED"
      );

    const invalidArgument =
      new Set([
        "ADMIN_QUESTIONS_IDENTIFIER_INVALID",
        "ADMIN_QUESTIONS_LIMIT_INVALID",
        "ADMIN_QUESTIONS_FILTER_INVALID",
        "ADMIN_QUESTIONS_CURSOR_INVALID"
      ]);

    const notFound =
      new Set([
        "ADMIN_QUESTION_NOT_FOUND"
      ]);

    const failedPrecondition =
      new Set([
        "ADMIN_QUESTIONS_BATCH_INVALID",
        "ADMIN_QUESTIONS_CANONICAL_STATE_INVALID"
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
    AdminQuestionModelError
  ) {
    throw new HttpsError(
      "failed-precondition",
      error.message,
      {
        domainCode:
          String(
            error.code ||
            "ADMIN_QUESTION_MODEL_INVALID"
          )
      }
    );
  }

  if (
    error instanceof
    AdminQuestionWriteDomainError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_QUESTION_WRITE_DOMAIN_FAILED"
      );

    const invalidArgument =
      new Set([
        "ADMIN_QUESTION_WRITE_INPUT_INVALID",
        "ADMIN_QUESTION_WRITE_IDENTIFIER_INVALID",
        "ADMIN_QUESTION_WRITE_EXPECTED_REVISION_INVALID",
        "ADMIN_QUESTION_WRITE_UNSUPPORTED_FIELDS",
        "ADMIN_QUESTION_WRITE_CONTENT_REQUIRED",
        "ADMIN_QUESTION_WRITE_CONTENT_INVALID",
        "ADMIN_QUESTION_WRITE_MODERATION_DECISION_INVALID",
        "ADMIN_QUESTION_WRITE_MODERATION_REASON_REQUIRED",
        "ADMIN_QUESTION_IMPORT_SIZE_INVALID"
      ]);

    const failedPrecondition =
      new Set([
        "ADMIN_QUESTION_WRITE_REVISION_CONFLICT",
        "ADMIN_QUESTION_WRITE_CONTENT_EDIT_ARCHIVED",
        "ADMIN_QUESTION_WRITE_TRANSITION_INVALID",
        "ADMIN_QUESTION_WRITE_REVISION_OVERFLOW",
        "ADMIN_QUESTION_WRITE_CANONICAL_INVALID",
        "ADMIN_QUESTION_WRITE_NO_CHANGES"
      ]);

    let httpsCode =
      "internal";

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
    AdminQuestionWriteServiceError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_QUESTION_WRITE_SERVICE_FAILED"
      );

    if (
      code ===
      "ADMIN_QUESTION_WRITE_NOT_FOUND"
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

    if (
      code ===
      "ADMIN_QUESTION_IMPORT_BATCH_INVALID"
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
      "Question operation could not be completed.",
      {
        domainCode:
          code
      }
    );
  }

  throw new HttpsError(
    "internal",
    "Question operation could not be completed."
  );
}

function createListQuestionsHandler(
  dependencies = {}
) {
  const {
    readService
  } = dependencies;

  if (
    !readService ||
    typeof readService.listQuestions !==
      "function"
  ) {
    throw new TypeError(
      "Question list service is required."
    );
  }

  return async function handleListQuestions(
    request = {}
  ) {
    try {
      requireQuestionActor(
        request,
        QUESTIONS_READ_CAPABILITY
      );

      const data =
        assertOnlyQuestionFields(
          request.data,
          [
            "limit",
            "cursor",
            "lifecycleStatus",
            "difficulty",
            "category"
          ],
          "Question listing"
        );

      const result =
        await readService
          .listQuestions({
            limit:
              data.limit,

            cursor:
              data.cursor,

            lifecycleStatus:
              data.lifecycleStatus,

            difficulty:
              data.difficulty,

            category:
              data.category
          });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapQuestionCallableError(
        error
      );
    }
  };
}

function createGetQuestionHandler(
  dependencies = {}
) {
  const {
    readService
  } = dependencies;

  if (
    !readService ||
    typeof readService.getQuestion !==
      "function"
  ) {
    throw new TypeError(
      "Question detail service is required."
    );
  }

  return async function handleGetQuestion(
    request = {}
  ) {
    try {
      requireQuestionActor(
        request,
        QUESTIONS_READ_CAPABILITY
      );

      const data =
        assertOnlyQuestionFields(
          request.data,
          [
            "questionId"
          ],
          "Question detail"
        );

      const question =
        await readService
          .getQuestion({
            questionId:
              data.questionId
          });

      return {
        ok: true,
        question
      };
    }
    catch (error) {
      mapQuestionCallableError(
        error
      );
    }
  };
}

function createGetQuestionForAuthoringHandler(
  dependencies = {}
) {
  const {
    readService
  } = dependencies;

  if (
    !readService ||
    typeof readService
      .getQuestionForAuthoring !==
      "function"
  ) {
    throw new TypeError(
      "Question authoring service is required."
    );
  }

  return async function handleGetQuestionForAuthoring(
    request = {}
  ) {
    try {
      requireQuestionActor(
        request,
        QUESTIONS_MANAGE_CAPABILITY
      );

      const data =
        assertOnlyQuestionFields(
          request.data,
          [
            "questionId"
          ],
          "Question authoring detail"
        );

      const question =
        await readService
          .getQuestionForAuthoring({
            questionId:
              data.questionId
          });

      return {
        ok: true,
        question
      };
    }
    catch (error) {
      mapQuestionCallableError(
        error
      );
    }
  };
}

function createQuestionMutationHandler(
  dependencies = {}
) {
  const {
    writeService,
    operation,
    allowedFields,
    invoke,

    requestIdFactory =
      randomUUID
  } = dependencies;

  if (
    !writeService ||
    typeof writeService !==
      "object"
  ) {
    throw new TypeError(
      "Question write service is required."
    );
  }

  if (
    typeof operation !==
      "string" ||
    !operation.trim() ||
    !Array.isArray(
      allowedFields
    ) ||
    typeof invoke !==
      "function"
  ) {
    throw new TypeError(
      "Question mutation descriptor is invalid."
    );
  }

  if (
    typeof requestIdFactory !==
      "function"
  ) {
    throw new TypeError(
      "Question request ID factory must be a function."
    );
  }

  return async function handleQuestionMutation(
    request = {}
  ) {
    try {
      const actor =
        requireQuestionActor(
          request,
          QUESTIONS_MANAGE_CAPABILITY
        );

      const data =
        assertOnlyQuestionFields(
          request.data,
          allowedFields,
          operation
        );

      const requestId =
        createQuestionRequestId(
          requestIdFactory
        );

      const result =
        await invoke({
          writeService,
          data,
          actor,
          requestId
        });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapQuestionCallableError(
        error
      );
    }
  };
}

function createCreateQuestionHandler(
  dependencies = {}
) {
  const {
    writeService,
    requestIdFactory
  } = dependencies;

  if (
    !writeService ||
    typeof writeService.createQuestion !==
      "function"
  ) {
    throw new TypeError(
      "Question create service is required."
    );
  }

  return createQuestionMutationHandler({
    writeService,
    requestIdFactory,
    operation:
      "Create operational question",
    allowedFields:
      [
        "content"
      ],
    invoke:
      ({
        writeService:
          service,
        data,
        actor,
        requestId
      }) =>
        service.createQuestion({
          content:
            data.content,
          actorId:
            actor.uid,
          actorRole:
            actor.actorRole,
          requestId
        })
  });
}

function createUpdateQuestionHandler(
  dependencies = {}
) {
  const {
    writeService,
    requestIdFactory
  } = dependencies;

  if (
    !writeService ||
    typeof writeService.updateQuestion !==
      "function"
  ) {
    throw new TypeError(
      "Question update service is required."
    );
  }

  return createQuestionMutationHandler({
    writeService,
    requestIdFactory,
    operation:
      "Update operational question",
    allowedFields:
      [
        "questionId",
        "expectedRevision",
        "patch",
        "submitForReview"
      ],
    invoke:
      ({
        writeService:
          service,
        data,
        actor,
        requestId
      }) =>
        service.updateQuestion({
          questionId:
            data.questionId,
          expectedRevision:
            data.expectedRevision,
          patch:
            data.patch,
          submitForReview:
            data.submitForReview,
          actorId:
            actor.uid,
          actorRole:
            actor.actorRole,
          requestId
        })
  });
}

function createModerateQuestionHandler(
  dependencies = {}
) {
  const {
    writeService,
    requestIdFactory
  } = dependencies;

  if (
    !writeService ||
    typeof writeService.moderateQuestion !==
      "function"
  ) {
    throw new TypeError(
      "Question moderation service is required."
    );
  }

  return createQuestionMutationHandler({
    writeService,
    requestIdFactory,
    operation:
      "Moderate operational question",
    allowedFields:
      [
        "questionId",
        "expectedRevision",
        "decision",
        "reason"
      ],
    invoke:
      ({
        writeService:
          service,
        data,
        actor,
        requestId
      }) =>
        service.moderateQuestion({
          questionId:
            data.questionId,
          expectedRevision:
            data.expectedRevision,
          decision:
            data.decision,
          reason:
            data.reason,
          actorId:
            actor.uid,
          actorRole:
            actor.actorRole,
          requestId
        })
  });
}

function createArchiveQuestionHandler(
  dependencies = {}
) {
  const {
    writeService,
    requestIdFactory
  } = dependencies;

  if (
    !writeService ||
    typeof writeService.archiveQuestion !==
      "function"
  ) {
    throw new TypeError(
      "Question archive service is required."
    );
  }

  return createQuestionMutationHandler({
    writeService,
    requestIdFactory,
    operation:
      "Archive operational question",
    allowedFields:
      [
        "questionId",
        "expectedRevision"
      ],
    invoke:
      ({
        writeService:
          service,
        data,
        actor,
        requestId
      }) =>
        service.archiveQuestion({
          questionId:
            data.questionId,
          expectedRevision:
            data.expectedRevision,
          actorId:
            actor.uid,
          actorRole:
            actor.actorRole,
          requestId
        })
  });
}

function createImportQuestionsHandler(
  dependencies = {}
) {
  const {
    writeService,
    requestIdFactory
  } = dependencies;

  if (
    !writeService ||
    typeof writeService.importQuestions !==
      "function"
  ) {
    throw new TypeError(
      "Question import service is required."
    );
  }

  return createQuestionMutationHandler({
    writeService,
    requestIdFactory,
    operation:
      "Import operational questions",
    allowedFields:
      [
        "items"
      ],
    invoke:
      ({
        writeService:
          service,
        data,
        actor,
        requestId
      }) =>
        service.importQuestions({
          items:
            data.items,
          actorId:
            actor.uid,
          actorRole:
            actor.actorRole,
          requestId
        })
  });
}

function createAdminQuestionFunctions(
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
      "Admin question functions require REGION and Firestore."
    );
  }

  if (
    typeof requestIdFactory !==
      "function"
  ) {
    throw new TypeError(
      "Question request ID factory must be a function."
    );
  }

  const readService =
    createAdminQuestionsReadService({
      db
    });

  const writeService =
    createAdminQuestionWriteService({
      db
    });

  const handlers = {
    listarQuestoesOperacionaisV12:
      createListQuestionsHandler({
        readService
      }),

    obterQuestaoOperacionalV12:
      createGetQuestionHandler({
        readService
      }),

    obterQuestaoEdicaoOperacionalV12:
      createGetQuestionForAuthoringHandler({
        readService
      }),

    criarQuestaoOperacionalV12:
      createCreateQuestionHandler({
        writeService,
        requestIdFactory
      }),

    atualizarQuestaoOperacionalV12:
      createUpdateQuestionHandler({
        writeService,
        requestIdFactory
      }),

    moderarQuestaoOperacionalV12:
      createModerateQuestionHandler({
        writeService,
        requestIdFactory
      }),

    arquivarQuestaoOperacionalV12:
      createArchiveQuestionHandler({
        writeService,
        requestIdFactory
      }),

    importarQuestoesOperacionaisV12:
      createImportQuestionsHandler({
        writeService,
        requestIdFactory
      })
  };

  const result = {};

  for (
    const functionName
    of QUESTION_CALLABLE_NAMES
  ) {
    result[functionName] =
      onCall(
        {
          region:
            REGION
        },
        handlers[
          functionName
        ]
      );
  }

  return Object.freeze(
    result
  );
}

module.exports = {
  QUESTIONS_READ_CAPABILITY,
  QUESTIONS_MANAGE_CAPABILITY,
  QUESTION_CALLABLE_NAMES,

  assertOnlyQuestionFields,
  resolveQuestionActorRole,
  requireQuestionActor,
  createQuestionRequestId,
  mapQuestionCallableError,

  createListQuestionsHandler,
  createGetQuestionHandler,
  createGetQuestionForAuthoringHandler,

  createQuestionMutationHandler,
  createCreateQuestionHandler,
  createUpdateQuestionHandler,
  createModerateQuestionHandler,
  createArchiveQuestionHandler,
  createImportQuestionsHandler,

  createAdminQuestionFunctions
};