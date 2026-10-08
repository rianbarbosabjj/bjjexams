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
  FinancialAdminDomainError
} = require(
  "../finance/financial-admin-domain"
);

const {
  FinancialDomainError
} = require(
  "../finance/financial-domain"
);

const {
  AdminFinanceConsoleReadError,
  createAdminFinanceConsoleReadService
} = require(
  "./admin-finance-console-read-service"
);

const FINANCE_CONSOLE_READ_CAPABILITY =
  "console.finance.read";

const SPLITS_CONSOLE_READ_CAPABILITY =
  "console.splits.read";

function assertOnlyFinanceConsoleFields(
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

function requireFinanceConsoleActor(
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

  return Object.freeze({
    uid,
    claims
  });
}

function mapFinanceConsoleReadError(
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
      AdminFinanceConsoleReadError
  ) {
    const code =
      String(
        error.code ||
        "ADMIN_FINANCE_READ_FAILED"
      );

    let httpsCode =
      "failed-precondition";

    if (
      code ===
        "ADMIN_FINANCE_IDENTIFIER_INVALID"
    ) {
      httpsCode =
        "invalid-argument";
    }
    else if (
      code ===
        "ADMIN_FINANCE_COURSE_NOT_FOUND"
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
      FinancialAdminDomainError ||
    error instanceof
      FinancialDomainError
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Canonical financial state is invalid.",
      {
        domainCode:
          String(
            error.code ||
            "FINANCIAL_DOMAIN_INVALID"
          )
      }
    );
  }

  throw new HttpsError(
    "internal",
    "Administrative financial data could not be loaded."
  );
}

function createGetFinanceConsoleHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service
      .getFinanceOverview !==
      "function"
  ) {
    throw new TypeError(
      "Finance console read service is required."
    );
  }

  return async function handleGetFinanceConsole(
    request = {}
  ) {
    try {
      requireFinanceConsoleActor(
        request,
        FINANCE_CONSOLE_READ_CAPABILITY
      );

      assertOnlyFinanceConsoleFields(
        request.data,
        [],
        "Finance console read"
      );

      const finance =
        await service
          .getFinanceOverview();

      return {
        ok:
          true,

        finance
      };
    }
    catch (error) {
      mapFinanceConsoleReadError(
        error
      );
    }
  };
}

function createGetSplitsConsoleHandler(
  dependencies = {}
) {
  const {
    service
  } = dependencies;

  if (
    !service ||
    typeof service
      .getCourseSplit !==
      "function"
  ) {
    throw new TypeError(
      "Splits console read service is required."
    );
  }

  return async function handleGetSplitsConsole(
    request = {}
  ) {
    try {
      requireFinanceConsoleActor(
        request,
        SPLITS_CONSOLE_READ_CAPABILITY
      );

      const data =
        assertOnlyFinanceConsoleFields(
          request.data,
          [
            "courseId"
          ],
          "Splits console read"
        );

      const split =
        await service
          .getCourseSplit({
            courseId:
              data.courseId
          });

      return {
        ok:
          true,

        split
      };
    }
    catch (error) {
      mapFinanceConsoleReadError(
        error
      );
    }
  };
}

function createAdminFinanceConsoleReadFunctions(
  dependencies = {}
) {
  const {
    REGION,
    db,
    environment
  } = dependencies;

  if (
    !REGION ||
    typeof REGION !==
      "string" ||
    !db ||
    !environment
  ) {
    throw new TypeError(
      "Admin finance console read functions require REGION, Firestore and financial environment."
    );
  }

  const service =
    createAdminFinanceConsoleReadService({
      db,
      environment
    });

  const obterFinanceiroConsoleV12 =
    onCall(
      {
        region:
          REGION
      },
      createGetFinanceConsoleHandler({
        service
      })
    );

  const obterSplitsConsoleV12 =
    onCall(
      {
        region:
          REGION
      },
      createGetSplitsConsoleHandler({
        service
      })
    );

  return Object.freeze({
    obterFinanceiroConsoleV12,
    obterSplitsConsoleV12
  });
}

module.exports = {
  FINANCE_CONSOLE_READ_CAPABILITY,
  SPLITS_CONSOLE_READ_CAPABILITY,

  assertOnlyFinanceConsoleFields,
  requireFinanceConsoleActor,
  mapFinanceConsoleReadError,

  createGetFinanceConsoleHandler,
  createGetSplitsConsoleHandler,
  createAdminFinanceConsoleReadFunctions
};
