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
  AdminPeopleReadError,
  createAdminPeopleReadService
} = require(
  "./admin-people-read-service"
);

const PEOPLE_READ_CAPABILITY =
  "ops.people.read";

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

function requirePeopleReadActor(
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
    PEOPLE_READ_CAPABILITY
  );

  return Object.freeze({
    uid,
    claims
  });
}

function mapPeopleReadError(
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
    AdminPeopleReadError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_PEOPLE_READ_FAILED"
      );

    const invalidArgument =
      new Set([
        "ADMIN_PEOPLE_IDENTIFIER_INVALID",
        "ADMIN_PEOPLE_LIMIT_INVALID",
        "ADMIN_PEOPLE_CURSOR_INVALID",
        "ADMIN_PEOPLE_FILTER_INVALID"
      ]);

    const notFound =
      new Set([
        "ADMIN_PERSON_NOT_FOUND"
      ]);

    const failedPrecondition =
      new Set([
        "ADMIN_PEOPLE_BATCH_INVALID",
        "ADMIN_PEOPLE_CANONICAL_STATE_INVALID"
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
    "Operational people could not be loaded."
  );
}

function createListPeopleHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.listPeople !==
      "function"
  ) {
    throw new TypeError(
      "People list service is required."
    );
  }

  return async function handleListPeople(
    request = {}
  ) {
    try {
      const data =
        assertOnlyFields(
          request.data,
          [
            "limit",
            "cursor",
            "profileType",
            "operationalStatus"
          ],
          "People listing"
        );

      requirePeopleReadActor(
        request
      );

      const result =
        await service
          .listPeople({
            limit:
              data.limit,

            cursor:
              data.cursor,

            profileType:
              data.profileType,

            operationalStatus:
              data.operationalStatus
          });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapPeopleReadError(
        error
      );
    }
  };
}

function createGetPersonHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service.getPerson !==
      "function"
  ) {
    throw new TypeError(
      "People detail service is required."
    );
  }

  return async function handleGetPerson(
    request = {}
  ) {
    try {
      const data =
        assertOnlyFields(
          request.data,
          [
            "personId"
          ],
          "People detail"
        );

      requirePeopleReadActor(
        request
      );

      const result =
        await service
          .getPerson({
            personId:
              data.personId
          });

      return {
        ok: true,
        ...result
      };
    }
    catch (error) {
      mapPeopleReadError(
        error
      );
    }
  };
}

function createAdminPeopleReadFunctions(
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
      "Admin people read functions require REGION and Firestore."
    );
  }

  const service =
    createAdminPeopleReadService({
      db
    });

  const listarPessoasOperacionaisV12 =
    onCall(
      {
        region:
          REGION
      },
      createListPeopleHandler({
        service
      })
    );

  const obterPessoaOperacionalV12 =
    onCall(
      {
        region:
          REGION
      },
      createGetPersonHandler({
        service
      })
    );

  return Object.freeze({
    listarPessoasOperacionaisV12,
    obterPessoaOperacionalV12
  });
}

module.exports = {
  PEOPLE_READ_CAPABILITY,

  assertOnlyFields,
  requirePeopleReadActor,
  mapPeopleReadError,

  createListPeopleHandler,
  createGetPersonHandler,
  createAdminPeopleReadFunctions
};
