"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const controllerApi =
  require("../js/admin-shell-controller-v1_2");

const bootstrapApi =
  require("../js/admin-shell-bootstrap-v1_2");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs
    .readFileSync(path.join(ROOT, relativePath), "utf8")
    .replace(/\r\n/g, "\n");
}

function makeClassList() {
  const values = new Set();

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

function makeElement() {
  return {
    hidden: false,
    dataset: {},
    textContent: "",
    className: "",
    classList: makeClassList(),
    children: [],
    attributes: {},
    listeners: {},

    replaceChildren(...children) {
      this.children = children;
    },

    appendChild(child) {
      this.children.push(child);
      return child;
    },

    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },

    removeAttribute(name) {
      delete this.attributes[name];
    },

    addEventListener(name, handler) {
      this.listeners[name] = handler;
    }
  };
}

function makeDocument() {
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
    "[data-admin-route-state-title]",
    "[data-admin-route-placeholder]"
  ];

  const nodes = new Map(
    selectors.map(selector => [
      selector,
      makeElement()
    ])
  );

  return {
    nodes,
    querySelector(selector) {
      return nodes.get(selector) || null;
    },
    createElement() {
      return makeElement();
    }
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function main() {
  const html = read("admin_shell_v1_2.html");
  const controllerSource =
    read("js/admin-shell-controller-v1_2.js");
  const bootstrapSource =
    read("js/admin-shell-bootstrap-v1_2.js");

  const scripts = [
    "js/firebase-runtime-v1_2.js",
    "js/admin-shell-api-v1_2.js",
    "js/admin-shell-navigation-v1_2.js",
    "js/admin-shell-route-api-v1_2.js",
    "js/admin-shell-route-registry-v1_2.js",
    "js/admin-shell-route-runtime-v1_2.js",
    "js/admin-shell-controller-v1_2.js",
    "js/admin-shell-bootstrap-v1_2.js"
  ].map(source => html.indexOf(source));

  assert.ok(scripts.every(index => index >= 0));

  for (let index = 1; index < scripts.length; index += 1) {
    assert.ok(
      scripts[index] > scripts[index - 1],
      "Admin shell script order is invalid."
    );
  }

  for (const marker of [
    "data-admin-route-content",
    "data-admin-route-state-title",
    "aria-live=\"polite\"",
    "aria-busy=\"false\"",
    "BjjExamsAdminShellRouteApi",
    "BjjExamsAdminShellRouteRegistry",
    "BjjExamsAdminShellRouteRuntime",
    "__bjjAdminShellRouteRuntimeV12"
  ]) {
    assert.ok(
      html.includes(marker),
      `Missing HTML wiring marker ${marker}`
    );
  }

  for (const forbidden of [
    "firebase-firestore",
    "getFirestore(",
    "getDocs(",
    "setDoc(",
    "addDoc(",
    "updateDoc(",
    "deleteDoc(",
    "onSnapshot("
  ]) {
    assert.strictEqual(
      html.includes(forbidden),
      false,
      `Direct Firestore marker found: ${forbidden}`
    );
  }

  assert.ok(controllerSource.includes("renderRouteState"));
  assert.ok(controllerSource.includes("requestRoute"));
  assert.ok(bootstrapSource.includes("routeRuntime.setSession"));
  assert.ok(bootstrapSource.includes("routeRuntime.clearSession"));

  const document = makeDocument();

  const context = {
    userId: "admin-1",
    displayName: "Admin",
    environment: "staging",
    surfaceAccess: {
      operations: true,
      console: false
    },
    capabilities: [
      "ops.read",
      "ops.people.read"
    ]
  };

  const navigationApi = {
    buildNavigation() {
      return [
        {
          id: "operations",
          label: "Painel Operacional",
          items: [
            {
              id: "people",
              label: "Pessoas",
              route: "people",
              capability: "ops.people.read"
            }
          ]
        }
      ];
    },

    canNavigateTo(receivedContext, route) {
      return (
        receivedContext === context &&
        route === "people"
      );
    },

    firstAllowedRoute() {
      return "people";
    }
  };

  const activations = [];

  const routeRuntime = {
    activate(route) {
      activations.push(route);

      return Promise.resolve({
        state: "route-not-integrated",
        routeId: route,
        data: null
      });
    }
  };

  const controller =
    controllerApi.createController({
      document,
      navigationApi,
      routeRuntime
    });

  const mounted =
    controller.mountContext(context, "people");

  assert.strictEqual(mounted.state, "ready");
  assert.deepStrictEqual(activations, ["people"]);

  await flush();

  const routeContent =
    document.nodes.get("[data-admin-route-content]");
  const routeTitle =
    document.nodes.get("[data-admin-route-state-title]");
  const routeMessage =
    document.nodes.get("[data-admin-route-placeholder]");

  assert.strictEqual(
    routeContent.dataset.routeState,
    "route-not-integrated"
  );

  assert.strictEqual(
    routeContent.attributes["aria-busy"],
    "false"
  );

  assert.strictEqual(
    routeTitle.textContent,
    "Superficie preparada"
  );

  assert.ok(
    routeMessage.textContent.includes("proximos gates")
  );

  controller.renderRouteState({
    state: "route-loading",
    routeId: "people"
  });

  assert.strictEqual(
    routeContent.dataset.routeState,
    "route-loading"
  );

  assert.strictEqual(
    routeContent.attributes["aria-busy"],
    "true"
  );

  controller.renderRouteState({
    state: "route-error",
    routeId: "people",
    errorCode: "ADMIN_ROUTE_CALL_FAILED"
  });

  assert.strictEqual(
    routeTitle.textContent,
    "Falha ao carregar dados"
  );

  assert.strictEqual(
    routeMessage.textContent.includes(
      "ADMIN_ROUTE_CALL_FAILED"
    ),
    false
  );

  const events = [];

  const routeSessionRuntime = {
    clearSession() {
      events.push({ type: "clear" });
      return true;
    },

    setSession(value) {
      events.push({
        type: "set",
        value
      });

      return {
        sessionGeneration: 1
      };
    }
  };

  const bootstrapController = {
    showLoading() {
      events.push({ type: "loading" });
    },

    showDenied() {
      events.push({ type: "denied" });
    },

    showError() {
      events.push({ type: "error" });
    },

    mountContext(receivedContext, route) {
      events.push({
        type: "mount",
        receivedContext,
        route
      });

      return {
        state: "ready"
      };
    }
  };

  const adminApi = {
    resolveShellEnvironment() {
      return {
        environment: "staging",
        projectId: "bjj-exams-staging",
        local: true
      };
    },

    async getAdminContext() {
      return context;
    }
  };

  const bootstrap =
    bootstrapApi.createBootstrap({
      root: {
        location: {
          hostname: "localhost",
          hash: "#people"
        }
      },

      adminApi,
      controller: bootstrapController,
      routeRuntime: routeSessionRuntime,

      runtime: {
        async loadConfig() {
          return {};
        }
      },

      hostname: "localhost",

      fetchImpl: async () => {
        throw new Error("not-used");
      }
    });

  const user = {
    async getIdToken(force) {
      assert.strictEqual(force, true);
      return "id-token-8-7b2";
    }
  };

  const processed =
    await bootstrap.processUser(user);

  assert.strictEqual(processed.status, "ready");

  const setEvent =
    events.find(event => event.type === "set");

  assert.ok(setEvent);
  assert.strictEqual(setEvent.value.context, context);
  assert.strictEqual(
    setEvent.value.idToken,
    "id-token-8-7b2"
  );
  assert.strictEqual(
    setEvent.value.hostname,
    "localhost"
  );

  const setIndex =
    events.findIndex(event => event.type === "set");
  const mountIndex =
    events.findIndex(event => event.type === "mount");

  assert.ok(
    setIndex >= 0 &&
    mountIndex > setIndex
  );

  await bootstrap.processUser(null);

  assert.strictEqual(
    events.at(-1).type,
    "denied"
  );

  bootstrap.stop();

  assert.strictEqual(
    events.at(-1).type,
    "clear"
  );

  console.log("MARCO8_7B2_SCRIPT_ORDER=8/8");
  console.log("MARCO8_7B2_CONTENT_HOST=PASSED");
  console.log("MARCO8_7B2_ROUTE_RUNTIME_GLOBAL=PASSED");
  console.log("MARCO8_7B2_CONTROLLER_ROUTE_ACTIVATION=PASSED");
  console.log("MARCO8_7B2_ROUTE_NOT_INTEGRATED_RENDER=PASSED");
  console.log("MARCO8_7B2_ROUTE_LOADING_ARIA=PASSED");
  console.log("MARCO8_7B2_ROUTE_ERROR_SANITIZED=PASSED");
  console.log("MARCO8_7B2_BOOTSTRAP_SESSION_BEFORE_MOUNT=PASSED");
  console.log("MARCO8_7B2_LOGOUT_CLEARS_ROUTE_SESSION=PASSED");
  console.log("MARCO8_7B2_STOP_CLEARS_ROUTE_SESSION=PASSED");
  console.log("MARCO8_7B2_DIRECT_FIRESTORE=FORBIDDEN");
  console.log("MARCO8_7B2_RUNTIME_WIRING=PASSED");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
