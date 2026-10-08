"use strict";

const assert =
  require("assert");

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

const FINANCE_SPLITS_ROUTES =
  Object.freeze([
    "finance",
    "splits"
  ]);

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

const OTHER_CONSOLE_ROUTES =
  Object.freeze([
    "webhooks",
    "audit",
    "security",
    "configuration",
    "health"
  ]);

async function main() {
  assert.deepStrictEqual(
    routeApi
      .FINANCE_SPLITS_ROUTE_READ_FUNCTIONS,
    [
      "obterFinanceiroConsoleV12",
      "obterSplitsConsoleV12"
    ]
  );

  for (
    const functionName of
    routeApi
      .FINANCE_SPLITS_ROUTE_READ_FUNCTIONS
  ) {
    assert.strictEqual(
      routeApi
        .assertAllowedFunction(
          functionName
        ),
      functionName
    );
  }

  for (
    const forbiddenMutation of [
      "configurarRegraFinanceiraPadraoV12",
      "definirRegraFinanceiraCursoV12",
      "registrarContaRecebedorV12",
      "configurarWalletRecebedorV12"
    ]
  ) {
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

  assert.deepStrictEqual(
    registryApi
      .FINANCE_SPLITS_ROUTE_IDS,
    FINANCE_SPLITS_ROUTES
  );

  const financeBase =
    registryApi
      .getRouteDefinition(
        "finance"
      );

  const splitsBase =
    registryApi
      .getRouteDefinition(
        "splits"
      );

  assert.strictEqual(
    financeBase.integrated,
    false
  );

  assert.strictEqual(
    financeBase.readFunction,
    "obterFinanceiroConsoleV12"
  );

  assert.deepStrictEqual(
    financeBase.filters,
    []
  );

  assert.deepStrictEqual(
    financeBase.actions,
    []
  );

  assert.strictEqual(
    splitsBase.integrated,
    false
  );

  assert.strictEqual(
    splitsBase.readFunction,
    "obterSplitsConsoleV12"
  );

  assert.deepStrictEqual(
    splitsBase.filters,
    [
      "courseId"
    ]
  );

  assert.deepStrictEqual(
    splitsBase.actions,
    []
  );

  assert.deepStrictEqual(
    registryApi
      .integratedRoutes(),
    []
  );

  assert.deepStrictEqual(
    registryApi
      .operationalIntegratedRegistry()
      .integratedRoutes(),
    OPERATIONAL_ROUTES
  );

  const integrated =
    registryApi
      .financeSplitsIntegratedRegistry();

  assert.deepStrictEqual(
    integrated
      .integratedRoutes(),
    [
      ...OPERATIONAL_ROUTES,
      ...FINANCE_SPLITS_ROUTES
    ]
  );

  for (
    const routeId of
    OPERATIONAL_ROUTES
  ) {
    assert.strictEqual(
      integrated
        .getRouteDefinition(
          routeId
        )
        .integrated,
      true
    );
  }

  for (
    const routeId of
    FINANCE_SPLITS_ROUTES
  ) {
    const contract =
      integrated
        .getRouteDefinition(
          routeId
        );

    assert.strictEqual(
      contract.integrated,
      true
    );

    assert.strictEqual(
      contract.surface,
      "console"
    );

    assert.deepStrictEqual(
      contract.actions,
      []
    );
  }

  for (
    const routeId of
    OTHER_CONSOLE_ROUTES
  ) {
    assert.strictEqual(
      integrated
        .getRouteDefinition(
          routeId
        )
        .integrated,
      false
    );
  }

  const context = {
    capabilities: [
      "console.finance.read",
      "console.splits.read"
    ]
  };

  const calls = [];

  const runtime =
    runtimeApi
      .createRouteRuntime({
        registry:
          integrated,

        navigationApi: {
          canNavigateTo(
            receivedContext,
            routeId
          ) {
            assert.strictEqual(
              receivedContext,
              context
            );

            return (
              routeId ===
                "finance" ||
              routeId ===
                "splits"
            );
          }
        },

        routeApi: {
          async callRouteAuthenticated(
            functionName,
            payload,
            options
          ) {
            calls.push({
              functionName,
              payload,
              options
            });

            if (
              functionName ===
                "obterFinanceiroConsoleV12"
            ) {
              return {
                ok:
                  true,

                finance: {
                  persisted:
                    true,

                  active:
                    true
                }
              };
            }

            return {
              ok:
                true,

              split: {
                lookupRequired:
                  !payload.courseId,

                courseId:
                  payload.courseId ||
                  null
              }
            };
          }
        }
      });

  runtime.setSession({
    context,
    idToken:
      "mock-token",
    hostname:
      "localhost"
  });

  const finance =
    await runtime
      .activate(
        "finance"
      );

  assert.strictEqual(
    finance.state,
    "route-ready"
  );

  assert.strictEqual(
    finance.mode,
    "list"
  );

  assert.deepStrictEqual(
    calls[0].payload,
    {}
  );

  assert.strictEqual(
    calls[0].functionName,
    "obterFinanceiroConsoleV12"
  );

  assert.strictEqual(
    calls[0]
      .options
      .idToken,
    "mock-token"
  );

  const splitsEmpty =
    await runtime
      .activate(
        "splits"
      );

  assert.strictEqual(
    splitsEmpty.state,
    "route-ready"
  );

  assert.strictEqual(
    splitsEmpty.data
      .split
      .lookupRequired,
    true
  );

  const splitsCourse =
    await runtime
      .activate(
        "splits",
        {
          payload: {
            courseId:
              "course-1"
          }
        }
      );

  assert.strictEqual(
    splitsCourse.state,
    "route-ready"
  );

  assert.deepStrictEqual(
    calls.at(-1).payload,
    {
      courseId:
        "course-1"
    }
  );

  assert.strictEqual(
    calls.at(-1)
      .functionName,
    "obterSplitsConsoleV12"
  );

  const callsBeforeForbidden =
    calls.length;

  const forbiddenFilter =
    await runtime
      .activate(
        "splits",
        {
          payload: {
            walletId:
              "must-not-pass"
          }
        }
      );

  assert.strictEqual(
    forbiddenFilter.state,
    "route-error"
  );

  assert.strictEqual(
    forbiddenFilter.errorCode,
    "ROUTE_FILTER_NOT_ALLOWED"
  );

  assert.strictEqual(
    calls.length,
    callsBeforeForbidden
  );

  const callsBeforeOtherConsole =
    calls.length;

  const webhooks =
    await runtime
      .activate(
        "webhooks"
      );

  assert.strictEqual(
    webhooks.state,
    "route-error"
  );

  assert.strictEqual(
    webhooks.errorCode,
    "ROUTE_ACCESS_DENIED"
  );

  assert.strictEqual(
    calls.length,
    callsBeforeOtherConsole
  );

  console.log(
    "MARCO8_7D2_FINANCE_SPLITS_READ_ALLOWLIST=2/2"
  );

  console.log(
    "MARCO8_7D2_FINANCE_SPLITS_ROUTES=2/2"
  );

  console.log(
    "MARCO8_7D2_BASE_REGISTRY_INTEGRATED=0/14"
  );

  console.log(
    "MARCO8_7D2_OPERATIONAL_OVERLAY=7/7"
  );

  console.log(
    "MARCO8_7D2_FINANCE_SPLITS_OVERLAY=9/14"
  );

  console.log(
    "MARCO8_7D2_ACTIVE_CONSOLE_ROUTES=2/7"
  );

  console.log(
    "MARCO8_7D2_OTHER_CONSOLE_ROUTES=0/5"
  );

  console.log(
    "MARCO8_7D2_FINANCE_RUNTIME_READ=PASSED"
  );

  console.log(
    "MARCO8_7D2_SPLITS_EMPTY_LOOKUP=PASSED"
  );

  console.log(
    "MARCO8_7D2_SPLITS_COURSE_FILTER=PASSED"
  );

  console.log(
    "MARCO8_7D2_UNSUPPORTED_FILTER=BLOCKED"
  );

  console.log(
    "MARCO8_7D2_FINANCIAL_MUTATIONS=BLOCKED"
  );

  console.log(
    "MARCO8_7D2_ROUTE_RUNTIME_CHANGES=False"
  );

  console.log(
    "MARCO8_7D2_FINANCE_SPLITS_FRONTEND_CONTRACTS=PASSED"
  );
}

main().catch(
  error => {
    console.error(
      error
    );

    process.exitCode =
      1;
  }
);
