"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const routeApi =
  require(
    "../js/admin-shell-route-api-v1_2"
  );

const registryApi =
  require(
    "../js/admin-shell-route-registry-v1_2"
  );

const runtimeApi =
  require(
    "../js/admin-shell-route-runtime-v1_2"
  );

const rendererApi =
  require(
    "../js/admin-shell-operational-renderer-v1_2"
  );

const ROOT =
  path.resolve(
    __dirname,
    ".."
  );

const OPERATIONAL_ROUTES =
  Object.freeze([
    "people",
    "organizations",
    "courses",
    "exams",
    "questions",
    "certificates",
    "orders"
  ]);

const CONSOLE_ROUTES =
  Object.freeze([
    "finance",
    "splits",
    "webhooks",
    "audit",
    "security",
    "configuration",
    "health"
  ]);

function source(
  relativePath
) {
  return fs
    .readFileSync(
      path.join(
        ROOT,
        relativePath
      ),
      "utf8"
    )
    .replace(
      /\r\n/g,
      "\n"
    );
}

function sampleFilterValue(
  definition
) {
  if (
    definition.kind ===
      "select"
  ) {
    return (
      definition.options[0]
        ?.value ||
      "sample"
    );
  }

  return "sample";
}

function detailPayload(
  presentation,
  entityId
) {
  const data = {
    [presentation.entityIdField]:
      entityId
  };

  if (
    presentation.detailResultKey
  ) {
    return {
      [presentation.detailResultKey]:
        data
    };
  }

  return data;
}

async function main() {
  assert.deepStrictEqual(
    registryApi
      .integratedRoutes(),
    []
  );

  assert.deepStrictEqual(
    registryApi
      .OPERATIONAL_ROUTE_IDS,
    OPERATIONAL_ROUTES
  );

  const activeRegistry =
    registryApi
      .operationalIntegratedRegistry();

  assert.deepStrictEqual(
    activeRegistry
      .integratedRoutes(),
    OPERATIONAL_ROUTES
  );

  for (
    const routeId of
    OPERATIONAL_ROUTES
  ) {
    const base =
      registryApi
        .getRouteDefinition(
          routeId
        );

    const active =
      activeRegistry
        .getRouteDefinition(
          routeId
        );

    assert.ok(base);
    assert.ok(active);

    assert.strictEqual(
      base.integrated,
      false
    );

    assert.strictEqual(
      active.integrated,
      true
    );

    assert.strictEqual(
      active.surface,
      "operations"
    );

    assert.strictEqual(
      active.supportsPagination,
      true
    );

    assert.strictEqual(
      active.listKey,
      "items"
    );

    assert.strictEqual(
      active.actions.length,
      0
    );

    assert.ok(
      routeApi
        .OPERATIONAL_ROUTE_READ_FUNCTIONS
        .includes(
          active.readFunction
        )
    );

    assert.ok(
      routeApi
        .OPERATIONAL_ROUTE_READ_FUNCTIONS
        .includes(
          active.detailFunction
        )
    );

    const filters =
      rendererApi
        .getFilterDefinitions(
          routeId
        );

    assert.deepStrictEqual(
      filters.map(
        item =>
          item.name
      ),
      active.filters
    );

    const presentation =
      rendererApi
        .getPresentation(
          routeId
        );

    assert.ok(presentation);

    assert.strictEqual(
      presentation
        .entityIdField,
      active.detailIdField
    );
  }

  for (
    const routeId of
    CONSOLE_ROUTES
  ) {
    const active =
      activeRegistry
        .getRouteDefinition(
          routeId
        );

    assert.ok(active);

    assert.strictEqual(
      active.integrated,
      false
    );
  }

  assert.strictEqual(
    routeApi
      .OPERATIONAL_ROUTE_READ_FUNCTIONS
      .length,
    14
  );

  assert.strictEqual(
    new Set(
      routeApi
        .OPERATIONAL_ROUTE_READ_FUNCTIONS
    ).size,
    14
  );

  assert.ok(
    routeApi
      .OPERATIONAL_ROUTE_READ_FUNCTIONS
      .every(
        name =>
          name.startsWith(
            "listar"
          ) ||
          name.startsWith(
            "obter"
          )
      )
  );

  for (
    const forbiddenMutation of [
      "criarQuestaoOperacionalV12",
      "atualizarQuestaoOperacionalV12",
      "moderarQuestaoOperacionalV12",
      "arquivarQuestaoOperacionalV12",
      "importarQuestoesOperacionaisV12"
    ]
  ) {
    assert.strictEqual(
      routeApi
        .OPERATIONAL_ROUTE_READ_FUNCTIONS
        .includes(
          forbiddenMutation
        ),
      false
    );

    assert.throws(
      () =>
        routeApi
          .assertAllowedFunction(
            forbiddenMutation
          ),
      error =>
        error?.code ===
          "ADMIN_ROUTE_FUNCTION_NOT_ALLOWED"
    );
  }

  const totalFilters =
    OPERATIONAL_ROUTES
      .reduce(
        (
          total,
          routeId
        ) =>
          total +
          rendererApi
            .getFilterDefinitions(
              routeId
            )
            .length,
        0
      );

  assert.strictEqual(
    totalFilters,
    19
  );

  const context = {
    userId:
      "admin-1"
  };

  const calls = [];

  let currentRoute =
    null;

  const fakeRouteApi = {
    async callRouteAuthenticated(
      functionName,
      payload
    ) {
      calls.push({
        functionName,
        payload:
          {
            ...payload
          }
      });

      const contract =
        activeRegistry
          .getRouteDefinition(
            currentRoute
          );

      if (
        functionName ===
          contract.detailFunction
      ) {
        return {
          ok: true,
          detail:
            "loaded"
        };
      }

      const item = {
        [contract.detailIdField]:
          `${currentRoute}-1`
      };

      return {
        ok: true,
        items: [
          item
        ],
        nextCursor:
          Object.prototype
            .hasOwnProperty.call(
              payload,
              "cursor"
            )
              ? null
              : `opaque-${currentRoute}`
      };
    }
  };

  const navigationApi = {
    canNavigateTo(
      receivedContext,
      routeId
    ) {
      return (
        receivedContext ===
          context &&
        (
          OPERATIONAL_ROUTES
            .includes(
              routeId
            ) ||
          routeId ===
            "webhooks"
        )
      );
    }
  };

  const runtime =
    runtimeApi
      .createRouteRuntime({
        registry:
          activeRegistry,

        navigationApi,

        routeApi:
          fakeRouteApi
      });

  runtime.setSession({
    context,
    idToken:
      "mock-token",
    hostname:
      "localhost"
  });

  for (
    const routeId of
    OPERATIONAL_ROUTES
  ) {
    currentRoute =
      routeId;

    const contract =
      activeRegistry
        .getRouteDefinition(
          routeId
        );

    const presentation =
      rendererApi
        .getPresentation(
          routeId
        );

    const callsBeforeList =
      calls.length;

    const listResult =
      await runtime.activate(
        routeId
      );

    assert.strictEqual(
      listResult.state,
      "route-ready"
    );

    assert.strictEqual(
      listResult.mode,
      "list"
    );

    assert.strictEqual(
      calls.length,
      callsBeforeList + 1
    );

    assert.strictEqual(
      calls.at(-1)
        .functionName,
      contract.readFunction
    );

    const listView =
      rendererApi
        .buildListViewModel(
          routeId,
          listResult.data
        );

    assert.ok(listView);

    assert.strictEqual(
      listView.rows[0]
        .entityId,
      `${routeId}-1`
    );

    assert.strictEqual(
      Object.prototype
        .hasOwnProperty.call(
          listView,
          "nextCursor"
        ),
      false
    );

    const callsBeforeDetail =
      calls.length;

    const detailResult =
      await runtime
        .loadDetail(
          routeId,
          `${routeId}-1`
        );

    assert.strictEqual(
      detailResult.state,
      "route-ready"
    );

    assert.strictEqual(
      detailResult.mode,
      "detail"
    );

    assert.strictEqual(
      calls.length,
      callsBeforeDetail + 1
    );

    assert.strictEqual(
      calls.at(-1)
        .functionName,
      contract.detailFunction
    );

    assert.deepStrictEqual(
      calls.at(-1)
        .payload,
      {
        [contract.detailIdField]:
          `${routeId}-1`
      }
    );

    const detailView =
      rendererApi
        .buildDetailViewModel(
          routeId,
          detailPayload(
            presentation,
            `${routeId}-1`
          )
        );

    assert.ok(detailView);

    assert.strictEqual(
      detailView.entityId,
      `${routeId}-1`
    );

    const callsBeforeRestore =
      calls.length;

    const restored =
      runtime.restoreList(
        routeId
      );

    assert.strictEqual(
      restored.state,
      "route-ready"
    );

    assert.strictEqual(
      restored.mode,
      "list"
    );

    assert.strictEqual(
      calls.length,
      callsBeforeRestore
    );

    const filterDefinition =
      rendererApi
        .getFilterDefinitions(
          routeId
        )[0];

    const filterValue =
      sampleFilterValue(
        filterDefinition
      );

    const filtered =
      await runtime
        .applyFilters(
          routeId,
          {
            [filterDefinition.name]:
              filterValue
          }
        );

    assert.strictEqual(
      filtered.state,
      "route-ready"
    );

    assert.deepStrictEqual(
      calls.at(-1)
        .payload,
      {
        [filterDefinition.name]:
          filterValue
      }
    );

    const next =
      await runtime
        .loadNextPage(
          routeId
        );

    assert.strictEqual(
      next.state,
      "route-ready"
    );

    assert.strictEqual(
      calls.at(-1)
        .functionName,
      contract.readFunction
    );

    assert.strictEqual(
      calls.at(-1)
        .payload
        .cursor,
      `opaque-${routeId}`
    );

    assert.strictEqual(
      calls.at(-1)
        .payload[
          filterDefinition.name
        ],
      filterValue
    );
  }

  const callsBeforeConsole =
    calls.length;

  currentRoute =
    "webhooks";

  const consoleResult =
    await runtime
      .activate(
        "webhooks"
      );

  assert.strictEqual(
    consoleResult.state,
    "route-not-integrated"
  );

  assert.strictEqual(
    calls.length,
    callsBeforeConsole
  );

  const deniedCalls = [];

  const deniedRuntime =
    runtimeApi
      .createRouteRuntime({
        registry:
          activeRegistry,

        navigationApi: {
          canNavigateTo() {
            return false;
          }
        },

        routeApi: {
          async callRouteAuthenticated(
            ...args
          ) {
            deniedCalls.push(
              args
            );

            return {};
          }
        }
      });

  deniedRuntime
    .setSession({
      context,
      idToken:
        "mock-token",
      hostname:
        "localhost"
    });

  const denied =
    await deniedRuntime
      .activate(
        "people"
      );

  assert.strictEqual(
    denied.state,
    "route-error"
  );

  assert.strictEqual(
    denied.errorCode,
    "ROUTE_ACCESS_DENIED"
  );

  assert.strictEqual(
    deniedCalls.length,
    0
  );

  runtime.clearSession();

  for (
    const routeId of
    OPERATIONAL_ROUTES
  ) {
    assert.strictEqual(
      runtime
        .getListState(
          routeId
        ),
      null
    );
  }

  const html =
    source(
      "admin_shell_v1_2.html"
    );

  const controllerSource =
    source(
      "js/admin-shell-controller-v1_2.js"
    );

  const rendererSource =
    source(
      "js/admin-shell-operational-renderer-v1_2.js"
    );

  const runtimeSource =
    source(
      "js/admin-shell-route-runtime-v1_2.js"
    );

  const registrySource =
    source(
      "js/admin-shell-route-registry-v1_2.js"
    );

  const routeApiSource =
    source(
      "js/admin-shell-route-api-v1_2.js"
    );

  assert.strictEqual(
    controllerSource.includes(
      ".innerHTML"
    ),
    false
  );

  assert.strictEqual(
    rendererSource.includes(
      ".innerHTML"
    ),
    false
  );

  assert.strictEqual(
    rendererSource.includes(
      "JSON.stringify"
    ),
    false
  );

  for (
    const forbidden of [
      "firebase-firestore",
      "getFirestore(",
      "getDocs(",
      "setDoc(",
      "addDoc(",
      "updateDoc(",
      "deleteDoc(",
      "onSnapshot("
    ]
  ) {
    for (
      const clientSource of [
        html,
        controllerSource,
        rendererSource,
        runtimeSource,
        registrySource,
        routeApiSource
      ]
    ) {
      assert.strictEqual(
        clientSource.includes(
          forbidden
        ),
        false
      );
    }
  }

  assert.ok(
    html.includes(
      "data-admin-operational-content"
    )
  );

  assert.ok(
    html.includes(
      ".operational-table-region"
    )
  );

  assert.ok(
    html.includes(
      ".operational-filter-grid"
    )
  );

  assert.ok(
    html.includes(
      "aria-live=\"polite\""
    )
  );

  assert.ok(
    rendererSource.includes(
      "\"Carregar mais\""
    )
  );

  assert.ok(
    rendererSource.includes(
      "\"Voltar para lista\""
    )
  );

  assert.ok(
    rendererSource.includes(
      "\"Aplicar filtros\""
    )
  );

  assert.ok(
    rendererSource.includes(
      "\"Limpar filtros\""
    )
  );

  console.log(
    "MARCO8_7C5_OPERATIONAL_ROUTES=7/7"
  );

  console.log(
    "MARCO8_7C5_OPERATIONAL_READ_FUNCTIONS=14/14"
  );

  console.log(
    "MARCO8_7C5_FILTER_DEFINITIONS=19/19"
  );

  console.log(
    "MARCO8_7C5_LIST_INTEGRATION=7/7"
  );

  console.log(
    "MARCO8_7C5_DETAIL_INTEGRATION=7/7"
  );

  console.log(
    "MARCO8_7C5_PAGINATION_INTEGRATION=7/7"
  );

  console.log(
    "MARCO8_7C5_FILTER_INTEGRATION=7/7"
  );

  console.log(
    "MARCO8_7C5_LIST_RESTORE_NO_CALL=7/7"
  );

  console.log(
    "MARCO8_7C5_CONSOLE_ROUTES_INTEGRATED=0/7"
  );

  console.log(
    "MARCO8_7C5_UNAUTHORIZED_LOADER=BLOCKED"
  );

  console.log(
    "MARCO8_7C5_MUTATIONS=BLOCKED"
  );

  console.log(
    "MARCO8_7C5_OPAQUE_CURSOR=PASSED"
  );

  console.log(
    "MARCO8_7C5_SAFE_DOM=PASSED"
  );

  console.log(
    "MARCO8_7C5_BASIC_ACCESSIBILITY=PASSED"
  );

  console.log(
    "MARCO8_7C5_DIRECT_FIRESTORE=FORBIDDEN"
  );

  console.log(
    "MARCO8_7C5_OPERATIONAL_PANEL_INTEGRATION=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
