"use strict";

(function initAdminShellRouteApi(root, factory) {
  const api = factory(root);

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminShellRouteApi = api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,

  function buildAdminShellRouteApi(root) {
    const ROUTE_READ_FUNCTIONS =
      Object.freeze([
        "listarWebhooksOperacionaisV12",
        "obterWebhookOperacionalV12",
        "listarAuditoriaOperacionalV12",
        "obterSegurancaOperacionalV12",
        "obterConfiguracaoOperacionalV12",
        "obterSaudeOperacionalV12"
      ]);

    const OPERATIONAL_ROUTE_READ_FUNCTIONS =
      Object.freeze([
        "listarPessoasOperacionaisV12",
        "obterPessoaOperacionalV12",
        "listarOrganizacoesOperacionaisV12",
        "obterOrganizacaoOperacionalV12",
        "listarCursosOperacionaisV12",
        "obterCursoOperacionalV12",
        "listarExamesOperacionaisV12",
        "obterExameOperacionalV12",
        "listarQuestoesOperacionaisV12",
        "obterQuestaoOperacionalV12",
        "listarCertificadosOperacionaisV12",
        "obterCertificadoOperacionalV12",
        "listarPedidosOperacionaisV12",
        "obterPedidoOperacionalV12"
      ]);

    const routeFunctionSet =
      new Set([
        ...ROUTE_READ_FUNCTIONS,
        ...OPERATIONAL_ROUTE_READ_FUNCTIONS
      ]);

    const FORBIDDEN_CLIENT_FIELDS =
      Object.freeze([
        "role",
        "roles",
        "capability",
        "capabilities",
        "projectId",
        "environment",
        "collection",
        "field",
        "operator"
      ]);

    class AdminShellRouteApiError
      extends Error {
      constructor(
        code,
        message,
        details = null
      ) {
        super(message);

        this.name =
          "AdminShellRouteApiError";

        this.code =
          code;

        this.details =
          details;
      }
    }

    function getShellApi() {
      const shellApi =
        root?.BjjExamsAdminShell;

      if (
        !shellApi ||
        typeof shellApi
          .resolveShellEnvironment !==
          "function" ||
        typeof shellApi.REGION !==
          "string"
      ) {
        throw new AdminShellRouteApiError(
          "ADMIN_ROUTE_SHELL_API_UNAVAILABLE",
          "Administrative shell API is unavailable."
        );
      }

      return shellApi;
    }

    function normalizeFunctionName(
      value
    ) {
      return String(value || "")
        .trim();
    }

    function assertAllowedFunction(
      functionName
    ) {
      const normalized =
        normalizeFunctionName(
          functionName
        );

      if (
        !routeFunctionSet.has(
          normalized
        )
      ) {
        throw new AdminShellRouteApiError(
          "ADMIN_ROUTE_FUNCTION_NOT_ALLOWED",
          "Administrative route function is outside the allow-list."
        );
      }

      return normalized;
    }

    function normalizePayload(
      value
    ) {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        throw new AdminShellRouteApiError(
          "ADMIN_ROUTE_PAYLOAD_INVALID",
          "Administrative route payload must be an object."
        );
      }

      for (
        const field of
        FORBIDDEN_CLIENT_FIELDS
      ) {
        if (
          Object.prototype
            .hasOwnProperty.call(
              value,
              field
            )
        ) {
          throw new AdminShellRouteApiError(
            "ADMIN_ROUTE_PAYLOAD_FORBIDDEN",
            "Administrative route payload contains a forbidden authority field."
          );
        }
      }

      return {
        ...value
      };
    }

    function routeFunctionUrl(
      functionName,
      options = {}
    ) {
      const allowed =
        assertAllowedFunction(
          functionName
        );

      const shellApi =
        getShellApi();

      const runtime =
        shellApi
          .resolveShellEnvironment({
            hostname:
              options.hostname ??
              root?.location?.hostname
          });

      return (
        `https://${shellApi.REGION}-` +
        `${runtime.projectId}` +
        ".cloudfunctions.net/" +
        `${allowed}`
      );
    }

    async function callRouteAuthenticated(
      functionName,
      data = {},
      options = {}
    ) {
      const allowed =
        assertAllowedFunction(
          functionName
        );

      const payload =
        normalizePayload(
          data
        );

      const idToken =
        String(
          options.idToken || ""
        ).trim();

      if (!idToken) {
        throw new AdminShellRouteApiError(
          "ADMIN_ROUTE_TOKEN_REQUIRED",
          "Authenticated token is required for route data."
        );
      }

      const fetchImpl =
        options.fetchImpl ||
        root?.fetch;

      if (
        typeof fetchImpl !==
        "function"
      ) {
        throw new AdminShellRouteApiError(
          "ADMIN_ROUTE_FETCH_UNAVAILABLE",
          "Fetch is unavailable for route data."
        );
      }

      const timeoutMs =
        Number(
          options.timeoutMs ||
          15000
        );

      const controller =
        typeof AbortController ===
          "function"
          ? new AbortController()
          : null;

      const timeout =
        controller
          ? setTimeout(
              () =>
                controller.abort(),
              timeoutMs
            )
          : null;

      try {
        const response =
          await fetchImpl(
            routeFunctionUrl(
              allowed,
              options
            ),
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",

                "Authorization":
                  `Bearer ${idToken}`
              },

              body:
                JSON.stringify({
                  data:
                    payload
                }),

              signal:
                controller?.signal
            }
          );

        let body = {};

        try {
          body =
            await response.json();
        }
        catch (_) {}

        if (
          response.ok &&
          Object.prototype
            .hasOwnProperty.call(
              body,
              "result"
            )
        ) {
          return body.result;
        }

        throw new AdminShellRouteApiError(
          "ADMIN_ROUTE_CALL_FAILED",
          "Administrative route request failed.",
          {
            httpStatus:
              Number(
                response.status || 0
              ) || null,

            callableStatus:
              typeof body?.error?.status ===
                "string"
                ? body.error.status
                : null
          }
        );
      }
      catch (error) {
        if (
          error?.name ===
          "AbortError"
        ) {
          throw new AdminShellRouteApiError(
            "ADMIN_ROUTE_CALL_TIMEOUT",
            "Administrative route request timed out."
          );
        }

        throw error;
      }
      finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }

    return Object.freeze({
      ROUTE_READ_FUNCTIONS,
      OPERATIONAL_ROUTE_READ_FUNCTIONS,
      FORBIDDEN_CLIENT_FIELDS,
      AdminShellRouteApiError,
      assertAllowedFunction,
      normalizePayload,
      routeFunctionUrl,
      callRouteAuthenticated
    });
  }
);
