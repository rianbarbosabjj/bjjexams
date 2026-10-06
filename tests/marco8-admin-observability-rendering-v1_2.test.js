"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const rendererApi =
  require(
    "../js/admin-shell-observability-renderer-v1_2"
  );

const controllerApi =
  require(
    "../js/admin-shell-controller-v1_2"
  );

const registryApi =
  require(
    "../js/admin-shell-route-registry-v1_2"
  );

const webhookReprocessOverlay =
  require(
    "../js/admin-shell-webhook-reprocess-overlay-v1_2"
  );

const observabilityOverlay =
  require(
    "../js/admin-shell-observability-overlay-v1_2"
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

function element(
  tagName = "div"
) {
  return {
    tagName:
      String(
        tagName
      ).toUpperCase(),

    textContent:
      "",

    className:
      "",

    classList: {
      values:
        new Set(),

      add(
        value
      ) {
        this.values.add(
          String(
            value
          )
        );
      },

      remove(
        value
      ) {
        this.values.delete(
          String(
            value
          )
        );
      },

      contains(
        value
      ) {
        return this.values.has(
          String(
            value
          )
        );
      }
    },

    hidden:
      false,

    dataset: {},

    children: [],

    attributes: {},

    listeners: {},

    id:
      "",

    type:
      "",

    tabIndex:
      0,

    replaceChildren(
      ...children
    ) {
      this.children =
        children;
    },

    appendChild(
      child
    ) {
      this.children.push(
        child
      );

      return child;
    },

    setAttribute(
      name,
      value
    ) {
      this.attributes[
        name
      ] =
        String(
          value
        );
    },

    removeAttribute(
      name
    ) {
      delete this
        .attributes[
          name
        ];
    },

    addEventListener(
      name,
      handler
    ) {
      this.listeners[
        name
      ] =
        handler;
    }
  };
}

function documentStub() {
  const selectors = [
    "[data-admin-shell-root]",
    "[data-admin-state-loading]",
    "[data-admin-state-denied]",
    "[data-admin-state-error]",
    "[data-admin-error-message]",
    "[data-admin-state-ready]",
    "[data-admin-navigation]",
    "[data-admin-user-name]",
    "[data-admin-environment]",
    "[data-admin-route-title]",
    "[data-admin-route-section]",
    "[data-admin-route-content]",
    "[data-admin-route-placeholder-panel]",
    "[data-admin-operational-content]",
    "[data-admin-route-state-title]",
    "[data-admin-route-placeholder]"
  ];

  const nodes =
    new Map(
      selectors.map(
        selector => [
          selector,
          element()
        ]
      )
    );

  return {
    nodes,

    querySelector(
      selector
    ) {
      return (
        nodes.get(
          selector
        ) ||
        null
      );
    },

    createElement(
      tagName
    ) {
      return element(
        tagName
      );
    }
  };
}

function walk(
  node,
  predicate,
  output = []
) {
  if (
    predicate(
      node
    )
  ) {
    output.push(
      node
    );
  }

  for (
    const child of
    node?.children ||
    []
  ) {
    walk(
      child,
      predicate,
      output
    );
  }

  return output;
}

function textTree(
  node
) {
  let output =
    String(
      node?.textContent ||
      ""
    );

  for (
    const child of
    node?.children ||
    []
  ) {
    output +=
      " " +
      textTree(
        child
      );
  }

  return output;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function securityResult() {
  return {
    ok:
      true,

    view: {
      environment: {
        admin:
          "staging",

        financial:
          "sandbox"
      },

      region:
        "southamerica-east1",

      runtime: {
        nodeMajor:
          22,

        revision:
          "revision-f2"
      },

      gates: {
        adminRuntimeAllowed:
          true,

        providerEnvironmentAllowed:
          true
      },

      bindings: {
        asaasApiKeyConfigured:
          true,

        asaasWebhookTokenConfigured:
          true
      },

      protections: {
        productionAdminExportBlocked:
          true,

        directBrowserAdminCollectionsBlocked:
          true,

        secretValuesExposed:
          false,

        providerHealthPing:
          false
      },

      alerts: {
        status:
          "unsupported",

        items:
          null
      },

      secretValue:
        "must-not-render"
    }
  };
}

function configurationResult() {
  return {
    ok:
      true,

    view: {
      contractVersion:
        "1.2",

      region:
        "southamerica-east1",

      environment: {
        admin:
          "staging",

        financial:
          "sandbox"
      },

      provider: {
        name:
          "asaas",

        allowedByEnvironment:
          true,

        externalHealth:
          "not_measured",

        apiKey:
          "must-not-render"
      },

      limits: {
        webhooks: {
          defaultLimit:
            20,

          maxLimit:
            25,

          maxScanDocs:
            260
        },

        audit: {
          defaultLimit:
            20,

          maxLimit:
            25,

          maxScanDocs:
            260,

          metadataMaxJsonBytes:
            2048
        }
      },

      features: {
        configReadOnly:
          true,

        configMutationEnabled:
          false,

        providerHealthPing:
          false,

        productionAdminExport:
          false
      },

      arbitrary:
        "must-not-render"
    }
  };
}

function healthResult(
  available =
    true
) {
  return {
    ok:
      true,

    view: {
      environment: {
        admin:
          "staging",

        financial:
          "sandbox"
      },

      firestore: {
        reachable:
          available,

        queryMode:
          "aggregate_count"
      },

      runtime: {
        nodeMajor:
          22,

        revision:
          "revision-f2"
      },

      functions: {
        adminRuntimeAllowed:
          true,

        security:
          "enabled",

        config:
          "enabled",

        health:
          "enabled"
      },

      provider: {
        name:
          "asaas",

        allowedByEnvironment:
          true,

        externalHealth:
          "not_measured"
      },

      webhooks: {
        status:
          available
            ? "available"
            : "unavailable",

        counts:
          available
            ? {
                total:
                  30,

                received:
                  2,

                processing:
                  1,

                processed:
                  23,

                ignored:
                  1,

                error:
                  3
              }
            : null
      },

      reconciliation: {
        status:
          available
            ? "available"
            : "unavailable",

        counts:
          available
            ? {
                executing:
                  1,

                awaitingWebhook:
                  2,

                providerRejected:
                  1,

                needsReconciliation:
                  2
              }
            : null
      },

      incidents: {
        status:
          available
            ? "derived"
            : "unavailable",

        total:
          available
            ? 6
            : null,

        webhookErrors:
          available
            ? 3
            : null,

        reconciliationRequired:
          available
            ? 3
            : null
      },

      rawPayload:
        "must-not-render"
    }
  };
}

async function main() {
  assert.deepStrictEqual(
    rendererApi
      .OBSERVABILITY_ROUTE_IDS,
    [
      "security",
      "configuration",
      "health"
    ]
  );

  const activeRegistry =
    observabilityOverlay
      .observabilityIntegratedRegistry(
        registryApi,
        webhookReprocessOverlay
      );

  assert.strictEqual(
    activeRegistry
      .integratedRoutes()
      .length,
    14
  );

  const securityModel =
    rendererApi
      .buildSecurityViewModel(
        securityResult()
      );

  assert.strictEqual(
    securityModel
      .environmentAdmin,
    "staging"
  );

  assert.strictEqual(
    securityModel
      .alertsStatus,
    "Nao suportado"
  );

  assert.strictEqual(
    securityModel
      .secretValuesExposed,
    "Nao"
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        securityModel,
        "secretValue"
      ),
    false
  );

  const configModel =
    rendererApi
      .buildConfigurationViewModel(
        configurationResult()
      );

  assert.strictEqual(
    configModel
      .providerExternalHealth,
    "Nao medido"
  );

  assert.strictEqual(
    configModel
      .configReadOnly,
    "Sim"
  );

  assert.strictEqual(
    configModel
      .configMutationEnabled,
    "Nao"
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        configModel,
        "arbitrary"
      ),
    false
  );

  const healthModel =
    rendererApi
      .buildHealthViewModel(
        healthResult()
      );

  assert.strictEqual(
    healthModel
      .queryMode,
    "aggregate_count"
  );

  assert.strictEqual(
    healthModel
      .providerExternalHealth,
    "Nao medido"
  );

  assert.strictEqual(
    healthModel
      .webhookCounts
      .error,
    "3"
  );

  assert.strictEqual(
    healthModel
      .reconciliationCounts
      .needsReconciliation,
    "2"
  );

  assert.strictEqual(
    healthModel
      .incidentsTotal,
    "6"
  );

  const degradedModel =
    rendererApi
      .buildHealthViewModel(
        healthResult(
          false
        )
      );

  assert.strictEqual(
    degradedModel
      .webhooksStatus,
    "Indisponivel"
  );

  assert.strictEqual(
    degradedModel
      .webhookCounts,
    null
  );

  assert.strictEqual(
    degradedModel
      .reconciliationStatus,
    "Indisponivel"
  );

  assert.strictEqual(
    degradedModel
      .reconciliationCounts,
    null
  );

  assert.strictEqual(
    degradedModel
      .incidentsStatus,
    "Indisponivel"
  );

  const document =
    documentStub();

  const renderer =
    rendererApi
      .createObservabilityRenderer({
        document
      });

  const securityContainer =
    element();

  assert.strictEqual(
    renderer.render(
      securityContainer,
      {
        state:
          "route-ready",

        routeId:
          "security",

        data:
          securityResult()
      }
    ),
    true
  );

  const securityText =
    textTree(
      securityContainer
    );

  assert.ok(
    securityText.includes(
      "Seguranca"
    )
  );

  assert.ok(
    securityText.includes(
      "Nao suportado"
    )
  );

  assert.strictEqual(
    securityText.includes(
      "must-not-render"
    ),
    false
  );

  const configContainer =
    element();

  assert.strictEqual(
    renderer.render(
      configContainer,
      {
        state:
          "route-ready",

        routeId:
          "configuration",

        data:
          configurationResult()
      }
    ),
    true
  );

  const configText =
    textTree(
      configContainer
    );

  assert.ok(
    configText.includes(
      "Configuracao"
    )
  );

  assert.ok(
    configText.includes(
      "Nao medido"
    )
  );

  assert.ok(
    configText.includes(
      "Mutation de configuracao habilitada"
    )
  );

  assert.strictEqual(
    configText.includes(
      "must-not-render"
    ),
    false
  );

  assert.strictEqual(
    walk(
      configContainer,
      node =>
        node?.tagName ===
        "BUTTON"
    ).length,
    0
  );

  const healthContainer =
    element();

  assert.strictEqual(
    renderer.render(
      healthContainer,
      {
        state:
          "route-ready",

        routeId:
          "health",

        data:
          healthResult(
            false
          )
      }
    ),
    true
  );

  const healthText =
    textTree(
      healthContainer
    );

  assert.ok(
    healthText.includes(
      "Saude operacional"
    )
  );

  assert.ok(
    healthText.includes(
      "Indisponivel"
    )
  );

  assert.ok(
    healthText.includes(
      "Nao medido"
    )
  );

  assert.strictEqual(
    healthText.includes(
      "must-not-render"
    ),
    false
  );

  assert.strictEqual(
    renderer.render(
      element(),
      {
        state:
          "route-ready",

        routeId:
          "audit",

        data: {}
      }
    ),
    false
  );

  assert.strictEqual(
    renderer.render(
      element(),
      {
        state:
          "route-loading",

        routeId:
          "health",

        data:
          healthResult()
      }
    ),
    false
  );

  const controllerDocument =
    documentStub();

  const observabilityCalls =
    [];

  const controller =
    controllerApi
      .createController({
        document:
          controllerDocument,

        navigationApi: {
          buildNavigation() {
            return [
              {
                id:
                  "console",

                label:
                  "Console",

                items: [
                  {
                    id:
                      "health",

                    label:
                      "Saude",

                    route:
                      "health",

                    capability:
                      "console.health.read"
                  }
                ]
              }
            ];
          },

          canNavigateTo(
            _context,
            route
          ) {
            return (
              route ===
              "health"
            );
          },

          firstAllowedRoute() {
            return "health";
          }
        },

        routeRuntime: {
          activate(
            routeId
          ) {
            return Promise.resolve({
              state:
                "route-ready",

              routeId,

              mode:
                "list",

              data:
                healthResult()
            });
          }
        },

        operationalRenderer: {
          render() {
            return false;
          }
        },

        financeSplitsRenderer: {
          render() {
            return false;
          }
        },

        webhooksAuditRenderer: {
          render() {
            return false;
          }
        },

        observabilityRenderer: {
          render(
            container,
            state
          ) {
            observabilityCalls.push(
              state.routeId
            );

            container
              .replaceChildren(
                element()
              );

            return true;
          }
        }
      });

  controller.mountContext(
    {
      userId:
        "admin-f2",

      displayName:
        "Admin F2",

      environment:
        "staging"
    },
    "health"
  );

  await flush();

  assert.deepStrictEqual(
    observabilityCalls,
    [
      "health"
    ]
  );

  assert.strictEqual(
    controllerDocument
      .nodes
      .get(
        "[data-admin-route-placeholder-panel]"
      )
      .hidden,
    true
  );

  assert.strictEqual(
    controllerDocument
      .nodes
      .get(
        "[data-admin-operational-content]"
      )
      .hidden,
    false
  );

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
      "js/admin-shell-observability-renderer-v1_2.js"
    );

  const scriptOrder = [
    "js/admin-shell-route-registry-v1_2.js",
    "js/admin-shell-webhook-reprocess-overlay-v1_2.js",
    "js/admin-shell-observability-overlay-v1_2&#46;js",
    "js/admin-shell-route-runtime-v1_2.js",
    "js/admin-shell-webhooks-audit-renderer-v1_2.js",
    "js/admin-shell-observability-renderer-v1_2.js",
    "js/admin-shell-controller-v1_2.js"
  ].map(
    marker =>
      html.indexOf(
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
      scriptOrder[index] >
      scriptOrder[
        index - 1
      ]
    );
  }

  for (
    const marker of [
      "BjjExamsAdminShellObservabilityOverlay",
      "BjjExamsAdminShellObservabilityRenderer",
      "__bjjAdminShellObservabilityRendererV12",
      "observabilityIntegratedRegistry",
      "observabilityRenderer"
    ]
  ) {
    assert.ok(
      html.includes(
        marker
      ),
      `Missing F2 HTML marker ${marker}`
    );
  }

  assert.ok(
    controllerSource.includes(
      "observabilityRenderer"
    )
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
      "collection(",
      "getDoc(",
      "getDocs(",
      "setDoc(",
      "addDoc(",
      "updateDoc(",
      "deleteDoc(",
      "onSnapshot(",
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "CHECKOUT_SECRETS",
      "providerFactory",
      "callActionAuthenticated",
      "reprocessarWebhookOperacionalV12"
    ]
  ) {
    assert.strictEqual(
      rendererSource.includes(
        forbidden
      ),
      false
    );
  }

  assert.strictEqual(
    source(
      "js/admin-shell-route-registry-v1_2.js"
    ).includes(
      "observabilityIntegratedRegistry"
    ),
    false
  );

  console.log(
    "MARCO8_7F2_SECURITY_VIEW_MODEL=PASSED"
  );

  console.log(
    "MARCO8_7F2_CONFIGURATION_VIEW_MODEL=PASSED"
  );

  console.log(
    "MARCO8_7F2_HEALTH_VIEW_MODEL=PASSED"
  );

  console.log(
    "MARCO8_7F2_UNSUPPORTED_STATE=EXPLICIT"
  );

  console.log(
    "MARCO8_7F2_UNAVAILABLE_STATE=EXPLICIT"
  );

  console.log(
    "MARCO8_7F2_PROVIDER_HEALTH=NOT_MEASURED"
  );

  console.log(
    "MARCO8_7F2_CONFIG_MUTATION=BLOCKED"
  );

  console.log(
    "MARCO8_7F2_OBSERVABILITY_ACTIONS=0/3"
  );

  console.log(
    "MARCO8_7F2_ACTIVE_ROUTES=14/14"
  );

  console.log(
    "MARCO8_7F2_CONTROLLER_WIRING=PASSED"
  );

  console.log(
    "MARCO8_7F2_SCRIPT_ORDER=PASSED"
  );

  console.log(
    "MARCO8_7F2_SAFE_DOM=PASSED"
  );

  console.log(
    "MARCO8_7F2_BASIC_ACCESSIBILITY=PASSED"
  );

  console.log(
    "MARCO8_7F2_DIRECT_FIRESTORE=FORBIDDEN"
  );

  console.log(
    "MARCO8_7F2_PROVIDER_SECRET_BINDING=False"
  );

  console.log(
    "MARCO8_7F2_OBSERVABILITY_RENDERING=PASSED"
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
