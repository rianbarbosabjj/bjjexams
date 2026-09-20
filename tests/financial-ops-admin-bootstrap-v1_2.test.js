"use strict";

const assert = require("node:assert/strict");
const {
  FINANCIAL_ROLES,
  financialRole,
  actionCopy,
  createSwalAdapters,
  createBootstrap
} = require("../js/financial-ops-admin-bootstrap-v1_2.js");

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

function documentStub() {
  return {
    getElementById() {
      return null;
    }
  };
}

function purchaseApiStub(environment = "staging") {
  return {
    listAdminOperations: async () => ({ items: [] }),
    inferEnvironment: () => environment,
    assertEnvironmentSafe(value) {
      if (value === "production") {
        throw new Error("Produção bloqueada no Marco 5.6.");
      }
      return value;
    }
  };
}

function authStub({ uid = "admin-1", claims = {} } = {}) {
  return {
    currentUser: {
      uid,
      async getIdToken() {
        return "token-test";
      },
      async getIdTokenResult() {
        return { claims };
      }
    }
  };
}

function opsUiStub(log = {}) {
  return {
    createController(options) {
      log.options = options;
      log.created = (log.created || 0) + 1;
      return {
        async mount() {
          log.mounted = (log.mounted || 0) + 1;
          return [{ orderId: "sanitized-order" }];
        },
        async load() {
          log.loaded = (log.loaded || 0) + 1;
          return [{ orderId: "sanitized-order" }];
        }
      };
    }
  };
}

function swalStub(sequence = []) {
  const calls = [];
  return {
    calls,
    async fire(options) {
      calls.push(options);
      return sequence.length
        ? sequence.shift()
        : { isConfirmed: true, value: "Motivo operacional válido" };
    }
  };
}

(async () => {
  await test("roles financeiros ficam limitados ao contrato canonico", () => {
    assert.deepEqual(FINANCIAL_ROLES, ["super_admin", "platform_admin"]);
    assert.equal(financialRole({ super_admin: true }), "super_admin");
    assert.equal(financialRole({ platform_admin: true }), "platform_admin");
    assert.equal(financialRole({ content_admin: true }), null);
  });

  await test("super_admin tem precedencia quando claims possuem dois papeis", () => {
    assert.equal(
      financialRole({ super_admin: true, platform_admin: true }),
      "super_admin"
    );
  });

  await test("copy destrutiva distingue cancelamento e estorno", () => {
    assert.match(actionCopy({ action: "cancel_pending" }).title, /Cancelar/i);
    assert.match(actionCopy({ action: "refund_full" }).title, /estorno/i);
  });

  await test("SweetAlert exige confirmacao explicita", async () => {
    const Swal = swalStub([{ isConfirmed: false }]);
    const adapters = createSwalAdapters(Swal);
    assert.equal(await adapters.confirmAction({ action: "refund_full" }), false);
    assert.equal(Swal.calls.length, 1);
    assert.equal(Swal.calls[0].showCancelButton, true);
  });

  await test("SweetAlert coleta justificativa sem mutar estado financeiro", async () => {
    const Swal = swalStub([{ isConfirmed: true, value: "Solicitação do suporte" }]);
    const adapters = createSwalAdapters(Swal);
    assert.equal(
      await adapters.requestReason("cancel_pending", { orderId: "order-1" }),
      "Solicitação do suporte"
    );
    assert.equal(Swal.calls[0].input, "textarea");
  });

  await test("bootstrap nao monta console para usuario sem claim financeiro", async () => {
    const log = {};
    const bootstrap = createBootstrap({
      purchaseApi: purchaseApiStub(),
      opsUi: opsUiStub(log),
      auth: authStub({ claims: { content_admin: true } }),
      document: documentStub(),
      Swal: swalStub(),
      hostname: "bjj-exams-staging.web.app"
    });
    const result = await bootstrap.mount();
    assert.equal(result.mounted, false);
    assert.equal(result.role, null);
    assert.equal(log.created || 0, 0);
  });

  await test("platform_admin monta controller com token autenticado", async () => {
    const log = {};
    const bootstrap = createBootstrap({
      purchaseApi: purchaseApiStub(),
      opsUi: opsUiStub(log),
      auth: authStub({ claims: { platform_admin: true } }),
      document: documentStub(),
      Swal: swalStub(),
      hostname: "bjj-exams-staging.web.app"
    });
    const result = await bootstrap.mount();
    assert.equal(result.mounted, true);
    assert.equal(result.role, "platform_admin");
    assert.equal(log.created, 1);
    assert.equal(log.mounted, 1);
    assert.equal(await log.options.getIdToken(), "token-test");
  });

  await test("bootstrap reutiliza controller para o mesmo ator", async () => {
    const log = {};
    const bootstrap = createBootstrap({
      purchaseApi: purchaseApiStub(),
      opsUi: opsUiStub(log),
      auth: authStub({ claims: { super_admin: true } }),
      document: documentStub(),
      Swal: swalStub(),
      hostname: "localhost"
    });
    await bootstrap.mount();
    await bootstrap.load();
    assert.equal(log.created, 1);
    assert.equal(log.mounted, 1);
    assert.equal(log.loaded, 1);
  });

  await test("troca de ator recria controller financeiro", async () => {
    const log = {};
    const auth = authStub({ uid: "admin-1", claims: { platform_admin: true } });
    const bootstrap = createBootstrap({
      purchaseApi: purchaseApiStub(),
      opsUi: opsUiStub(log),
      auth,
      document: documentStub(),
      Swal: swalStub(),
      hostname: "localhost"
    });
    await bootstrap.ensureController();
    auth.currentUser = authStub({ uid: "admin-2", claims: { super_admin: true } }).currentUser;
    await bootstrap.ensureController();
    assert.equal(log.created, 2);
    assert.equal(bootstrap.state.userId, "admin-2");
    assert.equal(bootstrap.state.role, "super_admin");
  });

  await test("bootstrap bloqueia producao antes de criar controller", async () => {
    const log = {};
    const bootstrap = createBootstrap({
      purchaseApi: purchaseApiStub("production"),
      opsUi: opsUiStub(log),
      auth: authStub({ claims: { platform_admin: true } }),
      document: documentStub(),
      Swal: swalStub(),
      hostname: "bjj-exams.web.app"
    });
    await assert.rejects(() => bootstrap.mount(), /Produção bloqueada/i);
    assert.equal(log.created || 0, 0);
  });

  console.log(`FINANCIAL_OPS_ADMIN_BOOTSTRAP_V1_2=${passed}/10`);
  if (passed !== 10) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
