"use strict";

(function initAdminShellApi(root, factory) {
  const api = factory(root);

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminShell = api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,

  function buildAdminShellApi(root) {
    const REGION =
      "southamerica-east1";

    const STAGING_PROJECT_ID =
      "bjj-exams-staging";

    const CONTEXT_FUNCTION =
      "obterContextoAdministrativoV12";

    const ALLOWED_FUNCTIONS =
      new Set([
        CONTEXT_FUNCTION
      ]);

    const STAGING_HOSTS =
      new Set([
        "bjj-exams-staging.web.app",
        "bjj-exams-staging.firebaseapp.com"
      ]);

    const PRODUCTION_HOSTS =
      new Set([
        "bjj-exams.web.app",
        "bjj-exams.firebaseapp.com"
      ]);

    const LOCAL_HOSTS =
      new Set([
        "localhost",
        "127.0.0.1",
        "::1"
      ]);

    class AdminShellApiError
      extends Error {
      constructor(
        code,
        message,
        details = null
      ) {
        super(message);

        this.name =
          "AdminShellApiError";

        this.code =
          code;

        this.details =
          details;
      }
    }

    function normalizeHostname(
      value
    ) {
      return String(value || "")
        .trim()
        .toLowerCase();
    }

    function resolveShellEnvironment(
      options = {}
    ) {
      const hostname =
        normalizeHostname(
          options.hostname ??
          root?.location?.hostname
        );

      if (
        PRODUCTION_HOSTS.has(
          hostname
        )
      ) {
        throw new AdminShellApiError(
          "ADMIN_PRODUCTION_BLOCKED",
          "Administrative shell is not enabled in production."
        );
      }

      if (
        STAGING_HOSTS.has(
          hostname
        )
      ) {
        return Object.freeze({
          environment: "staging",
          projectId:
            STAGING_PROJECT_ID,
          local: false
        });
      }

      if (
        LOCAL_HOSTS.has(
          hostname
        ) ||
        hostname.endsWith(
          ".localhost"
        )
      ) {
        return Object.freeze({
          environment: "staging",
          projectId:
            STAGING_PROJECT_ID,
          local: true
        });
      }

      throw new AdminShellApiError(
        "ADMIN_HOST_NOT_ALLOWED",
        "Administrative shell host is not allowed."
      );
    }

    function functionUrl(
      functionName,
      options = {}
    ) {
      if (
        !ALLOWED_FUNCTIONS.has(
          functionName
        )
      ) {
        throw new AdminShellApiError(
          "ADMIN_FUNCTION_NOT_ALLOWED",
          "Administrative function is outside the shell contract."
        );
      }

      const runtime =
        resolveShellEnvironment(
          options
        );

      return (
        `https://${REGION}-` +
        `${runtime.projectId}` +
        `.cloudfunctions.net/` +
        `${functionName}`
      );
    }

    function sanitizeStringArray(
      value
    ) {
      if (!Array.isArray(value)) {
        return [];
      }

      return [
        ...new Set(
          value
            .filter(
              item =>
                typeof item ===
                "string"
            )
            .map(
              item =>
                item.trim()
            )
            .filter(Boolean)
        )
      ];
    }

    function normalizeContext(
      value
    ) {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        throw new AdminShellApiError(
          "ADMIN_CONTEXT_INVALID",
          "Administrative context is invalid."
        );
      }

      const userId =
        typeof value.userId ===
          "string"
          ? value.userId.trim()
          : "";

      const environment =
        typeof value.environment ===
          "string"
          ? value.environment.trim()
          : "";

      const schemaVersion =
        typeof value.schemaVersion ===
          "string"
          ? value.schemaVersion.trim()
          : "";

      if (!userId) {
        throw new AdminShellApiError(
          "ADMIN_CONTEXT_INVALID",
          "Administrative user id is missing."
        );
      }

      if (
        environment !== "staging" &&
        environment !==
          "demo-emulator"
      ) {
        throw new AdminShellApiError(
          "ADMIN_CONTEXT_ENVIRONMENT_BLOCKED",
          "Administrative context environment is not allowed."
        );
      }

      if (
        schemaVersion !== "1.2"
      ) {
        throw new AdminShellApiError(
          "ADMIN_CONTEXT_SCHEMA_UNSUPPORTED",
          "Administrative context schema is not supported."
        );
      }

      const globalRoles =
        sanitizeStringArray(
          value.globalRoles
        );

      const capabilities =
        sanitizeStringArray(
          value.capabilities
        );

      if (
        globalRoles.length === 0 ||
        capabilities.length === 0
      ) {
        throw new AdminShellApiError(
          "ADMIN_CONTEXT_EMPTY",
          "Administrative access context is empty."
        );
      }

      return Object.freeze({
        userId,

        displayName:
          typeof value.displayName ===
            "string" &&
          value.displayName.trim()
            ? value.displayName.trim()
            : null,

        globalRoles:
          Object.freeze(
            globalRoles
          ),

        capabilities:
          Object.freeze(
            capabilities
          ),

        surfaceAccess:
          Object.freeze({
            operations:
              value
                .surfaceAccess
                ?.operations === true,

            console:
              value
                .surfaceAccess
                ?.console === true
          }),

        environment,

        schemaVersion
      });
    }

    async function callAuthenticated(
      functionName,
      data = {},
      options = {}
    ) {
      const idToken =
        String(
          options.idToken || ""
        ).trim();

      if (!idToken) {
        throw new AdminShellApiError(
          "ADMIN_TOKEN_REQUIRED",
          "Authenticated token is required."
        );
      }

      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        Object.keys(data).length > 0
      ) {
        throw new AdminShellApiError(
          "ADMIN_BOOTSTRAP_PAYLOAD_REJECTED",
          "Administrative bootstrap accepts no client fields."
        );
      }

      const fetchImpl =
        options.fetchImpl ||
        root?.fetch;

      if (
        typeof fetchImpl !==
        "function"
      ) {
        throw new AdminShellApiError(
          "ADMIN_FETCH_UNAVAILABLE",
          "Fetch is unavailable."
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
            functionUrl(
              functionName,
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
                  data: {}
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

        throw new AdminShellApiError(
          "ADMIN_CALL_FAILED",
          body?.error?.message ||
            "Administrative bootstrap failed.",
          {
            httpStatus:
              response.status,

            callableStatus:
              body?.error?.status ||
              null,

            callableDetails:
              body?.error?.details ||
              null
          }
        );
      }
      catch (error) {
        if (
          error?.name ===
          "AbortError"
        ) {
          throw new AdminShellApiError(
            "ADMIN_CALL_TIMEOUT",
            "Administrative bootstrap timed out."
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

    async function getAdminContext(
      options = {}
    ) {
      const result =
        await callAuthenticated(
          CONTEXT_FUNCTION,
          {},
          options
        );

      if (
        result?.ok !== true
      ) {
        throw new AdminShellApiError(
          "ADMIN_CONTEXT_RESPONSE_INVALID",
          "Administrative context response is invalid."
        );
      }

      return normalizeContext(
        result.context
      );
    }

    function hasCapability(
      context,
      capability
    ) {
      if (
        !context ||
        !Array.isArray(
          context.capabilities
        ) ||
        typeof capability !==
          "string"
      ) {
        return false;
      }

      return context
        .capabilities
        .includes(
          capability
        );
    }

    return Object.freeze({
      REGION,
      STAGING_PROJECT_ID,
      CONTEXT_FUNCTION,
      AdminShellApiError,
      resolveShellEnvironment,
      functionUrl,
      normalizeContext,
      callAuthenticated,
      getAdminContext,
      hasCapability
    });
  }
);
