"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

require("../js/admin-shell-api-v1_2");

const routeApi = require("../js/admin-shell-route-api-v1_2");
const registryApi = require("../js/admin-shell-route-registry-v1_2");
const overlayApi = require("../js/admin-shell-webhook-reprocess-overlay-v1_2");
const runtimeApi = require("../js/admin-shell-route-runtime-v1_2");
const rendererApi = require("../js/admin-shell-webhooks-audit-renderer-v1_2");
const { ROLE_CAPABILITIES } = require("../functions/src/admin/admin-access-policy");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

function classList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); }
  };
}

function element(tag = "div") {
  return {
    tagName: String(tag).toUpperCase(),
    hidden: false,
    disabled: false,
    dataset: {},
    textContent: "",
    className: "",
    classList: classList(),
    children: [],
    attributes: {},
    listeners: {},
    value: "",
    id: "",
    name: "",
    type: "",
    autocomplete: "",
    tabIndex: 0,
    scope: "",
    replaceChildren(...children) { this.children = children; },
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, handler) { this.listeners[name] = handler; }
  };
}

function documentStub() {
  return {
    createElement(tag) {
      return element(tag);
    }
  };
}

function walk(node, predicate, output = []) {
  if (predicate(node)) output.push(node);
  for (const child of node?.children || []) walk(child, predicate, output);
  return output;
}

function textTree(node) {
  let output = String(node?.textContent || "");
  for (const child of node?.children || []) output += " " + textTree(child);
  return output;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function main() {
  assert.deepStrictEqual(routeApi.ROUTE_READ_FUNCTIONS, [
    "listarWebhooksOperacionaisV12",
    "obterWebhookOperacionalV12",
    "listarAuditoriaOperacionalV12",
    "obterSegurancaOperacionalV12",
    "obterConfiguracaoOperacionalV12",
    "obterSaudeOperacionalV12"
  ]);

  assert.deepStrictEqual(routeApi.ROUTE_ACTION_FUNCTIONS, [
    "reprocessarWebhookOperacionalV12"
  ]);

  assert.throws(
    () => routeApi.assertAllowedFunction("reprocessarWebhookOperacionalV12"),
    error => error?.code === "ADMIN_ROUTE_FUNCTION_NOT_ALLOWED"
  );

  assert.strictEqual(
    routeApi.assertAllowedActionFunction("reprocessarWebhookOperacionalV12"),
    "reprocessarWebhookOperacionalV12"
  );

  assert.throws(
    () => routeApi.assertAllowedActionFunction("adminWriteAnything"),
    error => error?.code === "ADMIN_ROUTE_ACTION_FUNCTION_NOT_ALLOWED"
  );

  await assert.rejects(
    () => routeApi.callActionAuthenticated(
      "reprocessarWebhookOperacionalV12",
      { eventId: "event-1", requestId: "request-1" },
      { hostname: "localhost" }
    ),
    error => error?.code === "ADMIN_ROUTE_ACTION_TOKEN_REQUIRED"
  );

  assert.throws(
    () => routeApi.actionFunctionUrl(
      "reprocessarWebhookOperacionalV12",
      { hostname: "bjj-exams.web.app" }
    ),
    error => error?.code === "ADMIN_PRODUCTION_BLOCKED"
  );

  let actionUrl = null;
  let actionOptions = null;

  const actionResult = await routeApi.callActionAuthenticated(
    "reprocessarWebhookOperacionalV12",
    { eventId: "event-1", requestId: "request-1" },
    {
      hostname: "localhost",
      idToken: "action-token",
      async fetchImpl(url, options) {
        actionUrl = url;
        actionOptions = options;
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              result: {
                ok: true,
                accepted: true,
                idempotent: false,
                eventId: "event-1",
                requestId: "request-1",
                reprocessCount: 1,
                status: "processed",
                outcome: "processed",
                errorCode: null
              }
            };
          }
        };
      }
    }
  );

  assert.strictEqual(actionResult.ok, true);
  assert.ok(actionUrl.endsWith("/reprocessarWebhookOperacionalV12"));
  assert.deepStrictEqual(JSON.parse(actionOptions.body), {
    data: { eventId: "event-1", requestId: "request-1" }
  });

  for (const role of ["super_admin", "finance_admin"]) {
    assert.ok(ROLE_CAPABILITIES[role].includes("console.webhooks.reprocess"));
  }

  for (const role of ["platform_admin", "support_admin", "content_admin"]) {
    assert.strictEqual(
      ROLE_CAPABILITIES[role].includes("console.webhooks.reprocess"),
      false
    );
  }

  assert.deepStrictEqual(
    registryApi.getRouteDefinition("webhooks").actions,
    []
  );

  assert.deepStrictEqual(
    registryApi.webhooksAuditIntegratedRegistry()
      .getRouteDefinition("webhooks").actions,
    []
  );

  const actionRegistry =
    overlayApi.webhookReprocessIntegratedRegistry(
      registryApi
    );

  assert.strictEqual(actionRegistry.integratedRoutes().length, 11);

  const webhookContract = actionRegistry.getRouteDefinition("webhooks");
  assert.strictEqual(webhookContract.actions.length, 1);

  assert.deepStrictEqual(webhookContract.actions[0], {
    actionId: "reprocess",
    capability: "console.webhooks.reprocess",
    functionName: "reprocessarWebhookOperacionalV12",
    payloadFields: ["eventId", "requestId"],
    requiredFields: ["eventId", "requestId"],
    identifierFields: ["eventId", "requestId"],
    confirmationRequired: true,
    refreshMode: "detail",
    refreshIdField: "eventId"
  });

  const context = {
    capabilities: [
      "console.webhooks.read",
      "console.webhooks.reprocess"
    ]
  };

  const calls = [];
  let actionImplementation = async (_functionName, payload) => ({
    ok: true,
    accepted: true,
    idempotent: false,
    eventId: payload.eventId,
    requestId: payload.requestId,
    reprocessCount: 1,
    status: "processed",
    outcome: "processed",
    errorCode: null
  });

  const runtime = runtimeApi.createRouteRuntime({
    registry: actionRegistry,
    navigationApi: {
      canNavigateTo(receivedContext, routeId) {
        return receivedContext === context &&
          (routeId === "webhooks" || routeId === "audit");
      }
    },
    routeApi: {
      async callRouteAuthenticated(functionName, payload, options) {
        calls.push({ kind: "read", functionName, payload, options });

        if (functionName === "listarWebhooksOperacionaisV12") {
          return {
            ok: true,
            items: [{ eventId: "event-1", status: "error" }],
            nextCursor: null
          };
        }

        if (functionName === "obterWebhookOperacionalV12") {
          return {
            ok: true,
            webhook: {
              eventId: payload.eventId,
              status: "processed"
            }
          };
        }

        throw new Error(`Unexpected read ${functionName}`);
      },

      async callActionAuthenticated(functionName, payload, options) {
        calls.push({ kind: "action", functionName, payload, options });
        return actionImplementation(functionName, payload, options);
      }
    }
  });

  runtime.setSession({
    context,
    idToken: "session-token",
    hostname: "localhost"
  });

  await runtime.activate("webhooks");

  assert.strictEqual(runtime.canExecuteAction("webhooks", "reprocess"), true);
  assert.strictEqual(runtime.canExecuteAction("audit", "reprocess"), false);

  const callsBeforeConfirmation = calls.length;

  const confirmationRequired = await runtime.executeAction(
    "webhooks",
    "reprocess",
    { eventId: "event-1", requestId: "request-1" }
  );

  assert.strictEqual(
    confirmationRequired.status,
    "action-confirmation-required"
  );
  assert.strictEqual(calls.length, callsBeforeConfirmation);

  const invalid = await runtime.executeAction(
    "webhooks",
    "reprocess",
    {
      eventId: "event-1",
      requestId: "request-1",
      role: "super_admin"
    },
    { confirmed: true }
  );

  assert.strictEqual(invalid.status, "action-invalid");
  assert.strictEqual(
    invalid.errorCode,
    "ROUTE_ACTION_PAYLOAD_NOT_ALLOWED"
  );
  assert.strictEqual(calls.length, callsBeforeConfirmation);

  const success = await runtime.executeAction(
    "webhooks",
    "reprocess",
    { eventId: "event-1", requestId: "request-1" },
    { confirmed: true }
  );

  assert.strictEqual(success.status, "action-succeeded");
  assert.strictEqual(success.result.ok, true);

  const actionCall = calls.find(item => item.kind === "action");

  assert.deepStrictEqual(
    {
      functionName: actionCall.functionName,
      payload: actionCall.payload,
      token: actionCall.options.idToken
    },
    {
      functionName: "reprocessarWebhookOperacionalV12",
      payload: { eventId: "event-1", requestId: "request-1" },
      token: "session-token"
    }
  );

  assert.strictEqual(
    calls.at(-1).functionName,
    "obterWebhookOperacionalV12"
  );
  assert.deepStrictEqual(calls.at(-1).payload, { eventId: "event-1" });
  assert.strictEqual(runtime.getState().mode, "detail");

  const duplicate = deferred();
  actionImplementation = async () => duplicate.promise;

  const firstAction = runtime.executeAction(
    "webhooks",
    "reprocess",
    { eventId: "event-1", requestId: "request-2" },
    { confirmed: true }
  );

  await Promise.resolve();

  const actionCallsBeforeBusy =
    calls.filter(item => item.kind === "action").length;

  const busy = await runtime.executeAction(
    "webhooks",
    "reprocess",
    { eventId: "event-1", requestId: "request-3" },
    { confirmed: true }
  );

  assert.strictEqual(busy.status, "action-busy");
  assert.strictEqual(
    calls.filter(item => item.kind === "action").length,
    actionCallsBeforeBusy
  );

  duplicate.resolve({
    ok: true,
    accepted: false,
    idempotent: true,
    eventId: "event-1",
    requestId: "request-2",
    reprocessCount: 1,
    status: "processed",
    outcome: "idempotent"
  });

  await firstAction;

  const unauthorizedContext = {
    capabilities: ["console.webhooks.read"]
  };

  const unauthorizedCalls = [];

  const unauthorizedRuntime = runtimeApi.createRouteRuntime({
    registry: actionRegistry,
    navigationApi: {
      canNavigateTo(receivedContext, routeId) {
        return receivedContext === unauthorizedContext &&
          routeId === "webhooks";
      }
    },
    routeApi: {
      async callRouteAuthenticated() {
        return { items: [], nextCursor: null };
      },
      async callActionAuthenticated(...args) {
        unauthorizedCalls.push(args);
        return { ok: true };
      }
    }
  });

  unauthorizedRuntime.setSession({
    context: unauthorizedContext,
    idToken: "token",
    hostname: "localhost"
  });

  assert.strictEqual(
    unauthorizedRuntime.canExecuteAction("webhooks", "reprocess"),
    false
  );

  const denied = await unauthorizedRuntime.executeAction(
    "webhooks",
    "reprocess",
    { eventId: "event-1", requestId: "request-x" },
    { confirmed: true }
  );

  assert.strictEqual(denied.status, "action-denied");
  assert.strictEqual(unauthorizedCalls.length, 0);

  const staleDeferred = deferred();

  const staleRuntime = runtimeApi.createRouteRuntime({
    registry: actionRegistry,
    navigationApi: {
      canNavigateTo(_context, routeId) {
        return routeId === "webhooks";
      }
    },
    routeApi: {
      async callRouteAuthenticated() {
        return {
          ok: true,
          webhook: {
            eventId: "event-1",
            status: "processed"
          }
        };
      },
      async callActionAuthenticated() {
        return staleDeferred.promise;
      }
    }
  });

  staleRuntime.setSession({
    context,
    idToken: "token",
    hostname: "localhost"
  });

  const stalePending = staleRuntime.executeAction(
    "webhooks",
    "reprocess",
    { eventId: "event-1", requestId: "request-stale" },
    { confirmed: true }
  );

  staleRuntime.clearSession();

  staleDeferred.resolve({
    ok: true,
    accepted: true,
    eventId: "event-1",
    requestId: "request-stale",
    status: "processed"
  });

  const staleResult = await stalePending;
  assert.strictEqual(staleResult.status, "stale");
  assert.strictEqual(staleRuntime.getState(), null);

  const generated = rendererApi.createReprocessRequestId({
    randomUUID() {
      return "uuid-123";
    }
  });

  assert.strictEqual(generated, "webhook-reprocess-uuid-123");

  const rendererCalls = [];

  const rendererRuntime = {
    getListState() { return null; },
    applyFilters() { return Promise.resolve({ state: "route-ready" }); },
    loadNextPage() { return Promise.resolve({ state: "route-ready" }); },
    loadDetail() { return Promise.resolve({ state: "route-ready" }); },
    restoreList() { return { state: "route-ready" }; },
    canExecuteAction(routeId, actionId) {
      return routeId === "webhooks" && actionId === "reprocess";
    },
    async executeAction(routeId, actionId, payload, options) {
      rendererCalls.push({ routeId, actionId, payload, options });
      return { status: "action-succeeded" };
    }
  };

  const document = documentStub();

  const renderer = rendererApi.createWebhooksAuditRenderer({
    document,
    routeRuntime: rendererRuntime,
    requestIdFactory: () => "request-renderer-1"
  });

  const detailContainer = element();

  renderer.render(detailContainer, {
    state: "route-ready",
    routeId: "webhooks",
    mode: "detail",
    data: {
      webhook: {
        eventId: "event-1",
        provider: "asaas",
        providerEventRef: "***masked",
        eventType: "PAYMENT_RECEIVED",
        status: "error",
        relatedOrderId: "order-1",
        deliveryCount: 1,
        processing: {
          action: "confirm_payment",
          result: "error",
          errorCode: "PROVIDER_PAYMENT_UNAVAILABLE"
        },
        timestamps: {
          receivedAt: "received",
          lastReceivedAt: "last",
          processedAt: "processed"
        }
      }
    }
  });

  const firstText = textTree(detailContainer);
  assert.ok(firstText.includes("Reprocessar webhook"));
  assert.strictEqual(firstText.includes("Confirmar reprocessamento"), false);

  const actionButton = walk(
    detailContainer,
    node =>
      node?.tagName === "BUTTON" &&
      node.textContent === "Reprocessar webhook"
  )[0];

  assert.ok(actionButton);
  actionButton.listeners.click();
  assert.strictEqual(rendererCalls.length, 0);

  const confirmationText = textTree(detailContainer);
  assert.ok(confirmationText.includes("Confirmar reprocessamento"));
  assert.ok(confirmationText.includes("reexecuta o processamento"));

  const confirmButton = walk(
    detailContainer,
    node =>
      node?.tagName === "BUTTON" &&
      node.textContent === "Confirmar reprocessamento"
  )[0];

  assert.ok(confirmButton);
  confirmButton.listeners.click();
  await flush();

  assert.deepStrictEqual(rendererCalls, [
    {
      routeId: "webhooks",
      actionId: "reprocess",
      payload: {
        eventId: "event-1",
        requestId: "request-renderer-1"
      },
      options: { confirmed: true }
    }
  ]);

  const readOnlyRuntime = {
    ...rendererRuntime,
    canExecuteAction() {
      return false;
    }
  };

  const readOnlyRenderer = rendererApi.createWebhooksAuditRenderer({
    document,
    routeRuntime: readOnlyRuntime,
    requestIdFactory: () => "request-readonly"
  });

  const readOnlyContainer = element();

  readOnlyRenderer.render(readOnlyContainer, {
    state: "route-ready",
    routeId: "webhooks",
    mode: "detail",
    data: {
      webhook: {
        eventId: "event-1",
        status: "error",
        processing: {},
        timestamps: {}
      }
    }
  });

  assert.strictEqual(
    textTree(readOnlyContainer).includes("Reprocessar webhook"),
    false
  );

  const terminalContainer = element();

  renderer.render(terminalContainer, {
    state: "route-ready",
    routeId: "webhooks",
    mode: "detail",
    data: {
      webhook: {
        eventId: "event-1",
        status: "processed",
        processing: {},
        timestamps: {}
      }
    }
  });

  assert.strictEqual(
    textTree(terminalContainer).includes("Reprocessar webhook"),
    false
  );

  const apiSource = source("js/admin-shell-route-api-v1_2.js");
  const registrySource = source("js/admin-shell-route-registry-v1_2.js");
  const overlaySource = source("js/admin-shell-webhook-reprocess-overlay-v1_2.js");
  const runtimeSource = source("js/admin-shell-route-runtime-v1_2.js");
  const rendererSource = source("js/admin-shell-webhooks-audit-renderer-v1_2.js");
  const html = source("admin_shell_v1_2.html");

  assert.ok(html.includes("webhookReprocessIntegratedRegistry"));
  assert.ok(html.includes("webhooksAuditIntegratedRegistry"));
  assert.strictEqual(
    rendererSource.includes("reprocessarWebhookOperacionalV12"),
    false
  );
  assert.strictEqual(
    registrySource.includes("reprocessarWebhookOperacionalV12"),
    false
  );
  assert.strictEqual(
    registrySource.includes("console.webhooks.reprocess"),
    false
  );
  assert.ok(overlaySource.includes("console.webhooks.reprocess"));
  assert.ok(overlaySource.includes("reprocessarWebhookOperacionalV12"));
  assert.ok(apiSource.includes("ROUTE_ACTION_FUNCTIONS"));
  assert.ok(runtimeSource.includes("confirmationRequired"));

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
    for (const clientSource of [
      apiSource,
      registrySource,
      overlaySource,
      runtimeSource,
      rendererSource,
      html
    ]) {
      assert.strictEqual(clientSource.includes(forbidden), false);
    }
  }

  console.log("MARCO8_7E3_ACTION_ALLOWLIST=1/1");
  console.log("MARCO8_7E3_READ_ALLOWLIST_PRESERVED=6/6");
  console.log("MARCO8_7E3_BASE_ACTIONS=0");
  console.log("MARCO8_7E3_FROZEN_REGISTRY_PRESERVED=PASSED");
  console.log("MARCO8_7E3_READONLY_OVERLAY_ACTIONS=0");
  console.log("MARCO8_7E3_REPROCESS_OVERLAY=11/14");
  console.log("MARCO8_7E3_ACTION_CONTRACT=PASSED");
  console.log("MARCO8_7E3_MUTATION_CAPABILITY=console.webhooks.reprocess");
  console.log("MARCO8_7E3_MUTATION_ROLES=2/2");
  console.log("MARCO8_7E3_CONFIRMATION_REQUIRED=PASSED");
  console.log("MARCO8_7E3_PAYLOAD_FIELDS=2/2");
  console.log("MARCO8_7E3_DUPLICATE_ACTION=BLOCKED");
  console.log("MARCO8_7E3_REQUEST_ID=IDEMPOTENT");
  console.log("MARCO8_7E3_BACKEND_SUCCESS_REQUIRED=PASSED");
  console.log("MARCO8_7E3_DETAIL_REFRESH_AFTER_ACTION=PASSED");
  console.log("MARCO8_7E3_SESSION_STALE_RESPONSE=BLOCKED");
  console.log("MARCO8_7E3_READONLY_USER_AFFORDANCE=BLOCKED");
  console.log("MARCO8_7E3_TERMINAL_WEBHOOK_ACTION=BLOCKED");
  console.log("MARCO8_7E3_EXPLICIT_TWO_STEP_CONFIRMATION=PASSED");
  console.log("MARCO8_7E3_SAFE_DOM=PASSED");
  console.log("MARCO8_7E3_DIRECT_FIRESTORE=FORBIDDEN");
  console.log("MARCO8_7E3_WEBHOOK_REPROCESS_FRONTEND_ACTION=PASSED");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
