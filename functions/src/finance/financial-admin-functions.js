"use strict";

const {
  onCall,
  HttpsError
} = require("firebase-functions/v2/https");

const {
  FinancialDomainError
} = require("./financial-domain");

const {
  FinancialAdminDomainError
} = require("./financial-admin-domain");

const {
  FinancialAdminServiceError,
  createFinancialAdminService
} = require("./financial-admin-service");

function createFinancialAdminFunctions(
  dependencies = {}
) {
  const {
    REGION,
    db,
    environment,
    clock
  } = dependencies;

  if (!REGION || !db || !environment) {
    throw new Error(
      "Financial admin functions: infraestrutura obrigatoria ausente."
    );
  }

  const service = createFinancialAdminService({
    db,
    environment,
    clock
  });

  function requireAuth(request) {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Faça login para continuar."
      );
    }

    return {
      actorId: uid,
      claims: request.auth?.token || {}
    };
  }

  function assertOnlyFields(data, allowedFields) {
    const input =
      data && typeof data === "object" && !Array.isArray(data)
        ? data
        : {};

    const allowed = new Set(allowedFields);
    const forbidden = Object.keys(input)
      .filter(key => !allowed.has(key));

    if (forbidden.length) {
      throw new HttpsError(
        "invalid-argument",
        "A solicitação contém campos não permitidos.",
        {
          forbiddenFields: forbidden
        }
      );
    }

    return input;
  }

  function mapFinancialError(error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    const isKnown =
      error instanceof FinancialAdminServiceError ||
      error instanceof FinancialAdminDomainError ||
      error instanceof FinancialDomainError;

    if (!isKnown) {
      throw new HttpsError(
        "internal",
        "Não foi possível processar a configuração financeira."
      );
    }

    const code = String(error.code || "");

    if (code === "FINANCIAL_ADMIN_PERMISSION_REQUIRED") {
      throw new HttpsError(
        "permission-denied",
        "Você não possui permissão para administrar configurações financeiras.",
        {
          domainCode: code
        }
      );
    }

    if (
      code === "COURSE_NOT_FOUND" ||
      code === "RECIPIENT_IDENTITY_NOT_FOUND"
    ) {
      throw new HttpsError(
        "not-found",
        error.message,
        {
          domainCode: code
        }
      );
    }

    const failedPreconditionCodes = new Set([
      "FINANCIAL_RECIPIENT_NOT_READY",
      "ARCHIVED_COURSE_FINANCE_LOCKED",
      "PAID_COURSE_REQUIRED",
      "INVALID_DEFAULT_RULE_SHAPE",
      "RECIPIENT_ACCOUNT_IDENTITY_IMMUTABLE",
      "INVALID_EXISTING_PRODUCT_RULE"
    ]);

    if (failedPreconditionCodes.has(code)) {
      throw new HttpsError(
        "failed-precondition",
        error.message,
        {
          domainCode: code
        }
      );
    }

    throw new HttpsError(
      "invalid-argument",
      error.message,
      {
        domainCode: code || null
      }
    );
  }

  async function invoke(request, operation) {
    const auth = requireAuth(request);

    try {
      return await operation(auth);
    } catch (error) {
      mapFinancialError(error);
    }
  }

  const obterConfiguracaoFinanceiraV12 = onCall(
    {
      region: REGION
    },
    async request => {
      assertOnlyFields(request.data, []);

      return invoke(
        request,
        async auth => ({
          ok: true,
          configuration:
            await service.getDefaultConfiguration(auth)
        })
      );
    }
  );

  const atualizarTaxaPadraoFinanceiraV12 = onCall(
    {
      region: REGION
    },
    async request => {
      const data = assertOnlyFields(
        request.data,
        ["platformFeeBps"]
      );

      return invoke(
        request,
        async auth => ({
          ok: true,
          ...await service.updateDefaultRule({
            ...auth,
            data
          })
        })
      );
    }
  );

  const configurarContaRecebedorFinanceiroV12 = onCall(
    {
      region: REGION
    },
    async request => {
      const data = assertOnlyFields(
        request.data,
        [
          "recipientType",
          "recipientId",
          "walletId",
          "status"
        ]
      );

      return invoke(
        request,
        async auth => ({
          ok: true,
          ...await service.configureRecipientAccount({
            ...auth,
            data
          })
        })
      );
    }
  );

  const salvarRegraFinanceiraCursoV12 = onCall(
    {
      region: REGION
    },
    async request => {
      const data = assertOnlyFields(
        request.data,
        [
          "courseId",
          "platformFeeBps",
          "recipientMode",
          "recipientShares",
          "status"
        ]
      );

      return invoke(
        request,
        async auth => ({
          ok: true,
          ...await service.saveCourseRule({
            ...auth,
            data
          })
        })
      );
    }
  );

  const obterRegraFinanceiraCursoV12 = onCall(
    {
      region: REGION
    },
    async request => {
      const data = assertOnlyFields(
        request.data,
        ["courseId"]
      );

      return invoke(
        request,
        async auth => ({
          ok: true,
          ...await service.getCourseRule({
            ...auth,
            courseId: data.courseId
          })
        })
      );
    }
  );

  return {
    obterConfiguracaoFinanceiraV12,
    atualizarTaxaPadraoFinanceiraV12,
    configurarContaRecebedorFinanceiroV12,
    salvarRegraFinanceiraCursoV12,
    obterRegraFinanceiraCursoV12
  };
}

module.exports = {
  createFinancialAdminFunctions
};
