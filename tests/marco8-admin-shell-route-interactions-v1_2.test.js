"use strict";

const assert = require("assert");

const {
  sanitizeListPayload,
  sanitizeFilterPayload,
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
  const contract = {
    routeId: "people",
    integrated: true,
    readFunction:
      "listarPessoasOperacionaisV12",
    detailFunction:
      "obterPessoaOperacionalV12",
    detailIdField:
      "personId",
    listKey: "items",
    filters: [
      "profileType",
      "operationalStatus"
    ]
  };

  assert.deepStrictEqual(
    sanitizeListPayload(
      contract,
      {
        limit: 20,
        cursor:
          "opaque.cursor.value",
        profileType:
          "student",
        operationalStatus:
          "active"
      }
    ),
    {
      limit: 20,
      cursor:
        "opaque.cursor.value",
      profileType:
        "student",
      operationalStatus:
        "active"
    }
  );

  assert.throws(
    () =>
      sanitizeListPayload(
        contract,
        {
          collection:
            "usuarios"
        }
      ),
    error =>
      error?.code ===
        "ROUTE_FILTER_NOT_ALLOWED"
  );

  assert.deepStrictEqual(
    sanitizeFilterPayload(
      contract,
      {
        profileType:
          "student"
      }
    ),
    {
      profileType:
        "student"
    }
  );

  assert.throws(
    () =>
      sanitizeFilterPayload(
        contract,
        {
          cursor:
            "not-a-filter"
        }
      ),
    error =>
      error?.code ===
        "ROUTE_FILTER_NOT_ALLOWED"
  );

  const registry = {
    getRouteDefinition(
      route
    ) {
      return route ===
        "people"
        ? contract
        : null;
    }
  };

  const context = {
    userId:
      "admin-1"
  };

  const navigationApi = {
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
    }
  };

  const calls = [];
  let implementation =
    async (
      functionName,
      payload
    ) => {
      if (
        functionName ===
        "listarPessoasOperacionaisV12"
      ) {
        return {
          ok: true,
          items: [
            {
              personId: "person-1"
            }
          ],
          nextCursor:
            "cursor-1"
        };
      }

      return {
        ok: true,
        person: {
          personId:
            payload.personId
        }
      };
    };

  const states = [];

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
      "route-token",
    hostname:
      "localhost"
  });

  const initial =
    await runtime.activate(
      "people",
      {
        payload: {
          limit: 20,
          profileType:
            "student"
        }
      }
    );

  assert.strictEqual(
    initial.state,
    "route-ready"
  );

  assert.strictEqual(
    initial.mode,
    "list"
  );

  assert.strictEqual(
    calls.at(-1)
      .payload
      .profileType,
    "student"
  );

  assert.strictEqual(
    calls.at(-1)
      .payload
      .limit,
    20
  );

  const firstListState =
    runtime.getListState(
      "people"
    );

  assert.strictEqual(
    firstListState
      .data
      .nextCursor,
    "cursor-1"
  );

  implementation =
    async (
      functionName,
      payload
    ) => {
      assert.strictEqual(
        functionName,
        "listarPessoasOperacionaisV12"
      );

      assert.strictEqual(
        payload.cursor,
        "cursor-1"
      );

      return {
        ok: true,
        items: [
          {
            personId:
              "person-2"
          }
        ],
        nextCursor:
          "opaque-next-2"
      };
    };

  const nextPage =
    await runtime
      .loadNextPage(
        "people"
      );

  assert.strictEqual(
    nextPage.state,
    "route-ready"
  );

  assert.deepStrictEqual(
    nextPage
      .data
      .items
      .map(
        item =>
          item.personId
      ),
    [
      "person-1",
      "person-2"
    ]
  );

  assert.strictEqual(
    calls.at(-1)
      .payload
      .cursor,
    "cursor-1"
  );

  assert.strictEqual(
    calls.at(-1)
      .payload
      .profileType,
    "student"
  );

  implementation =
    async (
      functionName,
      payload
    ) => {
      assert.strictEqual(
        functionName,
        "listarPessoasOperacionaisV12"
      );

      assert.strictEqual(
        Object.prototype
          .hasOwnProperty.call(
            payload,
            "cursor"
          ),
        false
      );

      assert.strictEqual(
        Object.prototype
          .hasOwnProperty.call(
            payload,
            "profileType"
          ),
        false
      );

      assert.strictEqual(
        payload.operationalStatus,
        "active"
      );

      assert.strictEqual(
        payload.limit,
        20
      );

      return {
        ok: true,
        items: [
          {
            personId:
              "person-active"
          }
        ],
        nextCursor:
          null
      };
    };

  const filtered =
    await runtime.applyFilters(
      "people",
      {
        operationalStatus:
          "active"
      }
    );

  assert.strictEqual(
    filtered.state,
    "route-ready"
  );

  assert.deepStrictEqual(
    filtered
      .data
      .items
      .map(
        item =>
          item.personId
      ),
    [
      "person-active"
    ]
  );

  const callsBeforeUnsupported =
    calls.length;

  const unsupported =
    await runtime.applyFilters(
      "people",
      {
        collection:
          "usuarios"
      }
    );

  assert.strictEqual(
    unsupported.state,
    "route-error"
  );

  assert.strictEqual(
    unsupported.errorCode,
    "ROUTE_FILTER_NOT_ALLOWED"
  );

  assert.strictEqual(
    calls.length,
    callsBeforeUnsupported
  );

  implementation =
    async (
      functionName,
      payload
    ) => {
      assert.strictEqual(
        functionName,
        "obterPessoaOperacionalV12"
      );

      assert.deepStrictEqual(
        payload,
        {
          personId:
            "person-active"
        }
      );

      return {
        ok: true,
        person: {
          personId:
            "person-active",
          displayName:
            "Pessoa"
        }
      };
    };

  const detail =
    await runtime.loadDetail(
      "people",
      "person-active"
    );

  assert.strictEqual(
    detail.state,
    "route-ready"
  );

  assert.strictEqual(
    detail.mode,
    "detail"
  );

  assert.strictEqual(
    detail
      .data
      .person
      .personId,
    "person-active"
  );

  const restored =
    runtime.restoreList(
      "people"
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
    restored
      .data
      .items[0]
      .personId,
    "person-active"
  );

  const pending =
    deferred();

  let pageCallCount = 0;

  runtime.getListState(
    "people"
  ).data.nextCursor =
    "busy-cursor";

  implementation =
    async () => {
      pageCallCount += 1;
      return pending.promise;
    };

  const firstPage =
    runtime.loadNextPage(
      "people"
    );

  const duplicatePage =
    await runtime.loadNextPage(
      "people"
    );

  assert.strictEqual(
    duplicatePage.status,
    "pagination-busy"
  );

  assert.strictEqual(
    pageCallCount,
    1
  );

  pending.resolve({
    ok: true,
    items: [],
    nextCursor:
      null
  });

  await firstPage;

  const staleDetail =
    deferred();

  implementation =
    async function (
      functionName
    ) {
      if (
        functionName ===
        "obterPessoaOperacionalV12"
      ) {
        return staleDetail.promise;
      }

      return {
        ok: true,
        items: [
          {
            personId:
              "fresh"
          }
        ],
        nextCursor:
          null
      };
    };

  const detailActivation =
    runtime.loadDetail(
      "people",
      "person-active"
    );

  const listActivation =
    runtime.applyFilters(
      "people",
      {}
    );

  const listResult =
    await listActivation;

  assert.strictEqual(
    listResult.state,
    "route-ready"
  );

  staleDetail.resolve({
    ok: true,
    person: {
      personId:
        "stale"
    }
  });

  const staleResult =
    await detailActivation;

  assert.strictEqual(
    staleResult.status,
    "stale"
  );

  assert.strictEqual(
    runtime
      .getState()
      .mode,
    "list"
  );

  runtime.clearSession();

  assert.strictEqual(
    runtime.getListState(
      "people"
    ),
    null
  );

  console.log(
    "MARCO8_7C2_FILTER_ALLOWLIST=PASSED"
  );

  console.log(
    "MARCO8_7C2_FILTER_CHANGE_RESETS_CURSOR=PASSED"
  );

  console.log(
    "MARCO8_7C2_OPAQUE_CURSOR_FORWARDING=PASSED"
  );

  console.log(
    "MARCO8_7C2_NEXT_PAGE_APPEND=PASSED"
  );

  console.log(
    "MARCO8_7C2_DUPLICATE_PAGINATION=BLOCKED"
  );

  console.log(
    "MARCO8_7C2_DETAIL_CALLABLE_EXACT=PASSED"
  );

  console.log(
    "MARCO8_7C2_DETAIL_IDENTIFIER_FIELD_EXACT=PASSED"
  );

  console.log(
    "MARCO8_7C2_RESTORE_LIST_WITHOUT_CALL=PASSED"
  );

  console.log(
    "MARCO8_7C2_DETAIL_STALE_RESPONSE=BLOCKED"
  );

  console.log(
    "MARCO8_7C2_SESSION_CLEAR_DROPS_LIST_CACHE=PASSED"
  );

  console.log(
    "MARCO8_7C2_ROUTE_INTERACTION_RUNTIME=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
