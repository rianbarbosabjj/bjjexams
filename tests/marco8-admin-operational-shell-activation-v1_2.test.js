"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const registryApi =
  require(
    "../js/admin-shell-route-registry-v1_2"
  );

const runtimeApi =
  require(
    "../js/admin-shell-route-runtime-v1_2"
  );

const controllerApi =
  require(
    "../js/admin-shell-controller-v1_2"
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

function classList() {
  const values =
    new Set();

  return {
    add(value) {
      values.add(value);
    },

    remove(value) {
      values.delete(value);
    },

    contains(value) {
      return values.has(value);
    }
  };
}

function element() {
  return {
    hidden: false,
    dataset: {},
    textContent: "",
    className: "",
    classList:
      classList(),
    children: [],
    attributes: {},
    listeners: {},

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
      this.attributes[name] =
        String(value);
    },

    removeAttribute(
      name
    ) {
      delete this
        .attributes[name];
    },

    addEventListener(
      name,
      handler
    ) {
      this.listeners[name] =
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

    createElement() {
      return element();
    }
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function main() {
  const operationalRoutes = [
    "people",
    "organizations",
    "courses",
    "exams",
    "questions",
    "certificates",
    "orders"
  ];

  assert.deepStrictEqual(
    registryApi
      .integratedRoutes(),
    []
  );

  const activeRegistry =
    registryApi
      .operationalIntegratedRegistry();

  assert.deepStrictEqual(
    activeRegistry
      .integratedRoutes(),
    operationalRoutes
  );

  assert.strictEqual(
    activeRegistry
      .integratedRoutes()
      .length,
    7
  );

  for (
    const routeId of
    operationalRoutes
  ) {
    const contract =
      activeRegistry
        .getRouteDefinition(
          routeId
        );

    assert.ok(contract);

    assert.strictEqual(
      contract.integrated,
      true
    );

    assert.strictEqual(
      contract.surface,
      "operations"
    );
  }

  for (
    const routeId of [
      "finance",
      "splits",
      "webhooks",
      "audit",
      "security",
      "configuration",
      "health"
    ]
  ) {
    const contract =
      activeRegistry
        .getRouteDefinition(
          routeId
        );

    assert.ok(contract);

    assert.strictEqual(
      contract.integrated,
      false
    );
  }

  const context = {
    userId:
      "admin-1"
  };

  const calls = [];

  const routeApi = {
    async callRouteAuthenticated(
      functionName,
      payload
    ) {
      calls.push({
        functionName,
        payload
      });

      return {
        ok: true,
        items: [],
        nextCursor:
          null
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
          operationalRoutes
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

        routeApi
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
    operationalRoutes
  ) {
    const contract =
      activeRegistry
        .getRouteDefinition(
          routeId
        );

    const before =
      calls.length;

    const result =
      await runtime
        .activate(
          routeId
        );

    assert.strictEqual(
      result.state,
      "route-empty"
    );

    assert.strictEqual(
      calls.length,
      before + 1
    );

    assert.strictEqual(
      calls.at(-1)
        .functionName,
      contract.readFunction
    );
  }

  const callsBeforeConsole =
    calls.length;

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

  const html =
    source(
      "admin_shell_v1_2.html"
    );

  const scriptOrder = [
    "js/firebase-runtime-v1_2.js",
    "js/admin-shell-api-v1_2.js",
    "js/admin-shell-navigation-v1_2.js",
    "js/admin-shell-route-api-v1_2.js",
    "js/admin-shell-route-registry-v1_2.js",
    "js/admin-shell-route-runtime-v1_2.js",
    "js/admin-shell-operational-renderer-v1_2.js",
    "js/admin-shell-controller-v1_2.js",
    "js/admin-shell-bootstrap-v1_2.js"
  ].map(
    script =>
      html.indexOf(
        script
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
      "data-admin-route-placeholder-panel",
      "data-admin-operational-content",
      "BjjExamsAdminShellOperationalRenderer",
      "operationalIntegratedRegistry",
      "__bjjAdminShellOperationalRendererV12"
    ]
  ) {
    assert.ok(
      html.includes(
        marker
      ),
      `Missing activation marker ${marker}`
    );
  }

  assert.ok(
    html.includes(
      "Somente leituras administrativas autorizadas"
    )
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
    assert.strictEqual(
      html.includes(
        forbidden
      ),
      false
    );
  }

  const document =
    documentStub();

  const operationalRendererCalls =
    [];

  const operationalRenderer = {
    render(
      container,
      state
    ) {
      operationalRendererCalls
        .push({
          container,
          state
        });

      container.replaceChildren({
        kind:
          "rendered-operational"
      });

      return (
        state.state ===
          "route-ready" &&
        state.mode ===
          "list"
      );
    }
  };

  const controllerNavigation = {
    buildNavigation() {
      return [
        {
          id:
            "operations",
          label:
            "Painel Operacional",
          items: [
            {
              id:
                "people",
              label:
                "Pessoas",
              route:
                "people",
              capability:
                "ops.people.read"
            }
          ]
        }
      ];
    },

    canNavigateTo(
      receivedContext,
      route
    ) {
      return (
        receivedContext ===
          context &&
        route ===
          "people"
      );
    },

    firstAllowedRoute() {
      return "people";
    }
  };

  const routeRuntimeStub = {
    activate(
      routeId
    ) {
      return Promise.resolve({
        state:
          "route-ready",
        routeId,
        mode:
          "list",
        data: {
          items: [
            {
              personId:
                "person-1"
            }
          ],
          nextCursor:
            null
        }
      });
    }
  };

  const controller =
    controllerApi
      .createController({
        document,

        navigationApi:
          controllerNavigation,

        routeRuntime:
          routeRuntimeStub,

        operationalRenderer
      });

  controller.mountContext(
    context,
    "people"
  );

  await flush();

  const placeholderPanel =
    document.nodes.get(
      "[data-admin-route-placeholder-panel]"
    );

  const operationalContent =
    document.nodes.get(
      "[data-admin-operational-content]"
    );

  const routeContent =
    document.nodes.get(
      "[data-admin-route-content]"
    );

  assert.strictEqual(
    operationalRendererCalls
      .length,
    1
  );

  assert.strictEqual(
    placeholderPanel.hidden,
    true
  );

  assert.strictEqual(
    operationalContent.hidden,
    false
  );

  assert.strictEqual(
    routeContent
      .attributes[
        "aria-busy"
      ],
    "false"
  );

  controller.renderRouteState({
    state:
      "route-loading",
    routeId:
      "people",
    mode:
      "list"
  });

  assert.strictEqual(
    placeholderPanel.hidden,
    false
  );

  assert.strictEqual(
    operationalContent.hidden,
    true
  );

  assert.strictEqual(
    operationalContent
      .children
      .length,
    0
  );

  assert.strictEqual(
    routeContent
      .attributes[
        "aria-busy"
      ],
    "true"
  );

  controller.renderRouteState({
    state:
      "route-error",
    routeId:
      "people",
    errorCode:
      "SENSITIVE_BACKEND_CODE"
  });

  const routeMessage =
    document.nodes.get(
      "[data-admin-route-placeholder]"
    );

  assert.strictEqual(
    routeMessage
      .textContent
      .includes(
        "SENSITIVE_BACKEND_CODE"
      ),
    false
  );

  const controllerSource =
    source(
      "js/admin-shell-controller-v1_2.js"
    );

  assert.strictEqual(
    controllerSource
      .includes(
        ".innerHTML"
      ),
    false
  );

  console.log(
    "MARCO8_7C3B_BASE_REGISTRY_INTEGRATED=0/14"
  );

  console.log(
    "MARCO8_7C3B_ACTIVE_OPERATIONAL_ROUTES=7/7"
  );

  console.log(
    "MARCO8_7C3B_ACTIVE_CONSOLE_ROUTES=0/7"
  );

  console.log(
    "MARCO8_7C3B_OPERATIONAL_LIST_CALLS=7/7"
  );

  console.log(
    "MARCO8_7C3B_CONSOLE_CALLS=0"
  );

  console.log(
    "MARCO8_7C3B_SCRIPT_ORDER=9/9"
  );

  console.log(
    "MARCO8_7C3B_RENDERER_WIRING=PASSED"
  );

  console.log(
    "MARCO8_7C3B_PLACEHOLDER_HOST_PRESERVED=PASSED"
  );

  console.log(
    "MARCO8_7C3B_LOADING_RESTORES_PLACEHOLDER=PASSED"
  );

  console.log(
    "MARCO8_7C3B_ROUTE_ERROR_SANITIZED=PASSED"
  );

  console.log(
    "MARCO8_7C3B_SAFE_DOM=PASSED"
  );

  console.log(
    "MARCO8_7C3B_DIRECT_FIRESTORE=FORBIDDEN"
  );

  console.log(
    "MARCO8_7C3B_OPERATIONAL_ACTIVATION=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
