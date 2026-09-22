"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const api = require(
  path.resolve(__dirname, "..", "js", "course-purchase-api-v1_2.js")
);

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

function response(result, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(
      status >= 200 && status < 300
        ? { result }
        : { error: result }
    )
  };
}

function baseOptions(overrides = {}) {
  return {
    hostname: "localhost",
    idToken: "token-test",
    userId: "user-1",
    storage: new MemoryStorage(),
    randomUUID: () => "11111111-2222-4333-8444-555555555555",
    now: () => new Date("2026-09-19T21:00:00.000Z"),
    ...overrides
  };
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test("localhost resolve para staging", () => {
  assert.equal(api.inferEnvironment({ hostname: "localhost" }), "staging");
});

test("host oficial de producao e reconhecido mas bloqueado neste marco", () => {
  assert.equal(
    api.inferEnvironment({ hostname: "bjj-exams.web.app" }),
    "production"
  );
  assert.throws(
    () => api.functionUrl("obterStatusCompraCursoV12", {
      hostname: "bjj-exams.web.app"
    }),
    /Produção bloqueada/
  );
});

test("host desconhecido falha seguro para staging", () => {
  assert.equal(
    api.inferEnvironment({ hostname: "preview.example.invalid" }),
    "staging"
  );
});

test("contrato financeiro expoe exatamente seis callables", () => {
  assert.equal(api.ALLOWED_FUNCTIONS.size, 6);
  for (const name of [
    "iniciarCheckoutCursoV12",
    "obterStatusCompraCursoV12",
    "listarOperacoesFinanceirasV12",
    "listarOperacoesFinanceirasCursosV12",
    "cancelarCobrancaPendenteV12",
    "solicitarEstornoIntegralV12"
  ]) {
    assert.equal(api.ALLOWED_FUNCTIONS.has(name), true);
  }
});

test("endpoint staging usa projeto e regiao canonicos", () => {
  assert.equal(
    api.functionUrl("obterStatusCompraCursoV12", { hostname: "localhost" }),
    "https://southamerica-east1-bjj-exams-staging.cloudfunctions.net/obterStatusCompraCursoV12"
  );
});

test("endpoint fora da allowlist e bloqueado", () => {
  assert.throws(
    () => api.functionUrl("qualquerFuncao", { hostname: "localhost" }),
    /fora do contrato/
  );
});

test("callable privada exige autenticacao", async () => {
  await assert.rejects(
    api.callPrivateCallable(
      "obterStatusCompraCursoV12",
      { courseId: "course-1" },
      { hostname: "localhost", fetchImpl: async () => response({}) }
    ),
    /Sessão autenticada obrigatória/
  );
});

test("callable envia bearer e envelope Firebase callable", async () => {
  let captured = null;
  const result = await api.callPrivateCallable(
    "obterStatusCompraCursoV12",
    { courseId: "course-1" },
    {
      hostname: "localhost",
      idToken: "token-123",
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return response({ ok: true, purchase: { purchaseState: "payment_pending" } });
      }
    }
  );
  assert.equal(result.ok, true);
  assert.equal(captured.options.headers.Authorization, "Bearer token-123");
  assert.deepEqual(JSON.parse(captured.options.body), {
    data: { courseId: "course-1" }
  });
});

test("intent persistente e reutilizado apos nova instancia logica", async () => {
  const storage = new MemoryStorage();
  let generated = 0;
  const options = baseOptions({
    storage,
    randomUUID: () => {
      generated += 1;
      return `intent-${generated}`;
    }
  });
  const first = await api.getOrCreateCheckoutIntent("course-1", options);
  const second = await api.getOrCreateCheckoutIntent("course-1", options);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.idempotencyKey, first.idempotencyKey);
  assert.equal(generated, 1);
});

test("storage de intent e isolado por usuario e curso", async () => {
  const storage = new MemoryStorage();
  let generated = 0;
  const randomUUID = () => `uuid-${++generated}`;
  const first = await api.getOrCreateCheckoutIntent("course-a", baseOptions({
    storage,
    userId: "user-a",
    randomUUID
  }));
  const otherCourse = await api.getOrCreateCheckoutIntent("course-b", baseOptions({
    storage,
    userId: "user-a",
    randomUUID
  }));
  const otherUser = await api.getOrCreateCheckoutIntent("course-a", baseOptions({
    storage,
    userId: "user-b",
    randomUUID
  }));
  assert.notEqual(first.idempotencyKey, otherCourse.idempotencyKey);
  assert.notEqual(first.idempotencyKey, otherUser.idempotencyKey);
  assert.equal(storage.values.size, 3);
});

test("rotateCheckoutIntent invalida tentativa anterior", async () => {
  const storage = new MemoryStorage();
  let generated = 0;
  const options = baseOptions({
    storage,
    randomUUID: () => `rotate-${++generated}`
  });
  const first = await api.getOrCreateCheckoutIntent("course-1", options);
  const rotated = await api.rotateCheckoutIntent("course-1", options);
  assert.notEqual(rotated.idempotencyKey, first.idempotencyKey);
  assert.equal(rotated.reused, false);
});

test("startCheckout envia somente courseId e idempotencyKey", async () => {
  let captured = null;
  const options = baseOptions({
    fetchImpl: async (url, request) => {
      captured = { url, request };
      return response({
        ok: true,
        status: "pending_payment",
        processing: false,
        pix: { payload: "000201TEST" }
      });
    }
  });
  const result = await api.startCheckout("course-1", options);
  const payload = JSON.parse(captured.request.body).data;
  assert.match(captured.url, /iniciarCheckoutCursoV12$/);
  assert.deepEqual(Object.keys(payload).sort(), ["courseId", "idempotencyKey"]);
  assert.equal(payload.courseId, "course-1");
  assert.equal(payload.idempotencyKey.startsWith("bjjex-v12-"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "userId"), false);
  assert.equal(result.intentReused, false);
});

test("retry de startCheckout reutiliza a mesma chave", async () => {
  const storage = new MemoryStorage();
  const seen = [];
  const options = baseOptions({
    storage,
    fetchImpl: async (_url, request) => {
      seen.push(JSON.parse(request.body).data.idempotencyKey);
      return response({ ok: true, status: "pending_payment" });
    }
  });
  await api.startCheckout("course-1", options);
  const second = await api.startCheckout("course-1", options);
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
  assert.equal(second.intentReused, true);
});

test("forceNewIntent cria nova tentativa para recompra", async () => {
  const storage = new MemoryStorage();
  let generated = 0;
  const seen = [];
  const options = baseOptions({
    storage,
    randomUUID: () => `new-${++generated}`,
    fetchImpl: async (_url, request) => {
      seen.push(JSON.parse(request.body).data.idempotencyKey);
      return response({ ok: true, status: "pending_payment" });
    }
  });
  await api.startCheckout("course-1", options);
  await api.startCheckout("course-1", { ...options, forceNewIntent: true });
  assert.notEqual(seen[0], seen[1]);
});

test("getPurchaseStatus envia apenas courseId e retorna purchase", async () => {
  let payload = null;
  const purchase = { purchaseState: "paid_entitled", canOpenCourse: true };
  const result = await api.getPurchaseStatus("course-1", {
    hostname: "localhost",
    idToken: "t",
    fetchImpl: async (_url, request) => {
      payload = JSON.parse(request.body).data;
      return response({ ok: true, purchase });
    }
  });
  assert.deepEqual(payload, { courseId: "course-1" });
  assert.deepEqual(result, purchase);
});

test("listAdminOperations usa callable agregada e limita contrato a limit", async () => {
  let payload = null;
  let calledUrl = null;

  const result = await api.listAdminOperations(20, {
    hostname: "localhost",
    idToken: "admin-token",
    fetchImpl: async (url, request) => {
      calledUrl = url;
      payload = JSON.parse(request.body).data;
      return response({
        ok: true,
        role: "platform_admin",
        limit: 20,
        items: []
      });
    }
  });

  assert.match(
    calledUrl,
    /listarOperacoesFinanceirasV12$/
  );
  assert.deepEqual(payload, { limit: 20 });
  assert.equal(result.role, "platform_admin");
  assert.equal(result.limit, 20);
  assert.deepEqual(result.items, []);
});

test("cancelamento e refund enviam somente orderId e reason", async () => {
  const calls = [];
  const options = {
    hostname: "localhost",
    idToken: "admin-token",
    fetchImpl: async (url, request) => {
      calls.push({ url, data: JSON.parse(request.body).data });
      return response({ ok: true, status: "awaiting_webhook" });
    }
  };
  await api.cancelPending("order-1", "Cancelamento solicitado", options);
  await api.requestFullRefund("order-2", "Estorno solicitado", options);
  assert.match(calls[0].url, /cancelarCobrancaPendenteV12$/);
  assert.deepEqual(calls[0].data, {
    orderId: "order-1",
    reason: "Cancelamento solicitado"
  });
  assert.match(calls[1].url, /solicitarEstornoIntegralV12$/);
  assert.deepEqual(calls[1].data, {
    orderId: "order-2",
    reason: "Estorno solicitado"
  });
});

test("validacoes locais rejeitam limite e justificativa invalidos", async () => {
  assert.throws(() => api.requireAdminLimit(51), /entre 1 e 50/);
  await assert.rejects(
    api.cancelPending("order-1", "x", {
      hostname: "localhost",
      idToken: "t",
      fetchImpl: async () => response({})
    }),
    /Justificativa/
  );
});

let passed = 0;
(async () => {
  for (const item of cases) {
    try {
      await item.fn();
      passed += 1;
      console.log(`PASS | ${item.name}`);
    } catch (error) {
      console.error(`FAIL | ${item.name}`);
      console.error(error.stack || error);
      process.exitCode = 1;
    }
  }
  console.log(`COURSE_PURCHASE_API_V1_2=${passed}/${cases.length}`);
})();
