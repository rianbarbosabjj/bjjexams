"use strict";

const assert = require("node:assert/strict");
const entryApi = require("../js/admin-financial-ops-entry-v1_2.js");

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}

function fakeDocument(hasHost = true, active = false) {
  const financeHost = hasHost
    ? {
        classList: {
          contains(value) {
            return active && value === "active";
          }
        }
      }
    : null;

  return {
    getElementById(id) {
      return id === "financeiro" ? financeHost : null;
    }
  };
}

function fakeDependencies(overrides = {}) {
  const calls = {
    originalTabs: [],
    createBootstrap: 0,
    mounts: 0
  };

  const root = {
    document: fakeDocument(true, false),
    location: { hostname: "bjj-exams-staging.web.app" },
    Swal: { fire: async () => ({ isConfirmed: true }) },
    console: { error() {} },
    mudarAba(evt, tabName) {
      calls.originalTabs.push(tabName);
      return `original:${tabName}`;
    }
  };

  const purchaseApi = {
    listAdminOperations: async () => ({ items: [] })
  };
  const opsUi = {
    createController() {
      return {};
    }
  };
  const bootstrapApi = {
    createBootstrap(options) {
      calls.createBootstrap += 1;
      assert.equal(options.hostname, "bjj-exams-staging.web.app");
      assert.ok(options.auth);
      return {
        async mount() {
          calls.mounts += 1;
          return { mounted: true, role: "platform_admin", items: [] };
        }
      };
    }
  };

  return {
    calls,
    root,
    document: root.document,
    purchaseApi,
    opsUi,
    bootstrapApi,
    auth: { currentUser: { uid: "admin-test" } },
    Swal: root.Swal,
    ...overrides
  };
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function main() {
  await test("host financeiro ausente nao instala entry", async () => {
    const deps = fakeDependencies({ document: fakeDocument(false) });
    const entry = entryApi.createEntry(deps);
    assert.equal(entry.installed, false);
    assert.equal(entry.reason, "FINANCE_HOST_MISSING");
  });

  await test("entry valida dependencias publicas", async () => {
    const deps = fakeDependencies({ purchaseApi: null });
    assert.throws(
      () => entryApi.createEntry(deps),
      /course-purchase-api válido/
    );
  });

  await test("install preserva handler administrativo original", async () => {
    const deps = fakeDependencies();
    const entry = entryApi.createEntry(deps);
    const result = entry.install();
    assert.equal(result.installed, true);
    assert.equal(result.reused, false);

    const returnValue = deps.root.mudarAba({}, "usuarios");
    assert.equal(returnValue, "original:usuarios");
    assert.deepEqual(deps.calls.originalTabs, ["usuarios"]);
    await flush();
    assert.equal(deps.calls.mounts, 0);
  });

  await test("abrir aba financeiro monta console uma vez por clique", async () => {
    const deps = fakeDependencies();
    const entry = entryApi.createEntry(deps);
    entry.install();
    const returnValue = deps.root.mudarAba({}, "financeiro");
    assert.equal(returnValue, "original:financeiro");
    await flush();
    await flush();
    assert.equal(deps.calls.createBootstrap, 1);
    assert.equal(deps.calls.mounts, 1);
  });

  await test("install repetido nao empilha wrappers", async () => {
    const deps = fakeDependencies();
    const entry = entryApi.createEntry(deps);
    entry.install();
    const second = entry.install();
    assert.equal(second.reused, true);
    deps.root.mudarAba({}, "financeiro");
    await flush();
    await flush();
    assert.deepEqual(deps.calls.originalTabs, ["financeiro"]);
    assert.equal(deps.calls.mounts, 1);
  });

  await test("aba financeiro ja ativa monta no install", async () => {
    const deps = fakeDependencies({ document: fakeDocument(true, true) });
    const entry = entryApi.createEntry(deps);
    entry.install();
    await flush();
    await flush();
    assert.equal(deps.calls.mounts, 1);
  });

  await test("resolveFirebaseAuth reutiliza app existente", async () => {
    const app = { name: "[DEFAULT]" };
    const auth = { currentUser: null };
    const modules = new Map([
      [entryApi.FIREBASE_APP_URL, {
        getApps: () => [app],
        getApp: () => app
      }],
      [entryApi.FIREBASE_AUTH_URL, {
        getAuth: received => {
          assert.equal(received, app);
          return auth;
        }
      }]
    ]);

    const resolved = await entryApi.resolveFirebaseAuth({
      importModule: async url => modules.get(url)
    });
    assert.equal(resolved, auth);
  });

  await test("resolveFirebaseAuth falha antes de inicializacao Firebase", async () => {
    const modules = new Map([
      [entryApi.FIREBASE_APP_URL, {
        getApps: () => [],
        getApp: () => null
      }],
      [entryApi.FIREBASE_AUTH_URL, { getAuth: () => ({}) }]
    ]);

    await assert.rejects(
      () => entryApi.resolveFirebaseAuth({
        importModule: async url => modules.get(url)
      }),
      /ainda não foi inicializado/
    );
  });

  console.log(`ADMIN_FINANCIAL_OPS_ENTRY_V1_2=${passed}/8`);
  if (passed !== 8) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
