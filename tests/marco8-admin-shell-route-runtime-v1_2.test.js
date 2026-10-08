"use strict";

const assert = require("assert");

const {
  ROUTE_STATES,
  createRouteRuntime
} = require(
  "../js/admin-shell-route-runtime-v1_2"
);

function deferred() {
  let resolve;
  let reject;

  const promise =
    new Promise(
      (resolveFn, rejectFn) => {
        resolve = resolveFn;
        reject = rejectFn;
      }
    );

  return {
    promise,
    resolve,
    reject
  };
}

async function main() {
  assert.deepStrictEqual(
    ROUTE_STATES,
    {
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
    }
  );

  const definitions =
    new Map([
      [
        "alpha",
        {
          routeId: "alpha",
          integrated: true,
          readFunction:
            "fakeRead",
          listKey:
            "items"
        }
      ],

      [
        "beta",
        {
          routeId: "beta",
          integrated: false,
          readFunction: null,
          listKey: null
        }
      ]
    ]);

  const registry = {
    getRouteDefinition(
      route
    ) {
      return (
        definitions.get(
          route
        ) ||
        null
      );
    }
  };

  const context = {
    capabilities: [
      "alpha.read",
      "beta.read"
    ]
  };

  const navigationApi = {
    canNavigateTo(
      receivedContext,
      route
    ) {
      assert.strictEqual(
        receivedContext,
        context
      );

      return (
        route === "alpha" ||
        route === "beta"
      );
    }
  };

  const calls = [];
  let implementation =
    async () => ({
      items: [
        {
          id: "a"
        }
      ]
    });

  const routeApi = {
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

      return implementation(
        functionName,
        payload,
        options
      );
    }
  };

  const states = [];

  const runtime =
    createRouteRuntime({
      registry,
      navigationApi,
      routeApi,
      onStateChange(
        state
      ) {
        states.push(
          state
        );
      }
    });

  runtime.setSession({
    context,
    idToken:
      "session-token",
    hostname:
      "localhost"
  });

  const beta =
    await runtime.activate(
      "beta"
    );

  assert.strictEqual(
    beta.state,
    "route-not-integrated"
  );

  assert.strictEqual(
    calls.length,
    0
  );

  const ready =
    await runtime.activate(
      "alpha",
      {
        payload: {
          limit: 10
        }
      }
    );

  assert.strictEqual(
    states.at(-2).state,
    "route-loading"
  );

  assert.strictEqual(
    ready.state,
    "route-ready"
  );

  assert.strictEqual(
    calls.at(-1)
      .options
      .idToken,
    "session-token"
  );

  implementation =
    async () => ({
      items: []
    });

  const empty =
    await runtime.activate(
      "alpha"
    );

  assert.strictEqual(
    empty.state,
    "route-empty"
  );

  implementation =
    async () => {
      const error =
        new Error(
          "private message"
        );

      error.code =
        "ADMIN_ROUTE_CALL_FAILED";

      throw error;
    };

  const failed =
    await runtime.activate(
      "alpha"
    );

  assert.strictEqual(
    failed.state,
    "route-error"
  );

  assert.strictEqual(
    failed.errorCode,
    "ADMIN_ROUTE_CALL_FAILED"
  );

  const callsBeforeDenied =
    calls.length;

  const denied =
    await runtime.activate(
      "gamma"
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
    calls.length,
    callsBeforeDenied
  );

  const first =
    deferred();

  const second =
    deferred();

  let callNumber = 0;

  implementation =
    async () => {
      callNumber += 1;

      return callNumber === 1
        ? first.promise
        : second.promise;
    };

  const firstActivation =
    runtime.activate(
      "alpha"
    );

  const secondActivation =
    runtime.activate(
      "alpha"
    );

  second.resolve({
    items: [
      {
        id: "new"
      }
    ]
  });

  const secondResult =
    await secondActivation;

  assert.strictEqual(
    secondResult.state,
    "route-ready"
  );

  assert.strictEqual(
    secondResult.data.items[0].id,
    "new"
  );

  first.resolve({
    items: [
      {
        id: "old"
      }
    ]
  });

  const firstResult =
    await firstActivation;

  assert.strictEqual(
    firstResult.status,
    "stale"
  );

  assert.strictEqual(
    runtime
      .getState()
      .data
      .items[0]
      .id,
    "new"
  );

  const pending =
    deferred();

  implementation =
    async () =>
      pending.promise;

  const pendingActivation =
    runtime.activate(
      "alpha"
    );

  runtime.clearSession();

  pending.resolve({
    items: [
      {
        id: "old-session"
      }
    ]
  });

  const staleSession =
    await pendingActivation;

  assert.strictEqual(
    staleSession.status,
    "stale"
  );

  assert.strictEqual(
    runtime.getState(),
    null
  );

  console.log(
    "MARCO8_7B1_ROUTE_STATES=5/5"
  );

  console.log(
    "MARCO8_7B1_NOT_INTEGRATED_NO_CALL=PASSED"
  );

  console.log(
    "MARCO8_7B1_ROUTE_READY=PASSED"
  );

  console.log(
    "MARCO8_7B1_ROUTE_EMPTY=PASSED"
  );

  console.log(
    "MARCO8_7B1_ROUTE_ERROR=SANITIZED"
  );

  console.log(
    "MARCO8_7B1_UNAUTHORIZED_LOADER=BLOCKED"
  );

  console.log(
    "MARCO8_7B1_LATEST_REQUEST_WINS=PASSED"
  );

  console.log(
    "MARCO8_7B1_SESSION_CHANGE_INVALIDATES_REQUEST=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
