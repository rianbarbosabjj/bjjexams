"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const Module =
  require("module");

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
    "../js/admin-shell-finance-splits-renderer-v1_2"
  );

const financeService =
  require(
    "../functions/src/admin/admin-finance-console-read-service"
  );

const ROOT =
  path.resolve(
    __dirname,
    ".."
  );

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

class TestHttpsError
  extends Error {
  constructor(
    code,
    message,
    details = null
  ) {
    super(message);

    this.name =
      "HttpsError";

    this.code =
      code;

    this.details =
      details;
  }
}

function loadFinanceFunctions() {
  const originalLoad =
    Module._load;

  Module._load =
    function patchedLoad(
      request,
      parent,
      isMain
    ) {
      if (
        request ===
          "firebase-functions/v2/https"
      ) {
        return {
          onCall(
            _options,
            handler
          ) {
            return handler;
          },

          HttpsError:
            TestHttpsError
        };
      }

      return originalLoad.call(
        this,
        request,
        parent,
        isMain
      );
    };

  try {
    return require(
      "../functions/src/admin/admin-finance-console-read-functions"
    );
  }
  finally {
    Module._load =
      originalLoad;
  }
}

async function expectCode(
  operation,
  code
) {
  let received =
    null;

  try {
    await operation();
  }
  catch (error) {
    received =
      error;
  }

  assert.ok(
    received,
    `Expected error ${code}`
  );

  assert.strictEqual(
    received.code,
    code
  );
}

async function main() {
  const financeFunctions =
    loadFinanceFunctions();

  assert.strictEqual(
    financeService
      .FINANCIAL_RULES_COLLECTION,
    "financial_rules"
  );

  assert.strictEqual(
    financeService
      .COURSES_COLLECTION,
    "courses"
  );

  assert.strictEqual(
    financeService
      .RECIPIENT_ACCOUNTS_COLLECTION,
    "financial_recipient_accounts"
  );

  const serviceSource =
    source(
      "functions/src/admin/admin-finance-console-read-service.js"
    );

  for (
    const marker of [
      "financialRuleView",
      "productFinancialRuleId",
      "recipientReadiness",
      "financial_rules",
      "financial_recipient_accounts"
    ]
  ) {
    assert.ok(
      serviceSource.includes(
        marker
      ),
      `Missing canonical finance marker ${marker}`
    );
  }

  for (
    const forbidden of [
      "runTransaction",
      "writeBatch",
      "bulkWriter",
      "tx.set(",
      "tx.create(",
      "tx.update(",
      "tx.delete(",
      "providerFactory",
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "financial-order-service",
      "financial-reversal-admin-service"
    ]
  ) {
    assert.strictEqual(
      serviceSource.includes(
        forbidden
      ),
      false,
      `Finance read service contains forbidden marker ${forbidden}`
    );
  }

  assert.strictEqual(
    financeFunctions
      .FINANCE_CONSOLE_READ_CAPABILITY,
    "console.finance.read"
  );

  assert.strictEqual(
    financeFunctions
      .SPLITS_CONSOLE_READ_CAPABILITY,
    "console.splits.read"
  );

  const handlerCalls = [];

  const handlerService = {
    async getFinanceOverview() {
      handlerCalls.push(
        "finance"
      );

      return {
        persisted:
          true
      };
    },

    async getCourseSplit(
      input
    ) {
      handlerCalls.push({
        splits:
          input
      });

      return {
        lookupRequired:
          !input.courseId
      };
    }
  };

  const financeHandler =
    financeFunctions
      .createGetFinanceConsoleHandler({
        service:
          handlerService
      });

  const splitsHandler =
    financeFunctions
      .createGetSplitsConsoleHandler({
        service:
          handlerService
      });

  const financeResult =
    await financeHandler({
      auth: {
        uid:
          "finance-admin-1",

        token: {
          finance_admin:
            true
        }
      },

      data: {}
    });

  assert.strictEqual(
    financeResult.ok,
    true
  );

  const splitResult =
    await splitsHandler({
      auth: {
        uid:
          "finance-admin-1",

        token: {
          finance_admin:
            true
        }
      },

      data: {
        courseId:
          "course-1"
      }
    });

  assert.strictEqual(
    splitResult.ok,
    true
  );

  await expectCode(
    () =>
      financeHandler({
        auth: {
          uid:
            "support-1",

          token: {
            support_admin:
              true
          }
        },

        data: {}
      }),
    "permission-denied"
  );

  await expectCode(
    () =>
      splitsHandler({
        auth: {
          uid:
            "finance-admin-1",

          token: {
            finance_admin:
              true
          }
        },

        data: {
          courseId:
            "course-1",

          walletId:
            "forbidden"
        }
      }),
    "invalid-argument"
  );

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

  const mutationFunctions = [
    "configurarRegraFinanceiraPadraoV12",
    "definirRegraFinanceiraCursoV12",
    "registrarContaRecebedorV12",
    "configurarWalletRecebedorV12"
  ];

  for (
    const mutationName of
    mutationFunctions
  ) {
    assert.throws(
      () =>
        routeApi
          .assertAllowedFunction(
            mutationName
          ),
      error =>
        error?.code ===
          "ADMIN_ROUTE_FUNCTION_NOT_ALLOWED"
    );
  }

  assert.deepStrictEqual(
    registryApi
      .integratedRoutes(),
    []
  );

  assert.deepStrictEqual(
    registryApi
      .operationalIntegratedRegistry()
      .integratedRoutes(),
    [
      "people",
      "organizations",
      "courses",
      "exams",
      "questions",
      "certificates",
      "orders"
    ]
  );

  const activeRegistry =
    registryApi
      .financeSplitsIntegratedRegistry();

  assert.deepStrictEqual(
    activeRegistry
      .integratedRoutes(),
    [
      "people",
      "organizations",
      "courses",
      "exams",
      "questions",
      "certificates",
      "orders",
      "finance",
      "splits"
    ]
  );

  const financeContract =
    activeRegistry
      .getRouteDefinition(
        "finance"
      );

  const splitsContract =
    activeRegistry
      .getRouteDefinition(
        "splits"
      );

  assert.strictEqual(
    financeContract
      .readFunction,
    "obterFinanceiroConsoleV12"
  );

  assert.strictEqual(
    splitsContract
      .readFunction,
    "obterSplitsConsoleV12"
  );

  assert.deepStrictEqual(
    financeContract.actions,
    []
  );

  assert.deepStrictEqual(
    splitsContract.actions,
    []
  );

  assert.deepStrictEqual(
    splitsContract.filters,
    [
      "courseId"
    ]
  );

  for (
    const routeId of [
      "webhooks",
      "audit",
      "security",
      "configuration",
      "health"
    ]
  ) {
    assert.strictEqual(
      activeRegistry
        .getRouteDefinition(
          routeId
        )
        .integrated,
      false
    );
  }

  const runtimeCalls = [];

  const context = {
    capabilities: [
      "console.finance.read",
      "console.splits.read"
    ]
  };

  const runtime =
    runtimeApi
      .createRouteRuntime({
        registry:
          activeRegistry,

        navigationApi: {
          canNavigateTo(
            _context,
            routeId
          ) {
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
            runtimeCalls.push({
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
                    true,

                  defaultPlatformFeeBps:
                    1000,

                  rule:
                    null
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
                  null,

                courseFinancialRuleId:
                  null,

                rule:
                  null,

                recipientReadiness: []
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

  const financeState =
    await runtime.activate(
      "finance"
    );

  assert.strictEqual(
    financeState.state,
    "route-ready"
  );

  assert.strictEqual(
    runtimeCalls[0]
      .functionName,
    "obterFinanceiroConsoleV12"
  );

  assert.deepStrictEqual(
    runtimeCalls[0]
      .payload,
    {}
  );

  const emptySplitState =
    await runtime.activate(
      "splits"
    );

  assert.strictEqual(
    emptySplitState.state,
    "route-ready"
  );

  assert.strictEqual(
    emptySplitState
      .data
      .split
      .lookupRequired,
    true
  );

  const courseSplitState =
    await runtime.applyFilters(
      "splits",
      {
        courseId:
          "course-123"
      }
    );

  assert.strictEqual(
    courseSplitState.state,
    "route-ready"
  );

  assert.deepStrictEqual(
    runtimeCalls.at(-1)
      .payload,
    {
      courseId:
        "course-123"
    }
  );

  const beforeForbidden =
    runtimeCalls.length;

  const forbiddenState =
    await runtime.applyFilters(
      "splits",
      {
        walletId:
          "must-not-pass"
      }
    );

  assert.strictEqual(
    forbiddenState.state,
    "route-error"
  );

  assert.strictEqual(
    forbiddenState.errorCode,
    "ROUTE_FILTER_NOT_ALLOWED"
  );

  assert.strictEqual(
    runtimeCalls.length,
    beforeForbidden
  );

  const financeView =
    rendererApi
      .buildFinanceViewModel({
        finance: {
          persisted:
            true,

          active:
            true,

          defaultPlatformFeeBps:
            1000,

          rule: {
            id:
              "platform-default",

            status:
              "active",

            scope:
              "platform_default",

            platformFeeBps:
              1000,

            recipientMode:
              "product_owner",

            recipientShares: [],

            version:
              1,

            updatedAt:
              "updated-at",

            walletId:
              "must-not-render"
          }
        }
      });

  assert.strictEqual(
    financeView
      .defaultPlatformFee,
    "10%"
  );

  assert.strictEqual(
    financeView
      .rule
      .platformFee,
    "10%"
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        financeView.rule,
        "walletId"
      ),
    false
  );

  const rendererSource =
    source(
      "js/admin-shell-finance-splits-renderer-v1_2.js"
    );

  const controllerSource =
    source(
      "js/admin-shell-controller-v1_2.js"
    );

  const routeApiSource =
    source(
      "js/admin-shell-route-api-v1_2.js"
    );

  const htmlSource =
    source(
      "admin_shell_v1_2.html"
    );

  const mainSource =
    source(
      "functions/main.js"
    );

  const compositionStart =
    mainSource.indexOf(
      "const adminFinanceConsoleReadFunctions ="
    );

  const compositionEnd =
    mainSource.indexOf(
      "const financialAdminFunctions =",
      compositionStart
    );

  assert.ok(
    compositionStart >=
      0
  );

  assert.ok(
    compositionEnd >
      compositionStart
  );

  const financeComposition =
    mainSource.slice(
      compositionStart,
      compositionEnd
    );

  assert.ok(
    financeComposition.includes(
      "adminRuntimeAllowed"
    )
  );

  assert.strictEqual(
    financeComposition.includes(
      "providerFactory"
    ),
    false
  );

  assert.strictEqual(
    financeComposition.includes(
      "ASAAS_API_KEY"
    ),
    false
  );

  assert.strictEqual(
    financeComposition.includes(
      "ASAAS_WEBHOOK_TOKEN"
    ),
    false
  );

  for (
    const mutationName of
    mutationFunctions
  ) {
    assert.strictEqual(
      rendererSource.includes(
        mutationName
      ),
      false
    );
  }

  for (
    const forbidden of [
      ".innerHTML",
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
        routeApiSource,
        rendererSource,
        controllerSource,
        htmlSource
      ]
    ) {
      assert.strictEqual(
        clientSource.includes(
          forbidden
        ),
        false,
        `Client contains forbidden marker ${forbidden}`
      );
    }
  }

  const scriptOrder = [
    "js/admin-shell-route-registry-v1_2.js",
    "js/admin-shell-route-runtime-v1_2.js",
    "js/admin-shell-operational-renderer-v1_2.js",
    "js/admin-shell-finance-splits-renderer-v1_2.js",
    "js/admin-shell-controller-v1_2.js"
  ].map(
    marker =>
      htmlSource.indexOf(
        marker
      )
  );

  assert.ok(
    scriptOrder.every(
      index =>
        index >= 0
    )
  );

  for (
    let index = 1;
    index <
      scriptOrder.length;
    index += 1
  ) {
    assert.ok(
      scriptOrder[index - 1] <
        scriptOrder[index]
    );
  }

  assert.ok(
    htmlSource.includes(
      "financeSplitsIntegratedRegistry"
    )
  );

  assert.ok(
    htmlSource.includes(
      "__bjjAdminShellFinanceSplitsRendererV12"
    )
  );

  assert.ok(
    controllerSource.includes(
      "rendererCandidates"
    )
  );

  assert.ok(
    rendererSource.includes(
      '"aria-live"'
    )
  );

  assert.ok(
    rendererSource.includes(
      '"Consultar curso"'
    )
  );

  assert.ok(
    rendererSource.includes(
      '"Limpar consulta"'
    )
  );

  console.log(
    "MARCO8_7D4_CANONICAL_FINANCE_SOURCE=PASSED"
  );

  console.log(
    "MARCO8_7D4_BACKEND_CAPABILITIES=2/2"
  );

  console.log(
    "MARCO8_7D4_BACKEND_AUTHORIZATION=PASSED"
  );

  console.log(
    "MARCO8_7D4_SENSITIVE_WALLET_EXPOSURE=False"
  );

  console.log(
    "MARCO8_7D4_FRONTEND_READ_ALLOWLIST=2/2"
  );

  console.log(
    "MARCO8_7D4_FINANCIAL_MUTATIONS=BLOCKED"
  );

  console.log(
    "MARCO8_7D4_BASE_REGISTRY=0/14"
  );

  console.log(
    "MARCO8_7D4_OPERATIONAL_OVERLAY=7/7"
  );

  console.log(
    "MARCO8_7D4_FINANCE_SPLITS_OVERLAY=9/14"
  );

  console.log(
    "MARCO8_7D4_OTHER_CONSOLE_ROUTES=0/5"
  );

  console.log(
    "MARCO8_7D4_RUNTIME_FINANCE_READ=PASSED"
  );

  console.log(
    "MARCO8_7D4_RUNTIME_SPLITS_FILTER=PASSED"
  );

  console.log(
    "MARCO8_7D4_UNSUPPORTED_FILTER=BLOCKED"
  );

  console.log(
    "MARCO8_7D4_FINANCE_RENDERING=PASSED"
  );

  console.log(
    "MARCO8_7D4_SAFE_DOM=PASSED"
  );

  console.log(
    "MARCO8_7D4_BASIC_ACCESSIBILITY=PASSED"
  );

  console.log(
    "MARCO8_7D4_DIRECT_FIRESTORE=FORBIDDEN"
  );

  console.log(
    "MARCO8_7D4_PROVIDER_SECRET_BINDING=False"
  );

  console.log(
    "MARCO8_7D4_PRODUCTION_EXPORT=BLOCKED"
  );

  console.log(
    "MARCO8_7D4_FINANCE_SPLITS_INTEGRATION=PASSED"
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
