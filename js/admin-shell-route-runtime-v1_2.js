"use strict";

(function initAdminShellRouteRuntime(root, factory) {
  const api = factory(root);

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminShellRouteRuntime =
      api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,

  function buildAdminShellRouteRuntime(root) {
    const ROUTE_STATES =
      Object.freeze({
        loading:
          "route-loading",

        ready:
          "route-ready",

        empty:
          "route-empty",

        error:
          "route-error",

        notIntegrated:
          "route-not-integrated"
      });

    function freezeState(
      value
    ) {
      return Object.freeze({
        ...value
      });
    }

    function normalizeRoute(
      value
    ) {
      return String(value || "")
        .trim();
    }

    function sanitizeErrorCode(
      error
    ) {
      const code =
        typeof error?.code ===
          "string"
          ? error.code.trim()
          : "";

      if (code) {
        return code;
      }

      const callableStatus =
        typeof error?.details
          ?.callableStatus ===
          "string"
          ? error
              .details
              .callableStatus
              .trim()
          : "";

      return (
        callableStatus ||
        "ADMIN_ROUTE_UNEXPECTED_FAILURE"
      );
    }

    function isEmptyResult(
      result,
      contract
    ) {
      if (
        !contract?.listKey
      ) {
        return false;
      }

      const items =
        result?.[
          contract.listKey
        ];

      return (
        Array.isArray(items) &&
        items.length === 0
      );
    }

    function createRouteRuntime(
      options = {}
    ) {
      const registry =
        options.registry ||
        root
          ?.BjjExamsAdminShellRouteRegistry;

      const navigationApi =
        options.navigationApi ||
        root
          ?.BjjExamsAdminShellNavigation;

      const routeApi =
        options.routeApi ||
        root
          ?.BjjExamsAdminShellRouteApi;

      const onStateChange =
        typeof options
          .onStateChange ===
          "function"
          ? options.onStateChange
          : null;

      if (
        !registry ||
        typeof registry
          .getRouteDefinition !==
          "function"
      ) {
        throw new TypeError(
          "Route registry invalido."
        );
      }

      if (
        !navigationApi ||
        typeof navigationApi
          .canNavigateTo !==
          "function"
      ) {
        throw new TypeError(
          "Navigation API invalida."
        );
      }

      if (
        !routeApi ||
        typeof routeApi
          .callRouteAuthenticated !==
          "function"
      ) {
        throw new TypeError(
          "Route API invalida."
        );
      }

      let context = null;
      let idToken = "";
      let transport = {};
      let sessionGeneration = 0;
      let requestGeneration = 0;
      let currentState = null;

      function emit(
        value
      ) {
        currentState =
          freezeState(
            value
          );

        if (onStateChange) {
          onStateChange(
            currentState
          );
        }

        return currentState;
      }

      function setSession(
        session = {}
      ) {
        if (
          !session.context ||
          typeof session.context !==
            "object" ||
          Array.isArray(
            session.context
          )
        ) {
          throw new TypeError(
            "Route context invalido."
          );
        }

        const token =
          String(
            session.idToken || ""
          ).trim();

        if (!token) {
          throw new TypeError(
            "Route token obrigatorio."
          );
        }

        sessionGeneration += 1;
        requestGeneration += 1;

        context =
          session.context;

        idToken =
          token;

        transport = {
          hostname:
            session.hostname,

          fetchImpl:
            session.fetchImpl,

          timeoutMs:
            session.timeoutMs
        };

        currentState =
          null;

        return Object.freeze({
          sessionGeneration
        });
      }

      function clearSession() {
        sessionGeneration += 1;
        requestGeneration += 1;

        context = null;
        idToken = "";
        transport = {};
        currentState = null;

        return true;
      }

      async function activate(
        routeId,
        request = {}
      ) {
        const route =
          normalizeRoute(
            routeId
          );

        const myRequest =
          ++requestGeneration;

        const mySession =
          sessionGeneration;

        if (
          !context ||
          !idToken
        ) {
          return emit({
            state:
              ROUTE_STATES.error,

            routeId:
              route || null,

            errorCode:
              "ROUTE_SESSION_REQUIRED"
          });
        }

        if (
          !navigationApi
            .canNavigateTo(
              context,
              route
            )
        ) {
          return emit({
            state:
              ROUTE_STATES.error,

            routeId:
              route || null,

            errorCode:
              "ROUTE_ACCESS_DENIED"
          });
        }

        const contract =
          registry
            .getRouteDefinition(
              route
            );

        if (!contract) {
          return emit({
            state:
              ROUTE_STATES.error,

            routeId:
              route || null,

            errorCode:
              "ROUTE_UNKNOWN"
          });
        }

        if (
          contract.integrated !==
            true ||
          !contract.readFunction
        ) {
          return emit({
            state:
              ROUTE_STATES
                .notIntegrated,

            routeId:
              route,

            data:
              null
          });
        }

        emit({
          state:
            ROUTE_STATES.loading,

          routeId:
            route,

          data:
            null
        });

        try {
          const result =
            await routeApi
              .callRouteAuthenticated(
                contract.readFunction,
                request.payload || {},
                {
                  idToken,
                  hostname:
                    transport.hostname,
                  fetchImpl:
                    transport.fetchImpl,
                  timeoutMs:
                    transport.timeoutMs
                }
              );

          if (
            myRequest !==
              requestGeneration ||
            mySession !==
              sessionGeneration
          ) {
            return freezeState({
              status: "stale",
              routeId:
                route
            });
          }

          if (
            isEmptyResult(
              result,
              contract
            )
          ) {
            return emit({
              state:
                ROUTE_STATES.empty,

              routeId:
                route,

              data:
                result
            });
          }

          return emit({
            state:
              ROUTE_STATES.ready,

            routeId:
              route,

            data:
              result
          });
        }
        catch (error) {
          if (
            myRequest !==
              requestGeneration ||
            mySession !==
              sessionGeneration
          ) {
            return freezeState({
              status: "stale",
              routeId:
                route
            });
          }

          return emit({
            state:
              ROUTE_STATES.error,

            routeId:
              route,

            errorCode:
              sanitizeErrorCode(
                error
              )
          });
        }
      }

      function getState() {
        return currentState;
      }

      return Object.freeze({
        setSession,
        clearSession,
        activate,
        getState
      });
    }

    return Object.freeze({
      ROUTE_STATES,
      sanitizeErrorCode,
      isEmptyResult,
      createRouteRuntime
    });
  }
);
