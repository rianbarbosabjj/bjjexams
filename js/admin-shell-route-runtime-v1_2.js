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

    const LIST_CONTROL_FIELDS =
      Object.freeze([
        "limit",
        "cursor"
      ]);

    class AdminShellRouteRuntimeError
      extends Error {
      constructor(
        code,
        message
      ) {
        super(message);

        this.name =
          "AdminShellRouteRuntimeError";

        this.code =
          code;
      }
    }

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

    function routeRuntimeError(
      code,
      message
    ) {
      return new AdminShellRouteRuntimeError(
        code,
        message
      );
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

    function listAllowedFields(
      contract
    ) {
      return Object.freeze([
        ...LIST_CONTROL_FIELDS,
        ...(
          Array.isArray(
            contract?.filters
          )
            ? contract.filters
            : []
        )
      ]);
    }

    function normalizePayloadObject(
      value
    ) {
      if (
        value === undefined ||
        value === null
      ) {
        return {};
      }

      if (
        typeof value !==
          "object" ||
        Array.isArray(value)
      ) {
        throw routeRuntimeError(
          "ROUTE_PAYLOAD_INVALID",
          "Route payload must be an object."
        );
      }

      return value;
    }

    function sanitizeListPayload(
      contract,
      value
    ) {
      const input =
        normalizePayloadObject(
          value
        );

      const allowed =
        new Set(
          listAllowedFields(
            contract
          )
        );

      const unsupported =
        Object.keys(input)
          .filter(
            field =>
              !allowed.has(
                field
              )
          )
          .sort();

      if (
        unsupported.length >
        0
      ) {
        throw routeRuntimeError(
          "ROUTE_FILTER_NOT_ALLOWED",
          "Route payload contains unsupported fields."
        );
      }

      const output = {};

      for (
        const field of
        allowed
      ) {
        if (
          !Object.prototype
            .hasOwnProperty.call(
              input,
              field
            )
        ) {
          continue;
        }

        const candidate =
          input[field];

        if (
          candidate === undefined ||
          candidate === null ||
          candidate === ""
        ) {
          continue;
        }

        output[field] =
          candidate;
      }

      return Object.freeze(
        output
      );
    }

    function sanitizeFilterPayload(
      contract,
      value
    ) {
      const input =
        normalizePayloadObject(
          value
        );

      const allowed =
        new Set(
          Array.isArray(
            contract?.filters
          )
            ? contract.filters
            : []
        );

      const unsupported =
        Object.keys(input)
          .filter(
            field =>
              !allowed.has(
                field
              )
          )
          .sort();

      if (
        unsupported.length >
        0
      ) {
        throw routeRuntimeError(
          "ROUTE_FILTER_NOT_ALLOWED",
          "Filter is outside the route allow-list."
        );
      }

      const output = {};

      for (
        const field of
        allowed
      ) {
        if (
          !Object.prototype
            .hasOwnProperty.call(
              input,
              field
            )
        ) {
          continue;
        }

        const candidate =
          input[field];

        if (
          candidate === undefined ||
          candidate === null ||
          candidate === ""
        ) {
          continue;
        }

        output[field] =
          candidate;
      }

      return Object.freeze(
        output
      );
    }

    function withoutCursor(
      payload
    ) {
      const output = {
        ...payload
      };

      delete output.cursor;

      return Object.freeze(
        output
      );
    }

    function sanitizeActionPayload(
      action,
      value
    ) {
      const input =
        normalizePayloadObject(
          value
        );

      const allowed =
        new Set(
          Array.isArray(
            action?.payloadFields
          )
            ? action.payloadFields
            : []
        );

      const required =
        new Set(
          Array.isArray(
            action?.requiredFields
          )
            ? action.requiredFields
            : []
        );

      const identifiers =
        new Set(
          Array.isArray(
            action?.identifierFields
          )
            ? action.identifierFields
            : []
        );

      const unsupported =
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
        unsupported.length >
          0
      ) {
        throw routeRuntimeError(
          "ROUTE_ACTION_PAYLOAD_NOT_ALLOWED",
          "Action payload contains unsupported fields."
        );
      }

      const output = {};

      for (
        const field of
        allowed
      ) {
        const candidate =
          Object.prototype
            .hasOwnProperty.call(
              input,
              field
            )
              ? input[field]
              : undefined;

        if (
          candidate ===
            undefined ||
          candidate ===
            null ||
          candidate ===
            ""
        ) {
          if (
            required.has(
              field
            )
          ) {
            throw routeRuntimeError(
              "ROUTE_ACTION_PAYLOAD_REQUIRED",
              "Action payload is missing a required field."
            );
          }

          continue;
        }

        if (
          identifiers.has(
            field
          )
        ) {
          const normalized =
            String(
              candidate
            ).trim();

          if (
            !normalized ||
            normalized.length >
              255 ||
            normalized.includes(
              "/"
            )
          ) {
            throw routeRuntimeError(
              "ROUTE_ACTION_IDENTIFIER_INVALID",
              "Action identifier is invalid."
            );
          }

          output[field] =
            normalized;

          continue;
        }

        output[field] =
          candidate;
      }

      return Object.freeze(
        output
      );
    }

    function opaqueCursor(
      value
    ) {
      if (
        value === undefined ||
        value === null ||
        value === ""
      ) {
        return null;
      }

      if (
        typeof value !==
        "string"
      ) {
        throw routeRuntimeError(
          "ROUTE_CURSOR_INVALID",
          "Route cursor must be opaque text."
        );
      }

      return value;
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

    function mergeListResults(
      previous,
      next,
      contract
    ) {
      const listKey =
        contract?.listKey;

      if (!listKey) {
        return {
          ...next
        };
      }

      const previousItems =
        Array.isArray(
          previous?.[listKey]
        )
          ? previous[listKey]
          : [];

      const nextItems =
        Array.isArray(
          next?.[listKey]
        )
          ? next[listKey]
          : [];

      return {
        ...next,
        [listKey]: [
          ...previousItems,
          ...nextItems
        ]
      };
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

      const listCache =
        new Map();

      const paginationInFlight =
        new Set();

      const actionInFlight =
        new Set();

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

        listCache.clear();
        paginationInFlight.clear();
        actionInFlight.clear();

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

        listCache.clear();
        paginationInFlight.clear();
        actionInFlight.clear();

        return true;
      }

      function accessState(
        route
      ) {
        if (
          !context ||
          !idToken
        ) {
          return {
            errorCode:
              "ROUTE_SESSION_REQUIRED"
          };
        }

        if (
          !navigationApi
            .canNavigateTo(
              context,
              route
            )
        ) {
          return {
            errorCode:
              "ROUTE_ACCESS_DENIED"
          };
        }

        const contract =
          registry
            .getRouteDefinition(
              route
            );

        if (!contract) {
          return {
            errorCode:
              "ROUTE_UNKNOWN"
          };
        }

        if (
          contract.integrated !==
            true ||
          !contract.readFunction
        ) {
          return {
            notIntegrated: true,
            contract
          };
        }

        return {
          contract
        };
      }

      function emitAccessFailure(
        route,
        access
      ) {
        if (
          access?.notIntegrated
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

        return emit({
          state:
            ROUTE_STATES.error,

          routeId:
            route || null,

          errorCode:
            access?.errorCode ||
            "ROUTE_UNKNOWN"
        });
      }

      async function readList(
        route,
        contract,
        payload,
        options = {}
      ) {
        const append =
          options.append ===
          true;

        const myRequest =
          ++requestGeneration;

        const mySession =
          sessionGeneration;

        emit({
          state:
            ROUTE_STATES.loading,

          routeId:
            route,

          mode:
            "list",

          append,

          data:
            append
              ? (
                  listCache
                    .get(route)
                    ?.data ||
                  null
                )
              : null
        });

        try {
          const result =
            await routeApi
              .callRouteAuthenticated(
                contract.readFunction,
                payload,
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

          const previous =
            listCache
              .get(route);

          const data =
            append
              ? mergeListResults(
                  previous?.data,
                  result,
                  contract
                )
              : result;

          const basePayload =
            withoutCursor(
              payload
            );

          listCache.set(
            route,
            Object.freeze({
              routeId:
                route,

              basePayload,

              data
            })
          );

          if (
            isEmptyResult(
              data,
              contract
            )
          ) {
            return emit({
              state:
                ROUTE_STATES.empty,

              routeId:
                route,

              mode:
                "list",

              data
            });
          }

          return emit({
            state:
              ROUTE_STATES.ready,

            routeId:
              route,

            mode:
              "list",

            data
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

            mode:
              "list",

            errorCode:
              sanitizeErrorCode(
                error
              )
          });
        }
      }

      async function activate(
        routeId,
        request = {}
      ) {
        const route =
          normalizeRoute(
            routeId
          );

        const access =
          accessState(
            route
          );

        if (
          access.errorCode ||
          access.notIntegrated
        ) {
          return emitAccessFailure(
            route,
            access
          );
        }

        let payload;

        try {
          payload =
            sanitizeListPayload(
              access.contract,
              request.payload || {}
            );

          if (
            Object.prototype
              .hasOwnProperty.call(
                payload,
                "cursor"
              )
          ) {
            opaqueCursor(
              payload.cursor
            );
          }
        }
        catch (error) {
          return emit({
            state:
              ROUTE_STATES.error,

            routeId:
              route,

            mode:
              "list",

            errorCode:
              sanitizeErrorCode(
                error
              )
          });
        }

        return readList(
          route,
          access.contract,
          payload,
          {
            append: false
          }
        );
      }

      async function applyFilters(
        routeId,
        filters = {}
      ) {
        const route =
          normalizeRoute(
            routeId
          );

        const access =
          accessState(
            route
          );

        if (
          access.errorCode ||
          access.notIntegrated
        ) {
          return emitAccessFailure(
            route,
            access
          );
        }

        let filterPayload;

        try {
          filterPayload =
            sanitizeFilterPayload(
              access.contract,
              filters
            );
        }
        catch (error) {
          return emit({
            state:
              ROUTE_STATES.error,

            routeId:
              route,

            mode:
              "list",

            errorCode:
              sanitizeErrorCode(
                error
              )
          });
        }

        const previous =
          listCache.get(
            route
          );

        const payload = {
          ...filterPayload
        };

        if (
          previous?.basePayload &&
          Object.prototype
            .hasOwnProperty.call(
              previous.basePayload,
              "limit"
            )
        ) {
          payload.limit =
            previous
              .basePayload
              .limit;
        }

        return readList(
          route,
          access.contract,
          Object.freeze(
            payload
          ),
          {
            append: false
          }
        );
      }

      async function loadNextPage(
        routeId
      ) {
        const route =
          normalizeRoute(
            routeId
          );

        const access =
          accessState(
            route
          );

        if (
          access.errorCode ||
          access.notIntegrated
        ) {
          return emitAccessFailure(
            route,
            access
          );
        }

        const cached =
          listCache.get(
            route
          );

        if (!cached) {
          return emit({
            state:
              ROUTE_STATES.error,

            routeId:
              route,

            mode:
              "list",

            errorCode:
              "ROUTE_LIST_STATE_REQUIRED"
          });
        }

        let cursor;

        try {
          cursor =
            opaqueCursor(
              cached
                .data
                ?.nextCursor
            );
        }
        catch (error) {
          return emit({
            state:
              ROUTE_STATES.error,

            routeId:
              route,

            mode:
              "list",

            errorCode:
              sanitizeErrorCode(
                error
              )
          });
        }

        if (!cursor) {
          return freezeState({
            status: "end",
            routeId:
              route
          });
        }

        if (
          paginationInFlight.has(
            route
          )
        ) {
          return freezeState({
            status:
              "pagination-busy",

            routeId:
              route
          });
        }

        paginationInFlight.add(
          route
        );

        try {
          const payload =
            Object.freeze({
              ...cached.basePayload,
              cursor
            });

          return await readList(
            route,
            access.contract,
            payload,
            {
              append: true
            }
          );
        }
        finally {
          paginationInFlight.delete(
            route
          );
        }
      }

      async function loadDetail(
        routeId,
        entityId
      ) {
        const route =
          normalizeRoute(
            routeId
          );

        const access =
          accessState(
            route
          );

        if (
          access.errorCode ||
          access.notIntegrated
        ) {
          return emitAccessFailure(
            route,
            access
          );
        }

        const contract =
          access.contract;

        if (
          !contract.detailFunction ||
          !contract.detailIdField
        ) {
          return emit({
            state:
              ROUTE_STATES.error,

            routeId:
              route,

            mode:
              "detail",

            errorCode:
              "ROUTE_DETAIL_NOT_AVAILABLE"
          });
        }

        const normalizedId =
          String(
            entityId || ""
          ).trim();

        if (
          !normalizedId ||
          normalizedId.includes("/")
        ) {
          return emit({
            state:
              ROUTE_STATES.error,

            routeId:
              route,

            mode:
              "detail",

            errorCode:
              "ROUTE_DETAIL_IDENTIFIER_INVALID"
          });
        }

        const myRequest =
          ++requestGeneration;

        const mySession =
          sessionGeneration;

        emit({
          state:
            ROUTE_STATES.loading,

          routeId:
            route,

          mode:
            "detail",

          data:
            null
        });

        try {
          const result =
            await routeApi
              .callRouteAuthenticated(
                contract.detailFunction,
                {
                  [contract.detailIdField]:
                    normalizedId
                },
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

          return emit({
            state:
              ROUTE_STATES.ready,

            routeId:
              route,

            mode:
              "detail",

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

            mode:
              "detail",

            errorCode:
              sanitizeErrorCode(
                error
              )
          });
        }
      }

      function restoreList(
        routeId
      ) {
        const route =
          normalizeRoute(
            routeId
          );

        const access =
          accessState(
            route
          );

        if (
          access.errorCode ||
          access.notIntegrated
        ) {
          return emitAccessFailure(
            route,
            access
          );
        }

        const cached =
          listCache.get(
            route
          );

        if (!cached) {
          return emit({
            state:
              ROUTE_STATES.error,

            routeId:
              route,

            mode:
              "list",

            errorCode:
              "ROUTE_LIST_STATE_REQUIRED"
          });
        }

        requestGeneration += 1;

        if (
          isEmptyResult(
            cached.data,
            access.contract
          )
        ) {
          return emit({
            state:
              ROUTE_STATES.empty,

            routeId:
              route,

            mode:
              "list",

            data:
              cached.data
          });
        }

        return emit({
          state:
            ROUTE_STATES.ready,

          routeId:
            route,

          mode:
            "list",

          data:
            cached.data
        });
      }

      function findAction(
        routeId,
        actionId
      ) {
        const route =
          normalizeRoute(
            routeId
          );

        const normalizedActionId =
          String(
            actionId || ""
          ).trim();

        if (
          !route ||
          !normalizedActionId
        ) {
          return null;
        }

        const access =
          accessState(
            route
          );

        if (
          access.errorCode ||
          access.notIntegrated
        ) {
          return null;
        }

        const actions =
          Array.isArray(
            access.contract
              ?.actions
          )
            ? access.contract.actions
            : [];

        const action =
          actions.find(
            candidate =>
              candidate &&
              typeof candidate ===
                "object" &&
              candidate.actionId ===
                normalizedActionId
          ) ||
          null;

        if (!action) {
          return null;
        }

        return {
          route,
          contract:
            access.contract,
          action
        };
      }

      function hasCapability(
        capability
      ) {
        return Boolean(
          capability &&
          context &&
          Array.isArray(
            context.capabilities
          ) &&
          context.capabilities
            .includes(
              capability
            )
        );
      }

      function canExecuteAction(
        routeId,
        actionId
      ) {
        const resolved =
          findAction(
            routeId,
            actionId
          );

        return Boolean(
          resolved &&
          resolved.action
            .functionName &&
          hasCapability(
            resolved.action
              .capability
          ) &&
          routeApi &&
          typeof routeApi
            .callActionAuthenticated ===
            "function"
        );
      }

      async function executeAction(
        routeId,
        actionId,
        payload = {},
        options = {}
      ) {
        const resolved =
          findAction(
            routeId,
            actionId
          );

        if (!resolved) {
          return freezeState({
            status:
              "action-not-available",

            routeId:
              normalizeRoute(
                routeId
              ),

            actionId:
              String(
                actionId || ""
              ).trim()
          });
        }

        const {
          route,
          contract,
          action
        } =
          resolved;

        if (
          !hasCapability(
            action.capability
          ) ||
          !routeApi ||
          typeof routeApi
            .callActionAuthenticated !==
            "function"
        ) {
          return freezeState({
            status:
              "action-denied",

            routeId:
              route,

            actionId:
              action.actionId,

            errorCode:
              "ROUTE_ACTION_ACCESS_DENIED"
          });
        }

        if (
          action
            .confirmationRequired ===
            true &&
          options.confirmed !==
            true
        ) {
          return freezeState({
            status:
              "action-confirmation-required",

            routeId:
              route,

            actionId:
              action.actionId
          });
        }

        let safePayload;

        try {
          safePayload =
            sanitizeActionPayload(
              action,
              payload
            );
        }
        catch (error) {
          return freezeState({
            status:
              "action-invalid",

            routeId:
              route,

            actionId:
              action.actionId,

            errorCode:
              sanitizeErrorCode(
                error
              )
          });
        }

        const lockIdentifier =
          String(
            safePayload[
              action.refreshIdField ||
              contract.detailIdField ||
              ""
            ] ||
            ""
          );

        const lockKey =
          `${route}:${action.actionId}:${lockIdentifier}`;

        if (
          actionInFlight.has(
            lockKey
          )
        ) {
          return freezeState({
            status:
              "action-busy",

            routeId:
              route,

            actionId:
              action.actionId
          });
        }

        actionInFlight.add(
          lockKey
        );

        const myRequest =
          ++requestGeneration;

        const mySession =
          sessionGeneration;

        emit({
          state:
            ROUTE_STATES.loading,

          routeId:
            route,

          mode:
            "action",

          operation:
            action.actionId,

          data:
            null
        });

        try {
          const result =
            await routeApi
              .callActionAuthenticated(
                action.functionName,
                safePayload,
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
              status:
                "stale",

              routeId:
                route,

              actionId:
                action.actionId
            });
          }

          if (
            !result ||
            result.ok !==
              true
          ) {
            return emit({
              state:
                ROUTE_STATES.error,

              routeId:
                route,

              mode:
                "action",

              errorCode:
                "ROUTE_ACTION_SUCCESS_UNCONFIRMED"
            });
          }

          let refreshState =
            null;

          if (
            action.refreshMode ===
              "detail"
          ) {
            const refreshField =
              action.refreshIdField ||
              contract.detailIdField;

            const refreshId =
              refreshField
                ? safePayload[
                    refreshField
                  ]
                : null;

            if (!refreshId) {
              return emit({
                state:
                  ROUTE_STATES.error,

                routeId:
                  route,

                mode:
                  "action",

                errorCode:
                  "ROUTE_ACTION_REFRESH_IDENTIFIER_REQUIRED"
              });
            }

            refreshState =
              await loadDetail(
                route,
                refreshId
              );
          }

          return freezeState({
            status:
              "action-succeeded",

            routeId:
              route,

            actionId:
              action.actionId,

            result,
            refreshState
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
              status:
                "stale",

              routeId:
                route,

              actionId:
                action.actionId
            });
          }

          return emit({
            state:
              ROUTE_STATES.error,

            routeId:
              route,

            mode:
              "action",

            errorCode:
              sanitizeErrorCode(
                error
              )
          });
        }
        finally {
          actionInFlight.delete(
            lockKey
          );
        }
      }

      function getState() {
        return currentState;
      }

      function getListState(
        routeId
      ) {
        const route =
          normalizeRoute(
            routeId
          );

        return (
          listCache.get(
            route
          ) ||
          null
        );
      }

      return Object.freeze({
        setSession,
        clearSession,
        activate,
        applyFilters,
        loadNextPage,
        loadDetail,
        restoreList,
        canExecuteAction,
        executeAction,
        getState,
        getListState
      });
    }

    return Object.freeze({
      ROUTE_STATES,
      LIST_CONTROL_FIELDS,
      AdminShellRouteRuntimeError,
      sanitizeErrorCode,
      listAllowedFields,
      sanitizeListPayload,
      sanitizeFilterPayload,
      sanitizeActionPayload,
      opaqueCursor,
      isEmptyResult,
      mergeListResults,
      createRouteRuntime
    });
  }
);
